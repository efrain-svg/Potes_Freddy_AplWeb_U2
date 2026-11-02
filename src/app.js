import express from 'express';
import { createRepository } from './repository.js';
import { createService } from './service.js';
import { createEvents } from './events.js';
import { ApiError, parseId, parseVersion, toCsv } from './domain.js';
export function createApp({ dbPath = ':memory:', eventOptions = {} } = {}) {
  const repo = createRepository(dbPath), events = createEvents(eventOptions);
  const service = createService(repo, events), app = express();
  app.disable('x-powered-by'); app.disable('etag');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.'));
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (req, res) => res.json({ data: { status: 'ok' } }));
  app.head('/api/events', (req, res, next) => { res.set('Allow', 'GET'); next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET para recibir eventos.')); });
  app.get('/api/events', (req, res) => events.connect(req, res));
  app.get('/api/tasks/export.csv', (req, res) => res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tareas.csv"' }).send(toCsv(service.list())));
  app.route('/api/tasks')
    .get((req, res) => res.json({ data: service.list() }))
    .post((req, res) => {
      const task = service.create(req.body);
      res.status(201).location(`/api/tasks/${task.id}`).set('ETag', `"${task.version}"`).json({ data: task });
    });
  app.route('/api/tasks/:id')
    .get((req, res) => { const task = service.get(parseId(req.params.id)); res.set('ETag', `"${task.version}"`).json({ data: task }); })
    .patch((req, res) => { const task = service.update(parseId(req.params.id), req.body, parseVersion(req.get('If-Match'))); res.set('ETag', `"${task.version}"`).json({ data: task }); })
    .delete((req, res) => { service.remove(parseId(req.params.id), parseVersion(req.get('If-Match'))); res.status(204).end(); });
  for (const [path, methods] of [['/health','GET, HEAD'],['/api/events','GET'],['/api/tasks/export.csv','GET, HEAD'],['/api/tasks','GET, HEAD, POST'],['/api/tasks/:id','GET, HEAD, PATCH, DELETE']]) {
    app.all(path, (req, res, next) => { res.set('Allow', methods); next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método no permitido.')); });
  }
  app.use((req, res, next) => next(new ApiError(404, 'ROUTE_NOT_FOUND', 'Ruta no encontrada.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let mapped = error;
    if (error.type === 'entity.parse.failed') mapped = new ApiError(400, 'INVALID_JSON', 'JSON mal formado.');
    else if (error.type === 'entity.too.large') mapped = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera 16 KiB.');
    else if (error.errcode === 2067) mapped = new ApiError(409, 'DUPLICATE_TITLE', 'Ya existe una tarea con ese título.');
    else if (error.errcode === 5) mapped = new ApiError(503, 'DATABASE_BUSY', 'Base de datos ocupada. Reintente.');
    if (!(mapped instanceof ApiError)) { console.error(error); mapped = new ApiError(500, 'INTERNAL_ERROR', 'Error interno del servidor.'); }
    res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message, details: mapped.details } });
  });
  return { app, repo, events, close: () => { events.close(); repo.close(); } };
}
