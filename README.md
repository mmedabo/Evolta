# Evolta

Evolta is a static web project focused on interactive learning and game-style pages for trading, math, and strategy concepts.

## Project layout

- `index.html` — main landing page
- `TradingGamePortal.html` — trading sandbox portal
- `power-trading.html`, `sweet-spread.html`, `MarketMaking.html`, `HedgingGame.html` — trading-focused pages
- `MathLab.html`, `Aporia.html`, `Atlas.html`, `FlipChess.html`, `Collision.html` — additional interactive concept/game pages
- `logo.png`, `favicon.png` — shared image assets

## Run locally

This repository does not require a build step.

Option 1: Open `/home/runner/work/Evolta/Evolta/index.html` directly in your browser.

Option 2: Serve it with a simple local static server:

```bash
cd /home/runner/work/Evolta/Evolta
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
