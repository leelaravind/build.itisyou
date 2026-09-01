# RESPONSIVE CONTRACT

> **Generated file — do not edit by hand.**
> Source of truth: `packages/design/src/responsive.ts`.
> Regenerate with `pnpm docs:responsive`. CI runs `pnpm docs:responsive --check`.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §3.3 (responsive behaviour), §3.4 (dense-screen
rules), §3.5 (missing designs); `MASTER_IMPLEMENTATION_PLAN.md` Phase 16.

---

## 1. Breakpoints

§3.3's six sizes. The widths are Tailwind's, because inventing a second scale would mean every class
in the codebase is written against one and reasoned about against another.

| Size | From | Prefix | Behaviour |
|---|--:|---|---|
| `MOBILE` | 0px | — (base) | One column. Every control at least 44px. Nothing scrolls sideways. This is the base layer, not an override — the desktop is the enhancement. |
| `SMALL_TABLET` | 640px | `sm` | Two columns where a pair of things are genuinely read together. Secondary navigation becomes visible. |
| `LARGE_TABLET` | 768px | `md` | Side-by-side comparison becomes possible: a list beside its detail. |
| `LAPTOP` | 1024px | `lg` | Three columns where three things are compared. Dense representations become primary. |
| `DESKTOP` | 1280px | `xl` | Full dense representations, with no truncation of names or values. |
| `WIDE_DESKTOP` | 1536px | `2xl` | Content stops widening and the extra space becomes margin. A paragraph across 1800px is harder to read than the same paragraph at 700px. |

**Mobile is the base layer, not an override.** §3.3 says the implementation "must not merely shrink
desktop UI", and writing mobile as the default with enhancements upward is what makes that true
rather than aspirational: a layout that exists only as a set of overrides has a desktop shape
underneath it, and the overrides are where it breaks.

**Wide desktop stops widening.** Line length is a readability constraint rather than a space one. A
paragraph stretched across 1800px is harder to read than the same paragraph at 700px, so extra width
becomes margin.

### How this is enforced

Prose cannot check itself, so the contract is tested through its symptom: **a shrunk desktop scrolls
sideways.** `e2e/mobile.spec.ts` asserts that every route — public pages and all ten project
surfaces — fits a 412px viewport with no horizontal overflow.

That test found a real defect on the first run: a three-column panel on the landing page needed about
425px and never stacked, so the whole document was wider than the phone. Nothing looked broken; the
page simply had to be dragged sideways to read, which is exactly what §3.3 is about.

---

## 2. Touch targets

Minimum: **44px**.

WCAG 2.2 §2.5.8 sets 24px, but that is the level below which a target *fails*. Designing to a failure
threshold means every rounding error is a defect. 44px is roughly the pad
of an adult finger, which is the constraint the criterion is approximating.

Checked by **measuring rendered boxes**, not by inspecting classes. A class that should produce 44px
and does not — because something overrode it, or the element is inline — is precisely the failure a
class-based check cannot see.

Targets inside a sentence are exempt, as §2.5.8 exempts them; enforcing it there would mean no prose
could contain a link.

---

## 3. Dense representations

§3.4 names ten and asks four things about each. The fourth — the accessible alternative — is listed
**separately from the mobile fallback**, and treating them as the same thing is the mistake this
contract exists to prevent.

A mobile fallback is what a small screen gets. An accessible alternative is what somebody gets who
cannot perceive the visual form **at any size**. A screen-reader user on a 27-inch monitor needs the
alternative, and a design that ships it only below 640px has not provided one.

So the rule here is stronger than §3.4 strictly requires: **the accessible alternative is always in
the document**, and the visual representation is supplementary to it. That inverts the usual
arrangement, where a table sits behind a toggle as a degraded thing — and it is the only arrangement
where the alternative cannot rot, because everybody is looking at it.

A test asserts, for every representation, that the accessible alternative is not merely a restatement
of the mobile fallback. Writing them as the same sentence is how the alternative ends up behind a
media query.

### dependency graph

| Size | Representation |
|---|---|
| Desktop | Node-and-edge diagram with the critical path emphasised. |
| Tablet | The same diagram, pannable, with labels shortened rather than hidden. |
| Mobile | An ordered list by dependency depth: what must happen before what. |

**Accessible alternative.** The ordered list, with each item naming what it depends on. A graph is a set of statements about ordering, and the statements are the content — the picture is a convenience.

Present at every size: **yes**.

### traceability graph

| Size | Representation |
|---|---|
| Desktop | One row per requirement with its chain rendered as a sequence of linked hops. |
| Tablet | The same rows, hops wrapping rather than truncating. |
| Mobile | The chain as a vertical list, one hop per line, each naming its status. |

**Accessible alternative.** Each hop is text: the hop name, its status word, and why it is that status. Nothing is conveyed by position or colour alone.

Present at every size: **yes**.

### architecture diagram

| Size | Representation |
|---|---|
| Desktop | Components grouped by layer, with dependency arrows. |
| Tablet | Layers stacked vertically, arrows replaced by an explicit "depends on" line. |
| Mobile | A list grouped by layer, each component naming what it depends on. |

**Accessible alternative.** The grouped list. Layer membership and dependency direction are both stated in words, because both are the whole meaning of the diagram.

Present at every size: **yes**.

### timeline

| Size | Representation |
|---|---|
| Desktop | Horizontal bars against a date axis. |
| Tablet | The same bars over a shorter window, with a range control. |
| Mobile | A chronological list with the range and any caveats on each entry. |

**Accessible alternative.** The chronological list. A bar communicates start, end and overlap; all three are stated rather than drawn.

Present at every size: **yes**.

### calendar

| Size | Representation |
|---|---|
| Desktop | A month grid. |
| Tablet | A week grid. |
| Mobile | An agenda: the next entries in order, with dates written out. |

**Accessible alternative.** The agenda. A grid conveys date by position, which is exactly what a non-visual reading cannot recover.

Present at every size: **yes**.

### work breakdown

| Size | Representation |
|---|---|
| Desktop | Columns by status, cards within. |
| Tablet | Two columns with the rest reachable by scrolling within the region. |
| Mobile | One list per status, stacked, each headed by its status and count. |

**Accessible alternative.** The stacked lists. A card conveys status by which column it sits in, so on mobile and for assistive technology the status is written on the group instead.

Present at every size: **yes**.

### budget table

| Size | Representation |
|---|---|
| Desktop | Rows of cost lines with columns for type, amount and range. |
| Tablet | The same table, scrolling horizontally within its own region rather than the page. |
| Mobile | One block per line, label above value, ranges written out in full. |

**Accessible alternative.** The blocks, with every figure carrying its unit and currency inline. A column heading two hundred pixels away is not a label anybody hears.

Present at every size: **yes**.

### risk register

| Size | Representation |
|---|---|
| Desktop | A table sorted by impact, with likelihood and mitigation columns. |
| Tablet | The same table with mitigation moved to a second line. |
| Mobile | One block per risk, impact and likelihood written as words rather than plotted. |

**Accessible alternative.** The blocks. Impact and likelihood are words, never a position on a matrix — a two-by-two grid is meaningless without sight of it.

Present at every size: **yes**.

### test matrix

| Size | Representation |
|---|---|
| Desktop | Requirements against test categories, cells showing outcome. |
| Tablet | One requirement per row, categories wrapping. |
| Mobile | One block per requirement listing each category and its outcome. |

**Accessible alternative.** The blocks. A matrix cell means nothing without both its headings, and neither heading is adjacent to it in reading order.

Present at every size: **yes**.

### audit log

| Size | Representation |
|---|---|
| Desktop | A dense table, newest first, with columns for actor, action and subject. |
| Tablet | The same table with the payload collapsed. |
| Mobile | One block per event: what happened, who did it, when, in that order. |

**Accessible alternative.** The blocks, in sequence order. The sequence is the content of an audit log, so it is never re-ordered for presentation.

Present at every size: **yes**.

---

## 4. Derived screens (§3.5)

Where a locked screen was not in the Stitch export, it was built from the established design system
and its primitives, preserving the navigation and visual language, and recorded as derived rather
than exported in `docs/DESIGN_SCREEN_MAP.md`.
