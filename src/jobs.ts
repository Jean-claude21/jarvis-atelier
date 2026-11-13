import { randomBytes } from 'node:crypto';
import type { Context, JarvisWork, Outcome, Service } from './contract';

// Long work: accepted at once (202), done in the background a few at a time, and its result sent
// to Jarvis with the work token Jarvis gave — what was found to `/receive`, then the execution
// closed (`/executions/:id`), done or failed. Nothing is kept here once it is sent: Jarvis is the
// place where things are kept. A job is remembered a day, for whoever asks how it went.

export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  service: string;
  state: JobState;
  createdAt: string;
  endedAt?: string;
  count?: number;
  error?: string;
  /** The execution of Jarvis it answers for, if any. */
  execution?: string;
  /** What was found, kept a day for a caller without Jarvis (an assistant asking later). */
  items?: Record<string, unknown>[];
}

const KEEP_MS = 24 * 3_600_000;
const RUNNING_AT_ONCE = 2;

/** Sends what a service found to Jarvis, then closes its execution. */
export async function answerJarvis(
  fetcher: typeof fetch,
  work: JarvisWork,
  service: Service,
  outcome: Outcome | { error: string },
): Promise<void> {
  const base = work.url.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${work.token}`, 'content-type': 'application/json' };
  const post = async (path: string, body: unknown) => {
    const answer = await fetcher(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!answer.ok) {
      // Its own words, a few: what to fix (never the token, which is not in them).
      const said = (await answer.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      throw new Error(`Jarvis answered ${answer.status} on ${path}: ${said}`);
    }
    return answer.json() as Promise<Record<string, unknown>>;
  };
  if ('error' in outcome) {
    await post(`/executions/${work.execution}`, { status: 'failed', error: outcome.error });
    return;
  }
  let counts: Record<string, number> = { found: outcome.items.length };
  // Her rule says where it goes; the service's own idea only when it says nothing.
  const writes = work.save ?? service.writes;
  if (writes && outcome.items.length) {
    // Jarvis takes 200 at a time.
    for (let at = 0; at < outcome.items.length; at += 200) {
      const got = await post('/receive', {
        kind: writes.kind,
        items: outcome.items.slice(at, at + 200),
        ...(writes.match ? { match: writes.match } : {}),
        ...(writes.title ? { title: writes.title } : {}),
        execution: work.execution,
      });
      for (const name of ['created', 'updated', 'skipped'])
        counts = { ...counts, [name]: (counts[name] ?? 0) + Number(got[name] ?? 0) };
    }
  }
  await post(`/executions/${work.execution}`, {
    status: 'done',
    counts,
    ...(outcome.log ? { log: outcome.log.slice(0, 4000) } : {}),
  });
}

export function jobQueue(context: () => Omit<Context, 'signal'>) {
  const jobs = new Map<string, Job>();
  const waiting: (() => Promise<void>)[] = [];
  let running = 0;

  const next = () => {
    while (running < RUNNING_AT_ONCE && waiting.length) {
      const work = waiting.shift()!;
      running += 1;
      void work().finally(() => {
        running -= 1;
        next();
      });
    }
  };
  const forget = () => {
    const old = Date.now() - KEEP_MS;
    for (const [id, job] of jobs) if (Date.parse(job.createdAt) < old) jobs.delete(id);
  };

  return {
    get: (id: string) => jobs.get(id) ?? null,
    /** Work accepted now, done when its turn comes; its end awaited by tests through `done`. */
    start(service: Service, input: unknown, work?: JarvisWork) {
      forget();
      const job: Job = {
        id: `job_${randomBytes(9).toString('base64url')}`,
        service: service.name,
        state: 'queued',
        createdAt: new Date().toISOString(),
        ...(work ? { execution: work.execution } : {}),
      };
      jobs.set(job.id, job);
      const done = new Promise<void>((resolve) => {
        waiting.push(async () => {
          job.state = 'running';
          const signal = AbortSignal.timeout((service.minutes ?? 15) * 60_000);
          const ctx = { ...context(), signal };
          let outcome: Outcome | { error: string };
          try {
            outcome = await service.run(service.input.parse(input), ctx);
            job.count = outcome.items.length;
            if (!work) job.items = outcome.items;
          } catch (error) {
            outcome = { error: (error as Error).message.slice(0, 1000) };
            job.error = outcome.error;
          }
          try {
            if (work) await answerJarvis(ctx.fetch, work, service, outcome);
            job.state = 'error' in outcome ? 'failed' : 'done';
          } catch (error) {
            job.state = 'failed';
            job.error = `Not delivered to Jarvis: ${(error as Error).message}`;
          }
          job.endedAt = new Date().toISOString();
          // One line per job, never its content or its token.
          console.info(
            `[job] ${job.id} ${job.service} ${job.state}` +
              (job.count !== undefined ? ` ${job.count} found` : '') +
              (job.error ? ` — ${job.error}` : ''),
          );
          resolve();
        });
        next();
      });
      return { job, done };
    },
  };
}
export type JobQueue = ReturnType<typeof jobQueue>;
