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

## 0.3 — Generic gestures ✅

- No trade in the Atelier: `chercher` (SearXNG), `parcourir` (a recipe written by the AI: Crawl4AI,
  a plain request or treg), `pdf` (Gotenberg). `offres_emploi` and `lire_page` are gone.
- One shape back for every service: structured items become her kind, raw ones « Capture ».

## 0.4 — Mail

- `envoyer_mail`: a mail sent through her own SMTP (Proton, kete.digital), only after her yes in
  Jarvis.
- Replies read: mail forwarded to Jarvis's own address (Cloudflare Email Routing on a sub-domain)
  and filed — no access to her personal mailbox.

## 0.5 — Watching and understanding

- `surveiller`: a page watched for changes (**changedetection.io**).
- `comprendre`: a PDF, a scan, a Word file read into structured text (**Docling**).
- `prevenir`: notifications to her phone and apps (**Apprise** / **ntfy**).
- Limits per caller: work at once, work per day, time per job.

## 0.6 — For everyone

- A service activated in one click from Jarvis (its catalogue read, her consent, the rule made).
- A key per Jarvis account; a connection of hers lent for the work through Jarvis
  (`/api/executions/:id/call`), her secrets never held here.
- Usage per account (counts, time), and what it costs when a provider charges.
