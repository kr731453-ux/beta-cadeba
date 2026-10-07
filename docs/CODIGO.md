# Organización y mantenimiento del código

## Pantallas

- `public/admin.html`: estructura del panel y formularios.
- `public/admin.js`: estado del panel, navegación, participantes y control de pagos. Sus secciones están identificadas con comentarios.
- `public/admin.css`: presentación del administrador en computadora, tablet y celular.
- `public/notes-ui.js`: edición de notas, agrupación por persona, compartidos y PDF.
- `public/extension-ui.js`: incorporación de participantes a cadenas ya iniciadas.
- `public/shared.js`: solicitudes, mensajes, importes, fechas y descargas comunes.
- `public/payment-groups.js`: cálculo de filas de pago por persona y período, con pruebas en `tests/`.
- `public/positions.js`: interpretación y presentación de cantidades de Notas.
- `public/participant.*`: interfaz de participantes conservada para compatibilidad.

## Servidor

- `server/api.js`: entrada de la API, comprobación de acceso y coordinación de operaciones.
- `server/admin-auth.js` y `server/account-requests.js`: credenciales y aprobación de cuentas.
- `server/group-payments.js`: importes, comprobantes y efectivo por persona/período.
- `server/seat-shares.js`: puestos compartidos y distribución exacta de centavos.
- `server/chain-extension.js`: ampliación de cadenas y entregas adicionales.
- `server/chain-lifecycle.js`: archivo, restauración y eliminación.
- `server/chain-notes.js`, `server/note-people.js` y `server/participant-identity.js`: notas e identidad por DNI.

## Reglas que deben conservarse

1. Comprobar propietario y permisos en el servidor antes de leer o modificar una cadena.
2. Guardar dinero en centavos enteros y preservar el total al repartirlo entre puestos.
3. No cambiar un pago aprobado ni repetirlo al reintentar una solicitud.
4. Conservar una persona por DNI, las cantidades literales de Notas y los integrantes de una fila compartida.
5. No mezclar cantidad solicitada, prioridad de cobro y número de turno. En Notas se conserva la interpretación histórica de las etiquetas ingresadas.
6. No modificar retroactivamente el fondo ya cobrado: los aportes atrasados generan saldos adicionales.
7. Descartar respuestas atrasadas al cambiar de cadena. Una confirmación de guardado no debe convertirse en un falso error si falla el refresco posterior.
8. Verificar cambios con datos ficticios. No incluir bases de datos, comprobantes, contraseñas o archivos de entorno en Git.

## Rendimiento

El detalle de una cadena consulta en paralelo información independiente, después de comprobar el acceso. Los pagos se agrupan con índices por persona y período para evitar recorrer todo el historial por cada participante. Los formatos de moneda y fecha se reutilizan.

Los botones de envío muestran el trabajo en curso y bloquean envíos repetidos. La confirmación se muestra después de la respuesta exitosa del servidor, antes de esperar la actualización del panel. No se da por pagado un aporte de forma anticipada.

## Antes de subir cambios

Ejecutar `npm run format:check`, `npm test` y `npm run build`. Cuando se cambie una regla de pagos, verificar también efectivo, comprobantes, autorización, puestos compartidos, errores de conexión y reintentos. Mantener los módulos existentes y extraer funciones por responsabilidad cuando sea necesario; evitar cambios amplios de estructura sin una prueba que preserve el comportamiento.

Las bibliotecas de `public/vendor/` y `vendor/` mantienen sus licencias y formato original. Las migraciones ya aplicadas se conservan: los cambios de esquema se agregan en una migración nueva.
