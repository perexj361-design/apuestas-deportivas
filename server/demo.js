export const DEMO_SOURCE = 'Demostración ficticia · no son recomendaciones actuales';

const SPORTS = [
  { key: 'football', name: 'Fútbol' },
  { key: 'tennis', name: 'Tenis' },
  { key: 'basketball', name: 'Básquetbol' },
];
const LEAGUES = [
  { key: 'demo_football_iberia', name: 'Liga Iberia · ficticia', sport: 'football' },
  { key: 'demo_football_pacifico', name: 'Liga Pacífico · ficticia', sport: 'football' },
  { key: 'demo_tennis', name: 'Circuito Horizonte · ficticio', sport: 'tennis' },
  { key: 'demo_basketball', name: 'Liga Canasta · ficticia', sport: 'basketball' },
];
const BOOKMAKERS = [
  { key: 'demo_norte', name: 'Casa Norte · ficticia' },
  { key: 'demo_sur', name: 'Casa Sur · ficticia' },
];
const MARKETS = [
  { key: 'h2h', name: 'Ganador del partido', sports: ['football', 'tennis', 'basketball'] },
  { key: 'totals', name: 'Total de goles, juegos o puntos', sports: ['football', 'tennis', 'basketball'] },
  { key: 'corners', name: 'Total de córners', sports: ['football'] },
  { key: 'spreads', name: 'Hándicap', sports: ['football', 'tennis', 'basketball'] },
];
const MATCHES = [
  ['football', 'demo_football_iberia', 'Atlético Bruma', 'Deportivo Alba'],
  ['football', 'demo_football_iberia', 'Unión Roble', 'Estrella Río'],
  ['football', 'demo_football_iberia', 'Sporting Aurora', 'Real Sendero'],
  ['football', 'demo_football_iberia', 'Racing Nube', 'Club Olivo'],
  ['football', 'demo_football_pacifico', 'Puerto Esmeralda', 'Cóndores del Mar'],
  ['football', 'demo_football_pacifico', 'Lobos del Valle', 'Sol Andino'],
  ['tennis', 'demo_tennis', 'Alex Demo', 'Bruno Ejemplo'],
  ['tennis', 'demo_tennis', 'Carla Ficticia', 'Diana Muestra'],
  ['tennis', 'demo_tennis', 'Elena Demo', 'Fiona Ejemplo'],
  ['tennis', 'demo_tennis', 'Gabriel Ficticio', 'Hugo Muestra'],
  ['basketball', 'demo_basketball', 'Halcones Horizonte', 'Pumas Aurora'],
  ['basketball', 'demo_basketball', 'Titanes del Bosque', 'Cometas de Plata'],
  ['basketball', 'demo_basketball', 'Rayos del Lago', 'Dragones Celestes'],
  ['basketball', 'demo_basketball', 'Toros del Sur', 'Búhos del Norte'],
  ['football', 'demo_football_iberia', 'Club Nebulosa', 'Deportivo Mirador'],
  ['football', 'demo_football_pacifico', 'Bahía Coral', 'Faro Austral'],
];

export function demoCatalog(now = Date.now()) {
  return {
    mode: 'demo', sports: SPORTS, leagues: LEAGUES, markets: MARKETS, bookmakers: BOOKMAKERS,
    coverage: {
      corners: true,
      notes: [
        'Todos los eventos, participantes, ligas, casas y cuotas de esta demostración son ficticios.',
        'Los córners de la demo no acreditan cobertura del proveedor real.',
        'Sin ODDS_API_KEY no se consultan cuotas reales ni se generan recomendaciones actuales.',
      ],
    },
    updatedAt: new Date(now).toISOString(),
  };
}

export function demoSelections(now = Date.now()) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const stamp = day.toISOString().slice(0, 10);
  const selections = [];
  for (const [index, [sport, leagueKey, home, away]] of MATCHES.entries()) {
    // The sample schedule is attached to its generation day. Past samples expire normally.
    const startsAt = new Date(day.getTime() + (25 + index * 0.8) * 3_600_000).toISOString();
    const league = LEAGUES.find(item => item.key === leagueKey).name;
    const eventId = `demo-${stamp}-${index + 1}`;
    for (const [bookIndex, book] of BOOKMAKERS.entries()) {
      const variants = [
        ['h2h', 'Ganador del partido', null, home, 1.12 + (index % 6) * 0.12],
        ['totals', sport === 'football' ? 'Total de goles' : sport === 'tennis' ? 'Total de juegos' : 'Total de puntos',
          sport === 'football' ? 1.5 : sport === 'tennis' ? 19.5 : 169.5,
          'Más de', 1.18 + (index % 7) * 0.13],
        ['spreads', 'Hándicap', sport === 'football' ? 1.5 : sport === 'tennis' ? 3.5 : 7.5,
          home, 1.30 + (index % 5) * 0.15],
      ];
      if (sport === 'football') variants.push(['corners', 'Total de córners', 8.5, 'Más de', 1.16 + (index % 5) * 0.16]);
      for (const [market, marketLabel, line, outcome, price] of variants) {
        const odds = Number((price + bookIndex * 0.03).toFixed(2));
        selections.push({
          id: `${eventId}:${book.key}:${market}:0`, eventId, sport, leagueKey, league, home, away,
          startsAt, market, marketLabel, line, outcome, odds,
          bookmakerKey: book.key, bookmakerName: book.name, updatedAt: new Date(now).toISOString(),
          source: DEMO_SOURCE, demo: true,
          evidence: [`Ejemplo ficticio de ${marketLabel.toLowerCase()} con cuota decimal ${odds.toFixed(2)}.`, 'El horario corresponde a la programación de la demostración.'],
          missing: ['No hay estadísticas, lesiones ni información real de participantes.', 'La cuota ficticia no está disponible en una casa de apuestas real.'],
        });
      }
    }
  }
  return selections;
}
