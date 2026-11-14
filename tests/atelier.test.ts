import { describe, expect, it } from 'vitest';
import { makeApp } from '../src/app';
import { SERVICES } from '../src/services';
import { fill, sameOf, typesOf } from '../src/services/parcourir';
import { nearOf, townOf } from '../src/place';
import { pertinence, readable, textOf } from '../src/web';

// The Atelier from outside: its catalogue of generic gestures, a key needed for work, a search, a
// site read by a recipe (raw, structured by a schema, or through treg), long work sent to Jarvis
// in the one shape every service gives back, a PDF kept as her file, and each service an MCP tool.

const KEY = 'test-key';

/** A fetch that answers as SearXNG, Crawl4AI, treg, Gotenberg, a site and Jarvis would. */
function fakeWorld() {
  const asked: { url: string; body: unknown; auth: string | null }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const raw = init?.body;
    const body =
      typeof raw === 'string'
        ? JSON.parse(raw)
        : raw instanceof FormData
          ? Object.fromEntries(['file', 'title', 'links'].map((key) => [key, raw.get(key)]))
          : null;
    asked.push({ url, body, auth: new Headers(init?.headers).get('authorization') });
    if (url.startsWith('http://searxng:8080/'))
      return Response.json({
        results: [
          { url: 'https://www.welcometothejungle.com/fr/jobs', title: 'Offres', content: 'Stages' },
          { url: 'https://fr.indeed.com/', title: 'Indeed', content: 'Emplois' },
        ],
      });
    if (url === 'http://crawl4ai:11235/crawl')
      return Response.json({
        results: [
          {
            success: true,
            markdown: { raw_markdown: '# Résultats' },
            metadata: { title: 'Résultats' },
            extracted_content: JSON.stringify([
              { title: 'Stage IA', url: '/offre/1', company: 'Exemple', when: '2026-11-12' },
              { title: 'Stage comptable', url: '/offre/2', company: 'Autre' },
            ]),
          },
        ],
      });
    if (url.startsWith('https://data.geopf.fr/'))
      return Response.json({
        features: [
          {
            geometry: { coordinates: [1.09, 49.44] },
            properties: { label: 'Rouen', context: '76, Seine-Maritime, Normandie', score: 0.9 },
          },
        ],
      });
    if (url.startsWith('https://treg.to/'))
      return Response.json({
        output: {
          data: {
            items: [{ title: 'Stage Machine Learning', company: 'X', url: 'https://ex.com/3' }],
          },
        },
      });
    if (url.startsWith('http://gotenberg:3000/'))
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        headers: { 'content-type': 'application/pdf' },
      });
    if (url.endsWith('/files')) return Response.json({ id: 'ent_file' }, { status: 201 });
    if (url.endsWith('/receive'))
      return Response.json({ created: (body as { items: unknown[] }).items.length, updated: 0 });
    if (url.includes('/executions/')) return Response.json({ ok: true });
    return new Response(
      '<html><title>Une offre</title><body><p>Stage &amp; IA</p><script>x</script></body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  }) as typeof fetch;
  return { asked, fake };
}

const atelier = (fake: typeof fetch) =>
  makeApp({
    services: SERVICES,
    keys: [KEY],
    env: {
      TREG_TOKEN: 'treg',
      GOTENBERG_URL: 'http://gotenberg:3000',
      SEARXNG_URL: 'http://searxng:8080',
      CRAWL4AI_URL: 'http://crawl4ai:11235',
    },
    fetch: fake,
  });

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

const until = async (queue: ReturnType<typeof atelier>['queue'], job: string) => {
  for (let i = 0; i < 100 && !['done', 'failed'].includes(queue.get(job)?.state ?? ''); i++)
    await new Promise((done) => setTimeout(done, 10));
  return queue.get(job);
};

const work = (save: Record<string, string>) => ({
  execution: 'ent_exe',
  token: 'jos_work',
  url: 'https://jarvis.test/api',
  save,
});

describe('the Atelier', () => {
  it('shows its gestures, each in her words — never a trade', async () => {
    const { app } = atelier(fakeWorld().fake);
    const { services } = (await (await app.request('/catalog')).json()) as {
      services: { name: string; does: string; examples: string[]; ready: boolean }[];
    };
    expect(services.map((one) => one.name)).toEqual([
      'chercher',
      'lire',
      'parcourir',
      'pdf',
      'situer',
    ]);
    expect(services.every((one) => one.does && one.examples.length && one.ready)).toBe(true);
  });

  it('asks a key for work', async () => {
    const { app } = atelier(fakeWorld().fake);
    expect((await call(app, '/jobs/chercher', {}, 'wrong')).status).toBe(401);
    expect((await call(app, '/jobs/nothing', {})).status).toBe(404);
  });

  it('searches the web, within a site if asked', async () => {
    const world = fakeWorld();
    const { app } = atelier(world.fake);
    const answer = await call(app, '/jobs/chercher', {
      queries: ['stage IA Normandie'],
      site: 'welcometothejungle.com',
    });
    const { items } = (await answer.json()) as { items: { source: string }[] };
    expect(items.map((one) => one.source)).toEqual(['welcometothejungle.com', 'fr.indeed.com']);
    expect(world.asked[0]!.url).toContain('q=stage+IA+Normandie+site%3Awelcometothejungle.com');
    expect(world.asked[0]!.url).toContain('format=json');
  });

  it('applies a recipe to each source and each of her searches, structured and scored', async () => {
    const world = fakeWorld();
    const { app, queue } = atelier(world.fake);
    const answer = await call(app, '/jobs/parcourir', {
      sources: [
        {
          title: 'Site d’offres',
          url: 'https://jobs.example.com/search?q={poste}&l={lieu}',
          recipe: JSON.stringify({
            js: true,
            schema: {
              base: '.job',
              fields: { title: 'h2', url: 'a@href', company: '.org', when: 'time' },
            },
            rename: { published: 'when' },
          }),
        },
        { title: 'Indeed', url: 'https://fr.indeed.com/jobs?q={poste}', active: false },
        { title: 'Une note', text: 'Pas un site' },
        {
          title: 'LinkedIn',
          recipe: { treg: { route: 'anyapi.linkedin.search.jobs', body: { query: '{poste}' } } },
        },
      ],
      searches: [
        {
          title: 'Stage IA',
          poste: 'stage intelligence artificielle',
          lieu: 'Rouen',
          mots: 'intelligence artificielle|IA|machine learning',
          types: 'stage: stage|stagiaire\nalternance: alternance|alternant',
        },
      ],
      situer: 'company',
      jarvis: work({ kind: 'JobOffer', match: 'url', title: '{title} — {company}' }),
    });
    expect(answer.status).toBe(202);
    const { job } = (await answer.json()) as { job: string };
    expect(await until(queue, job)).toMatchObject({ state: 'done', count: 3 });
    const crawl = world.asked.find((one) => one.url.endsWith('/crawl'))!;
    expect((crawl.body as { urls: string[] }).urls).toEqual([
      'https://jobs.example.com/search?q=stage%20intelligence%20artificielle&l=Rouen',
    ]);
    // A source on pause is a site she opens herself: never read.
    expect(world.asked.some((one) => one.url.includes('indeed'))).toBe(false);
    const treg = world.asked.find((one) => one.url.startsWith('https://treg.to/'))!;
    expect(treg.body).toEqual({ query: 'stage intelligence artificielle' });
    const received = world.asked.filter((one) => one.url.endsWith('/receive'));
    expect(received).toHaveLength(1);
    const sent = received[0]!.body as { kind: string; items: Record<string, unknown>[] };
    expect(sent.kind).toBe('JobOffer');
    expect(sent.items[0]).toMatchObject({
      title: 'Stage IA',
      url: 'https://jobs.example.com/offre/1',
      company: 'Exemple',
      published: '2026-11-12',
      source: 'jobs.example.com',
      score: 100,
      empreinte: 'stage ia|exemple',
      type: 'stage',
      position: { lat: 49.44, lng: 1.09, address: 'Rouen, 76, Seine-Maritime, Normandie' },
    });
    expect(sent.items.map((one) => one.title)).toEqual([
      'Stage IA',
      'Stage Machine Learning',
      'Stage comptable',
    ]);
  });

  it('keeps raw what no schema structured, as a « Capture » for the AI', async () => {
    const world = fakeWorld();
    const { app, queue } = atelier(world.fake);
    const answer = await call(app, '/jobs/parcourir', {
      url: 'https://ex.com/offre',
      jarvis: work({ kind: 'JobOffer', match: 'url' }),
    });
    const { job } = (await answer.json()) as { job: string };
    expect(await until(queue, job)).toMatchObject({ state: 'done', count: 1 });
    const toJarvis = world.asked.filter((one) => one.url.startsWith('https://jarvis.test'));
    expect(toJarvis.map((one) => one.url)).toEqual([
      'https://jarvis.test/api/receive',
      'https://jarvis.test/api/executions/ent_exe',
    ]);
    expect(toJarvis[0]!.body).toMatchObject({
      kind: 'Capture',
      match: 'url',
      items: [
        { title: 'Une offre', url: 'https://ex.com/offre', source: 'ex.com', text: 'Stage & IA' },
      ],
    });
    expect(toJarvis[1]!.body).toMatchObject({ status: 'done', counts: { found: 1, raw: 1 } });
    expect(toJarvis.every((one) => one.auth === 'Bearer jos_work')).toBe(true);
  });

  it('makes a PDF and keeps it in Jarvis as her file, linked to the work', async () => {
    const world = fakeWorld();
    const { app, queue } = atelier(world.fake);
    const answer = await call(app, '/jobs/pdf', {
      title: 'Lettre de motivation — Exemple',
      html: '<h1>Madame, Monsieur</h1><p>…</p>',
      jarvis: { execution: 'ent_exe', token: 'jos_work', url: 'https://jarvis.test/api' },
    });
    const { job } = (await answer.json()) as { job: string };
    expect(await until(queue, job)).toMatchObject({ state: 'done', count: 1 });
    const toJarvis = world.asked.filter((one) => one.url.startsWith('https://jarvis.test'));
    expect(toJarvis.map((one) => one.url)).toEqual([
      'https://jarvis.test/api/files',
      'https://jarvis.test/api/executions/ent_exe',
    ]);
    const sent = toJarvis[0]!.body as Record<string, unknown>;
    expect((sent.file as File).name).toBe('Lettre-de-motivation-Exemple.pdf');
    expect(JSON.parse(String(sent.links))).toEqual([{ to: 'ent_exe', role: 'made_by' }]);
  });

  it('makes each service a tool of its MCP server', async () => {
    const { app } = atelier(fakeWorld().fake);
    const listed = await call(app, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const { result } = (await listed.json()) as { result: { tools: { name: string }[] } };
    expect(result.tools.map((one) => one.name)).toEqual([
      'chercher',
      'lire',
      'parcourir',
      'pdf',
      'situer',
    ]);
  });

  it('knows the same offer on several sites', () => {
    const one = (title: string, company: string) => ({ title, source: 's', fields: { company } });
    expect(sameOf(one('Stage - Ingénieur R&D (IA Agentique) H/F', 'Altereo · Rouen'))).toBe(
      sameOf(one('Stage - Ingénieur R&D IA Agentique H/F', 'ALTEREO')),
    );
    expect(sameOf(one('Stage IA', 'Altereo'))).not.toBe(sameOf(one('Stage IA', 'Orange')));
    expect(sameOf({ title: 'Une page', source: 's' })).toBeNull();
  });

  it('reads her types and the town a place names', () => {
    expect(typesOf('stage: stage|stagiaire|intern\nalternance: alternance|alternant')).toEqual([
      ['stage', 'stage|stagiaire|intern'],
      ['alternance', 'alternance|alternant'],
    ]);
    expect(townOf('Palaiseau(à 18 km de Paris)')).toBe('Palaiseau');
    expect(townOf('Paris, Île-de-France, France')).toBe('Paris');
    expect(townOf('76 - ST MARTIN DU VIVIER')).toBe('ST MARTIN DU VIVIER');
    expect(nearOf('Saint-Denis(à 10 km de Paris)')).toBe('Paris');
    expect(nearOf('Paris 9ème')).toBeNull();
    expect(townOf('Paris 9ème')).toBe('Paris');
  });

  it('reads pages whole and puts their text in one field', async () => {
    const world = fakeWorld();
    const { app, queue } = atelier(world.fake);
    const answer = await call(app, '/jobs/lire', {
      pages: [{ title: 'Stage IA', url: 'https://jobs.example.com/offre/1' }],
      jarvis: work({ kind: 'JobOffer', match: 'url' }),
    });
    const { job } = (await answer.json()) as { job: string };
    expect(await until(queue, job)).toMatchObject({ state: 'done', count: 1 });
    const crawl = world.asked.find((one) => one.url.endsWith('/crawl'))!;
    expect((crawl.body as { urls: string[] }).urls).toEqual(['https://jobs.example.com/offre/1']);
    const sent = world.asked.find((one) => one.url.endsWith('/receive'))!.body as {
      kind: string;
      items: Record<string, unknown>[];
    };
    expect(sent.kind).toBe('JobOffer');
    expect(sent.items[0]).toMatchObject({
      url: 'https://jobs.example.com/offre/1',
      contenu: '# Résultats',
    });
  });

  it('places towns on a map', async () => {
    const { app } = atelier(fakeWorld().fake);
    const answer = await call(app, '/jobs/situer', { places: ['Rouen (76)'] });
    const { items } = (await answer.json()) as { items: { fields: { position: unknown } }[] };
    expect(items[0]!.fields.position).toEqual({
      lat: 49.44,
      lng: 1.09,
      address: 'Rouen, 76, Seine-Maritime, Normandie',
    });
  });

  it('fills a recipe, scores her words, reads only public https pages', () => {
    expect(
      fill('https://s.com/?q={poste}&l={lieu}', { poste: 'data & IA', lieu: 'Rouen' }, true),
    ).toBe('https://s.com/?q=data%20%26%20IA&l=Rouen');
    expect(
      pertinence('Stage Ingénieur Data/IA', ['intelligence artificielle|IA', 'Rouen']),
    ).toEqual({ score: 50, reasons: '1/2 : intelligence artificielle' });
    expect(pertinence('Stage média', ['IA']).score).toBe(0);
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
