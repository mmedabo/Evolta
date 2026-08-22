# Evolta Assistant — High-Level Design (HLD)

**System:** Evolta Assistant — a free, embeddable AI chat agent for the Evolta learning site (`evolta.ai`).
**Status:** Live (demo stage). Deployed at `https://evolta-two.vercel.app`.
**Owner:** mmedabo · **Repo:** `mmedabo/Evolta`

---

## 1. Purpose & context

Evolta is a free, non-profit learning platform (interactive games, simulations and
articles on trading, finance, energy, maths/stats, physics and philosophy). The
Evolta Assistant is a chat widget on the site that answers visitors' questions and
points them to the right learning game.

It is built to grow along a deliberate path: **demo → internal tool → product**.

### Goals
- **Free to operate.** Uses **OpenRouter free-tier models only** (zero model cost).
- **Zero secret exposure.** The OpenRouter API key never reaches the browser.
- **Drop-in.** One `<script>` tag adds the widget to any page; no build step, no deps.
- **Resilient.** Keeps working as OpenRouter's free-model catalog churns.
- **Streaming UX.** Replies appear token-by-token.

### Non-goals (at demo stage)
- No user accounts / auth.
- No server-side persistence of chat history.
- No paid models, no per-user billing.
- Hard, distributed rate limiting (current limiter is best-effort — see Risks).

---

## 2. System context

```mermaid
flowchart LR
    U[Visitor's browser] -->|loads page| SITE[Static site<br/>evolta.ai pages]
    SITE -->|injects| W[chat-widget.js<br/>floating chat UI]
    W -->|POST /api/chat<br/>JSON messages| PROXY[Serverless proxy<br/>api/chat.js]
    PROXY -->|catalog lookup| CAT[(OpenRouter<br/>public /models)]
    PROXY -->|chat completion<br/>Bearer key, stream| OR[(OpenRouter API<br/>:free models)]
    OR -->|SSE tokens| PROXY
    PROXY -->|SSE tokens| W

    subgraph Client [Browser · untrusted]
        SITE
        W
    end
    subgraph Server [Server · holds secret]
        PROXY
    end

    KEY[[OPENROUTER_API_KEY<br/>server env only]] -.-> PROXY
```

The **trust boundary** is the key design decision: the API key lives only in the
server environment. The browser talks exclusively to our own `/api/chat`; it never
sees the key or calls OpenRouter directly.

---

## 3. Components

| Component | Tech | Responsibility |
|-----------|------|----------------|
| **Static site** | Plain HTML (GitHub Pages / Vercel static) | Serves the learning pages; loads the widget via one `<script>`. |
| **Chat widget** (`assets/chat-widget.js`) | Vanilla JS, zero deps, self-injecting CSS | Floating button + panel, conversation state, streaming render, safe markup. |
| **Chat proxy** (`api/chat.js`) | Node ≥18 serverless function (Vercel) | Holds the key, enforces free-only models, discovers live models, injects system prompt, rate-limits, CORS, streams reply. |
| **OpenRouter** | External API | Routes to underlying free LLMs; returns OpenAI-style streamed completions. |

---

## 4. Request lifecycle (happy path)

```mermaid
sequenceDiagram
    participant B as Browser (widget)
    participant P as Proxy (/api/chat)
    participant C as OpenRouter /models
    participant O as OpenRouter /chat/completions

    B->>P: POST {messages:[...]} (last 24 turns)
    P->>P: CORS · method · key · rate-limit · sanitize
    P->>C: GET /models (cached 10 min)
    C-->>P: current :free slugs
    P->>P: build [system prompt, ...messages]
    loop each free model until one answers
        P->>O: POST chat/completions (stream, :free)
        alt model available
            O-->>P: SSE token stream
            P-->>B: SSE {content:"…"} … [DONE]
        else 404/429/5xx
            O-->>P: error → try next model
        end
    end
    B->>B: render tokens live, store assistant reply
```

---

## 5. Deployment topology

Two supported shapes. The proxy needs a server that can hold a secret, so it always
runs on Vercel; the static pages can live with it or stay on GitHub Pages.

### Option A — Everything on Vercel (recommended, currently live)
One origin ⇒ the widget calls same-origin `/api/chat`, no CORS needed.

```mermaid
flowchart TB
    subgraph Vercel
        S[Static pages] & F[api/chat.js function]
    end
    B[Browser] --> S
    B -->|/api/chat| F
    F --> OR[(OpenRouter :free)]
```

### Option B — Site on GitHub Pages, proxy on Vercel
Pages can't hold a secret, so only the proxy goes to Vercel. Requires `ALLOWED_ORIGINS`
(CORS) and a `window.EVOLTA_CHAT_ENDPOINT` override in the page.

```mermaid
flowchart TB
    B[Browser] --> GP[GitHub Pages<br/>evolta.ai static]
    B -->|cross-origin /api/chat| VF[Vercel function<br/>api/chat.js]
    VF --> OR[(OpenRouter :free)]
```

---

## 6. Cross-cutting concerns

| Concern | Approach |
|---------|----------|
| **Secret management** | Key in Vercel env var `OPENROUTER_API_KEY`; never in repo (git-ignored `.env`), never sent to client. |
| **Cost control** | Only `:free` slugs are ever called — enforced at model resolution (suffix + price=0 checks). Spend is structurally pinned to zero. |
| **Availability** | Live model discovery + fall-through across many free models: one retired/rate-limited model can't break the chat. |
| **Abuse / rate limiting** | Best-effort per-IP in-memory limiter (default 20 req / 60 s); message size/turn caps. |
| **CORS** | Allow-list (`ALLOWED_ORIGINS`), defaults to evolta.ai + localhost. |
| **Streaming** | Server-Sent-Events–style protocol; `vercel.json` allows up to 60 s function duration. |
| **XSS safety** | Widget escapes all model output, then re-allows only `**bold**` and `http(s)` links. |
| **Privacy** | No chat storage; disclaimer in the UI ("don't share sensitive info"). |

---

## 7. Evolution roadmap

```mermaid
flowchart LR
    D[Demo — now<br/>anonymous · free models<br/>best-effort limits] --> I[Internal tool<br/>access gate / shared token<br/>higher max_tokens]
    I --> P[Product<br/>auth · DB history<br/>real rate limit KV/Redis<br/>optional paid tiers]
```

| Stage | Additions |
|-------|-----------|
| **Demo (now)** | Anonymous chat, free models, in-memory limits. |
| **Internal tool** | Vercel password protection or shared-token header; raise `max_tokens`. |
| **Product** | Persist history + real rate limiting (Vercel KV / Upstash Redis / Supabase), auth, optional paid models per plan. |

---

## 8. Assumptions & risks

| # | Risk | Mitigation / note |
|---|------|-------------------|
| 1 | Free models are frequently rate-limited (429) or retired (404). | Live discovery + fall-through across ≤8 models per request. |
| 2 | In-memory rate limiter resets on cold start and isn't shared across instances. | Acceptable for demo; back with KV/Redis before "product". |
| 3 | Free-model quality is lower than GPT-4/Claude. | Acceptable for a learning-guide assistant; system prompt keeps scope tight. |
| 4 | Vercel Hobby caps function duration below Pro. | `max_tokens: 1024` keeps responses short; lower `maxDuration` if the plan rejects 60 s. |
| 5 | OpenRouter free tiers may require data-sharing / have daily caps. | Configurable via `OPENROUTER_MODELS`; monitored via `X-Evolta-Model` header. |

See [LLD.md](LLD.md) for module-level detail and [IMPLEMENTATION.md](IMPLEMENTATION.md) for the build/deploy workflow.
