import { createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono, type Context as HonoContext } from 'hono';
import { z } from 'zod';
import { jarvisWorkSchema, type Context, type Service } from './contract';
import { jobQueue } from './jobs';

// The Atelier's doors, all made from the registry: `GET /catalog` (what it offers), `POST
// /jobs/:service` (do it — now, or later for Jarvis with its work token), `GET /jobs/:id` (how it
// went), and `/mcp` (each service a tool, for Claude or any assistant). One key (Bearer) per caller.

export interface Settings {
  services: Service[];
  /** The keys allowed to ask for work (ATELIER_KEYS, comma separated). */
  keys: string[];
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  version?: string;
}

const digest = (text: string) => createHash('sha256').update(text).digest();

export function makeApp(settings: Settings) {
  const app = new Hono();
  const byName = new Map(settings.services.map((one) => [one.name, one]));
  const fetcher = settings.fetch ?? fetch;
  const context = (): Omit<Context, 'signal'> => ({ fetch: fetcher, env: settings.env });
  const queue = jobQueue(context);
  const allowed = settings.keys.filter(Boolean).map(digest);

  /** Whether the request carries one of the keys (compared without leaking timing). */
  const signedIn = (c: HonoContext) => {
    const given = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    if (!given) return false;
    const mine = digest(given);
    return allowed.some((one) => timingSafeEqual(one, mine));
  };

  const catalog = () =>
    settings.services.map((one) => ({
      name: one.name,
      title: one.title,
      description: one.description,
      input: z.toJSONSchema(one.input),
      ...(one.writes ? { writes: one.writes } : {}),
      long: Boolean(one.long),
      minutes: one.minutes ?? 15,
      path: `/jobs/${one.name}`,
      ready: (one.needs ?? []).every((name) => Boolean(settings.env[name])),
    }));

  /** Work done now, within its time. */
  const runNow = async (one: Service, input: unknown) =>
    one.run(one.input.parse(input), {
      ...context(),
      signal: AbortSignal.timeout(Math.min(one.minutes ?? 15, 5) * 60_000),
    });

  app.get('/health', (c) =>
    c.json({ status: 'healthy', version: settings.version ?? 'local', services: byName.size }),
  );
  app.get('/catalog', (c) => c.json({ services: catalog() }));

  app.post('/jobs/:service', async (c) => {
    if (!signedIn(c)) return c.json({ error: 'A key of the Atelier is needed.' }, 401);
    const one = byName.get(c.req.param('service'));
    if (!one) return c.json({ error: `No service « ${c.req.param('service')} ».` }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { jarvis, ...rest } = body;
    // For Jarvis, long work: accepted now, sent back with its token when done.
    if (jarvis !== undefined) {
      const work = jarvisWorkSchema.safeParse(jarvis);
      if (!work.success)
        return c.json({ error: 'The `jarvis` part is not a work of Jarvis.' }, 400);
      const parsed = one.input.safeParse(rest);
      if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
      const { job } = queue.start(one, rest, work.data);
      return c.json({ accepted: true, job: job.id }, 202);
    }
    const parsed = one.input.safeParse(rest);
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    try {
      return c.json(await runNow(one, rest));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 502);
    }
  });

  app.get('/jobs/:id', (c) => {
    if (!signedIn(c)) return c.json({ error: 'A key of the Atelier is needed.' }, 401);
    const job = queue.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'No such job (kept a day).' }, 404);
  });

  // Each service a tool, for an assistant; stateless, every request stands alone.
  app.all('/mcp', async (c) => {
    if (!signedIn(c)) return c.json({ error: 'A key of the Atelier is needed.' }, 401);
    const server = new McpServer({ name: 'jarvis-atelier', version: settings.version ?? '0.1.0' });
    for (const one of settings.services) {
      server.registerTool(
        one.name,
        { title: one.title, description: one.description, inputSchema: one.input.shape },
        async (args: unknown) => {
          try {
            const outcome = await runNow(one, args);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(outcome) }],
              structuredContent: outcome as unknown as Record<string, unknown>,
            };
          } catch (error) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: (error as Error).message }],
            };
          }
        },
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return { app, queue };
}
