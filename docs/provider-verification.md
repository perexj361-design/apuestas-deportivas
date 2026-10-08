# Verificación de proveedores de cuotas

Fecha de revisión: 8 de octubre de 2026. Esta revisión registra evidencia consultada; no certifica un contrato comercial ni cuotas actuales.

## Estado de la conexión preparada

The Odds API es un candidato técnico para el conector de esta primera versión. Su acceso real requiere una clave de servidor, un plan con cobertura adecuada y confirmar que ese plan autoriza mostrar las cuotas a los visitantes de esta web. La demostración no depende de una cuenta del proveedor. Ningún ejemplo ficticio constituye una cuota verificada o una recomendación actual.

No se ha verificado en esta sesión cobertura de córners, de casas concretas para Chile ni autorización contractual de publicación pública. No se deben anunciar esas capacidades como disponibles al activar una clave. La lista visible de deportes, competiciones, casas y mercados debe derivarse de las respuestas reales del proveedor, y la aplicación debe rechazar un mercado ausente.

## Evidencia oficial consultada

| Fuente | Evidencia | Límite de la evidencia |
| --- | --- | --- |
| [The Odds API: muestras oficiales Node.js](https://github.com/the-odds-api/samples-nodejs/blob/51a499a56f4c03a36653a11394583fbba86ccf6e/sample-v4.js) | API v4: `GET /sports` y `GET /sports/{sport}/odds`; cuotas `decimal`; mercados de ejemplo `h2h`, `spreads`, `totals`; regiones `us`, `uk`, `eu`, `au`. Los eventos pueden incluir partidos en curso; el consumidor debe filtrarlos. | Esta muestra no enumera todos los deportes, casas ni mercados adicionales. No demuestra soporte de córners ni condiciones de redistribución. |
| [README oficial de The Odds API](https://github.com/the-odds-api/samples-nodejs/blob/51a499a56f4c03a36653a11394583fbba86ccf6e/README.md) | Confirma la autenticación con una clave y enlaza la documentación v4. | Una muestra de integración no es una licencia de datos. |
| [SportsGameOdds: SDK oficial](https://github.com/SportsGameOdds/sports-odds-api-typescript/blob/f02bb44d5fae2ee9677892589dc43c148cb42b51/README.md) | El proveedor declara EPL, UCL, ATP y NBA entre sus ligas, mercados de ganador, hándicap y totales, y más de 80 casas. | Son declaraciones de cobertura del proveedor; no verifican partidos actuales ni acceso de un plan particular. No confirma córners. |
| [SportsGameOdds: catálogo de mercados](https://github.com/SportsGameOdds/sports-odds-api-typescript/blob/f02bb44d5fae2ee9677892589dc43c148cb42b51/src/resources/markets.ts) | `GET /markets/` devuelve identificadores, `isSupported`, `activeEvents` y `support` por liga/casa; admite filtros `sportID`, `leagueID`, `bookmakerID` y `statID`. | El esquema explica cómo comprobar cobertura, pero no trae una respuesta autenticada que demuestre córners o una casa concreta. |
| [SportsGameOdds: ejemplos públicos](https://github.com/SportsGameOdds/odds-comparison-dashboard/blob/b8b398111689f79e7c6dce7fd72ad27f5c2d180d/README.md) | Publica un ejemplo de dashboard con cuotas, claves en servidor, caché y despliegue a Vercel. | La intención de uso en dashboards públicos no sustituye las condiciones comerciales del plan contratado. La licencia MIT/Apache del código no concede derechos sobre los datos. |

## Comprobaciones que quedaron pendientes

Las solicitudes HTTPS a `the-odds-api.com`, `api.the-odds-api.com`, `sportsgameodds.com` y `docs.odds-api.io` fueron bloqueadas por el proxy del entorno con `CONNECT 403`. Los repositorios oficiales anteriores sí fueron accesibles por GitHub. No se desactivó TLS, no se eludió autenticación y no se enviaron claves durante la investigación.

Antes de publicar datos reales:

1. Leer las condiciones vigentes del candidato y comprobar permiso de exposición pública, caché, atribución y restricciones del plan. Si el plan no autoriza este uso, elegir otro proveedor.
2. Consultar el catálogo real con la cuenta elegida y comprobar fútbol, tenis y básquetbol, las competiciones solicitadas y las casas que se mostrarán.
3. Verificar explícitamente córners: mercado exacto, periodo, línea, selecciones, casa, competiciones y eventos con cuota disponible. Si no existe esa respuesta, mantener córners indisponible en modo real y comunicarlo.
4. Probar eventos próximos y una respuesta real de cuotas: fechas, cuotas decimales válidas, fuente y actualización; rechazar eventos iniciados y cotizaciones vencidas.
5. Verificar el funcionamiento con ausencia de eventos, mercados ausentes, cuota objetivo inalcanzable y fallos/autenticación/cuota agotada del proveedor. No sustituir un fallo real por una demostración sin avisarlo.

La conexión preparada debe considerarse provisional hasta completar esas comprobaciones. La demostración puede publicarse para revisión manteniendo visibles las etiquetas de datos ficticios.
