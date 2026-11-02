import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
const dbPath = resolve(process.env.DB_PATH || 'data/tasks.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const runtime = createApp({ dbPath });
const port = Number(process.env.PORT || 3000);
const server = runtime.app.listen(port, '127.0.0.1', () => console.log(`API disponible en http://127.0.0.1:${port} | SQLite: ${dbPath}`));
function shutdown() { runtime.events.close(); server.close(() => { runtime.repo.close(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
