import { z } from 'zod';
import { service } from '../contract';

// A public web page, read as text: its title and its words, without its scripts and styles. Only
// https addresses outside private networks are read, 1 MB at most.

const MAX_BYTES = 1_000_000;
const PRIVATE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

/** Whether an address may be read: https, a public host. */
export function readable(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !PRIVATE.test(url.hostname) &&
    !/\.(internal|local|lan|home)$/i.test(url.hostname)
  );
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The words of an HTML page, its title apart. */
export function textOf(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (all, name: string) =>
      name.startsWith('#') ? String.fromCharCode(Number(name.slice(1))) : (ENTITIES[name] ?? all),
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

export const lirePage = service({
  name: 'lire_page',
  title: 'Lire une page',
  description:
    'Reads a public web page (https) and returns its title and its text, without scripts or styles — to read a job offer, an article, a company page.',
  input: z.object({
    url: z.string().url().max(2000),
  }),
  async run(input, { fetch, signal }) {
    const url = new URL(input.url);
    if (!readable(url)) throw new Error(`${url.origin} is not an address the Atelier reads.`);
    const answer = await fetch(url, {
      headers: { accept: 'text/html,text/plain', 'user-agent': 'JarvisAtelier/0.1' },
      redirect: 'follow',
      signal,
    });
    if (!answer.ok) throw new Error(`The page answered ${answer.status}.`);
    const body = (await answer.text()).slice(0, MAX_BYTES);
    const { title, text } = /html/i.test(answer.headers.get('content-type') ?? 'text/html')
      ? textOf(body)
      : { title: null, text: body };
    return { items: [{ url: input.url, title: title ?? input.url, text: text.slice(0, 50_000) }] };
  },
});
