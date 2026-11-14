import { z } from 'zod';
import { service, type Context } from '../contract';

// Job offers, from two sources: LinkedIn's public listings through treg (one key for many data
// providers), and France Travail's official API when its keys are set (free, francetravail.io).
// Criteria come as arguments, or from Jarvis: the entries of her « Profil de recherche » sent along
// by a rule (`include`), each one a search. Each offer gets a score against the search, with its
// reasons in her words. Nothing is applied for: offers are found, not answered.

const TREG = 'https://treg.to/call/anyapi.linkedin.search.jobs';
const FT_TOKEN =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const FT_SEARCH = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
const GEO = 'https://geo.api.gouv.fr/communes';
const CONTRACTS = ['internship', 'full-time', 'part-time', 'contract', 'temporary'] as const;
type Contract = (typeof CONTRACTS)[number];
const SOURCES = ['linkedin', 'francetravail'] as const;

/** Her words for a contract, LinkedIn's. */
const contractOf = (text: unknown): Contract | undefined => {
  const word = String(text ?? '').toLowerCase();
  if (/stage|intern/.test(word)) return 'internship';
  if (/altern|apprenti|cdd|contrat|contract/.test(word)) return 'contract';
  if (/partiel|part/.test(word)) return 'part-time';
  if (/cdi|full|plein/.test(word)) return 'full-time';
  return undefined;
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const fold = (one: string) => one.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SMALL = new Set(['les', 'des', 'une', 'pour', 'dans', 'avec', 'and', 'the', 'stage', 'h/f']);

interface Search {
  query: string | null;
  location: string;
  contract: Contract | undefined;
}

/** How well an offer answers a search, out of 100, and why — in her words. */
export function scoreOf(
  offer: { title: string; location: string | null; published: string | null },
  search: Search,
  now = new Date(),
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const words = fold(search.query ?? '')
    .split(/[^a-z0-9+#]+/)
    .filter((one) => one.length >= 2 && !SMALL.has(one));
  if (words.length) {
    const title = fold(offer.title);
    const hit = words.filter((one) => title.includes(one));
    score += Math.round((60 * hit.length) / words.length);
    reasons.push(`${hit.length}/${words.length} mots du poste dans le titre`);
  }
  if (search.location && fold(search.location) !== 'france') {
    const near = offer.location && fold(offer.location).includes(fold(search.location));
    if (near) {
      score += 20;
      reasons.push(`à ${search.location}`);
    }
  } else score += 20;
  if (offer.published) {
    const days = Math.floor((now.getTime() - Date.parse(offer.published)) / 86_400_000);
    if (days >= 0 && days <= 7) {
      score += 20;
      reasons.push(days === 0 ? 'publiée aujourd’hui' : `publiée il y a ${days} j`);
    } else if (days > 7 && days <= 30) {
      score += 10;
      reasons.push(`publiée il y a ${days} j`);
    }
  }
  return { score: Math.min(score, 100), reasons };
}

interface Offer {
  title: string;
  company: string | null;
  company_url?: string | null;
  location: string | null;
  url: string;
  published: string | null;
  contract: string | null;
  source: (typeof SOURCES)[number];
}

async function fromLinkedin(
  search: Search,
  limit: number,
  { fetch, env, signal }: Context,
): Promise<Offer[]> {
  const answer = await fetch(TREG, {
    method: 'POST',
    headers: {
      'X-Treg-Token': env.TREG_TOKEN!,
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
  if (!answer.ok) throw new Error(`LinkedIn (treg) answered ${answer.status}.`);
  const body = (await answer.json()) as {
    output?: {
      data?: {
        items?: {
          title?: string;
          company?: string;
          companyUrl?: string;
          location?: string;
          url?: string;
          createdUtc?: string;
        }[];
      };
    };
  };
  return (body.output?.data?.items ?? [])
    .slice(0, limit)
    .filter((one) => one.url)
    .map((one) => ({
      title: one.title ?? 'Offre',
      company: one.company ?? null,
      company_url: one.companyUrl ?? null,
      location: one.location ?? null,
      url: one.url!,
      published: one.createdUtc ?? null,
      contract: search.contract ?? null,
      source: 'linkedin' as const,
    }));
}

/** France Travail's token, kept until a minute before it ends. */
let ftToken: { value: string; until: number } | null = null;

async function fromFranceTravail(
  search: Search,
  limit: number,
  { fetch, env, signal }: Context,
): Promise<Offer[]> {
  if (!ftToken || ftToken.until < Date.now()) {
    const answer = await fetch(FT_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.FT_CLIENT_ID!,
        client_secret: env.FT_CLIENT_SECRET!,
        scope: 'api_offresdemploiv2 o2dsoffre',
      }),
      signal,
    });
    if (!answer.ok) throw new Error(`France Travail refused its keys (${answer.status}).`);
    const got = (await answer.json()) as { access_token: string; expires_in?: number };
    ftToken = {
      value: got.access_token,
      until: Date.now() + ((got.expires_in ?? 1400) - 60) * 1000,
    };
  }
  const params = new URLSearchParams({
    motsCles: [
      search.contract === 'internship' && !/stage/i.test(search.query ?? '') ? 'stage' : '',
      search.query ?? '',
    ]
      .join(' ')
      .trim()
      .slice(0, 200),
    range: `0-${Math.min(limit, 50) - 1}`,
  });
  // A place in her words → its département (France Travail searches by codes).
  if (search.location && fold(search.location) !== 'france') {
    const geo = await fetch(
      `${GEO}?${new URLSearchParams({ nom: search.location, fields: 'codeDepartement', boost: 'population', limit: '1' })}`,
      { signal },
    );
    const town = geo.ok ? ((await geo.json()) as { codeDepartement?: string }[])[0] : undefined;
    if (town?.codeDepartement) params.set('departement', town.codeDepartement);
  }
  const contract = { 'full-time': 'CDI', contract: 'CDD', temporary: 'MIS' } as Record<
    string,
    string
  >;
  if (search.contract && contract[search.contract])
    params.set('typeContrat', contract[search.contract]!);
  const answer = await fetch(`${FT_SEARCH}?${params}`, {
    headers: { authorization: `Bearer ${ftToken.value}`, accept: 'application/json' },
    signal,
  });
  if (answer.status === 204) return [];
  if (!answer.ok) throw new Error(`France Travail answered ${answer.status}.`);
  const body = (await answer.json()) as {
    resultats?: {
      id: string;
      intitule?: string;
      entreprise?: { nom?: string };
      lieuTravail?: { libelle?: string };
      dateCreation?: string;
      typeContratLibelle?: string;
    }[];
  };
  return (body.resultats ?? []).map((one) => ({
    title: one.intitule ?? 'Offre',
    company: one.entreprise?.nom ?? null,
    location: one.lieuTravail?.libelle ?? null,
    url: `https://candidat.francetravail.fr/offres/recherche/detail/${one.id}`,
    published: one.dateCreation ?? null,
    contract: one.typeContratLibelle ?? null,
    source: 'francetravail' as const,
  }));
}

export const offresEmploi = service({
  name: 'offres_emploi',
  title: 'Offres d’emploi',
  description:
    'Finds job offers — LinkedIn public listings, and France Travail when its keys are set — by words, place and contract, or for each search profile Jarvis sends. Returns each offer with its title, company, place, date, address (url, unique), a score out of 100 against the search and its reasons, best first.',
  does: 'Trouver des offres d’emploi, de stage ou d’alternance selon ses critères, et les noter',
  examples: [
    'je cherche un stage en intelligence artificielle à Rouen',
    'trouve-moi des offres de data analyst en CDI à Lyon',
    'chaque matin, regarde les nouvelles offres d’alternance',
  ],
  effect: 'reads',
  input: z.object({
    query: z.string().trim().min(1).max(200).optional(),
    location: z.string().trim().min(1).max(120).optional(),
    contract: z.enum(CONTRACTS).optional(),
    /** At most this many offers per search and source. */
    limit: z.number().int().min(1).max(50).optional(),
    /** Only these sources (all those whose keys are set, by default). */
    sources: z.array(z.enum(SOURCES)).min(1).optional(),
    /** Her search profiles, sent by Jarvis (`include`): `poste`/`query`, `lieu`, `contrat`. */
    entries: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
  }),
  writes: { kind: 'Offre', match: 'url', title: '{title} — {company}' },
  long: true,
  minutes: 15,
  needs: ['TREG_TOKEN'],
  async run(input, context) {
    const { env } = context;
    const ready = {
      linkedin: Boolean(env.TREG_TOKEN),
      francetravail: Boolean(env.FT_CLIENT_ID && env.FT_CLIENT_SECRET),
    };
    const sources = (input.sources ?? SOURCES).filter((one) => ready[one]);
    if (!sources.length)
      throw new Error(
        'No source of offers has its keys on this server (TREG_TOKEN, FT_CLIENT_ID).',
      );
    const searches: Search[] = (input.entries?.length ? input.entries : [{}]).map((one) => ({
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
      for (const source of sources) {
        let found: Offer[];
        try {
          found = await (source === 'linkedin' ? fromLinkedin : fromFranceTravail)(
            search,
            input.limit ?? 25,
            context,
          );
        } catch (error) {
          // One source down does not stop the other.
          said.push(`${source}: ${(error as Error).message}`);
          continue;
        }
        for (const one of found) {
          if (items.has(one.url)) continue;
          const { score, reasons } = scoreOf(one, search);
          items.set(one.url, { ...one, score, reasons: reasons.join(' · '), search: search.query });
        }
        said.push(`« ${search.query} » (${search.location}, ${source}): ${found.length}`);
      }
    }
    if (!items.size && said.some((one) => / answered | refused /.test(one)))
      throw new Error(said.join('; '));
    const sorted = [...items.values()].sort((a, b) => Number(b.score) - Number(a.score));
    return { items: sorted, log: said.join('; ') };
  },
});
