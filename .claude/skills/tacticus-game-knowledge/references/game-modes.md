# Game modes

Sources: tacticus.wiki.gg `Game_Modes`, `Campaign`, `Arena`, `Onslaught`,
`Guild_Raid`, `Guild_War`, `Salvage_Run`, `Tournament_Arena`, `Incursion`,
`Survival`, `Quest`, `New_Character_Events`, `Legendary_Character_Events`,
`Machines_of_War`, `BattlePass`, plus the Guild Raid Prime boss debuff formula
mined from tacticustable.com's client bundle. Full citations in
`sources-and-caveats.md`. **None of this is in `GameDatabase`** — the database
only carries per-node enemy compositions and drop rates for Campaign, not the
structural rules of any mode.

Numbers here are tied to specific patches and are known to move (Power Level
caps, token counts, shard thresholds have all changed at least once in the
wiki's own revision history) — treat anything below as "true as of the cited
patch," not an evergreen constant, especially for anything balance-sensitive.

## Taxonomy

- **Banner (always-on) modes**: Campaign, Arena, Onslaught, Guild Raid, Guild
  War, Salvage Run.
- **Event (time-limited, recurring) modes**: Incursion, Quest, Tournament
  Arena, New Character Events (HRE), Legendary Character Events (LE), Survival,
  Campaign Event, Crusade — these recur inside each 5-week Battle Pass season.
- **Home Screen Events (HSEs)**: sporadic progress-bar events with no
  missions/crates of their own; milestones scale by player Power Level.

## Campaign

- Three flavors per storyline: **Main** (75 battles / 5 chapters, each ending
  in a boss), **Mirror** (same structure, reversed faction matchup), **Elite**
  (harder, 8 battles/chapter). Elite unlocks by earning every medal in the
  base campaign (210 medals for Indomitus, 225 for others).
- Energy per attempt: **6** (Main/Mirror, a few early battles cost less), **10**
  (Elite).
- **Medals**: 3 if no character dies, 2 if exactly one dies, 1 if two or more
  die; first time earning a rating grants a bonus reward. **3 medals unlocks
  Raiding** that specific node.
- **Raiding**: Power Level 4+; costs 1 Raid Ticket + the node's normal Energy;
  skips actual gameplay but still rolls the upgrade-drop table; grants **no
  XP** (no characters are actually deployed).
- **Lightning Victory**: win within the node's displayed turn limit for double
  Coins. Available from Indomitus battle 19 onward and every level after. The
  turn counter only decrements at the **start of your own turn**, so a kill via
  a delayed/passive/Overwatch effect just before your turn starts can still
  achieve it "on the buzzer."
- Daily win caps: **10/day** standard, **3/day** Elite (Elite guarantees a
  drop, with a chance at a second).

## Arena

- PvE (AI opponents), unlocks Power Level 6. Up to 5 characters, any faction
  mix. **9 leagues** ascending Aspirant → Chapter Master; season-end
  leaderboard rank drives promotion/hold/demotion.
- **Tokens**: start 10/season, cap 15, regen 1 per 160 min (~9/day, ~70 total
  across a 7-day season); regen halts in the last 8 hours; unused tokens are
  lost.
- Matchmaking offers 3 AI opponents (1 above you, 2 either side); **1
  Blackstone rerolls** the choices. A power-based matchmaking cap applies from
  Aspirant through Honour Guard (roughly +20% at the bottom league up to +200%
  at the top); **Captain and Chapter Master have no cap at all**.
- **Orbital Bombardment** starts round 8, unavoidable percentage damage to
  force decisive play.
- The human player always moves first; victory needs at least one friendly
  unit (character or summon) surviving.

## Onslaught

- PvE horde mode vs. Tyranids/Genestealer Cults, unlocks Power Level 4. **6
  waves**, spawning at the start and on rounds 3/4/5/6/8.
- Restricted to **one Alliance** (mix factions freely within it); minimum 5
  eligible characters.
- **Tokens**: 1/attempt, regen 1 per 16 hours (~1.5/day), cap 3. Retreating
  before pressing Start doesn't cost a token.
- Sectors organized by rarity tier × upgrade rank, 3 numbered sectors per
  rarity; clearing all 3 collapses the tier and unlocks the next rarity.

## Guild Raid

- Asynchronous co-op-within-guild boss-damage race; **13-day season**;
  leaderboard by cumulative guild damage.
- **Battle Tokens**: cap 3, regen 1 per 12 hours. **Bomb attacks**: direct boss
  damage, 18-hour cooldown, scales with guild level.
- Deploy up to 5; cannot deploy a character whose faction is barred against
  that specific boss.
- Each main boss has **2 miniboss "adds"** whose HP thresholds weaken the main
  boss (reduced Armour/Damage/Movement) as they drop — thresholds stack
  downward, so reducing a miniboss to a low HP band also grants every higher
  band's bonus. **Bosses carry the Immune trait** (see
  `traits-and-status-effects.md`), so hex effects never help against them.
- 3 boss rarity tiers, cycling Common → Mythic; after clearing every boss once,
  guilds loop back and repeat.

### Prime boss debuffs — the two distinct formulas

Guild Raid bosses' "Prime" debuff stacks apply one of two formula shapes,
recovered from tacticustable.com's client code (not published anywhere on the
wiki in this exact form):

- **`bossStatPctDecrease`** (percentage, applied multiplicatively, floored) —
  used for Damage, fixed Armour, and Crit Damage:
  `value = floor(value × (100 − amount) / 100)`
- **`bossStatDecrease`** (flat, floored at zero) — used for Movement, Crit
  Chance, Block Chance, and weapon Hit count:
  `value = max(0, value − amount)`

Before either formula runs, multiple active debuff entries sharing the same
`(type, target)` key have their `amount` **summed first** — e.g. two separate
"−5 Crit Chance" Prime stacks become one "−10 Crit Chance" effect, then the
flat formula applies once. Which debuff tiers are "live" depends on how many
Prime stacks are currently active on that boss.

## Guild War

The most rules-dense mode. Unlocks Power Level 20 (only Power Level 20+
members count toward enlistment). **2 guilds matched per War**: 24h
Preparation Phase (assign defenses) → 36h Active Fighting Phase (attack). **6
Wars per season.**

- **Battlefield Level** (1–5, set by a Warmaster) gates rarity caps and
  rewards; the guild must meet a minimum total Guild Power *and* minimum
  enlisted-member count by the fighting phase or it auto-downgrades:

  | BF Level | Guild Power required | Min enlistees | Score multiplier |
  |---|---|---|---|
  | 5 | 50,000,000 | 20 | ×8 |
  | 4 | 10,000,000 | 15 | ×4 |
  | 3 | 1,000,000 | 15 | ×2 |
  | 2 | 100,000 | 10 | ×1.5 |
  | 1 | 10,000 | 10 | ×1 |

- **15 War Zones/guild**, each 2 sections × 5 lineups × 5 character slots (max
  2 defenders per zone, 1 per section). Lineup rarity caps vary by zone name
  (Hero/Elite/Veteran/Trooper) and Battlefield Level.
- **War Zone buffs** stack multiplicatively when 2+ of the same zone type are
  active — examples: Armoury (+10% defender Armour), Fortified Position (+10%
  defender Damage & Armour), Medicae Station (+25% defending character Health,
  not summons), Anti-Air Zone (−40% current HP to attacking Flying units at
  battle start).
- **"Grind Them Down!"**: after each attack that damages a lineup, remaining
  defenders' current *and* max HP drop by a Battlefield-Level-dependent
  percentage, applied **multiplicatively per attack** (30/25/20/15/10% for
  BF1–5) — attrition alone never reaches 0.
- **10 War Tokens/member/War**, non-regenerating; 1 token = 1 attack.
- Combat timer: **20 minutes**, starting the instant you enter the battle (not
  when you press Start); can't enter with ≤20 minutes left in the phase.
- Score: **260,000 points** total for a full clear across all zones; **200
  points per defender defeated** (max 1,000/lineup); an elimination bonus of
  600 points scaling down to 25 for a 1-attempt/0-loss vs. a 3+-attempt clear.
- **17 War League tiers** (Iron I–IV → Diamond) gate a War Credit multiplier
  (×1 up to ×3) on top of everything above.

## Salvage Run

- PvE loot-collection vs. Orks, unlocks Power Level 8. Sectors → Salvage Zones,
  each with a depleting damage bar. Deploy 3–5 of one matching Alliance.
- **Tokens**: regen 1 per 12 hours (2/day), cap 2.
- Resources drop onto random open hexes through the run (all fallen by the
  final turn). **Reward loop crosses alliances**: Imperial track drops Xenos
  gear, Xenos track drops Chaos gear, Chaos track drops Imperial gear.
- Forge Badges start dropping at specific sector tiers: Rare @ Sector VI, Epic
  @ Sector XI, Mythic @ Sector XXXV.
- Special **Impervious**-trait strongbox each run (must be Crit to open — see
  `traits-and-status-effects.md`).

## Tournament Arena

- Live PvP, ~72–80 hour event window; deploy 5 (7 in Draft rulesets); any
  alliance/faction mix.
- **Tickets**: start 6/max 12, regen 1 per 2h; max 41 ranked fights/event.
- **Rarity bidding**: each player picks a rarity cap before matching; the match
  resolves at the **lower** of the two bids, but each player's point payout is
  based on their **own** bid (bidding higher risks a tougher opponent for more
  points if the other side's bid happens to be lower).
- Victory: first to **5 Victory Points** (1 per enemy defeated, plus
  objective-hex control in the Conquest ruleset). 5 rulesets: Conquest,
  Power-Ups, Draft Power-Ups, Infested Power-Ups, Faction War.
- **Orbital Bombardment** starts round 8, same shape as Arena's.
- Equipment/rarity caps work the same scaling-down rule as
  `equipment-forge-and-items.md`'s general Equipment Cap section.

## Incursion — the Machines of War progression mode

- Recurring 5-day event, once per 5-week season; unlocks Power Level 15.
- Choose one Machine of War to run; that choice fixes the playable Alliance and
  enemy factions faced.
- **Tier → rarity cap**: 1–2 Common, 3–4 Uncommon, 5–6 Rare, 7–9 Epic, 10–12
  Legendary, 13 Mythic. Each tier is 12–15 battles on a branching path with
  permanent-for-the-run enhancement nodes.
- **Persistent damage**: character HP and deaths carry across the whole run —
  injured units redeploy at reduced HP, defeated ones leave the available
  roster for that run (roguelike-style). Run ends if the roster drops below 3.
- **Tokens**: start 2, cap 3, regen 1 per 20 hours.

## Survival

- Wave-survival event mode. Tokens: start 2, cap 5, regen 1 per 12h.
- Starts at Common rarity cap and advances via a wave-clear meter: **Uncommon
  at 3 points, Rare at 6, Epic at 8** — a single run reaching Epic awards all
  three unlocks simultaneously; characters keep proportional health when the
  cap increases mid-run.
- Scoring double-dips: kills award both a flat kill-point bonus *and* their
  damage-based points for the same action.

## Quest

- 72-hour single-character showcase, unlocks Power Level 6. **17 total
  battles** (4 Common/3 Uncommon/4 Rare/3 Epic/2 Legendary/1 Mythic in one
  cited split). The event's featured character is **mandatory** in every
  battle and gets **+20% stats** above its normal rank/rarity value for the
  event's duration; other slots are usually alliance-restricted.
- Perfect-score final milestone requires clearing **every stage in one
  continuous push** — partial perfects from separate attempts don't
  accumulate.

## New Character Events (HRE) and Legendary Character Events (LE)

Both convert battle performance into event-only shards for unlocking/promoting
a specific featured character; neither's shards are interchangeable with
regular Shards while the event is live.

- **HRE** (Common/Uncommon/Rare releases): 2-week event, unlocks Power Level 6.
  Points → Currency → Chests → Shards. Shard thresholds escalate by rarity
  (Common unlock 25, Uncommon total 100, Rare total 280). "Oh So Close" pity:
  a small shard shortfall at event end is buyable with Blackstone.
- **LE** (Legendary releases): unlocks Power Level 8; the character is released
  across **3 repeating 1-week instances**, progress cumulative across all 3.
  Three battle tracks (Alpha/Beta/Gamma), each barring its own matching
  faction/alliance from your deployed roster. Shard thresholds run from a
  400-shard initial unlock up to ~1,300 total for reaching Mythic 12★.
  Leftover event shards at the end of the 3rd instance convert **1:1 to
  regular Shards, or 25:1 to Mythic Shards**.
- Both modes deduct a token the instant you **enter** a battle (even if you
  retreat before pressing Start) — this differs from Campaign/Quest/Salvage
  Run, where retreating pre-Start is free.

## Crusade

- Requires Guild level 5+ and player Power Level 20+. Players pick a side
  (Imperium vs. Devastation) and a faction within it.
- **10-week season**: 6 Expansion phases (weeks 1–6) targeting planets on a
  **96-planet, 6-Subsector** galaxy map, then a Domination phase (weeks 7–10)
  where the whole map is contestable (only planets connected to one you
  already hold), plus a week-10 Terminus survival event.
- Victory: the side controlling the most planets at season end wins.

## Battle Pass

- Unlocks Power Level 6. Two parallel tracks (Free, Premium); **35-day (5-week)
  season**, resets fully each season. **50 tiers × 360 points = 18,000 points**
  to the recurring-reward loop. Points come from battles played (varies by
  mode — Onslaught scores far more per battle than Campaign) plus mission
  completion (Daily/Weekly/Seasonal). A cut-down 10-tier Starter Pass exists
  for a player's very first Power Level 6 unlock.

## Machines of War

- Not "Characters" — excluded from anything scoped to Characters unless stated
  otherwise. Stationed off the map edge: cannot move, cannot be directly
  attacked.
- Each has a **primary Active ability** (costs Munitions) and a **secondary
  ability** (free, active or passive), both from Common rarity, scaling via
  the additive formula in `progression-and-abilities.md`.
- **Munitions cap 150**; sourced from Incursion, weekly login, Battle Pass, and
  the Daily Shop (offer only appears below 50 banked).
- Progressed exclusively through **Incursion**; **Components** (alliance
  variants, no rarity tier) are the MoW-specific ability-leveling consumable.
