import { z } from 'zod';
import { service, type Item } from '../contract';
import { hostOf } from '../web';

// Searching the web, through SearXNG (open source, on the server's own network): many engines
// asked at once, nothing tracked, no paid key. What an assistant uses to find the sites, the pages,
// the sources of what she wants — before they are read (`parcourir`).

export const chercher = service({
  name: 'chercher',
  title: 'Chercher sur le web',
  description:
    'Searches the web (many engines at once, through SearXNG) for one or several queries, optionally within one site. Returns each result with its title, address, site and a few words of it — to find the sites and pages worth reading.',
  does: 'Chercher sur le web les sites, pages et sources qui répondent à une intention',
  examples: [
    'trouve les sites où chercher un stage en IA en Normandie',
    'quels sites publient des annonces de logement étudiant à Rouen ?',
    'cherche la page carrières de cette entreprise',
  ],
  effect: 'reads',
  input: z.object({
    queries: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    /** Only within this site (« welcometothejungle.com »). */
    site: z.string().trim().min(3).max(200).optional(),
    language: z.string().trim().min(2).max(10).default('fr'),
    /** At most this many results per query. */
    limit: z.number().int().min(1).max(30).default(10),
  }),
  needs: ['SEARXNG_URL'],
  async run(input, { fetch, env, signal }) {
    const base = env.SEARXNG_URL?.replace(/\/$/, '');
    if (!base) throw new Error('This server has no SEARXNG_URL: the web cannot be searched.');
    const items = new Map<string, Item>();
    const said: string[] = [];
    for (const query of input.queries) {
      const q = input.site ? `${query} site:${input.site}` : query;
      const answer = await fetch(
        `${base}/search?${new URLSearchParams({ q, format: 'json', language: input.language })}`,
        { headers: { accept: 'application/json' }, signal },
      );
      if (!answer.ok) throw new Error(`The search answered ${answer.status}.`);
      const { results = [] } = (await answer.json()) as {
        results?: { url?: string; title?: string; content?: string }[];
      };
      const found = results.filter((one) => one.url).slice(0, input.limit);
      for (const one of found)
        if (!items.has(one.url!))
          items.set(one.url!, {
            title: one.title?.trim() || one.url!,
            url: one.url!,
            source: hostOf(one.url!),
            ...(one.content ? { text: one.content.trim() } : {}),
          });
      said.push(`« ${query} »: ${found.length}`);
    }
    return { items: [...items.values()], log: said.join('; ') };
  },
});
