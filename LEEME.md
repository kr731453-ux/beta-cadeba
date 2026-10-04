# Ronda · Beta para Android

Primera versión web preparada para instalarse en Android desde un navegador compatible cuando esté publicada mediante HTTPS. No es un APK y aún no se ha probado en un Android real.

## Funciones incluidas

- Crear una cadena con nombre, aporte, moneda y fecha inicial.
- El organizador elige semanal, quincenal (cada 14 días en esta beta) o mensual.
- Agregar participantes y sortear una fecha distinta para cada persona.
- Bloquear configuración y participantes tras el sorteo.
- Adjuntar comprobantes JPG, PNG, WebP o PDF de hasta 5 MB por persona y turno.
- Revisar y aprobar manualmente los comprobantes.
- Exportar un respaldo con los datos y archivos. La importación aún no está incluida.

Los datos se guardan solamente en el navegador del dispositivo. No hay cuentas de participantes, sincronización entre celulares, transferencias ni verificación bancaria. Los nombres del botón «Cargar ejemplo» son ficticios. En esta beta todos aportan en cada turno, incluida la persona que cobra.

En modalidad mensual se conserva el día inicial; si no existe en un mes, se usa el último día de ese mes. El mes siguiente vuelve al día inicial.

## Estado de la entrega

Código de la beta disponible en `dist/index.html`, `dist/app.js` y `dist/style.css`; configuración de instalación en `dist/manifest.webmanifest` y `dist/sw.js`.

La publicación no pudo completarse porque la revisión automática de permisos bloqueó el paso de sincronización del código. No hay enlace desplegado confirmado. La revisión visual automatizada tampoco pudo ejecutarse por restricciones del entorno.

Se verificaron sintaxis, intervalos semanales y quincenales, fin de mes, año bisiesto, ausencia de participantes repetidos en sorteos y manifiesto con íconos.

## Próximos requisitos por definir con el usuario

- Si quincenal debe ser cada 14 días, cada 15 días o dos fechas fijas por mes.
- Reglas de participación y aportes para quien cobra.
- Cuentas, invitaciones y permisos del organizador y participantes.
- Carga de comprobantes desde cada celular y almacenamiento compartido.
- Vencimientos, recordatorios, atrasos y cancelaciones.
- Si la siguiente entrega debe ser un APK nativo o continuar como app web instalable.
