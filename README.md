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
  game config confirms both the slip (`xpCommon` is real) and a sixth tier the
  spec omits entirely (`xpMythic`). All six are listed; the type stays open.
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

---

# Game database

The Tacticus API returns **only account state** — no XP tables, material costs,
stats, or drop locations. Those come from published game configuration, which
`src/gamedata` fetches, normalizes and caches.

```ts
import { gamedata } from 'tacticus-tools';

const db = await gamedata.loadGameDatabase();       // cache-first, 7-day TTL
const certus = db.units['ultraEliminatorSgt'];      // keyed by API unit id
const rankMaterials = certus.ranks[player.rank].upgrades;
const toNextLevel = db.xpLevels[player.xpLevel].totalXp - player.xp;
const farmAt = db.upgrades['upgDmgU019'].farmableAt; // [{ campaignId, nodeNumber, battleIndex }]
```

## Sources

| Source | Provides |
| --- | --- |
| [`gameInfo.json`](https://www.tacticustable.com/gameInfo.json) | units, ranks, stats, materials, items, abilities, XP, NPCs |
| [Tacticus Codex](https://www.tacticuscodex.com/) `battledata` + `campaignconfig` | per-node enemy compositions, campaign drop rates |

`gameInfo.json` is ~11 MB and Codex is a volunteer-run community service, so the
loader is cache-first (`.cache/gamedata.json`, 7-day TTL) and Codex failures are
non-fatal — the database still builds from `gameInfo.json` alone, minus
`campaigns`.

## Normalization guarantees

**Identifiers follow the Tacticus API convention.** Sources disagree; the
database does not. Units come from `hero.gameId` / `machinesOfWar.gameId`, not
the display slugs the sources key on. Verified against a live player payload:

| Join | Coverage |
| --- | --- |
| `units`, `shards` → `db.units` | 29/29, 81/81 |
| `inventory.upgrades` → `db.upgrades` | 102/102 |
| `inventory.items`, equipped → `db.items` | 42/42, 29/29 |
| unit `abilities` → `db.abilities` | 59/59 |

**Battle locations are unified.** The two sources spell the same node
differently — `campaign1_01` vs `campaign2_2_53` vs `eventExtremis1_1012_03B` —
and share *zero* raw strings. All three parse to
`{ campaignId, nodeNumber, battleIndex, variant? }`, where `battleIndex` matches
`CampaignProgress.battles[].battleIndex` in the player API. After normalizing,
1091/1127 farming references resolve to a known node.

**Ordered and closed-domain values are integers, never source strings.**
`Rank` (0–19, `Stone I`…`Mythic II`), `Rarity` (0–5), `GrandAlliance`,
`CampaignType`, `EquipmentSlot`. Each ships a display-name table and a tolerant
parser, so `"STONE I"`, `"Stone I"`, `"Adamantine I"` and `"Rank 18"` all land on
`Rank.MythicI`. Rank ordering comes from `gameInfo` and agrees with the API's
documented anchors (0 = Stone I, 12 = Gold I, 17 = Diamond III).

**Drop rates are stored per node.** No source publishes true per-node rates, so
each node inherits its campaign type's rates and records
`dropRateProvenance: 'campaignType'`. The shape is already per-node, so a future
per-node source is a value swap plus flipping the marker to `'node'` — no
consumer changes.

**Placeholder fields are kept and backfilled where possible.** Codex reports
every battle enemy as `stars: 0, rarity: "Unknown"`. Those fields are retained,
but where the NPC's stat table covers the enemy's rank, the real `stars`,
`rarity`, `health`, `damage` and `armour` are filled in and `statsResolved` is
set. Currently 2678/3760 enemy entries resolve (71%); the rest keep the
placeholder, since NPC stat tables are sparse and often lack a row for the exact
rank.

## Checking it

```bash
npm run validate:gamedata -- --player response.json
```

Checks enum integrity, XP-table consistency, drop-rate provenance, battle-ref
resolution, and — with `--player` — joins against a real payload. It is
negative-tested: corrupting a `gameId`, a rank name or an XP threshold makes it
fail.

The XP table was validated twice over: `totalXp(L) <= unit.xp < totalXp(L+1)`
held for all 29 live units, and `xpToNextLevel` agrees with Codex's independent
table on all 59 shared levels. Note `XpLevel.totalXp` is the XP at which a level
is **reached** (so it compares directly against `Unit.xp`), which is off by one
row from Codex's identically-named field.

## Known gaps

- `eventCampaign6` appears in player progress but not in Codex battle data, so
  it has no node-level detail.
- 36 of 1127 farming references point at event nodes absent from Codex.
- `progressionRequirements` (shards/orbs per star level) is declared but not yet
  populated — the data exists in Codex `unitlevel` / `orbpromotionrequirement`.
