# Roadmap

Each step ends deployed and used from Jarvis. Open-source tools are preferred to rewriting:
they run beside the Atelier as containers on the same server, and a service calls them.

## 0.1 — Foundation ✅

- The contract of a service; the registry making each one an API route, an MCP tool and a line of
  the catalogue.
- Long work for Jarvis: 202, a small queue, results sent with the work token, execution closed.
- Keys (Bearer), Docker image, CI.
- Services: `offres_emploi` (LinkedIn through treg), `lire_page`.

## 0.2 — Capabilities and « Candidatures » ✅

- Each service says what it can do in her words (`does`, `examples`, `effect`): Jarvis picks them,
  she never names one.
- `offres_emploi`: France Travail's official API beside LinkedIn; a score per offer with its
  reasons, best first.
- `pdf`: an HTML page (a CV, a letter) made a PDF by **Gotenberg** (open source container on the
  server's network), kept in Jarvis as her file.
- Jarvis side: the « Candidatures » app declares the capabilities it uses; Jarvis reaches the
  Atelier itself, and Claude runs a capability through Jarvis's own MCP.

## 0.2.x — More offers

- Indeed / Glassdoor France through **JobSpy** (open source, its own container), a school's job
  board.

## 0.3 — Mail

- `envoyer_mail`: a mail sent through her own SMTP (Proton, kete.digital), only after her yes in
  Jarvis.
- Replies read: mail forwarded to Jarvis's own address (Cloudflare Email Routing on a sub-domain)
  and filed — no access to her personal mailbox.

## 0.4 — Reading the web harder

- `lire_page` with a real browser for pages built by script: **Browserless** / **Playwright**
  (container), **Crawl4AI** for clean Markdown.
- Limits per caller: work at once, work per day, time per job.

## 0.5 — For everyone

- A service activated in one click from Jarvis (its catalogue read, her consent, the rule made).
- A key per Jarvis account; a connection of hers lent for the work through Jarvis
  (`/api/executions/:id/call`), her secrets never held here.
- Usage per account (counts, time), and what it costs when a provider charges.
