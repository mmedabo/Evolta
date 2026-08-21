# Evolta Assistant — free AI chat

A lightweight chat assistant for the Evolta site. It answers visitors' questions
and points them to the right learning game. It runs on **OpenRouter free-tier
models only** (zero model cost), and the API key stays **server-side** — the
browser never sees it.

```
Browser (chat-widget.js)  ──POST /api/chat──▶  Serverless proxy (api/chat.js)  ──▶  OpenRouter (:free models)
        ▲                                              │  holds OPENROUTER_API_KEY (server env only)
        └────────────────  streamed reply  ◀───────────┘
```

## Files

| File | Role |
|------|------|
| `api/chat.js` | Server-side proxy. Holds the key, injects the Evolta system prompt, restricts to `:free` models, streams the reply, rate-limits, sets CORS. |
| `assets/chat-widget.js` | Self-contained front-end widget (floating button + panel). Zero dependencies, injects its own styles. |
| `vercel.json` | Lets the `/api/chat` function stream for up to 60s. |
| `package.json` | Declares Node ≥ 18 (needed for the global `fetch` the proxy uses). |
| `.env.example` | Documents the environment variables. |
| `index.html` | Loads the widget via one `<script>` tag before `</body>`. |

## Deploy (recommended: whole site on Vercel — one origin, no CORS)

1. Push this branch and import the repo at **[vercel.com/new](https://vercel.com/new)**
   (no framework preset — it's a static site; Vercel auto-detects the `api/` folder).
2. In **Project → Settings → Environment Variables**, add:
   - `OPENROUTER_API_KEY` = your key from <https://openrouter.ai/keys>
3. Deploy. The static pages are served as-is and `/api/chat` runs as a function.
4. (Optional) Point `evolta.ai` DNS at Vercel so the live site and the proxy
   share one origin.

The widget calls **same-origin** `/api/chat` by default, so nothing else is needed.

## Alternative: keep the site on GitHub Pages, proxy on Vercel

GitHub Pages can't hold a secret, so only the **proxy** goes to Vercel:

1. Deploy this repo to Vercel and set `OPENROUTER_API_KEY` (as above). Note the
   deployment URL, e.g. `https://evolta-xxx.vercel.app`.
2. Set `ALLOWED_ORIGINS=https://evolta.ai,https://www.evolta.ai` in Vercel so the
   proxy accepts cross-origin calls from the Pages site.
3. In `index.html`, uncomment and set the endpoint line just above the widget script:
   ```html
   <script>window.EVOLTA_CHAT_ENDPOINT = "https://evolta-xxx.vercel.app/api/chat";</script>
   ```

## Add the widget to another page

Add these two lines before `</body>` on any game page (they already exist on
`index.html`). Use a root-relative path so it works from any page:

```html
<script src="/assets/chat-widget.js" defer></script>
```

## Configuration (all optional, set in Vercel env)

| Var | Default | Purpose |
|-----|---------|---------|
| `OPENROUTER_API_KEY` | — | **Required.** Your OpenRouter key. |
| `OPENROUTER_MODELS` | a built-in list | Comma-separated `:free` model slugs, tried in order. Every slug **must** end in `:free` — paid slugs are dropped. |
| `ALLOWED_ORIGINS` | evolta.ai + localhost | CORS allow-list. |
| `CHAT_RATE_LIMIT` | `20` | Max requests per IP per window. |
| `CHAT_RATE_WINDOW_MS` | `60000` | Rate-limit window length. |

### Free models

Free-model availability on OpenRouter changes and free models are frequently
rate-limited (`429`). The proxy handles this by **trying several free models in
order** until one answers. Check the current free list at
<https://openrouter.ai/models?max_price=0> and override with `OPENROUTER_MODELS`
if a default slug is retired.

## Cost & abuse guardrails

- **Free models only.** The proxy filters out any slug that doesn't end in `:free`,
  so it can't silently bill a paid model. Your OpenRouter spend stays at zero.
- **Per-IP rate limiting** is best-effort and in-memory: it resets on cold starts
  and isn't shared across serverless instances. For a hard limit (recommended
  before promoting this from demo to product), back it with **Vercel KV** or
  **Upstash Redis** — swap the `hits` Map in `api/chat.js` for a KV incr-with-TTL.
- **Message caps**: max 24 turns, 4,000 chars/message, 16,000 chars total per call.

## Roadmap: demo → internal tool → product

- **Demo (now):** anonymous, free models, best-effort limits.
- **Internal tool:** add a simple access gate (Vercel password protection or a
  shared token header) and raise `max_tokens`.
- **Product:** persist chat history + real rate limiting in a DB (e.g. Supabase),
  add auth, and optionally switch `OPENROUTER_MODELS` to paid models per plan.
