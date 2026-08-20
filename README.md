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
non-fatal — the database still builds from `gameInfo.json` alone, minus the
Codex-sourced sections. `db.sources.codex` reports which of them made it in.

## Caching

The loader is cache-first (`.cache/gamedata.json`, 7-day TTL, ~3.7 MB). A cached
entry is used only if it parses, was written by a build with the same
`GAME_DATABASE_SCHEMA_VERSION`, and is younger than `maxAgeMs`; anything else
refetches. The schema check matters — without it, a cache written before a field
existed is served to code that expects it, and reads come back `undefined`.

**Bump `GAME_DATABASE_SCHEMA_VERSION` in `src/gamedata/types.ts` whenever the
normalized shape changes.** That is the whole mechanism for invalidating stale
caches across a schema change.

| Call | Behaviour |
| --- | --- |
| `loadGameDatabase()` | cache if valid and < 7 days old, else fetch |
| `loadGameDatabase({ refresh: true })` | always fetch |
| `loadGameDatabase({ maxAgeMs: 0 })` | treat any cache as stale, fetch |
| `loadGameDatabase({ maxAgeMs: Infinity })` | accept a cache of any age |
| `loadGameDatabase({ cachePath: null })` | never read or write a cache |

Writes go to a temporary file and are renamed into place, so a crash mid-write
cannot leave a truncated cache; a corrupt one is discarded and refetched anyway.

Each Codex section is fetched independently and its failure is non-fatal —
`db.sources.codex` reports which ones made it in. A `gameInfo.json`-only build
still yields all 127 units, 558 upgrades and the XP table, with the
Codex-sourced arrays empty rather than absent.

### Running behind a proxy

Node's built-in `fetch` ignores `HTTPS_PROXY`. In a proxied environment run with
`NODE_USE_ENV_PROXY=1` (Node >= 22.21), or pass your own agent-aware
implementation via `loadGameDatabase({ fetch })`.

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

## Star progression

`db.progressionRequirements` gives the shards and orbs to reach each star level
(`Unit.progressionIndex`), merged from Codex's `unitlevel` and
`orbpromotionrequirement`:

```ts
const need = db.progressionRequirements.find(r => r.progressionIndex === unit.progressionIndex + 1);
// { progressionIndex: 13, rarity: 4, shards: 150, shardType: 'regular',
//   orbs: 10, orbRarity: 4 }
```

Costs are **per step**, not cumulative — going from star 13 to 15 needs
`shards(14) + shards(15)`.

### Promotion vs ascension

`progressionIndex` counts two different things, and the distinction matters:

- **promotion** adds a star (+10% base stats), costing shards
- **ascension** raises rarity (+20% ability stats) and lifts the level and rank
  caps, costing shards *and* orbs

An ascension does **not** add a star, so `starLevel` runs behind
`progressionIndex` and tops out at 14:

```
idx  rarity     kind        star   shards        orbs
  2  Common     promotion    2★     15           —
  3  Uncommon   ascension    2★     15           10 Uncommon
  4  Uncommon   promotion    3★     15           —
 12  Legendary  ascension    8★    100           10 Legendary
 13  Legendary  promotion    9★    150           10 Legendary
 16  Mythic     ascension   11★     20 mythic    10 Mythic
```

Both `kind` and `starLevel` are **derived**, not published — a step is an
ascension when its rarity differs from the step before. Three independent
checks agree: ascensions land on 3, 6, 9, 12 and 16, matching the rarity anchors
the API documents for `progressionIndex`; the derived maximum of 14 stars equals
the highest `stars` value in the game config's NPC stat tables; and the sequence
matches the game's own Character Progression panel.

Note that "promotion costs shards only" holds for the lower bands but not the
Legendary and Mythic ones, where every step costs orbs too.

### Rarity level caps

`db.rarityCaps` gives the level ceiling per rarity — a unit cannot level past it
without ascending, so it bounds any "XP to next level" calculation:

| Common | Uncommon | Rare | Epic | Legendary |
| --- | --- | --- | --- | --- |
| 8 | 17 | 26 | 35 | 50 |

Codex publishes these only as free-text annotations (`"Max Common Level"`) on its
`levelprogression` rows, so the parse is narrow and yields nothing if the wording
changes. The Common and Uncommon values match the game's progression panel, and
all 29 live units sit within their rarity's cap. No source states a Mythic cap,
so none is emitted.

`shardType` distinguishes the two currencies the player API tracks separately:
star levels 16–19 are the Mythic band and consume `Unit.mythicShards`, not
`Unit.shards`.

The two sources disagree, and the merge resolves it deliberately:

| Source | Used for | Why |
| --- | --- | --- |
| `orbpromotionrequirement` | orbs, orb rarity | dedicated, self-consistent, covers every threshold |
| `unitlevel` | shards, rarity tier | the only source of shard counts |

Two shard costs come from the game's Character Progression panel rather than a
data source, and are marked `shardsSource: 'gameUi'` with their rationale in
`src/gamedata/corrections.ts`: star 1 (Codex reports 0, the game shows 10) and
star 3, the Uncommon ascension, which Codex omits entirely. Both assume the
promotion table is global rather than per character, which a single 20-row
source table implies.

`unitlevel`'s own orb column is **ignored entirely**. It agrees with the orb
table at nine indices, reads zero on several rows that do require orbs, and at
index 5 reports a requirement the dedicated table places at index 6 — so
consulting it can only add phantom costs. Levels where the two disagree are
flagged `orbsDisputed` and listed in `stats.progressionConflicts` (currently
indices 5 and 6), so the call can be revisited if a better source appears.

The resulting table puts orbs only at rarity-tier boundaries (3, 6, 9) and at
every Legendary and Mythic step (12–19), which is what the tier bands predict.

## Checking it

```bash
npm run validate:gamedata -- --player response.json
```

Checks enum integrity, XP-table consistency, drop-rate provenance, battle-ref
resolution, star-progression coverage, and — with `--player` — joins against a
real payload plus a row for every star level you actually own. It is
negative-tested: corrupting a `gameId`, a rank name or an XP threshold makes it
fail.

The XP table was validated twice over: `totalXp(L) <= unit.xp < totalXp(L+1)`
held for all 29 live units, and `xpToNextLevel` agrees with Codex's independent
table on all 59 shared levels. Note `XpLevel.totalXp` is the XP at which a level
is **reached** (so it compares directly against `Unit.xp`), which is off by one
row from Codex's identically-named field.

## Derived stats

`computeUnitStats(unit, db)` reconstructs what the game shows on the character
screen:

```
stat = floor(base_for_rank × starMultiplier) + appliedRankUpgrades + equipment
starMultiplier = 1 + 0.10 × cumulativeStars
```

Four details, each established by matching the game rather than assumed:

- **Stars drive it, not rarity.** At progression index 9 both readings give
  ×1.60, so that unit cannot tell them apart. Index 11 can: the game needs
  ×1.80, which is 8 cumulative stars, where Epic's three rarity steps would give
  ×1.60.
- **Rank upgrades are added after scaling.** Haarken is
  `floor(234 × 1.8) + 58 = 479`; scaling the sum instead gives 525.
- **Equipment lands outside the multiplier too.** Tigurius is
  `floor(68 × 1.6) + 17 + 87 = 212` armour; scaling the Greaves' 87 would give
  351.
- **The game truncates, not rounds.** 26 × 1.6 = 41.6 displays as 41.

The wiki's [HDTW Progression](https://tacticus.fandom.com/wiki/HDTW_Progression)
page confirms the shape independently: stars add 10% to *base* stats, and an
upgrade applied at the current rank is added to the displayed figure flat, only
folding into base — and so under the multiplier — once the rank completes. That
is what `base_for_rank` already carries.

Equipment stats are summed, with booster items merged onto the stat they boost —
a Force Field at 30% plus an Amplifier at 4% is one 34% figure — so `*Bonus` keys
fold onto their base key. Only `hp` and `fixedArmor` appear on equipment among
the three headline stats, and the game folds both into the figures it displays
rather than listing them separately; nothing grants damage.

`starLevel` is the cumulative count that drives the multiplier; `tierStarLevel`
is what the character screen displays, counted within the current rarity, so
index 11 reads 3 stars while the multiplier uses 8.

Ability stats are not computed: rarity adds +20% per tier to them, but their base
values are unresolved placeholders in the source data. The two multipliers are
independent and apply to different things — stars scale unit stats, rarity
scales ability variables — so rarity never moves Health, Damage or Armour.

`npm run validate:stats -- player.json` checks the output against values
transcribed from in-game character screens. Each case records the state it was
read at and skips if the unit has since advanced, because ranking up consumes
the upgrades and moves every figure with them — the numbers only mean anything
against the screen they came from.

### Power Score is not computed

The formula is unpublished. The [community wiki](https://tacticus.wiki.gg/wiki/Power_Score)
records that it is non-linear and that two characters with identical ability
levels, ranks, rarity, stars and equipment can still differ — so it depends on
inputs no available source exposes. Any number here would be a guess.

Real values do exist for units that have fought in a guild raid: the `guildRaid`
endpoint returns `PublicHeroDetail.power` per hero, given a key with the Guild
Raid scope.

## Evolution planning

`resolvePlan(unit, target, db)` turns a target into an ordered sequence of steps,
folding in whatever the target depends on. Set one field and the rest follow: an
ability target pulls the character level up with it, and a level or rank target
pulls rarity, because rarity caps both.

The gating rules, and how each was established:

| Rule | Basis |
| --- | --- |
| Level ≤ rarity's cap (8 / 17 / 26 / 35 / 50) | published, via `rarityCaps` |
| Ability level ≤ character level | observed — no ability exceeds its unit's level across a 29-unit roster, and 12 sit exactly on it |
| Rank ≤ `3 × (rarity + 1)` | **derived** — no unit exceeds it, two sit exactly on it, and it explains the "MAX. RANK: I" badge the game shows for Common and Uncommon, each being the first rank of a tier |
| Leaving a rank needs a character level (Stone I 3, then 3 per rank to Diamond II 50) | published on the wiki's [Unit Progression](https://tacticus.fandom.com/wiki/Unit_Progression) page, absent from every machine-readable source |

A rank's six upgrades sit in two rows; the second row is level-gated per
upgrade, and the table records the highest of the three — what completing the
rank costs. Two checks support it: four units in the roster sit exactly on a
threshold and none violates one, and each tier's last rank costs exactly that
tier's rarity level cap (Common 8 / Stone III, Uncommon 17 / Iron III, Rare 26 /
Bronze III, Epic 35 / Silver III), so two tables from different sources agree on
every boundary. Diamond III and the Mythic ranks have no published value — the
table predates them — and are treated as ungated rather than guessed at.

The rank rule is the one to revisit if a plan looks wrong; `maxRankForRarity`
and `LEVEL_TO_COMPLETE_RANK` in `src/gamedata/plan.ts` are the single places to
change them.

Steps are emitted greedily in the order that unblocks progress — push rank and
level as far as the current rarity allows, raise abilities as far as the level
allows, then promote and ascend and repeat. That yields the sequence a player
actually follows rather than a flat total, so nothing is farmed for a rank that
is still gated.

`npm run validate:plan -- player.json` audits every step of 203 plans across the
roster: no intermediate state may exceed a cap, no attribute may move backwards,
and the plan must actually arrive at the resolved target.

## Item requirements

Ability upgrade rows are the cost of *leaving* a level, not of reaching it:
taking an ability from 14 to 15 asks the row at level 14 — 1250 gold and 3
Uncommon badges — as the game does. A span sums the rows it crosses, so 13 to
15 is rows 13 and 14 together.

`planCosts(unit, plan, db)` gives what each step consumes, and
`allocateHoldings` spreads what the player already holds across the steps that
need it — **earliest first, never averaged**. Fifteen of an item split over three
steps with twelve in hand reads `5/5, 5/5, 2/5`, so a shortfall lands on the step
where it actually bites rather than being smeared across all of them.

Costs by step kind:

Rank steps are emitted **one rank at a time** — Bronze I to Silver I is three
steps, not one — because each rank consumes its own six materials. Collapsing
the span would hide which materials are needed now and which belong to a rank
days away, and it also hides that the same material often recurs across ranks,
which is exactly where the allocation rule matters.

| Step | Consumes |
| --- | --- |
| rank | the six upgrades of the rank being left |
| level | XP — books are interchangeable currency, so holdings are counted in the XP they carry rather than inventing a book breakdown |
| ability | badges of the tier for each level reached, plus gold |
| promotion / ascension | shards for the unit, and orbs at the tier |

### Energy and drop rates

Nodes carry what a run costs, how often it drops the item asked about, and the
two divided — energy per copy. All three are shown, because the cheapest node
per copy is often the one you cannot afford: an Elite run is 10 energy against
a Standard's 6, and a run is all-or-nothing, so with 8 energy in hand the
better-value node buys nothing.

Elite is the better rate at every rarity, and the gap widens as items get
rarer — 6.5 energy per copy against 6.9 for Common, 24.4 against 33.0 for
Legendary. Both figures come from Codex's `campaignconfig` table, published per
campaign *type*, so they describe the type rather than the individual node; the
`dropRateProvenance` field records that, and a per-node source can replace the
values without touching anything that reads them.

The player's own energy balance is not in the API — `details` carries only a
name and power level — so anything that budgets against it has to be told the
number.

### Where items come from

Materials split in two: 195 of 558 upgrades drop from campaign nodes, the other
352 are **crafted** from those. `itemSource` returns which, so a crafted item
shows its recipe rather than an empty node list. Every recipe bottoms out in
farmable components — no dead ends.

`nodeStatuses` marks each node unlocked or locked from the player's campaign
progress, with attempts left today.

An item is flagged **"nothing unlocked"** when it is still short *and* nothing
reachable yields it: for a farmed item, no node unlocked; for a crafted one, any
component blocked, since a recipe needs all of them. This is deliberately not
about today's attempts — a node with none left refreshes tomorrow, whereas a
locked one is a wall.

`npm run validate:requirements -- player.json` checks the distribution rule
against that worked example, that no item is ever allocated beyond what is held
or beyond what a step needs, that totals agree with the steps, and that every
blocked flag is genuine.

## Known gaps

- `eventCampaign6` appears in player progress but not in Codex battle data, so
  it has no node-level detail.
- 36 of 1127 farming references point at event nodes absent from Codex.
- No source publishes a Mythic level cap or the per-rarity **rank** caps the
  game's progression panel shows, so neither is modelled.
- Two shard costs are sourced from the game UI rather than a data feed; see
  `src/gamedata/corrections.ts`.
