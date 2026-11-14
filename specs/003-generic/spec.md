# Spec 003 — Generic gestures, one shape back

**Status**: implemented · **Date**: 2026-11-14

The Atelier knows no trade. Finding an internship, a flat or a car is a recipe of a person's app in
Jarvis; the Atelier only offers gestures, each backed by an open-source tool installed beside it:

| Service     | Gesture                                            | Tool (server network only)                                   |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `chercher`  | search the web for queries, within a site if asked | SearXNG                                                      |
| `parcourir` | read sites by a recipe → elements or raw pages     | Crawl4AI (script pages, CSS extraction), plain request, treg |
| `pdf`       | HTML → PDF, kept as her file                       | Gotenberg                                                    |

`offres_emploi` and `lire_page` are gone: the first was a trade, the second is `parcourir` with a
`url`.

## One shape back

Every service returns `{ items: Item[], files?, log? }`. An `Item` is
`{ title, url?, source, text?, fields?, score?, reasons? }`:

- **structured** (`fields`): sent to Jarvis as an entry of her kind (`save.kind`), its fields by
  name beside `title`, `url`, `source`, `score`, `reasons`;
- **raw** (no `fields`): sent as a « Capture » (`save.raw`, else `Capture`) with `title`, `url`,
  `source` and its `text` (Markdown), for the AI to read and file later.

A model of hers connects to any service by naming its fields as the recipe extracts them.

## The recipe (`parcourir`)

Written by the AI from what it understood of a site, applied by the server without AI:

```json
{
  "url": "https://site/search?q={poste}&l={lieu}",
  "js": true,
  "schema": { "base": ".job", "fields": { "title": "h2", "url": "a@href", "company": ".org" } },
  "treg": { "route": "anyapi.linkedin.search.jobs", "body": { "query": "{poste}" } },
  "rename": { "published": "createdUtc" }
}
```

How it runs:

- **Placeholders.** For each source (`sources`, entries « Source » with `url` and `recipe`) and
  each search (`searches`), `{field}` takes the search's value, encoded in an address.
- **Which reader.**
  - A schema or `js` goes to Crawl4AI.
  - A plain page gets a plain request.
  - `treg` asks the route.
- **Score.** Her words (`mots`, each idea `a|b|c`) give each item a score out of 100 with its
  reasons.
- **Failures.** One source failing does not stop the others.
