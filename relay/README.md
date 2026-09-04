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

## Option 2 — a Cloudflare Worker (no tooling, works from a phone)

**A Worker is executed code, not a static file.** If the dashboard is offering to
upload files or connect a repository for static assets, that is the Pages flow —
uploading `cloudflare-worker.js` there would serve it as text rather than run it.
Look for the Worker path instead.

### Easiest on a phone: the Playground

1. Open **workers.cloudflare.com/playground**.
2. Select everything in the editor, delete it, paste the whole of
   [`cloudflare-worker.js`](cloudflare-worker.js).
3. **Deploy** (log in when prompted) and give it a name.

The Playground is a plain code editor, so it behaves on a small screen.

### Or from the dashboard

**Compute (Workers)** → **Workers & Pages** → **Create** → the **Workers** tab →
**Start with Hello World!** → **Deploy**, then **Edit code**, paste, **Deploy**
again. Direct link: `dash.cloudflare.com/?to=/:account/workers/services/new`.

### Confirm it works

Open the Worker's URL (`https://<name>.<your-subdomain>.workers.dev`) in your
browser. It answers with a small JSON health object listing the origins it
accepts — that is the deploy confirmed, with no tooling. Then paste that URL into
the app's **Player data** page next to your key.

If the listed origins do not include the site you are using, either edit
`ALLOWED_ORIGINS` at the top of the worker or add a Worker variable named
`ALLOWED_ORIGINS` (Settings → Variables) as a comma-separated list; the variable
overrides the code. The app displays the relay's own refusal, so a mismatch names
the rejected origin rather than failing silently.

## Option 3 — anywhere else that runs Web-standard handlers

`cloudflare-worker.js` uses only `Request`/`Response` and a default export, and
it tolerates being called without a `env` argument, so it runs unchanged on Deno
Deploy and similar. Deno Deploy also has a browser playground, which is another
phone-friendly route: paste the file, deploy, use the URL it gives you.

The worker forwards only `/api/v1/player`, `/guild` and `/guildRaid`, restricts
callers by origin, and stores nothing — your key passes through on each request
and is never written down. Do not point the app at a public CORS proxy: anything
it is aimed at can read every request it forwards.

`RELAY_KEY` is optional and you probably do not want it. It is only a lock while
it stays secret, and the obvious way to avoid retyping it — baking it into the
build — publishes it, since a static site has no server side and any credential
the page sends is readable by whoever holds the page. Without it the origin
allowlist is the control, callers still need their own Tacticus API key, and the
worst a stranger can do is spend the worker's daily request allowance. On the
free plan that means Cloudflare answers with its own 1027 page until 00:00 UTC —
it does not bill you — and the app recognises that case and says so.

### Pointing the app at it

The relay URL is baked in at build time. There is no field for it in the app, so
a fresh browser needs only the Tacticus key:

```bash
VITE_DEFAULT_RELAY=https://tacticus-relay.example.workers.dev npm run ui:deploy
```

`scripts/deploy-pages.sh` already sets this, so a normal deploy needs nothing
extra. For development against a local relay, pass it to the dev server:

```bash
VITE_DEFAULT_RELAY=http://localhost:8787 npm run ui:dev
```

A relay in `localStorage` under `tacticus-tools:relay` still takes precedence,
which is the escape hatch if the URL changes and you would rather not rebuild.
Nothing in the app writes it — set it from the browser console.

**Never bake `RELAY_KEY` in alongside it.** A published page publishes whatever
is in it, so a key there is readable by anyone who opens the site: a lock that
only looks locked, which is worse than no lock. Leave the Worker keyless and let
the origin allowlist and the endpoint restriction do the work.

## What it can and cannot see

The relay forwards requests and adds CORS headers. It stores nothing: your key
travels from your browser on each request and is passed straight to the API.

That said, the key does pass through it, so run your own rather than a public
CORS proxy. Any relay you point the app at can read every request it forwards.
Only `/api/v1/player`, `/guild` and `/guildRaid` are proxied, so it cannot be
repurposed against other hosts.
