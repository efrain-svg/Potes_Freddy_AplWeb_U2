import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { validateTask, toCsv } from '../src/domain.js';

async function fixture(t, options = {}) {
  const runtime = createApp(options);
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const stop = async () => {
    if (closed) return; closed = true;
    runtime.events.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); runtime.repo.close();
  };
  t.after(stop);
  const request = async (path = '/api/tasks', method = 'GET', body, headers = {}) => {
    const response = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
  };
  return { ...runtime, request, url, stop };
}
const etag = version => ({ 'If-Match': `"${version}"` });
test('01 salud y colección vacía', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health')).body.data.status, 'ok');
  assert.deepEqual((await f.request()).body.data, []);
});
test('02 creación normaliza sin mutar y devuelve 201 Location ETag', async t => {
  const f = await fixture(t), input = Object.freeze({ title: '  Estudiar API  ' });
  assert.equal(validateTask(input).title, 'Estudiar API'); assert.equal(input.title, '  Estudiar API  ');
  const r = await f.request('/api/tasks', 'POST', input);
  assert.equal(r.status, 201); assert.equal(r.headers.get('location'), '/api/tasks/1');
  assert.equal(r.headers.get('etag'), '"1"'); assert.equal(r.body.data.status, 'pending');
  assert.equal((await f.request('/api/tasks/1')).body.data.title, 'Estudiar API');
});
test('03 actualización y borrado completan CRUD', async t => {
  const f = await fixture(t); await f.request('/api/tasks', 'POST', { title: 'Prueba' });
  const r = await f.request('/api/tasks/1', 'PATCH', { status: 'done' }, etag(1));
  assert.equal(r.status, 200); assert.equal(r.body.data.version, 2); assert.equal(r.headers.get('etag'), '"2"');
  assert.equal(r.body.data.status, 'done');
  const d = await f.request('/api/tasks/1', 'DELETE', undefined, etag(2));
  assert.equal(d.status, 204); assert.equal(d.text, ''); assert.equal((await f.request('/api/tasks/1')).status, 404);
});
test('04 validación de campos, tipos, longitudes y controles', async t => {
  const f = await fixture(t);
  for (const input of [{}, {title:''}, {title:' '}, {title:4}, {title:null}, {title:'x'.repeat(121)}, {title:'a\nb'}, {title:'a',description:'x'.repeat(1001)}, {title:'a',description:2}, {title:'a',status:'invalid'}, {title:'a',admin:true}, []]) {
    const r = await f.request('/api/tasks', 'POST', input);
    assert.equal(r.status, 422, JSON.stringify(input)); assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  }
  const ok = await f.request('/api/tasks', 'POST', {title:'x'.repeat(120),description:'y'.repeat(1000)}); assert.equal(ok.status,201);
});
test('05 JSON mal formado, tipo incorrecto y cuerpo excesivo', async t => {
  const f = await fixture(t);
  for (const [body, type, expected] of [['{','application/json',400],['texto','text/plain',415],[JSON.stringify({title:'x'.repeat(17000)}),'application/json',413]]) {
    const r = await fetch(f.url + '/api/tasks', {method:'POST',headers:{'Content-Type':type},body});
    assert.equal(r.status,expected); const json = await r.json(); assert.deepEqual(Object.keys(json.error).sort(),['code','details','message']);
  }
});
test('06 títulos únicos normalizados y rollback de actualización duplicada', async t => {
  const f = await fixture(t);
  await f.request('/api/tasks','POST',{title:'Árbol'});
  assert.equal((await f.request('/api/tasks','POST',{title:'  A\u0301RBOL '})).status,409);
  await f.request('/api/tasks','POST',{title:'Otra'});
  assert.equal((await f.request('/api/tasks/2','PATCH',{title:'Árbol'},etag(1))).status,409);
  const task = (await f.request('/api/tasks/2')).body.data;
  assert.equal(task.title,'Otra'); assert.equal(task.version,1);
});
test('07 identificadores y recursos ausentes', async t => {
  const f = await fixture(t);
  for (const id of ['0','-1','abc','1.5','9007199254740993']) assert.equal((await f.request('/api/tasks/'+id)).status,422);
  for (const method of ['GET','PATCH','DELETE']) assert.equal((await f.request('/api/tasks/999',method,method==='PATCH'?{status:'done'}:undefined,etag(1))).status,404);
});
test('08 precondiciones obligatorias y ETag estricto', async t => {
  const f = await fixture(t); await f.request('/api/tasks','POST',{title:'Uno'});
  for (const method of ['PATCH','DELETE']) {
    const body = method==='PATCH'?{status:'done'}:undefined;
    assert.equal((await f.request('/api/tasks/1',method,body)).status,428);
    assert.equal((await f.request('/api/tasks/1',method,body,{'If-Match':'1'})).status,400);
  }
  assert.equal((await f.request('/api/tasks/1','PATCH',{},etag(1))).status,422);
});
test('09 dos ediciones concurrentes no pierden cambios', async t => {
  const f = await fixture(t); await f.request('/api/tasks','POST',{title:'Concurrencia'});
  const results = await Promise.all(['in_progress','done'].map(status => f.request('/api/tasks/1','PATCH',{status},etag(1))));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
  assert.equal((await f.request('/api/tasks/1')).body.data.version,2);
  assert.equal((await f.request('/api/tasks/1','DELETE',undefined,etag(1))).status,412);
});
test('10 consultas parametrizadas conservan un texto SQL como dato', async t => {
  const f = await fixture(t), title = "'); DROP TABLE tasks; --";
  const r = await f.request('/api/tasks','POST',{title}); assert.equal(r.status,201);
  assert.equal((await f.request()).body.data[0].title,title);
  assert.equal((await f.request('/api/tasks','POST',{title:'Sigue funcionando'})).status,201);
});
test('11 persistencia real al cerrar y reabrir SQLite', async t => {
  const dir = mkdtempSync(join(tmpdir(),'api-u2-')), dbPath = join(dir,'tasks.sqlite');
  try {
    const a = await fixture(t,{dbPath}); await a.request('/api/tasks','POST',{title:'Persistente'}); await a.stop();
    const b = await fixture(t,{dbPath}); assert.equal((await b.request('/api/tasks/1')).body.data.title,'Persistente'); await b.stop();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('12 CSV descargable con comillas y protección contra fórmulas', async t => {
  const f = await fixture(t); await f.request('/api/tasks','POST',{title:'=1+1',description:'Texto, con "comillas"'});
  const r = await fetch(f.url+'/api/tasks/export.csv'), text = await r.text();
  assert.equal(r.status,200); assert.match(r.headers.get('content-type'),/text\/csv/);
  assert.match(r.headers.get('content-disposition'),/attachment; filename="tareas.csv"/);
  assert.ok(text.includes('"\'=1+1"')); assert.ok(text.includes('"Texto, con ""comillas"""'));
  assert.ok(toCsv([]).startsWith('\uFEFFid,title')); assert.equal(toCsv([]).split('\r\n').length,2);
});
test('13 SSE emite alta cambio y borrado después de persistir', async t => {
  const f = await fixture(t), controller = new AbortController();
  const r = await fetch(f.url+'/api/events',{signal:controller.signal});
  assert.match(r.headers.get('content-type'),/text\/event-stream/);
  const reader = r.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  async function nextEvent() {
    while (!buffer.includes('\n\n')) {
      const timeout = setTimeout(()=>controller.abort(),2500);
      try { const {value,done}=await reader.read(); assert.equal(done,false); buffer += decoder.decode(value,{stream:true}); }
      finally { clearTimeout(timeout); }
    }
    const end = buffer.indexOf('\n\n'), block=buffer.slice(0,end); buffer=buffer.slice(end+2); return block;
  }
  try {
    assert.match(await nextEvent(),/event: ready/);
    for (const [action,method,path,body,headers] of [
      ['created','POST','/api/tasks',{title:'Evento'},{}],
      ['updated','PATCH','/api/tasks/1',{status:'done'},etag(1)],
      ['deleted','DELETE','/api/tasks/1',undefined,etag(2)]
    ]) {
      await f.request(path,method,body,headers); const block = await nextEvent(); assert.match(block,/event: task.changed/);
      const data = JSON.parse(block.split('\n').find(l=>l.startsWith('data: ')).slice(6)); assert.equal(data.action,action);
      assert.equal((await f.request('/api/tasks/1')).status,action==='deleted'?404:200);
    }
  } finally { controller.abort(); await reader.cancel().catch(()=>{}); }
  await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(f.events.size,0);
});
test('14 errores no generan notificaciones', async t => {
  const f = await fixture(t), calls=[]; f.events.publish=(...args)=>calls.push(args);
  await f.request('/api/tasks','POST',{title:'Única'});
  await f.request('/api/tasks','POST',{title:'Única'});
  await f.request('/api/tasks/1','PATCH',{status:'done'},etag(9));
  assert.equal(calls.length,1); assert.equal(calls[0][0],'created');
});
test('15 SSE limita clientes y envía heartbeat', async t => {
  const f = await fixture(t,{eventOptions:{maxClients:1,heartbeatMs:20}}), controller = new AbortController();
  const r = await fetch(f.url+'/api/events',{signal:controller.signal}), reader = r.body.getReader();
  try {
    assert.equal((await f.request('/api/events')).status,503);
    let text=''; const timer=setTimeout(()=>controller.abort(),2000);
    try { while(!text.includes(': heartbeat')) text+=new TextDecoder().decode((await reader.read()).value); }
    finally { clearTimeout(timer); }
    assert.match(text,/: heartbeat/);
  } finally { controller.abort(); await reader.cancel().catch(()=>{}); }
});
test('16 métodos no admitidos y ruta desconocida', async t => {
  const f = await fixture(t);
  const r = await f.request('/api/tasks','PUT'); assert.equal(r.status,405); assert.match(r.headers.get('allow'),/POST/);
  assert.equal((await f.request('/no-existe')).status,404);
  assert.equal((await fetch(f.url+'/api/events',{method:'HEAD'})).status,405);
});
