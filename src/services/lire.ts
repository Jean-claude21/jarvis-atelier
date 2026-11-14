import { z } from 'zod';
import { service, type Context, type Item } from '../contract';
import { hostOf, readable } from '../web';

// Reading pages whole, without AI: each page's main content as text (Markdown), its menus and
// footers left out, put in one field of the entry it belongs to — an offer's « contenu » — for the
// assistant to read later. Crawl4AI does the reading (pages built by script included).

const PER_CALL = 5;
const DAY = () => new Date().toISOString().slice(0, 10);

interface Read {
  url: string;
  title: string | null;
  text: string | null;
  error: string | null;
}

/** A few pages at once by Crawl4AI: the main content of each (« fit » Markdown), else all of it. */
async function readPages(urls: string[], { fetch, env, signal }: Context): Promise<Read[]> {
  const base = env.CRAWL4AI_URL?.replace(/\/$/, '');
  if (!base) throw new Error('This server has no CRAWL4AI_URL: pages cannot be read.');
  const answer = await fetch(`${base}/crawl`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.CRAWL4AI_TOKEN ? { authorization: `Bearer ${env.CRAWL4AI_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      urls,
      browser_config: { type: 'BrowserConfig', params: { headless: true } },
      crawler_config: {
        type: 'CrawlerRunConfig',
        params: {
          cache_mode: 'bypass',
          page_timeout: 45_000,
          excluded_tags: ['nav', 'footer', 'header', 'aside', 'form'],
          markdown_generator: {
            type: 'DefaultMarkdownGenerator',
            params: {
              content_filter: { type: 'PruningContentFilter', params: { threshold: 0.45 } },
              options: { ignore_images: true },
            },
          },
        },
      },
    }),
    signal,
  });
  if (!answer.ok) throw new Error(`The page reader answered ${answer.status}.`);
  const body = (await answer.json()) as {
    results?: {
      url?: string;
      success?: boolean;
      error_message?: string;
      markdown?: string | { raw_markdown?: string; fit_markdown?: string };
      metadata?: { title?: string };
    }[];
  };
  return urls.map((url, at) => {
    const page = body.results?.find((one) => one.url === url) ?? body.results?.[at];
    if (!page?.success)
      return { url, title: null, text: null, error: page?.error_message ?? 'no answer' };
    const md = page.markdown;
    const raw = typeof md === 'string' ? md : (md?.raw_markdown ?? '');
    const fit = typeof md === 'string' ? '' : (md?.fit_markdown ?? '');
    // The filtered content when it kept enough, the whole page otherwise.
    const text = (fit.trim().length >= 400 ? fit : raw).replace(/\n{3,}/g, '\n\n').trim();
    return { url, title: page.metadata?.title ?? null, text, error: null };
  });
}

export const lire = service({
  name: 'lire',
  title: 'Lire des pages en entier',
  description:
    'Reads web pages whole, without AI: the main content of each page as text (Markdown), its menus and footers left out, returned in one field (`field`, « contenu » by default) of an item per page, matched to her entries by their address. For the assistant to read what a page says (an offer, an article) from Jarvis, without going back to the site.',
  does: 'Lire des pages en entier et en garder le texte, pour que l’IA le lise ensuite',
  examples: [
    'garde le texte complet de chaque offre retenue',
    'lis cet article en entier et range-le',
    'récupère le contenu de ces pages',
  ],
  effect: 'reads',
  input: z.object({
    /** The pages: her entries or plain addresses, each with its `url`. */
    pages: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    urls: z.array(z.string().url()).max(200).optional(),
    /** The field the text goes in. */
    field: z
      .string()
      .trim()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      .max(60)
      .default('contenu'),
    /** At most this many characters per page. */
    max: z.number().int().min(1000).max(60_000).default(20_000),
  }),
  writes: { kind: 'Capture', match: 'url' },
  needs: ['CRAWL4AI_URL'],
  long: true,
  minutes: 30,
  async run(input, context) {
    const urls = [
      ...new Set(
        [...(input.urls ?? []), ...(input.pages ?? []).map((one) => one.url)].filter(
          (url): url is string => {
            if (typeof url !== 'string') return false;
            try {
              return readable(new URL(url));
            } catch {
              return false;
            }
          },
        ),
      ),
    ];
    if (!urls.length) return { items: [], log: 'Aucune page à lire.' };
    const items: Item[] = [];
    let read = 0;
    let failed = 0;
    for (let at = 0; at < urls.length; at += PER_CALL) {
      const batch = urls.slice(at, at + PER_CALL);
      let pages: Read[];
      try {
        pages = await readPages(batch, context);
      } catch (error) {
        pages = batch.map((url) => ({
          url,
          title: null,
          text: null,
          error: (error as Error).message,
        }));
      }
      for (const page of pages) {
        // A page that cannot be read says so, dated: it is not asked again every morning.
        const text = page.text
          ? page.text.slice(0, input.max)
          : `Page illisible le ${DAY()} : ${page.error ?? 'vide'}.`;
        if (page.text) read += 1;
        else failed += 1;
        items.push({
          title: page.title ?? hostOf(page.url),
          url: page.url,
          source: hostOf(page.url),
          fields: { [input.field]: text },
        });
      }
    }
    return { items, log: `${read} lues, ${failed} illisibles` };
  },
});
