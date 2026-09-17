# Tacticus Tools Design System

A design system for **Tacticus Tools**, a community-built companion app for
*Warhammer 40,000: Tacticus*. It provides the visual foundation for roster
planners, evolution-plan calculators and the rest of the tooling.

The source app is a *utility*, and its original UI was a plain dark
developer-tool shell. **This system deliberately does not keep that shell.** Per
direction from the project owner it builds the utility's visual language out of
the game's own ornate sci-fi-gothic presentation, while keeping the tool's real
screens and features as the functional spec.

A first pass of this system (colour and type only, flat panels, no shadow) was
superseded on the `claude/layout-design-eval-trdcmq` branch by the **forged
metal** direction described below, matched against reference renders of the
game's own screens. The earlier flat system undersold the brief: the game's
chrome reads as cast and engraved metal — bevelled plates, riveted corners,
carved-in gauges — and a single flat 1px border never gets there. Everything
below is that direction; there is no flat variant to fall back to, and no
theme switcher — this is the one look the app has.

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
  badge consistently — a roster card additionally warms its whole frame
  towards its own rarity colour (see Cards, below), not just a chip. **Faction
  identity colours** tag rosters by allegiance. Status colours
  (owned/unlockable/locked = green/gold/slate-blue) drive left-border rails on
  cards.
- **Type:** a condensed display face (Oswald, uppercase, wide letter-spacing)
  for banners, nav brand and big stat numbers — standing in for the game's
  engraved lettering — paired with a humanist sans (Inter) for body copy and a
  monospace (JetBrains Mono) for keys, ids and pasted JSON. Display type
  additionally carries `--text-emboss`, a two-line text-shadow (a dark drop
  plus a hair of light beneath) so headline lettering reads as cut or cast
  metal. Body copy never gets this — the ornament is the chrome's, not the
  data's.
- **Spacing:** a tight 4px-rooted scale (2–64px) suited to a dense, list-heavy
  data tool. Panels use 16px internal padding; stat grids use 10–12px gaps.
  Unchanged by the metal system — bevels and rivets ride on the existing box
  model rather than adding new padding.
- **Backgrounds:** still no photographic imagery, and still no full-bleed
  illustrated art — the tool stays data-dense, the game stays the illustrated
  one. What changed is texture: every raised or sunken surface now carries a
  **metal bevel** (see below) and a near-invisible diagonal hairline scratch
  (`--texture-hairline`, a `repeating-linear-gradient` at ~3% opacity) standing
  in for brushed steel. Both are CSS gradients, never raster images — the
  system has no image or SVG texture assets, and finding a way to fake a look
  with gradients and `box-shadow` is preferred over reaching for one. The page
  background itself carries one soft radial `--gradient-vignette` glow behind
  the content — an abstract glow, not art, so it does not read as full-bleed
  illustration.
- **The metal bevel system** (`tokens/effects.css`) is what makes a flat panel
  read as forged plate. Two box-shadow recipes do the work:
  - `--bevel-raised` — a plate standing proud of the page: a bright 1px inset
    highlight on top, a dark 2px inset shadow on the bottom, plus a soft drop
    shadow. Used on cards, panels, buttons, the topbar, dialogs.
  - `--bevel-sunken` — a groove cut into the page: a strong inset shadow from
    the top, a hair of light beneath it. Used on inputs, stat tiles, chips,
    the progress track's floor — anything that reads as a readout rather than
    a control sitting on the surface.
  - `--bevel-pressed` is the sunken recipe used momentarily, on `:active`.
  Each pairs with a `--metal-raised` / `--metal-sunken` gradient
  (`background-image`, layered under `--texture-hairline`) for the sheen —
  never with a flat `background-color` alone once a surface is meant to read
  as metal.
- **Corner rivets:** cards, panels and dialogs additionally carry `--rivets` —
  four small gold studs, one radial-gradient per corner, composed as extra
  `background-image` layers. Each `radial-gradient(circle <size> at <x> <y>, …)`
  is self-positioned, so adding the token costs one more layer in
  `background-image` and nothing else — no extra markup, no
  `background-position` list to keep in sync. Reserved for the surfaces
  ornament is meant to read on (cards, panels, dialogs) — not on small chrome
  like chips or buttons, where it would just be noise.
- **Animation:** still minimal. 120–180ms `--ease-standard` transitions on
  hover and press. No bounces, no shimmer, no page-transition flourishes — the
  bevel system is static light and shadow, not simulated moving light.
- **Hover / press:** hover lightens the surface one step (`--bg-raised` →
  `--bg-hover`) and/or brightens a border to the gold-dim accent, same as
  before; a card additionally gains a soft rarity-tinted glow on hover. Press
  now reads as the plate sinking — `--bevel-pressed` swaps in for the raised
  recipe — rather than a colour or scale change.
- **Borders & shadows:** every raised or sunken surface pairs a solid border
  (`--border-default` or the bolder `--border-strong`) with its bevel
  box-shadow — the border is the edge, the bevel is the light falling on it.
  `--shadow-glow-gold` (focus rings, the primary button) and `--frame-ring`
  (the one emphasised portrait) are unchanged and still reserved for real
  emphasis, not spent on every element.
- **Corner radii:** unchanged — 6–8px for cards, panels and inputs; pill
  (999px) for chips, badges and tabs. The metal system is about surface and
  edge treatment, not shape.
- **Cards:** a riveted, bevelled metal plate (`--bevel-raised-sm` +
  `--rivets` + `--texture-hairline` + `--metal-raised`), a 3px coloured left
  rail for ownership status (`--status`, set per entry), and a border tinted
  towards the unit's own rarity colour (`color-mix()` against `--rarity`, also
  set per entry) — so a Legendary reads warm gold and a Mythic reads red
  without a second rail competing with the status one.
- **Progress bars** (`.bar`) are a segmented gauge, not a smooth fill: a
  sunken groove track, a glowing gold beveled fill, and eight tick marks laid
  on top via one `repeating-linear-gradient` overlay (`.bar::after`) so any
  percentage still lines up on a segment. No change to how a caller sets the
  fill (`<span style={{ width }}>`) — the segmentation is pure CSS.
- **Transparency / blur:** still none in UI chrome. Reserved, if ever used,
  for a modal scrim.

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
| `ui/src/design/tokens/effects.css` | radii, borders, shadows, the metal bevel recipes (`--bevel-*`), the metal/texture gradients (`--metal-*`, `--texture-hairline`), `--rivets`, `--text-emboss`, the hex clip path, easing and durations |

## Known gaps — from the system's author

- No real logos, icons or art are included (see Iconography). Licensed access to
  the game's UI assets would let them be wired in properly.
- Fonts are Google Fonts substitutes, not the game's actual typefaces.
- The visual direction is a read of reference screenshots plus
  tacticuscodex.com, not a full design audit. The hexagonal item slots and the
  campaign roadmap in particular were not fully explored — `--hex-clip` exists
  for the former but is barely used.
- The upstream UI kit covers only the units / plans / player routes at
  representative depth; the timeline and full requirements tree were not built
  out there.
- **The metal system reskins the app's existing screens; it does not yet add
  the screen-specific layouts a reference render also shows**, because those
  are new components rather than a restyle of one that exists: a bottom icon
  tab bar (the app currently navigates from a top bar), a numbered rank-up
  stepper with done/active/locked states, resource-requirement cards with a
  per-material icon and progress fill, a farming-node table with
  Best/Good/Locked tags, and a trading-card-style portrait treatment (a quote,
  a parchment-like card) on the unit detail page. The token system above
  (bevels, rivets, the segmented progress bar) is exactly what those would be
  built from, but the components themselves are still the flat structure that
  was there before — building them out is follow-up work, not implied by
  anything already in this repo.
