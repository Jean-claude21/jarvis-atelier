import type { Service } from '../contract';
import { chercher } from './chercher';
import { parcourir } from './parcourir';
import { pdf } from './pdf';
import { situer } from './situer';

// Every service of the Atelier: generic gestures, never a trade — what a person does with them
// (find an internship, a flat, a car) is a recipe of her app in Jarvis. A new one: a file beside
// these, and its line here — the API, the MCP server and the catalogue take it from there.
export const SERVICES: Service[] = [chercher, parcourir, pdf, situer];
