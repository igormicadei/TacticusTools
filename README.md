# TacticusTools

TypeScript types and a dependency-free client for the read-only
[Tacticus API](https://api.tacticusgame.com) (`v0.1 BETA`).

## Layout

```
src/
  types/
    common.ts     Rarity, GrandAlliance, Token, timestamp handling
    errors.ts     Error payloads + TacticusApiError
    player.ts     GET /api/v1/player            -> PlayerResponse
    guild.ts      GET /api/v1/guild             -> GuildResponse
    guildRaid.ts  GET /api/v1/guildRaid[/{season}] -> GuildRaidResponse
  client.ts       TacticusClient
test/
  fixtures.check.ts  Compile-time check that spec examples satisfy the types
examples/
  fetch-all.ts       Runnable end-to-end example
```

## Usage

```ts
import { TacticusClient, TacticusApiError } from 'tacticus-tools';

const client = new TacticusClient({ apiKey: process.env.TACTICUS_API_KEY! });

const { player, metaData } = await client.getPlayer();
const { guild } = await client.getGuild();
const raid = await client.getGuildRaid();        // current season
const past = await client.getGuildRaid(68);      // a specific season
```

Every non-2xx response throws a `TacticusApiError` carrying `status`, the API's
`type` discriminator (`FORBIDDEN` / `NOT_FOUND` / `UNKNOWN_ERROR`), the parsed
`body`, and a `retryable` flag (true for 5xx, which the spec documents as
retryable).

```bash
npm install
npm run typecheck                                  # types + fixtures + examples
TACTICUS_API_KEY=<key> npx tsx examples/fetch-all.ts
```

## Verified against the live API

The `player` endpoint has been validated against a real response (29 units,
47 items, 102 upgrades, 8 campaigns): **no drift**, across 21 shapes. Re-check
any time with:

```bash
npm run validate -- response.json          # a saved body
TACTICUS_API_KEY=<key> npm run validate -- --live
```

The validator reports missing required fields, undeclared fields, and
out-of-union enum values.

Three corrections came out of that first live response, and are now encoded:

| Finding | Spec said | API actually sends |
| --- | --- | --- |
| `CampaignProgress.type` | `Standard`/`Mirror`/`Elite`/`EliteMirror` | also **`Extremis`** |
| `metaData.apiKeyExpiresOn` | "empty if key never expires" | explicit **`null`** |
| Error bodies | `{ type }` only | also **`code`** (e.g. `{"type":"FORBIDDEN","code":2}`) |

Also observed: `CampaignProgress.id` is **not unique** — two entries came back
as `eventCampaign6`, differing only by `type`. Key campaigns by `id` + `type`.

Still unverified, because the sample response could not exercise them:
`legendaryEvents` and `inventory.mythicShards` were empty arrays, and the
`guild` / `guildRaid` endpoints need a key with those scopes (a `Player`-scoped
key gets `403 FORBIDDEN`). Those types remain as the spec describes them.

## Design notes

The types are a faithful reading of the OpenAPI document, with a few places
where the spec is ambiguous or self-contradictory and the choice made here is
deliberate:

- **String unions over `enum`.** `Rarity`, `GrandAlliance`, `GuildRole` etc. are
  literal unions with a companion `as const` array (`RARITIES`, ...) for runtime
  iteration. Unions match JSON ingestion directly and survive `isolatedModules`.
- **Timestamps.** `lastActivityOn`, `startedOn` and `completedOn` are declared
  `type: string, format: date-time` while their descriptions call them "unix
  timestamp (in seconds)". `ApiTimestamp = string | number` accepts either, and
  `toDate()` normalises both. Unambiguous integer fields (`lastUpdatedOn`,
  `apiKeyExpiresOn`) use `UnixSeconds` with `fromUnixSeconds()`.
- **Alliance-keyed maps.** `inventory.abilityBadges` and `inventory.orbs` are
  `additionalProperties` maps in the spec, so `GrandAllianceMap<T>` types the
  known keys as optional and tolerates unknown ones — a missing alliance is
  normal and reads as `undefined` under `noUncheckedIndexedAccess`.
- **Open-ended unions.** `ApiErrorType`, `ApiScope` and `XpBookId` carry a
  `(string & {})` arm: known values autocomplete, undocumented ones still ingest
  instead of failing the build.
- **`XP_BOOK_IDS`.** The spec enum reads
  `["xpUncommon", "xpUncommon", "xpRare", "xpEpic", "xpLegendary"]` — a duplicate
  and no common tier, which looks like a copy/paste slip for `xpCommon`. The
  duplicate is dropped; the type stays open. A live response returned exactly
  the four deduplicated ids.
- **`CampaignType` is open.** The spec's enum was proven incomplete by a live
  response (`Extremis`), so this union carries a `(string & {})` arm too.
- **Optionality follows the spec's `required` lists**, not the presence of a
  property. Notably `Unit.name`, `Unit.faction`, `Unit.grandAlliance`,
  `Item.name`, `Token.nextTokenInSeconds` and every `progress.*` game mode are
  optional; `Inventory.requisitionOrders` is optional while `resetStones` is not.

`strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are all on.

## Base URL

The OpenAPI document declares `servers: [{ url: "/" }]`, so it pins no host.
`DEFAULT_BASE_URL` is `https://api.tacticusgame.com`; override it via
`new TacticusClient({ apiKey, baseUrl })` if your key targets another
environment.

- `npm run smoke` runs the client against a local mock server (no network, no deps).
- `npm run validate -- <file.json|--live>` checks a real response against the types.
