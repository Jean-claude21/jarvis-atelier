import { z } from 'zod';
import { service } from '../contract';

// Job offers, from LinkedIn's public listings through treg (one key for many data providers).
// Criteria come as arguments, or from Jarvis: the entries of her « Profil de recherche » sent along
// by a rule (`include`), each one a search. Nothing is applied for: offers are found, not answered.

const TREG = 'https://treg.to/call/anyapi.linkedin.search.jobs';
const CONTRACTS = ['internship', 'full-time', 'part-time', 'contract', 'temporary'] as const;

/** Her words for a contract, LinkedIn's. */
const contractOf = (text: unknown): (typeof CONTRACTS)[number] | undefined => {
  const word = String(text ?? '').toLowerCase();
  if (/stage|intern/.test(word)) return 'internship';
  if (/altern|apprenti|cdd|contrat|contract/.test(word)) return 'contract';
  if (/partiel|part/.test(word)) return 'part-time';
  if (/cdi|full|plein/.test(word)) return 'full-time';
  return undefined;
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

interface Found {
  id?: string;
  title?: string;
  company?: string;
  companyUrl?: string;
  location?: string;
  url?: string;
  createdUtc?: string;
}

export const offresEmploi = service({
  name: 'offres_emploi',
  title: 'Offres d’emploi',
  description:
    'Finds job offers (LinkedIn public listings): by words, place and contract — or for each search profile Jarvis sends. Returns each offer with its title, company, place, date and address (url, unique).',
  input: z.object({
    query: z.string().trim().min(1).max(200).optional(),
    location: z.string().trim().min(1).max(120).optional(),
    contract: z.enum(CONTRACTS).optional(),
    /** At most this many offers per search. */
    limit: z.number().int().min(1).max(50).optional(),
    /** Her search profiles, sent by Jarvis (`include`): `poste`/`query`, `lieu`, `contrat`. */
    entries: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
  }),
  writes: { kind: 'Offre', match: 'url', title: '{title} — {company}' },
  long: true,
  minutes: 15,
  needs: ['TREG_TOKEN'],
  async run(input, { fetch, env, signal }) {
    const token = env.TREG_TOKEN;
    if (!token) throw new Error('This server has no TREG_TOKEN: the offers cannot be read.');
    const searches = (input.entries?.length ? input.entries : [{}]).map((one) => ({
      query: text(one.poste) ?? text(one.query) ?? text(one.mots) ?? input.query ?? text(one.title),
      location: text(one.lieu) ?? text(one.location) ?? input.location ?? 'France',
      contract: contractOf(one.contrat ?? one.contract) ?? input.contract,
    }));
    const items = new Map<string, Record<string, unknown>>();
    const said: string[] = [];
    for (const search of searches) {
      if (!search.query) {
        said.push('a search without words was skipped');
        continue;
      }
      const answer = await fetch(TREG, {
        method: 'POST',
        headers: {
          'X-Treg-Token': token,
          'X-Treg-Route-Max-Cost': '0.002',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: search.query,
          location: search.location,
          ...(search.contract ? { employmentType: search.contract } : {}),
        }),
        signal,
      });
      if (!answer.ok) throw new Error(`The offers' source answered ${answer.status}.`);
      const body = (await answer.json()) as { output?: { data?: { items?: Found[] } } };
      const found = (body.output?.data?.items ?? []).slice(0, input.limit ?? 25);
      for (const one of found) {
        if (!one.url || items.has(one.url)) continue;
        items.set(one.url, {
          title: one.title ?? 'Offre',
          company: one.company ?? null,
          company_url: one.companyUrl ?? null,
          location: one.location ?? null,
          url: one.url,
          published: one.createdUtc ?? null,
          contract: search.contract ?? null,
          source: 'linkedin',
        });
      }
      said.push(`« ${search.query} » (${search.location}): ${found.length}`);
    }
    return { items: [...items.values()], log: said.join('; ') };
  },
});
