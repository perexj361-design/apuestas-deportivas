# Cuota Clara

Web en español para explorar y construir combinadas deportivas. React + Vite en el navegador; Node.js + Express en el servidor. El acceso de visitantes no requiere cuenta ni pago. Las claves y las llamadas a proveedores permanecen en el servidor.

## Estado de esta versión

- **Funcional en demostración:** propuestas generadas, filtros, construcción, cuota multiplicada, combinaciones de deportes, mercados con línea, exclusiones/inclusiones, fechas locales, alternativas fuera del margen, información disponible/faltante y copia para compartir. Los eventos, participantes, competiciones, casas y cuotas son explícitamente ficticios.
- **Conexión preparada:** The Odds API v4 para cuotas y OpenAI para interpretar instrucciones y seguimientos. Sin clave de IA el chat queda desactivado; no produce respuestas simuladas. Con clave de IA y sin clave de cuotas, interpreta instrucciones reales sobre un catálogo ficticio, siempre identificado.
- **Pendiente de validar con cuenta real:** cuotas actuales, acceso de cada plan, casas pertinentes para Chile, licencia de exhibición pública y mercados adicionales. **Los córners reales están deshabilitados**, porque su cobertura no se pudo verificar. Una clave no añade ese mercado automáticamente.

Consulta la [evidencia sobre proveedores](docs/provider-verification.md) y las [notas del conector](docs/provider-research.md). No se han probado solicitudes autenticadas reales; las pruebas de integración usan respuestas controladas.

## Ejecutar y revisar

Requiere Node.js 22.12 o superior (probado con Node 24.19) y npm.

```sh
cd /workspace/apuestas-deportivas
npm ci --include=dev --cache /tmp/cuota-clara-npm
npm run dev
```

El comando inicia la API en el puerto 3000 y Vite en el 5173. Para revisar el mismo servidor que se publica:

```sh
npm run build
npm start
```

El servidor entrega la web y `/api` en el puerto `PORT` (3000 por defecto), escuchando en todas las interfaces. Usa el acceso al puerto que proporcione tu plataforma de desarrollo. `/health` comprueba que el servidor está activo; `/api/catalog` y `/api/parlays/daily` permiten comprobar comportamiento funcional.

```sh
npm test
npm run test:e2e
```

Las pruebas E2E usan Chromium instalado en el sistema (`/usr/bin/chromium`), o `PLAYWRIGHT_CHROMIUM_PATH`. Si tu equipo no lo tiene, instala el navegador con `npx playwright install chromium`; la configuración detecta su ausencia y usa el navegador de Playwright. Ejecuta `npm run build` antes de E2E: las pruebas revisan el servidor de producción y arrancan su propia instancia en el puerto 3100.

## Conectar servicios reales

Para desarrollo, copia `.env.example` a `.env`. Incluye `DEMO_MODE=true` para evitar llamadas externas. Para conectar servicios reales después, cambia a `DEMO_MODE=false` y añade claves localmente. Para hosting, usa exclusivamente la sección segura de variables del servidor. Nunca publiques `.env`, nunca uses variables `VITE_` para claves y nunca pegues claves en el chat.

| Variable | Uso |
| --- | --- |
| `DEMO_MODE` | `true` fuerza eventos y cuotas ficticios y desactiva la IA, incluso si existen claves heredadas. El Blueprint de Render lo fija en `true`. |
| `ODDS_API_KEY` | Acceso de servidor a The Odds API. Ausente: demo. Presente: consultas reales; los fallos reales se muestran sin convertirlos en demo. |
| `ODDS_API_REGIONS` | Regiones del proveedor; `eu` por defecto. No equivale a casas autorizadas en Chile. |
| `ODDS_API_BOOKMAKERS` | Opcional: claves de casas habilitadas, separadas por coma. Se filtran cuotas reales de esas casas. |
| `ODDS_API_SPORT_KEYS` | Opcional: competiciones predeterminadas con claves reales del catálogo. Sin esto se cargan hasta cuatro competiciones representativas para controlar consumo. El visitante puede elegir otras competiciones del catálogo. |
| `ODDS_MAX_AGE_MINUTES` | Antigüedad máxima admitida de una cuota: 15 minutos por defecto. |
| `ODDS_MAX_REQUESTS_PER_HOUR` | Presupuesto global de llamadas a cuotas por proceso: 100 por defecto. |
| `AI_API_KEY` | Clave de OpenAI, usada solo en HTTPS a `api.openai.com`. Se admite también `OPENAI_API_KEY` en un hosting convencional. |
| `AI_MODEL` | Modelo con salida JSON estructurada; por defecto `gpt-4.1-mini`. |
| `AI_MAX_REQUESTS_PER_HOUR` | Presupuesto global de solicitudes de IA por proceso: 100 por defecto. |
| `PORT` | Puerto del servidor; el hosting suele proporcionarlo. |
| `TRUST_PROXY` | `1` solo detrás de un proxy confiable como el de Render; `0` en ejecución directa. |

Si la plataforma usa un proxy para inyectar secretos, configura `ODDS_API_KEY` para `api.the-odds-api.com` y `AI_API_KEY` para `api.openai.com`. Destinos de red: esos dos dominios; para verificar cobertura y términos, `the-odds-api.com`. El chat utiliza cuotas ya obtenidas por el servidor; la IA nunca suministra las selecciones ni las cuotas.

Antes de activar datos reales en una web pública, confirma los derechos de exhibición, caché y atribución de tu plan. Revisa el catálogo autenticado y una respuesta de cada deporte, liga, casa y mercado que vayas a anunciar. Para córners hace falta verificar su mercado exacto y ampliar el adaptador con una respuesta documentada; no basta con cambiar una etiqueta o poner una clave.

Después de configurar las claves, reinicia el servidor, comprueba `/api/status`, revisa el catálogo, genera una combinada y compara cada línea/cuota con el proveedor. Comprueba también los seguimientos “cambia el segundo partido” y “quita el tenis” con el modelo real. La interpretación está implementada y cubierta por pruebas con respuestas controladas, pero su calidad con el servicio remoto requiere esta validación.

## Publicar con un enlace público

La opción preparada es un servicio **Node en Render**, con `render.yaml`, usando el mismo build y servidor revisados aquí. El archivo selecciona la rama `cuota-clara-demo`, el plan gratuito y `DEMO_MODE=true`. El despliegue público requiere conectar tu cuenta de GitHub con Render y confirmar la creación del servicio desde su panel.

1. Usa la rama `cuota-clara-demo` del repositorio `perexj361-design/apuestas-deportivas`, con el código y `render.yaml` en la raíz. Publicar el entorno de Codex no sube los archivos a GitHub.
2. En [Render](https://render.com), conecta ese repositorio y crea un **Blueprint**. Selecciona también `cuota-clara-demo` como rama del Blueprint para que pueda leer `render.yaml`. Puedes iniciar el flujo con [el enlace de creación del Blueprint](https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fperexj361-design%2Fapuestas-deportivas).
3. Revisa servicio web Node, plan Free, build `npm ci --include=dev && npm run build`, start `npm start` y ruta de salud `/health`. El archivo aplica `NODE_VERSION=24.19.0`, `NODE_ENV=production`, `TRUST_PROXY=1` y `DEMO_MODE=true`. Deja vacía la ruta raíz de servicio: los archivos están en la raíz del repositorio. Render proporciona `PORT`; no lo fijes ni uses Vite en producción.
4. No añadas `ODDS_API_KEY`, `AI_API_KEY` ni `OPENAI_API_KEY`, ni grupos de variables con esas claves. Revisa la configuración y pulsa Apply/Create para iniciar el despliegue. No necesitas contratar APIs para publicar esta demo.
5. Render asignará un enlace HTTPS de `onrender.com`. Abre ese enlace desde celular y computador, revisa la copia para compartir, el constructor y los estados de demo/real. Añade un dominio propio después si lo deseas.

El plan gratuito de hosting puede suspenderse por inactividad; comprueba las condiciones vigentes del proveedor. Los servicios de cuotas y de IA pueden tener costes aunque el acceso de los visitantes sea gratuito. No hace falta publicar procesos de Vite en producción.

El chat permanece desactivado en la demostración; el constructor, los filtros y la copia funcionan con datos ficticios. Si el panel muestra un plan de pago, no continúes con ese plan: selecciona Free o comprueba su disponibilidad en tu cuenta. Al estar desactivado el despliegue automático, futuras actualizaciones se publican con **Manual Deploy → Deploy latest commit** en Render. Para activar servicios reales en otra etapa, primero valida licencia y cobertura y después cambia `DEMO_MODE=false`, configura las claves y vuelve a desplegar.

## Reglas y límites implementados

- Solo eventos futuros; una selección de un partido iniciado se retira al consultar. La interfaz refresca propuestas y marca resultados antiguos vencidos.
- Una sola casa por combinada, un solo mercado por partido y ninguna selección repetida. Las combinadas del mismo partido se excluyen por completo mientras no haya soporte de cuota válida del proveedor.
- Cuota total = producto decimal de las selecciones, conservado con seis decimales; visualización de dos decimales. El margen se aplica al producto sin redondear.
- Todos los deportes seleccionados se representan en una mezcla. Todos los nombres de “incluir” deben aparecer en la propuesta. La fecha se compara en la zona del visitante; Chile usa `America/Santiago`.
- Si no hay coincidencia, las alternativas solo se salen del margen de cuota; mantienen los otros filtros. Una búsqueda acotada que no termine advierte que podría haber más opciones.
- Al reemplazar un partido se conservan los demás, se vuelven a buscar sus cuotas vigentes por identificador y se recalcula el producto. No se aceptan cuotas enviadas por el navegador.
- El respaldo describe únicamente los datos disponibles (evento, mercado, cuota y fuente), y declara la ausencia de estadísticas, forma, lesiones y alineaciones. No hay porcentajes de acierto inventados; la probabilidad implícita está identificada como una derivación de la cuota.
- Caché de cuotas de 60 segundos, catálogo deportivo de una hora y solicitudes simultáneas deduplicadas. Las propuestas se regeneran con el conjunto vigente al consultar, incluido el cambio de día; no se almacenan tarjetas de ayer como actuales.
- 60 consultas de API y 6 de chat por minuto/IP; presupuestos globales por hora y caché de interpretaciones IA de 60 segundos. Estos límites están en memoria: para varias réplicas o tráfico alto usa un almacén compartido (por ejemplo Redis) y cuotas del proveedor para un límite global efectivo.
- HTTPS con verificación de TLS, cabeceras de seguridad, límites de JSON y tiempos de espera. No se guardan conversaciones en una base de datos. Los mensajes enviados al chat conectado son tratados por OpenAI; informa a tus visitantes de ello en tu política de privacidad antes de publicar el chat real.

## Estructura

`src/` contiene la interfaz; `server/provider.js` adapta y cachea cuotas; `server/demo.js` contiene solo datos ficticios; `server/engine.js` calcula y valida combinadas; `server/chat.js` interpreta pedidos con OpenAI y usa el motor; `server/app.js` expone la API y sirve la web. Las pruebas del motor, proveedor, chat y API están junto a los módulos; las pruebas de navegador están en `tests/`.
