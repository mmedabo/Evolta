/**
 * Evolta Chat Widget — a self-contained, dependency-free chat launcher.
 *
 * USAGE
 * -----
 *   <script src="assets/chat-widget.js" defer></script>
 *
 * The widget injects its own styles and markup, so one <script> tag is all a
 * page needs. It talks to the server-side proxy at /api/chat (same origin by
 * default). If the site is served from GitHub Pages but the proxy lives on a
 * separate Vercel deployment, point it there before this script loads:
 *
 *   <script>window.EVOLTA_CHAT_ENDPOINT = "https://your-proxy.vercel.app/api/chat";</script>
 *   <script src="assets/chat-widget.js" defer></script>
 *
 * The OpenRouter key lives only on the server — this file never sees it.
 */
(function () {
  'use strict';

  if (window.__evoltaChatLoaded) return;
  window.__evoltaChatLoaded = true;

  var ENDPOINT = window.EVOLTA_CHAT_ENDPOINT || '/api/chat';
  var GREETING =
    "Hi! I'm the Evolta assistant. Ask me about any concept — trading, finance, " +
    "physics, statistics, philosophy — or which game to try. Learning is a right, " +
    "not a privilege. 🙂";

  // Conversation state (client-side only). Kept small; the server also caps it.
  var messages = []; // {role:'user'|'assistant', content:string}
  var busy = false;

  // ---- Styles -------------------------------------------------------------
  var css = `
  .evolta-chat *{box-sizing:border-box}
  .evolta-fab{position:fixed;right:24px;bottom:24px;z-index:2147483000;width:56px;height:56px;
    border-radius:50%;border:1px solid rgba(0,0,0,.08);background:#1a1a1a;color:#fff;cursor:pointer;
    display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.18);
    transition:transform .18s ease, box-shadow .18s ease}
  .evolta-fab:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,.24)}
  .evolta-fab svg{width:24px;height:24px}
  .evolta-panel{position:fixed;right:24px;bottom:92px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);
    height:560px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #ececec;border-radius:16px;
    box-shadow:0 18px 60px rgba(0,0,0,.20);display:none;flex-direction:column;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#1a1a1a}
  .evolta-panel.open{display:flex;animation:evolta-in .18s ease}
  @keyframes evolta-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .evolta-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #f0f0f0}
  .evolta-head .dot{width:34px;height:34px;border-radius:9px;background:#1a1a1a;color:#fff;display:flex;
    align-items:center;justify-content:center;font-weight:600;font-size:15px}
  .evolta-head .t{font-weight:600;font-size:15px;letter-spacing:-.2px}
  .evolta-head .s{font-size:12px;color:#999;font-weight:400}
  .evolta-head .x{margin-left:auto;background:none;border:none;color:#999;cursor:pointer;font-size:20px;
    line-height:1;padding:4px 6px;border-radius:8px}
  .evolta-head .x:hover{background:#f5f5f5;color:#333}
  .evolta-body{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px;background:#fafafa}
  .evolta-msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.55;
    white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}
  .evolta-msg.user{align-self:flex-end;background:#1a1a1a;color:#fff;border-bottom-right-radius:5px}
  .evolta-msg.bot{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #ededed;
    border-bottom-left-radius:5px}
  .evolta-msg.bot a{color:#1a1a1a;text-decoration:underline}
  .evolta-msg strong{font-weight:600}
  .evolta-typing{display:inline-flex;gap:4px;align-items:center;padding:4px 2px}
  .evolta-typing i{width:6px;height:6px;border-radius:50%;background:#bbb;display:inline-block;
    animation:evolta-blink 1.2s infinite}
  .evolta-typing i:nth-child(2){animation-delay:.2s}.evolta-typing i:nth-child(3){animation-delay:.4s}
  @keyframes evolta-blink{0%,60%,100%{opacity:.25}30%{opacity:1}}
  .evolta-foot{padding:12px;border-top:1px solid #f0f0f0;background:#fff}
  .evolta-inputrow{display:flex;gap:8px;align-items:flex-end}
  .evolta-inputrow textarea{flex:1;resize:none;border:1px solid #e4e4e4;border-radius:12px;padding:10px 12px;
    font-family:inherit;font-size:14px;line-height:1.4;max-height:120px;outline:none;color:#1a1a1a}
  .evolta-inputrow textarea:focus{border-color:#1a1a1a}
  .evolta-send{width:40px;height:40px;flex:0 0 40px;border-radius:12px;border:none;background:#1a1a1a;color:#fff;
    cursor:pointer;display:flex;align-items:center;justify-content:center}
  .evolta-send:disabled{opacity:.4;cursor:not-allowed}
  .evolta-send svg{width:18px;height:18px}
  .evolta-disc{font-size:11px;color:#b3b3b3;text-align:center;margin-top:8px}
  @media (prefers-color-scheme: dark){
    .evolta-panel{background:#141414;border-color:#2a2a2a;color:#f2f2f2}
    .evolta-head{border-color:#242424}.evolta-head .x:hover{background:#222;color:#eee}
    .evolta-body{background:#0e0e0e}
    .evolta-msg.bot{background:#1c1c1c;border-color:#2a2a2a;color:#f2f2f2}
    .evolta-msg.bot a{color:#f2f2f2}
    .evolta-foot{background:#141414;border-color:#242424}
    .evolta-inputrow textarea{background:#1c1c1c;border-color:#2f2f2f;color:#f2f2f2}
    .evolta-inputrow textarea:focus{border-color:#e0e0e0}
    .evolta-fab{background:#f2f2f2;color:#111;border-color:rgba(255,255,255,.1)}
    .evolta-send{background:#f2f2f2;color:#111}
  }`;

  // ---- Build DOM ----------------------------------------------------------
  var root = document.createElement('div');
  root.className = 'evolta-chat';
  var style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var SEND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  var fab = document.createElement('button');
  fab.className = 'evolta-fab';
  fab.setAttribute('aria-label', 'Open Evolta assistant');
  fab.innerHTML = CHAT_ICON;

  var panel = document.createElement('div');
  panel.className = 'evolta-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Evolta assistant');
  panel.innerHTML =
    '<div class="evolta-head">' +
      '<div class="dot">E</div>' +
      '<div><div class="t">Evolta Assistant</div><div class="s">learn, play, evolve</div></div>' +
      '<button class="x" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="evolta-body"></div>' +
    '<div class="evolta-foot">' +
      '<div class="evolta-inputrow">' +
        '<textarea rows="1" placeholder="Ask anything…" aria-label="Message"></textarea>' +
        '<button class="evolta-send" aria-label="Send">' + SEND_ICON + '</button>' +
      '</div>' +
      '<div class="evolta-disc">Free AI · may be imperfect · don’t share sensitive info</div>' +
    '</div>';

  root.appendChild(panel);
  root.appendChild(fab);

  function mount() { document.body.appendChild(root); }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  var body = panel.querySelector('.evolta-body');
  var textarea = panel.querySelector('textarea');
  var sendBtn = panel.querySelector('.evolta-send');
  var closeBtn = panel.querySelector('.evolta-head .x');

  // ---- Safe rendering (escape, then allow **bold** + linkify) -------------
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdownish(text) {
    var html = escapeHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // linkify bare URLs (already escaped, so http/https only)
    html = html.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>';
    });
    return html;
  }

  function addBubble(role) {
    var el = document.createElement('div');
    el.className = 'evolta-msg ' + (role === 'user' ? 'user' : 'bot');
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function setBubbleText(el, text, asMarkdown) {
    if (asMarkdown) el.innerHTML = renderMarkdownish(text);
    else el.textContent = text;
    body.scrollTop = body.scrollHeight;
  }

  // Greeting bubble
  (function () {
    var g = addBubble('bot');
    setBubbleText(g, GREETING, false);
  })();

  // ---- Open / close -------------------------------------------------------
  function open() {
    panel.classList.add('open');
    fab.style.display = 'none';
    setTimeout(function () { textarea.focus(); }, 50);
  }
  function close() {
    panel.classList.remove('open');
    fab.style.display = 'flex';
  }
  fab.addEventListener('click', open);
  closeBtn.addEventListener('click', close);

  // ---- Textarea autosize + submit -----------------------------------------
  textarea.addEventListener('input', function () {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  sendBtn.addEventListener('click', submit);

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state;
    textarea.disabled = state;
  }

  async function submit() {
    var text = textarea.value.trim();
    if (!text || busy) return;

    textarea.value = '';
    textarea.style.height = 'auto';

    messages.push({ role: 'user', content: text });
    setBubbleText(addBubble('user'), text, false);

    var botEl = addBubble('bot');
    botEl.innerHTML = '<span class="evolta-typing"><i></i><i></i><i></i></span>';
    setBusy(true);

    var answer = '';
    var started = false;

    try {
      var resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages.slice(-24) }),
      });

      if (!resp.ok || !resp.body) {
        var errText = 'The assistant is busy right now. Please try again in a moment.';
        try {
          var j = await resp.json();
          if (j && j.error) errText = j.error;
        } catch (e) {}
        setBubbleText(botEl, errText, false);
        setBusy(false);
        return;
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });

        var idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          var frame = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!frame.startsWith('data:')) continue;
          var data = frame.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            var payload = JSON.parse(data);
            if (payload.content) {
              if (!started) { started = true; botEl.innerHTML = ''; }
              answer += payload.content;
              setBubbleText(botEl, answer, true);
            }
          } catch (e) {}
        }
      }

      if (!answer) {
        setBubbleText(botEl, 'Hmm, I didn’t catch that. Could you try rephrasing?', false);
      } else {
        messages.push({ role: 'assistant', content: answer });
      }
    } catch (err) {
      setBubbleText(botEl, 'Connection hiccup. Please check your network and try again.', false);
    } finally {
      setBusy(false);
      textarea.focus();
    }
  }
})();
