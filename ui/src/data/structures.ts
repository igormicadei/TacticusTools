/**
 * The shape of an API reply, as a list a person can tick through.
 *
 * A player response is one object with a handful of branches, and the branch a
 * reader wants is rarely all of it — 16 KB of inventory and 13 KB of campaign
 * progress dwarf the roster in a reply where the roster is usually the point.
 * This walks the reply far enough to name those branches and no further: the
 * question is which structures to keep, not which items.
 */

export interface Structure {
  /** Dotted path from the root, e.g. `player.inventory`. */
  path: string;
  /** The key alone, for display under its parent. */
  key: string;
  depth: number;
  /** Serialised length in bytes, which is the cost the reader is weighing. */
  bytes: number;
  /** `31 items` for an array, `4 keys` for an object, the type for anything else. */
  measure: { kind: 'items' | 'keys' | 'value'; n: number; type: string };
  /** Paths of the branches listed under this one. Empty makes it a leaf. */
  children: string[];
}

/**
 * Below this a branch is not worth splitting up.
 *
 * `player.details` is two scalars and `metaData` a little more; listing their
 * keys would be asking which *fields* to copy, which is a different and much
 * more tedious question than which structures. Anything big enough to be worth
 * dropping is far past this.
 */
const WORTH_SPLITTING_BYTES = 1024;

/** How deep the listing can go, counting the root's own keys as depth 1. */
const MAX_DEPTH = 3;

const measure = (value: unknown): Structure['measure'] => {
  if (Array.isArray(value)) return { kind: 'items', n: value.length, type: 'array' };
  if (value !== null && typeof value === 'object') {
    return { kind: 'keys', n: Object.keys(value).length, type: 'object' };
  }
  return { kind: 'value', n: 0, type: value === null ? 'null' : typeof value };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Every branch worth offering, parents before their children.
 *
 * A branch is split open only when it is both large enough to be worth the
 * choice and made of further branches — an object of scalars is a leaf however
 * many keys it has, because its keys are fields rather than structures.
 */
export function structuresOf(root: unknown): Structure[] {
  const found: Structure[] = [];
  if (!isPlainObject(root)) return found;

  const walk = (value: Record<string, unknown>, prefix: string, depth: number): string[] => {
    const paths: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const bytes = JSON.stringify(child)?.length ?? 0;
      const entry: Structure = {
        path,
        key,
        depth,
        bytes,
        measure: measure(child),
        children: [],
      };
      found.push(entry);
      paths.push(path);

      const splittable =
        depth < MAX_DEPTH &&
        isPlainObject(child) &&
        bytes > WORTH_SPLITTING_BYTES &&
        Object.values(child).some((v) => v !== null && typeof v === 'object');
      if (splittable) entry.children = walk(child, path, depth + 1);
    }
    return paths;
  };

  walk(root, '', 1);
  return found;
}

/**
 * The reply with only the chosen branches left in.
 *
 * Built from the leaves of the listing rather than from every selected path: a
 * parent is a convenience for ticking its children, and copying it as well
 * would put the whole branch back alongside the parts that were kept.
 */
export function pickStructures(
  root: unknown,
  structures: readonly Structure[],
  selected: ReadonlySet<string>,
): unknown {
  const out: Record<string, unknown> = {};
  for (const structure of structures) {
    if (structure.children.length > 0 || !selected.has(structure.path)) continue;
    const parts = structure.path.split('.');
    let source = root as Record<string, unknown>;
    let target = out;
    for (const part of parts.slice(0, -1)) {
      source = source[part] as Record<string, unknown>;
      target = (target[part] as Record<string, unknown>) ?? (target[part] = {});
    }
    const last = parts[parts.length - 1]!;
    target[last] = source[last];
  }
  return out;
}
