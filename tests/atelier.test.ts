import { describe, expect, it } from 'vitest';
import { makeApp } from '../src/app';
import { textOf, readable } from '../src/services/lire-page';
import { SERVICES } from '../src/services';

// The Atelier from outside: its catalogue, a key needed for work, work done now, long work sent to
// Jarvis with its token (a fake Jarvis records what came), and each service as an MCP tool.

const KEY = 'test-key';
const linkedin = {
  output: {
    data: {
      items: [
        { title: 'Stage IA', company: 'Exemple', location: 'Rouen', url: 'https://ex.com/1' },
        { title: 'Stage NLP', company: 'Autre', location: 'Paris', url: 'https://ex.com/2' },
        { title: 'Doublon', company: 'Exemple', location: 'Rouen', url: 'https://ex.com/1' },
      ],
    },
  },
};

/** A fetch that answers as treg and as Jarvis would, and remembers what it was asked. */
function fakeWorld() {
  const asked: { url: string; body: unknown; auth: string | null }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    asked.push({ url, body, auth: new Headers(init?.headers).get('authorization') });
    if (url.startsWith('https://treg.to/')) return Response.json(linkedin);
    if (url.endsWith('/receive'))
      return Response.json({ created: (body as { items: unknown[] }).items.length, updated: 0 });
    if (url.includes('/executions/')) return Response.json({ ok: true });
    return new Response(
      '<html><title>Une offre</title><body><p>Stage &amp; IA</p><script>x</script></body></html>',
      {
        headers: { 'content-type': 'text/html' },
      },
    );
  }) as typeof fetch;
  return { asked, fake };
}

const atelier = (fake: typeof fetch) =>
  makeApp({ services: SERVICES, keys: [KEY], env: { TREG_TOKEN: 'treg' }, fetch: fake });

const call = (app: ReturnType<typeof atelier>['app'], path: string, body?: unknown, key = KEY) =>
  app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('the Atelier', () => {
  it('shows its catalogue, each service with its input and where it writes', async () => {
    const { app } = atelier(fakeWorld().fake);
    const { services } = (await (await app.request('/catalog')).json()) as {
      services: { name: string; writes?: { kind: string }; input: { properties: object } }[];
    };
    expect(services.map((one) => one.name)).toEqual(['offres_emploi', 'lire_page']);
    expect(services[0]).toMatchObject({ writes: { kind: 'Offre', match: 'url' }, long: true });
    expect(Object.keys(services[0]!.input.properties)).toContain('entries');
  });

  it('asks a key for work', async () => {
    const { app } = atelier(fakeWorld().fake);
    expect((await call(app, '/jobs/offres_emploi', {}, 'wrong')).status).toBe(401);
    expect((await call(app, '/jobs/nothing', {})).status).toBe(404);
  });

  it('finds offers now, once each', async () => {
    const world = fakeWorld();
    const { app } = atelier(world.fake);
    const answer = await call(app, '/jobs/offres_emploi', {
      query: 'stage IA',
      contract: 'internship',
    });
    expect(answer.status).toBe(200);
    const { items } = (await answer.json()) as { items: { url: string }[] };
    expect(items.map((one) => one.url)).toEqual(['https://ex.com/1', 'https://ex.com/2']);
    expect(world.asked[0]).toMatchObject({
      url: 'https://treg.to/call/anyapi.linkedin.search.jobs',
      body: { query: 'stage IA', location: 'France', employmentType: 'internship' },
    });
  });

  it('does long work for Jarvis and sends it back with its token', async () => {
    const world = fakeWorld();
    const { app, queue } = atelier(world.fake);
    const answer = await call(app, '/jobs/offres_emploi', {
      entries: [
        {
          title: 'Mes critères',
          poste: 'stage intelligence artificielle',
          lieu: 'Rouen',
          contrat: 'Stage',
        },
      ],
      jarvis: {
        execution: 'ent_exe',
        token: 'jos_work',
        url: 'https://jarvis.test/api',
        save: { kind: 'Offre de stage', match: 'url' },
      },
    });
    expect(answer.status).toBe(202);
    const { job } = (await answer.json()) as { job: string };
    for (let i = 0; i < 50 && queue.get(job)?.state !== 'done'; i++)
      await new Promise((done) => setTimeout(done, 10));
    expect(queue.get(job)).toMatchObject({ state: 'done', count: 2, execution: 'ent_exe' });
    const toJarvis = world.asked.filter((one) => one.url.startsWith('https://jarvis.test'));
    expect(toJarvis.map((one) => one.url)).toEqual([
      'https://jarvis.test/api/receive',
      'https://jarvis.test/api/executions/ent_exe',
    ]);
    expect(toJarvis.every((one) => one.auth === 'Bearer jos_work')).toBe(true);
    expect(toJarvis[0]!.body).toMatchObject({
      kind: 'Offre de stage',
      match: 'url',
      execution: 'ent_exe',
    });
    expect(toJarvis[1]!.body).toMatchObject({ status: 'done', counts: { found: 2, created: 2 } });
    expect(world.asked[0]!.body).toMatchObject({
      query: 'stage intelligence artificielle',
      location: 'Rouen',
      employmentType: 'internship',
    });
  });

  it('makes each service a tool of its MCP server', async () => {
    const { app } = atelier(fakeWorld().fake);
    const listed = await call(app, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const { result } = (await listed.json()) as { result: { tools: { name: string }[] } };
    expect(result.tools.map((one) => one.name)).toEqual(['offres_emploi', 'lire_page']);
    const read = await call(app, '/mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'lire_page', arguments: { url: 'https://ex.com/offre' } },
    });
    const text = ((await read.json()) as { result: { content: { text: string }[] } }).result
      .content[0]!.text;
    expect(JSON.parse(text).items[0]).toMatchObject({ title: 'Une offre', text: 'Stage & IA' });
  });

  it('reads only public https pages', () => {
    expect(readable(new URL('https://example.com/a'))).toBe(true);
    for (const inside of [
      'http://example.com',
      'https://localhost/x',
      'https://10.0.0.1/',
      'https://box.internal/',
    ])
      expect(readable(new URL(inside))).toBe(false);
    expect(textOf('<title>T</title><style>a{}</style><p>Un</p><p>Deux</p>')).toEqual({
      title: 'T',
      text: 'Un\nDeux',
    });
  });
});
