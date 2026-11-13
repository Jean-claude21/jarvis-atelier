import { serve } from '@hono/node-server';
import { makeApp } from './app';
import { SERVICES } from './services';

// `pnpm dev` / the container: the Atelier on PORT (3000), its keys and secrets from the environment.
const port = Number(process.env.PORT ?? 3000);
const keys = (process.env.ATELIER_KEYS ?? '').split(',').map((one) => one.trim());
if (!keys.some(Boolean))
  console.warn('[atelier] no ATELIER_KEYS: every request for work is refused');
const { app } = makeApp({
  services: SERVICES,
  keys,
  env: process.env,
  version: process.env.ATELIER_RELEASE ?? 'local',
});
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () =>
  console.info(`Jarvis Atelier on port ${port}: ${SERVICES.map((one) => one.name).join(', ')}`),
);
