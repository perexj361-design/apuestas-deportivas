import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { createProvider, ProviderError } from './provider.js';

async function withApp(t, options = {}) {
  const app = createApp({ provider: createProvider({ env: {} }), rateLimits: false, serveStatic: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}

test('API demo sirve catálogo y propuestas futuras con mercados y cuotas multiplicadas', async t => {
  const request = await withApp(t);
  const catalog = await request('/api/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.mode, 'demo');
  const daily = await request('/api/parlays/daily');
  assert.equal(daily.status, 200);
  assert.ok(daily.body.proposals.length);
  for (const parlay of daily.body.proposals) {
    assert.ok(parlay.demo);
    assert.equal(new Set(parlay.legs.map(leg => leg.bookmakerKey)).size, 1);
    assert.equal(new Set(parlay.legs.map(leg => leg.eventId)).size, parlay.legs.length);
    assert.ok(Math.abs(parlay.totalOdds - parlay.legs.reduce((total, leg) => total * leg.odds, 1)) < 0.000001);
    assert.ok(parlay.legs.every(leg => Date.parse(leg.startsAt) > Date.now()));
  }
  assert.equal(daily.headers.get('cache-control'), 'no-store');
});

test('filtros HTTP de deporte, mercado, casa y cuota total se respetan', async t => {
  const request = await withApp(t);
  const result = await request('/api/parlays/daily?sports=football&markets=corners&bookmaker=demo_sur&minOdds=1.8&maxOdds=3.5');
  assert.equal(result.status, 200);
  assert.ok(result.body.proposals.length);
  assert.ok(result.body.proposals.every(parlay => parlay.totalOdds >= 1.8 && parlay.totalOdds <= 3.5
    && parlay.legs.every(leg => leg.sport === 'football' && leg.market === 'corners' && leg.bookmakerKey === 'demo_sur')));
  const impossible = await request('/api/parlays/build', { filters: { legCount: 3, targetOdds: 999, tolerance: 0, sports: ['football'] } });
  assert.equal(impossible.status, 200);
  assert.equal(impossible.body.status, 'no_match');
  assert.equal(impossible.body.parlay, null);
  assert.ok(impossible.body.alternatives.length);
  const scoped = await request('/api/catalog?leagues=demo_tennis&bookmaker=demo_norte');
  assert.equal(scoped.status, 200);
  assert.ok(scoped.body.markets.every(item => item.key !== 'corners'));
  assert.deepEqual(scoped.body.bookmakers.map(item => item.key), ['demo_norte']);
});

test('faltan eventos o mercado devuelve estados distintos, nunca datos fabricados de fallback', async t => {
  const base = createProvider({ env: {} });
  const noEvents = await withApp(t, { provider: { ...base, getSelections: async () => [] } });
  const empty = await noEvents('/api/parlays/build', { filters: { legCount: 2, targetOdds: 2 } });
  assert.equal(empty.body.status, 'empty');
  assert.equal(empty.body.parlay, null);
  const unsupported = await noEvents('/api/parlays/daily?markets=cards');
  // A deliberately injected empty provider cannot validate market coverage; production demo does.
  assert.equal(unsupported.body.proposals.length, 0);
  const realDemo = await withApp(t);
  const missingMarket = await realDemo('/api/parlays/daily?markets=cards');
  assert.equal(missingMarket.status, 422);
  assert.equal(missingMarket.body.code, 'MARKET_UNAVAILABLE');
  const failed = await withApp(t, { provider: { ...base, getStatus: () => ({ mode: 'live' }),
    getSelections: async () => { throw new ProviderError('Proveedor temporalmente fuera de servicio.', 'PROVIDER_UNAVAILABLE', 503); } } });
  const unavailable = await failed('/api/parlays/build', { filters: {} });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'PROVIDER_UNAVAILABLE');
  assert.ok(!unavailable.body.parlay);
});

test('API valida deportes, zona horaria, rango de cuotas y filtros vacíos malformados', async t => {
  const request = await withApp(t);
  assert.equal((await request('/api/events?sports=invalid')).status, 400);
  assert.equal((await request('/api/events?timezone=invalid')).status, 400);
  assert.equal((await request('/api/parlays/daily?minOdds=3&maxOdds=2')).status, 422);
  assert.equal((await request('/api/parlays/build', { filters: null })).status, 400);
  assert.equal((await request('/api/parlays/build', { filters: { legCount: 0 } })).status, 400);
});

test('chat API mantiene servicio IA real como prerrequisito y aplica límite de consultas', async t => {
  const request = await withApp(t, { chatHandler: async () => {
    const error = new Error('Configura el servicio de IA en el servidor.');
    error.name = 'ChatError'; error.statusCode = 503; error.code = 'AI_NOT_CONFIGURED'; throw error;
  } });
  const chat = await request('/api/chat', { message: 'Crea tres partidos' });
  assert.equal(chat.status, 503);
  assert.equal(chat.body.code, 'AI_NOT_CONFIGURED');
  assert.ok(chat.body.error.includes('IA'));
  const limited = await withApp(t, { rateLimits: true, chatHandler: async () => ({ message: 'Respuesta de prueba de transporte.' }) });
  for (let i = 0; i < 6; i++) assert.equal((await limited('/api/chat', { message: 'test' })).status, 200);
  assert.equal((await limited('/api/chat', { message: 'test' })).status, 429);
});
