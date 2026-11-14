# Jarvis Atelier

Generic services — finding job offers, reading a page, making a PDF, sending a mail… — that
[Jarvis OS](https://github.com/Jean-claude21/jarvis-os) and any assistant call. One server, one
key, two doors:

- an **HTTP API** for programs (Jarvis's rules): `POST /jobs/<service>`;
- an **MCP server** for assistants (Claude, Codex…): each service is a tool, at `/mcp`.

**Jarvis is the source of truth.** The Atelier keeps nothing: it does the work and gives back what
it found. Long work answers Jarvis later, with the work token Jarvis gave for that one execution.

```
Jarvis (rule, 7:00) ──POST /jobs/offres_emploi { entries, jarvis: { execution, token, url } }──► Atelier
                    ◄──────────────── 202 accepted ─────────────────────────────────────────────
Atelier ── works (treg, pages, …) ──► POST {url}/receive   { kind: Offre, items, match: url }
                                  ──► POST {url}/executions/{id}  { status: done, counts }
Claude ──── /mcp ── tools/call offres_emploi { query, location } ──► the offers, at once
```

## Services

People never name a service: they say what they want, and Jarvis picks the services from what
each one says it can do (`does`, `examples`, `effect` in the catalogue).

| Service         | What it does                                                                                                    | Writes in Jarvis         |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `offres_emploi` | Job offers (LinkedIn through treg; France Travail when its keys are set), scored against the search, best first | `Offre`, unique by `url` |
| `lire_page`     | A public web page (https) as text: its title and words                                                          | —                        |
| `pdf`           | An HTML page (a CV, a letter) made an A4 PDF by Gotenberg                                                       | her file, `made_by` it   |

`GET /catalog` lists them: what each can do in her words, its examples, its effect (`reads`,
`makes`, `sends`), its input (JSON Schema), where it writes, and whether its secrets are set on
this server.

## Adding a service

1. A file in `src/services/` exporting `service({ name, title, description, does, examples, effect, input, writes?, long?, needs?, run })`.
2. Its line in `src/services/index.ts`.

The API route, the MCP tool and the catalogue entry follow. `run` gets its input (checked by its
schema) and `{ fetch, env, signal }`; it returns `{ items, files?, log? }`. Open-source tools it needs run
beside it as containers on the server's own network (`deploy/`: Gotenberg for `pdf`).

## Running

```bash
pnpm install
ATELIER_KEYS=a-long-random-key TREG_TOKEN=… pnpm dev
```

| Variable                           |                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `ATELIER_KEYS`                     | Keys allowed to ask for work, comma separated (Bearer). Without one, nothing runs. |
| `TREG_TOKEN`                       | For `offres_emploi` (LinkedIn).                                                    |
| `FT_CLIENT_ID`, `FT_CLIENT_SECRET` | France Travail's API for `offres_emploi` (free, francetravail.io).                 |
| `GOTENBERG_URL`                    | For `pdf`: Gotenberg on the server's network (`deploy/gotenberg`).                 |
| `PORT`                             | 3000 by default.                                                                   |

Deployed with Docker (`Dockerfile`) on Coolify. `pnpm check` runs lint, types, format and tests.

See [ROADMAP.md](ROADMAP.md) and [specs/](specs/).
