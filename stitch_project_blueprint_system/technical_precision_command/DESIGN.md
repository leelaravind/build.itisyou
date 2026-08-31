---
name: Technical Precision Command
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bec8d2'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#88929b'
  outline-variant: '#3e4850'
  surface-tint: '#89ceff'
  primary: '#89ceff'
  on-primary: '#00344d'
  primary-container: '#0ea5e9'
  on-primary-container: '#003751'
  inverse-primary: '#006591'
  secondary: '#b7c8e1'
  on-secondary: '#213145'
  secondary-container: '#3a4a5f'
  on-secondary-container: '#a9bad3'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00b17b'
  on-tertiary-container: '#003b26'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c9e6ff'
  primary-fixed-dim: '#89ceff'
  on-primary-fixed: '#001e2f'
  on-primary-fixed-variant: '#004c6e'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  data-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-caps:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style
The design system is engineered for high-stakes governance and project intelligence. It adopts a **Modern Corporate** aesthetic with a heavy emphasis on **Minimalism** and **Technical Precision**. The UI must evoke a sense of an "Engineering Command Center"—calculated, organized, and authoritative.

The visual language avoids decorative flourishes in favor of utility and clarity. It communicates intelligence through structured information density, purposeful whitespace, and a high-fidelity finish. The emotional response is one of total control and absolute reliability, bridging the gap between deep technical data and executive-level oversight.

## Colors
This design system utilizes a palette optimized for long-duration focus. The primary mode is **dark**, featuring deep slate and navy tones to minimize eye strain and establish a professional "command center" atmosphere.

- **Primary (Technical Teal/Blue):** Reserved for primary actions, focus states, and active data streams.
- **Surfaces:** Use `surface-low` for main application regions and `surface-high` for elevated elements like modals or popovers.
- **Semantic Mapping:** Success, Warning, and Danger are mapped to Emerald, Amber, and Rose respectively, using high-chroma variants to ensure they stand out against the muted neutral backgrounds.
- **Status Tokens:** Distinct hues are assigned to the project lifecycle to allow for rapid visual scanning of project boards and health dashboards.

## Typography
The typography system balances modern UI aesthetics with technical legibility. 

- **Geist** is used for all UI text and headings due to its clean, geometric, yet highly readable nature. 
- **JetBrains Mono** is the designated typeface for all technical data points, including ID tags, code snippets, git hashes, and timestamps.
- **Labels:** Use `label-caps` for table headers and section overlines to differentiate metadata from content.
- **Scaling:** Headlines shift significantly on mobile to maintain hierarchy without overwhelming the viewport.

## Layout & Spacing
The layout follows a **structured fluid grid** model. On desktop, a 12-column system is used with 24px gutters. Content should be organized into logical modules that utilize progressive disclosure to hide secondary information until requested.

- **Rhythm:** All spacing must be a multiple of the 4px base unit. 
- **Density:** The system supports three complexity modes:
    - **Beginner:** Increased whitespace (`lg` padding), simplified views.
    - **Professional:** Standard `md` padding, full toolsets.
    - **Enterprise:** Compact `sm` padding, high-density data tables, and multi-pane views.
- **Margins:** Page margins should scale from 16px on mobile to 48px+ on ultra-wide screens to maintain readability.

## Elevation & Depth
Depth is communicated through **Tonal Layering** rather than traditional shadows. This maintains the "Command Center" feel without becoming visually heavy.

- **Level 0 (Background):** The darkest base layer.
- **Level 1 (Surface-Low):** Main content areas, cards, and sidebar containers. Use a `border-subtle` to define edges.
- **Level 2 (Surface-High):** Hover states, active cards, and tooltips. 
- **Modals:** Use a high-diffusion, low-opacity shadow (e.g., `0 20px 25px -5px rgba(0, 0, 0, 0.5)`) combined with a `border-strong` to separate from the background.
- **Overlays:** Utilize a subtle 20% opacity black backdrop for focus-trapped interactions.

## Shapes
The shape language is strictly professional. 
- UI elements use a **Soft (4px)** radius as the default. 
- Large containers and cards may use **8px (rounded-lg)** to provide a slightly more approachable feel for high-level dashboards.
- Status indicators and "Quality Gate" icons should remain geometric (square or 4px rounded) to avoid the playfulness associated with circular pills.

## Components
Consistent application of the following component rules is required:

- **Buttons:** Primary buttons use `primary_color_hex` with white or near-white text. Ghost buttons use `border-subtle` and no background until hover.
- **Quality Gates:** 
    - **Pass:** Emerald icon + "PASS" in mono.
    - **Fail:** Rose icon + "FAIL" in mono.
    - **Blocked:** Amber icon + "BLOCKED" in mono.
    - **Exception:** Purple icon + "EXCEPTION" in mono.
- **Input Fields:** Use `surface-low` with a `border-subtle`. Active/Focus states must transition to a `primary_color_hex` border.
- **Chips:** Small, square-ish (4px radius) containers using technical mono fonts. Backgrounds should be low-opacity versions of status colors.
- **Data Tables:** High-density with `border-subtle` horizontal separators. Use zebra striping with `surface-low` on hover only.
- **Complexity Toggle:** A segmented control that switches the application's spacing and information density between Beginner, Professional, and Enterprise modes.