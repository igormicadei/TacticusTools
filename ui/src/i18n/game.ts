/**
 * The game's own vocabulary, in the reader's language.
 *
 * Two kinds of word appear on these screens and they are not treated alike.
 *
 * *Generic vocabulary* — rarities, ranks, stats, damage types, alliances — is
 * translated. These are ordinary words the game localises like any other UI
 * text, and leaving them in English would be the odd choice on a Portuguese
 * page.
 *
 * *Proper nouns* — unit names, faction names, ability names, and the names of
 * upgrades and items — are left exactly as the game publishes them, in English.
 * That is not laziness, it is what the game shows: Games Workshop's names are
 * carried untranslated into localised Warhammer products, and the official
 * Brazilian store listing for Tacticus does exactly this, writing its prose in
 * Portuguese while naming "Space Marines", "Chaos Space Marines", "Orks" and
 * "Astra Militarum" in English. A translated unit name would be a name the
 * player cannot find in their own game, which is precisely the confusion worth
 * avoiding — and the failure would be silent, since a plausible-looking
 * Portuguese name gives no hint that it is wrong.
 *
 * Where that judgement turns out to be wrong for a particular word, this file
 * is the one place to fix it.
 */
import {
  campaignTypeName,
  grandAllianceName,
  rankName,
  rarityName,
  type Rank,
  type Rarity,
} from '@lib/gamedata/enums.js';

import { currentLang } from './locale.ts';

/** Rarity tiers. The Portuguese words used across Brazilian coverage of the game. */
const RARITY_PT: Record<string, string> = {
  Common: 'Comum',
  Uncommon: 'Incomum',
  Rare: 'Raro',
  Epic: 'Épico',
  Legendary: 'Lendário',
  Mythic: 'Mítico',
};

/**
 * The metal half of a rank name. The numeral is left alone: I, II and III are
 * the same in both languages, and the game writes them as numerals anyway.
 */
const RANK_METAL_PT: Record<string, string> = {
  Stone: 'Pedra',
  Iron: 'Ferro',
  Bronze: 'Bronze',
  Silver: 'Prata',
  Gold: 'Ouro',
  Diamond: 'Diamante',
  Mythic: 'Mítico',
};

const ALLIANCE_PT: Record<string, string> = {
  Imperial: 'Imperial',
  Xenos: 'Xenos',
  Chaos: 'Caos',
};

const CAMPAIGN_PT: Record<string, string> = {
  Standard: 'Padrão',
  Mirror: 'Espelho',
  Elite: 'Elite',
  EliteMirror: 'Espelho Elite',
  Extremis: 'Extremis',
  Onslaught: 'Investida',
  SalvageRun: 'Resgate',
};

/**
 * Damage types, which are a mix of ordinary words and 40k terms.
 *
 * The ordinary ones are translated; the ones that name a weapon technology —
 * Bolter, Las, Plasma, Melta, Gauss, Psychic — stay, because they are the
 * franchise's own words and appear untranslated in Portuguese 40k material.
 */
const DAMAGE_PT: Record<string, string> = {
  Physical: 'Físico',
  Piercing: 'Perfurante',
  Blast: 'Explosivo',
  Flame: 'Chamas',
  Energy: 'Energia',
  Chain: 'Corrente',
  Power: 'Energético',
  HeavyRound: 'Projétil Pesado',
  Bolter: 'Bolter',
  Las: 'Las',
  Plasma: 'Plasma',
  Melta: 'Melta',
  Gauss: 'Gauss',
  Psychic: 'Psíquico',
  Particle: 'Partícula',
  Molecular: 'Molecular',
  Toxic: 'Tóxico',
  Direct: 'Direto',
  Eviscerate: 'Evisceração',
  Projectile: 'Projétil',
};

/** The three stats a rank upgrade raises. */
const STAT_PT: Record<string, string> = {
  hp: 'vida',
  dmg: 'dano',
  fixedArmor: 'armadura',
};

const STAT_EN: Record<string, string> = {
  hp: 'health',
  dmg: 'damage',
  fixedArmor: 'armour',
};

const pt = (): boolean => currentLang() === 'pt';

export function localRarity(rarity: Rarity | undefined): string {
  if (rarity === undefined) return '';
  const english = rarityName(rarity);
  return pt() ? (RARITY_PT[english] ?? english) : english;
}

export function localRank(rank: Rank | undefined): string {
  if (rank === undefined) return '';
  const english = rankName(rank);
  if (!pt()) return english;
  // "Bronze III" is a metal and a numeral; only the metal changes.
  const [metal, numeral] = english.split(' ');
  const translated = metal === undefined ? undefined : RANK_METAL_PT[metal];
  return translated === undefined ? english : `${translated}${numeral ? ` ${numeral}` : ''}`;
}

export function localAlliance(alliance: number | string | undefined): string {
  const english =
    typeof alliance === 'number' ? (grandAllianceName(alliance) ?? '') : (alliance ?? '');
  return pt() ? (ALLIANCE_PT[english] ?? english) : english;
}

export function localCampaignType(type: number | string | undefined): string {
  const english = typeof type === 'number' ? (campaignTypeName(type) ?? '') : (type ?? '');
  return pt() ? (CAMPAIGN_PT[english] ?? english) : english;
}

export function localDamage(profile: string | undefined): string {
  if (!profile) return '';
  return pt() ? (DAMAGE_PT[profile] ?? profile) : profile;
}

export function localStat(statType: string | undefined): string {
  if (!statType) return '';
  const table = pt() ? STAT_PT : STAT_EN;
  return table[statType] ?? statType;
}

/**
 * A number, grouped the way the reader expects.
 *
 * Portuguese groups with a full stop where English uses a comma, so a hardcoded
 * `toLocaleString()` with no argument would follow the *browser's* locale and
 * disagree with the language the page is actually in.
 */
export function localNumber(value: number): string {
  return value.toLocaleString(pt() ? 'pt-BR' : 'en-GB');
}
