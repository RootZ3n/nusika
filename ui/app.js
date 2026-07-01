// ══════════════════════════════════════════════════════════════════════
// NUSIKA · APP GLUE — wires the live backend (api.js + scenes.js) into the
// inline world engine, and adds chrome the engine doesn't own: a backend
// status dot, Peh's Journal, a command bar, and a floating chat agent.
// Loaded AFTER the inline engine so all of its globals exist.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var esc = (typeof window.esc === 'function') ? window.esc : function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // ── 1. Live workspace bodies ──────────────────────────────────────────────
  var _origBody = window.pehWorkspaceBody;
  window.pehWorkspaceBody = function (w, deckMarkup) {
    var def = (typeof pehWorkspaceDef === 'function') ? pehWorkspaceDef(w.defId) : null;
    if (def && def.kind === 'deck') return _origBody(w, deckMarkup);
    if (window.NusScenes && NusScenes.has(w.defId)) {
      // Card⇄console split: a console-class panel that isn't expanded (and every
      // Voltron dashboard tile, which passes console:false) renders a COMPACT
      // glance; the full console renders when the window is expanded (w.console).
      var meta = (typeof window.pehPanelMeta === 'function') ? window.pehPanelMeta(w.defId) : {};
      var summary = !!(meta && meta.console) && !w.console;
      setTimeout(function () { NusScenes.fill(w.defId, false, summary); }, 0);
      return NusScenes.liveContainer(w.defId, summary);
    }
    return _origBody(w, deckMarkup);
  };

  // ── 2. Academy Overview console — append a live status strip ─────────────
  var _origConsole = window.renderObservatoryConsole;
  if (typeof _origConsole === 'function') {
    window.renderObservatoryConsole = function () {
      setTimeout(function () { if (window.NusScenes) NusScenes.fill('overview-console'); }, 0);
      var extra = '<div class="nus-live"><h3 class="nus-section-title">Live Academy status</h3>' +
        (window.NusScenes ? NusScenes.liveContainer('overview-console') : '') + '</div>';
      return _origConsole() + extra;
    };
  }

  // ── 3. Journal logging on navigation ──────────────────────────────────────
  function sceneTitle(id) {
    try { var s = pehScene(pehActiveProductId(), id); return s ? s.title : id; } catch (e) { return id; }
  }
  var _origActivate = window.pehHotspotActivate;
  window.pehHotspotActivate = function (sceneId, hotspotId) {
    try {
      var s = pehScene(pehActiveProductId(), sceneId);
      var h = s && s.hotspots ? s.hotspots.find(function (x) { return x.id === hotspotId; }) : null;
      if (h && h.greeting && window.NusGuide) NusGuide.log('Pehlichi: "' + h.greeting + '"', 'peh');
    } catch (e) { /* ignore */ }
    return _origActivate(sceneId, hotspotId);
  };
  ['pehSetScene', 'pehGoScene'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (sceneId) {
      try { if (window.NusGuide) NusGuide.log('Traveled to ' + sceneTitle(sceneId) + '.', 'move'); } catch (e) {}
      return orig.apply(this, arguments);
    };
  });

  // ── 4. Backend status dot ─────────────────────────────────────────────────
  var statusEl = null, lastOnline = null;
  function buildStatus() {
    statusEl = document.createElement('button');
    statusEl.className = 'peh-status';
    statusEl.type = 'button';
    statusEl.title = 'Academy status — click to recheck';
    statusEl.innerHTML = '<i class="peh-status-dot"></i><span class="peh-status-txt">checking…</span>';
    statusEl.onclick = function () { pollHealth(true); };
    document.body.appendChild(statusEl);
  }
  async function pollHealth(manual) {
    if (!statusEl) return;
    var r = await window.NusAPI.health({ fresh: true });
    var dot = statusEl.querySelector('.peh-status-dot');
    var txt = statusEl.querySelector('.peh-status-txt');
    if (r.ok && r.data) {
      dot.className = 'peh-status-dot online';
      txt.textContent = 'online · ' + (r.data.installedCount != null ? r.data.installedCount + ' modules' : 'ok');
      statusEl.title = 'Academy online — ' + (r.data.detail || r.data.status || '');
      if (lastOnline === false && window.NusGuide) NusGuide.log('The Academy is back online.', 'ok');
      lastOnline = true;
    } else {
      dot.className = 'peh-status-dot offline';
      txt.textContent = 'offline';
      statusEl.title = 'Backend unreachable: ' + (r.error || 'no response');
      if (lastOnline !== false && window.NusGuide && lastOnline !== null) NusGuide.log('Lost the line to the Academy. Is the server running on :18793?', 'warn');
      if (manual && window.NusGuide) NusGuide.log('Still no answer from :18793. Start the server to reconnect.', 'warn');
      lastOnline = false;
    }
  }

  // ── 5. Command bar ────────────────────────────────────────────────────────
  var COMMANDS = 'help, health, lessons, sessions, modules, voices, reaffirmations, goto <area>, ask <message>';
  function buildCommandBar() {
    var bar = document.createElement('form');
    bar.className = 'peh-cmd';
    bar.innerHTML =
      '<span class="peh-cmd-mark" aria-hidden="true">›</span>' +
      '<input class="peh-cmd-input" type="text" autocomplete="off" spellcheck="false" ' +
      'placeholder="Ask the Academy — try: help">' +
      '<button class="peh-cmd-go" type="submit" aria-label="Run">Run</button>';
    document.body.appendChild(bar);
    var input = bar.querySelector('.peh-cmd-input');
    bar.onsubmit = function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!v) return;
      input.value = '';
      runCommand(v);
    };
  }

  var SCENE_ALIASES = {
    hall: 'grand-hall', hub: 'grand-hall', academy: 'grand-hall',
    reading: 'reading-room', library: 'reading-room', study: 'reading-room',
    rare: 'rare-books-wing', 'rare-books': 'rare-books-wing', collections: 'rare-books-wing',
    lecture: 'lecture-hall', teaching: 'lecture-hall',
    archives: 'archives', archive: 'archives', catalog: 'archives',
    scriptorium: 'scriptorium', scribe: 'scriptorium', writing: 'scriptorium',
    correspondence: 'correspondence-chamber', chamber: 'correspondence-chamber', mail: 'correspondence-chamber',
  };

  async function summarize(label, promise, fmt) {
    NusGuide.toggle(true);
    var r = await promise;
    if (!r.ok || !r.data) { NusGuide.log(label + ': offline (' + (r.error || '?') + ')', 'warn'); return; }
    NusGuide.log(label + ': ' + fmt(r.data), 'data');
  }

  async function runCommand(raw) {
    var parts = raw.split(/\s+/);
    var cmd = parts.shift().toLowerCase();
    var rest = parts.join(' ');
    if (!window.NusGuide) return;
    switch (cmd) {
      case 'help':
        NusGuide.toggle(true);
        NusGuide.log('Commands: ' + COMMANDS, 'note');
        break;
      case 'health':
        await summarize('Health', NusAPI.health({ fresh: true }), function (d) {
          return (d.status || '?') + ' · ' + (d.installedCount != null ? d.installedCount + ' modules' : '');
        });
        break;
      case 'lessons':
        await summarize('Lessons', NusAPI.lessons({ fresh: true }), function (d) {
          var arr = Array.isArray(d) ? d : (d.lessons || []);
          return arr.length + ' lessons';
        });
        break;
      case 'sessions':
        await summarize('Sessions', NusAPI.sessions({ fresh: true }), function (d) {
          var arr = Array.isArray(d) ? d : (d.sessions || []);
          return arr.length + ' sessions';
        });
        break;
      case 'modules':
        await summarize('Modules', NusAPI.modules({ fresh: true }), function (d) {
          var arr = Array.isArray(d) ? d : (d.modules || []);
          return arr.length + ' modules installed';
        });
        break;
      case 'voices':
        await summarize('Voices', NusAPI.voices({ fresh: true }), function (d) {
          var arr = Array.isArray(d) ? d : (d.voices || []);
          return arr.length + ' voices available';
        });
        break;
      case 'reaffirmations':
        await summarize('Reaffirmations', NusAPI.reaffirmations({ fresh: true }), function (d) {
          var arr = Array.isArray(d) ? d : (d.due || []);
          return arr.length + ' due';
        });
        break;
      case 'goto':
        var target = SCENE_ALIASES[rest.toLowerCase()] || rest;
        if (target && typeof pehGoScene === 'function' && pehScene(pehActiveProductId(), target)) {
          pehGoScene(target);
        } else {
          NusGuide.log('No such area: "' + rest + '". Try: hall, reading, lecture, archives, scriptorium, correspondence', 'warn');
        }
        break;
      case 'ask':
        if (!rest) { NusGuide.log('Ask what? e.g. "ask what should I study next?"', 'note'); break; }
        await ask(rest);
        break;
      default:
        await ask(raw);
    }
  }

  async function ask(message) {
    NusGuide.toggle(true);
    NusGuide.log('You: ' + message, 'you');
    NusGuide.log('Pehlichi is thinking…', 'note');
    var r = await NusAPI.converse(message);
    if (r.ok && r.data && (r.data.response || r.data.content || r.data.result)) {
      NusGuide.log('Pehlichi: ' + (r.data.response || r.data.content || r.data.result), 'peh');
    } else if (r.status === 401) {
      NusGuide.log('Pehlichi: The reading room is locked — needs a token.', 'warn');
    } else {
      NusGuide.log('Pehlichi: I would answer, but the line to the Academy is quiet right now.', 'warn');
    }
  }

  window.NusApp = { runCommand: runCommand, ask: ask, pollHealth: pollHealth };

  // ── 6. Floating Nusika Chat Agent ─────────────────────────────────────────
  var nusChatOpen = false;
  var nusChatDrawerEl = null;
  var nusChatBtnEl = null;

  function buildNusChat() {
    nusChatBtnEl = document.createElement('button');
    nusChatBtnEl.className = 'nus-chat-btn';
    nusChatBtnEl.type = 'button';
    nusChatBtnEl.innerHTML = '<img src="assets/peh-nusika.png" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:50%">';
    nusChatBtnEl.title = 'Ask the Academy';
    nusChatBtnEl.setAttribute('aria-label', 'Open Academy chat');
    nusChatBtnEl.onclick = toggleNusChat;
    document.body.appendChild(nusChatBtnEl);

    nusChatDrawerEl = document.createElement('div');
    nusChatDrawerEl.className = 'nus-chat-drawer';
    nusChatDrawerEl.setAttribute('role', 'dialog');
    nusChatDrawerEl.setAttribute('aria-label', 'Academy Chat');
    nusChatDrawerEl.innerHTML =
      '<div class="nus-chat-header">' +
        '<div class="nus-chat-avatar"><img src="assets/peh-nusika.png" alt=""></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;font-size:13px;color:var(--ink,#e8f0ec);font-family:var(--acad-display,serif)">The Academy</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,#8aaa97)">Ask Pehlichi anything</div>' +
        '</div>' +
        '<button class="nus-chat-close" type="button" aria-label="Close chat" onclick="toggleNusChat()">×</button>' +
      '</div>' +
      '<div class="nus-chat-messages" id="nus-chat-msgs"></div>' +
      '<div class="nus-chat-input-wrap">' +
        '<input class="nus-chat-input" type="text" id="nus-chat-input" ' +
          'placeholder="Ask the Academy…" autocomplete="off" spellcheck="false">' +
        '<button class="nus-chat-send" type="button" onclick="sendNusChat()">Send</button>' +
      '</div>';
    document.body.appendChild(nusChatDrawerEl);

    nusChatDrawerEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'nus-chat-input') {
        e.preventDefault();
        sendNusChat();
      }
    });

    appendNusChatMsg('assistant', 'Welcome to the Academy. I\'m Pehlichi — your guide through these halls. What would you like to learn today?');
  }

  function toggleNusChat() {
    nusChatOpen = !nusChatOpen;
    if (nusChatDrawerEl) nusChatDrawerEl.classList.toggle('open', nusChatOpen);
    if (nusChatBtnEl) nusChatBtnEl.classList.toggle('active', nusChatOpen);
    if (nusChatOpen) {
      var inp = document.getElementById('nus-chat-input');
      if (inp) { try { setTimeout(function () { inp.focus(); }, 60); } catch (e) {} }
    }
  }

  function appendNusChatMsg(role, text) {
    var msgs = document.getElementById('nus-chat-msgs');
    if (!msgs) return;
    var el = document.createElement('div');
    el.className = 'nus-msg ' + role;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function sendNusChat() {
    var inp = document.getElementById('nus-chat-input');
    if (!inp) return;
    var text = (inp.value || '').trim();
    if (!text) return;
    inp.value = '';
    appendNusChatMsg('user', text);

    var msgs = document.getElementById('nus-chat-msgs');
    var thinking = document.createElement('div');
    thinking.className = 'nus-msg assistant';
    thinking.style.cssText = 'opacity:.5;font-style:italic';
    thinking.textContent = 'Thinking…';
    if (msgs) { msgs.appendChild(thinking); msgs.scrollTop = msgs.scrollHeight; }

    var r = await NusAPI.converse(text);
    if (thinking.parentNode) thinking.parentNode.removeChild(thinking);

    if (r.ok && r.data && (r.data.response || r.data.content || r.data.result)) {
      appendNusChatMsg('assistant', r.data.response || r.data.content || r.data.result);
    } else if (r.status === 503) {
      appendNusChatMsg('assistant', 'The Academy is quiet right now. Start the server to enable live conversation.');
    } else if (r.status === 401) {
      appendNusChatMsg('assistant', 'Unauthorized — a token is required to use the conversational endpoint.');
    } else {
      appendNusChatMsg('assistant', 'No response from the Academy. Is the server running on :18793?');
    }
  }

  window.toggleNusChat = toggleNusChat;
  window.sendNusChat = sendNusChat;

  // ── Boot ──────────────────────────────────────────────────────────────────
  function start() {
    if (window.NusGuide) NusGuide.init();
    buildStatus();
    buildCommandBar();
    buildNusChat();
    if (window.NusGuide) NusGuide.log('Welcome to the Academy. Type "help" for commands.', 'peh');
    if (typeof window.render === 'function') { try { window.render(); } catch (e) {} }
    pollHealth();
    setInterval(function () { pollHealth(); }, 12000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
