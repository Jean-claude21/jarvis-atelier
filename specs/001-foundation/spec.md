# Spec 001 — The Atelier's foundation

**Status**: implemented · **Date**: 2026-11-13

Generic services, deployed apart from Jarvis OS, that Jarvis's rules and any assistant call. Jarvis
stays the place where things are kept: the Atelier holds no one's data, only the work in progress
(a day at most, for whoever asks how it went).

## US1 — A service is one file (P1)

A service says its `name`, `title`, `description`, its `input` (a Zod object), where what it finds
goes in Jarvis (`writes: { kind, match?, title? }`), whether it is long (`long`, `minutes`), the
secrets it needs (`needs`), and `run(input, { fetch, env, signal }) → { items, log? }`. Listed once
in `src/services/index.ts`, it becomes:

- `POST /jobs/<name>` (its input as the body),
- an MCP tool `<name>` at `/mcp`,
- a line of `GET /catalog` (its input as JSON Schema, `writes`, `long`, `ready` when its secrets are
  set).

## US2 — Work now, or later for Jarvis (P1)

- Without `jarvis` in the body: the work is done now (5 minutes at most) and answered:
  `{ items, log }`; a failure is a 502 with its reason.
- With `jarvis: { execution, token, url }` (Jarvis OS, spec 057): `202 { accepted, job }`; the work
  runs in a queue (two at a time, its own time limit); what it found is sent to `{url}/receive`
  (`kind`, `match`, `title` from `writes`, `execution`), 200 items at a time, then
  `{url}/executions/{execution}` is closed `done` with its counts and log — or `failed` with the
  error. Every call to Jarvis carries the work token, nothing else.
- `GET /jobs/:id` says how a job went (kept a day).

## US3 — One key per caller (P1)

Every request for work (`/jobs`, `/mcp`) carries `Authorization: Bearer <key>`, one of
`ATELIER_KEYS`; without one, 401. Keys are compared by their digest, in constant time. `/health`
and `/catalog` are open.

## US4 — The first services (P1)

- `offres_emploi`: LinkedIn public listings through treg (`TREG_TOKEN`), by `query`, `location`
  (France by default), `contract` — or one search per entry of her « Profil de recherche » sent by
  Jarvis (`poste`, `lieu`, `contrat`). Each offer once (by `url`): title, company, place, date,
  contract, source. Writes `Offre`, unique by `url`.
- `lire_page`: a public https page (no private network), 1 MB at most, as its title and its text.

**Proof**: `tests/atelier.test.ts` — the catalogue; a key needed; offers found now, once each; long
work sent to a fake Jarvis with its token (receive, then close); each service an MCP tool; only
public pages read.
