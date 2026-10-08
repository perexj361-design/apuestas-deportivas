import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat, interpretWithOpenAI, getAiStatus } from './chat.js';
import { createProvider } from './provider.js';

const provider = createProvider({ env: {} });
const input = { message: 'Crea tres partidos de fútbol con cuota 1,50', filters: { sports: ['football'], legCount: 3, targetOdds: 1.5, tolerance: 0.15, bookmaker: 'demo_norte' } };
const buildAI = async () => ({ action: 'build', patch: {}, replaceIndex: null, clarification: null });

test('chat usa filtros interpretados y únicamente selecciones del proveedor, marcando demo', async () => {
  const response = await handleChat(input, { provider, ai: buildAI });
  assert.equal(response.mode, 'demo');
  assert.equal(response.result.status, 'matched');
  assert.equal(response.result.parlay.legs.length, 3);
  assert.ok(response.result.parlay.legs.every(leg => leg.demo));
  assert.match(response.message, /ficticio/);
  const supplied = new Set((await provider.getSelections()).map(leg => leg.id));
  assert.ok(response.result.parlay.legs.every(leg => supplied.has(leg.id)));
});

test('seguimiento cambia solo segundo partido y recalcula con cuotas verificadas', async () => {
  const first = await handleChat(input, { provider, ai: buildAI });
  const previous = first.result.parlay;
  const response = await handleChat({ ...input, message: 'cambia el segundo partido', previous }, {
    provider, ai: async () => ({ action: 'replace', patch: {}, replaceIndex: 1, clarification: null }),
  });
  const changed = response.result.parlay || response.result.alternatives[0];
  assert.ok(changed, response.result.reason);
  assert.equal(changed.legs[0].id, previous.legs[0].id);
  assert.equal(changed.legs[2].id, previous.legs[2].id);
  assert.notEqual(changed.legs[1].eventId, previous.legs[1].eventId);
  assert.ok(Math.abs(changed.totalOdds - changed.legs.reduce((total, leg) => total * leg.odds, 1)) < 0.001);
});

test('seguimiento quita tenis manteniendo cuota y restricciones restantes', async () => {
  const firstInput = { ...input, filters: { sports: ['tennis', 'basketball'], legCount: 4, targetOdds: 3, tolerance: 0.5, bookmaker: 'demo_norte', excludedMarkets: ['spreads'] } };
  const first = await handleChat(firstInput, { provider, ai: buildAI });
  const response = await handleChat({ ...firstInput, filters: first.filters, previous: first.result.parlay, message: 'quita el tenis' }, {
    provider, ai: async () => ({ action: 'build', patch: { sports: ['basketball'] }, replaceIndex: null, clarification: null }),
  });
  assert.equal(response.filters.targetOdds, 3);
  assert.deepEqual(response.filters.excludedMarkets, ['spreads']);
  const parlay = response.result.parlay || response.result.alternatives[0];
  assert.ok(parlay);
  assert.ok(parlay.legs.every(leg => leg.sport === 'basketball'));
});

test('mercado desconocido interpretado por IA se rechaza sin inventar ni sustituir', async () => {
  await assert.rejects(() => handleChat(input, {
    provider, ai: async () => ({ action: 'build', patch: { markets: ['inventado'] } }),
  }), { code: 'FILTER_UNAVAILABLE', statusCode: 422 });
});

test('chat puede consultar mercados y casas de una liga diferente a la muestra inicial', async () => {
  const now = Date.now();
  const realProvider = createProvider({
    env: { ODDS_API_KEY: 'test-only', ODDS_API_SPORT_KEYS: 'soccer_epl' },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/v4/sports') return new Response(JSON.stringify([
        { key: 'soccer_epl', title: 'Liga inicial', active: true },
        { key: 'soccer_chile', title: 'Liga elegida', active: true },
      ]));
      const other = url.includes('soccer_chile');
      return new Response(JSON.stringify([{
        id: other ? 'event-other' : 'event-default', sport_key: other ? 'soccer_chile' : 'soccer_epl',
        sport_title: other ? 'Liga elegida' : 'Liga inicial',
        commence_time: new Date(now + 3_600_000).toISOString(), home_team: 'A', away_team: 'B',
        bookmakers: [{ key: other ? 'book_other' : 'book_default', title: other ? 'Otra casa' : 'Casa inicial',
          last_update: new Date(now).toISOString(), markets: [{ key: other ? 'totals' : 'h2h',
            outcomes: [{ name: other ? 'Over' : 'A', price: 1.5, ...(other ? { point: 1.5 } : {}) }],
          }],
        }],
      }]));
    },
  });
  const response = await handleChat({ message: 'Un partido de la liga elegida, más de 1,5 goles', filters: { legCount: 1, targetOdds: 1.5, tolerance: 0 } }, {
    provider: realProvider,
    ai: async ({ catalog }) => {
      assert.ok(catalog.supportedMarkets.some(item => item.key === 'totals'));
      return { action: 'build', patch: { leagues: ['soccer_chile'], markets: ['totals'], bookmaker: 'book_other' } };
    },
  });
  assert.equal(response.mode, 'live');
  assert.equal(response.result.status, 'matched');
  assert.equal(response.result.parlay.legs[0].market, 'totals');
  assert.equal(response.result.parlay.bookmakerKey, 'book_other');
});

test('petición imposible conserva filtros y devuelve alternativa identificada', async () => {
  const response = await handleChat({ ...input, filters: { ...input.filters, targetOdds: 50, tolerance: 0.01 } }, { provider, ai: buildAI });
  assert.equal(response.result.status, 'no_match');
  assert.equal(response.result.parlay, null);
  assert.equal(response.filters.targetOdds, 50);
  assert.match(response.message, /fuera del margen/);
});

test('no conserva cuotas recibidas del navegador ni legs desaparecidas', async () => {
  const first = await handleChat(input, { provider, ai: buildAI });
  const previous = structuredClone(first.result.parlay);
  previous.legs[0].id = 'leg-inventada';
  previous.legs[0].odds = 9;
  await assert.rejects(() => handleChat({ ...input, previous }, {
    provider, ai: async () => ({ action: 'replace', patch: {}, replaceIndex: 1 }),
  }), { code: 'PREVIOUS_EXPIRED', statusCode: 409 });
});

test('datos inexistentes y proveedor caído llegan como errores sin fallback', async () => {
  const empty = { ...provider, getSelections: async () => [] };
  const response = await handleChat(input, { provider: empty, ai: buildAI });
  assert.equal(response.result.status, 'empty');
  const down = { ...provider, getSelections: async () => { throw Object.assign(new Error('Proveedor no disponible'), { code: 'PROVIDER_UNAVAILABLE' }); } };
  await assert.rejects(() => handleChat(input, { provider: down, ai: buildAI }), { code: 'PROVIDER_UNAVAILABLE' });
});

test('IA sin credencial no aparenta estar conectada', async () => {
  assert.equal(getAiStatus({}).configured, false);
  await assert.rejects(() => interpretWithOpenAI({}, { env: {} }), { code: 'AI_NOT_CONFIGURED', statusCode: 503 });
});

test('conector real envía esquema de filtros y nunca expone clave en resultado', async () => {
  let sent;
  const context = { ...input, previous: null, catalog: await provider.getCatalog() };
  const aiResponse = { action: 'build', patch: {}, replaceIndex: null, clarification: null };
  const result = await interpretWithOpenAI(context, {
    env: { AI_API_KEY: 'test-key-do-not-use' },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-key-do-not-use');
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiResponse) } }] }), { status: 200 });
    },
  });
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(result, aiResponse);
  assert.ok(!JSON.stringify(result).includes('test-key'));
});

test('IA auth, timeout y respuesta corrupta reportan fallos explícitos', async () => {
  const context = { ...input, previous: null, catalog: await provider.getCatalog() };
  const env = { AI_API_KEY: 'test-only' };
  await assert.rejects(() => interpretWithOpenAI(context, { env, fetchImpl: async () => new Response('{}', { status: 401 }) }), { code: 'AI_AUTH' });
  await assert.rejects(() => interpretWithOpenAI(context, { env, fetchImpl: async () => { throw new Error('timeout'); } }), { code: 'AI_UNAVAILABLE' });
  await assert.rejects(() => interpretWithOpenAI(context, { env, fetchImpl: async () => new Response('{}', { status: 200 }) }), { code: 'AI_INVALID_RESPONSE' });
});

test('interpretaciones idénticas usan caché sin reutilizar las cuotas del resultado', async t => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'build', patch: {}, replaceIndex: null, clarification: null }) } }] }));
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const context = { message: 'petición única de prueba de caché', filters: input.filters, previous: null, catalog: await provider.getCatalog() };
  const env = { AI_API_KEY: 'test-only' };
  await interpretWithOpenAI(context, { env });
  await interpretWithOpenAI(context, { env });
  assert.equal(calls, 1);
});

test('DEMO_MODE=true desactiva IA y bloquea llamadas aunque existan claves heredadas', async () => {
  const env = { DEMO_MODE: 'true', AI_API_KEY: 'test-only-not-a-real-key', OPENAI_API_KEY: 'also-test-only' };
  assert.equal(getAiStatus(env).configured, false);
  assert.equal(getAiStatus(env).disabledForDemo, true);
  await assert.rejects(() => interpretWithOpenAI({}, { env, fetchImpl: async () => { assert.fail('La demo no puede llamar a la IA.'); } }), { code: 'AI_DEMO_DISABLED', statusCode: 503 });
});
