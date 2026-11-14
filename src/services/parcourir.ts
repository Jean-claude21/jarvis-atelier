import { z } from 'zod';
import { service, type Context, type Item } from '../contract';
import { hostOf, MAX_BYTES, pertinence, readable, textOf, wordsOf } from '../web';

// Reading sites by a recipe. The AI writes the recipe once, from what it understood of a site; this
// service applies it as often as asked, without AI:
//
//   { url: "https://site/search?q={mots}&l={lieu}", js?: true,
//     schema?: { base: ".result", fields: { title: "h2", url: "a@href", company: ".org" } },
//     treg?: { route: "anyapi.linkedin.search.jobs", body: { query: "{poste}" } },
//     rename?: { published: "createdUtc" } }
//
// For each source and each of her searches, `{field}` takes the search's value. A schema gives
// structured items (her model's fields, by name); no schema gives the page, raw, for the AI. Pages
// built by script are read by Crawl4AI (open source, on the server's own network); others by a
// plain request; a source with its API at treg, through treg.

const fieldSchema = z.union([
  z.string().min(1).max(300),
  z.object({ selector: z.string().min(1).max(300), attribute: z.string().min(1).max(60) }),
]);

export const recipeSchema = z.object({
  /** The address read; `{field}` takes the value of her search. */
  url: z.string().min(8).max(2000).optional(),
  /** Built by script: read with a real browser. */
  js: z.boolean().optional(),
  /** Each element of a list: where it is (`base`), and each field in it (« a@href »: an attribute). */
  schema: z
    .object({
      base: z.string().min(1).max(300),
      fields: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), fieldSchema),
    })
    .optional(),
  /** A source with its API at treg: its route and body (`{field}` taken from her search). */
  treg: z
    .object({
      route: z.string().regex(/^[a-zA-Z0-9._-]+$/),
      body: z.record(z.string(), z.unknown()).default({}),
      /** Where the list is in its answer (« output.data.items » by default). */
      at: z.string().max(120).optional(),
    })
    .optional(),
  /** Her field ← the source's (« published » ← « createdUtc »). */
  rename: z.record(z.string(), z.string()).optional(),
});
export type Recipe = z.infer<typeof recipeSchema>;

/** A value of her search put in a recipe's text; encoded when it goes in an address. */
export function fill(template: string, values: Record<string, unknown>, encode = false): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (all, name: string) => {
    const value = values[name];
    if (value === undefined || value === null || value === '') return all;
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    return encode ? encodeURIComponent(text) : text;
  });
}

const fillDeep = (value: unknown, values: Record<string, unknown>): unknown =>
  typeof value === 'string'
    ? fill(value, values)
    : Array.isArray(value)
      ? value.map((one) => fillDeep(one, values))
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, values)]))
        : value;

const at = (value: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (here, key) =>
        here && typeof here === 'object' ? (here as Record<string, unknown>)[key] : undefined,
      value,
    );

/** A source as Jarvis sends it (an entry « Source »): its recipe, kept as data or as JSON text. */
function recipeOf(source: Record<string, unknown>): Recipe {
  const kept = source.recipe ?? source.recette;
  const given = typeof kept === 'string' && kept.trim() ? (JSON.parse(kept) as object) : kept;
  return recipeSchema.parse({
    ...(given && typeof given === 'object' ? given : {}),
    ...(typeof source.url === 'string' && source.url ? { url: source.url } : {}),
    ...(typeof source.js === 'boolean' ? { js: source.js } : {}),
  });
}

/** One element of a list as an item: its title and address taken out, the rest its fields. */
function itemOf(
  found: Record<string, unknown>,
  recipe: Recipe,
  source: string,
  page?: string,
): Item {
  const fields: Record<string, unknown> = { ...found };
  for (const [mine, theirs] of Object.entries(recipe.rename ?? {}))
    if (theirs in fields) {
      fields[mine] = fields[theirs];
      delete fields[theirs];
    }
  const title = String(fields.title ?? fields.name ?? '').trim() || source;
  let url =
    typeof fields.url === 'string'
      ? fields.url
      : typeof fields.link === 'string'
        ? fields.link
        : undefined;
  if (url && page) {
    try {
      url = new URL(url, page).toString();
    } catch {
      /* kept as given */
    }
  }
  delete fields.title;
  delete fields.url;
  return { title, ...(url ? { url } : {}), source, fields };
}

/** Crawl4AI's answer for one page: its words, and what its schema extracted. */
async function crawl(url: string, recipe: Recipe, { fetch, env, signal }: Context) {
  const base = env.CRAWL4AI_URL?.replace(/\/$/, '');
  if (!base)
    throw new Error('This server has no CRAWL4AI_URL: pages built by script cannot be read.');
  const extraction = recipe.schema
    ? {
        extraction_strategy: {
          type: 'JsonCssExtractionStrategy',
          params: {
            schema: {
              type: 'dict',
              value: {
                name: 'items',
                baseSelector: recipe.schema.base,
                fields: Object.entries(recipe.schema.fields).map(([name, field]) => {
                  const [selector, attribute] =
                    typeof field === 'string'
                      ? (field.split('@') as [string, string | undefined])
                      : [field.selector, field.attribute];
                  return attribute
                    ? { name, selector: selector || ':scope', type: 'attribute', attribute }
                    : { name, selector, type: 'text' };
                }),
              },
            },
          },
        },
      }
    : {};
  const answer = await fetch(`${base}/crawl`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.CRAWL4AI_TOKEN ? { authorization: `Bearer ${env.CRAWL4AI_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      urls: [url],
      browser_config: { type: 'BrowserConfig', params: { headless: true } },
      crawler_config: {
        type: 'CrawlerRunConfig',
        params: { cache_mode: 'bypass', page_timeout: 45_000, ...extraction },
      },
    }),
    signal,
  });
  if (!answer.ok) throw new Error(`The page reader answered ${answer.status}.`);
  const body = (await answer.json()) as {
    results?: {
      success?: boolean;
      error_message?: string;
      markdown?: string | { raw_markdown?: string };
      extracted_content?: string | null;
      metadata?: { title?: string };
    }[];
  };
  const page = body.results?.[0];
  if (!page?.success)
    throw new Error(`${hostOf(url)} could not be read: ${page?.error_message ?? 'no answer'}.`);
  const markdown =
    typeof page.markdown === 'string' ? page.markdown : (page.markdown?.raw_markdown ?? '');
  let extracted: Record<string, unknown>[] = [];
  if (page.extracted_content) {
    const read = JSON.parse(page.extracted_content) as unknown;
    extracted = Array.isArray(read) ? (read as Record<string, unknown>[]) : [];
  }
  return { title: page.metadata?.title ?? null, text: markdown, extracted };
}

/** A page read without a browser: its title and its words. */
async function plain(url: string, { fetch, signal }: Context) {
  const answer = await fetch(url, {
    headers: { accept: 'text/html,text/plain', 'user-agent': 'JarvisAtelier/0.2' },
    redirect: 'follow',
    signal,
  });
  if (!answer.ok) throw new Error(`${hostOf(url)} answered ${answer.status}.`);
  const body = (await answer.text()).slice(0, MAX_BYTES);
  return /html/i.test(answer.headers.get('content-type') ?? 'text/html')
    ? textOf(body)
    : { title: null, text: body };
}

/** One source read for one search. */
async function readOne(
  recipe: Recipe,
  values: Record<string, unknown>,
  limit: number,
  context: Context,
): Promise<Item[]> {
  if (recipe.treg) {
    const token = context.env.TREG_TOKEN;
    if (!token) throw new Error('This server has no TREG_TOKEN: treg cannot be asked.');
    const answer = await context.fetch(`https://treg.to/call/${recipe.treg.route}`, {
      method: 'POST',
      headers: {
        'X-Treg-Token': token,
        'X-Treg-Route-Max-Cost': '0.002',
        'content-type': 'application/json',
      },
      body: JSON.stringify(fillDeep(recipe.treg.body, values)),
      signal: context.signal,
    });
    if (!answer.ok) throw new Error(`treg (${recipe.treg.route}) answered ${answer.status}.`);
    const list = at(await answer.json(), recipe.treg.at ?? 'output.data.items');
    return (Array.isArray(list) ? list : [])
      .slice(0, limit)
      .filter((one): one is Record<string, unknown> => Boolean(one) && typeof one === 'object')
      .map((one) => itemOf(one, recipe, `treg: ${recipe.treg!.route}`));
  }
  if (!recipe.url) throw new Error('A source needs an address (url) or a route at treg.');
  const filled = fill(recipe.url, values, true);
  if (/\{[a-zA-Z_]+\}/.test(filled))
    throw new Error(`${filled}: her search does not say ${filled.match(/\{[a-zA-Z_]+\}/)![0]}.`);
  const url = new URL(filled);
  if (!readable(url)) throw new Error(`${url.origin} is not an address the Atelier reads.`);
  const source = hostOf(url.toString());
  if (recipe.schema || recipe.js) {
    const page = await crawl(url.toString(), recipe, context);
    if (recipe.schema && page.extracted.length)
      return page.extracted
        .slice(0, limit)
        .map((one) => itemOf(one, recipe, source, url.toString()));
    return [
      {
        title: page.title ?? source,
        url: url.toString(),
        source,
        text: page.text.slice(0, 50_000),
      },
    ];
  }
  const page = await plain(url.toString(), context);
  return [
    { title: page.title ?? source, url: url.toString(), source, text: page.text.slice(0, 50_000) },
  ];
}

export const parcourir = service({
  name: 'parcourir',
  title: 'Parcourir des sites',
  description:
    'Reads sites by a recipe — an address with {placeholders} filled from each of her searches, js for pages built by script, a CSS schema to extract each element of a list into fields, or a route at treg — and returns structured items (fields by name) or the pages raw (Markdown). Optionally scores each against her words. Give `url` and `recipe` directly, or `sources` and `searches` (sent by Jarvis).',
  does: 'Parcourir des sites selon une recette, et en ramener les éléments ou les pages',
  examples: [
    'chaque matin, regarde ces trois sites d’offres avec mes mots-clés',
    'récupère toutes les annonces de cette page de résultats',
    'lis cette page et garde son contenu',
  ],
  effect: 'reads',
  input: z.object({
    url: z.string().url().max(2000).optional(),
    recipe: recipeSchema.optional(),
    /** Her sources (entries « Source »): each its address and recipe. */
    sources: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
    /** Her searches: each its values for the {placeholders}, and her words (`mots`). */
    searches: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
    /** Her words, each an idea (« intelligence artificielle|IA|AI »): a score out of 100. */
    words: z.array(z.string().min(1).max(200)).max(20).optional(),
    /** At most this many items per source and search. */
    limit: z.number().int().min(1).max(100).default(25),
  }),
  writes: { kind: 'Capture', match: 'url', raw: 'Capture' },
  long: true,
  minutes: 20,
  async run(input, context) {
    const recipes: { name: string; recipe: Recipe }[] = [];
    if (input.url || input.recipe)
      recipes.push({
        name: input.url ?? 'recette',
        recipe: recipeSchema.parse({ ...input.recipe, ...(input.url ? { url: input.url } : {}) }),
      });
    for (const source of input.sources ?? []) {
      // A source she put on pause (`active: false`): a site she opens herself — kept, never read.
      // One with neither address nor recipe is not a site (her notes may share the kind's name).
      if (source.active === false || (!source.url && !source.recipe)) continue;
      try {
        recipes.push({
          name: String(source.title ?? source.url ?? 'source'),
          recipe: recipeOf(source),
        });
      } catch (error) {
        throw new Error(
          `The recipe of « ${String(source.title ?? '?')} » is not valid: ${(error as Error).message}`,
        );
      }
    }
    if (!recipes.length) throw new Error('Nothing to read: give a url, a recipe, or sources.');
    const searches = input.searches?.length ? input.searches : [{}];
    const items = new Map<string, Item>();
    const said: string[] = [];
    let failed = 0;
    for (const { name, recipe } of recipes) {
      for (const search of searches) {
        let found: Item[];
        try {
          found = await readOne(recipe, search, input.limit, context);
        } catch (error) {
          // One source down does not stop the others.
          failed += 1;
          said.push(`${name}: ${(error as Error).message}`);
          continue;
        }
        const words = wordsOf(search.mots ?? search.words).length
          ? wordsOf(search.mots ?? search.words)
          : (input.words ?? []);
        for (const one of found) {
          const key = one.url ?? `${one.source}:${one.title}`;
          if (items.has(key)) continue;
          if (words.length) {
            const said = [
              one.title,
              ...Object.values(one.fields ?? {}).map(String),
              (one.text ?? '').slice(0, 2000),
            ].join(' ');
            Object.assign(one, pertinence(said, words));
          }
          items.set(key, one);
        }
        said.push(`${name}${search.title ? ` (${String(search.title)})` : ''}: ${found.length}`);
      }
    }
    if (!items.size && failed === recipes.length * searches.length)
      throw new Error(said.join('; '));
    const sorted = [...items.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return { items: sorted, log: said.join('; ') };
  },
});
