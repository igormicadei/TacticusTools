# Economy, Power Score, factions, and meta

Sources: tacticus.wiki.gg `Currency`, `HDTW_Currency`, `Power_Score`,
`Factions`, `Alliances`, `Guilds`, `Missions`, `HDTW_Requisitions`,
`Glossary_of_Terms`. Full citations in `sources-and-caveats.md`.

## Currencies

| Currency | Source | Spent on |
|---|---|---|
| Coins | Battles, chests, missions | Shop purchases, forging, ability leveling, crafting upgrades |
| Blackstone (BS) | Gameplay + real money (~100 BS/$1, first purchase of a bundle doubles it once) | Store bundles, energy/refresh purchases, Arena opponent reroll |
| Guild Credits | Defeating Guild Raid bosses; cash/BS in the Guild Shop | Guild Shop: shards, badges, orbs, XP books |
| Archeotech (AT) | Trading excess shards of Legendary-Star+ owned characters; cash | Rogue Trader: shards, Legendary equipment, avatars, XP books |
| War Credits (WC) | Guild War actions | War Shop |
| Crusade Credits (CC) | Crusade mode | Crusade Shop: Mythic equipment, relics, shards |
| Shards / Mythic Shards | Requisitions, missions, battle/raid rewards | Unlock/promote/ascend units — see `progression-and-abilities.md` |
| Badges & Orbs | Various | Ability leveling (badges, alliance-matched) / rarity ascension (orbs) |

There is **no universal exchange rate** across these — the wiki is explicit
that shop segregation makes a single conversion figure meaningless; only
scattered per-item shop prices exist for comparison. Don't invent a
cross-currency conversion when answering a question — say the wiki doesn't
publish one.

### Energy

- Regenerates **1 per 5 minutes** (12/hour) up to an account cap that rises
  with Power Level; **0 → full cap takes 8h20m** at the base rate.
- Campaign costs 6 Energy (Elite 10). A free ad-refill gives +50 once/day; up
  to 5 paid Blackstone refills/day at escalating cost.

## Requisitions (character/shard gacha)

- 1 Requisition Order = 1 pull; 10 Orders = a 10-pull with a **guaranteed
  10th-slot rarity** distribution (Common 50% / Uncommon 27% / Rare 13% / Epic
  7% / Legendary 3%) — note this guarantees a *rarity floor*, not a specific
  new character.
- Pulling a duplicate of a character already fully owned at that slot converts
  to shards instead: **Common 40, Uncommon 80, Rare 130, Epic 250, Legendary
  500**.
- Pool-unlock gating: owning a character at Uncommon + 4 stars (or higher)
  adds that rarity's Orbs to the general drop pool — higher orb rarities
  unlock the same way at their own ownership threshold.
- A cumulative-pull milestone system exists (e.g. a fixed high pull count
  grants a guaranteed random Legendary character) — exact current thresholds
  are patch-dependent, verify in-game rather than assuming a wiki-cited number
  still holds.

## Power Score — deliberately not computable

- **The exact formula is undisclosed and non-linear.** Two units with
  identical ability levels, ranks, rarity, stars, and equipment can still show
  different Power Scores, because it also depends on base stats, hit count,
  and damage type per attack — none of which reduce to a single published
  weight.
- Known qualitative rules: **summon-generating abilities are worth the most
  power per level, followed by direct-damage abilities**; power scales with
  **increasing** returns (later improvements are worth more, not less);
  **XP Level itself does not factor in at all**.
- Player (account) Power Score = sum of every owned character's Power Score.
  Crossing a threshold triggers a permanent Power Level-Up (reward + unlocked
  features); once unlocked, a Power Level persists even if score later drops.
- `POWER_SCORE_IS_UNPUBLISHED = true` in `src/gamedata/stats.ts` documents
  exactly this — **do not present a computed or estimated Power Score as
  real**. The one place real values exist is the `guildRaid` API endpoint's
  `PublicHeroDetail.power`, for a key with Guild Raid scope.

### Power Level gates seen across the wiki (patch-dependent, don't treat as exhaustive or current)

| Power Level | Unlocks |
|---|---|
| 2 | Missions |
| 4 | Onslaught, Raiding |
| 5 | Guilds |
| 6 | Battle Pass, HREs, Quest, Tournament Arena, Arena team-building |
| 8 | Salvage Run, Legendary Character Events |
| 15 | Incursion |
| 20 | Guild War, Crusade |

## Factions and Alliances

- **3 Alliances**: Imperial, Xenos, Chaos — determines which Badge/Orb type a
  unit needs and eligibility in alliance-restricted modes.
- Factions each cap at **up to 6 playable characters + 1 Machine of War**.
  Imperial has the most factions, Chaos the fewest. Many factions share a
  **Faction Trait** across most members (e.g. Necrons → Living Metal, Astra
  Militarum → 2-Man Team) — check a specific unit's `db.units[id].traits` and
  `factionId` rather than assuming every faction member shares the trait.
- **Ultramarines are the new-player starter faction.**
- Mode restrictions: **Onslaught/Salvage Run** restrict to one Alliance (any
  factions within it); **Campaign** generally restricts to one faction
  (sometimes loosened to same-alliance allies); **Arena/Tournament Arena** have
  **no** faction or alliance restriction at all.
- The faction/alliance list itself is not static — it grows with new
  releases. Use `db.units[id].factionId`/`grandAlliance` for the current state
  rather than a fixed count transcribed here.

## Guilds

- Creating a guild costs 1,000 Coins; the creator becomes Leader. Roles:
  **Leader** (exactly one), **Co-Leader** (unlimited, same powers except can't
  demote the Leader or other Co-Leaders), **Officer** (unlimited, can only
  kick members). An inactive Leader (10+ days) is auto-demoted.
- Member cap scales with Guild Level (20 at Level 1, up to 30 at higher
  levels). Guild XP comes from each Guild Raid boss tier's first-kill-of-season
  and from Guild Missions; leveling up grants Guild Credits to every member.
- **Item request system**: a member can request a capped number of upgrade
  items per cycle (more Common than Uncommon than Rare), gated by a cooldown
  between requests; donating to a request earns the donor Guild Credits scaled
  by the item's rarity.

## Missions

- Unlock at Power Level 2. **Daily Missions** reset at server reset (UTC
  00:00) with a fixed set of gameplay objectives across multiple modes.
  Other categories (Tutorial, Character/Campaign Unlock, Timed, Guild) exist
  without a shared fixed reset timer.
- Mission XP feeds a separate "Mission Level" track, each level-up granting a
  crate; thresholds rise sharply at higher levels.

## Glossary / abbreviations

- **PvE** = player vs. AI, **PvP** = player vs. human.
- **CE** = Campaign Event, **GR** = Guild Raid, **HRE** = New Character Event,
  **HSE** = Home Screen Event, **LE/LRE** = Legendary (Character) Event,
  **OS** = Onslaught, **SR** = Salvage Run, **TA** = Tournament Arena.
- Rank-tier letters: **I**ron, **B**ronze, **S**ilver, **G**old, **D**iamond,
  **A**damantine.
- **Alliance** = one of the 3 top-level groupings; **Faction** = a themed
  subset of up to ~5–6 characters, often sharing a Faction Trait.
- **Character** = any unit on the roster screen; **Unit** = any combatant,
  broader than Character (includes Summons); **Normal Attack** = a unit's own
  listed Melee/Ranged profile, as distinct from an ability-triggered attack.
- **"3×3"** = community shorthand for a "Movement 3, Range 3" archetype.
- A **"Season"** / LOC (live-ops cycle) is 5 weeks, matching the Battle Pass's
  35-day length — most recurring event modes key off this cadence.
