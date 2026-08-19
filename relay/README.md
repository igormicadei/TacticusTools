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

CORS is a rule browsers apply to **pages**, not a restriction on your machine.
`curl` on your laptop reaches the API perfectly well. What cannot happen is a web
page reading the reply. So the fix is to have something on your machine make the
call — that is all this is.

## Option 1 — run it locally (nothing to deploy)

```bash
node relay/local-relay.mjs        # or: npm run relay
```

It listens on `127.0.0.1:8787`, loopback only, and stores nothing: your key goes
from the page to your own machine and out to the API. Set `http://localhost:8787`
as the relay URL on the **Player data** page.

Verified end to end — browser to local relay to the live API, roster rendered.

One caveat for the **deployed** GitHub Pages site. A page on a public origin
reaching a loopback address triggers Chrome's Private Network Access check; the
relay answers it (`Access-Control-Allow-Private-Network: true`) and `localhost`
counts as a secure origin, so an HTTPS page is allowed to reach it. Browser
behaviour here has shifted between versions, though. If your browser refuses,
run the UI locally too — `npm run ui:dev` — where both sides are local and the
question does not arise.

## Option 2 — deploy the worker

```bash
npm create cloudflare@latest -- tacticus-relay
# replace src/index.js with cloudflare-worker.js
npx wrangler deploy
```

Edit `ALLOWED_ORIGINS` first so only your page can use it. The free tier is far
more than enough — this is a few requests a day. Then paste the Worker URL into
the **Player data** page.

Use this if you want the deployed page to work without starting anything, and
accept that the key transits a service you host.

## What it can and cannot see

The relay forwards requests and adds CORS headers. It stores nothing: your key
travels from your browser on each request and is passed straight to the API.

That said, the key does pass through it, so run your own rather than a public
CORS proxy. Any relay you point the app at can read every request it forwards.
Only `/api/v1/player`, `/guild` and `/guildRaid` are proxied, so it cannot be
repurposed against other hosts.
