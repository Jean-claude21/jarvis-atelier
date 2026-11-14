import { z } from 'zod';
import { service, type Item } from '../contract';
import { positionOf, type Position } from '../place';

// Places on a map: towns named in her words become coordinates (Géoplateforme, the French State's
// open geocoder). What a map needs — an offer, a flat, an appointment — whatever her app.

export const situer = service({
  name: 'situer',
  title: 'Situer sur une carte',
  description:
    'Turns places (towns, « Palaiseau (à 18 km de Paris) ») into coordinates for a map, by the French open geocoder. Returns one item per place found, with its position { lat, lng, address }.',
  does: 'Placer des lieux sur une carte',
  examples: [
    'mets mes offres sur une carte',
    'où se trouvent ces logements ?',
    'situe ces entreprises sur la carte',
  ],
  effect: 'reads',
  input: z.object({
    places: z.array(z.string().trim().min(2).max(200)).min(1).max(200),
  }),
  async run(input, context) {
    const known = new Map<string, Position | null>();
    const items: Item[] = [];
    for (const place of input.places) {
      const position = await positionOf(place, context, known);
      if (position) items.push({ title: place, source: 'geopf', fields: { position } });
    }
    return { items, log: `${items.length}/${input.places.length} situés` };
  },
});
