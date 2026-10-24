---
version: alpha
name: "{{PROJECT_NAME}}"
description: "{{DESIGN_ONE_LINE}}"
colors:
  primary: "#1D4ED8"
  on-primary: "#FFFFFF"
  ink: "#111827"
  muted: "#4B5563"
  neutral: "#FFFFFF"
  surface: "#F3F4F6"
  border: "#6B7280"
  error: "#B91C1C"
typography:
  display:
    fontFamily: system-ui
    fontSize: 2.25rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  h2:
    fontFamily: system-ui
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.3
  body-md:
    fontFamily: system-ui
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: system-ui
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: 4px
  md: 8px
  lg: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
components:
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  caption:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  link:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 16px
  input:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 12px
    height: 44px
  input-border:
    backgroundColor: "{colors.border}"
    textColor: "{colors.neutral}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 12px
    height: 44px
  alert-error:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.error}"
---

<!--
Template for docs/DESIGN.md, in the google-labs-code/design.md format (version alpha; spec: docs/spec.md in that repo).
The designer replaces the placeholders (double-brace, upper-case names) and the starter tokens above, which are a
neutral, accessible default (every text/background pair passes WCAG AA), not a design. Keep the section order below.
Gates: node .claude/skills/gate/gate.mjs design, npm run lint:design, npm run gate:design.
-->

## Overview

{{BRAND_AND_STYLE}}: who the readers are, what the site should feel like (for example calm, precise, trustworthy),
and the one impression a first visit must leave. Say what makes this look **original**; no competitor's identity is
reused.

## Colors

The palette is high-contrast neutrals with a single accent for interaction.

- **Primary (#1D4ED8):** links, primary buttons and focus rings; 6.7:1 on white [M: computed].
- **Ink (#111827):** headings and body text; 17.7:1 on white [M: computed].
- **Muted (#4B5563):** captions, metadata; 7.6:1 on white [M: computed].
- **Neutral (#FFFFFF) and Surface (#F3F4F6):** page and card backgrounds.
- **Border (#6B7280):** input borders and dividers; at least 3:1 against the page for UI boundaries.
- **Error (#B91C1C):** error text, always with an icon or words, never colour alone.

Dark mode: {{DARK_MODE_DECISION}} (define a second token set and check every pair again, or state that there is none).

## Typography

System font stack by default (`system-ui`): no font download, no third party, no layout shift. If the brand needs a
web font: at most two families, self-hosted `woff2`, `font-display: swap`, subset to {{LOCALES}}, license allowing
self-hosting recorded here: {{FONT_LICENSES}}.

Body text is at least 16 px with a line height of 1.6; headings step down from `display` to `h2` and `label`.

## Layout

Single column on phones, from 320 px; content width capped near 70 characters per line; spacing from the `spacing`
scale only. Breakpoints: {{BREAKPOINTS}}. Page templates (tool, guide, hub, trust page) follow `docs/ARCHITECTURE.md`;
the main action (a tool's inputs and result) sits above the fold on mobile. Space for future ad slots is reserved with
fixed heights so they never shift the layout, and never sits inside a tool's inputs or results.

## Elevation & Depth

Flat by default: surfaces are separated by the `surface` colour and borders, not shadows. {{ELEVATION_NOTES}}

## Shapes

Small radii (`rounded.sm` for inputs and buttons, `rounded.md` for cards). Touch targets at least 44×44 px.

## Components

- **page, caption, link:** text roles on the page background.
- **card:** grouped content (related tools, FAQs).
- **input / input-border:** form fields with a visible label above, 44 px high.
- **button-primary:** one per view for the main action.
- **alert-error:** validation messages next to the field.
{{EXTRA_COMPONENTS}}

## Do's and Don'ts

- Do keep one accent colour for interaction, and visible focus states on every control.
- Do respect `prefers-reduced-motion`; motion is optional and never carries meaning.
- Don't use colour alone to show state or meaning.
- Don't load fonts, icons or images from a third-party CDN.
- Don't copy a competitor's palette, logo, illustrations or icons.
