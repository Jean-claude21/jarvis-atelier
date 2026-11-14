import type { Context } from './contract';

// Places on a map: a town named in a text (« Palaiseau (à 18 km de Paris) », « Paris, Île-de-France,
// France ») becomes coordinates, by the French State's open geocoder (Géoplateforme, open data, no
// key). Only towns: an offer says where it is, rarely its street.

export interface Position {
  lat: number;
  lng: number;
  address: string;
}

const GEOCODER = 'https://data.geopf.fr/geocodage/search';

/** The town a place text names: before its comma, without its brackets or « à 12 km de … ». */
export function townOf(place: string): string {
  return place
    .replace(/\(.*?\)/g, ' ')
    .replace(/^place/i, '')
    .split(/[,·]/)[0]!
    .replace(/\b\d{1,2}\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where a place is, or null when the geocoder is not sure. Each town asked once per run. */
export async function positionOf(
  place: string,
  { fetch, signal }: Pick<Context, 'fetch' | 'signal'>,
  known: Map<string, Position | null>,
): Promise<Position | null> {
  const town = townOf(place);
  if (town.length < 2) return null;
  if (known.has(town)) return known.get(town)!;
  let found: Position | null = null;
  try {
    const answer = await fetch(
      `${GEOCODER}?${new URLSearchParams({ q: town, type: 'municipality', limit: '1' })}`,
      { headers: { accept: 'application/json' }, signal },
    );
    if (answer.ok) {
      const { features = [] } = (await answer.json()) as {
        features?: {
          geometry?: { coordinates?: [number, number] };
          properties?: { label?: string; context?: string; score?: number };
        }[];
      };
      const one = features[0];
      const [lng, lat] = one?.geometry?.coordinates ?? [];
      if (
        one &&
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        (one.properties?.score ?? 0) >= 0.5
      )
        found = {
          lat,
          lng,
          address: [one.properties?.label, one.properties?.context].filter(Boolean).join(', '),
        };
    }
  } catch {
    // A town not found is only a pin missing on her map.
  }
  known.set(town, found);
  return found;
}
