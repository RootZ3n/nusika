// ══════════════════════════════════════════════════════════════════════
// NUSIKA · SCENE DATA — live workspace renderers for all 6 Academy areas,
// plus the overview-console strip. Every workspace pulls from real API
// endpoints. No mock data.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var esc = (typeof window.esc === 'function') ? window.esc : function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  function ago(ms) {
    if (ms == null) return '—';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function offline(r) {
    return '<div class="peh-live-off"><b>The Academy is unreachable.</b><span>' +
      esc(r && r.error ? r.error : 'backend unreachable') +
      '</span><span class="peh-live-off-hint">Is the server running on :18793?</span></div>';
  }

  function stat(label, value) {
    return '<div class="peh-stat"><span class="peh-stat-v">' + esc(value) + '</span><span class="peh-stat-l">' + esc(label) + '</span></div>';
  }

  function section(title, content) {
    return '<div class="nus-ws-section"><p class="nus-ws-head">' + esc(title) + '</p>' + content + '</div>';
  }

  function rows(items) {
    if (!items || !items.length) return '<p class="peh-live-empty">Nothing here yet.</p>';
    return '<div class="peh-rows">' + items.join('') + '</div>';
  }

  function row(title, meta) {
    return '<div class="peh-row"><span class="peh-row-t">' + esc(title) + '</span>' +
      (meta ? '<span class="peh-row-m">' + esc(meta) + '</span>' : '') + '</div>';
  }

  function chips(items) {
    return '<div class="peh-chips">' + items.map(function (t) {
      return '<span class="peh-chip">' + esc(t) + '</span>';
    }).join('') + '</div>';
  }

  function toArr(data, keys) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]])) return data[keys[i]];
    }
    return [];
  }

  // ── overview-console (status strip appended to the Academy Overview deck) ──
  async function rOverviewConsole() {
    var h = await window.NusAPI.health();
    var l = await window.NusAPI.lessons();
    var s = await window.NusAPI.sessions();
    var hd = (h.ok && h.data) ? h.data : {};
    var ls = toArr(l.ok ? l.data : null, ['lessons', 'items']);
    var ss = toArr(s.ok ? s.data : null, ['sessions', 'items']);

    if (!h.ok) return offline(h);

    return '<div class="peh-stats">' +
      stat('status', hd.status || 'ok') +
      stat('modules', hd.installedCount != null ? hd.installedCount : '—') +
      stat('lessons', ls.length || '—') +
      stat('sessions', ss.length || '—') +
      '</div>';
  }

  // ── reading-study (Study Desk — lessons list) ────────────────────────────
  async function rReadingStudy() {
    var l = await window.NusAPI.lessons();
    var ls = toArr(l.ok ? l.data : null, ['lessons', 'items']);
    var html = '<div class="nus-ws">';
    html += '<div class="peh-stats">' + stat('lessons', ls.length) + '</div>';
    if (!l.ok) { html += offline(l); }
    else if (ls.length) {
      html += section('Lessons',
        rows(ls.slice(0, 12).map(function (lesson) {
          var title = lesson.title || lesson.topic || lesson.id || '(lesson)';
          var meta = [lesson.subject, lesson.module, lesson.language].filter(Boolean).join(' · ');
          return row(title, meta || null);
        }))
      );
    } else {
      html += '<p class="peh-live-empty">No lessons yet — the reading room awaits.</p>';
    }
    html += '</div>';
    return html;
  }

  // ── rare-collections (Collections — modules catalog) ─────────────────────
  async function rRareCollections() {
    var m = await window.NusAPI.modules();
    var ms = toArr(m.ok ? m.data : null, ['modules', 'items']);
    var html = '<div class="nus-ws">';
    html += '<div class="peh-stats">' + stat('modules', ms.length) + '</div>';
    if (!m.ok) { html += offline(m); }
    else if (ms.length) {
      html += section('Installed Modules',
        rows(ms.slice(0, 12).map(function (mod) {
          var name = mod.name || mod.id || '(module)';
          var meta = [mod.description, mod.version ? 'v' + mod.version : null].filter(Boolean).join(' · ');
          return row(name, meta || null);
        }))
      );
    } else {
      html += '<p class="peh-live-empty">No modules installed — the rare books wing awaits its first collection.</p>';
    }
    html += '</div>';
    return html;
  }

  // ── lecture-teach (Teaching Platform — Chahta Anumpa curriculum) ─────────
  async function rLectureTeach() {
    var cl = await window.NusAPI.chahtaLessons();
    var cw = await window.NusAPI.chahtaWords();
    var cp = await window.NusAPI.chahtaPhrases();
    var lessons = toArr(cl.ok ? cl.data : null, ['lessons', 'items']);
    var words = toArr(cw.ok ? cw.data : null, ['words', 'items']);
    var phrases = toArr(cp.ok ? cp.data : null, ['phrases', 'items']);

    var html = '<div class="nus-ws">';
    html += '<div class="peh-stats">' +
      stat('lessons', lessons.length) +
      stat('words', words.length) +
      stat('phrases', phrases.length) +
      '</div>';

    if (lessons.length) {
      html += section('Chahta Anumpa Lessons',
        rows(lessons.slice(0, 8).map(function (l) {
          var title = l.title || l.id || '(lesson)';
          var meta = l.description || l.topic || null;
          return row(title, meta);
        }))
      );
    }

    if (words.length) {
      html += section('Vocabulary sample',
        chips(words.slice(0, 20).map(function (w) {
          return typeof w === 'string' ? w : (w.chahta || w.word || w.id || '');
        }).filter(Boolean))
      );
    }

    if (!lessons.length && !words.length) {
      html += '<p class="peh-live-empty">The lecture hall is being prepared — Chahta Anumpa courses coming soon.</p>';
    }

    html += '</div>';
    return html;
  }

  // ── archive-catalog (Catalog Room — health + config) ─────────────────────
  async function rArchiveCatalog() {
    var svc = await window.NusAPI.healthServices();
    var cfg = await window.NusAPI.config();
    var h = await window.NusAPI.health();
    var hd = (h.ok && h.data) ? h.data : {};
    var sd = (svc.ok && svc.data) ? svc.data : {};
    var cfgData = (cfg.ok && cfg.data) ? cfg.data : null;

    var html = '<div class="nus-ws">';

    if (h.ok) {
      html += section('Academy Status',
        '<div class="peh-stats">' +
        stat('status', hd.status || 'ok') +
        stat('modules', hd.installedCount != null ? hd.installedCount : '—') +
        (sd.db ? stat('db', sd.db.ok ? '✓ online' : '✗ offline') : '') +
        (sd.kokoro ? stat('kokoro', sd.kokoro.ok ? '✓ online' : '✗ offline') : '') +
        (sd.llm ? stat('llm', sd.llm.mode || '—') : '') +
        '</div>'
      );
    } else {
      html += offline(h);
    }

    if (cfgData && typeof cfgData === 'object') {
      var entries = Object.entries(cfgData).filter(function (e) { return e[1] != null; }).slice(0, 10);
      if (entries.length) {
        html += section('Configuration',
          rows(entries.map(function (e) {
            return row(String(e[0]).replace(/_/g, ' '), String(e[1]));
          }))
        );
      }
    }

    html += '</div>';
    return html;
  }

  // ── script-writing (Writing Desk — inkwell/creative drafts) ──────────────
  async function rScriptWriting() {
    var d = await window.NusAPI.inkwellDrafts();
    var ds = toArr(d.ok ? d.data : null, ['drafts', 'items']);
    var html = '<div class="nus-ws">';
    html += '<div class="peh-stats">' + stat('drafts', ds.length) + '</div>';

    if (!d.ok) { html += offline(d); }
    else if (ds.length) {
      html += section('Drafts',
        rows(ds.slice(0, 12).map(function (draft) {
          var title = draft.title || '(untitled)';
          var meta = [draft.status, draft.updatedAt ? draft.updatedAt.slice(0, 10) : null].filter(Boolean).join(' · ');
          return row(title, meta || null);
        }))
      );
    } else {
      html += '<p class="peh-live-empty">No drafts yet — the writing desk awaits your first words.</p>';
    }

    html += '</div>';
    return html;
  }

  // ── correspondence-mail (Message Desk — voices) ───────────────────────────
  async function rCorrespondenceMail() {
    var v = await window.NusAPI.voices();
    var vs = toArr(v.ok ? v.data : null, ['voices', 'items']);
    var html = '<div class="nus-ws">';
    html += '<div class="peh-stats">' + stat('voices', vs.length) + '</div>';

    if (!v.ok) { html += offline(v); }
    else if (vs.length) {
      html += section('Available Voices',
        rows(vs.slice(0, 14).map(function (voice) {
          var name = typeof voice === 'string' ? voice : (voice.name || voice.id || '(voice)');
          var meta = typeof voice === 'object'
            ? [voice.language, voice.gender, voice.style].filter(Boolean).join(' · ')
            : null;
          return row(name, meta || null);
        }))
      );
    } else {
      html += '<p class="peh-live-empty">No voices configured — the correspondence chamber is listening.</p>';
    }

    html += '</div>';
    return html;
  }

  // ── defId → renderer map ─────────────────────────────────────────────────
  var MAP = {
    'overview-console': {
      fn: rOverviewConsole,
      options: [['Refresh', "NusScenes.fill('overview-console',true)"], ['Health check', "NusApp.runCommand('health')"]]
    },
    'reading-study': {
      fn: rReadingStudy,
      options: [['Refresh', "NusScenes.fill('reading-study',true)"], ['All lessons', "NusApp.runCommand('lessons')"]]
    },
    'rare-collections': {
      fn: rRareCollections,
      options: [['Refresh', "NusScenes.fill('rare-collections',true)"], ['All modules', "NusApp.runCommand('modules')"]]
    },
    'lecture-teach': {
      fn: rLectureTeach,
      options: [['Refresh', "NusScenes.fill('lecture-teach',true)"]]
    },
    'archive-catalog': {
      fn: rArchiveCatalog,
      options: [['Refresh', "NusScenes.fill('archive-catalog',true)"], ['Health', "NusApp.runCommand('health')"]]
    },
    'script-writing': {
      fn: rScriptWriting,
      options: [['Refresh', "NusScenes.fill('script-writing',true)"]]
    },
    'correspondence-mail': {
      fn: rCorrespondenceMail,
      options: [['Refresh', "NusScenes.fill('correspondence-mail',true)"], ['Voices', "NusApp.runCommand('voices')"]]
    },
  };

  function optionRow(defId) {
    var cfg = MAP[defId];
    if (!cfg || !cfg.options) return '';
    return '<div class="peh-live-opts">' + cfg.options.map(function (o) {
      return '<button class="peh-live-opt" type="button" onclick="' + esc(o[1]) + '">' + esc(o[0]) + '</button>';
    }).join('') + '</div>';
  }

  // Console-class panels that have a meaningful at-a-glance card (a headline
  // stat strip). When rendered as a compact card or Voltron tile we show only
  // that strip. Panels NOT listed always render in full so their content keeps
  // working. Only console-class panels are ever asked for a summary, so this is
  // effectively the multi-section Catalog Room.
  var GLANCE = { 'archive-catalog': 1 };
  function isGlance(defId, summary) { return !!(summary && GLANCE[defId]); }

  // Reduce a full rendered panel to its headline stat strip for the glance card.
  function glanceHtml(html) {
    try {
      var t = document.createElement('div');
      t.innerHTML = html;
      var pick = t.querySelector('.peh-live-off, .peh-stats');
      if (pick) {
        return '<div class="peh-live-glance">' + pick.outerHTML +
          '<div class="peh-glance-hint">Open the console for the full report →</div></div>';
      }
    } catch (e) { /* fall through to full html */ }
    return html;
  }

  function liveContainer(defId, summary) {
    var glance = isGlance(defId, summary);
    return '<div class="peh-live' + (glance ? ' peh-live-summary' : '') + '" id="peh-live-' + esc(defId) + '">' +
      (glance ? '' : optionRow(defId)) +
      '<div class="peh-live-body"><div class="peh-live-loading">Loading… <span class="peh-live-spin"></span></div></div>' +
      '</div>';
  }

  async function fill(defId, fresh, summary) {
    var cfg = MAP[defId];
    if (!cfg) return;
    if (fresh && window.NusAPI) window.NusAPI.refresh();
    var host = document.getElementById('peh-live-' + defId);
    if (!host) return;
    var glance = isGlance(defId, summary);
    var body = host.querySelector('.peh-live-body');
    if (fresh && body) body.innerHTML = '<div class="peh-live-loading">Refreshing… <span class="peh-live-spin"></span></div>';
    var html;
    try { html = await cfg.fn(); } catch (e) { html = offline({ error: (e && e.message) || String(e) }); }
    if (glance) html = glanceHtml(html);
    host = document.getElementById('peh-live-' + defId);
    if (!host) return;
    body = host.querySelector('.peh-live-body');
    if (body) body.innerHTML = html;
  }

  window.NusScenes = {
    has: function (defId) { return !!MAP[defId]; },
    liveContainer: liveContainer,
    fill: fill,
  };
})();
