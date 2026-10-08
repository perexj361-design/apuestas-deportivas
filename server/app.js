import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultProvider, ProviderError } from './provider.js';
import { buildParlay, dailyParlays, normalizeFilters } from './engine.js';
import { handleChat, getAiStatus } from './chat.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comma = value => typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function queryFilters(query) {
  return {
    sports: comma(query.sports), leagues: comma(query.leagues), markets: comma(query.markets),
    bookmaker: typeof query.bookmaker === 'string' && query.bookmaker ? query.bookmaker : null,
    ...(typeof query.date === 'string' && query.date ? { date: query.date } : {}),
    ...(typeof query.timezone === 'string' && query.timezone ? { timezone: query.timezone } : {}),
  };
}

export function createApp({ provider = defaultProvider, ai, chatHandler = handleChat, rateLimits = true, serveStatic = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet({
    // A reverse proxy may terminate HTTPS. Local preview remains accessible over HTTP.
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
    contentSecurityPolicy: { directives: {
      'default-src': ["'self'"], 'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'], 'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"], 'object-src': ["'none'"], 'frame-ancestors': ["'self'"],
      'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
    } },
  }));
  app.use(express.json({ limit: '24kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  if (rateLimits) {
    app.use('/api', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Has enviado demasiadas consultas. Espera un minuto antes de continuar.', code: 'RATE_LIMITED' } }));
    app.use('/api/chat', rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'El chat permite 6 consultas por minuto. Espera antes de volver a intentar.', code: 'CHAT_RATE_LIMITED' } }));
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/status', (req, res) => res.json({ ...provider.getStatus(), ai: getAiStatus() }));
  app.get('/api/catalog', asyncRoute(async (req, res) => {
    const filters = normalizeFilters(queryFilters(req.query));
    res.json(await provider.getCatalog({ leagues: filters.leagues, bookmaker: filters.bookmaker }));
  }));
  app.get('/api/events', asyncRoute(async (req, res) => {
    const filters = normalizeFilters(queryFilters(req.query));
    const selections = (await provider.getSelections(filters)).filter(item => !filters.sports.length || filters.sports.includes(item.sport));
    res.json({ mode: provider.getStatus().mode, selections, updatedAt: new Date().toISOString() });
  }));
  app.get('/api/parlays/daily', asyncRoute(async (req, res) => {
    const filters = queryFilters(req.query);
    normalizeFilters(filters);
    const minOdds = req.query.minOdds === undefined || req.query.minOdds === '' ? 1 : Number(req.query.minOdds);
    const maxOdds = req.query.maxOdds === undefined || req.query.maxOdds === '' ? Infinity : Number(req.query.maxOdds);
    if (!Number.isFinite(minOdds) || minOdds < 1 || (maxOdds !== Infinity && (!Number.isFinite(maxOdds) || maxOdds < minOdds))) {
      throw new ProviderError('El rango de cuota total no es válido.', 'INVALID_FILTERS', 422);
    }
    const selections = await provider.getSelections(filters);
    const proposals = dailyParlays(selections, filters).filter(parlay => parlay.totalOdds >= minOdds && parlay.totalOdds <= maxOdds);
    res.json({ mode: provider.getStatus().mode, proposals, updatedAt: new Date().toISOString(),
      warnings: proposals.length ? [] : ['No hay propuestas vigentes que cumplan todos los filtros. Prueba otro rango o competición.'] });
  }));
  app.post('/api/parlays/build', asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new ProviderError('Envía los filtros de la combinada en JSON.', 'INVALID_FILTERS', 422);
    const filters = normalizeFilters(Object.hasOwn(req.body, 'filters') ? req.body.filters : req.body);
    const selections = await provider.getSelections(filters);
    const result = buildParlay(selections, filters, { previous: req.body.previous, replaceIndex: req.body.replaceIndex });
    res.json({ ...result, mode: provider.getStatus().mode });
  }));
  app.post('/api/chat', asyncRoute(async (req, res) => {
    res.json(await chatHandler(req.body, { provider, ai }));
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Esa ruta de la API no existe.', code: 'NOT_FOUND' }));

  const dist = path.join(repoRoot, 'dist');
  if (serveStatic && existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'La solicitud no contiene JSON válido.', code: 'INVALID_JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.', code: 'BODY_TOO_LARGE' });
    const status = error.statusCode || error.status || (error.type === 'entity.too.large' ? 413 : 500);
    const safe = status >= 400 && status < 500 || error instanceof ProviderError || error.name === 'ChatError';
    res.status(status >= 400 && status <= 599 ? status : 500).json({
      error: safe ? error.message : 'No fue posible completar la consulta. Intenta nuevamente.',
      code: error.code || (status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR'),
    });
  });
  return app;
}
