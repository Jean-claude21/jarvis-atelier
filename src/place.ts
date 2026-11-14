import type { Context } from './contract';

// Places on a map: a town named in a text (« Palaiseau (à 18 km de Paris) », « Paris, Île-de-France,
// France ») becomes coordinates, by the French State's open geocoder (Géoplateforme, open data, no
// key). Only towns: an offer says where it is, rarely its street. When the text says which town it
// is near (« Saint-Denis (à 10 km de Paris) »), the namesake nearest to that town wins — not the one
// across the world.

export interface Position {
  lat: number;
  lng: number;
  address: string;
}

const GEOCODER = 'https://data.geopf.fr/geocodage/search';

/** The town a place text names: before its comma, without its brackets or « à 12 km de … ». */
export function townOf(place: string): string {
  return (
    place
      .replace(/\(.*?\)/g, ' ')
      .replace(/^place/i, '')
      // « Paris 9ème », « Lyon 3e »: the town, without its district.
      .replace(/\s+\d{1,2}\s*(?:ème|eme|er|e|è)(?:\s.*)?$/i, '')
      .split(/[,·]/)[0]!
      .replace(/\b\d{1,2}\s*-\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** The town a place says it is near: « (à 10 km de Paris) » → Paris. */
export function nearOf(place: string): string | null {
  const near = /km\s+de\s+([^)]+)\)/i.exec(place)?.[1]?.trim();
  return near && near.length > 1 ? near : null;
}

interface Found extends Position {
  score: number;
}

async function candidates(
  town: string,
  { fetch, signal }: Pick<Context, 'fetch' | 'signal'>,
  limit: number,
): Promise<Found[]> {
  try {
    const answer = await fetch(
      `${GEOCODER}?${new URLSearchParams({ q: town, type: 'municipality', limit: String(limit) })}`,
      { headers: { accept: 'application/json' }, signal },
    );
    if (!answer.ok) return [];
    const { features = [] } = (await answer.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number] };
        properties?: { label?: string; context?: string; score?: number };
      }[];
    };
    return features.flatMap((one) => {
      const [lng, lat] = one.geometry?.coordinates ?? [];
      return typeof lat === 'number' && typeof lng === 'number'
        ? [
            {
              lat,
              lng,
              address: [one.properties?.label, one.properties?.context].filter(Boolean).join(', '),
              score: one.properties?.score ?? 0,
            },
          ]
        : [];
    });
  } catch {
    // A town not found is only a pin missing on her map.
    return [];
  }
}

const distance = (a: Position, b: Position) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

/** Where a place is, or null when the geocoder is not sure. Each place asked once per run. */
export async function positionOf(
  place: string,
  context: Pick<Context, 'fetch' | 'signal'>,
  known: Map<string, Position | null>,
): Promise<Position | null> {
  const town = townOf(place);
  if (town.length < 2) return null;
  const near = nearOf(place);
  const key = near ? `${town}|${near}` : town;
  if (known.has(key)) return known.get(key)!;
  let found: Position | null = null;
  const sure = (await candidates(town, context, near ? 5 : 1)).filter((one) => one.score >= 0.5);
  if (near && sure.length > 1) {
    const anchor = (await candidates(near, context, 1))[0];
    found = anchor
      ? sure.reduce((best, one) => (distance(one, anchor) < distance(best, anchor) ? one : best))
      : sure[0]!;
  } else found = sure[0] ?? null;
  const position = found ? { lat: found.lat, lng: found.lng, address: found.address } : null;
  known.set(key, position);
  return position;
}
