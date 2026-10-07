# Ronda · Control de cadenas

Aplicación web para administrar cadenas de pagos semanales, quincenales y mensuales. Permite gestionar participantes, puestos completos o compartidos, fechas de cobro, comprobantes, pagos en efectivo, notas y exportaciones a PDF.

- **Manual de uso:** [LEEME.md](LEEME.md).
- **Mapa del código y reglas de mantenimiento:** [docs/CODIGO.md](docs/CODIGO.md).
- **Configuración del entorno y alojamiento:** [docs/ENTORNO.md](docs/ENTORNO.md).

## Estructura

| Carpeta                         | Responsabilidad                                   |
| ------------------------------- | ------------------------------------------------- |
| `public/`                       | Pantallas, estilos y JavaScript del navegador.    |
| `server/`                       | Autenticación, permisos, cadenas, pagos y notas.  |
| `app/`                          | Integración de las páginas y API con Vinext.      |
| `db/`                           | Modelo de datos y conexión con D1.                |
| `drizzle/`                      | Migraciones versionadas de la base de datos.      |
| `scripts/`, `build/`            | Herramientas de desarrollo y compilación.         |
| `components/`, `hooks/`, `lib/` | Componentes y utilidades de la base del proyecto. |
| `docs/`                         | Documentación técnica.                            |

## Desarrollo

Requiere Node.js 22.13 o posterior y npm.

```sh
npm run install:ci
npm run dev
```

El desarrollo local requiere configurar los enlaces de D1/R2 y aplicar las migraciones como se explica en [ENTORNO.md](docs/ENTORNO.md). Las credenciales se configuran fuera del código. Los datos y archivos de producción no forman parte de este repositorio.

## Formato y comprobación

```sh
npm run format
npm run format:check
npm test
npm run build
```

Prettier mantiene el formato del código de la aplicación. `.editorconfig` establece UTF-8, espacios y saltos de línea uniformes. El formateador excluye bibliotecas de terceros, migraciones y archivos generados.

## Tecnología

HTML, CSS y JavaScript para las pantallas; React y Vinext como integración web; Cloudflare Workers para la API, D1 para datos y R2 para comprobantes. Drizzle mantiene el esquema y las migraciones. Los PDF se generan con pdfmake.

## Funciones principales

- Cada administrador tiene su cuenta y sus propias cadenas.
- El orden de cobro se carga manualmente.
- Los pagos se agrupan por participante y período, respetando los puestos asignados.
- Se pueden registrar comprobantes o aprobar pagos en efectivo.
- Notas conserva la identidad por DNI, cantidades ingresadas y filas compartidas.
- Las cadenas pueden archivarse, restaurarse o eliminarse con confirmación.
