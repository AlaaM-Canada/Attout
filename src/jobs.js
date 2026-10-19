'use strict';
// In-memory background jobs so the UI can show progress for long searches.
const jobs = new Map();
let seq = 0;

function create(kind, runner) {
  const id = 'j' + (++seq) + Date.now().toString(36);
  const job = { id, kind, stage: 'queued', pct: 0, message: 'Starting', result: null, error: null, startedAt: Date.now(), done: false };
  jobs.set(id, job);
  const progress = (pct, message, stage) => { job.pct = Math.max(job.pct, Math.min(99, pct)); if (message) job.message = message; if (stage) job.stage = stage; };
  runner(progress).then((result) => { job.result = result; job.pct = 100; job.stage = 'done'; job.message = 'Done'; job.done = true; })
    .catch((e) => { job.error = e.message; job.stage = 'failed'; job.done = true; });
  // Forget finished jobs after a while.
  setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref();
  return job;
}

function get(id) { return jobs.get(id) || null; }
function publicView(job) { return { id: job.id, kind: job.kind, stage: job.stage, pct: job.pct, message: job.message, done: job.done, error: job.error, result: job.done ? job.result : null }; }

module.exports = { create, get, publicView };
