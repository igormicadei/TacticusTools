# Tacticus Tools UI

A static single-page app: no server, no runtime API calls. It is built to be
dropped on GitHub Pages as-is.

```bash
npm run gamedata:snapshot   # from the repo root — refreshes public/gamedata.json
npm run ui:dev              # http://localhost:5173
npm run ui:build            # -> ui/dist
```

## Why player data is imported by hand

The Tacticus API sends no CORS headers. A browser preflight is answered:

```
HTTP/2 403
Invalid CORS request
```

and a plain `GET` carries no `access-control-allow-origin`. No static page can
read a roster from it, wherever it is hosted — which is why community sites that
show your roster proxy the call through a backend of their own.

So the app does not ask for your API key. You fetch the roster once yourself and
paste or drop the JSON into the **Player data** page; it is stored in
`localStorage` and never leaves the browser.

`src/data/player.ts` keeps this behind a `PlayerSource` interface. If the roster
ever becomes reachable from a browser — an API change, or a proxy you run — an
HTTP-backed source drops in without touching the views.

## Where the data comes from

`public/gamedata.json` is a committed snapshot built by
`scripts/snapshot-gamedata.mjs` from the normalized game database. It omits the
`campaigns` and `npcs` sections, which the units views never read and which are
most of the bytes (3.7 MB full, 1.9 MB slim).

Committing it keeps builds reproducible and avoids re-fetching third-party
sources on every deploy. Refresh it with `npm run gamedata:snapshot` when the
game config changes; `db.sources.gameInfoVersion` shows what a build contains.

## Routes

Hash-based (`/#/units`), because GitHub Pages serves no rewrite rules and would
404 on a refreshed sub-path.

| Route | Page |
| --- | --- |
| `/#/units` | roster, grouped by status or faction |
| `/#/units/:unitId` | one unit in detail |
| `/#/import` | player data import |

Adding a page means a route in `App.tsx` and a nav entry — the shell, data
loading and the game-database context are already shared.

## Smoke test

```bash
npm run build
npx vite preview --port 4173 &
node test/smoke.mjs ../path/to/player.json
```

Drives the built bundle in Chromium, asserts both groupings render and a unit
detail page opens, and fails on any console error.

## Deploying

Two routes, pick one.

**Branch deploy** (`gh-pages`, no Actions needed):

```bash
npm run ui:deploy          # build, commit to gh-pages, push
npm run ui:deploy -- --no-push
```

`scripts/deploy-pages.sh` builds with `BASE_PATH=/<repo>/`, stages the output,
and commits it to `gh-pages` using a temporary index — your working tree and
checked-out branch are never touched. The first commit is an orphan; later ones
parent onto the previous deploy, so pushes fast-forward. Sourcemaps are dropped
and `.nojekyll` is added so Pages does not run the output through Jekyll.

Select it under **Settings → Pages → Source: Deploy from a branch → `gh-pages` /
(root)**.

**Actions deploy**: `.github/workflows/deploy-ui.yml` does the same on push to
`main`. Enable it under **Settings → Pages → Source: GitHub Actions**. The two
are alternatives — choosing a source in the Pages settings picks which one is
live.
