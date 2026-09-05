/**
 * Which language the app is speaking, and how the rest of it asks.
 *
 * A module-level store rather than a React context, matching `data/icons.ts`,
 * for the same reason: strings are needed from plain helper functions that
 * build labels and sort keys, not only from components. A context would force
 * every one of those to become a hook.
 *
 * Portuguese is the default. English is reached by choosing it, and the choice
 * is remembered per browser.
 */
import { useSyncExternalStore } from 'react';

import { EN } from './en.ts';
import { PT } from './pt.ts';

export type Lang = 'pt' | 'en';

/**
 * Every string in the app, keyed.
 *
 * English is the source of truth and its shape is the type, so `pt.ts` must
 * answer for every key or the build fails. That is the property worth having:
 * a half-translated screen is worse than an untranslated one, because it looks
 * finished.
 */
export type StringKey = keyof typeof EN;
export type Strings = Record<StringKey, string>;

const DICTIONARIES: Record<Lang, Strings> = { en: EN, pt: PT };

const STORAGE_KEY = 'tacticus-tools:lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pt') return saved;
  } catch {
    /* Private mode, or storage disabled. The default is still fine. */
  }
  return 'pt';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function currentLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* The choice still holds for this session. */
  }
  // The <html lang> attribute is what a screen reader and the browser's own
  // spellcheck and hyphenation read, so it has to move with the setting.
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  for (const listener of listeners) listener();
}

export function subscribeToLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Look up a string, filling in `{name}` placeholders.
 *
 * Values are substituted rather than concatenated so a translation can move
 * them: Portuguese does not always want the number where English puts it.
 * A missing key returns the key itself, which is ugly on purpose — it should
 * be obvious on screen rather than silently blank.
 */
export function t(key: StringKey, values?: Record<string, string | number>): string {
  const template = DICTIONARIES[current][key] ?? EN[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * Pick between a singular and a plural key by count.
 *
 * Both languages here need only the two forms, and `n` is passed through so the
 * chosen string can place it. Kept explicit rather than inferred from the
 * number, because "0 items" is plural in both and a rule that guesses would
 * eventually guess wrong for one of them.
 */
export function tn(
  n: number,
  one: StringKey,
  many: StringKey,
  values?: Record<string, string | number>,
): string {
  return t(n === 1 ? one : many, { n, ...values });
}

/** Re-render a component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (listener) => subscribeToLang(listener),
    () => current,
    () => current,
  );
}

/**
 * The translator, for components.
 *
 * Returns `t` itself rather than a closure so the identity is stable; the
 * subscription is what triggers the re-render, and reading `current` inside
 * `t` is what makes the new language take effect.
 */
export function useT(): typeof t {
  useLang();
  return t;
}
