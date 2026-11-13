import { z } from 'zod';

// The contract of a service of the Atelier: what it is called, what it takes, what it gives back
// and where that goes in Jarvis. A service is one file under `src/services/`; the registry makes it
// an API route, an MCP tool and a line of the catalogue — nothing else is written for it.

/** Where what a service found goes in Jarvis: entries of `kind`, found again by `match`. */
export interface Writes {
  kind: string;
  /** A field whose value finds the entry already there (« url »): never twice. */
  match?: string;
  /** Each entry's title: « {title} — {company} ». */
  title?: string;
}

/** What Jarvis sends with long work (spec 057 of Jarvis OS): where to answer, and with what. */
export const jarvisWorkSchema = z.object({
  execution: z.string().min(1).max(64),
  token: z.string().min(1).max(200),
  url: z.string().url(),
  until: z.string().optional(),
});
export type JarvisWork = z.infer<typeof jarvisWorkSchema>;

/** What a service gives back: the items found (written in Jarvis per `writes`), and a few words. */
export interface Outcome {
  items: Record<string, unknown>[];
  log?: string;
}

/** What a service may use while it works: its own secrets, a fetch it can be given in tests. */
export interface Context {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

export interface Service<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Its address and tool name: `offres_emploi` (letters, digits, `_`). */
  name: string;
  title: string;
  /** What it does, for a person and for a model choosing a tool. */
  description: string;
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
