/**
 * Resolves our ids to the artwork Codex already hosts.
 *
 * `icons.json` is a mapping, not a copy: `scripts/snapshot-icons.mjs` walks
 * Codex's asset bundle and records which hashed file belongs to which of our
 * ids, and the browser loads each image from Codex directly. That keeps ~150 MB
 * of Games Workshop artwork out of this repository while still showing it. The
 * exception is the handful of assets Codex inlines rather than emits — the
 * Stone and Bronze rank pips among them — which have no URL to point at and so
 * ride along in the manifest as data URIs.
 *
 * Icons are decoration on top of data the app already renders in words, so
 * every failure here is silent: a manifest that will not load, an id with no
 * art, a hash that has gone stale after a Codex rebuild — each ends as a
 * missing picture beside intact text, never as a broken page.
 */

/** Alliance and faction names as our own ids spell them. */
type Key = string;

interface IconManifest {
  base: string;
  units: Record<Key, string>;
  unitAbilities: Record<Key, { active?: string; passive?: string; mythic?: string }>;
  upgrades: Record<Key, string>;
  items: Record<Key, string>;
  orbs: Record<Key, Record<string, string>>;
  badges: Record<Key, Record<string, string>>;
  ranks: Record<string, string>;
  rarities: Record<string, string>;
  stars: { white?: string; blue?: string; red?: string; mythic?: string };
  shards: { normal?: string; mythic?: string };
  factions: Record<Key, string>;
  damageTypes: Record<Key, string>;
  attacks: { melee?: string; ranged?: string; hits?: string };
  campaigns: Record<Key, string>;
  ui: Record<Key, string>;
}

const EMPTY: IconManifest = {
  base: '',
  units: {},
  unitAbilities: {},
  upgrades: {},
  items: {},
  orbs: {},
  badges: {},
  ranks: {},
  rarities: {},
  stars: {},
  shards: {},
  factions: {},
  damageTypes: {},
  attacks: {},
  campaigns: {},
  ui: {},
};

let manifest: IconManifest = EMPTY;
let started = false;
const listeners = new Set<() => void>();

/**
 * Fetch the manifest once, then wake anything already rendered without it.
 *
 * A module-level store rather than a context: icons are read from deep inside
 * list rows, and threading a provider through every one of them would be a lot
 * of plumbing for a picture.
 */
function start(): void {
  if (started) return;
  started = true;
  fetch(`${import.meta.env.BASE_URL}icons.json?v=${__ICONS_VERSION__}`)
    .then((r) => (r.ok ? (r.json() as Promise<IconManifest>) : undefined))
    .then((loaded) => {
      if (!loaded?.base) return;
      manifest = { ...EMPTY, ...loaded };
      for (const listener of listeners) listener();
    })
    .catch(() => {
      /* No icons, then. The app reads perfectly well without them. */
    });
}

export function subscribeToIcons(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current manifest, for `useSyncExternalStore`'s snapshot. */
export function iconSnapshot(): IconManifest {
  start();
  return manifest;
}

/** Inlined assets carry their own scheme; everything else hangs off Codex. */
const url = (file: string | undefined): string | undefined =>
  !file ? undefined : file.startsWith('data:') ? file : manifest.base + encodeURIComponent(file);

export function unitIcon(id: string): string | undefined {
  return url(manifest.units[id]);
}

export function abilityIcon(
  unitId: string,
  slot: 'active' | 'passive' | 'mythic',
): string | undefined {
  return url(manifest.unitAbilities[unitId]?.[slot]);
}

/**
 * Materials, keyed the way a requirement is.
 *
 * `ItemRequirement.key` already carries everything needed — `upgrade:upgHpC002`,
 * `badge:Xenos:2`, `orb:Imperial:3`, `shard:orksWarboss` — so a row can ask for
 * its own icon without knowing which kind of thing it is holding.
 */
export function requirementIcon(key: string): string | undefined {
  const [kind, first = '', second = ''] = key.split(':');
  switch (kind) {
    case 'upgrade':
      // Craftable components and equipment live in separate tables, and a
      // recipe ingredient can be either.
      return url(manifest.upgrades[first] ?? manifest.items[first]);
    case 'badge':
      return url(manifest.badges[first]?.[second]);
    case 'orb':
      return url(manifest.orbs[first]?.[second]);
    case 'shard':
      // The game frames a shard with its unit's portrait, which says far more
      // than the generic shard glyph — but the glyph is there when the unit's
      // art is missing, and for mythic shards, which are their own item.
      return second === 'mythic'
        ? url(manifest.shards.mythic)
        : (unitIcon(first) ?? url(manifest.shards.normal));
    default:
      return undefined;
  }
}

export function rankIcon(rank: number): string | undefined {
  return url(manifest.ranks[String(rank)]);
}

/** The rarity frame — Common through Mythic, in the `Rarity` enum's order. */
export function rarityIcon(rarity: number | undefined): string | undefined {
  return rarity === undefined ? undefined : url(manifest.rarities[String(rarity)]);
}

/**
 * A single star pip.
 *
 * Codex also ships blue, red and mythic variants, and picks between them from a
 * table of its own that does not line up with our progression indices — the
 * counts disagree at 17 of 19 rows. Rather than show the wrong colour we use
 * the plain pip everywhere, which is what the lower tiers wear anyway. Settling
 * the colour ladder against a real character screen would be the way to fix it.
 */
export function starIcon(): string | undefined {
  return url(manifest.stars.white);
}

export function factionIcon(factionId: string): string | undefined {
  return url(manifest.factions[factionId]);
}

/** Art for a damage profile, e.g. `Bolter`, `Psychic`, `Flame`. */
export function damageIcon(profile: string | undefined): string | undefined {
  return profile ? url(manifest.damageTypes[profile]) : undefined;
}

/** The plain melee and ranged glyphs, for attacks that carry no profile. */
export function attackIcon(kind: 'melee' | 'ranged' | 'hits'): string | undefined {
  return url(manifest.attacks[kind]);
}

export function campaignIcon(campaignId: string): string | undefined {
  return url(manifest.campaigns[campaignId]);
}

/** Chrome glyphs: `gold`, `energy`, `power`, `health`, `damage`, `armour`, … */
export function uiIcon(name: string): string | undefined {
  return url(manifest.ui[name]);
}
