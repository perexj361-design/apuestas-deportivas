import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Copy, ExternalLink, Filter, Layers3, LoaderCircle, MessageCircle,
  Plus, RefreshCw, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Target, Trophy, X, Zap,
} from 'lucide-react';

const NAV = [
  { key: 'daily', label: 'Combinadas del día', short: 'Del día', icon: Layers3 },
  { key: 'builder', label: 'Crear combinada', short: 'Constructor', icon: SlidersHorizontal },
  { key: 'chat', label: 'Asistente IA', short: 'Chat IA', icon: Sparkles },
];
const EXAMPLES = [
  'Créame una combinada de 3 partidos de la liga española con cuota total cercana a 1,50.',
  'Quiero una combinada de córners con cuota cercana a 2,00; elige tú las ligas, pero no incluyas ganadores.',
  'Combina tenis y básquetbol con 4 partidos y cuota aproximada de 3,00.',
];
const EMPTY_CATALOG = { sports: [], leagues: [], markets: [], bookmakers: [], coverage: { corners: false, notes: [] } };
const RuntimeContext = createContext({ maxAgeMinutes: 15 });

function visitorTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago'; }
  catch { return 'America/Santiago'; }
}
const DEFAULT_FILTERS = {
  sports: [], leagues: [], legCount: 3, targetOdds: 1.5, tolerance: 0.1,
  markets: [], excludedMarkets: [], date: null, include: [], exclude: [],
  bookmaker: null, timezone: visitorTimezone(),
};
function odds(value) { return Number(value || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function shortDate(value, timezone, includeDate = true) {
  if (!value) return 'Horario no disponible';
  try {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: timezone, ...(includeDate ? { day: '2-digit', month: 'short' } : {}),
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(value));
  } catch { return 'Horario no disponible'; }
}
function eventName(leg) { return [leg.home, leg.away].filter(Boolean).join(' vs. ') || 'Evento'; }
function exactSelection(leg) {
  const label = leg.outcome || leg.selection || '';
  const line = leg.line === null || leg.line === undefined ? '' : `${leg.market === 'spreads' && Number(leg.line) > 0 ? '+' : ''}${String(leg.line).replace('.', ',')}`;
  const normalized = label.replace('.', ',');
  return `${label}${line && !normalized.includes(line) ? ` ${line}` : ''}`.trim();
}
async function api(path, body, signal) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('El servidor no respondió correctamente. Inténtalo de nuevo.'); }
  if (!response.ok) throw new Error(data.error?.message || data.error || data.message || 'No pudimos completar la consulta. Inténtalo de nuevo.');
  return data;
}
function names(keys, items) { return keys.map(key => items.find(item => item.key === key)?.name || key).join(', '); }
function changeLabel(change) {
  if (typeof change !== 'string') return 'Condiciones actualizadas';
  if (change.startsWith('selection:')) return `Selección ${change.split(':')[1]} sustituida; cuota total recalculada`;
  const labels = { sports: 'Deportes actualizados', leagues: 'Ligas actualizadas', legCount: 'Número de partidos actualizado', targetOdds: 'Cuota objetivo actualizada', tolerance: 'Margen de aproximación actualizado', markets: 'Mercados permitidos actualizados', excludedMarkets: 'Mercados excluidos actualizados', date: 'Fecha actualizada', include: 'Participantes a incluir actualizados', exclude: 'Participantes excluidos actualizados', bookmaker: 'Casa de apuestas actualizada', timezone: 'Zona horaria actualizada' };
  return labels[change] || 'Condiciones actualizadas';
}
function NamesInput({ values, onChange, ...props }) {
  const [raw, setRaw] = useState(values.join(', '));
  const ownValue = useRef(JSON.stringify(values));
  useEffect(() => {
    const incoming = JSON.stringify(values);
    if (incoming !== ownValue.current) { ownValue.current = incoming; setRaw(values.join(', ')); }
  }, [values]);
  return <input {...props} value={raw} onChange={event => {
    setRaw(event.target.value);
    const parsed = event.target.value.split(',').map(name => name.trim()).filter(Boolean);
    ownValue.current = JSON.stringify(parsed); onChange(parsed);
  }} />;
}
function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-symbol"><BarChart3 size={22} strokeWidth={2.7} /></span><span>cuota<span className="brand-light">clara</span><span className="brand-period">.</span></span></div>;
}
function SportIcon({ sport, size = 17 }) {
  if (sport?.includes('soccer') || sport === 'football' || sport === 'futbol') return <span className="sport-glyph" style={{ fontSize: size + 2 }} aria-hidden="true">⚽</span>;
  if (sport?.includes('basket')) return <span className="sport-glyph" style={{ fontSize: size + 2 }} aria-hidden="true">🏀</span>;
  if (sport?.includes('tennis')) return <span className="sport-glyph" style={{ fontSize: size + 2 }} aria-hidden="true">🎾</span>;
  return <Trophy size={size} />;
}
function Pill({ children, tone = '', icon }) { return <span className={`pill ${tone}`}>{icon}{children}</span>; }
function ErrorMessage({ children, retry }) {
  return <div className="notice error-notice" role="alert"><CircleHelp size={19} /><div>{children}</div>{retry && <button className="text-button" onClick={retry}>Reintentar <RefreshCw size={14} /></button>}</div>;
}
function EmptyState({ title, children, onReset }) {
  return <div className="empty-state"><span className="empty-icon"><Filter size={25} /></span><h3>{title}</h3><p>{children}</p>{onReset && <button className="secondary-button" onClick={onReset}>Limpiar filtros <RefreshCw size={15} /></button>}</div>;
}
function SkeletonCards() {
  return <div className="proposals-grid" aria-label="Cargando propuestas">{[1, 2, 3].map(i => <div key={i} className="parlay-card skeleton"><div className="skeleton-line short" /><div className="skeleton-line big" />{[1, 2, 3].map(n => <div key={n} className="skeleton-leg"><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}<div className="skeleton-line" /></div>)}</div>;
}
function FilterSummary({ filters, catalog }) {
  const summary = [
    `${filters.legCount} ${Number(filters.legCount) === 1 ? 'partido' : 'partidos'}`,
    `Cuota ${odds(filters.targetOdds)} ± ${odds(filters.tolerance)}`,
    filters.sports?.length ? names(filters.sports, catalog.sports) : 'Todos los deportes',
    filters.leagues?.length ? names(filters.leagues, catalog.leagues) : null,
    filters.markets?.length ? names(filters.markets, catalog.markets) : null,
    filters.excludedMarkets?.length ? `Sin ${names(filters.excludedMarkets, catalog.markets)}` : null,
    filters.date ? `Fecha: ${filters.date}` : null,
    filters.include?.length ? `Incluir: ${filters.include.join(', ')}` : null,
    filters.exclude?.length ? `Excluir: ${filters.exclude.join(', ')}` : null,
    filters.bookmaker ? names([filters.bookmaker], catalog.bookmakers) : 'Una sola casa',
  ].filter(Boolean);
  return <div className="filter-summary">{summary.map((text, i) => <span key={i}>{text}</span>)}</div>;
}

function ParlayCard({ parlay, index = 0, timezone, onCopy, alternative = false, compact = false }) {
  const { maxAgeMinutes } = useContext(RuntimeContext);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const demo = parlay.demo || parlay.legs?.some(leg => leg.demo);
  const sports = [...new Set((parlay.legs || []).map(leg => leg.sport))];
  const expiredEvent = parlay.legs?.some(leg => new Date(leg.startsAt) <= new Date());
  const staleOdds = !demo && (parlay.legs || []).some(leg => {
    const updated = Date.parse(leg.updatedAt || parlay.updatedAt);
    return !Number.isFinite(updated) || Date.now() - updated > maxAgeMinutes * 60_000;
  });
  const expired = expiredEvent || staleOdds;
  async function copy() {
    const text = [
      demo ? 'DEMOSTRACIÓN · EVENTOS Y CUOTAS FICTICIOS' : 'Cuota Clara · Combinada',
      expiredEvent ? 'VENCIDA: contiene partidos que ya comenzaron.' : staleOdds ? 'VENCIDA: cuotas sin vigencia. Vuelve a consultar antes de usarlas.' : '',
      `Casa: ${parlay.bookmakerName || parlay.legs?.[0]?.bookmakerName || 'Sin información'}`,
      ...(parlay.legs || []).map((leg, i) => `${i + 1}. ${eventName(leg)} · ${leg.league}\n${shortDate(leg.startsAt, timezone)} (${timezone})\n${leg.marketLabel || leg.market}: ${exactSelection(leg)} · Cuota ${odds(leg.odds)}`),
      `Cuota total: ${odds(parlay.totalOdds)}`,
      `Actualización: ${shortDate(parlay.updatedAt, timezone)}`,
      'Las cuotas pueden cambiar. No se garantizan ganancias. Solo mayores de 18 años.',
    ].filter(Boolean).join('\n\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea'); field.value = text; field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select(); const success = document.execCommand('copy'); field.remove();
        if (!success) throw new Error('No se pudo copiar');
      }
      setCopied(true); onCopy?.('Combinada copiada para compartir'); setTimeout(() => setCopied(false), 2300);
    } catch { onCopy?.('Tu navegador no permite copiar. Prueba desde una conexión HTTPS.'); }
  }
  return <article className={`parlay-card ${compact ? 'compact-card' : ''} ${expired ? 'expired-card' : ''}`}>
    <div className="card-eyebrow"><span className="card-sport"><SportIcon sport={sports.length === 1 ? sports[0] : null} />{sports.length > 1 ? 'Combinada mixta' : sports[0]?.includes('soccer') || sports[0] === 'football' ? 'Fútbol' : sports[0]?.includes('tennis') ? 'Tenis' : sports[0]?.includes('basket') ? 'Básquetbol' : 'Combinada'}</span><div className="card-badges">{demo && <Pill tone="demo-pill">DEMO</Pill>}{expired && <Pill tone="warning-pill">VENCIDA</Pill>}{!demo && !expired && <Pill tone="live-pill"><span className="status-dot" />Verificada</Pill>}</div></div>
    <div className="card-title-row"><div><span className="eyebrow">{alternative ? 'ALTERNATIVA' : `PROPUESTA ${String(index + 1).padStart(2, '0')}`}</span><h3>{parlay.legs?.length || 0} selecciones<span className="title-dot">.</span></h3></div><div className="total-odds"><span>CUOTA TOTAL</span><strong>{odds(parlay.totalOdds)}</strong></div></div>
    <div className="card-bookmaker"><span className="bookmaker-monogram">{(parlay.bookmakerName || 'C').slice(0, 1)}</span>{parlay.bookmakerName || parlay.legs?.[0]?.bookmakerName || 'Casa no disponible'}<span className="bookmaker-note">{demo ? 'Ficticia' : 'Cuota decimal'}</span></div>
    <div className="legs-list">{(parlay.legs || []).map((leg, i) => <div className="leg" key={leg.id || `${leg.eventId}-${i}`}>
      <span className="leg-number">{String(i + 1).padStart(2, '0')}</span><div className="leg-content"><div className="leg-league">{leg.league}<span> · {shortDate(leg.startsAt, timezone)}</span></div><h4>{eventName(leg)}</h4><div className="selection-line"><span><span className="market-label">{leg.marketLabel || leg.market}</span><strong>{exactSelection(leg)}</strong></span><span className="individual-odds">{odds(leg.odds)}</span></div></div>
    </div>)}</div>
    {expired && <div className="card-warning">{expiredEvent ? 'Esta propuesta venció porque un partido ya comenzó.' : 'La cuota venció. Vuelve a generar la combinada para consultarla.'}</div>}
    {expanded && <div className="card-details">
      <h4><ShieldCheck size={15} /> Información detrás de cada selección</h4>
      {(parlay.legs || []).map((leg, i) => <div className="evidence-block" key={leg.id || i}><strong>{i + 1}. {eventName(leg)}</strong>{(leg.evidence?.length ? leg.evidence : ['Solo se dispone del evento, mercado y cuota entregados por el proveedor.']).map((text, n) => <p key={n}>{typeof text === 'string' ? text : JSON.stringify(text)}</p>)}{(leg.missing || []).map((text, n) => <p className="missing-info" key={n}><CircleHelp size={12} />{typeof text === 'string' ? text : JSON.stringify(text)}</p>)}<small>Fuente: {leg.source || (demo ? 'Datos ficticios de demostración' : 'Proveedor de cuotas')} · {shortDate(leg.updatedAt, timezone)}</small></div>)}
      <p className="probability-note">Probabilidad implícita en la cuota: {((1 / Number(parlay.totalOdds || 1)) * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %. No es una predicción de acierto ni elimina el margen de la casa.</p>
    </div>}
    <div className="card-update"><Clock3 size={12} />Actualizada {shortDate(parlay.updatedAt, timezone)}<span>{timezone === 'America/Santiago' ? 'Hora de Chile' : timezone}</span></div>
    <div className="card-actions"><button className="details-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Ocultar detalles' : 'Ver detalles'}<ChevronDown size={15} className={expanded ? 'rotate' : ''} /></button><button className="copy-button" onClick={copy} aria-label="Copiar combinada">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copiada' : 'Copiar'}</button></div>
  </article>;
}

function MultiSelect({ label, items, values = [], onChange, empty = 'No hay opciones disponibles', placeholder = 'Todas las opciones', disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const choices = [...items, ...values.filter(key => !items.some(item => item.key === key)).map(key => ({ key, name: `${key} · no disponible` }))];
  useEffect(() => {
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <div className="multiselect" ref={ref}><span className="field-label">{label}</span><button className="select-trigger" type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label}><span>{values.length ? names(values, choices) : placeholder}</span><ChevronDown size={15} /></button>{open && <div className="select-menu"><button type="button" className="select-clear" onClick={() => onChange([])}>Limpiar selección</button>{choices.length ? choices.map(item => <label className="checkbox-option" key={item.key}><input type="checkbox" checked={values.includes(item.key)} onChange={event => onChange(event.target.checked ? [...values, item.key] : values.filter(key => key !== item.key))} /><span>{item.name}</span></label>) : <p className="select-empty">{empty}</p>}</div>}</div>;
}

function Daily({ data, loading, error, catalog, mode, dailyFilters, setDailyFilters, timezone, onCopy, onBuild, onChat, refresh }) {
  const [moreFilters, setMoreFilters] = useState(false);
  const proposals = data?.proposals || [];
  return <>
    <section className="hero">
      <div className="hero-content"><span className="hero-eyebrow"><span className="tiny-line" /> MÁS CLARIDAD. MEJORES DECISIONES.</span><h1>Tu próxima combinada,<br /><span>con todo a la vista.</span></h1><p>Explora selecciones, compara cuotas y crea una combinada<br className="desktop-break" /> que se ajuste a lo que tienes en mente.</p><div className="hero-points"><span><ShieldCheck size={15} /> Cuotas transparentes</span><span><Layers3 size={15} /> Una sola casa</span><span><Zap size={15} /> Acceso gratuito</span></div></div>
      <div className="hero-assistant"><div className="assistant-top"><span className="assistant-icon"><Sparkles size={20} /></span><Pill tone="subtle-pill">TU IDEA, TU COMBINADA</Pill></div><h2>Empieza con una idea.</h2><p>Elige tus deportes y tu cuota.<br />Nosotros hacemos las cuentas.</p><button className="hero-create" onClick={onBuild}>Crear mi combinada <ArrowUpRight size={19} /></button><button className="hero-chat" onClick={onChat}>O conversa con el asistente IA <ArrowRight size={14} /></button><div className="hero-decoration" aria-hidden="true"><span /><span /><span /></div></div>
    </section>
    <section className="daily-section">
      <div className="section-heading"><div className="heading-with-icon"><span className="heading-icon"><Layers3 size={20} /></span><div><h2>Combinadas del día</h2><p>{mode === 'demo' ? 'Explora cómo funciona con ejemplos ficticios.' : 'Eventos próximos. Cuotas consultadas al cargar.'}</p></div></div><div className="section-heading-right"><span className="result-count">{proposals.length} propuestas</span><button className={`icon-button ${loading ? 'is-loading' : ''}`} aria-label="Actualizar propuestas" onClick={refresh} disabled={loading}><RefreshCw size={16} /></button></div></div>
      <div className="daily-filter-bar"><div className="sport-tabs"><button className={!dailyFilters.sports ? 'sport-tab selected' : 'sport-tab'} onClick={() => setDailyFilters({ ...dailyFilters, sports: '' })}><Layers3 size={15} />Todos</button>{catalog.sports.map(sport => <button key={sport.key} className={dailyFilters.sports === sport.key ? 'sport-tab selected' : 'sport-tab'} onClick={() => setDailyFilters({ ...dailyFilters, sports: sport.key })}><SportIcon sport={sport.key} size={14} />{sport.name}</button>)}</div><button className={`filter-toggle ${moreFilters ? 'active' : ''}`} onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}><SlidersHorizontal size={15} />Filtros{Boolean(dailyFilters.leagues || dailyFilters.markets || dailyFilters.bookmaker || dailyFilters.minOdds || dailyFilters.maxOdds) && <span className="filter-active-dot" />}<ChevronDown size={14} /></button></div>
      {moreFilters && <div className="expanded-daily-filters"><label><span className="field-label">Liga o competición</span><select value={dailyFilters.leagues || ''} onChange={event => setDailyFilters({ ...dailyFilters, leagues: event.target.value })}><option value="">Todas las ligas</option>{catalog.leagues.filter(league => !dailyFilters.sports || league.sport === dailyFilters.sports).map(league => <option key={league.key} value={league.key}>{league.name}</option>)}</select></label><label><span className="field-label">Mercado</span><select value={dailyFilters.markets || ''} onChange={event => setDailyFilters({ ...dailyFilters, markets: event.target.value })}><option value="">Todos los mercados</option>{catalog.markets.map(market => <option key={market.key} value={market.key}>{market.name}</option>)}</select></label><label><span className="field-label">Casa de apuestas</span><select value={dailyFilters.bookmaker || ''} onChange={event => setDailyFilters({ ...dailyFilters, bookmaker: event.target.value })}><option value="">Todas las casas</option>{catalog.bookmakers.map(bookmaker => <option key={bookmaker.key} value={bookmaker.key}>{bookmaker.name}</option>)}</select></label><div className="odds-range"><span className="field-label">Cuota total</span><div><input type="number" min="1" step="0.1" aria-label="Cuota total mínima" placeholder="Desde" value={dailyFilters.minOdds || ''} onChange={event => setDailyFilters({ ...dailyFilters, minOdds: event.target.value })} /><span>–</span><input type="number" min="1" step="0.1" aria-label="Cuota total máxima" placeholder="Hasta" value={dailyFilters.maxOdds || ''} onChange={event => setDailyFilters({ ...dailyFilters, maxOdds: event.target.value })} /></div></div><button className="text-button clear-filters" onClick={() => setDailyFilters({ sports: '' })}><X size={14} />Limpiar</button></div>}
      {error ? <ErrorMessage retry={refresh}>{error}</ErrorMessage> : loading ? <SkeletonCards /> : proposals.length ? <div className="proposals-grid">{proposals.map((parlay, i) => <ParlayCard key={parlay.id || i} parlay={parlay} index={i} timezone={timezone} onCopy={onCopy} />)}</div> : <EmptyState title="No hay propuestas con estos filtros" onReset={() => setDailyFilters({ sports: '' })}>Prueba otra liga, mercado o rango de cuotas. Solo mostramos lo que está disponible en el catálogo conectado.</EmptyState>}
      {data?.warnings?.length > 0 && <div className="provider-notes">{data.warnings.map((warning, i) => <p key={i}><CircleHelp size={14} />{warning}</p>)}</div>}
    </section>
    <div className="bottom-cta"><div className="bottom-cta-icon"><Target size={23} /></div><div><h3>¿Tienes otra cuota en mente?</h3><p>Arma tu combinación con tus propias condiciones.</p></div><button className="secondary-button" onClick={onBuild}>Abrir constructor <ArrowRight size={16} /></button></div>
  </>;
}

function ResultPanel({ result, catalog, timezone, onCopy }) {
  if (!result) return null;
  return <div className="builder-results" aria-live="polite"><div className="result-heading"><span className="eyebrow">RESULTADO DE TU BÚSQUEDA</span><h2>{result.status === 'matched' ? 'Una combinada a tu medida.' : result.status === 'no_match' ? 'No hay una coincidencia exacta.' : 'No hay selecciones disponibles.'}</h2><p>{result.reason || (result.status === 'matched' ? 'Estas selecciones respetan las condiciones que elegiste.' : 'Prueba ampliar los filtros para encontrar otras opciones.')}</p></div>{result.filters && <FilterSummary filters={result.filters} catalog={catalog} />}{result.parlay && <div className="result-card-wrap"><ParlayCard parlay={result.parlay} timezone={timezone} onCopy={onCopy} /></div>}{result.alternatives?.length > 0 && <><div className="alternative-heading"><h3>Alternativas fuera del margen solicitado</h3><p>Estas opciones no cumplen todas tus condiciones. Revísalas antes de decidir.</p></div><div className="proposals-grid alternatives-grid">{result.alternatives.map((item, i) => <ParlayCard parlay={item.parlay || item} key={item.id || i} index={i} timezone={timezone} onCopy={onCopy} alternative />)}</div></>}{result.warnings?.length > 0 && <div className="provider-notes">{result.warnings.map((warning, i) => <p key={i}><CircleHelp size={14} />{warning}</p>)}</div>}</div>;
}

function Builder({ catalog, filters, setFilters, onBuild, building, result, error, mode, onCopy }) {
  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const activeLeagues = catalog.leagues.filter(league => !filters.sports.length || filters.sports.includes(league.sport));
  const activeMarkets = catalog.markets.filter(market => !filters.sports.length || !market.sports?.length || market.sports.some(sport => filters.sports.includes(sport)));
  const selectedHouse = catalog.bookmakers.find(house => house.key === filters.bookmaker)?.name;
  const unavailable = [...filters.markets, ...filters.excludedMarkets].filter(key => !activeMarkets.some(market => market.key === key));
  const unavailableHouse = filters.bookmaker && !catalog.bookmakers.some(house => house.key === filters.bookmaker);
  const zones = [...new Set([filters.timezone, visitorTimezone(), 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'Europe/Madrid', 'UTC'])];
  return <>
    <div className="page-heading"><span className="eyebrow">HECHA A TU MEDIDA</span><h1>Tu combinada. <span>Tus condiciones.</span></h1><p>Define lo que buscas. Encontraremos selecciones compatibles y haremos las cuentas.</p></div>
    <div className="builder-layout"><form className="builder-form" onSubmit={event => { event.preventDefault(); onBuild(); }}>
      <section className="form-section"><div className="form-section-heading"><span>01</span><h2>Elige tu cancha</h2></div><span className="field-label">Deportes <small>Puedes elegir más de uno</small></span><div className="sport-options">{catalog.sports.map(sport => <button type="button" className={`sport-option ${filters.sports.includes(sport.key) ? 'selected' : ''}`} key={sport.key} aria-pressed={filters.sports.includes(sport.key)} onClick={() => {
        const sports = filters.sports.includes(sport.key) ? filters.sports.filter(key => key !== sport.key) : [...filters.sports, sport.key];
        setFilters(current => ({ ...current, sports }));
      }}><SportIcon sport={sport.key} size={21} /><span>{sport.name}</span>{filters.sports.includes(sport.key) ? <Check size={15} /> : <Plus size={15} />}</button>)}</div><p className="field-hint">Sin selección se consultan todos los deportes del catálogo.</p><div className="form-row"><MultiSelect label="Ligas y competiciones" items={activeLeagues} values={filters.leagues} onChange={value => set('leagues', value)} /><label><span className="field-label">Casa de apuestas</span><select value={filters.bookmaker || ''} onChange={event => set('bookmaker', event.target.value || null)}><option value="">Cualquier casa disponible</option>{unavailableHouse && <option value={filters.bookmaker}>{filters.bookmaker} · no disponible</option>}{catalog.bookmakers.map(house => <option key={house.key} value={house.key}>{house.name}</option>)}</select></label></div></section>
      <section className="form-section"><div className="form-section-heading"><span>02</span><h2>Ajusta tu objetivo</h2></div><span className="field-label">Número de partidos</span><div className="count-options">{[1, 2, 3, 4, 5, 6].map(count => <button type="button" key={count} className={Number(filters.legCount) === count ? 'selected' : ''} aria-pressed={Number(filters.legCount) === count} onClick={() => set('legCount', count)}>{count}</button>)}</div><div className="form-row"><label><span className="field-label">Cuota total objetivo</span><div className="input-with-icon"><Target size={17} /><input type="number" min="1.01" max="10000" step="0.01" required value={filters.targetOdds} onChange={event => set('targetOdds', event.target.value === '' ? '' : Number(event.target.value))} /></div></label><label><span className="field-label">Margen de aproximación <CircleHelp size={13} aria-label="Diferencia permitida por arriba o debajo de la cuota objetivo" /></span><div className="input-with-icon"><span className="input-sign">±</span><input type="number" min="0" max="1000" step="0.01" required value={filters.tolerance} onChange={event => set('tolerance', event.target.value === '' ? '' : Number(event.target.value))} /></div></label></div><div className="target-explainer"><BarChart3 size={16} />Buscaremos una cuota entre <strong>{odds(Math.max(1, Number(filters.targetOdds) - Number(filters.tolerance)))}</strong> y <strong>{odds(Number(filters.targetOdds) + Number(filters.tolerance))}</strong>.</div></section>
      <section className="form-section"><div className="form-section-heading"><span>03</span><h2>Define los detalles</h2></div><div className="form-row"><MultiSelect label="Mercados permitidos" placeholder="Todos los mercados" items={activeMarkets} values={filters.markets} onChange={value => setFilters(current => ({ ...current, markets: value, excludedMarkets: current.excludedMarkets.filter(key => !value.includes(key)) }))} /><MultiSelect label="Mercados excluidos" placeholder="Ningún mercado excluido" items={activeMarkets} values={filters.excludedMarkets} onChange={value => setFilters(current => ({ ...current, excludedMarkets: value, markets: current.markets.filter(key => !value.includes(key)) }))} /></div>{(unavailable.length > 0 || unavailableHouse) && <p className="field-hint unavailable-hint"><CircleHelp size={13} />Algunas condiciones elegidas no están disponibles en este catálogo. Las conservamos; la búsqueda indicará si no hay resultados.</p>}{!catalog.coverage?.corners && <p className="field-hint"><CircleHelp size={13} />El proveedor conectado no ofrece córners verificados en este catálogo.</p>}<div className="form-row"><label><span className="field-label">Fecha de los partidos</span><input type="date" value={filters.date || ''} onChange={event => set('date', event.target.value || null)} /></label><label><span className="field-label">Zona horaria</span><select value={filters.timezone} onChange={event => set('timezone', event.target.value)}>{zones.map(zone => <option key={zone} value={zone}>{zone === 'America/Santiago' ? 'Chile · America/Santiago' : zone}</option>)}</select></label></div><div className="form-row"><label><span className="field-label">Equipos o jugadores a incluir</span><NamesInput placeholder="Ej.: Real Madrid, Alcaraz" values={filters.include} onChange={value => set('include', value)} /><small className="field-hint">Separa los nombres con comas.</small></label><label><span className="field-label">Equipos o jugadores a excluir</span><NamesInput placeholder="Ej.: Barcelona, Djokovic" values={filters.exclude} onChange={value => set('exclude', value)} /></label></div></section>
      {error && <ErrorMessage>{error}</ErrorMessage>}<div className="form-submit"><p><ShieldCheck size={16} />Selecciones de partidos distintos, en una sola casa.</p><button className="primary-button" type="submit" disabled={building || !catalog.sports.length}>{building ? <><LoaderCircle size={17} className="spin" />Buscando selecciones…</> : <>Crear combinada <ArrowRight size={17} /></>}</button></div>
    </form><aside className="builder-summary"><div className="summary-card"><div className="summary-icon"><Target size={23} /></div><span className="eyebrow">TU COMBINADA, EN UN VISTAZO</span><h2>{odds(filters.targetOdds)}<small>CUOTA OBJETIVO</small></h2><div className="summary-item"><span>Partidos</span><strong>{filters.legCount}</strong></div><div className="summary-item"><span>Margen</span><strong>± {odds(filters.tolerance)}</strong></div><div className="summary-item"><span>Deportes</span><strong>{filters.sports.length ? names(filters.sports, catalog.sports) : 'Todos'}</strong></div><div className="summary-item"><span>Casa</span><strong>{selectedHouse || 'Una casa disponible'}</strong></div><div className="summary-footer"><ShieldCheck size={16} /><p>No ajustaremos tus condiciones sin avisarte. Si no hay coincidencias, verás alternativas identificadas.</p></div></div><div className="small-info-card"><CircleHelp size={17} /><div><h3>¿Cómo se calcula?</h3><p>Multiplicamos las cuotas decimales de cada selección. Las cuotas pueden cambiar al apostar.</p></div></div>{mode === 'demo' && <div className="small-info-card demo-info"><Zap size={17} /><div><h3>Estás explorando una demo</h3><p>Los filtros y cálculos funcionan con eventos ficticios. No son apuestas del día.</p></div></div>}</aside></div>
    <ResultPanel result={result} catalog={catalog} timezone={filters.timezone} onCopy={onCopy} />
  </>;
}

function Chat({ status, catalog, filters, setFilters, mode, onCopy, onBuilder, conversation, setConversation, previous, setPrevious }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const configured = Boolean(status?.ai?.configured);
  useEffect(() => { if (conversation.length) threadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [conversation.length]);
  async function submit(event) {
    event.preventDefault(); if (!message.trim() || sending || !configured) return;
    const text = message.trim(); setMessage(''); setSending(true); setError('');
    setConversation(current => [...current, { role: 'user', message: text }]);
    try {
      const answer = await api('/api/chat', { message: text, filters, previous });
      if (answer.filters) setFilters({ ...filters, ...answer.filters });
      if (answer.result?.parlay) setPrevious(answer.result.parlay);
      setConversation(current => [...current, { role: 'assistant', ...answer }]);
    } catch (err) { setError(err.message); setMessage(text); }
    finally { setSending(false); }
  }
  function example(text) { setMessage(text); inputRef.current?.focus(); }
  return <>
    <div className="page-heading"><span className="eyebrow">CONVERSA. AJUSTA. EXPLORA.</span><h1>Una idea es <span>un buen comienzo.</span></h1><p>Describe tu combinada en español. El asistente interpreta tus condiciones y consulta el catálogo.</p></div>
    <div className="chat-layout"><section className="chat-panel"><div className="chat-panel-header"><div className="assistant-icon"><Sparkles size={18} /></div><div><h2>Asistente Cuota Clara</h2><p>{configured ? `Acceso IA configurado · ${status.ai.model || 'Servicio real'}` : 'IA pendiente de conexión'}</p></div><Pill tone={configured ? 'live-pill' : 'subtle-pill'}>{configured ? <><span className="status-dot" />Configurada</> : 'Sin configurar'}</Pill></div><div className="chat-content">
      {!conversation.length && <div className="chat-welcome"><span className="chat-welcome-symbol"><Sparkles size={30} /></span><h3>¿Qué combinada tienes en mente?</h3><p>Indica deportes, mercados y cuota objetivo.<br />También podrás pedir cambios a una propuesta.</p>{!configured && <div className="ai-disconnected"><Settings2 size={19} /><div><strong>Conecta una IA para conversar</strong><p>Esta versión no tiene credenciales de IA. Puedes probar todos los filtros y cálculos desde el constructor.</p><button className="text-button" onClick={onBuilder}>Abrir constructor <ArrowRight size={14} /></button></div></div>}<span className="examples-label">ALGUNAS IDEAS PARA EMPEZAR</span><div className="chat-examples">{EXAMPLES.map((text, i) => <button key={i} onClick={() => example(text)}><span>{text}</span><ArrowUpRight size={16} /></button>)}</div>{!configured && <p className="examples-note">Los ejemplos solo rellenan el mensaje. Se procesarán al conectar un servicio de IA real.</p>}</div>}
      {conversation.map((entry, i) => <div key={i} className={`chat-entry ${entry.role}`}><div className="chat-avatar">{entry.role === 'user' ? 'TÚ' : <Sparkles size={16} />}</div><div className="chat-entry-body"><span className="chat-author">{entry.role === 'user' ? 'Tú' : 'Cuota Clara'}</span><p>{entry.message}</p>{entry.filters && <><span className="understood-label"><Filter size={13} />Filtros interpretados</span><FilterSummary filters={entry.filters} catalog={catalog} /></>}{entry.changes?.length > 0 && <div className="provider-notes">{entry.changes.map((change, n) => <p key={n}><RefreshCw size={13} />{changeLabel(change)}</p>)}</div>}{entry.result && <ResultPanel result={entry.result} catalog={catalog} timezone={filters.timezone} onCopy={onCopy} />}{entry.warnings?.map((warning, n) => <p className="chat-warning" key={n}><CircleHelp size={13} />{warning}</p>)}</div></div>)}
      {sending && <div className="chat-entry assistant"><div className="chat-avatar"><Sparkles size={16} /></div><div className="chat-working"><LoaderCircle size={16} className="spin" />Interpretando condiciones y consultando selecciones…</div></div>}<div ref={threadRef} />
    </div>{error && <ErrorMessage>{error}</ErrorMessage>}<form className="chat-composer" onSubmit={submit}><div className="composer-input"><textarea ref={inputRef} rows={2} value={message} onChange={event => setMessage(event.target.value)} placeholder={configured ? 'Ej.: 3 partidos de fútbol, cuota cercana a 2,00…' : 'Escribe una idea para cuando conectes la IA…'} aria-label="Mensaje al asistente IA" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(event); } }} /><button type="submit" className="send-button" disabled={!configured || sending || !message.trim()} aria-label="Enviar mensaje" title={!configured ? 'Conecta las credenciales de IA en el servidor' : 'Enviar mensaje'}>{sending ? <LoaderCircle size={19} className="spin" /> : <ArrowUpRight size={22} />}</button></div><p><ShieldCheck size={12} />{configured ? 'La IA interpreta tu pedido. Los eventos y cuotas proceden del catálogo conectado.' : 'Sin IA conectada: no se generan respuestas ni se envían tus mensajes.'}</p></form></section><aside className="chat-sidebar"><div className="chat-side-card"><span className="eyebrow">TÚ TIENES EL CONTROL</span><h3>Afina tu propuesta.</h3><p>Después de crear una combinada, puedes pedir:</p><div className="followup-example"><RefreshCw size={15} />“Cambia el segundo partido”</div><div className="followup-example"><X size={15} />“Quita el tenis”</div><div className="followup-example"><Target size={15} />“Acércala a una cuota de 2,00”</div><div className="sidebar-divider" /><p className="small-text">El asistente mostrará los filtros que entendió y recalculará la cuota tras cada cambio.</p></div><div className="small-info-card"><ShieldCheck size={18} /><div><h3>Datos antes que promesas</h3><p>No inventamos partidos ni cuotas. Una propuesta nunca garantiza ganancias.</p></div></div>{mode === 'demo' && <div className="small-info-card demo-info"><Zap size={18} /><div><h3>Catálogo de demostración</h3><p>Conectar la IA no cambia los datos ficticios. Las cuotas reales requieren acceso al proveedor.</p></div></div>}</aside></div>
  </>;
}

export default function App() {
  const [page, setPage] = useState('daily');
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [status, setStatus] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  const [dailyData, setDailyData] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState('');
  const [dailyFilters, setDailyFilters] = useState({ sports: '' });
  const [dailyRefresh, setDailyRefresh] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [buildError, setBuildError] = useState('');
  const [toast, setToast] = useState('');
  const [conversation, setConversation] = useState([]);
  const [previous, setPrevious] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [, setTimeTick] = useState(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const mode = status?.mode || catalog.mode || dailyData?.mode || 'demo';
  const pageMeta = NAV.find(item => item.key === page);
  const catalogScope = page === 'daily' ? dailyFilters.leagues || '' : filters.leagues.join(',');
  useEffect(() => {
    const controller = new AbortController();
    api('/api/status', undefined, controller.signal).then(data => { if (!controller.signal.aborted) setStatus(data); }).catch(() => { if (!controller.signal.aborted) setConfigurationError('No pudimos comprobar la conexión del servidor. Vuelve a actualizar.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (catalogScope) params.set('leagues', catalogScope);
    api(`/api/catalog?${params}`, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) { setCatalog({ ...EMPTY_CATALOG, ...data }); setConfigurationError(''); }
    }).catch(err => {
      if (!controller.signal.aborted) setConfigurationError(`No pudimos actualizar el catálogo. ${err.message}`);
    });
    return () => controller.abort();
  }, [catalogScope]);
  useEffect(() => {
    const controller = new AbortController(); setDailyLoading(true); setDailyError('');
    const params = new URLSearchParams();
    Object.entries(dailyFilters).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined) params.set(key, value); });
    api(`/api/parlays/daily?${params}`, undefined, controller.signal).then(data => { if (!controller.signal.aborted) setDailyData(data); }).catch(err => { if (!controller.signal.aborted) setDailyError(err.message); }).finally(() => { if (!controller.signal.aborted) setDailyLoading(false); });
    return () => controller.abort();
  }, [dailyFilters, dailyRefresh]);
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) setDailyRefresh(value => value + 1); }, 60_000);
    const timer = setInterval(() => setTimeTick(value => value + 1), 15_000);
    const visible = () => { if (!document.hidden) { setDailyRefresh(value => value + 1); setTimeTick(value => value + 1); } };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(interval); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => { setBuildResult(null); setBuildError(''); }, [filters]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!showInfo) return;
    const previousFocus = document.activeElement;
    const dialog = document.querySelector('.info-modal');
    dialog?.querySelector('button')?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') setShowInfo(false);
      if (event.key !== 'Tab') return;
      const controls = dialog?.querySelectorAll('button:not(:disabled), a[href], input, select, textarea');
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previousFocus?.focus(); };
  }, [showInfo]);
  useEffect(() => { document.title = `${pageMeta.label} · Cuota Clara`; }, [pageMeta]);
  function navigate(next) { setPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  async function build() {
    setBuilding(true); setBuildError(''); setBuildResult(null);
    const requestedFilters = JSON.stringify(filters);
    try {
      const result = await api('/api/parlays/build', { ...filters, targetOdds: Number(filters.targetOdds), tolerance: Number(filters.tolerance), include: filters.include.map(name => name.trim()), exclude: filters.exclude.map(name => name.trim()) });
      if (JSON.stringify(filtersRef.current) !== requestedFilters) {
        setBuildError('Cambiaste los filtros durante la consulta. Vuelve a crear la combinada con tus nuevas condiciones.');
        return;
      }
      setBuildResult(result); if (result.parlay) setPrevious(result.parlay);
      setTimeout(() => document.querySelector('.builder-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) { setBuildError(err.message); }
    finally { setBuilding(false); }
  }
  return <RuntimeContext.Provider value={{ maxAgeMinutes: status?.provider?.maxAgeMinutes || 15 }}><div className="app-shell">
    <aside className="sidebar"><button className="brand-button" onClick={() => navigate('daily')} aria-label="Cuota Clara, inicio"><Brand /></button><div className="sidebar-label">TU ESPACIO DE JUEGO</div><nav className="desktop-nav" aria-label="Navegación principal">{NAV.map(({ key, label, icon: Icon }) => <button key={key} className={page === key ? 'nav-item active' : 'nav-item'} onClick={() => navigate(key)}><Icon size={19} /><span>{label}</span>{page === key && <span className="nav-active-dot" />}{key === 'chat' && page !== key && <span className="nav-ai-badge">IA</span>}</button>)}</nav><div className="sidebar-tip"><span className="tip-icon"><CircleHelp size={19} /></span><h3>La cuota no lo es todo.</h3><p>Revisa la información detrás de cada selección y decide con criterio.</p><button onClick={() => setShowInfo(true)}>Cómo funciona <ArrowUpRight size={13} /></button></div><div className="sidebar-bottom"><div className="connection-status"><span className={`status-dot ${mode === 'demo' ? 'amber' : ''}`} />{mode === 'demo' ? 'Entorno de demostración' : status?.provider?.lastSuccessAt ? 'Proveedor conectado' : 'Proveedor configurado'}</div><div className="sidebar-bottom-rule" /><div className="responsible-row"><span className="age-badge">18+</span><p>Juega con responsabilidad.<br />No hay ganancias garantizadas.</p></div></div></aside>
    <div className="main-shell"><header className="topbar"><button className="mobile-brand brand-button" onClick={() => navigate('daily')}><Brand compact /></button><div className="breadcrumb"><span>Explora tu juego</span><ChevronRight size={13} /><strong>{pageMeta.label}</strong></div><div className="topbar-right"><span className="free-badge"><span className="status-dot" />Siempre gratis</span><button className="icon-button help-button" onClick={() => setShowInfo(true)} aria-label="Cómo funciona Cuota Clara"><CircleHelp size={19} /></button><span className="avatar">CC</span></div></header>
      <main className="main-content">
        <div className={`mode-banner ${mode === 'live' ? 'live-banner' : ''}`}><div><span className="banner-symbol">{mode === 'demo' ? <Zap size={16} /> : <ShieldCheck size={16} />}</span><strong>{mode === 'demo' ? 'Modo demostración' : 'Datos del proveedor conectado'}</strong><span className="banner-dot">·</span><span>{mode === 'demo' ? 'Eventos y cuotas ficticios. No son recomendaciones actuales.' : 'Las cuotas pueden cambiar. Verifica siempre en la casa de apuestas.'}</span></div><button onClick={() => setShowInfo(true)}>Más información <ArrowUpRight size={13} /></button></div>
        {configurationError && <ErrorMessage>{configurationError}</ErrorMessage>}
        {page === 'daily' && <Daily data={dailyData} loading={dailyLoading} error={dailyError} catalog={catalog} mode={mode} dailyFilters={dailyFilters} setDailyFilters={setDailyFilters} timezone={filters.timezone} onCopy={setToast} onBuild={() => navigate('builder')} onChat={() => navigate('chat')} refresh={() => setDailyRefresh(value => value + 1)} />}
        {page === 'builder' && <Builder catalog={catalog} filters={filters} setFilters={setFilters} onBuild={build} building={building} result={buildResult} error={buildError} mode={mode} onCopy={setToast} />}
        {page === 'chat' && <Chat status={status} catalog={catalog} filters={filters} setFilters={setFilters} mode={mode} onCopy={setToast} onBuilder={() => navigate('builder')} conversation={conversation} setConversation={setConversation} previous={previous} setPrevious={setPrevious} />}
        <footer className="page-footer"><span>Cuota Clara<span className="brand-period">.</span> <span className="footer-separator">/</span> Combinadas con criterio.</span><p>Solo para mayores de 18 años. Apostar implica riesgo de perder dinero.</p><span>{filters.timezone === 'America/Santiago' ? 'Horarios de Chile' : filters.timezone}</span></footer>
      </main>
    </div><nav className="mobile-nav" aria-label="Navegación móvil">{NAV.map(({ key, short, icon: Icon }) => <button key={key} className={page === key ? 'active' : ''} onClick={() => navigate(key)}><Icon size={20} /><span>{short}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    {showInfo && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setShowInfo(false); }}><section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title"><button className="modal-close icon-button" aria-label="Cerrar información" onClick={() => setShowInfo(false)}><X size={20} /></button><span className="summary-icon"><ShieldCheck size={25} /></span><span className="eyebrow">TRANSPARENCIA EN CADA SELECCIÓN</span><h2 id="info-title">Así funciona Cuota Clara.</h2><p>Construimos combinadas multiplicando cuotas decimales de selecciones de partidos distintos, siempre dentro de una sola casa de apuestas.</p><div className="info-mode"><strong>{mode === 'demo' ? 'Ahora: demostración funcional' : 'Ahora: catálogo conectado'}</strong><p>{mode === 'demo' ? 'Los eventos, casas y cuotas son ejemplos ficticios. Los filtros, cálculos y copias funcionan; no representan recomendaciones actuales.' : 'El catálogo refleja los eventos y mercados disponibles en el proveedor configurado. Consultamos la vigencia de los eventos y sus cuotas.'}</p></div><div className="info-row"><span>Proveedor</span><strong>{status?.provider?.name || 'Sin información'} {status?.provider?.configured ? '· Configurado' : '· Pendiente de acceso'}</strong></div><div className="info-row"><span>Asistente IA</span><strong>{status?.ai?.configured ? `Acceso configurado · ${status.ai.model || 'Servicio real'}` : 'Pendiente de credenciales'}</strong></div><div className="info-row"><span>Córners</span><strong>{catalog.coverage?.corners ? mode === 'demo' ? 'Disponible solo en ejemplos ficticios' : 'Disponible en el catálogo' : 'Sin cobertura verificada'}</strong></div>{catalog.coverage?.notes?.map((note, i) => <p className="coverage-note" key={i}><CircleHelp size={14} />{note}</p>)}<p className="responsible-notice">No garantizamos ganancias. Una cuota o su probabilidad implícita no es una predicción de acierto. Revisa siempre la cuota y la selección exacta antes de apostar.</p><button className="primary-button" onClick={() => setShowInfo(false)}>Entendido <Check size={16} /></button></section></div>}
  </div></RuntimeContext.Provider>;
}
