/**
 * Evolta Chat — server-side proxy for OpenRouter (free-tier models only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The Evolta site is static. A browser must never see the OpenRouter API key,
 * so all model calls go through this serverless function. The key lives only
 * in the server environment (Vercel env var OPENROUTER_API_KEY) and is never
 * sent to the client.
 *
 * DEPLOY
 * ------
 *   1. Deploy this repo to Vercel (it auto-detects the `api/` folder).
 *   2. Set env var  OPENROUTER_API_KEY  (Project → Settings → Environment Variables).
 *   3. Optional env vars — see below.
 *
 * ENV VARS
 * --------
 *   OPENROUTER_API_KEY   (required)  your OpenRouter key.
 *   OPENROUTER_MODELS    (optional)  comma-separated free-model slugs, tried in
 *                                    order until one succeeds. MUST end in ":free".
 *   ALLOWED_ORIGINS      (optional)  comma-separated origins allowed via CORS.
 *                                    Defaults to the evolta.ai domains + localhost.
 *   CHAT_RATE_LIMIT      (optional)  max requests per IP per window (default 20).
 *   CHAT_RATE_WINDOW_MS  (optional)  window length in ms (default 60000 = 1 min).
 *
 * This function has zero npm dependencies — it uses the Node 18+ global fetch.
 */

// ---- Configuration -------------------------------------------------------

// Free models only. Every slug MUST end in ":free" (enforced below) so we can
// never accidentally bill a paid model. Availability of free models changes —
// verify the current list at https://openrouter.ai/models?max_price=0 and
// override via the OPENROUTER_MODELS env var without touching this file.
// Offline fallback list, used only if the live catalog fetch fails. These are
// current free general-chat slugs — but the live discovery above is the primary
// source, so this list going stale won't break the assistant.
const DEFAULT_MODELS = [
  'z-ai/glm-5.2:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
];

const SYSTEM_PROMPT = [
  "You are the Evolta Assistant, a friendly guide on evolta.ai.",
  "Evolta is a free, non-profit learning platform: interactive games, simulations",
  "and articles that teach real concepts — trading & markets, corporate finance,",
  "energy/LNG, maths & statistics, physics, and philosophy. Its motto is",
  "\"learn, play, evolve\" and its promise is \"learning is a right, not a privilege.\"",
  "",
  "Your job is to help visitors learn. Explain concepts clearly and simply, answer",
  "questions, and when relevant point people to the matching game on the site",
  "(e.g. corporate finance → The Ledger; power trading → Peak & Dispatch;",
  "momentum & energy → Collision; statistics/AI → StatLab; philosophy → Aporia).",
  "The site is bilingual English / 中文 — if the user writes in Chinese, reply in Chinese.",
  "",
  "Be concise, warm and encouraging. Use plain language and short paragraphs.",
  "Do NOT invent company facts, prices, launch dates, or promises — Evolta's learning",
  "content is free and there is no paid tier. If you don't know something specific about",
  "Evolta, say so and suggest emailing hello@evolta.ai.",
].join('\n');

const DEFAULT_ALLOWED_ORIGINS = [
  'https://evolta.ai',
  'https://www.evolta.ai',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
];

// Request guardrails.
const MAX_MESSAGES = 24;          // cap conversation length sent upstream
const MAX_CHARS_PER_MSG = 4000;   // cap a single message
const MAX_TOTAL_CHARS = 16000;    // cap the whole conversation
const UPSTREAM_TIMEOUT_MS = 45000;

// ---- Best-effort in-memory rate limiter ----------------------------------
// NOTE: serverless instances don't share memory and cold-start resets this, so
// it's a light guard, not a hard limit. For a real limit back it with Vercel KV
// or Upstash Redis (see CHAT_SETUP.md).
const RATE_LIMIT = parseInt(process.env.CHAT_RATE_LIMIT || '20', 10);
const RATE_WINDOW_MS = parseInt(process.env.CHAT_RATE_WINDOW_MS || '60000', 10);
const hits = new Map(); // ip -> number[] (timestamps)

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  // opportunistic cleanup so the map can't grow unbounded
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return arr.length > RATE_LIMIT;
}

// ---- Free-model discovery ------------------------------------------------
// Free-model availability on OpenRouter churns constantly — slugs get retired
// and renamed, so any hard-coded list goes stale. To stay self-healing, we fetch
// the CURRENT free models from OpenRouter's public catalog at request time and
// try those, falling back to DEFAULT_MODELS only if the catalog is unreachable.
// The result is cached in module scope so warm invocations don't refetch.
let modelCache = { at: 0, list: null };
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const MODEL_TRY_LIMIT = 8;                  // cap how many we attempt per request
// Skip specialized / non-chat free models (safety classifiers, embeddings, etc.).
const NON_CHAT = /content-safety|guard|moderation|embed|rerank/i;

async function fetchLiveFreeModels() {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const list = (data.data || [])
      // Only ":free" slugs whose prompt AND completion price are exactly 0.
      .filter((m) => typeof m.id === 'string' && m.id.endsWith(':free'))
      .filter((m) => {
        const p = m.pricing || {};
        return String(p.prompt) === '0' && String(p.completion) === '0';
      })
      .map((m) => m.id)
      .filter((id) => !NON_CHAT.test(id));
    return list.length ? list : null;
  } catch {
    return null;
  }
}

async function resolveModels() {
  // Explicit env override always wins (still hard-guarded to ":free" only).
  const raw = (process.env.OPENROUTER_MODELS || '').trim();
  if (raw) {
    const free = raw.split(',').map((s) => s.trim()).filter((m) => m.endsWith(':free'));
    if (free.length) return free;
  }
  // Serve from cache while fresh.
  const now = Date.now();
  if (modelCache.list && now - modelCache.at < MODEL_CACHE_TTL_MS) {
    return modelCache.list;
  }
  const live = await fetchLiveFreeModels();
  let list;
  if (live) {
    // Try our curated defaults first (if still live), then the rest of the
    // live catalog — so known-good general-chat models are attempted before
    // the long tail. Hard safety rail: everything here already ends in ":free".
    const preferred = DEFAULT_MODELS.filter((m) => live.includes(m));
    const rest = live.filter((m) => !preferred.includes(m));
    list = [...preferred, ...rest].slice(0, MODEL_TRY_LIMIT);
  } else {
    list = DEFAULT_MODELS;
  }
  modelCache = { at: now, list };
  return list;
}

function allowedOrigins() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
}

function pickCorsOrigin(reqOrigin) {
  const list = allowedOrigins();
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  return list[0]; // safe default
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const cleaned = [];
  let total = 0;
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content = typeof m.content === 'string' ? m.content : '';
    content = content.slice(0, MAX_CHARS_PER_MSG).trim();
    if (!content) continue;
    total += content.length;
    if (total > MAX_TOTAL_CHARS) break;
    cleaned.push({ role, content });
  }
  // keep only the most recent MAX_MESSAGES turns
  return cleaned.slice(-MAX_MESSAGES);
}

// ---- Handler -------------------------------------------------------------

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', pickCorsOrigin(origin));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Server is not configured (missing OPENROUTER_API_KEY).' }));
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  if (rateLimited(ip)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)));
    return res.end(JSON.stringify({ error: 'Too many messages. Please slow down and try again shortly.' }));
  }

  // Vercel parses JSON bodies automatically; fall back to manual parse otherwise.
  let body = req.body;
  if (body == null || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages || messages.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Provide a non-empty `messages` array.' }));
  }

  const payloadMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const models = await resolveModels();

  // Try each free model in turn — free tiers 429 often, so fall through on failure.
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter attribution headers (optional but recommended).
          'HTTP-Referer': 'https://evolta.ai',
          'X-Title': 'Evolta Assistant',
        },
        body: JSON.stringify({
          model,
          messages: payloadMessages,
          stream: true,
          temperature: 0.6,
          max_tokens: 1024,
        }),
      });
    } catch (err) {
      clearTimeout(timeout);
      if (i < models.length - 1) continue; // try next model
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Upstream request failed. Please try again.' }));
    }

    if (!upstream.ok || !upstream.body) {
      clearTimeout(timeout);
      // ANY failure on a free model → fall through and try the next one. Free-tier
      // availability churns constantly: a slug can be rate-limited (429), retired
      // from the free tier (404), or error upstream (5xx). We don't special-case
      // codes — if there's another free model to try, try it.
      if (i < models.length - 1) {
        continue;
      }
      const detail = await upstream.text().catch(() => '');
      res.statusCode = upstream.status === 429 ? 429 : 502;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          error:
            upstream.status === 429
              ? 'The free models are busy right now. Please try again in a moment.'
              : 'The assistant is unavailable right now. Please try again.',
          detail: detail.slice(0, 300),
        })
      );
    }

    // Stream the response back as a minimal SSE protocol:
    //   data: {"content":"..."}   (repeated)
    //   data: [DONE]
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Tell the client which model actually answered (handy for debugging).
    res.setHeader('X-Evolta-Model', model);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // OpenRouter streams OpenAI-style SSE lines separated by \n.
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
            }
          } catch {
            /* ignore keep-alive / partial lines */
          }
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      // client disconnected or upstream broke mid-stream
      res.write(`data: ${JSON.stringify({ error: 'stream_interrupted' })}\n\n`);
    } finally {
      clearTimeout(timeout);
      res.end();
    }
    return; // handled
  }

  // Should be unreachable, but just in case every model was exhausted.
  res.statusCode = 502;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ error: 'No free model was available. Please try again later.' }));
};
