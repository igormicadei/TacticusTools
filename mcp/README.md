# Tacticus Tools MCP

An [MCP](https://modelcontextprotocol.io) server over everything this
repository knows: the game database, the player's roster, and the calculations
the web app's screens are built on. An assistant that speaks MCP can read all
of it, write plans and teams, and pull a fresh roster from the Tacticus API.

The answers come from the library in `src/gamedata`, not from a second
implementation — so a figure here and the figure on the matching page of the
app are the same arithmetic, down to the Mercy counter.

## Build and run

```bash
cd mcp
npm install
npm run build           # -> dist/server.js
npm test                # spawns the server over stdio and exercises all 29 tools
```

The server needs the library built too (`npm run build` at the repository
root), since it imports from `dist/gamedata`.

## Configuration

Everything is read from the environment. Nothing is required to read the game
database; a roster is needed for anything that mentions the player.

| Variable | What it does |
| --- | --- |
| `TACTICUS_API_KEY` | Required by `refresh_roster`. Read on each call and never written to disk. |
| `TACTICUS_RELAY_URL` | Optional. Unset, the API is called directly — nothing here is a browser, so the CORS relay the web app needs is not needed. Set it to route through your own Worker. |
| `TACTICUS_TOOLS_DATA` | Where `player.json`, `plans.json` and `teams.json` live. Defaults to `~/.tacticus-tools`. |
| `TACTICUS_GAMEDATA` | A `gamedata.json` to load instead of the snapshot the app ships (`ui/public/gamedata.json`). |

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "tacticus-tools": {
      "command": "node",
      "args": ["/absolute/path/to/TacticusTools/mcp/dist/server.js"],
      "env": { "TACTICUS_API_KEY": "…" }
    }
  }
}
```

## Its store is not the app's

The web app keeps the roster, plans and teams in `localStorage`, which a
process outside that browser cannot read. So this server keeps its own files
rather than a window onto the app's. They use the app's shapes: a roster
fetched here is the same JSON the app imports, and a plan written here loads
there unchanged. Writes go through a temporary file and a rename, so a crash
mid-write cannot truncate what was already stored.

## The tools

### Game database — the same answers for every player

| Tool | |
| --- | --- |
| `game_info` | Schema version, sources, capture date, and how much of each thing is loaded. |
| `list_units` | The published catalogue, filtered by name, faction or alliance. |
| `get_unit` | One unit in full, including the upgrade slots each rank asks for. |
| `list_upgrades` | Materials, what they are forged from, and whether a node drops them. |
| `list_campaigns` | Campaigns with the side each is fought from. |
| `campaign_nodes` | Slots, enemies, drops and published base rates for one campaign. |

### Player — the stored roster

| Tool | |
| --- | --- |
| `player_summary` | Whose roster is loaded, how big, and when captured. |
| `list_roster` | The player's units with computed stats. |
| `get_roster_unit` | One unit in full, with the damage each attack lands through a given armour. |
| `player_section` | Any branch of the stored API response, by dotted path. |
| `holdings` | What the player holds, keyed the way requirements are keyed. |
| `refresh_roster` | Fetch from the API and replace the store; reports what changed. |

### Calculations

| Tool | |
| --- | --- |
| `unit_stats` | Stats at any hypothetical rank, level, star rung or rarity. |
| `plan_preview` | Resolve and cost a target without saving it. |
| `plan_steps` | A saved plan in full, netted against stock on hand. |
| `timeline` | One running order across every saved plan, with stock shared across it. |
| `energy_candidates` | Every fillable slot, priced on what is missing, by stat per energy. |
| `farm_targets` | A material flattened to its base parts, with where each drops. |
| `drop_rate_math` | What a base rate costs in runs once Mercy is counted. |
| `material_uses` | Which units want a material, at which rank and slot. |
| `badge_costs` | What each alliance and rarity of badge is spent on. |
| `recommend_team` | A squad for a node, from the units the node would actually permit. |
| `optimise_equipment` | Best equipment onto a saved team, gain measured squad-net. |

### Writing

`list_plans`, `save_plan`, `delete_plan`, `list_teams`, `save_team`,
`delete_team`. A plan's target is resolved against the unit before it is
stored and a team's members are resolved to ids, so what cannot be resolved is
refused at write time rather than failing later.

## Notes worth knowing before reading the numbers

- **Energy counts only the shortfall.** Materials already held are not charged
  for again, so a slot's price falls as the inventory fills.
- **The Mercy counter is modelled.** A copy costs less than run cost ÷ base
  rate, because a node's chance rises with each failure. The step between
  failures is inferred from one reward popup rather than published — see
  "Energy and drop rates" in the repository README.
- **Node faction restrictions are derived**, not published: a node takes a
  small cast from the campaign's own faction and gives leftover slots to the
  same Grand Alliance. Where it cannot be derived, the node is reported
  unrestricted rather than hiding units you could deploy.
