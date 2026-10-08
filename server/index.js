import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
const server = createApp().listen(port, '0.0.0.0', () => {
  console.log(`Cuota Clara disponible en el puerto ${port}. Modo de datos: ${process.env.ODDS_API_KEY ? 'real' : 'demostración ficticia'}.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
