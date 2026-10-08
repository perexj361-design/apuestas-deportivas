import { demoCatalog, demoSelections } from './demo.js';

const BASE_URL = 'https://api.the-odds-api.com/v4';
const CORE_MARKETS = ['h2h', 'totals', 'spreads'];
const MARKET_LABELS = { h2h: 'Ganador del partido', totals: 'Total', spreads: 'Hándicap' };
const SPORT_NAMES = { football: 'Fútbol', tennis: 'Tenis', basketball: 'Básquetbol' };
const DEFAULT_PREFERENCES = ['soccer_spain_la_liga', 'soccer_epl', 'basketball_nba'];
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const sportOf = key => key.startsWith('soccer_') ? 'football' : key.startsWith('tennis_') ? 'tennis' : key.startsWith('basketball_') ? 'basketball' : null;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const list = value => Array.isArray(value) ? value.filter(Boolean) : typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];

export class ProviderError extends Error {
  constructor(message, code = 'PROVIDER_ERROR', status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export function flattenOdds(events, { now = Date.now(), maxAgeMs = 15 * 60_000 } = {}) {
  if (!Array.isArray(events)) throw new ProviderError('El proveedor devolvió un formato de eventos inválido.', 'INVALID_RESPONSE');
  const selections = [];
  for (const event of events) {
    if (!isObject(event) || typeof event.id !== 'string' || typeof event.sport_key !== 'string'
      || !sportOf(event.sport_key) || !validDate(event.commence_time)
      || typeof event.home_team !== 'string' || typeof event.away_team !== 'string') continue;
    if (Date.parse(event.commence_time) <= now) continue;
    for (const book of Array.isArray(event.bookmakers) ? event.bookmakers : []) {
      if (!isObject(book) || typeof book.key !== 'string' || typeof book.title !== 'string') continue;
      for (const market of Array.isArray(book.markets) ? book.markets : []) {
        if (!isObject(market) || !CORE_MARKETS.includes(market.key)) continue;
        const updatedAt = market.last_update || book.last_update;
        if (!validDate(updatedAt) || Date.parse(updatedAt) > now + 60_000 || now - Date.parse(updatedAt) > maxAgeMs) continue;
        for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
          if (!isObject(outcome) || typeof outcome.name !== 'string' || typeof outcome.price !== 'number'
            || !Number.isFinite(outcome.price) || outcome.price <= 1) continue;
          if (market.key !== 'h2h' && (typeof outcome.point !== 'number' || !Number.isFinite(outcome.point))) continue;
          const line = market.key === 'h2h' ? null : outcome.point;
          const translated = { Over: 'Más de', Under: 'Menos de', Draw: 'Empate' }[outcome.name] || outcome.name;
          const label = market.key === 'totals'
            ? sportOf(event.sport_key) === 'tennis' ? 'Total (mercado del proveedor)' : `Total de ${sportOf(event.sport_key) === 'football' ? 'goles' : 'puntos'}`
            : MARKET_LABELS[market.key];
          selections.push({
            id: `${event.id}:${book.key}:${market.key}:${outcome.name}:${line ?? ''}`,
            eventId: event.id, sport: sportOf(event.sport_key), leagueKey: event.sport_key,
            league: typeof event.sport_title === 'string' ? event.sport_title : event.sport_key,
            home: event.home_team, away: event.away_team, startsAt: event.commence_time,
            market: market.key, marketLabel: label, line, outcome: translated, odds: outcome.price,
            bookmakerKey: book.key, bookmakerName: book.title, updatedAt,
            source: 'The Odds API', demo: false,
            evidence: [
              `Cuota decimal ${outcome.price.toFixed(2)} y mercado ${label.toLowerCase()} informados por ${book.title} mediante The Odds API.`,
              'El evento figura programado para una hora posterior a esta consulta.',
            ],
            missing: [
              'No se han consultado estadísticas, forma reciente, lesiones ni alineaciones.',
              'La respuesta no especifica las reglas de liquidación ni los periodos incluidos; compruébalos en la casa.',
              ...(sportOf(event.sport_key) === 'tennis' && market.key !== 'h2h' ? ['La respuesta no identifica la unidad del total o hándicap de tenis; no se presupone que sean juegos o sets.'] : []),
              'La cuota puede variar y debe confirmarse en la casa antes de apostar.',
            ],
          });
        }
      }
    }
  }
  return selections;
}

export function createProvider({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10_000 } = {}) {
  const apiKey = env.DEMO_MODE === 'true' ? undefined : env.ODDS_API_KEY?.trim();
  const mode = apiKey ? 'live' : 'demo';
  const regions = env.ODDS_API_REGIONS?.trim() || 'eu';
  const configuredBooks = list(env.ODDS_API_BOOKMAKERS);
  const configuredLeagues = list(env.ODDS_API_SPORT_KEYS);
  const positiveConfig = (value, fallback, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
  };
  const maxAgeMinutes = positiveConfig(env.ODDS_MAX_AGE_MINUTES, 15, 1440);
  const maxAgeMs = maxAgeMinutes * 60_000;
  const maxRequestsPerHour = Math.floor(positiveConfig(env.ODDS_MAX_REQUESTS_PER_HOUR, 100, 10_000));
  let budget = { hour: Math.floor(now() / 3_600_000), used: 0 };
  const cache = new Map();
  const pending = new Map();
  let usage = { remaining: null, used: null, lastCost: null };
  let observed = [];
  let lastError = null;
  let lastSuccessAt = null;

  async function request(path, query = {}) {
    const hour = Math.floor(now() / 3_600_000);
    if (budget.hour !== hour) budget = { hour, used: 0 };
    if (budget.used >= maxRequestsPerHour) throw new ProviderError('Se alcanzó el presupuesto horario de consultas deportivas. Intenta en la siguiente hora.', 'PROVIDER_BUDGET', 503);
    budget.used += 1;
    const url = new URL(`${BASE_URL}/${path}`);
    url.searchParams.set('apiKey', apiKey);
    for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new ProviderError('El proveedor no autorizó la consulta. Revisa la credencial y el plan en el servidor.', 'PROVIDER_AUTH', 503);
        if (response.status === 429) throw new ProviderError('Se agotó la cuota del proveedor o su límite temporal. Intenta más tarde.', 'PROVIDER_QUOTA', 503);
        if (response.status === 404 || response.status === 422) throw new ProviderError('El proveedor no ofrece la competición o mercado solicitado.', 'MARKET_UNAVAILABLE', 422);
        throw new ProviderError('El proveedor de cuotas no está disponible temporalmente.', 'PROVIDER_UNAVAILABLE', 503);
      }
      const data = await response.json();
      const count = key => {
        const value = response.headers?.get(key);
        return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
      };
      usage = { remaining: count('x-requests-remaining'), used: count('x-requests-used'), lastCost: count('x-requests-last') };
      lastSuccessAt = new Date(now()).toISOString();
      lastError = null;
      return data;
    } catch (error) {
      const safe = error instanceof ProviderError ? error : new ProviderError(
        error?.name === 'AbortError' ? 'El proveedor tardó demasiado en responder.' : 'No fue posible consultar el proveedor de cuotas. Intenta más tarde.',
        error?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', 503,
      );
      lastError = { code: safe.code, message: safe.message };
      throw safe;
    } finally { clearTimeout(timer); }
  }

  async function cached(key, ttl, load, refresh = false) {
    const existing = cache.get(key);
    if (!refresh && existing && now() - existing.at < ttl) return existing.value;
    if (pending.has(key)) return pending.get(key);
    const promise = load().then(value => { cache.set(key, { at: now(), value }); return value; });
    pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  }

  async function sports() {
    return cached('sports', 3_600_000, async () => {
      const raw = await request('sports');
      if (!Array.isArray(raw)) throw new ProviderError('El proveedor devolvió un catálogo inválido.', 'INVALID_RESPONSE');
      return raw.filter(item => isObject(item) && typeof item.key === 'string' && sportOf(item.key)
        && typeof item.title === 'string' && item.active !== false && item.has_outrights !== true);
    });
  }

  function defaults(available) {
    if (configuredLeagues.length) return configuredLeagues;
    const chosen = DEFAULT_PREFERENCES.filter(key => available.some(item => item.key === key));
    for (const sport of Object.keys(SPORT_NAMES)) {
      if (!chosen.some(key => sportOf(key) === sport)) {
        const candidate = available.find(item => sportOf(item.key) === sport);
        if (candidate) chosen.push(candidate.key);
      }
    }
    return chosen.slice(0, 4);
  }

  async function getSelections({ refresh = false, leagues, bookmaker, markets } = {}) {
    const leagueList = list(leagues);
    const marketList = list(markets);
    const bookmakerList = list(bookmaker);
    if (mode === 'demo') {
      const catalog = demoCatalog(now());
      if (marketList.some(key => !catalog.markets.some(item => item.key === key))) throw new ProviderError('Ese mercado no está disponible en la demostración.', 'MARKET_UNAVAILABLE', 422);
      if (leagueList.some(key => !catalog.leagues.some(item => item.key === key))) throw new ProviderError('Esa liga no está disponible en la demostración.', 'LEAGUE_UNAVAILABLE', 422);
      if (bookmakerList.some(key => !catalog.bookmakers.some(item => item.key === key))) throw new ProviderError('Esa casa no está disponible en la demostración.', 'BOOKMAKER_UNAVAILABLE', 422);
      return demoSelections(now()).filter(item => (!leagueList.length || leagueList.includes(item.leagueKey))
        && (!marketList.length || marketList.includes(item.market)) && (!bookmakerList.length || bookmakerList.includes(item.bookmakerKey))
        && Date.parse(item.startsAt) > now());
    }
    if (marketList.some(key => !CORE_MARKETS.includes(key))) throw new ProviderError('No hay cobertura verificada para ese mercado en esta conexión. Los córners requieren un proveedor o acceso adicional confirmado.', 'MARKET_UNAVAILABLE', 422);
    if (bookmakerList.length > 1) throw new ProviderError('Elige una sola casa para cada combinada.', 'INVALID_FILTERS', 422);
    if (bookmakerList.some(key => !/^[a-z0-9_]+$/.test(key))) throw new ProviderError('La casa solicitada no es válida.', 'INVALID_FILTERS', 422);
    if (configuredBooks.length && bookmakerList.some(key => !configuredBooks.includes(key))) throw new ProviderError('La casa solicitada no está habilitada en el servidor.', 'BOOKMAKER_UNAVAILABLE', 422);
    const available = await sports();
    const chosenLeagues = leagueList.length ? leagueList : defaults(available);
    if (chosenLeagues.length > 6) throw new ProviderError('Consulta hasta 6 competiciones a la vez para controlar el consumo del proveedor.', 'TOO_MANY_LEAGUES', 422);
    if (chosenLeagues.some(key => !available.some(item => item.key === key))) throw new ProviderError('La competición solicitada no está activa en el proveedor conectado.', 'LEAGUE_UNAVAILABLE', 422);
    // The visitor's bookmaker filter never creates a new paid provider request variant.
    const requestedBooks = configuredBooks.join(',');
    const result = [];
    // Sequential requests keep provider load bounded. Each response includes all verified core markets.
    for (const league of chosenLeagues) {
      const key = `odds:${league}:${requestedBooks || regions}`;
      const rows = await cached(key, 60_000, async () => {
        const raw = await request(`sports/${encodeURIComponent(league)}/odds`, {
          ...(requestedBooks ? { bookmakers: requestedBooks } : { regions }),
          markets: CORE_MARKETS.join(','), oddsFormat: 'decimal', dateFormat: 'iso',
        });
        const flattened = flattenOdds(raw, { now: now(), maxAgeMs });
        const stale = Array.isArray(raw) && raw.some(event => validDate(event.commence_time) && Date.parse(event.commence_time) > now()
          && Array.isArray(event.bookmakers) && event.bookmakers.some(book => Array.isArray(book.markets)
            && book.markets.some(market => CORE_MARKETS.includes(market.key) && validDate(market.last_update || book.last_update)
              && now() - Date.parse(market.last_update || book.last_update) > maxAgeMs)));
        if (!flattened.length && stale) throw new ProviderError(`El proveedor solo devolvió cuotas con más de ${maxAgeMinutes} minutos de antigüedad. No se presentan como vigentes.`, 'STALE_ODDS', 503);
        return flattened;
      }, refresh);
      result.push(...rows);
    }
    observed = [...new Map([...observed, ...result].map(item => [item.id, item])).values()]
      .filter(item => Date.parse(item.startsAt) > now() && now() - Date.parse(item.updatedAt) <= maxAgeMs);
    return result.filter(item => Date.parse(item.startsAt) > now() && now() - Date.parse(item.updatedAt) <= maxAgeMs
      && (!marketList.length || marketList.includes(item.market)) && (!bookmakerList.length || bookmakerList.includes(item.bookmakerKey)));
  }

  async function getCatalog({ leagues, bookmaker } = {}) {
    const scoped = list(leagues).length > 0 || list(bookmaker).length > 0;
    if (mode === 'demo') {
      const catalog = demoCatalog(now());
      if (!scoped) return { ...catalog, supportedMarkets: catalog.markets };
      const rows = await getSelections({ leagues, bookmaker });
      return {
        ...catalog,
        supportedMarkets: catalog.markets,
        markets: catalog.markets.filter(market => rows.some(item => item.market === market.key)).map(market => ({
          ...market, sports: [...new Set(rows.filter(item => item.market === market.key).map(item => item.sport))],
        })),
        bookmakers: catalog.bookmakers.filter(book => rows.some(item => item.bookmakerKey === book.key)),
      };
    }
    const available = await sports();
    const scopedRows = await getSelections({ leagues, bookmaker });
    const current = (scoped ? scopedRows : observed).filter(item => Date.parse(item.startsAt) > now() && now() - Date.parse(item.updatedAt) <= maxAgeMs);
    const marketKeys = [...new Set(current.map(item => item.market))];
    const books = [...new Map(current.map(item => [item.bookmakerKey, { key: item.bookmakerKey, name: item.bookmakerName }])).values()];
    return {
      mode,
      sports: Object.entries(SPORT_NAMES).filter(([key]) => available.some(item => sportOf(item.key) === key)).map(([key, name]) => ({ key, name })),
      leagues: available.map(item => ({ key: item.key, name: item.title, sport: sportOf(item.key) })),
      supportedMarkets: CORE_MARKETS.map(key => ({ key, name: MARKET_LABELS[key] })),
      markets: marketKeys.map(key => ({ key, name: MARKET_LABELS[key], sports: [...new Set(current.filter(item => item.market === key).map(item => item.sport))] })),
      bookmakers: books,
      coverage: { corners: false, notes: [
        'Córners: cobertura no confirmada; esta conexión no solicita ni ofrece ese mercado.',
        'Las casas y mercados mostrados proceden de cuotas recibidas, no de una lista promocional.',
        'La disponibilidad varía por competición, región, casa y plan contratado. Las ligas corresponden al catálogo activo del proveedor.',
        'Sin ligas elegidas se cargan hasta 4 competiciones representativas; selecciona otras ligas para consultar su oferta.',
        'Antes de publicar datos reales, confirma por escrito las condiciones de redistribución y atribución aplicables a tu plan.',
      ] },
      updatedAt: lastSuccessAt || new Date(now()).toISOString(),
    };
  }

  function getStatus() {
    return {
      mode,
      provider: { name: mode === 'demo' ? 'Demostración ficticia' : 'The Odds API · mercados principales', configured: Boolean(apiKey),
        cacheTtlSeconds: 60, maxAgeMinutes, maxRequestsPerHour,
        hourlyRequestsUsed: budget.hour === Math.floor(now() / 3_600_000) ? budget.used : 0,
        regions, cornersVerified: false, usage, lastSuccessAt, lastError },
      updatedAt: new Date(now()).toISOString(),
    };
  }
  return { getCatalog, getSelections, getStatus };
}

export const defaultProvider = createProvider();
export const getCatalog = (...args) => defaultProvider.getCatalog(...args);
export const getSelections = (...args) => defaultProvider.getSelections(...args);
export const getStatus = (...args) => defaultProvider.getStatus(...args);
