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

| Service         | What it does                                                                                                             | Writes in Jarvis         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `offres_emploi` | Job offers (LinkedIn public listings, through treg), by words, place, contract — or for each search profile Jarvis sends | `Offre`, unique by `url` |
| `lire_page`     | A public web page (https) as text: its title and words                                                                   | —                        |

`GET /catalog` lists them, with their input (JSON Schema), where they write, and whether their
secrets are set on this server.

## Adding a service

1. A file in `src/services/` exporting `service({ name, title, description, input, writes?, long?, needs?, run })`.
2. Its line in `src/services/index.ts`.

The API route, the MCP tool and the catalogue entry follow. `run` gets its input (checked by its
schema) and `{ fetch, env, signal }`; it returns `{ items, log? }`. Open-source tools it needs run
beside it as containers (see the roadmap).

## Running

```bash
pnpm install
ATELIER_KEYS=a-long-random-key TREG_TOKEN=… pnpm dev
```

| Variable       |                                                                                    |
| -------------- | ---------------------------------------------------------------------------------- |
| `ATELIER_KEYS` | Keys allowed to ask for work, comma separated (Bearer). Without one, nothing runs. |
| `TREG_TOKEN`   | For `offres_emploi`.                                                               |
| `PORT`         | 3000 by default.                                                                   |

Deployed with Docker (`Dockerfile`) on Coolify. `pnpm check` runs lint, types, format and tests.

See [ROADMAP.md](ROADMAP.md) and [specs/](specs/).
