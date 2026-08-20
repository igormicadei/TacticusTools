---
name: tacticus-tools-design
description: The Tacticus Tools design system — colours, type, spacing, effects and the conventions that govern them. Use when building or restyling any part of the web app (ui/), or when producing mocks, prototypes or static HTML for it.
user-invocable: true
---

# Tacticus Tools design system

Authored in Claude Design (project `1e6536db-a74e-448e-84f0-f687745ec253`,
"Tacticus Tools Design System") and pulled into this repo so it works with no
network and no design authorization.

**The tokens are not stored here.** They live where the app actually consumes
them, so the two can never drift:

- `ui/src/design/tokens.css` — the root sheet, `@import`s only
- `ui/src/design/tokens/{colors,typography,spacing,effects}.css`

Read `README.md` beside this file for the visual language, the voice, and the
rules about what gets ornament and what does not. Read the token files for the
actual names — never invent a token, and never hard-code a hex value that a
token already carries.

The upstream project also holds React component sources (`Button`, `Chip`,
`Panel`, `UnitCard`, …) and an interactive UI kit. Those were **not** pulled:
this app's components already exist and are styled by class, so the tokens plus
the conventions are what it needs. Fetch them with the `DesignSync` tool if a
component's exact composition is ever in question.
