import type { Service } from '../contract';
import { lirePage } from './lire-page';
import { offresEmploi } from './offres-emploi';
import { pdf } from './pdf';

// Every service of the Atelier. A new one: a file beside these, and its line here — the API, the
// MCP server and the catalogue take it from there.
export const SERVICES: Service[] = [offresEmploi, lirePage, pdf];
