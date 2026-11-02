# API REST de tareas

**Freddy Potes · Universidad Politécnica Salesiana · Aplicaciones Web · Unidad 2**

API académica funcional con CRUD, persistencia SQLite, exportación CSV y notificaciones SSE. El requisito «archivo o sesión» se resuelve con un archivo CSV descargable. No se implementa inicio de sesión. La aplicación escucha únicamente en `127.0.0.1` y está diseñada para la demostración local de un solo usuario.

Repositorio: https://github.com/efrain-svg/Potes_Freddy_AplWeb_U2

## Instalación y ejecución

Requisitos: Node.js **24.x** y npm (incluido con Node). Probado con Node 24.22.1 y Express 5.1.0. No se necesita instalar un servidor de base de datos.

```sh
git clone https://github.com/efrain-svg/Potes_Freddy_AplWeb_U2.git
cd Potes_Freddy_AplWeb_U2
npm ci
npm test
npm start
```

La API queda en http://127.0.0.1:3000. Comprobación: http://127.0.0.1:3000/health. `npm start` crea automáticamente `data/tasks.sqlite`; el contenido persiste entre reinicios. `Ctrl+C` detiene el servidor. Las pruebas usan bases aisladas y no modifican los datos de la demostración.

Opciones en PowerShell antes de `npm start`:

```powershell
$env:PORT = '3001'
$env:DB_PATH = 'data/otra-base.sqlite'
```

Se incluye `package-lock.json`: use `npm ci` para reproducir las dependencias. `node:sqlite` es una API integrada de Node; algunas versiones pueden mostrar una advertencia experimental. SQLite se eligió porque la consigna suministrada no prescribe otro motor; si el docente define uno, se reemplaza la capa de repositorio.

## Contrato HTTP

Base: `/api`. Respuestas JSON exitosas: `{"data": ...}`. Todas las respuestas de error usan `{"error":{"code":"...","message":"...","details":[]}}`. CSV y SSE tienen su propio tipo de contenido. DELETE exitoso no lleva cuerpo.

| Método y ruta | Resultado |
|---|---|
| GET /health | 200, estado del proceso |
| GET /api/tasks | 200, colección ordenada por id |
| POST /api/tasks | 201, tarea creada, cabeceras Location y ETag |
| GET /api/tasks/:id | 200 con ETag; 404 si no existe |
| PATCH /api/tasks/:id | 200 y nuevo ETag; exige If-Match |
| DELETE /api/tasks/:id | 204; exige If-Match |
| GET /api/tasks/export.csv | 200, descarga tareas.csv |
| GET /api/events | 200, flujo text/event-stream |

POST requiere `title`; `description` y `status` son opcionales. PATCH acepta un subconjunto no vacío de estos tres campos. No se admite PUT: devuelve 405 y Allow. Tampoco se admiten campos adicionales. No hay filtros ni paginación en esta entrega, prevista para pequeños conjuntos de tareas.

### Esquema y validación

| Campo | Regla |
|---|---|
| id | Entero positivo generado; clave primaria |
| title | Texto de 1 a 120 caracteres tras trim y normalización NFC |
| title_key | Valor interno normalizado a minúsculas; índice UNIQUE |
| description | Texto de hasta 1000 caracteres; por defecto vacío |
| status | pending, in_progress o done; por defecto pending |
| version | Entero positivo; inicia en 1, aumenta en cada PATCH |
| createdAt / updatedAt | Fechas UTC ISO 8601 generadas por el servidor |

Se rechazan controles ASCII en textos, tipos incorrectos, títulos vacíos y cuerpos de más de 16 KiB. Cada consulta con datos externos usa parámetros `?`. Las restricciones CHECK y UNIQUE respaldan la validación de la aplicación. El título es único sin distinguir mayúsculas y manteniendo distinción entre letras con y sin tilde.

### Estados de error

400 JSON o ETag mal formado; 404 recurso/ruta inexistente; 405 método no permitido; 409 título duplicado; 412 versión desactualizada; 413 cuerpo excesivo; 415 Content-Type distinto de application/json; 422 validación; 428 falta If-Match; 503 base ocupada o límite SSE; 500 fallo interno sin exponer detalles SQL al cliente.

### Conflictos entre clientes

GET devuelve, por ejemplo, `ETag: "1"`. Para editar o eliminar se envía `If-Match: "1"`. Una edición devuelve `ETag: "2"`. Otro cliente con la versión anterior recibe 412 y debe volver a consultar. No se reintenta automáticamente con una versión nueva, porque eso sobrescribiría los cambios ajenos. Lectura de versión y escritura ocurren en una transacción `BEGIN IMMEDIATE`; la escritura también compara id y versión. Un duplicado revierte la transacción y devuelve 409.

## Demostración paso a paso en PowerShell

Con `npm start` activo, abra otra terminal:

```powershell
$base = 'http://127.0.0.1:3000'
$body = @{title='Preparar entrega'; description='Revisar informe'; status='pending'} | ConvertTo-Json
$created = Invoke-WebRequest -Uri "$base/api/tasks" -Method Post -ContentType 'application/json' -Body $body
$task = ($created.Content | ConvertFrom-Json).data
$id = $task.id
$tag = [string]$created.Headers.ETag
$created.StatusCode # 201
$created.Content
Invoke-RestMethod "$base/api/tasks"
Invoke-RestMethod "$base/api/tasks/$id"
$updated = Invoke-WebRequest -Uri "$base/api/tasks/$id" -Method Patch -ContentType 'application/json' -Headers @{'If-Match'=$tag} -Body '{"status":"done"}'
$updated.Content
Invoke-WebRequest "$base/api/tasks/export.csv" -OutFile tareas.csv
Invoke-WebRequest -Uri "$base/api/tasks/$id" -Method Delete -Headers @{'If-Match'=[string]$updated.Headers.ETag}
```

Si se repite la demostración sin borrar la tarea anterior, use un título diferente para evitar el 409. Para observar los eventos, abra **antes** otra terminal y mantenga este comando en ejecución:

```powershell
curl.exe -N http://127.0.0.1:3000/api/events
```

Los cambios emiten `event: task.changed` con `action` igual a `created`, `updated` o `deleted`, la tarea y `emittedAt`. Los eventos se publican después del COMMIT; las operaciones fallidas no emiten cambios. Hay heartbeat cada 15 segundos, un máximo de 50 clientes y limpieza al desconectarse; clientes lentos se cierran para no acumular memoria.

SSE comunica servidor a cliente. Los eventos son notificaciones efímeras, sin historial ni reproducción tras reconectar: el cliente debe volver a GET /api/tasks al recibir `ready` y al reconectar. No se presenta esta demostración como alojamiento público; las URL de localhost requieren ejecutar el proyecto.

### Ejemplos de petición y respuesta

El archivo `docs/solicitudes.http` contiene peticiones listas para REST Client de VS Code o adaptación a Postman. La evidencia `docs/demo-resultados.json` contiene respuestas **obtenidas al ejecutar** `node scripts/demo.js` sobre una base temporal. Este script inicia su propio servidor en un puerto libre, realiza las peticiones, verifica sus estados, exporta el CSV y cierra sin modificar `data/tasks.sqlite`.

```http
POST /api/tasks
Content-Type: application/json

{"title":"Preparar entrega"}
```

Respuesta 201 (las fechas e id dependen de la ejecución):

```json
{"data":{"id":1,"title":"Preparar entrega","description":"","status":"pending","version":1,"createdAt":"2026-11-02T00:00:00.000Z","updatedAt":"2026-11-02T00:00:00.000Z"}}
```

Ejemplo de título duplicado, 409:

```json
{"error":{"code":"DUPLICATE_TITLE","message":"Ya existe una tarea con ese título.","details":[]}}
```

## Arquitectura y decisiones

`app.js` (HTTP y errores) → `service.js` (casos de uso) → `repository.js` (SQLite). `domain.js` contiene validación, normalización y conversión CSV sin E/S ni modificación de los datos de entrada. `events.js` administra los canales SSE; `server.js` configura rutas del disco y ciclo de vida. Las funciones reciben sus dependencias y evitan estado global compartido entre pruebas.

SQLite usa WAL, transacciones breves y espera de bloqueo de 3 segundos. La exportación obtiene los datos del repositorio y genera un nombre de archivo fijo, sin rutas suministradas por el cliente. Duplica comillas, cita cada celda, añade BOM UTF-8 y antepone apóstrofo a valores que podrían interpretarse como fórmulas (=, +, -, @). La lista y la exportación se generan en memoria: para grandes volúmenes habría que paginar y transmitir por lotes. La API no incorpora autenticación ni permisos por usuario y no debe exponerse fuera del equipo sin añadirlos, HTTPS y límites de tráfico.

## Pruebas y evidencias

`npm test` ejecuta 16 pruebas automatizadas con `node:test` y peticiones HTTP reales a un puerto local libre. `docs/resultados-pruebas.txt` conserva la salida TAP de la ejecución aprobada: **16 aprobadas, 0 fallidas**. No se afirma cobertura porcentual ni pruebas de carga.

1. Salud y listado vacío.
2. Creación, normalización inmutable, Location y ETag.
3. Lectura, actualización y borrado.
4. Tipos, campos, límites y caracteres de control.
5. JSON inválido, tipo de contenido y tamaño.
6. Duplicados normalizados y rollback.
7. Id inválido y recursos inexistentes.
8. If-Match obligatorio y actualización vacía.
9. Dos ediciones simultáneas y borrado con versión antigua.
10. Inyección SQL tratada como texto.
11. Persistencia al cerrar y reabrir un archivo SQLite.
12. CSV, escape de comillas y fórmulas.
13. SSE para creación, edición, borrado y desconexión.
14. Ausencia de eventos ante errores.
15. Límite de conexiones y heartbeat SSE.
16. Métodos no permitidos, Allow y ruta desconocida.

## Correspondencia con la rúbrica

| Criterio | Implementación y evidencia |
|---|---|
| HTTP y lógica funcional | Rutas coherentes, estados, capas, funciones puras; pruebas 1-3, 7-9 y 16 |
| Persistencia y validación | SQLite, CHECK, UNIQUE, parámetros y versiones; pruebas 4-11 |
| Archivos o sesiones y tiempo real | CSV descargable y SSE; pruebas 12-15 |
| Pruebas, documentación y calidad | Test automatizado, lockfile, ejemplos HTTP, demostración y README |

## Referencias

Express. (s. f.). *5.x API reference*. https://expressjs.com/en/api/

Node.js. (s. f.). *SQLite*. https://nodejs.org/docs/latest-v24.x/api/sqlite.html

MDN Web Docs. (s. f.). *Using server-sent events*. https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events

Bibliografía recomendada en la consigna: Brown, E. (2020). *Web development with Node & Express* (2.ª ed.). O’Reilly Media; Duckett, J. (2014). *JavaScript & jQuery: Interactive front-end web development*. Wiley; Robbins, J. N. (2018). *Learning web design* (5.ª ed.). O’Reilly Media.
