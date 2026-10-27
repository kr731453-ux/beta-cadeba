# Auditoría de comprobantes y sesiones — 27 de octubre de 2026

## Hallazgos reproducibles

El cliente ya enviaba `FormData` sin forzar `Content-Type`: no era necesario corregir ese encabezado. Ambas rutas del servidor rechazaban archivos superiores a 5 MiB; también rechazaban PDFs auténticos cuando el navegador enviaba un MIME vacío o `application/octet-stream`. El cliente cancelaba cualquier solicitud a los 25 segundos. Estos defectos están confirmados por inspección y pruebas, pero no identifican por sí solos cuál ocurrió en el intento del usuario: no se proporcionó su PDF ni una respuesta HTTP y no había errores recientes en los registros consultados.

El backend es Cloudflare Workers con D1 y R2, no Express. La recepción usa el parser multipart nativo tras contar los bytes reales del stream. No hay directorios de subida ni scripts ejecutables en R2.

## Archivos

- `server/receipt-files.js`: límite de archivo de 10 MiB y de cuerpo de 10 MiB + 64 KiB, incluso sin Content-Length. Rechaza formularios incompletos, archivos vacíos y múltiples partes `file`.
- Detecta `%PDF-`, PNG, JPEG y WebP a partir de bytes; el MIME y la extensión enviados por el cliente no son autoridades.
- Nombres de descarga normalizados sin rutas, controles ni caracteres de cabeceras; clave de R2 generada mediante UUID criptográfico.
- Descargas privadas con autorización por cuenta y cadena, `Content-Disposition: attachment` y `nosniff`. Nunca se ejecuta ni se muestra el PDF como HTML.
- El fallo de R2 no registra pagos; la limpieza de un objeto tras fallar D1 no oculta el error original. Un fallo de limpieza se registra para mantenimiento.
- `public/admin.js` mantiene el archivo en memoria durante la petición y bloquea envíos repetidos. `public/shared.js` reserva hasta 120 segundos para archivos y 25 para otras solicitudes.

La firma mágica identifica el formato; no garantiza que el PDF sea íntegro, inocuo ni libre de JavaScript embebido. Esta implementación almacena comprobantes; no extrae texto ni ejecuta un parser de documentos. No incluye antivirus ni saneamiento del contenido PDF.

## Sesiones administrativas

`server/admin-sessions.js` usa Web Crypto RSASSA-PKCS1-v1_5/SHA-256 (RS256), con claves RSA de al menos 2048 bits. El JWKS se obtiene exclusivamente de configuración confiable, se importa una vez por configuración/isolate y se expone en `/.well-known/jwks.json` y `/api/auth/jwks`. No consulta URLs `jku` del token ni hace solicitudes HTTP al propio servidor en cada validación.

Valida algoritmo, tipo, kid, firma, issuer, audience, sub, sid, iat, exp y nbf cuando existe. El token de acceso dura 15 minutos. La sesión tiene un vencimiento absoluto de 30 días; la rotación no extiende ese límite.

Los refresh tokens son opacos, aleatorios de 256 bits y solo se guardan como SHA-256. Una transacción D1 rota cada token una vez. La reutilización después de cinco segundos revoca toda la sesión; una colisión dentro de ese margen devuelve 409 sin emitir credenciales. El cliente coordina renovaciones entre solicitudes y, con Web Locks, entre pestañas.

Las cookies `__Host-ronda_access` y `__Host-ronda_refresh` usan `Path=/; Secure; HttpOnly; SameSite=Lax`, sin Domain. No se guardan tokens administrativos en localStorage. Los POST con cookies propias y el endpoint de renovación exigen Origin del mismo sitio.

`POST /api/refresh-token` renueva silenciosamente. `public/session-fetch.js` reintenta exactamente una vez tras un 401 y renovación exitosa, reutilizando el FormData. No reintenta login rechazado, contraseña actual incorrecta, errores 5xx ni fallos ambiguos de red. No redirige ni descarta el formulario durante esa renovación.

La pertenencia administrativa y revocación se verifican en D1 por petición. El cierre de sesión, el cambio de contraseña y las decisiones de acceso revocan las sesiones correspondientes. Se conserva la autenticación de Sites/ChatGPT y el acceso existente de participantes. Una cookie administrativa antigua todavía válida puede migrarse al primer refresh sin nuevo login.

## Configuración y despliegue

Aplicar `0013_admin_refresh_sessions.sql` mediante la publicación normal. No cambia importes, participantes, comprobantes ni registros de cadenas.

Variables del servidor, nunca del frontend ni del repositorio:

- `AUTH_PRIVATE_JWK`: JWK RSA privada con kid. Guardar como secreto.
- `AUTH_JWKS`: JSON `{ "keys": [...] }`, exclusivamente claves públicas con kid, alg RS256 y use sig.
- `AUTH_ISSUER`: origen HTTPS canónico del sitio.
- Se conservan `ADMIN_EMAIL` y `PASSWORD_PEPPER`.

Para rotar la clave: incluir la nueva pública en JWKS, cambiar la privada activa y publicar ambas configuraciones juntas. Retener la pública anterior al menos 15 minutos más el margen de reloj. Para revocar una clave comprometida, retirarla del JWKS y revocar las sesiones afectadas.

Las familias y tokens consumidos se retienen para detectar reutilización durante la vigencia de la sesión. El mantenimiento puede eliminar familias vencidas (sus tokens tienen ON DELETE CASCADE); nunca eliminar el historial de una familia aún vigente.

## Verificación

`node --test tests/*.test.js` cubre archivos de 10 MiB, PDF con MIME genérico, falsificación, exceso de tamaño, boundary faltante, duplicados, stream interrumpido, almacenamiento caído, JWT adulterado/vencido, revocación, CSRF, renovación, reintento de FormData y flujo completo de pagos agrupados con datos ficticios. Las pruebas usan SQLite en memoria y un bucket ficticio; no acceden a información real.

Referencia para la rotación y detección de reutilización: [RFC 9700, sección 4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
