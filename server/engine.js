const SPORTS = new Set(['football', 'tennis', 'basketball']);
const SPORT_BITS = { football: 1, tennis: 2, basketball: 4 };
const DEFAULTS = Object.freeze({
  legCount: 3,
  targetOdds: 1.5,
  tolerance: 0.1,
  timezone: 'America/Santiago',
});
const SEARCH_BUDGET = 180_000;
const EPSILON = 1e-10;

export class FilterValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FilterValidationError';
    this.statusCode = 400;
  }
}

function textKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

function list(value, label, maximum = 60) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new FilterValidationError(`${label} debe ser una lista de hasta ${maximum} valores.`);
  }
  if (value.some((item) => typeof item !== 'string' || item.trim().length > 160)) {
    throw new FilterValidationError(`${label} solo admite textos de hasta 160 caracteres.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function finiteNumber(value, fallback, label, minimum, maximum) {
  const number = value == null ? fallback : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) {
    throw new FilterValidationError(`${label} debe ser un número entre ${minimum} y ${maximum}.`);
  }
  return number;
}

/** Validate public/user and AI filters at the same boundary; never repair constraints silently. */
export function normalizeFilters(input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new FilterValidationError('Los filtros deben ser un objeto.');
  }
  const sports = list(input.sports, 'Los deportes', 3);
  if (sports.some((sport) => !SPORTS.has(sport))) {
    throw new FilterValidationError('Los deportes válidos son football, tennis y basketball.');
  }
  const legCount = finiteNumber(input.legCount, DEFAULTS.legCount, 'El número de partidos', 1, 6);
  if (!Number.isInteger(legCount)) throw new FilterValidationError('El número de partidos debe ser entero.');
  const targetOdds = finiteNumber(input.targetOdds, DEFAULTS.targetOdds, 'La cuota objetivo', 1, 100_000);
  const tolerance = finiteNumber(input.tolerance, DEFAULTS.tolerance, 'El margen de cuota', 0, 100_000);
  const timezone = input.timezone ?? DEFAULTS.timezone;
  if (typeof timezone !== 'string' || timezone.length > 100) {
    throw new FilterValidationError('La zona horaria debe ser una zona IANA válida.');
  }
  try {
    new Intl.DateTimeFormat('es', { timeZone: timezone }).format(0);
  } catch {
    throw new FilterValidationError('La zona horaria debe ser una zona IANA válida.');
  }
  const date = input.date === '' || input.date == null ? null : input.date;
  if (date !== null) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new FilterValidationError('La fecha debe tener formato AAAA-MM-DD.');
    }
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new FilterValidationError('La fecha indicada no existe.');
    }
  }
  const bookmaker = input.bookmaker === '' || input.bookmaker == null ? null : input.bookmaker;
  if (bookmaker !== null && (typeof bookmaker !== 'string' || !bookmaker.trim() || bookmaker.length > 160)) {
    throw new FilterValidationError('La casa de apuestas debe ser un identificador válido.');
  }
  return {
    sports,
    leagues: list(input.leagues, 'Las ligas'),
    legCount,
    targetOdds,
    tolerance,
    markets: list(input.markets, 'Los mercados'),
    excludedMarkets: list(input.excludedMarkets, 'Los mercados excluidos'),
    date,
    include: [...new Map(list(input.include, 'Las inclusiones', 30).map((item) => [textKey(item), item])).values()],
    exclude: [...new Map(list(input.exclude, 'Las exclusiones', 30).map((item) => [textKey(item), item])).values()],
    bookmaker: bookmaker === null ? null : bookmaker.trim(),
    timezone,
  };
}

function entityMatches(selection, entity) {
  const words = (value) => textKey(value).replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
  const key = words(entity);
  return key !== '' && [selection.home, selection.away].some((team) => ` ${words(team)} `.includes(` ${key} `));
}

function localDate(timestamp, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Include is a requirement for the complete parlay, not a filter on every individual leg. */
export function filterSelections(selections = [], input = {}, { now = Date.now() } = {}) {
  const filters = normalizeFilters(input);
  if (!Array.isArray(selections)) throw new FilterValidationError('Las selecciones deben ser una lista.');
  const formatter = filters.date ? new Intl.DateTimeFormat('en-CA', {
    timeZone: filters.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }) : null;
  const seen = new Set();
  return selections.filter((selection) => {
    if (!selection || typeof selection.id !== 'string' || !selection.id ||
      typeof selection.eventId !== 'string' || !selection.eventId ||
      typeof selection.bookmakerKey !== 'string' || !selection.bookmakerKey ||
      typeof selection.market !== 'string' || !SPORTS.has(selection.sport) ||
      typeof selection.odds !== 'number' || !Number.isFinite(selection.odds) || selection.odds < 1) return false;
    const start = Date.parse(selection.startsAt);
    if (!Number.isFinite(start) || start <= now) return false;
    if (filters.sports.length && !filters.sports.includes(selection.sport)) return false;
    if (filters.leagues.length && !filters.leagues.includes(selection.leagueKey)) return false;
    if (filters.markets.length && !filters.markets.includes(selection.market)) return false;
    if (filters.excludedMarkets.includes(selection.market)) return false;
    if (filters.bookmaker && selection.bookmakerKey !== filters.bookmaker) return false;
    if (filters.date && localDate(start, formatter) !== filters.date) return false;
    if (filters.exclude.some((entity) => entityMatches(selection, entity))) return false;
    const uniqueKey = `${selection.bookmakerKey}\u0000${selection.id}`;
    if (seen.has(uniqueKey)) return false;
    seen.add(uniqueKey);
    return true;
  });
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeParlay(legs) {
  const product = legs.reduce((total, selection) => total * selection.odds, 1);
  if (!Number.isFinite(product)) return null;
  const validUpdates = legs.map((leg) => Date.parse(leg.updatedAt)).filter(Number.isFinite);
  const bookmakerKey = legs[0].bookmakerKey;
  return {
    id: `parlay-${stableHash(`${bookmakerKey}:${legs.map((leg) => leg.id).join('|')}`)}`,
    legs: legs.map((leg) => ({
      ...leg,
      evidence: [...(Array.isArray(leg.evidence) ? leg.evidence : [])],
      missing: [...(Array.isArray(leg.missing) ? leg.missing : [])],
    })),
    totalOdds: Number(product.toFixed(6)),
    bookmakerKey,
    bookmakerName: legs[0].bookmakerName || bookmakerKey,
    // The oldest selected quote is the conservative freshness timestamp.
    updatedAt: validUpdates.length ? new Date(Math.min(...validUpdates)).toISOString() : null,
    demo: legs.some((leg) => leg.demo === true),
    // This is a fraction (0..1), derived from the quoted price, not an estimate of success.
    impliedProbability: Number((1 / product).toFixed(8)),
  };
}

function inclusionMask(selection, names) {
  return names.reduce((mask, name, index) => entityMatches(selection, name) ? mask | (1n << BigInt(index)) : mask, 0n);
}

function selectionOrder(a, b) {
  return a.odds - b.odds || a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id);
}

/** Visit children near the remaining geometric mean first, while preserving canonical indexes. */
function* indexesNear(items, start, end, idealLog) {
  let lo = start;
  let hi = end + 1;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (items[middle].log < idealLog) lo = middle + 1;
    else hi = middle;
  }
  let left = lo - 1;
  let right = lo;
  while (left >= start || right <= end) {
    if (left < start) yield right++;
    else if (right > end) yield left--;
    else if (Math.abs(items[left].log - idealLog) <= Math.abs(items[right].log - idealLog)) yield left--;
    else yield right++;
  }
}

function baseResult(filters, status, reason, warnings = []) {
  return { status, parlay: null, alternatives: [], filters, ...(reason ? { reason } : {}), warnings, searchExhaustive: true };
}

/**
 * All selected sports are represented at least once in a mix; include names are all required.
 * Search uses optimistic log-price bounds: ignoring event conflicts in bounds only broadens the
 * range, so no valid branch is pruned incorrectly. A budget interruption is reported explicitly.
 */
export function buildParlay(selections = [], input = {}, options = {}) {
  const filters = normalizeFilters(input);
  const available = filterSelections(selections, filters, { now: options.now ?? Date.now() });
  const requiredSports = filters.sports.reduce((mask, sport) => mask | SPORT_BITS[sport], 0);
  const requiredEntities = (1n << BigInt(filters.include.length)) - 1n;
  const requestedMix = filters.sports.length > 1;
  if (requestedMix && filters.sports.length > filters.legCount) {
    return baseResult(filters, 'no_match', 'Para incluir todos los deportes elegidos necesitas al menos un partido de cada deporte.');
  }
  let fixed = [];
  let replaceIndex = null;
  let previousLegs = null;
  let prohibitedEvent = null;
  let requiredBookmaker = filters.bookmaker;
  if (options.previous !== undefined || options.replaceIndex !== undefined) {
    previousLegs = Array.isArray(options.previous) ? options.previous : options.previous?.legs;
    replaceIndex = options.replaceIndex;
    if (!Array.isArray(previousLegs) || !Number.isInteger(replaceIndex) || replaceIndex < 0 || replaceIndex >= previousLegs.length) {
      throw new FilterValidationError('Para cambiar una selección necesitas una combinada anterior y un índice válido (desde cero).');
    }
    if (previousLegs.length !== filters.legCount) {
      return baseResult(filters, 'no_match', 'El reemplazo debe conservar el número de partidos de la combinada anterior.');
    }
    const oldBookmaker = previousLegs[0]?.bookmakerKey;
    if (!oldBookmaker || previousLegs.some((leg) => leg?.bookmakerKey !== oldBookmaker) ||
      new Set(previousLegs.map((leg) => leg.eventId)).size !== previousLegs.length ||
      (requiredBookmaker && requiredBookmaker !== oldBookmaker)) {
      return baseResult(filters, 'no_match', 'La combinada anterior no es compatible con una única casa de apuestas y partidos distintos.');
    }
    requiredBookmaker = oldBookmaker;
    prohibitedEvent = previousLegs[replaceIndex].eventId;
    for (let index = 0; index < previousLegs.length; index++) {
      if (index === replaceIndex) continue;
      const old = previousLegs[index];
      const current = available.find((leg) => leg.id === old.id && leg.eventId === old.eventId && leg.bookmakerKey === oldBookmaker);
      if (!current) {
        return baseResult(filters, 'no_match', 'No se puede conservar una selección: el partido comenzó, la cuota ya no está disponible o incumple los filtros.');
      }
      fixed.push(current);
    }
  }
  if (!available.length) {
    return baseResult(filters, 'empty', 'No hay selecciones de partidos futuros que cumplan los filtros. Revisa la fecha, la casa y la disponibilidad de mercados.');
  }
  const fixedEvents = new Set(fixed.map((leg) => leg.eventId));
  const groups = new Map();
  for (const selection of available) {
    if ((requiredBookmaker && selection.bookmakerKey !== requiredBookmaker) || fixedEvents.has(selection.eventId) || selection.eventId === prohibitedEvent) continue;
    if (!groups.has(selection.bookmakerKey)) groups.set(selection.bookmakerKey, []);
    groups.get(selection.bookmakerKey).push(selection);
  }
  const chooseCount = filters.legCount - fixed.length;
  const fixedLog = fixed.reduce((total, leg) => total + Math.log(leg.odds), 0);
  const fixedEntities = fixed.reduce((mask, leg) => mask | inclusionMask(leg, filters.include), 0n);
  const fixedSports = fixed.reduce((mask, leg) => mask | SPORT_BITS[leg.sport], 0);
  const lowerOdds = Math.max(1, filters.targetOdds - filters.tolerance);
  const upperOdds = filters.targetOdds + filters.tolerance;
  const lowerLog = Math.log(Math.max(1, lowerOdds - EPSILON));
  const upperLog = Math.log(upperOdds + EPSILON);
  const targetLog = Math.log(filters.targetOdds);
  const preparedGroups = [];
  for (const [bookmakerKey, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(group.map((leg) => leg.eventId)).size < chooseCount) continue;
    const items = group.sort(selectionOrder).map((selection) => ({
      selection,
      log: Math.log(selection.odds),
      entities: inclusionMask(selection, filters.include),
      sport: SPORT_BITS[selection.sport],
    }));
    const prefix = [0];
    const suffixEntities = new Array(items.length + 1).fill(0n);
    const suffixSports = new Array(items.length + 1).fill(0);
    for (let index = 0; index < items.length; index++) prefix.push(prefix[index] + items[index].log);
    for (let index = items.length - 1; index >= 0; index--) {
      suffixEntities[index] = suffixEntities[index + 1] | items[index].entities;
      suffixSports[index] = suffixSports[index + 1] | items[index].sport;
    }
    if ((fixedEntities | suffixEntities[0]) !== requiredEntities ||
      (requestedMix && ((fixedSports | suffixSports[0]) & requiredSports) !== requiredSports)) continue;
    preparedGroups.push({ bookmakerKey, items, prefix, suffixEntities, suffixSports });
  }
  if (!preparedGroups.length) {
    return baseResult(filters, 'no_match', options.previous
      ? 'No hay un partido diferente que permita conservar las otras selecciones y todos los filtros en la misma casa.'
      : 'No hay suficientes partidos distintos en una misma casa que cubran todas las inclusiones y deportes solicitados.');
  }
  let nodes = 0;
  let interrupted = false;
  let matched = null;
  const alternatives = [];
  const alternativeIds = new Set();
  const assemble = (chosen) => {
    if (previousLegs) {
      let kept = 0;
      return previousLegs.map((_, index) => index === replaceIndex ? chosen[0] : fixed[kept++]);
    }
    return chosen.slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  };
  const recordAlternative = (legs, total) => {
    // Explicit alternatives never satisfy the requested tolerance, and never relax other filters.
    if (Math.abs(total - filters.targetOdds) <= filters.tolerance + EPSILON) return;
    const parlay = makeParlay(legs);
    if (!parlay || alternativeIds.has(parlay.id)) return;
    const delta = Math.abs(total - filters.targetOdds);
    alternatives.push({ parlay, delta });
    alternativeIds.add(parlay.id);
    alternatives.sort((a, b) => a.delta - b.delta || a.parlay.id.localeCompare(b.parlay.id));
    if (alternatives.length > 3) alternativeIds.delete(alternatives.pop().parlay.id);
  };
  const search = (group, matchOnly) => {
    const { items, prefix, suffixEntities, suffixSports } = group;
    const n = items.length;
    const visit = (start, left, logProduct, entities, sports, chosen, usedEvents) => {
      if (matched || interrupted) return;
      if (++nodes > SEARCH_BUDGET) {
        interrupted = true;
        return;
      }
      if (left === 0) {
        if (entities !== requiredEntities || (requestedMix && (sports & requiredSports) !== requiredSports)) return;
        const legs = assemble(chosen);
        const total = legs.reduce((product, leg) => product * leg.odds, 1);
        if (!Number.isFinite(total)) return;
        if (Math.abs(total - filters.targetOdds) <= filters.tolerance + EPSILON) matched = makeParlay(legs);
        else if (!matchOnly) recordAlternative(legs, total);
        return;
      }
      if (n - start < left || (entities | suffixEntities[start]) !== requiredEntities ||
        (requestedMix && ((sports | suffixSports[start]) & requiredSports) !== requiredSports)) return;
      const minimumLog = logProduct + prefix[start + left] - prefix[start];
      const maximumLog = logProduct + prefix[n] - prefix[n - left];
      if (matchOnly && (minimumLog > upperLog || maximumLog < lowerLog)) return;
      if (!matchOnly && alternatives.length >= 3) {
        const minimum = Math.exp(minimumLog);
        const maximum = Math.exp(maximumLog);
        const nearestPossibleDistance = filters.targetOdds < minimum ? minimum - filters.targetOdds
          : filters.targetOdds > maximum ? filters.targetOdds - maximum : 0;
        if (nearestPossibleDistance > alternatives[2].delta + EPSILON) return;
      }
      const idealLog = (targetLog - logProduct) / left;
      for (const index of indexesNear(items, start, n - left, idealLog)) {
        if (++nodes > SEARCH_BUDGET) {
          interrupted = true;
          return;
        }
        const item = items[index];
        if (usedEvents.has(item.selection.eventId)) continue;
        const after = left - 1;
        const newLog = logProduct + item.log;
        if (matchOnly && after > 0) {
          const childMinimum = newLog + prefix[index + 1 + after] - prefix[index + 1];
          const childMaximum = newLog + prefix[n] - prefix[n - after];
          if (childMinimum > upperLog || childMaximum < lowerLog) continue;
        }
        if (matchOnly && after === 0 && (newLog > upperLog || newLog < lowerLog)) continue;
        chosen.push(item.selection);
        usedEvents.add(item.selection.eventId);
        visit(index + 1, after, newLog, entities | item.entities, sports | item.sport, chosen, usedEvents);
        usedEvents.delete(item.selection.eventId);
        chosen.pop();
        if (matched || interrupted) return;
      }
    };
    visit(0, chooseCount, fixedLog, fixedEntities, fixedSports, [], new Set(fixedEvents));
  };
  for (const group of preparedGroups) {
    search(group, true);
    if (matched || interrupted) break;
  }
  const matchSearchInterrupted = interrupted;
  if (!matched) {
    // A separate bounded search supplies nearby, fully compatible alternatives.
    nodes = 0;
    interrupted = false;
    for (const group of preparedGroups) {
      search(group, false);
      if (matched || interrupted) break;
    }
  }
  const warnings = [];
  if (matched?.demo || alternatives.some(({ parlay }) => parlay.demo)) {
    warnings.push('Demostración ficticia: estos partidos y cuotas no son recomendaciones actuales.');
  }
  if (!matched && (matchSearchInterrupted || interrupted)) {
    warnings.push('La búsqueda alcanzó su límite de cálculo; puede haber otras combinaciones. Reduce partidos, ligas o mercados para explorar más opciones.');
  }
  if (matched) return { status: 'matched', parlay: matched, alternatives: [], filters, warnings, searchExhaustive: false };
  const reason = matchSearchInterrupted
    ? 'No se encontró una combinada dentro del margen en la búsqueda limitada. Las alternativas mantienen los demás filtros y quedan fuera del margen.'
    : options.previous
      ? 'No existe un reemplazo dentro del margen que conserve las otras selecciones y los filtros. Las alternativas mostradas quedan fuera del margen.'
      : 'No existe una combinada dentro del margen solicitado entre las selecciones disponibles. Las alternativas mantienen los demás filtros y quedan fuera del margen.';
  return {
    ...baseResult(filters, 'no_match', reason, warnings),
    alternatives: alternatives.map(({ parlay }) => parlay),
    searchExhaustive: !matchSearchInterrupted && !interrupted,
  };
}

/** Daily proposals are only returned when compatible; each retains its construction filters. */
export function dailyParlays(selections = [], input = {}) {
  const filters = normalizeFilters(input);
  const suppliedTarget = input.targetOdds !== undefined;
  const suppliedCount = input.legCount !== undefined;
  const specs = [
    { sports: ['football'], legCount: 3, targetOdds: 1.5, tolerance: 0.2 },
    { sports: ['tennis'], legCount: 2, targetOdds: 2, tolerance: 0.5 },
    { sports: ['basketball'], legCount: 2, targetOdds: 2.5, tolerance: 0.6 },
    { sports: [], legCount: 3, targetOdds: 3, tolerance: 0.8 },
    { sports: ['football', 'tennis', 'basketball'], legCount: 3, targetOdds: 4, tolerance: 1 },
    { sports: [], legCount: 4, targetOdds: 5, tolerance: 1.2 },
  ];
  const results = [];
  const seen = new Set();
  for (const spec of specs) {
    const result = buildParlay(selections, {
      ...filters,
      sports: filters.sports.length ? filters.sports : spec.sports,
      legCount: suppliedCount ? filters.legCount : spec.legCount,
      targetOdds: suppliedTarget ? filters.targetOdds : spec.targetOdds,
      tolerance: input.tolerance !== undefined ? filters.tolerance : spec.tolerance,
    });
    if (result.status === 'matched' && !seen.has(result.parlay.id)) {
      seen.add(result.parlay.id);
      results.push({ ...result.parlay, filters: result.filters });
    }
  }
  return results;
}
