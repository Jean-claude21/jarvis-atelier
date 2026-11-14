# Spec 002 — Capabilities, more offers, PDF

**Status**: implemented · **Date**: 2026-11-14

People say what they want (« je cherche un stage en IA à Rouen »), never a service's name. Jarvis
picks the services from what each one says it can do.

## US1 — Each service says what it can do, in her words (P1)

A service adds:

- `does`: the capability in plain French (« Trouver des offres d'emploi… et les noter »);
- `examples`: things a person says that it answers;
- `effect`: `reads` (nothing changes outside), `makes` (makes something of hers: a PDF), or `sends`
  (acts outside in her name, only after her yes in Jarvis).

`GET /catalog` shows them. The MCP tools carry them, marked read-only when `effect` is `reads`.
Jarvis reads the catalogue to propose a plan.

## US2 — More offers, scored (P1)

`offres_emploi` also reads France Travail's official API when `FT_CLIENT_ID` and `FT_CLIENT_SECRET`
are set (free, francetravail.io):

- the place becomes its département (geo.api.gouv.fr);
- an internship adds « stage » to the words;
- one source failing does not stop the other.

Each offer gets a `score` out of 100 with its `reasons`, best first:

| Part of the score                | Points   |
| -------------------------------- | -------- |
| words of the search in the title | up to 60 |
| the place she named              | 20       |
| freshness: within 7 days         | 20       |
| freshness: within 30 days        | 10       |

The sources are named in `sources`.

## US3 — PDF (P1)

`pdf` makes an A4 PDF from HTML (`title`, `html`, `margin`, `landscape`) through Gotenberg (open
source), which runs beside the Atelier on the server's network (`GOTENBERG_URL`) and never in
public. Chromium runs:

- without JavaScript;
- denied private and single-label hosts.

For Jarvis, an outcome's `files` are sent to `{url}/files` with the work token, each linked
`made_by` to the execution. Called directly, the PDF comes back in base64.
