# Jarvis Atelier

Generic services — searching the web, reading sites by a recipe, making a PDF… — that
[Jarvis OS](https://github.com/Jean-claude21/jarvis-os) and any assistant call. One server, one
key, two doors:

- an **HTTP API** for programs (Jarvis's rules): `POST /jobs/<service>`;
- an **MCP server** for assistants (Claude, Codex…): each service is a tool, at `/mcp`.

**Jarvis is the source of truth.** The Atelier keeps nothing: it does the work and gives back what
it found. Long work answers Jarvis later, with the work token Jarvis gave for that one execution.

```
Jarvis (rule, 7:00) ──POST /jobs/parcourir { sources, searches, jarvis: { execution, token, url, save } }──► Atelier
                    ◄──────────────── 202 accepted ─────────────────────────────────────────────
Atelier ── reads by each recipe ──► POST {url}/receive   { kind: <hers> | Capture, items, match: url }
                                  ──► POST {url}/executions/{id}  { status: done, counts }
Claude ──── Jarvis's MCP ── capabilities run chercher { queries } ──► the results, at once
```

## Services

The Atelier knows no trade. Finding an internship, a flat or a car is a recipe of a person's app in
Jarvis; the Atelier offers gestures, each backed by an open-source tool installed beside it on the
server's own network (never public):

| Service     | Gesture                                                                  | Tool                               |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `chercher`  | Search the web for queries, within a site if asked                       | SearXNG                            |
| `parcourir` | Read sites by a recipe: elements extracted into fields, or the pages raw | Crawl4AI, a plain request, or treg |
| `pdf`       | An HTML page (a CV, a letter) made an A4 PDF, kept in Jarvis as her file | Gotenberg                          |

**One shape back.** Every service returns `{ items, files?, log? }`, each item
`{ title, url?, source, text?, fields?, score?, reasons? }`. Structured items (`fields`) become
entries of her kind, their fields by name; raw items become « Capture » entries for the AI to file
later. See [spec 003](specs/003-generic/spec.md).

`GET /catalog` lists them: what each can do in her words (`does`, `examples`), its effect
(`reads`, `makes`, `sends`), its input (JSON Schema), and whether its tool is set on this server.

## Adding a service

1. A file in `src/services/` exporting `service({ name, title, description, does, examples, effect, input, writes?, long?, needs?, run })` — a gesture, never a trade; most often an adapter to an open-source tool.
2. Its line in `src/services/index.ts`.

The API route, the MCP tool and the catalogue entry follow. `run` gets its input (checked by its
schema) and `{ fetch, env, signal }`; it returns `{ items, files?, log? }`. Open-source tools it needs run
beside it as containers on the server's own network (`deploy/`: SearXNG, Crawl4AI, Gotenberg).

## Running

```bash
pnpm install
ATELIER_KEYS=a-long-random-key TREG_TOKEN=… pnpm dev
```

| Variable         |                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- |
| `ATELIER_KEYS`   | Keys allowed to ask for work, comma separated (Bearer). Without one, nothing runs. |
| `SEARXNG_URL`    | For `chercher`: SearXNG on the server's network (`deploy/searxng`).                |
| `CRAWL4AI_URL`   | For `parcourir` on pages built by script or with a schema (`deploy/crawl4ai`).     |
| `CRAWL4AI_TOKEN` | The token Crawl4AI and the Atelier share (Crawl4AI listens to no one without it).  |
| `GOTENBERG_URL`  | For `pdf`: Gotenberg on the server's network (`deploy/gotenberg`).                 |
| `TREG_TOKEN`     | For a recipe whose source has its API at treg.                                     |
| `PORT`           | 3000 by default.                                                                   |

Deployed with Docker (`Dockerfile`) on Coolify. `pnpm check` runs lint, types, format and tests.

See [ROADMAP.md](ROADMAP.md) and [specs/](specs/).
