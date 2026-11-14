// What the services share about the web: which addresses may be read (public https only), a
// page's words, a host's name, and how well something answers her words.

export const MAX_BYTES = 1_000_000;
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

/** The host of an address, as a source's name (« fr.indeed.com »). */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 80);
  }
};

export const fold = (one: string) => one.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const words = (one: string) =>
  ` ${fold(one)
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()} `;

/**
 * How well a text answers her words, out of 100, and why. Each of her words is an idea said in one
 * way or another: « intelligence artificielle|IA|AI » counts once, whichever form is there.
 */
export function pertinence(text: string, said: string[]): { score: number; reasons: string } {
  const ideas = said
    .map((one) => one.split('|').map(words))
    .filter((forms) => forms.some((form) => form.trim()));
  if (!ideas.length) return { score: 0, reasons: '' };
  const padded = words(text);
  const hit = ideas.filter((forms) => forms.some((form) => padded.includes(form)));
  return {
    score: Math.round((100 * hit.length) / ideas.length),
    reasons: hit.length
      ? `${hit.length}/${ideas.length} : ${hit.map((forms) => forms[0]!.trim()).join(', ')}`
      : `0/${ideas.length}`,
  };
}

/** Her words, however they came: a list, or a text with commas, semicolons or new lines. */
export const wordsOf = (value: unknown): string[] =>
  (Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[,;\n]+/)
      : []
  )
    .map((one) => one.trim())
    .filter(Boolean);
