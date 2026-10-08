# Proveedor de partidos y cuotas: alcance verificado

Revisión del 8 de octubre de 2026. La aplicación incluye un **adaptador preparado para The Odds API**, como candidato para mercados principales. No se ha contratado ni validado una licencia para redistribución pública. No hay credencial disponible en este entorno; todos los datos que se pueden revisar ahora pertenecen a la demostración ficticia.

## Evidencia accesible

Se consultaron por HTTPS los ejemplos publicados en la organización oficial `the-odds-api`:

- [README de samples-python](https://github.com/the-odds-api/samples-python/blob/master/README.md): explica la API v4 y el catálogo de deportes en temporada.
- [odds.py](https://github.com/the-odds-api/samples-python/blob/master/odds.py): muestra `/v4/sports` y `/v4/sports/{sport}/odds`; documenta las regiones `uk`, `us`, `us2`, `eu`, `au`, las cuotas decimales, las fechas ISO y los mercados principales `h2h`, `spreads`, `totals`. También indica que el coste depende del número de mercados y regiones.
- [event_odds.py](https://github.com/the-odds-api/samples-python/blob/master/event_odds.py): muestra el catálogo de eventos y las cuotas por evento para mercados adicionales, con `basketball_nba` como ejemplo. Eso no confirma disponibilidad de córners.

Estas fuentes verifican el contrato básico del adaptador y un ejemplo de básquetbol. La cobertura concreta de fútbol, tenis, ligas y casas debe comprobarse con el catálogo y las respuestas de la cuenta real. El código no presenta una lista prefabricada de ligas reales como cobertura contratada.

## Documentación y condiciones pendientes

Las siguientes páginas oficiales se intentaron consultar con `curl`, con verificación TLS habilitada. Devolvieron HTTP 403 desde la conexión disponible, también en el intento permitido fuera del sandbox:

- [Guía v4](https://the-odds-api.com/liveapi/guides/v4/).
- [Mercados](https://the-odds-api.com/sports-odds-data/betting-markets.html).
- [Casas y regiones](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html).
- [Condiciones](https://the-odds-api.com/terms-and-conditions.html).
- [Deportes](https://the-odds-api.com/sports-odds-data/sports-apis.html).

Por ello **no se considera comprobada la cobertura de córners ni el permiso de mostrar cuotas en una web pública**. El catálogo real anuncia `coverage.corners: false`, excluye ese mercado y devuelve un error claro si alguien lo pide. Que la demostración incluya córners no cambia esta limitación. Antes de publicar datos reales, verificar las condiciones vigentes del plan, las obligaciones de atribución y redistribución, y ejemplos de respuesta de los mercados/casas deseados. Si se elige otro proveedor con acceso y permisos adecuados, sustituir el adaptador conservando su contrato.

## Comportamiento preparado

- Sin `ODDS_API_KEY`, participantes, ligas, casas, eventos y cuotas se marcan como ficticios. No existe una transición automática de un fallo real a resultados de demostración.
- Con una credencial configurada en el servidor, se consulta el catálogo activo de fútbol, tenis y básquetbol. Solo se ofrecen mercados principales y casas observados en respuestas válidas.
- El catálogo admite `leagues` y `bookmaker` para reflejar únicamente la oferta observada en esas competiciones. `supportedMarkets` identifica las capacidades documentadas del adaptador, separadas de `markets`, que representa cuotas efectivamente recibidas; conocer una capacidad no garantiza que haya un evento disponible con ese mercado.
- `ODDS_API_REGIONS` vale `eu` por defecto. `ODDS_API_BOOKMAKERS` puede restringir casas mediante claves del proveedor. `ODDS_API_SPORT_KEYS` puede limitar las competiciones que se cargan inicialmente. La presencia de una casa en un plan no confirma su disponibilidad legal para cada visitante.
- Sin selección de ligas, se cargan hasta cuatro competiciones representativas del catálogo activo. Una petición puede cargar hasta seis ligas. Se muestran las demás ligas del catálogo para que el visitante consulte su oferta bajo demanda.
- Cuotas con caché de 60 segundos, catálogo de deportes de una hora, deduplicación de peticiones concurrentes y timeout de diez segundos. Se excluyen cuotas cuya marca de actualización supere 15 minutos (`ODDS_MAX_AGE_MINUTES`). Cada consulta reevalúa el comienzo de los partidos y regenera las propuestas con las cuotas recibidas; la consulta no garantiza la disponibilidad de una cuota en la casa.
- El límite global de `ODDS_MAX_REQUESTS_PER_HOUR` vale 100 llamadas por hora por instancia e incluye intentos fallidos. Elegir una casa en la web filtra las cuotas guardadas, sin crear una variante de consulta pagada por cada visitante. Las llamadas pueden consumir varios créditos por mercado; este límite no reemplaza el presupuesto y alarmas del plan contratado.
- Se descartan eventos comenzados, precios inválidos, mercados desconocidos y líneas numéricas ausentes. Las explicaciones solo indican datos observados de cuota, mercado y horario; no incluyen estadísticas, lesiones ni probabilidades inventadas.
- Límites por dirección IP: 60 peticiones API y 6 peticiones de chat por minuto. El límite en memoria corresponde a una instancia; despliegues con múltiples instancias necesitan un almacén compartido. La credencial y las URLs autenticadas no se devuelven al navegador ni se incluyen en errores públicos.

El proveedor de IA tiene su propio servicio y credencial, independientes de las cuotas. Su disponibilidad no resuelve la cobertura ni el permiso de redistribuir datos deportivos.
