# DESIGN HANDOFF SPECIFICATION

**Date:** 2026-08-31
**Contract ref:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §3, `MASTER_IMPLEMENTATION_PLAN.md` §4.3
**Sources of truth, in precedence order:**

1. `stitch_project_blueprint_system/*/screen.png` — the **rendered** design. Plan §4.2 names the Stitch
   exports the visual source of truth; the PNG is what was actually seen and approved.
2. `stitch_project_blueprint_system/technical_precision_command/DESIGN.md` — the token *contract* and the
   design rationale prose.
3. `stitch_project_blueprint_system/*/code.html` — the emitted markup. Structurally authoritative for
   layout and copy, but demonstrably defective in places (§4).

Where these disagree, §4 records the conflict and the resolution. Gap-spec §3.1 is explicit: *"Do not
guess exact token values if the export contains them. Extract them first."* Every value below was
extracted programmatically from all 50 exports, not eyeballed.

---

## 1. Extraction method and confidence

All 50 `code.html` files were parsed and their inline `tailwind.config` blocks normalised (quote style
and whitespace collapsed) before comparison. Results:

| Check | Result |
|---|---|
| Files carrying a `tailwind-config` block | **50 / 50** |
| Distinct colour token names | **47** |
| Colour tokens with **conflicting values** across files | **0** |
| Colour tokens absent from any file | **0** |
| `fontSize` scale conflicts after normalisation | **0** |
| `fontFamily` conflicts after normalisation | **10 keys — see D3** |

A naive hash of the raw config blocks yields 34 distinct hashes, which looks alarming. It is not: Stitch
emits JSON object keys in arbitrary order. After normalisation the colour system is **perfectly
consistent across all 50 screens**. This was worth verifying rather than assuming in either direction.

---

## 2. Colour tokens — extracted verbatim

The palette is a Material-3 dark scheme. All 47 values are identical in every export and match
`DESIGN.md` frontmatter exactly.

### 2.1 Core surfaces and text

| Token | Value | Role |
|---|---|---|
| `background` | `#0b1326` | Page ground |
| `surface` | `#0b1326` | Base surface |
| `surface-dim` | `#0b1326` | Dimmed surface |
| `surface-bright` | `#31394d` | Brightest surface |
| `surface-container-lowest` | `#060e20` | Deepest well |
| `surface-container-low` | `#131b2e` | Main content regions, cards, sidebar |
| `surface-container` | `#171f33` | Default container |
| `surface-container-high` | `#222a3d` | Hover, active cards, tooltips |
| `surface-container-highest` | `#2d3449` | Highest elevation |
| `surface-variant` | `#2d3449` | Variant surface |
| `surface-tint` | `#89ceff` | Elevation tint |
| `on-surface` | `#dae2fd` | Primary text |
| `on-surface-variant` | `#bec8d2` | Secondary text |
| `on-background` | `#dae2fd` | Text on ground |
| `inverse-surface` | `#dae2fd` | Inverse surface |
| `inverse-on-surface` | `#283044` | Text on inverse |
| `outline` | `#88929b` | Strong border |
| `outline-variant` | `#3e4850` | Default border |

### 2.2 Accents

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `primary` | `#89ceff` | | `secondary` | `#b7c8e1` |
| `on-primary` | `#00344d` | | `on-secondary` | `#213145` |
| `primary-container` | `#0ea5e9` | | `secondary-container` | `#3a4a5f` |
| `on-primary-container` | `#003751` | | `on-secondary-container` | `#a9bad3` |
| `inverse-primary` | `#006591` | | `secondary-fixed` | `#d3e4fe` |
| `primary-fixed` | `#c9e6ff` | | `secondary-fixed-dim` | `#b7c8e1` |
| `primary-fixed-dim` | `#89ceff` | | `on-secondary-fixed` | `#0b1c30` |
| `on-primary-fixed` | `#001e2f` | | `on-secondary-fixed-variant` | `#38485d` |
| `on-primary-fixed-variant` | `#004c6e` | | | |

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `tertiary` | `#4edea3` | | `error` | `#ffb4ab` |
| `on-tertiary` | `#003824` | | `on-error` | `#690005` |
| `tertiary-container` | `#00b17b` | | `error-container` | `#93000a` |
| `on-tertiary-container` | `#003b26` | | `on-error-container` | `#ffdad6` |
| `tertiary-fixed` | `#6ffbbe` | | | |
| `tertiary-fixed-dim` | `#4edea3` | | | |
| `on-tertiary-fixed` | `#002113` | | | |
| `on-tertiary-fixed-variant` | `#005236` | | | |

---

## 3. Semantic token mapping (gap-spec §3.1)

Gap-spec §3.1 names 20 required semantic tokens. Nine map directly onto extracted values. **Eight do not
exist in the export at all** and must be derived — recorded here so the derivation is explicit and
reviewable rather than improvised in a component file.

| Required token | Status | Value | Basis |
|---|---|---|---|
| `background` | EXTRACTED | `#0b1326` | `background` |
| `surface-1` | EXTRACTED | `#131b2e` | `surface-container-low` |
| `surface-2` | EXTRACTED | `#222a3d` | `surface-container-high` |
| `surface-3` | EXTRACTED | `#2d3449` | `surface-container-highest` |
| `border-default` | EXTRACTED | `#3e4850` | `outline-variant` |
| `border-strong` | EXTRACTED | `#88929b` | `outline` |
| `text-primary` | EXTRACTED | `#dae2fd` | `on-surface` |
| `text-secondary` | EXTRACTED | `#bec8d2` | `on-surface-variant` |
| `text-muted` | **DERIVED** | `#88929b` | Alias of `outline`. No third text tone exists in the export; `outline` is the only neutral dim enough to read as muted while clearing 4.5:1 on `surface-container-low`. |
| `accent-primary` | EXTRACTED | `#89ceff` | `primary` |
| `accent-hover` | **DERIVED** | `#c9e6ff` | `primary-fixed` — the palette's existing lighter primary. Avoids inventing a hue. |
| `accent-active` | **DERIVED** | `#0ea5e9` | `primary-container` — the palette's existing deeper primary. |
| `success` | EXTRACTED | `#4edea3` | `tertiary`. `DESIGN.md` prose: "Success … mapped to Emerald". |
| `danger` | EXTRACTED | `#ffb4ab` | `error`. Prose: "Danger … Rose". |
| `warning` | **DERIVED** | `#ffc16a` | **No amber token exists**, yet `DESIGN.md` prose mandates "Warning … Amber" and gate state `BLOCKED: Amber icon`. Derived at the luminance of the existing light-on-dark accents (`#ffb4ab`, `#4edea3`, `#89ceff`) so it sits in the same optical register. **Requires contrast verification — see §6.** |
| `info` | **DERIVED** | `#89ceff` | Alias of `primary`. The export uses `primary` for informational emphasis throughout; adding a distinct info hue would contradict the render. |
| `blocked` | **DERIVED** | `#ffc16a` | Alias of `warning`. `DESIGN.md` maps gate `BLOCKED` to Amber, the same hue as Warning. One value, two semantic names — intentional, not an oversight. |
| `unknown` | **DERIVED** | `#88929b` | Alias of `outline`. Unknown must read as *absent signal*, so a neutral is correct; a hue would imply a judgement the system has not made. |
| `approval` / `exception` | **DERIVED** | `#d0bcff` | **No purple token exists**, yet `DESIGN.md` mandates gate state `EXCEPTION: Purple icon`. Standard M3 dark-scheme tertiary purple, chosen for luminance parity with the existing accents. **Requires contrast verification.** |
| `focus-ring` | EXTRACTED | `#89ceff` | The export consistently uses `focus:ring-primary` / `focus:border-primary`. |

> **Why this matters.** Quality Gates (screen 28) is a core surface with six states — NOT_READY, READY,
> PASS, FAIL, BLOCKED, EXCEPTION. Two of the six have **no colour defined anywhere in the handoff**. Had
> this not been caught in Phase 0, the gate UI would have been built with invented colours and the
> divergence discovered during visual review, or not at all.

---

## 4. Defects found in the export

Each was verified programmatically or against the render, not inferred.

### D1 — `border-subtle` is referenced 67 times and defined zero times

`border-subtle`, `border-subtle/30` and `border-subtle/50` appear across the exports. No `subtle` key
exists in any of the 50 `tailwind.config` blocks, and none exists in `DESIGN.md`. Under the Tailwind CDN
build these classes silently produce no border colour.

`DESIGN.md` prose uses the term repeatedly and unambiguously — *"Use a `border-subtle` to define edges"*,
*"Ghost buttons use `border-subtle`"*, *"Data Tables: high-density with `border-subtle` horizontal
separators"*.

**Resolution:** `border-subtle` → `outline-variant` (`#3e4850`). The prose describes exactly the role
`outline-variant` fills, and the render shows those edges present. Token added as a named alias so the
design vocabulary survives in code.

### D2 — the border-radius scale is shifted by one step, and `rounded-full` is not round

| Name | `DESIGN.md` (contract) | Export configs (emitted) | Uses |
|---|---|---|---:|
| `xs` | — | — (undefined) | 16 |
| `sm` | `0.125rem` | — (undefined) | 102 |
| `DEFAULT` | `0.25rem` | `0.125rem` | 551 |
| `md` | `0.375rem` | — (undefined) | 26 |
| `lg` | `0.5rem` | `0.25rem` | 308 |
| `xl` | `0.75rem` | `0.5rem` | 276 |
| `full` | `9999px` | **`0.75rem`** | 351 |

Every name is displaced one step down, and `full` — which by universal convention means *pill/circle* —
is emitted as `0.75rem`. `rounded-sm`, `rounded-md` and `rounded-xs` are used but undefined, so they fall
back to Tailwind's stock values (which happen to match `DESIGN.md`'s `sm` and `md`).

**Resolved against the render, not by preferring one document.** `team_resources/screen.png` shows
avatars and agent icons as **rounded squares, not circles**, confirming the emitted `0.75rem` is what was
actually seen and approved. `DESIGN.md` prose independently agrees: *"Status indicators and Quality Gate
icons should remain geometric (square or 4px rounded) to avoid the playfulness associated with circular
pills."*

**Resolution:** adopt the `DESIGN.md` scale as canonical — it is the token contract and gives `rounded-full`
its conventional meaning — and **remap usages at implementation time** so the rendered result is
byte-identical to the approved design:

| Export class | Implementation class | Resulting radius |
|---|---|---|
| `rounded` | `rounded-sm` | `0.125rem` |
| `rounded-lg` | `rounded` | `0.25rem` |
| `rounded-xl` | `rounded-lg` | `0.5rem` |
| `rounded-full` | `rounded-xl` | `0.75rem` |
| `rounded-sm` / `rounded-md` / `rounded-xs` | unchanged | stock values already match |

This preserves both correct token semantics and exact visual fidelity. Genuine pills/circles, if any are
introduced in derived screens, use `rounded-full` = `9999px` deliberately.

### D3 — font fallback stack missing from 46 of 50 exports

Four exports (`execution_board`, `project_baselines`, `save_project`, `work_breakdown`) declare
`["Geist", "sans-serif"]` and `["JetBrains Mono", "monospace"]`. The other 46 declare only `["Geist"]`
and `["JetBrains Mono"]` — no fallback at all. Gap-spec §3.1 explicitly requires a "fallback font stack".

**Resolution:** the 4-file variant is correct; the 46 are deficient. Canonical stacks:

- Sans: `Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- Mono: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

### D4 — `headline-sm` used in 8 screens, defined nowhere

`integrations`, `members_roles`, `my_projects`, `organization_resources`, `project_handover`,
`project_settings`, `project_specification`, `retrospective` all use `text-headline-sm` /
`font-headline-sm`. No such key exists in any config or in `DESIGN.md`'s typography scale.

**Resolution:** add `headline-sm` — `20px / 28px / 600 / Geist`. It sits in the only gap in the existing
scale (between `headline-md` at 24px and `body-lg` at 18px) and the screens using it are all
section-heading contexts, consistent with that size.

### D5 — five required token categories absent from every export

`boxShadow`, `screens`, `zIndex`, `transitionDuration` and `transitionTimingFunction` appear in **none**
of the 50 configs. Gap-spec §3.1 requires shadows, breakpoints, a z-index system, animation duration and
easing. These are defined in §5 below.

### D6 — runtime CDN dependencies (also recorded in `REPOSITORY_AUDIT.md` §4.3)

Every export loads `cdn.tailwindcss.com` (the browser build, which compiles CSS at runtime) plus Google
Fonts and Material Symbols from Google's CDN. Both conflict with the CSP requirement in plan §18 and the
data-minimisation requirement in §19. **Resolution:** compile Tailwind at build time; self-host Geist,
JetBrains Mono and the Material Symbols subset.

---

## 5. Tokens this project must define (absent from handoff)

Marked **DERIVED**; each carries its rationale so it is reviewable.

### 5.1 Breakpoints (gap-spec §3.3)

`DESIGN.md` states a 12-column grid, 24px gutters, `container-max` 1440px, and margins scaling 16px
mobile → 48px+ ultra-wide. Stock Tailwind breakpoints satisfy the six named tiers:

| Tier | Token | Min width | Page margin | Grid |
|---|---|---:|---:|---|
| Mobile | (base) | 0 | 16px | 4 col |
| Small tablet | `sm` | 640px | 24px | 8 col |
| Large tablet | `md` | 768px | 24px | 8 col |
| Laptop | `lg` | 1024px | 32px | 12 col |
| Desktop | `xl` | 1280px | 40px | 12 col |
| Wide desktop | `2xl` | 1536px | 48px | 12 col, capped at 1440px |

### 5.2 Elevation

`DESIGN.md` mandates depth by **tonal layering, not shadows** — so the surface ladder in §2.1 *is* the
elevation system. Shadows are reserved for genuine overlays:

| Token | Value | Use |
|---|---|---|
| `shadow-none` | `none` | Default. Cards use tonal layering + `border-default`. |
| `shadow-overlay` | `0 20px 25px -5px rgb(0 0 0 / 0.5)` | Modals — the exact value from `DESIGN.md`. Paired with `border-strong`. |
| `shadow-popover` | `0 8px 16px -4px rgb(0 0 0 / 0.4)` | Dropdowns, tooltips, command palette. Derived at half the modal's diffusion. |

Modal backdrop: black at 20% opacity, per `DESIGN.md`.

### 5.3 Z-index

| Token | Value | Layer |
|---|---:|---|
| `z-base` | 0 | Page content |
| `z-sticky` | 10 | Sticky table headers, section headers |
| `z-appbar` | 20 | Top nav, project status header |
| `z-drawer` | 30 | Detail drawer |
| `z-backdrop` | 40 | Modal backdrop |
| `z-modal` | 50 | Dialogs |
| `z-popover` | 60 | Dropdowns, tooltips |
| `z-palette` | 70 | Command palette |
| `z-toast` | 80 | Notifications |

### 5.4 Motion

`DESIGN.md` specifies no motion. Derived to match a "calculated, organised, authoritative" command-centre
feel — quick and non-decorative:

| Token | Value | Use |
|---|---:|---|
| `duration-instant` | 75ms | Hover/active colour shifts |
| `duration-fast` | 150ms | Default. The export already uses `transition-colors` throughout. |
| `duration-medium` | 250ms | Drawer/dialog enter-exit |
| `duration-slow` | 400ms | Reserved; avoid |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default |
| `ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` | Entering |
| `ease-accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | Exiting |

All motion must respect `prefers-reduced-motion` (plan §25, WCAG 2.2 AA).

### 5.5 Typography — canonical scale

Extracted, plus `headline-sm` from D4. Every entry is `size / line-height / weight`.

| Token | Size | Line height | Weight | Tracking | Family |
|---|---:|---:|---:|---|---|
| `display-lg` | 48px | 56px | 700 | -0.02em | Sans |
| `headline-lg` | 32px | 40px | 600 | -0.01em | Sans |
| `headline-lg-mobile` | 24px | 32px | 600 | — | Sans |
| `headline-md` | 24px | 32px | 600 | — | Sans |
| `headline-sm` **(D4)** | 20px | 28px | 600 | — | Sans |
| `body-lg` | 18px | 28px | 400 | — | Sans |
| `body-md` | 16px | 24px | 400 | — | Sans |
| `body-sm` | 14px | 20px | 400 | — | Sans |
| `data-mono` | 14px | 20px | 500 | — | Mono |
| `data-mono-sm` | 12px | 16px | 500 | — | Mono |
| `label-caps` | 12px | 16px | 600 | 0.05em | Sans, uppercase |

Mono is mandatory for IDs, hashes, timestamps, code and status chips. `label-caps` is mandatory for table
headers and section overlines.

### 5.6 Spacing

4px base unit, extracted verbatim: `xs` 4 · `sm` 8 · `md` 16 · `lg` 24 · `xl` 32 · `2xl` 48 · `3xl` 64 ·
`gutter` 24 · `container-max` 1440. All spacing must be a multiple of 4px.

### 5.7 Density modes

`DESIGN.md` defines three complexity modes driving padding. This is the token-level expression of the
Beginner/Professional/Enterprise scaling required by plan §2.4:

| Mode | Container padding | Row height | Intent |
|---|---|---|---|
| Beginner | `lg` (24px) | comfortable | Increased whitespace, simplified views |
| Professional | `md` (16px) | default | Standard, full toolset |
| Enterprise | `sm` (8px) | compact | High-density tables, multi-pane |

Implemented as a CSS-variable layer switched at the app shell, so no component hardcodes a density.

---

## 6. Mandatory verification before Phase 2 closes

Derived values are proposals until proven. These are automated tests, not review items:

1. **Contrast — VERIFIED.** ✅ See §6.1. 43 automated assertions in
   `apps/web/test/design/contrast.test.ts`, which parses the shipped `globals.css` rather than a
   TypeScript mirror, so the test can only pass for values the browser is actually given.
2. **Non-colour status encoding.** Plan §25 requires status never be conveyed by colour alone. Every gate
   state, RAG indicator and severity chip needs an icon or text label. Asserted per component.
3. **Radius remap fidelity.** The D2 remap must be verified by visual regression against the source PNGs,
   not by reading the class names.
4. **Token completeness.** A test asserts no component references a token outside the frozen set — this
   is what would have caught D1 and D4 at authoring time.

### 6.1 Measured contrast ratios

Measured 2026-08-31 against the shipped `globals.css`. WCAG 2.2 AA needs **4.5:1** for body text and
**3:1** for UI boundaries.

| Token | on `background` | on `surface-container-low` | on `surface-container-high` |
|---|---:|---:|---:|
| `on-surface` | 14.34 | 13.30 | 11.10 |
| `on-surface-variant` | 10.91 | 10.12 | 8.44 |
| `primary` | 10.87 | 10.08 | 8.41 |
| `success` (extracted) | 10.83 | 10.05 | 8.39 |
| `danger` (extracted) | 10.89 | 10.11 | 8.43 |
| **`warning` (derived)** | **11.53** | **10.69** | **8.92** |
| **`exception` (derived)** | **10.85** | **10.07** | **8.40** |
| `unknown` / `outline` | 5.84 | 5.42 | 4.52 |

`on-primary` on `primary` (button label on fill): **7.72**.

**The derivation is empirically confirmed.** `warning` (11.53) and `exception` (10.85) land in the same
band as the three extracted accents — `primary` 10.87, `success` 10.83, `danger` 10.89 — a spread of
under 0.7. The luminance-parity method in §3 produced values that sit optically alongside the palette
rather than merely passing a threshold, which is what "same optical register" was meant to achieve.

**One value to watch:** `unknown` / `outline` measures **4.52** on `surface-container-high` — clearing
AA by 0.02. It is safe as body text on the two lower surfaces and safe everywhere as a border (3:1),
but it must not be used for body text on the highest surface without re-measuring. Tracked as a
constraint on the muted tone rather than a defect.

---

## 7. Component state matrix (gap-spec §3.2)

Every reusable component implements the applicable states below, and every one gets a Storybook story
(plan §23, gap-spec §60).

| Component | default | hover | active | focus | disabled | loading | error | success | selected | read-only | perm-denied | empty | overflow | mobile |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Button | ● | ● | ● | ● | ● | ● | | | | | ● | | ● | ● |
| Input / Textarea / Select | ● | ● | | ● | ● | | ● | ● | | ● | ● | | ● | ● |
| Checkbox / Radio / Toggle | ● | ● | ● | ● | ● | | ● | | ● | ● | ● | | | ● |
| Card | ● | ● | | ● | | ● | ● | | ● | | ● | ● | ● | ● |
| Table / DataTable | ● | ● | | ● | | ● | ● | | ● | ● | ● | ● | ● | ● |
| StatusBadge / SeverityBadge / GateState | ● | | | | | | | | | | | | ● | ● |
| Drawer / Dialog | ● | | | ● | | ● | ● | | | | ● | ● | ● | ● |
| Tabs / Stepper / Wizard | ● | ● | ● | ● | ● | ● | ● | ● | ● | | ● | | ● | ● |
| Board / WorkTree | ● | ● | ● | ● | | ● | ● | | ● | ● | ● | ● | ● | ● |
| Graphs (Dependency/Trace/Architecture) | ● | ● | | ● | | ● | ● | | ● | | ● | ● | ● | ● |
| EvidenceUploader | ● | ● | | ● | ● | ● | ● | ● | | ● | ● | ● | ● | ● |
| CommandPalette | ● | ● | ● | ● | | ● | ● | | ● | | ● | ● | ● | ● |

Graph components additionally require **small / medium / large-clustered** fixtures per gap-spec §60, and
an accessible relationship table per plan §25.

---

## 8. Design-vs-contract conflicts requiring a product decision

### C1 — AI coding agents rendered as peer resources

`team_resources/screen.png` shows "Claude-3-Opus / Senior Agent" as a resource card sitting alongside
"Dr. Elena Rostova / Lead Architect". Gap-spec §18.2 is explicit: *"Represent as capabilities, not
employees … Do not pretend an AI coding tool is a human employee."*

The conflict is narrower than it first appears — the design already differentiates: the human shows
**Capacity 95%** with a continuous bar, the agent shows **Compute Allocation: High** with a segmented bar,
and they carry distinct `HUM` / `AI` badges.

**Resolution (smallest justified adaptation, gap-spec §0):** keep the visual treatment exactly as
designed — it is legible and the differentiation is already there — and enforce the distinction in the
**domain model**, where it actually matters. An AI agent is a `Capability` attached to a team, never a
`Resource` of type human. Concretely it: carries no salary/day-rate cost (only subscription/API cost, if
any); cannot be an approver; cannot be assigned accountability for a gate or sign-off; and its output
requires verification per project policy. Enforced by domain invariants and tested, not by UI convention.

### C2 — product naming

Handled in `docs/DESIGN_SCREEN_MAP.md` §13. "GovIntel Platform" is the product; "GST Compliance Platform"
is the golden fixture project from plan §31; `Screen NN:` prefixes are authoring artefacts to strip.
