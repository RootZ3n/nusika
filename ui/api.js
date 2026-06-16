// ══════════════════════════════════════════════════════════════════════
// NUSIKA · API CLIENT — talks to the Academy backend (port 18793).
// Pure vanilla. No deps. Every call resolves to {ok, data, error, status}
// and NEVER throws, so a scene can always render even when the backend
// is down.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // Resolve the backend base URL. Order: explicit ?api= query → injected
  // window.NUSIKA_API → same-origin if already served from port 18793 →
  // the local default. The Academy binds 127.0.0.1:18793.
  function resolveBase() {
    try {
      var q = new URLSearchParams(location.search).get('api');
      if (q) return q.replace(/\/$/, '');
    } catch (e) { /* file:// has no usable search */ }
    if (typeof window !== 'undefined' && window.NUSIKA_API) {
      return String(window.NUSIKA_API).replace(/\/$/, '');
    }
    try {
      if (location.protocol.startsWith('http') && location.port === '18793') {
        return location.origin;
      }
    } catch (e) { /* ignore */ }
    return 'http://127.0.0.1:18793';
  }

  var BASE = resolveBase();
  var cache = new Map();
  var CACHE_MS = 4000;

  async function get(path, opts) {
    opts = opts || {};
    var fresh = opts.fresh === true;
    var key = path;
    var nowFn = (typeof performance !== 'undefined' && performance.now)
      ? function () { return performance.now(); }
      : function () { return new Date().getTime(); };
    if (!fresh) {
      var hit = cache.get(key);
      if (hit && (nowFn() - hit.t) < CACHE_MS) return hit.v;
    }
    var result;
    try {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 6000);
      var res = await fetch(BASE + path, { method: 'GET', signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(timer);
      var data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON body */ }
      result = { ok: res.ok, status: res.status, data: data, error: res.ok ? null : ('HTTP ' + res.status) };
    } catch (err) {
      var msg = (err && err.name === 'AbortError') ? 'timed out' : (err && err.message) || String(err);
      result = { ok: false, status: 0, data: null, error: msg };
    }
    cache.set(key, { t: nowFn(), v: result });
    return result;
  }

  async function post(path, body, opts) {
    opts = opts || {};
    try {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 30000);
      var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      var res = await fetch(BASE + path, {
        method: 'POST',
        signal: ctrl.signal,
        headers: headers,
        body: JSON.stringify(body || {}),
      });
      clearTimeout(timer);
      var data = null;
      try { data = await res.json(); } catch (e) { /* ignore */ }
      return { ok: res.ok, status: res.status, data: data, error: res.ok ? null : ('HTTP ' + res.status) };
    } catch (err) {
      var msg = (err && err.name === 'AbortError') ? 'timed out' : (err && err.message) || String(err);
      return { ok: false, status: 0, data: null, error: msg };
    }
  }

  window.NusAPI = {
    base: BASE,
    // Liveness
    health: function (o) { return get('/health', o); },
    healthServices: function (o) { return get('/nusika/health/services', o); },
    // Core curriculum
    lessons: function (o) { return get('/nusika/lessons', o); },
    sessions: function (o) { return get('/nusika/sessions', o); },
    modules: function (o) { return get('/nusika/modules', o); },
    config: function (o) { return get('/nusika/config', o); },
    // Progress / reaffirmations
    reaffirmations: function (o) { return get('/nusika/reaffirmations', o); },
    // Voices
    voices: function (o) { return get('/nusika/voices', o); },
    voicesCache: function (o) { return get('/nusika/voices/cache', o); },
    // Inkwell (creative writing / drafts)
    inkwellDrafts: function (o) { return get('/nusika/shukha-anumpa/drafts', o); },
    // Chahta Anumpa language learning
    chahtaLessons: function (o) { return get('/nusika/chahta-anumpa/lessons', o); },
    chahtaWords: function (o) { return get('/nusika/chahta-anumpa/words', o); },
    chahtaPhrases: function (o) { return get('/nusika/chahta-anumpa/phrases', o); },
    // POST — conversational lookup (used by command bar `ask`)
    converse: function (message, o) { return post('/nusika/lookup', { query: message }, o); },
    // Drop cached reads so the next call refetches.
    refresh: function () { cache.clear(); },
    _get: get,
    _post: post,
  };
})();
