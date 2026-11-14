import { describe, expect, it } from 'vitest';
import type { Service } from '../src/contract';
import { answerJarvis, RETRY_MS } from '../src/jobs';

// What was found reaches Jarvis even when the network fails once; when it never does, the execution
// is closed failed with the reason, instead of waiting for its time to pass.

RETRY_MS.value = 1;
const work = { execution: 'ent_exe', token: 'jos_work', url: 'https://jarvis.test/api' };
const offers = { name: 'offres', writes: { kind: 'Offre', match: 'url' } } as unknown as Service;

function network(failures: number) {
  const asked: string[] = [];
  let left = failures;
  const fake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.endsWith('/receive') && left-- > 0)
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return Response.json(url.endsWith('/receive') ? { created: 1 } : { ok: true });
  }) as typeof fetch;
  return { asked, fake };
}

describe('sending to Jarvis', () => {
  it('tries again when the network fails', async () => {
    const { asked, fake } = network(2);
    await answerJarvis(fake, work, offers, { items: [{ url: 'https://ex.com/1' }] });
    expect(asked).toEqual([
      'https://jarvis.test/api/receive',
      'https://jarvis.test/api/receive',
      'https://jarvis.test/api/receive',
      'https://jarvis.test/api/executions/ent_exe',
    ]);
  });

  it('says why when it never gets through', async () => {
    const { fake } = network(5);
    await expect(
      answerJarvis(fake, work, offers, { items: [{ url: 'https://ex.com/1' }] }),
    ).rejects.toThrow('Jarvis could not be reached on /receive: fetch failed (ECONNRESET)');
  });
});
