'use strict';

const { isValidUrl, resolvesToPublicAddress } = require('./slug');

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60_000);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

async function checkOnce(monitor) {
  const started = Date.now();
  let current = String(monitor.url || '');
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isValidUrl(current) || !(await resolvesToPublicAddress(current))) {
        return {
          ok: 0,
          status_code: null,
          latency_ms: Date.now() - started,
          error: 'URL is not allowed',
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'SteadyPage/1.0 (+https://github.com/TheoryofShadows/steadypage)' },
      });
      clearTimeout(timer);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hop === MAX_REDIRECTS) {
          return {
            ok: 0,
            status_code: res.status,
            latency_ms: Date.now() - started,
            error: loc ? 'too many redirects' : 'redirect without location',
          };
        }
        current = new URL(loc, current).href;
        continue;
      }
      const latency = Date.now() - started;
      const ok = res.status >= 200 && res.status < 400;
      return {
        ok: ok ? 1 : 0,
        status_code: res.status,
        latency_ms: latency,
        error: ok ? null : `HTTP ${res.status}`,
      };
    }
  } catch (err) {
    return {
      ok: 0,
      status_code: null,
      latency_ms: Date.now() - started,
      error: err.name === 'AbortError' ? 'timeout' : String(err.message || err),
    };
  }
  return {
    ok: 0,
    status_code: null,
    latency_ms: Date.now() - started,
    error: 'too many redirects',
  };
}

function startChecker(db) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const monitors = db.prepare('SELECT id, url FROM monitors WHERE enabled = 1').all();
      for (const monitor of monitors) {
        const result = await checkOnce(monitor);
        db.prepare(
          `INSERT INTO checks (monitor_id, ok, status_code, latency_ms, error)
           VALUES (?, ?, ?, ?, ?)`
        ).run(monitor.id, result.ok, result.status_code, result.latency_ms, result.error);
        // Keep last ~500 checks per monitor
        db.prepare(
          `DELETE FROM checks WHERE monitor_id = ? AND id NOT IN (
             SELECT id FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 500
           )`
        ).run(monitor.id, monitor.id);
      }
    } catch (err) {
      console.error('[checker]', err.message || err);
    } finally {
      running = false;
    }
  }

  // Initial delay so boot isn't blocked; then every CHECK_INTERVAL_MS
  const boot = setTimeout(tick, 2_000);
  const interval = setInterval(tick, CHECK_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
  if (typeof boot.unref === 'function') boot.unref();

  return {
    stop() {
      clearTimeout(boot);
      clearInterval(interval);
    },
    tick,
    checkOnce,
  };
}

module.exports = { startChecker, checkOnce, CHECK_INTERVAL_MS };
