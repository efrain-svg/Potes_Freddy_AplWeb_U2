export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message); Object.assign(this, { status, code, details });
  }
}
const invalid = (message) => { throw new ApiError(422, 'VALIDATION_ERROR', message); };
export function parseId(value) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) invalid('El id debe ser un entero positivo.');
  return Number(value);
}
export function validateTask(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Se requiere un objeto JSON.');
  const allowed = ['title', 'description', 'status'];
  if (Object.keys(input).some(k => !allowed.includes(k))) invalid('Hay campos desconocidos.');
  if (partial && !Object.keys(input).length) invalid('La actualización no puede estar vacía.');
  if (!partial && !Object.hasOwn(input, 'title')) invalid('El título es obligatorio.');
  const result = {};
  for (const key of ['title', 'description']) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== 'string') invalid(`${key} debe ser texto.`);
    const value = input[key].trim().normalize('NFC');
    const limit = key === 'title' ? 120 : 1000;
    if ((key === 'title' && !value.length) || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) invalid(`${key} tiene longitud o caracteres no permitidos.`);
    result[key] = value;
  }
  if (Object.hasOwn(input, 'status')) {
    if (!['pending', 'in_progress', 'done'].includes(input.status)) invalid('Estado no válido.');
    result.status = input.status;
  }
  return partial ? result : { description: '', status: 'pending', ...result };
}
export function parseVersion(header) {
  if (!header) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'Envíe If-Match con el ETag obtenido al consultar.');
  const match = /^"([1-9]\d*)"$/.exec(header);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new ApiError(400, 'INVALID_ETAG', 'If-Match debe ser una versión entre comillas, por ejemplo "1".');
  return Number(match[1]);
}
export const titleKey = title => title.toLocaleLowerCase('es');
export function toCsv(tasks) {
  const cell = value => {
    let text = String(value);
    if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const keys = ['id', 'title', 'description', 'status', 'version', 'createdAt', 'updatedAt'];
  return '\uFEFF' + [keys.join(','), ...tasks.map(t => keys.map(k => cell(t[k])).join(','))].join('\r\n') + '\r\n';
}
