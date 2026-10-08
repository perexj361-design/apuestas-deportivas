import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilters, filterSelections, buildParlay, dailyParlays, FilterValidationError } from './engine.js';

const FUTURE = '2035-06-05T21:00:00.000Z';
const NOW = Date.parse('2035-06-01T00:00:00.000Z');

function leg(id, overrides = {}) {
  return {
    id,
    eventId: `event-${id}`,
    sport: 'football',
    leagueKey: 'laliga',
    league: 'Liga de demostración',
    home: `Local ${id}`,
    away: `Visitante ${id}`,
    startsAt: FUTURE,
    market: 'h2h',
    marketLabel: 'Ganador del partido',
    line: null,
    outcome: `Local ${id}`,
    odds: 1.2,
    bookmakerKey: 'example',
    bookmakerName: 'Casa ficticia',
    updatedAt: '2035-06-01T00:00:00.000Z',
    source: 'demo',
    demo: true,
    evidence: ['Ejemplo ficticio.'],
    missing: ['Sin análisis estadístico.'],
    ...overrides,
  };
}

function build(selections, filters, options = {}) {
  return buildParlay(selections, filters, { now: NOW, ...options });
}

test('normalization applies defaults and validates public and AI input without changing constraints', () => {
  const normalized = normalizeFilters({ sports: ['football', 'football'], include: ['Águilas', 'aguilas'] });
  assert.equal(normalized.legCount, 3);
  assert.equal(normalized.targetOdds, 1.5);
  assert.equal(normalized.tolerance, 0.1);
  assert.equal(normalized.timezone, 'America/Santiago');
  assert.deepEqual(normalized.sports, ['football']);
  assert.deepEqual(normalized.include, ['aguilas']);
  for (const invalid of [
    { sports: ['baseball'] }, { sports: 'football' }, { legCount: 7 }, { legCount: 2.5 },
    { targetOdds: '1.50' }, { targetOdds: 0.9 }, { tolerance: -0.1 },
    { timezone: 'Mars/Base' }, { date: '2035-02-30' }, { date: '05-06-2035' },
    { date: false }, { date: 0 }, { include: [12] }, null, [],
  ]) assert.throws(() => normalizeFilters(invalid), FilterValidationError);
  assert.equal(normalizeFilters({ date: '', bookmaker: '' }).date, null);
  assert.equal(normalizeFilters({ date: '', bookmaker: '' }).bookmaker, null);
});

test('decimal product retains six-place precision and implicit probability is a derived fraction', () => {
  const choices = [leg('a', { odds: 1.15 }), leg('b', { odds: 1.18 }), leg('c', { odds: 1.21 })];
  const result = build(choices, { legCount: 3, targetOdds: 1.64197, tolerance: 0 });
  assert.equal(result.status, 'matched');
  assert.equal(result.parlay.totalOdds, 1.64197);
  assert.equal(result.parlay.impliedProbability, Number((1 / (1.15 * 1.18 * 1.21)).toFixed(8)));
  assert.equal(result.parlay.legs.length, 3);
  assert.ok(result.warnings.some((warning) => warning.includes('ficticia')));
});

test('future events, sports, league, markets, exclusions and bookmaker are enforced together', () => {
  const choices = [
    leg('a', { market: 'corners', marketLabel: 'Más de 8,5 córners', line: 8.5 }),
    leg('b', { sport: 'tennis', leagueKey: 'atp', market: 'corners' }),
    leg('c', { leagueKey: 'premier', market: 'corners' }),
    leg('d'),
    leg('e', { market: 'corners', bookmakerKey: 'other' }),
    leg('f', { market: 'corners', startsAt: '2035-05-30T00:00:00Z' }),
    leg('g', { market: 'corners', home: 'Águilas del Norte' }),
  ];
  const result = filterSelections(choices, {
    sports: ['football'], leagues: ['laliga'], markets: ['corners'],
    excludedMarkets: ['h2h'], bookmaker: 'example', exclude: ['aguilas'],
  }, { now: NOW });
  assert.deepEqual(result.map((item) => item.id), ['a']);
  assert.equal(result[0].line, 8.5);
});

test('started and invalid events are removed at the exact kickoff boundary', () => {
  const choices = [
    leg('past', { startsAt: new Date(NOW - 1).toISOString() }),
    leg('started', { startsAt: new Date(NOW).toISOString() }),
    leg('future', { startsAt: new Date(NOW + 1).toISOString() }),
    leg('invalid-date', { startsAt: 'not-a-date' }),
    leg('invalid-price', { odds: NaN }),
    leg('negative-price', { odds: 0.5 }),
  ];
  assert.deepEqual(filterSelections(choices, {}, { now: NOW }).map((item) => item.id), ['future']);
});

test('date filtering uses visitor zone instead of UTC', () => {
  const choices = [
    leg('night', { startsAt: '2035-01-02T02:00:00Z' }),
    leg('morning', { startsAt: '2035-01-02T14:00:00Z' }),
  ];
  const now = Date.parse('2035-01-01T00:00:00Z');
  const chile = filterSelections(choices, { date: '2035-01-01', timezone: 'America/Santiago' }, { now });
  const utc = filterSelections(choices, { date: '2035-01-01', timezone: 'UTC' }, { now });
  assert.deepEqual(chile.map((item) => item.id), ['night']);
  assert.deepEqual(utc, []);
});

test('all requested entities are included while other legs can fill the parlay', () => {
  const choices = [
    leg('a', { home: 'Águilas del Norte', away: 'Club Sur', odds: 1.25 }),
    leg('b', { home: 'Cóndores', odds: 1.2 }),
    leg('c', { home: 'Universidad', odds: 1.3 }),
  ];
  const result = build(choices, {
    legCount: 3, targetOdds: 1.95, tolerance: 0.01, include: ['aguilas', 'club sur', 'condores'],
  });
  assert.equal(result.status, 'matched');
  assert.equal(result.parlay.totalOdds, 1.95);
  assert.equal(build(choices, { legCount: 2, targetOdds: 2, tolerance: 2, include: ['equipo inexistente'] }).status, 'no_match');
  assert.equal(build(choices, { legCount: 2, targetOdds: 2, tolerance: 2, include: ['aguilas'], exclude: ['aguilas'] }).status, 'no_match');
});

test('entity matching uses whole name words, so Equipo 1 cannot silently include Equipo 10', () => {
  const choices = [leg('one', { home: 'Equipo 1' }), leg('ten', { home: 'Equipo 10' })];
  const result = build(choices, { legCount: 1, targetOdds: 1.2, tolerance: 0, include: ['equipo 1'] });
  assert.equal(result.status, 'matched');
  assert.equal(result.parlay.legs[0].id, 'one');
  assert.deepEqual(filterSelections(choices, { exclude: ['equipo 1'] }, { now: NOW }).map((item) => item.id), ['ten']);
});

test('mixed sports require at least one of each and reject more sports than legs', () => {
  const choices = [leg('f'), leg('f2'), leg('t', { sport: 'tennis' }), leg('b', { sport: 'basketball' })];
  const result = build(choices, { sports: ['football', 'tennis', 'basketball'], legCount: 3, targetOdds: 1.728, tolerance: 0 });
  assert.equal(result.status, 'matched');
  assert.deepEqual(new Set(result.parlay.legs.map((item) => item.sport)), new Set(['football', 'tennis', 'basketball']));
  assert.equal(build(choices, { sports: ['football', 'tennis', 'basketball'], legCount: 2 }).status, 'no_match');
  assert.equal(build(choices.slice(0, 2), { sports: ['football', 'tennis'], legCount: 2, targetOdds: 1.44, tolerance: 0 }).status, 'no_match');
});

test('multiple markets of one event cannot masquerade as distinct matches', () => {
  const choices = [leg('a'), leg('a2', { eventId: 'event-a', market: 'totals' }), leg('b')];
  assert.equal(build(choices, { legCount: 3, targetOdds: 1.728, tolerance: 0 }).status, 'no_match');
  const two = build(choices, { legCount: 2, targetOdds: 1.44, tolerance: 0 });
  assert.equal(two.status, 'matched');
  assert.equal(new Set(two.parlay.legs.map((item) => item.eventId)).size, 2);
});

test('same-house rule is enforced even when mixing houses would meet the exact target', () => {
  const choices = [
    leg('a', { odds: 1.2 }), leg('b', { odds: 1.3, bookmakerKey: 'other' }),
    leg('c', { odds: 1.4 }), leg('d', { odds: 1.5, bookmakerKey: 'other' }),
  ];
  const result = build(choices, { legCount: 2, targetOdds: 1.56, tolerance: 0 });
  assert.equal(result.status, 'no_match');
  assert.ok(result.alternatives.length);
  for (const alternative of result.alternatives) {
    assert.equal(new Set(alternative.legs.map((item) => item.bookmakerKey)).size, 1);
    assert.notEqual(alternative.totalOdds, 1.56);
  }
});

test('no match returns explicitly outside-margin alternatives without relaxing include or market rules', () => {
  const choices = [
    leg('a', { odds: 1.5, home: 'Requerido', market: 'corners', line: 8.5 }),
    leg('b', { odds: 1.6, market: 'corners', line: 9.5 }),
    leg('c', { odds: 1.7, market: 'corners', line: 10.5 }),
    leg('cheap', { odds: 1.01, market: 'h2h' }),
  ];
  const filters = { legCount: 2, targetOdds: 1.5, tolerance: 0.01, markets: ['corners'], include: ['Requerido'] };
  const result = build(choices, filters);
  assert.equal(result.status, 'no_match');
  assert.equal(result.parlay, null);
  assert.ok(result.reason.includes('fuera del margen'));
  assert.equal(result.alternatives[0].totalOdds, 2.4);
  for (const alternative of result.alternatives) {
    assert.ok(Math.abs(alternative.totalOdds - filters.targetOdds) > filters.tolerance);
    assert.ok(alternative.legs.some((item) => item.home === 'Requerido'));
    assert.ok(alternative.legs.every((item) => item.market === 'corners'));
  }
  assert.deepEqual(result.filters.markets, ['corners']);
});

test('empty provider and absent market yield empty states without fabricated selections', () => {
  const empty = build([], {});
  assert.equal(empty.status, 'empty');
  assert.equal(empty.parlay, null);
  assert.deepEqual(empty.alternatives, []);
  assert.equal(build([leg('a')], { markets: ['corners'] }).status, 'empty');
});

test('change the second match preserves the others, refreshes prices and recalculates', () => {
  const original = [leg('a'), leg('b'), leg('c')];
  const previous = build(original, { legCount: 3, targetOdds: 1.728, tolerance: 0 }).parlay;
  assert.deepEqual(previous.legs.map((item) => item.id), ['a', 'b', 'c']);
  const current = [...original, leg('d', { odds: 1.25 }), leg('e', { odds: 1.7 }),
    leg('b-other-market', { eventId: 'event-b', odds: 1.25, market: 'totals' })];
  const changed = build(current, { legCount: 3, targetOdds: 1.8, tolerance: 0 }, { previous, replaceIndex: 1 });
  assert.equal(changed.status, 'matched');
  assert.deepEqual(changed.parlay.legs.map((item) => item.id), ['a', 'd', 'c']);
  assert.equal(changed.parlay.totalOdds, 1.8);
  assert.notEqual(changed.parlay.id, previous.id);
  const priceUpdate = current.map((item) => item.id === 'a' ? { ...item, odds: 1.3 } : item);
  const repriced = build(priceUpdate, { legCount: 3, targetOdds: 1.95, tolerance: 0 }, { previous, replaceIndex: 1 });
  assert.equal(repriced.status, 'matched');
  assert.equal(repriced.parlay.legs[0].odds, 1.3);
  assert.equal(repriced.parlay.totalOdds, 1.95);
});

test('impossible replacement keeps restrictions and cannot reuse the replaced match', () => {
  const original = [leg('a'), leg('b'), leg('c')];
  const previous = build(original, { legCount: 3, targetOdds: 1.728, tolerance: 0 }).parlay;
  const unavailable = build(original, { legCount: 3, targetOdds: 1.728, tolerance: 0 }, { previous, replaceIndex: 1 });
  assert.equal(unavailable.status, 'no_match');
  assert.equal(unavailable.parlay, null);
  const started = original.map((item) => item.id === 'a' ? { ...item, startsAt: new Date(NOW).toISOString() } : item);
  assert.equal(build([...started, leg('d')], { legCount: 3 }, { previous, replaceIndex: 1 }).status, 'no_match');
  assert.equal(build([...original, leg('d')], { legCount: 2 }, { previous, replaceIndex: 1 }).status, 'no_match');
  assert.equal(build([...original, leg('d', { bookmakerKey: 'other' })], { legCount: 3 }, { previous, replaceIndex: 1 }).status, 'no_match');
  assert.throws(() => build(original, {}, { previous }), FilterValidationError);
  assert.throws(() => build(original, {}, { previous, replaceIndex: 3 }), FilterValidationError);
});

test('replacement alternatives are also replacements of exactly the requested slot', () => {
  const original = [leg('a'), leg('b'), leg('c')];
  const previous = build(original, { legCount: 3, targetOdds: 1.728, tolerance: 0 }).parlay;
  const result = build([...original, leg('d', { odds: 1.8 }), leg('e', { odds: 2 })], {
    legCount: 3, targetOdds: 1.728, tolerance: 0,
  }, { previous, replaceIndex: 1 });
  assert.equal(result.status, 'no_match');
  assert.equal(result.alternatives.length, 2);
  for (const alternative of result.alternatives) {
    assert.equal(alternative.legs[0].id, 'a');
    assert.equal(alternative.legs[2].id, 'c');
    assert.notEqual(alternative.legs[1].eventId, 'event-b');
    assert.equal(alternative.totalOdds, Number(alternative.legs.reduce((total, item) => total * item.odds, 1).toFixed(6)));
  }
});

test('duplicate provider records do not create duplicate selections and oldest update represents freshness', () => {
  const a = leg('a');
  const b = leg('b', { updatedAt: '2035-05-31T23:00:00Z' });
  const result = build([a, a, b], { legCount: 2, targetOdds: 1.44, tolerance: 0 });
  assert.equal(result.status, 'matched');
  assert.equal(result.parlay.updatedAt, '2035-05-31T23:00:00.000Z');
  assert.equal(result.parlay.legs.length, 2);
});

function bruteForceExists(choices, input) {
  const filters = normalizeFilters(input);
  const available = filterSelections(choices, filters, { now: NOW });
  const valid = (picked) => {
    if (new Set(picked.map((item) => item.bookmakerKey)).size !== 1) return false;
    if (new Set(picked.map((item) => item.eventId)).size !== picked.length) return false;
    if (filters.sports.length > 1 && !filters.sports.every((sport) => picked.some((item) => item.sport === sport))) return false;
    if (!filters.include.every((name) => picked.some((item) => `${item.home} ${item.away}`.toLowerCase().includes(name.toLowerCase())))) return false;
    const product = picked.reduce((value, item) => value * item.odds, 1);
    return Math.abs(product - filters.targetOdds) <= filters.tolerance + 1e-10;
  };
  const search = (start, picked) => {
    if (picked.length === filters.legCount) return valid(picked);
    for (let index = start; index < available.length; index++) {
      if (search(index + 1, [...picked, available[index]])) return true;
    }
    return false;
  };
  return search(0, []);
}

test('log-bound pruning agrees with exhaustive search across small heterogeneous datasets', () => {
  let randomState = 17;
  const random = () => ((randomState = Math.imul(randomState, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 80; sample++) {
    const choices = Array.from({ length: 10 }, (_, index) => leg(`random-${index}`, {
      eventId: `event-${index % 7}`,
      home: `Team ${index % 7}`,
      sport: ['football', 'tennis', 'basketball'][index % 3],
      odds: Number((1.02 + random() * 1.8).toFixed(2)),
      bookmakerKey: index % 4 === 0 ? 'other' : 'example',
    }));
    const filters = {
      sports: sample % 3 === 0 ? ['football', 'tennis'] : [],
      legCount: 2 + sample % 3,
      targetOdds: Number((1.2 + random() * 12).toFixed(3)),
      tolerance: sample % 2 === 0 ? 0.1 : 0.4,
      include: sample % 5 === 0 ? ['Team 1'] : [],
    };
    assert.equal(build(choices, filters).status === 'matched', bruteForceExists(choices, filters), `sample ${sample}`);
  }
});

test('large provider inventory remains deterministic and respects the requested mix', () => {
  const choices = Array.from({ length: 1000 }, (_, index) => leg(`large-${index}`, {
    eventId: `match-${Math.floor(index / 4)}`,
    sport: ['football', 'tennis', 'basketball'][Math.floor(index / 4) % 3],
    odds: 1.05 + index % 20 / 100,
    market: ['h2h', 'totals', 'corners', 'spreads'][index % 4],
  }));
  const filters = { sports: ['football', 'tennis', 'basketball'], legCount: 6, targetOdds: 2.5, tolerance: 0.05 };
  const first = build(choices, filters);
  const second = build(choices.slice().reverse(), filters);
  assert.equal(first.status, 'matched');
  assert.equal(first.parlay.id, second.parlay.id);
  assert.equal(new Set(first.parlay.legs.map((item) => item.eventId)).size, 6);
});

test('daily proposals only contain valid compatible legs and preserve explicit market filters', () => {
  const choices = Array.from({ length: 12 }, (_, index) => leg(`daily-${index}`, {
    sport: ['football', 'tennis', 'basketball'][index % 3],
    odds: index % 3 === 0 ? 1.15 : 1.45,
    market: 'corners',
    line: 8.5,
  }));
  const proposals = dailyParlays(choices, { markets: ['corners'] });
  assert.ok(proposals.length > 0);
  assert.equal(new Set(proposals.map((item) => item.id)).size, proposals.length);
  for (const proposal of proposals) {
    assert.ok(proposal.legs.every((item) => item.market === 'corners'));
    assert.equal(new Set(proposal.legs.map((item) => item.eventId)).size, proposal.legs.length);
    assert.equal(new Set(proposal.legs.map((item) => item.bookmakerKey)).size, 1);
    assert.equal(proposal.totalOdds, Number(proposal.legs.reduce((total, item) => total * item.odds, 1).toFixed(6)));
  }
  assert.deepEqual(dailyParlays([]), []);
});
