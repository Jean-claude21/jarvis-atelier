import { z } from 'zod';
import { service } from '../contract';

// A PDF made from a page she wrote (a CV, a cover letter, a report), by Gotenberg — an open-source
// converter running beside the Atelier on the same server (GOTENBERG_URL, never public). Chromium
// there runs without JavaScript and never fetches the server's own network: only the page given,
// and public https images or fonts it names.

const MAX_HTML = 1_000_000;

/** A file name from a title: letters, digits, dashes. */
export const fileNameOf = (title: string) =>
  `${
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'document'
  }.pdf`;

/** A page as a whole HTML document, its words kept as written. */
const documentOf = (html: string, title: string) =>
  /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>` +
      '<style>body{font-family:Georgia,serif;font-size:11.5pt;line-height:1.45;color:#111;margin:0}' +
      'h1,h2,h3{font-family:Helvetica,Arial,sans-serif;margin:0 0 .4em}p{margin:0 0 .7em}</style>' +
      `</head><body>${html}</body></html>`;

export const pdf = service({
  name: 'pdf',
  title: 'Faire un PDF',
  description:
    'Makes a PDF from an HTML page (a CV, a cover letter, a report): A4, margins in mm. For Jarvis, the PDF is kept as her file, linked to the work; called directly, it is returned in base64.',
  does: 'Mettre un CV, une lettre ou un rapport en PDF, prêt à envoyer',
  examples: [
    'fais-moi ma lettre de motivation en PDF',
    'exporte mon CV en PDF',
    'transforme ce compte rendu en PDF',
  ],
  effect: 'makes',
  input: z.object({
    title: z.string().trim().min(1).max(200),
    /** The page: HTML, or a fragment (put in a plain page). */
    html: z.string().min(1).max(MAX_HTML),
    margin: z.number().min(0).max(40).default(18),
    landscape: z.boolean().default(false),
  }),
  writes: { kind: 'Fichier' },
  long: true,
  minutes: 5,
  needs: ['GOTENBERG_URL'],
  async run(input, { fetch, env, signal }) {
    const base = env.GOTENBERG_URL?.replace(/\/$/, '');
    if (!base) throw new Error('This server has no GOTENBERG_URL: no PDF can be made.');
    const form = new FormData();
    form.append(
      'files',
      new Blob([documentOf(input.html, input.title)], { type: 'text/html' }),
      'index.html',
    );
    const inches = String(input.margin / 25.4);
    for (const side of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'])
      form.append(side, inches);
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.69');
    form.append('printBackground', 'true');
    if (input.landscape) form.append('landscape', 'true');
    const answer = await fetch(`${base}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal,
    });
    if (!answer.ok) throw new Error(`The PDF maker answered ${answer.status}.`);
    const bytes = Buffer.from(await answer.arrayBuffer());
    const name = fileNameOf(input.title);
    return {
      items: [{ title: input.title, name, bytes: bytes.byteLength }],
      files: [
        {
          name,
          mediaType: 'application/pdf',
          base64: bytes.toString('base64'),
          title: input.title,
        },
      ],
      log: `${name}: ${Math.round(bytes.byteLength / 1024)} Ko`,
    };
  },
});
