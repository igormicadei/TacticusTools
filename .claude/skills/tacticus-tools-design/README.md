# Tacticus Tools Design System

A design system for **Tacticus Tools**, a community-built companion app for
*Warhammer 40,000: Tacticus*. It provides the visual foundation for roster
planners, evolution-plan calculators and the rest of the tooling.

The source app is a *utility*, and its original UI was a plain dark
developer-tool shell. **This system deliberately does not keep that shell.** Per
direction from the project owner it builds the utility's visual language out of
the game's own ornate sci-fi-gothic presentation, while keeping the tool's real
screens and features as the functional spec.

## Content fundamentals

- **Voice:** matter-of-fact and technically precise, almost engineering-log in
  register. The app's own copy explains *mechanisms*, not just labels — "Held
  stock is spread across the steps that need it, earliest first, so a shortfall
  shows up on the step where it actually bites." Carry that precision into any
  copy: say what a number means, not just what it is called.
- **Person:** neutral, second person implied and rarely explicit ("Enter your
  API key", "Choose file…"). No "we" chattiness.
- **Casing:** UI labels are Title Case for nav and buttons ("Player data",
  "Refresh roster"); body copy is sentence case. In-game proper nouns are
  written exactly as the game writes them.
- **Emoji:** none. The game uses iconography, never emoji glyphs.
- **Numbers:** exact and abundant. This is a game about optimising resource
  allocation, so counts, percentages and thresholds are always shown precisely
  ("102/102", "6.5⚡ per copy", "±20%") — never rounded for cleanliness.
- **Vibe:** grim, ornate, martial — but the *tool* stays calm and legible. The
  ornament belongs to the brand chrome (headers, banners, rarity and status
  colour), not to every sentence of body copy.

## Visual foundations

- **Colour:** deep navy/void neutrals (`--n-0` … `--n-11`, near-black `#050a14`
  to pale `#f7f9fc`) replace flat grey, matching the game's starfield and
  console panels. A single **gold accent** (`--gold-1` … `--gold-8`) carries
  currency, primary actions, ornamental borders and the top of the rarity
  ladder — one accent colour, used sparingly: one primary button per view, one
  gold border per emphasised panel. A **six-step rarity ladder** (`--rarity-0`
  grey/Common through `--rarity-5` red/Mythic) colours every unit, item and
  badge consistently. **Faction identity colours** tag rosters by allegiance.
  Status colours (owned/unlockable/locked = green/gold/slate-blue) drive
  left-border rails on cards.
- **Type:** a condensed display face (Oswald, uppercase, wide letter-spacing)
  for banners, nav brand and big stat numbers — standing in for the game's
  engraved lettering — paired with a humanist sans (Inter) for body copy and a
  monospace (JetBrains Mono) for keys, ids and pasted JSON.
- **Spacing:** a tight 4px-rooted scale (2–64px) suited to a dense, list-heavy
  data tool. Panels use 16px internal padding; stat grids use 10–12px gaps.
- **Backgrounds:** flat navy panels. No photographic imagery or full-bleed art
  in the tool — the game is full-bleed illustrated, the tool stays data-dense
  and flat. No repeating textures, and no gradients in UI chrome; gradients are
  reserved for rare ornate accents such as a gold glow on an emphasised panel.
- **Animation:** minimal. 120–180ms `--ease-standard` transitions on hover and
  press only. No bounces, no page-transition flourishes.
- **Hover / press:** hover lightens the surface one step (`--bg-raised` →
  `--bg-hover`) and/or brightens a border to the gold-dim accent. No colour
  inversion. Press states are not scaled or shrunk — only the border and
  background step change.
- **Borders & shadows:** 1px flat borders by default (`--border-default`). A
  gold ornate treatment (`--border-accent` + `--shadow-glow-gold`) is reserved
  for emphasis: a focused input, a card the user should notice. No drop shadows
  on ordinary cards — depth comes from surface-tone steps against the navy, not
  from blur.
- **Corner radii:** small and consistent. 6–8px for cards, panels and inputs;
  pill (999px) for chips, badges and tabs. Nothing sharp, nothing very rounded.
- **Cards:** flat `--bg-raised` surface, 1px border, an optional 3px coloured
  left rail for status, uppercase small-caps eyebrows inside panels. No shadow,
  no gradient.
- **Transparency / blur:** none in UI chrome. Reserved, if ever used, for a
  modal scrim.

## Iconography

**No icon assets are copied into this system.** The in-game reference material
is Games Workshop / Snowprint copyrighted artwork, so it was read for colour,
layout and type conventions only.

The app's own icon needs are served by *referencing* rather than rehosting a
community asset bundle — see the "Icons" section of the repository README and
`ui/public/icons.json`. Chips, coloured rails and stars carry status and
identity signalling wherever an icon is absent. If icons are extended, match the
game's approach: simple filled glyphs, sourced from a licensed pack, never
hand-drawn approximations of GW IP.

**There is no logo.** Wherever a mark would go, the wordmark "TACTICUS TOOLS" is
rendered in the display face.

## Fonts

No webfont files were available from the codebase (system fonts) or the game
(proprietary). **Oswald**, **Inter** and **JetBrains Mono** are Google Fonts
substitutes for, respectively, the game's condensed engraved headline lettering,
a plain readable UI sans, and a code face. If the real typefaces ever become
available, swap the `@import` in `tokens/typography.css` — everything else reads
only the `--font-display` / `--font-body` / `--font-mono` aliases, so no
component changes would be needed.

## Tokens

| File | Carries |
| --- | --- |
| `ui/src/design/tokens.css` | root sheet — `@import`s only |
| `ui/src/design/tokens/colors.css` | neutrals, gold accent, rarity, status, faction, ability-slot colours, semantic aliases |
| `ui/src/design/tokens/typography.css` | font stacks, type scale, leading, tracking |
| `ui/src/design/tokens/spacing.css` | 4px-rooted spacing scale, `--content-max` |
| `ui/src/design/tokens/effects.css` | radii, borders, shadows, the hex clip path, easing and durations |

## Known gaps — from the system's author

- No real logos, icons or art are included (see Iconography). Licensed access to
  the game's UI assets would let them be wired in properly.
- Fonts are Google Fonts substitutes, not the game's actual typefaces.
- The visual direction is a read of five reference screenshots plus
  tacticuscodex.com, not a full design audit. The hexagonal item slots and the
  campaign roadmap in particular were not fully explored — `--hex-clip` exists
  for the former but is barely used.
- The upstream UI kit covers only the units / plans / player routes at
  representative depth; the timeline and full requirements tree were not built
  out there.
