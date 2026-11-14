import { z } from 'zod';

// The contract of a service of the Atelier: what it is called, what it takes, what it gives back
// and where that goes in Jarvis. A service is one file under `src/services/`; the registry makes it
// an API route, an MCP tool and a line of the catalogue — nothing else is written for it.
//
// ONE shape comes back from every service: a list of `Item`s. An item is either structured (its
// `fields` were extracted: they become the fields of an entry of her kind, by name) or raw (only
// its `text`: kept as a « Capture » for the AI to read and file later). Jarvis needs nothing else
// to receive what any service finds.

/** Where what a service found goes in Jarvis: entries of `kind`, found again by `match`. */
export interface Writes {
  kind: string;
  /** Where raw items go (no fields extracted): « Capture » by default. */
  raw?: string;
  /** A field whose value finds the entry already there (« url »): never twice. */
  match?: string;
  /** Each entry's title: « {title} — {company} ». */
  title?: string;
}

/** What every service gives back, one per thing found: a page, a result, an element of a list. */
export interface Item {
  /** What it is called: a page's title, an offer's title. */
  title: string;
  /** Its address: found again by it, never twice. */
  url?: string;
  /** Where it was found: the host (« fr.indeed.com »), or the route (« treg: linkedin »). */
  source: string;
  /** Its content as read (Markdown), when no fields were extracted — or as well. */
  text?: string;
  /** What was extracted (« company », « location », « published »…): her model's field names. */
  fields?: Record<string, unknown>;
  /** How well it answers her words, out of 100, and why — when she gave words. */
  score?: number;
  reasons?: string;
}

/** What Jarvis sends with long work (spec 057 of Jarvis OS): where to answer, and with what. */
export const jarvisWorkSchema = z.object({
  execution: z.string().min(1).max(64),
  token: z.string().min(1).max(200),
  url: z.string().url(),
  until: z.string().optional(),
  /** Where she wants what is found (her rule's `save`): it wins over the service's own `writes`. */
  save: z
    .object({
      kind: z.string().min(1).max(80),
      match: z.string().min(1).max(60).optional(),
      title: z.string().min(1).max(300).optional(),
      /** Where what could not be structured goes, as read (« Capture »). */
      raw: z.string().min(1).max(80).optional(),
    })
    .optional(),
});
export type JarvisWork = z.infer<typeof jarvisWorkSchema>;

/** A file a service made (a PDF): kept in Jarvis as her file, linked to the work that made it. */
export interface MadeFile {
  name: string;
  mediaType: string;
  /** Its bytes, in base64. */
  base64: string;
  title?: string;
}

/** What a service gives back: the items found (written in Jarvis per `writes`), and a few words. */
export interface Outcome {
  items: Item[];
  /** The files it made, sent to Jarvis's `/files` for long work. */
  files?: MadeFile[];
  log?: string;
}

/**
 * What a service does to the world: `reads` (finds, reads — nothing changes outside), `makes`
 * (makes something of hers: a PDF), `sends` (acts outside in her name: a mail) — the last only after
 * her yes in Jarvis.
 */
export type Effect = 'reads' | 'makes' | 'sends';

/** What a service may use while it works: its own secrets, a fetch it can be given in tests. */
export interface Context {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

export interface Service<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Its address and tool name: `parcourir` (letters, digits, `_`). */
  name: string;
  title: string;
  /** What it does, for a model choosing a tool (English, precise). */
  description: string;
  /**
   * The capability in her words (« Trouver des offres d’emploi chaque jour ») — what Jarvis shows
   * when it proposes a plan; nobody needs the service's name.
   */
  does: string;
  /** Things a person says that this answers (« je cherche un stage en IA à Lyon »). */
  examples: string[];
  effect: Effect;
  input: z.ZodObject<Shape>;
  writes?: Writes;
  /** Minutes: work this long is answered later (202), then sent to Jarvis. */
  long?: boolean;
  minutes?: number;
  /** The secrets it needs from the server's environment (named, never shown). */
  needs?: string[];
  run: (input: z.infer<z.ZodObject<Shape>>, context: Context) => Promise<Outcome>;
}

/** A service, typed by its input (the registry holds them all). */
export function service<Shape extends z.ZodRawShape>(definition: Service<Shape>): Service {
  return definition as unknown as Service;
}
