import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
const runtime = createApp();
const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const evidence = { executedAt: new Date().toISOString(), node: process.version, cases: [] };
async function request(name, method, path, expected, input, extra = {}) {
  const headers = { ...(input ? {'Content-Type':'application/json'} : {}), ...extra };
  const response = await fetch(base+path,{method,headers,body:input ? JSON.stringify(input) : undefined});
  const text=await response.text(); assert.equal(response.status,expected);
  evidence.cases.push({name,request:{method,path,headers,...(input?{body:input}:{})},response:{status:response.status,headers:Object.fromEntries(['content-type','etag','location','content-disposition'].map(k=>[k,response.headers.get(k)]).filter(x=>x[1])),body:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text}});
}
try {
  await request('Crear','POST','/api/tasks',201,{title:'Preparar entrega',description:'Revisar informe'});
  await request('Listar','GET','/api/tasks',200);
  await request('Consultar','GET','/api/tasks/1',200);
  await request('Actualizar','PATCH','/api/tasks/1',200,{status:'done'},{'If-Match':'"1"'});
  await request('Conflicto','PATCH','/api/tasks/1',412,{status:'pending'},{'If-Match':'"1"'});
  await request('Duplicado','POST','/api/tasks',409,{title:'Preparar entrega'});
  await request('Validación','POST','/api/tasks',422,{title:''});
  await request('Exportar','GET','/api/tasks/export.csv',200);
  await request('Borrar','DELETE','/api/tasks/1',204,undefined,{'If-Match':'"2"'});
  await request('Ausente','GET','/api/tasks/1',404);
  writeFileSync(new URL('../docs/demo-resultados.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log('Demostración verificada: 10 peticiones. Evidencia en docs/demo-resultados.json');
} finally {
  runtime.events.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); runtime.repo.close();
}
