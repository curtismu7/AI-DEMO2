'use strict';

/**
 * Which services' most recent build-images job did not succeed.
 *
 * Replaces the heal workflow's original signal (tag-digest diffing), which
 * was wrong twice over: it IFS-split `key image` pairs into single tokens and
 * inspected nonexistent repos, and it compared against main's TIP, flagging
 * every service the tip's merge didn't touch as "no image at main's sha" —
 * a nightly rebuild of everything.
 *
 * A failed build-images job is the thing that actually blocks a service (the
 * incident this heal exists for), and the job's name IS the service key, so
 * the run history is the complete signal: stale means "latest attempt at this
 * service's image did not succeed", no digest arithmetic, no tag assumptions.
 * Success means both the sha- and :latest tags were pushed, so a succeeded
 * job is current by construction.
 *
 * Input shape (NEWEST-FIRST, exactly as `gh run list` emits them):
 *   [{ conclusion, jobs: [{ name, conclusion }] }]
 * The parent job ("Build and push service images") and unknown names are
 * ignored; a service with no job history is not stale (its build comes from
 * its own merge, and there is nothing failed to retry).
 *
 * @param {{conclusion: string, jobs: {name: string, conclusion: string}[]}[]} runs
 * @param {string[]} keys service keys from the map
 * @returns {string[]} keys whose latest job attempt did not succeed, map order
 */
function staleServices(runs, keys) {
  const known = new Set(keys);
  const last = new Map(); // key -> LATEST job conclusion; first-seen wins
  // (input is newest-first), so setIfAbsent — a plain set would let an older
  // run's success mask a newer failure.
  for (const run of runs) {
    if (!run || !Array.isArray(run.jobs)) continue;
    for (const job of run.jobs) {
      if (job && known.has(job.name) && !last.has(job.name)) {
        last.set(job.name, job.conclusion);
      }
    }
  }
  return keys.filter((k) => last.has(k) && last.get(k) !== 'success');
}

module.exports = { staleServices };
