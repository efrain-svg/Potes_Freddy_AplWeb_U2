import { validateTask } from './domain.js';
export function createService(repo, events) {
  return {
    list: () => repo.list(),
    get: id => repo.get(id),
    create(input) { const task = repo.create(validateTask(input)); events.publish('created', task); return task; },
    update(id, input, version) { const task = repo.update(id, validateTask(input, true), version); events.publish('updated', task); return task; },
    remove(id, version) { const task = repo.remove(id, version); events.publish('deleted', task); }
  };
}
