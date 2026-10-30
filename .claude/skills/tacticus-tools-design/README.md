# Tacticus Tools Design System

A design system for **Tacticus Tools**, a community-built companion app for
*Warhammer 40,000: Tacticus*. It provides the visual foundation for roster
planners, evolution-plan calculators and the rest of the tooling.

The source app is a *utility*, and its original UI was a plain dark
developer-tool shell. **This system deliberately does not keep that shell.** Per
direction from the project owner it builds the utility's visual language out of
the game's own ornate sci-fi-gothic presentation, while keeping the tool's real
screens and features as the functional spec.

**The reference is `reference/six-screen-mock.png`, in this folder — read it
directly for any question of exact colour, spacing or shape.** The section
below describes what it shows, but a prose description is a lossy copy of an
image; when the two disagree, the image wins. A previous pass on this branch
described the reference as "forged metal" — riveted corners, embossed bevels,
a scratched-steel texture, a segmented progress gauge — and built accordingly.
None of that is actually in the reference: checked side by side, it's flatter
and cleaner than that, with no rivets, no texture, and smooth (not segmented)
progress bars anywhere. That pass was corrected; this section describes the
correction, not the invented version. If a future change to this system
starts from a mood ("this should feel more...") rather than from re-opening
the reference image, that's the same mistake happening again.

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
  currency, primary actions and the top of the rarity ladder — one accent
  colour, used sparingly: one primary button per view, the wordmark, the
  topbar's single hairline rule. A **six-step rarity ladder** (`--rarity-0`
  grey/Common through `--rarity-5` red/Mythic) colours a unit's rarity *badge*
  specifically — checked directly against the reference: a card's own border
  and left rail do **not** shift with rarity, only the small pill does (a
  Legendary, two Epics and a Rare in the reference all share the same green
  rail and the same neutral border). **Faction identity colours** tag rosters
  by allegiance. Status colours (owned/unlockable/locked =
  green/gold/slate-blue) drive the left rail on a card.
- **Type:** a condensed display face (Oswald, uppercase, wide letter-spacing)
  for banners, nav brand and big stat numbers — standing in for the game's
  engraved lettering — paired with a humanist sans (Inter) for body copy and a
  monospace (JetBrains Mono) for keys, ids and pasted JSON. Headline type is
  plain — no text-shadow, no emboss. The reference's lettering is clean bold
  type, not cut or cast metal; an earlier pass added an embossed text-shadow
  here that isn't actually visible in the source image.
- **Spacing:** a tight 4px-rooted scale (2–64px) suited to a dense, list-heavy
  data tool. Panels use 16px internal padding; stat grids use 10–12px gaps.
- **Backgrounds:** no photographic imagery, no full-bleed illustrated art, and
  — checked directly against the reference — **no surface texture either**:
  cards and panels are flat colour with at most a barely-there vertical sheen
  (`--sheen-raised`, a ~4%-lightness two-stop gradient; skip it entirely
  before reaching for anything stronger). No scratch/grain texture, no rivets,
  no embossed highlight-and-shadow edge on any surface — all three were tried
  in an earlier pass and don't match the source image. The page background
  carries one very faint radial `--gradient-vignette` glow — subtle enough
  that a flat `--bg-app` would look almost identical.
- **Lift, not bevel:** a raised surface (card, panel, button, the topbar) gets
  a thin solid border (`--border-default`) plus a soft ambient shadow
  (`--shadow-lift` / `--shadow-lift-sm`) for separation from the page — not an
  inset highlight-then-shadow pair. A sunken surface (input, chip, stat tile,
  a progress track) is simply a flatter, darker fill (`--bg-sunken`) with the
  same thin border and no shadow at all. If a surface needs to look
  "pressed in", make it flatter and darker, not shadowed.
- **Animation:** minimal. 120–180ms `--ease-standard` transitions on hover and
  press only. No bounces, no shimmer, no page-transition flourishes.
- **Hover / press:** hover lightens the surface one step (`--bg-raised` →
  `--bg-hover`) and/or brightens a border to the gold-dim accent. No colour
  inversion, no scale change on press.
- **Corner radii:** generous and consistent — `--radius-lg` (16px) for cards
  and panels, `--radius-md` (10px) for inputs and small controls, full pill
  (999px) for buttons, chips, badges and tabs. This is rounder than the
  system's first pass (was 6–8px): the reference's cards and buttons read as
  noticeably soft-cornered, closer to 14–16px at this scale.
- **Cards:** a plain raised panel (`--bg-raised` + a faint `--sheen-raised` +
  a thin border + `--shadow-lift-sm`), with a 4px coloured left rail for
  ownership status only (`--status`, set inline per roster entry). Rarity is
  never carried by the card frame — only by its badge chip.
- **Progress bars** (`.bar`) are a smooth continuous fill in a thin rounded
  track — checked directly against every progress bar in the reference (plan
  cards, a plan's overall bar, its per-unit rows): none of them are
  segmented or ticked.
- **Buttons** are full pill-shaped (`--radius-pill`), not rounded rectangles —
  the reference's primary ("Add to plan", "New team") and secondary
  ("Compare", "Refresh roster") buttons are both stadium-shaped.
- **Transparency / blur:** none in UI chrome. Reserved, if ever used, for a
  modal scrim.

## Not yet built

These appear in the reference but don't exist in this repo yet — they're
screen-specific components, not something the token system above implies on
its own. See the design plan for the current build-out (a unit "trading card"
hero with a fullName-derived subtitle, a numbered rank-up stepper,
resource-requirement cards, a restyled farming-node table with Best/Good/
Locked tags, and an original-artwork footer banner on the Plans list). An
aquila-style logo, a bottom Favorites/Compare tab bar, and a full per-unit
quote-sourcing project were deliberately ruled out — see the plan for why.

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
| `ui/src/design/tokens/effects.css` | radii, `--shadow-lift`/`--shadow-lift-sm`, `--sheen-raised`, `--shadow-glow-gold`, `--frame-ring`, the hex clip path, easing and durations |

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
- See "Not yet built" above for the screen-specific components the reference
  has that this repo doesn't yet.
