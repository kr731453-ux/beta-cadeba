# Ronda Beta 0.3 · Administrador y participantes

La web permite crear y administrar varias cadenas simultáneas. La app Android es para participantes: elegir cadenas, solicitar uno o varios puestos, consultar cada fecha de cobro y enviar comprobantes. Los registros se guardan en una base compartida y los archivos en almacenamiento privado.

## Cómo probar

1. El administrador ingresa a la web con su cuenta ChatGPT y crea una cadena, eligiendo aporte por puesto, cantidad total de puestos, modalidad y primera fecha.
2. Los participantes instalan Ronda-Participantes-Android.apk. Al ingresar, se abre el navegador para iniciar sesión con ChatGPT; luego deben tocar Volver a Ronda.
3. En Elegir cadena solicitan la cantidad de puestos deseada. Se puede participar en varias cadenas.
4. El administrador aprueba las solicitudes hasta completar todos los puestos y sortea una sola vez. Cada puesto recibe un turno independiente con igual probabilidad, usando un generador criptográfico y Fisher–Yates sin sesgo.
5. Cada participante sube un comprobante por puesto y período. El administrador selecciona la cadena y el período: Comprobantes faltantes muestra los puestos sin archivo y Comprobantes recibidos permite descargar y aprobar pagos.
6. Cuando todos los aportes del período están aprobados y llega su fecha, el administrador registra el cobro. Los contadores se actualizan al abrir o actualizar la cadena.

Los participantes solo ven movimientos de cadenas donde fueron aprobados. Los archivos solo los descarga su dueño o el administrador. La app no realiza transferencias ni verifica pagos bancarios automáticamente.

## Modalidades y fechas

Semanal: cada 7 días. Quincenal: cada 14 días en esta beta. Mensual: el mismo día de cada mes, ajustado al último día cuando no existe. Importes con formato argentino (10.000,50). Fechas de operación según Argentina.

## Instalación Android

Android 8.0 o posterior, WebView actualizado y conexión a Internet. Abrir el APK desde Descargas, permitir la instalación desde ese gestor si Android lo solicita, instalar y abrir. Para actualizar usar el nuevo APK sobre la instalación existente: mantiene la misma firma de prueba. No está publicado en Play Store.

## Verificación y límites

Se probaron permisos, aislamiento entre cadenas, varios puestos por persona, límites de cupos, comprobantes independientes, calendario mensual, autenticación móvil y cierre de sesión. Se revisó la interfaz a tamaño de celular y el panel de faltantes con datos de prueba. La compilación y firma Android se verifican antes de la entrega. El ajuste de la barra de estado debe comprobarse también en un teléfono real, ya que aquí no hay uno conectado.

El inicio de sesión de esta beta utiliza ChatGPT. Las aprobaciones son manuales. Las solicitudes se aprueban como conjunto de puestos y la configuración del grupo queda cerrada tras el sorteo. Los datos de la antigua beta local no se importan automáticamente.
