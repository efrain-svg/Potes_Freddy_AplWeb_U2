import { DatabaseSync } from 'node:sqlite';
import { ApiError, titleKey } from './domain.js';
const columns = 'id, title, description, status, version, created_at AS createdAt, updated_at AS updatedAt';
export function createRepository(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      title_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=1000),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
  const get = id => db.prepare(`SELECT ${columns} FROM tasks WHERE id=?`).get(id);
  const required = id => {
    const task = get(id);
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Tarea no encontrada.');
    return task;
  };
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function checkVersion(task, version) {
    if (task.version !== version) throw new ApiError(412, 'VERSION_CONFLICT', 'La tarea cambió. Consulte la versión actual antes de reintentar.');
  }
  return {
    get: required,
    list: () => db.prepare(`SELECT ${columns} FROM tasks ORDER BY id`).all(),
    create(task) {
      return transaction(() => {
        const now = new Date().toISOString();
        const row = db.prepare('INSERT INTO tasks(title,title_key,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(task.title, titleKey(task.title), task.description, task.status, now, now);
        return required(Number(row.lastInsertRowid));
      });
    },
    update(id, patch, version) {
      return transaction(() => {
        const old = required(id); checkVersion(old, version);
        const task = { ...old, ...patch };
        db.prepare('UPDATE tasks SET title=?,title_key=?,description=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(task.title, titleKey(task.title), task.description, task.status, new Date().toISOString(), id, version);
        return required(id);
      });
    },
    remove(id, version) {
      return transaction(() => {
        const task = required(id); checkVersion(task, version);
        db.prepare('DELETE FROM tasks WHERE id=? AND version=?').run(id, version);
        return task;
      });
    },
    close: () => db.close()
  };
}
