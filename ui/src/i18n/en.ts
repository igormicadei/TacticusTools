/**
 * Every string the app shows, in English.
 *
 * This object is the source of truth for the *shape* of the dictionary as well
 * as its English content: `pt.ts` is typed against it, so a key added here
 * without a Portuguese counterpart fails the build. That is deliberate — a
 * screen that is half translated looks finished and is worse than one that is
 * not translated at all.
 *
 * Keys are namespaced by screen, with `common.` for what several screens share.
 * `{name}` placeholders are filled by `t()`.
 *
 * What is *not* here: the names of units, factions, abilities, upgrades and
 * items. Those come from the game and stay in its own words — see `game.ts`.
 */
export const EN = {
  /* ---- shell ---------------------------------------------------------- */
  'nav.units': 'Units',
  'nav.plans': 'Plans',
  'nav.teams': 'Teams',
  'nav.upgrades': 'Upgrades',
  'nav.badges': 'Badges',
  'nav.player': 'Player data',
  'shell.power': '{name} · power {power}',
  'shell.refresh': 'Refresh',
  'shell.refreshing': 'Refreshing…',
  'shell.refreshHint': 'Fetch the roster from the API now, ignoring the stored copy',
  'shell.refreshFailed': 'Refresh failed',
  'shell.loadingDb': 'Loading game database…',
  'shell.justNow': 'just now',
  'shell.minutesAgo': '{n}m ago',
  'shell.hoursAgo': '{n}h ago',
  'shell.daysAgo': '{n}d ago',
  'shell.syncedTitle': 'Game data as of {synced}\nFetched {got}',
  'shell.unknown': 'unknown',

  /* ---- language ------------------------------------------------------- */
  'lang.heading': 'Language',
  'lang.blurb':
    'The names of units, factions, abilities and upgrades stay as the game publishes them, in English, in either language — a translated name is one you could not find in your own game.',
  'lang.pt': 'Português (Brasil)',
  'lang.en': 'English',

  /* ---- units --------------------------------------------------------- */
  'units.byStatus': 'By status',
  'units.byFaction': 'By faction',
  'units.search': 'Search units or factions…',
  'units.available': 'available',
  'units.inProgress': 'in progress',
  'units.notStarted': 'not started',
  'units.noMatch': 'No units match “{query}”.',
  'units.factionProgress': '{owned}/{total} available',
  'units.status.owned': 'Available',
  'units.status.unlockable': 'Shards collected',
  'units.status.locked': 'Not started',
  'card.level': 'Lv {n}',
  'card.rank': 'Rank {n}',
  'card.shards': '{n} shards',
  'card.locked': 'Locked',
  'card.machineOfWar': 'Machine of War',

  /* ---- badges --------------------------------------------------------- */
  'badges.none': 'No ability badges in your inventory.',
  'badges.nextOnly': 'Next level only',
  'badges.everyLevel': 'Every level it covers',
  'badges.blurb':
    'Badges belong to a grand alliance, not to a unit, which is why the game cannot tell you where one goes — the answer is every ability of every unit on that side. Listed here are only the abilities whose remaining levels actually charge that rarity, with what each level costs. An ability appears under more than one rarity when its ladder crosses from one to the next.',
  'badges.held': '{n} held',
  'badges.name': '{rarity} {alliance} badges',
  'badges.nothingToSpend': 'nothing to spend these on yet',
  'badges.upgradeCount': '{n} ability upgrade',
  'badges.upgradeCountPlural': '{n} ability upgrades',
  'badges.abilityCount': '{n} ability',
  'badges.abilityCountPlural': '{n} abilities',
  'badges.needNext': '{n}× for the next level of each',
  'badges.needAll': '{n}× to finish every level',
  'badges.short': ' · {n} short',
  'badges.allMaxed':
    'Every ability on this side is either at a level this rarity does not pay for, or already maxed.',
  'badges.levelStep': 'level {from} → {to}',
  'badges.levelRange': 'levels {from} → {to}',
  'badges.runningTotal': 'Running total if you spend down this list in order',
  'badges.pooled':
    'Badges are pooled, so the running total is what one order of spending would use. Rows past where it passes {owned} are dimmed: they are what your stock does not stretch to.',
  'badges.stepCost': '{from}→{to}: {badges}× + {gold} gold',
  'slot.active': 'Active',
  'slot.passive': 'Passive',
  'slot.mythic': 'Mythic',

  /* ---- upgrades ------------------------------------------------------- */
  'upg.tab.where': 'Where materials go',
  'upg.tab.nextRank': 'Next rank per unit',
  'upg.filter.stock': 'In stock',
  'upg.filter.stockHint': 'Materials you hold at least one of',
  'upg.filter.all': 'Every material',
  'upg.filter.allHint': 'The whole table, held or not',
  'upg.filter.unused': 'Spent by nothing',
  'upg.filter.unusedHint': 'No rank in the game asks for these',
  'upg.scope.now': 'Usable now',
  'upg.scope.nowHint': 'Slots standing empty on units at that rank right now',
  'upg.scope.ahead': 'Still ahead',
  'upg.scope.aheadHint': 'Your units, at ranks they have not reached yet',
  'upg.scope.roster': 'Your roster',
  'upg.scope.rosterHint': 'Your units, at every rank including ones passed',
  'upg.scope.everyone': 'Every unit',
  'upg.scope.everyoneHint': 'The whole game, owned or not',
  'upg.search': 'Search materials…',
  'upg.count.spendable': 'spendable now',
  'upg.count.stock': 'in stock',
  'upg.count.known': 'known',
  'upg.blurb':
    'The game marks a material as “used for ranking up” without saying by whom. This is the rank tables read backwards. A material counts as used whether the rank asks for it outright or forges it into something that is asked for, so a component several recipes deep still shows the ranks it ultimately serves — with the chain that gets it there, and the amount multiplied along it. Scoped by default to what you can spend today — a unit standing at that rank with that upgrade slot still empty — because that is the part you can act on without waiting for anything. Widen it with the buttons above to see the ranks ahead, or the whole game.',
  'upg.noMatch': 'Nothing matches “{query}”.',
  'upg.slotsOpen': '{n} slot open now',
  'upg.slotsOpenPlural': '{n} slots open now',
  'upg.slotsOpenHint': 'Slots standing empty right now on units already at that rank',
  'upg.slotsOpenNoneHeld': 'Slots are open for it, but you hold none',
  'upg.forged': 'Forged',
  'upg.forgedHint': 'No campaign node drops this; it has to be forged.',
  'upg.nothingNeeds': 'nothing in scope needs this',
  'upg.unitCount': '{n} unit',
  'upg.unitCountPlural': '{n} units',
  'upg.noUses':
    'Nothing in the current scope consumes this, directly or through a recipe. Widen the scope to see whether a unit you do not own, or a rank you have already passed, ever asks for it.',
  'upg.fitsNow': 'fits now',
  'upg.alreadyFitted': 'already fitted',
  'upg.rankPassed': 'rank passed',
  'upg.directly': 'directly',
  'upg.via': 'via {chain}',
  'upg.needsLevel': 'needs up to level {n}',
  'upg.levelHint':
    "A rank's second row of upgrades is level-gated per upgrade, and only the rank's highest threshold is published — so this slot may still be waiting on levels.",
  'upg.gain': '+{n} {stat}',
  'upg.noRanksLeft': 'No owned unit has a rank left to reach.',
  'upg.nextRankBlurb':
    'Everything one more rank costs each unit, primary materials and their recipes together, cheapest first. Slots already filled at the current rank are marked applied — those materials are spent and cannot be moved, so they count as done rather than as something to find. Only the shortfall is expanded into a recipe: what is already in hand does not need making.',
  'upg.ready': 'Ready',
  'upg.missing': '{n} missing',
  'upg.appliedCount': '{n}× already applied',
} as const;
