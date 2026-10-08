import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, flattenOdds, ProviderError } from './provider.js';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const league = { key: 'soccer_spain_la_liga', title: 'La Liga', active: true, has_outrights: false };
function event(overrides = {}) {
  return {
    id: 'event-1', sport_key: league.key, sport_title: league.title,
    commence_time: '2026-10-08T18:00:00.000Z', home_team: 'Equipo A', away_team: 'Equipo B',
    bookmakers: [{ key: 'book_a', title: 'Casa A', last_update: '2026-10-08T11:59:00.000Z', markets: [
      { key: 'h2h', outcomes: [{ name: 'Equipo A', price: 1.25 }, { name: 'Draw', price: 3.5 }] },
      { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.8 }, { name: 'Under', price: 1.9 }] },
      { key: 'spreads', outcomes: [{ name: 'Equipo A', point: -1.5, price: 2.4 }] },
      { key: 'corners', outcomes: [{ name: 'Over', point: 8.5, price: 1.75 }] },
    ] }], ...overrides,
  };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status,
  headers: new Headers({ 'x-requests-remaining': '99', 'x-requests-used': '1', 'x-requests-last': '3' }),
  json: async () => body,
});

test('demo usa participantes ficticios, 3 deportes y casas distintas claramente marcadas', async () => {
  const provider = createProvider({ env: {}, now: () => NOW, fetchImpl: () => { throw Error('No debe consultar internet'); } });
  const catalog = await provider.getCatalog();
  const selections = await provider.getSelections();
  assert.equal(catalog.mode, 'demo');
  assert.equal(new Set(selections.map(item => item.sport)).size, 3);
  assert.ok(new Set(selections.map(item => item.eventId)).size >= 12);
  assert.ok(selections.every(item => item.demo && item.source.includes('ficticia') && item.bookmakerName.includes('ficticia')));
  assert.ok(selections.every(item => Date.parse(item.startsAt) > NOW && item.line !== undefined && item.missing.length));
  const corners = await provider.getSelections({ markets: ['corners'], bookmaker: 'demo_norte' });
  assert.ok(corners.length && corners.every(item => item.market === 'corners' && item.bookmakerKey === 'demo_norte'));
});

test('adapter conserva líneas/precios reales y excluye eventos iniciados, líneas ausentes y mercados sin cobertura', () => {
  const rows = flattenOdds([event(), event({ id: 'past', commence_time: '2026-10-08T11:00:00Z' })], { now: NOW });
  assert.equal(rows.length, 4);
  assert.equal(rows.find(item => item.market === 'totals').line, 2.5);
  assert.equal(rows.find(item => item.market === 'totals').outcome, 'Más de');
  assert.equal(rows.find(item => item.market === 'spreads').line, -1.5);
  assert.ok(rows.every(item => !item.demo && item.eventId === 'event-1' && item.market !== 'corners'));
  assert.ok(rows.every(item => item.missing.some(text => text.includes('lesiones'))));
});

test('catálogo live procede de respuestas y caché comparte consulta entre mercados y casas del visitante', async () => {
  const calls = [];
  let clock = NOW;
  const provider = createProvider({ env: { ODDS_API_KEY: 'fake-test-secret' }, now: () => clock, fetchImpl: async url => {
    const parsed = new URL(url); calls.push(parsed);
    return response(parsed.pathname.endsWith('/sports') ? [league, { key: 'cricket', title: 'Cricket' }] : [event()]);
  } });
  const catalog = await provider.getCatalog();
  assert.deepEqual(catalog.sports, [{ key: 'football', name: 'Fútbol' }]);
  assert.deepEqual(catalog.bookmakers, [{ key: 'book_a', name: 'Casa A' }]);
  assert.equal(catalog.coverage.corners, false);
  assert.ok(!catalog.markets.some(item => item.key === 'corners'));
  const first = await provider.getSelections({ leagues: [league.key], markets: ['totals'], bookmaker: 'book_a' });
  const second = await provider.getSelections({ leagues: [league.key], markets: ['h2h'], bookmaker: 'book_b' });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('bookmakers'), null);
  assert.equal(calls[1].searchParams.get('regions'), 'eu');
  assert.equal(calls[1].searchParams.get('oddsFormat'), 'decimal');
  assert.equal(calls[1].searchParams.get('markets'), 'h2h,totals,spreads');
  clock += 61_000;
  await provider.getSelections();
  assert.equal(calls.length, 3);
});

test('concurrent requests comparten un solo fetch y catálogo deportivo se cachea una hora', async () => {
  let calls = 0;
  const provider = createProvider({ env: { ODDS_API_KEY: 'test' }, now: () => NOW, fetchImpl: async url => {
    calls++; await new Promise(resolve => setTimeout(resolve, 5));
    return response(new URL(url).pathname.endsWith('/sports') ? [league] : [event()]);
  } });
  const result = await Promise.all([provider.getSelections(), provider.getSelections(), provider.getSelections()]);
  assert.equal(calls, 2);
  assert.equal(result[0].length, 4);
});

test('credencial inválida falla sin fallback demo ni exponer URL o secreto', async () => {
  const secret = 'never-print-this-secret';
  const provider = createProvider({ env: { ODDS_API_KEY: secret }, now: () => NOW, fetchImpl: async () => response({ secret }, 401) });
  await assert.rejects(provider.getSelections(), error => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, 'PROVIDER_AUTH');
    assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(provider.getStatus().mode, 'live');
  assert.ok(!JSON.stringify(provider.getStatus()).includes(secret));
});

test('rechaza mercados sin cobertura y ligas inexistentes antes de consultar sus cuotas', async () => {
  let calls = 0;
  const provider = createProvider({ env: { ODDS_API_KEY: 'test' }, now: () => NOW, fetchImpl: async () => { calls++; return response([league]); } });
  await assert.rejects(provider.getSelections({ markets: ['corners'] }), { code: 'MARKET_UNAVAILABLE' });
  assert.equal(calls, 0);
  await assert.rejects(provider.getSelections({ leagues: ['invented'] }), { code: 'LEAGUE_UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('cuotas antiguas no se usan; falta de eventos se diferencia de un error de proveedor', async () => {
  const stale = event();
  stale.bookmakers[0].last_update = '2026-10-08T10:00:00Z';
  assert.equal(flattenOdds([stale], { now: NOW }).length, 0);
  const provider = createProvider({ env: { ODDS_API_KEY: 'test' }, now: () => NOW, fetchImpl: async url =>
    response(new URL(url).pathname.endsWith('/sports') ? [league] : [stale]) });
  await assert.rejects(provider.getSelections(), { code: 'STALE_ODDS' });
  const empty = createProvider({ env: { ODDS_API_KEY: 'test' }, now: () => NOW, fetchImpl: async url =>
    response(new URL(url).pathname.endsWith('/sports') ? [league] : []) });
  assert.deepEqual(await empty.getSelections(), []);
});

test('un presupuesto global limita llamadas reales incluso cuando cambian ligas', async () => {
  let calls = 0;
  const provider = createProvider({ env: { ODDS_API_KEY: 'test', ODDS_MAX_REQUESTS_PER_HOUR: '1' }, now: () => NOW,
    fetchImpl: async () => { calls++; return response([league]); } });
  await assert.rejects(provider.getSelections(), { code: 'PROVIDER_BUDGET' });
  assert.equal(calls, 1);
  assert.equal(provider.getStatus().provider.hourlyRequestsUsed, 1);
});

test('errores de red y timeout no filtran credenciales; formatos inválidos fallan explícitamente', async () => {
  const provider = createProvider({ env: { ODDS_API_KEY: 'hidden' }, now: () => NOW,
    fetchImpl: async url => { throw Error(`URL ${url}`); } });
  await assert.rejects(provider.getSelections(), error => error.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('hidden'));
  const timed = createProvider({ env: { ODDS_API_KEY: 'hidden' }, now: () => NOW,
    fetchImpl: async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; } });
  await assert.rejects(timed.getSelections(), { code: 'PROVIDER_TIMEOUT' });
  assert.throws(() => flattenOdds({}), { code: 'INVALID_RESPONSE' });
});

test('una selección almacenada nunca vuelve a mostrarse después de comenzar el evento', async () => {
  let clock = NOW;
  const starts = new Date(NOW + 30_000).toISOString();
  const provider = createProvider({ env: { ODDS_API_KEY: 'test' }, now: () => clock,
    fetchImpl: async url => response(new URL(url).pathname.endsWith('/sports') ? [league] : [event({ commence_time: starts })]) });
  assert.equal((await provider.getSelections()).length, 4);
  clock += 31_000;
  assert.equal((await provider.getSelections()).length, 0);
});

test('catálogo por liga distingue oferta real y capacidades core sin mercados fantasma', async () => {
  const chile = { key: 'soccer_chile_campeonato', title: 'Campeonato Chile', active: true };
  const calls = [];
  const a = event({ bookmakers: [{ key: 'book_a', title: 'Casa A', last_update: '2026-10-08T11:59:00Z',
    markets: [{ key: 'h2h', outcomes: [{ name: 'Equipo A', price: 1.25 }] }] }] });
  const b = event({ id: 'chile-event', sport_key: chile.key, sport_title: chile.title,
    bookmakers: [{ key: 'book_b', title: 'Casa B', last_update: '2026-10-08T11:59:00Z',
      markets: [{ key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.8 }] }] }] });
  const provider = createProvider({ env: { ODDS_API_KEY: 'test' }, now: () => NOW, fetchImpl: async url => {
    const parsed = new URL(url); calls.push(parsed.pathname);
    return response(parsed.pathname.endsWith('/sports') ? [league, chile]
      : parsed.pathname.includes(chile.key) ? [b] : [a]);
  } });
  const base = await provider.getCatalog();
  assert.deepEqual(base.markets.map(item => item.key), ['h2h']);
  assert.ok(base.leagues.some(item => item.key === chile.key));
  assert.deepEqual(base.supportedMarkets.map(item => item.key), ['h2h', 'totals', 'spreads']);
  const scoped = await provider.getCatalog({ leagues: [chile.key], bookmaker: 'book_b' });
  assert.deepEqual(scoped.markets.map(item => item.key), ['totals']);
  assert.deepEqual(scoped.bookmakers, [{ key: 'book_b', name: 'Casa B' }]);
  assert.equal(scoped.leagues.length, 2);
  assert.ok(!scoped.markets.some(item => item.key === 'h2h' || item.key === 'corners'));
  assert.ok(!scoped.supportedMarkets.some(item => item.key === 'corners'));
  await provider.getCatalog({ leagues: [chile.key] });
  assert.equal(calls.length, 3);
});

test('catálogo demo por liga tenis no ofrece córners aunque siguen como capacidad ficticia', async () => {
  const provider = createProvider({ env: {}, now: () => NOW });
  const scoped = await provider.getCatalog({ leagues: ['demo_tennis'], bookmaker: 'demo_norte' });
  assert.ok(scoped.markets.every(item => item.sports.length === 1 && item.sports[0] === 'tennis'));
  assert.ok(!scoped.markets.some(item => item.key === 'corners'));
  assert.ok(scoped.supportedMarkets.some(item => item.key === 'corners'));
  assert.deepEqual(scoped.bookmakers.map(item => item.key), ['demo_norte']);
});

test('DEMO_MODE=true impide llamadas al proveedor incluso si hay una clave heredada', async () => {
  const provider = createProvider({ env: { DEMO_MODE: 'true', ODDS_API_KEY: 'test-only-not-a-real-key' },
    fetchImpl: async () => { assert.fail('La demostración no puede consultar una API de pago.'); } });
  assert.equal(provider.getStatus().mode, 'demo');
  assert.equal(provider.getStatus().provider.configured, false);
  assert.equal((await provider.getCatalog()).mode, 'demo');
  assert.ok((await provider.getSelections()).every(leg => leg.demo));
});
