# Tacticus API relay

The app stores your API key in your browser and fetches your roster itself — but
it cannot reach the game API directly. This relay is the missing piece.

## Why it is needed

Measured against the live API:

| Check | Result |
| --- | --- |
| `OPTIONS` preflight from any origin | `403 Invalid CORS request` |
| `access-control-allow-origin` on a plain `GET` | absent |
| API key as a query parameter (5 spellings) | `403` — header only |

The key is accepted only as the `X-API-KEY` header. A custom header forces a
preflight, and the preflight is refused for every origin tested — including
`tacticuscodex.com`, which is why that site proxies the call through a backend of
its own. No browser page can read the response, on GitHub Pages or anywhere else.

## Deploy it

```bash
npm create cloudflare@latest -- tacticus-relay
# replace src/index.js with cloudflare-worker.js
npx wrangler deploy
```

Edit `ALLOWED_ORIGINS` first so only your page can use it. The free tier is far
more than enough — this is a few requests a day.

Then paste the Worker URL into the app's **Player data** page alongside your key.

## What it can and cannot see

The relay forwards requests and adds CORS headers. It stores nothing: your key
travels from your browser on each request and is passed straight to the API.

That said, the key does pass through it, so run your own rather than a public
CORS proxy. Any relay you point the app at can read every request it forwards.
Only `/api/v1/player`, `/guild` and `/guildRaid` are proxied, so it cannot be
repurposed against other hosts.
