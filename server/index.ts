import { createApp } from './app.ts';

process.on('uncaughtException', (err) => {
  console.error('[AdaptLearn API] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[AdaptLearn API] Unhandled rejection:', reason);
});

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`AdaptLearn API ready at http://localhost:${port}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

