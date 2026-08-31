# DESIGN HANDOFF AUDIT — Stitch Export "Project Blueprint System" (GovIntel Platform)

**Phase 0 audit** of `E:\Project\build\stitch_project_blueprint_system\` — 50 exported screens (`code.html` + `screen.png` each) plus `technical_precision_command\DESIGN.md` (token spec).

**Method.** Every one of the 50 `code.html` files was parsed in full with an HTML parser (headings, nav/aside anchors, buttons, table headers, form labels/inputs, Material Symbols icon names, ID-pattern entities), plus targeted regex passes for status vocabulary, tailwind configs, and broken-markup checks. Prose "purpose"/"block" descriptions are inferred from that extracted structure. The `screen.png` images were **not** visually inspected; anything that is purely visual (chart shapes, exact colors in canvas areas) is described from markup only.

---

## 1. Design System (from `technical_precision_command/DESIGN.md`)

- **Aesthetic:** dark-mode "Engineering Command Center"; Modern Corporate, minimal, technically precise. Tonal layering instead of shadows.
- **Colors:** full Material-3-style token set (`surface`, `surface-container-{lowest..highest}`, `on-surface`, `primary #89ceff`, `primary-container #0ea5e9`, `tertiary #4edea3` (emerald success), `error #ffb4ab`, etc.). Background `#0b1326`. Semantic mapping: Success=Emerald, Warning=Amber, Danger=Rose, Exception=Purple.
- **Typography:** **Geist** for UI (`display-lg` 48/56 700 → `body-sm` 14/20 400, `label-caps` 12/16 600 +5% tracking for table headers/overlines); **JetBrains Mono** (`data-mono` 14, `data-mono-sm` 12) for IDs, hashes, timestamps, status chips.
- **Spacing:** 4px base unit; `xs`4 `sm`8 `md`16 `lg`24 `xl`32 `2xl`48 `3xl`64; `container-max` 1440px; `gutter` 24px; 12-col desktop grid.
- **Radius (DESIGN.md):** sm .125rem, DEFAULT .25, md .375, lg .5, xl .75, full 9999px. Gates/chips stay square-ish (4px), no circular pills.
- **Complexity modes:** Beginner / Professional / Enterprise density switch is a first-class system concept (segmented control changing padding + density).
- **Quality Gate states:** PASS (emerald) / FAIL (rose) / BLOCKED (amber) / EXCEPTION (purple), always in mono type.

### ⚠ DESIGN.md vs export mismatch — border radius
All exports ship `borderRadius: { DEFAULT: .125rem, lg: .25rem, xl: .5rem, full: .75rem }` — a *remapped, smaller* scale than DESIGN.md, and critically **`rounded-full` = 0.75rem, not 9999px** (avatars/pills in markup relying on `rounded-full` render as 12px-radius squares). The implementation must pick one canonical scale; recommend DESIGN.md's scale and re-audit any export markup that leaned on the remapped values.

---

## 2. Tailwind Config Comparison (all 50 diffed)

- **Color tokens: identical across all 50** — same 47 token names, same hex values (verified by normalized dict comparison; 1 variant only).
- **borderRadius & spacing values: identical across all 50** (the remapped radius scale above).
- **Not byte-identical:** 20 distinct serializations exist, differing only cosmetically:
  - key ordering (random per export);
  - quoted vs unquoted JS keys in 4 screens: `project_feasibility`, `save_project`, `work_breakdown`, `workload_capacity`;
  - font fallback stacks (`["Geist","sans-serif"]` vs `["Geist"]`) present only in `execution_board`, `work_breakdown`, `project_baselines`, `save_project`;
  - the set of `fontFamily` keys wobbles per export (some include `headline-lg-mobile`, `body-lg`, etc., others omit them). Canonicalize to the full DESIGN.md typography set.
- **Verdict:** one shared `tailwind.config` (or CSS-variable theme) can serve all 50 screens with zero visual change. All pages load `https://cdn.tailwindcss.com?plugins=forms,container-queries`, Google Fonts (Geist/JetBrains Mono via Inter-style link) and Material Symbols Outlined.

---

## 3. Information Architecture (union of navigation)

### 3.1 Global top bar (product nav)
`Home | Plan | Execute | Control | Documents | Insights` + search input + utility icons (`terminal` on shell-A screens, `notifications`, `settings`, `help`).

Present on **44/50** screens. **Missing entirely** on: `evidence`, `intake_wizard`, `save_project`, `scenario_planning`, `start_project`, `task_detail`. Present but rendered as non-anchor `<div>`s on `document_viewer`.

### 3.2 Sidebar variants (the real IA finding)
Three distinct project sidebars exist. This is the single biggest consolidation decision for implementation.

**Shell A — "Project Command" sidebar (22 screens).** CTA `New Request`. Items (verbatim, with icons):
`Overview` (dashboard), `Phases` (account_tree), `Resources` (group), `Risk` (warning), `Quality` (verified), `Analytics` (insights), `Settings` (settings), `Complexity` (tune).
Screens: ai_research_prompt, change_request_center, command_center, decisions_assumptions, dependency_graph, deployment_release, execution_board, impact_analysis, milestones, operations, production_verification, project_baselines, project_feasibility, quality_gates, requirements, risks_blockers, roadmap, task_detail, timeline, today, traceability, work_breakdown.

**Shell B — "Delivery/Docs" sidebar (15 screens).** CTA `New Task`. Items:
`Overview` (dashboard), `Phases` (layers), `Resources` (group), `Risk` (warning), `Quality` (verified), `Analytics` (analytics), `Export` (download), `Archive` (archive).
Screens: approvals_sign_offs, change_history, document_viewer, forecasts_estimates, project_health, recommendations_exceptions, scenario_planning, security, team_resources, testing_verification, workload_capacity — plus 4 deviants:
- `documents_hub`, `evidence`: insert **`Documents`** (folder) after Phases.
- `budget_cost_control`: **`Control`** (account_balance_wallet) **replaces `Risk`**.
- `architecture`: **`Architecture`** (architecture) **replaces `Resources`**.

**Shell C — "Org/Governance" sidebar (8 screens).** CTA `Add Milestone`. Items:
`Overview` (dashboard), `Resource Map` (hub), `Risk Matrix` (security), `Budget` (payments), `Schedule` (event), `Governance` (gavel), `Help` (help_outline), `Status` (analytics).
Screens: integrations, members_roles, my_projects, organization_resources, project_handover, project_settings, project_specification, retrospective.

**No sidebar (5 screens):** landing_page, start_project, intake_wizard, save_project (marketing split-pane instead), organization_overview.

### 3.3 Nav-item union table (item → screens)

| Nav item | Shell | Count | Screens |
|---|---|---|---|
| Overview | A+B+C | 45 | all sidebar screens |
| Phases | A+B | 37 | all A + all B screens |
| Resources | A+B | 35 | all A + B except budget_cost_control (→Control) & architecture (→Architecture) |
| Risk | A+B | 36 | all A + B except budget_cost_control |
| Quality | A+B | 37 | all A + B |
| Analytics | A+B | 37 | all A + B |
| Settings | A | 22 | shell-A screens |
| Complexity | A | 22 | shell-A screens |
| Export | B | 15 | shell-B screens |
| Archive | B | 15 | shell-B screens |
| Documents | B′ | 2 | documents_hub, evidence |
| Control | B′ | 1 | budget_cost_control |
| Architecture | B′ | 1 | architecture |
| Resource Map / Risk Matrix / Budget / Schedule / Governance / Help / Status | C | 8 | shell-C screens |

### 3.4 Nav inconsistencies to resolve
1. Three sidebars with overlapping-but-different vocab (Risk vs Risk Matrix, Resources vs Resource Map, Analytics vs Status). Decide: one **project** sidebar + one **organization** sidebar.
2. Per-screen one-off items (Documents, Control, Architecture) suggest the sidebar should be a single superset with active-section highlighting, not per-screen forks.
3. `project_health`: shell-B items present but **order scrambled** (Analytics precedes Overview).
4. `impact_analysis`: `Resources` uses the `account_tree` icon (duplicate of Phases) instead of `group`.
5. CTA label differs by shell (`New Request` / `New Task` / `Add Milestone`) — likely one contextual primary-action slot.
6. Six screens drop the global top bar (see 3.1); `document_viewer` renders it without links.
7. Shell-C ("org") sidebar appears on project-scoped screens (`project_settings`, `project_specification`, `project_handover`, `retrospective`, `members_roles`, `integrations`) — scope mixing to untangle.
8. Sidebar project label wobbles: usually `Project Alpha`, but `integrations`/`project_settings` show "GovIntel", `ai_research_prompt`/`workload_capacity`/`impact_analysis`/etc. omit it; heading level varies H1/H2.

---

## 4. Product-naming Inconsistencies (exact, from `<title>`)

**Leftover "Screen NN:" prefixes (3):**
- `milestones` → `Screen 17: MILESTONES - GST Compliance Platform`
- `risks_blockers` → `Screen 24: RISKS & BLOCKERS`
- `traceability` → `Screen 26: REQUIREMENT TRACEABILITY`

**"GST Compliance Platform" branding in title (11):** command_center, dependency_graph, evidence, milestones, project_feasibility, project_handover, quality_gates, requirements, task_detail, timeline, work_breakdown. (Note: "GST Compliance Platform" is also the *sample project's name* in content — e.g. my_projects card, command_center H1 — so in titles it conflates project with product.)

**"GovIntel" without "Platform" (11):** forecasts_estimates, integrations, intake_wizard, members_roles, my_projects, organization_overview, organization_resources, project_settings, project_specification, retrospective, save_project.

**No product suffix at all (2):** approvals_sign_offs (`Approvals & Sign-offs`), plus the two un-suffixed Screen-NN titles above.

**"GovIntel Platform" (correct canonical form, 25):** all remaining screens.

**Recommendation:** canonical pattern `"{Screen Name} — GovIntel Platform"`; treat "GST Compliance Platform" strictly as demo project data.

---

## 5. Shared Component Candidates (ranked by reuse)

| # | Component | Used on | Notes |
|---|---|---|---|
| 1 | **MaterialIcon** | 50 | Material Symbols Outlined everywhere. |
| 2 | **AppShell / TopNav** | 44 (+1 linkless) | Home/Plan/Execute/Control/Documents/Insights + search + utility icons. |
| 3 | **SidebarNav** | 45 | One component, 3 item-set variants (Section 3.2) + CTA slot + project label. |
| 4 | **PageHeader** | ~44 | H1 + right-aligned action buttons; sometimes breadcrumb chevron (`deployment_release`, `project_feasibility`, `team_resources`, `testing_verification`, `work_breakdown`). |
| 5 | **StatusChip** | ~40 | Mono uppercase square-ish chips (PASS, DRAFT, BLOCKED, SEV-1, TODO…). |
| 6 | **DataTable** | 19 | architecture, budget_cost_control, change_history, decisions_assumptions, deployment_release, documents_hub, evidence, impact_analysis, members_roles, operations, organization_overview, organization_resources, project_baselines, project_health, requirements, risks_blockers, security, testing_verification, workload_capacity. `label-caps` headers, mono data cells, row-action `more_vert`. |
| 7 | **FilterBar** | ~13 | search + select(s) + filter button: change_history, members_roles, organization_resources, requirements, evidence, my_projects, risks_blockers, security, budget_cost_control, decisions_assumptions, execution_board, impact_analysis, dependency_graph. |
| 8 | **SegmentedControl / ViewToggle** | ~12 | List/Grid (documents_hub, evidence, my_projects, team_resources), Tree/List (work_breakdown), Timeline/Calendar (timeline), Pending/Completed/All (approvals), DETERMINISTIC/LEARNED (forecasts), Global/Regional/Local (organization_overview), density toggles (below). |
| 9 | **StatTile / KPI row** | ~12 | command_center, operations, budget_cost_control, project_baselines, testing_verification, workload_capacity, project_health (7 dimension cards), forecasts_estimates, retrospective, today, roadmap, impact_analysis. |
| 10 | **GateBadge** | ~10 | PASS/FAIL/BLOCKED/EXCEPTION mono badges: quality_gates, roadmap, milestones, project_specification, testing_verification, production_verification, project_handover, budget_cost_control, dependency_graph, task_detail. |
| 11 | **Chart (inline SVG)** | 8 | budget_cost_control, dependency_graph, forecasts_estimates, impact_analysis, organization_overview, project_baselines, testing_verification, traceability. |
| 12 | **ComplexityToggle** | 4 explicit + 22 nav links | Segmented BEG/PRO/ENT on architecture, change_history, organization_resources, workload_capacity (only 2 options rendered there); `Complexity` sidebar item on all 22 shell-A screens. |
| 13 | **InspectorPanel (right rail/slide-over)** | 3 | document_viewer (doc metadata), task_detail (task slide-over), team_resources (resource details). |
| 14 | **Pagination** | 3 | change_history, evidence, requirements. |
| 15 | **KanbanBoard** | 1 | execution_board (Backlog/Ready/In Progress/Review/Done). |
| 16 | **WizardStepper** | 1–2 | intake_wizard (+ ai_research_prompt's Copy/Use/Return step cards). |
| 17 | **TreeView** | 1 | work_breakdown. |
| 18 | **Gantt/TimelineTrack** | 3 | timeline (month-scale gantt), roadmap (phase sequence), deployment_release (deployment timeline). |
| 19 | **ApprovalCard / ExceptionCard** | 2–3 | approvals_sign_offs, recommendations_exceptions (+ command_center recommended-action banner). |
| — | **EmptyState** | 0 | **Not present in any export** — must be designed net-new. |
| — | **Modal/Dialog** | 0 | No true modal markup found (task_detail slide-over is closest). DESIGN.md specifies modal elevation — design net-new. |

---

## 6. Broken / Unfinished Export Check

Coarse validation on all 50 files: every file ends with `</html>`; `<div>` open/close counts balance in all 50; a full HTML-parse pass raised no structural errors; **zero** occurrences of `lorem`, `ipsum`, `FIXME`, `placeholder text`, or `coming soon`.

Findings (none fatal, all cosmetic/content-level):
- `work_breakdown`: contains the literal chip text `TODO` — this is a **legitimate task-status chip** (TODO/IN_PROG/DONE lifecycle), *not* a placeholder.
- **Responsive duplicate H1 blocks** (mobile + desktop header both in DOM): `approvals_sign_offs`, `my_projects` (H1 appears twice); several screens duplicate the whole sidebar as a mobile drawer (`budget_cost_control`, `change_history`, `command_center`, `my_projects`, `risks_blockers`, `security`, `team_resources`, `retrospective`, etc.). Expected Stitch pattern, but dedupe when componentizing.
- `recommendations_exceptions`: content is **off-domain** — "Structural Integrity Review", "Thermal Tolerance", "Titanium Alloy" read as aerospace/manufacturing, not software governance. Screen structure is fine; copy needs rewrite.
- `ai_research_prompt`: references "GPT-4" as the external model; content otherwise fine.
- `timeline`: gantt bars/labels are largely presentational divs; no table/status extraction possible — verify against `screen.png` during build.
- Smallest exports (`start_project` 12KB, `save_project` 13KB) are intentionally minimal screens, not truncations.

---

## 7. Lifecycle Stage Map

| Stage | Screens |
|---|---|
| **Idea / Intake** | landing_page, start_project, intake_wizard, ai_research_prompt, save_project |
| **Discovery / Feasibility** | project_feasibility, scenario_planning, forecasts_estimates |
| **Planning** | roadmap, timeline, milestones, work_breakdown, requirements, dependency_graph, project_specification, project_baselines, team_resources, workload_capacity, budget_cost_control |
| **Approval / Governance** | approvals_sign_offs, quality_gates, change_request_center, impact_analysis, decisions_assumptions |
| **Execution** | command_center, execution_board, task_detail, today, risks_blockers, project_health, architecture |
| **Verification** | testing_verification, security, evidence, traceability |
| **Release** | deployment_release, production_verification |
| **Production / Operations** | operations |
| **Completion / Archive** | retrospective, project_handover |
| **Cross-cutting / Admin** | my_projects, organization_overview, organization_resources, members_roles, integrations, project_settings, documents_hub, document_viewer, change_history, recommendations_exceptions |

(Some screens straddle stages — e.g. budget_cost_control and change_history serve Control throughout; the table gives the primary home.)

---

## 8. Per-Screen Audit

Legend: **Shell** = sidebar variant from §3.2 (A / B / B′-deviant / C / None) + whether global top bar present. Icons listed are the distinct Material Symbols names in the file. IDs = exact entity-ID strings found.

---

### 8.1 ai_research_prompt_govintel_platform
- **Title:** `Intelligence Gathering Request - GovIntel Platform`
- **Purpose:** Hands the user a generated AI research prompt for their project idea to run in an external LLM, with copy / open-in-AI / return-results workflow.
- **Shell:** A + top bar (with `terminal` utility icon). Sidebar has no project label; CTA `New Request`.
- **Blocks:** page header (bolt icon + H1 "Intelligence Gathering Request") → 3 step cards `Copy Prompt` / `Use AI` (smart_toy, psychology, chat) / `Return` → prompt code block with `COPY PROMPT` button → info + success callouts → `Advanced Settings` link.
- **Tables:** none. **Forms:** none.
- **Entities:** GPT-4 (external model reference).
- **Status vocab:** COPY PROMPT, EXTERNAL REASONING MODULE (labels, not statuses).
- **Affordances:** copy-to-clipboard; step navigation.
- **Icons:** terminal, notifications, help, rocket_launch, dashboard, account_tree, group, warning, verified, insights, settings, tune, bolt, smart_toy, psychology, chat, code, content_copy, info, check_circle, arrow_forward.
- **Lifecycle:** Idea/Intake.

### 8.2 approvals_sign_offs_govintel_platform
- **Title:** `Approvals & Sign-offs` *(no product suffix)*
- **Purpose:** Queue of artifacts awaiting approval/sign-off with per-item review actions.
- **Shell:** B + top bar with "Search approvals..." input. Sidebar project label `Project Alpha`, CTA `New Task`. Duplicate H1 (mobile+desktop).
- **Blocks:** page header → filter tabs `Pending | Completed | All` → approval card list: "Phase 2 Core Specifications" (PENDING → `Review`), "Data Pipeline Topography" (APPROVED → `View`), "Q3 Hardware Procurement" (REJECTED → `Revise`), "External API Gateway Access" (PENDING+warning → `Priority Review`), "v4.1.0 Deployment" (BLOCKED → `Details`).
- **Tables/Forms:** none (card list pattern).
- **Status vocab:** APPROVED, PENDING, REJECTED, BLOCKED, Completed, HIGH, Review.
- **Affordances:** tab filter, search, per-card action buttons.
- **Icons:** search, notifications, settings, help, add, dashboard, layers, group, warning, verified, analytics, download, archive, description, pending, architecture, check_circle, payments, cancel, security, rocket_launch, block.
- **Lifecycle:** Approval/Governance.

### 8.3 architecture_govintel_platform
- **Title:** `GovIntel Platform - Architecture Workspace`
- **Purpose:** Living architecture workspace showing system topology, data stores, infrastructure and security posture of the solution design.
- **Shell:** B′ + top bar w/ "Search architecture..." — **sidebar deviation: `Architecture` item replaces `Resources`**; project label `GST Compliance`.
- **Blocks:** page header "Living Architecture Workspace" with **complexity toggle `BEG | PRO | ENT`** + `Edit Mode` button → "System Flow Topology" diagram panel (fullscreen, grid_view controls) → "System Overview" node cards (health checks, links, a bug_report flag) → "Data Stores" (storage, memory, cloud) → "Infrastructure" **table** → `View Terraform Config` link → "Security & Auth" panel (policy items).
- **Table:** `Resource | Type | Status`.
- **Entities:** REQ-CE-05, REQ-IN-01, TSK-892; AWS.
- **Status vocab:** HEALTHY, HIGH LOAD, LIVE, Active.
- **Affordances:** complexity toggle, edit mode, fullscreen diagram, requirement-link chips.
- **Icons:** search, notifications, settings, help, account_balance, dashboard, layers, architecture, warning, verified, analytics, add, download, archive, edit, account_tree, fullscreen, grid_view, check_circle, link, bug_report, database, storage, memory, cloud, arrow_forward, security, policy.
- **Lifecycle:** Execution (design artifact, maintained live).

### 8.4 budget_cost_control_govintel_platform
- **Title:** `GovIntel Platform - Budget & Cost Control`
- **Purpose:** Budget dashboard tracking allocation, burn rate, forecast and per-line-item variance.
- **Shell:** B′ + top bar w/ "Search budget..." — **sidebar deviation: `Control` (account_balance_wallet) replaces `Risk`**; label `Project Alpha`; sidebar duplicated for mobile drawer.
- **Blocks:** page header + actions `Export Report`, `Allocate Funds` → KPI stat row (account_balance, check_circle, shopping_cart, savings, trending_up, warning — budget totals/spend/committed/savings/forecast/variance) → "Burn Rate & Forecast" chart (SVG) → "Category Allocation" breakdown → "Detailed Line Items" **table** with filter + row menus.
- **Table:** `ID | Description | Category | Estimated | Actual | Variance | Status` (rows LI-001…LI-004).
- **Entities:** LI-001..LI-004, PRJ-2024.
- **Status vocab:** PASS, EXCEPTION, UNDER (variance chips).
- **Affordances:** filter_list, more_vert row menus, export.
- **Icons:** notifications, domain, add, dashboard, layers, group, account_balance_wallet, verified, analytics, download, archive, search, settings, help, account_balance, check_circle, shopping_cart, savings, trending_up, warning, filter_list, more_vert, trending_down.
- **Lifecycle:** Planning/Control.

### 8.5 change_history_govintel_platform
- **Title:** `Change History / Versioning - GovIntel Platform`
- **Purpose:** Immutable audit log of every create/update/delete across project objects, filterable by module, user and date.
- **Shell:** B + top bar; sidebar `Project Alpha` (rendered as nav element + mobile dupe with stray H1 "GovIntel Platform").
- **Blocks:** page header "Change History" with **complexity toggle `Enterprise | Professional | Beginner`** (note reversed order vs other screens) → FilterBar: search "Search by ID, User, or Object...", select `All Modules` (Risk Register / Resource Allocation / Quality Control), select `All Users` (System / Admin), date control (calendar_month) → audit **table** → pagination (chevron_left/right).
- **Table:** `Timestamp | User | Action / Object | Diff (Previous → New) | Status`; linked object IDs RSK-892, DOC-104, PHS-009, CFG-SYS-1; actor icons include smart_toy (AI) and api (system).
- **Status vocab:** CREATE, UPDATE, DELETE, SYSTEM; check_circle / block state icons.
- **Affordances:** search, 2 selects, date filter, pagination, complexity toggle, object deep-links.
- **Icons:** add, dashboard, layers, group, warning, verified, analytics, download, archive, search, notifications, settings, help, calendar_month, check_circle, smart_toy, api, block, chevron_left, chevron_right.
- **Lifecycle:** Cross-cutting (audit).

### 8.6 change_request_center_govintel_platform
- **Title:** `Change Request Center - GovIntel Platform`
- **Purpose:** Detail view of a single change request (CR-2023) with impact summary and accept/revise/reject disposition.
- **Shell:** A + top bar w/ "Search resources...", terminal icon; `Project Alpha`.
- **Blocks:** page header "Change Request Center" (+ schedule chip, status `PENDING REVIEW`) → "Request Details" card (H4 `Description`, H4 `Reason for Change`) → impact stat chips (payments/trending_up cost delta, calendar_today schedule delta, warning/trending_down risk) → "Affected Components" list (architecture, inventory_2, engineering) → "Disposition" action panel: `Accept Request` / `Revise Request` / `Reject Request`.
- **Tables/Forms:** none.
- **Entities:** CR-2023, ISO-9001.
- **Status vocab:** PENDING REVIEW, Critical.
- **Affordances:** three-way disposition buttons.
- **Icons:** dashboard, account_tree, group, warning, verified, insights, add, settings, tune, search, terminal, notifications, help, schedule, payments, trending_up, calendar_today, trending_down, architecture, inventory_2, engineering, check_circle, edit_note, cancel.
- **Lifecycle:** Approval/Governance.

### 8.7 command_center_govintel_platform
- **Title:** `GST Compliance Platform - Project Home` *(GST branding)*
- **Purpose:** Project home / command center: single next-best-action plus at-a-glance lifecycle, milestone, budget, schedule, blocker and gate status.
- **Shell:** A + top bar (terminal icon); `Project Alpha`; hub logo.
- **Blocks:** page header (H1 = project name "GST Compliance Platform") + `GENERATE REPORT` → **Recommended Action banner**: "Approve Architecture Gate" with `REVIEW & APPROVE` / `DEFER` (priority icon) → KPI tile row: Lifecycle Phase ("Development Phase", IN PROGRESS), Current Milestone, budget (account_balance_wallet, HEALTHY), schedule (calendar_month, SLIGHT DELAY), Major Blockers ("None", warning), Quality Gates summary (radar/check_circle/pending).
- **Tables/Forms:** none.
- **Status vocab:** HEALTHY, IN PROGRESS, SLIGHT DELAY; labels Lifecycle Phase, Current Milestone, Major Blockers, Quality Gates, Recommended Action.
- **Affordances:** approve/defer decision buttons, report generation.
- **Icons:** hub, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, terminal, notifications, help, priority, flag, account_balance_wallet, calendar_month, radar, check_circle, pending.
- **Lifecycle:** Execution (project home).

### 8.8 decisions_assumptions_govintel_platform
- **Title:** `GovIntel Platform - Decisions & Assumptions`
- **Purpose:** Log of verified decisions plus open assumptions/unknowns with verification workflow.
- **Shell:** A + top bar (terminal); sidebar without project label.
- **Blocks:** page header "Decisions & Assumptions Log" + `Filter`, `Export` → "Log Summary" stat strip (add_circle) → "Verified Decisions" **table** → "Assumptions & Unknowns" cards: "API Rate Limits" (`Verify`, visibility), "Legacy Data Migration" (`Investigate`, database).
- **Table:** `ID | Decision | Rationale | Owner | Date` (DEC-042, DEC-043).
- **Entities:** DEC-042, DEC-043, ASM-018, UNK-005.
- **Status vocab:** ASSUMPTION, UNKNOWN.
- **Affordances:** filter, export, verify/investigate actions.
- **Icons:** search, terminal, notifications, help, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, filter_list, download, add_circle, psychology, visibility, database.
- **Lifecycle:** Approval/Governance (decision record).

### 8.9 dependency_graph_govintel_platform
- **Title:** `GST Compliance Platform - Dependency Graph` *(GST branding)*
- **Purpose:** Visual dependency chain from requirement through architecture, task, test, to external dependency, highlighting the blocked edge.
- **Shell:** A + top bar (terminal); `Project Alpha`.
- **Blocks:** page header "Dependency Graph" + `Filter` → node graph (SVG edges) of five node cards: REQ-101 "Tax Logic Requirements" (Passed) → ARC-202 "Calculation Engine" (sync/in-progress) → TSK-505 "Implement IGST" (pending) → TST-303 "Scenario Test Suite" (science) → EXT-01 "Gov API Gateway" (**Blocked**).
- **Tables/Forms:** none.
- **Entities:** REQ-101, ARC-202, TSK-505, TST-303, EXT-01.
- **Status vocab:** Passed, Blocked.
- **Affordances:** filter; node cards as links.
- **Icons:** dashboard, account_tree, group, warning, verified, insights, add, settings, tune, search, terminal, notifications, help, filter_list, bolt, check_circle, sync, pending, science, block.
- **Lifecycle:** Planning.

### 8.10 deployment_release_govintel_platform
- **Title:** `GovIntel Platform - Deployment & Release`
- **Purpose:** Release-readiness console for a release candidate: environments, pre-flight checks, migrations, snapshots, deployment timeline and sign-off.
- **Shell:** A + top bar (terminal); `Project Alpha`; breadcrumb (chevron_right) before H1.
- **Blocks:** page header "Release v2.4.1-rc3" + `Hold Release` (pause) / `Initiate Deployment` (rocket_launch) → "Environment Topologies" (ENV-STG-01 LIVE SYNC / ENV-PRD-01 AWAITING SYNC) → "Pre-Flight Checklist" (3 checks + 1 pending) → "Configuration Migrations" **table** (MIG-20231012-01..03) → "Snapshot Readiness" (PRD-DB-CLUSTER-MAIN, cloud_done) → "Deployment Timeline" (linear_scale) → `Sign Off` button.
- **Table:** `Migration ID | Type | Status`.
- **Entities:** ENV-STG-01, ENV-PRD-01, MIG-20231012-01/02/03, PRD-DB-CLUSTER-MAIN, v2.4.1-rc3.
- **Status vocab:** READY, VERIFIED, AWAITING APPROVAL, AWAITING SYNC, LIVE SYNC, EXECUTION PHASE, CURRENT STATUS.
- **Affordances:** hold/initiate/sign-off gated actions; checklist.
- **Icons:** search, terminal, notifications, help, dashboard, account_tree, group, warning, verified, insights, settings, tune, chevron_right, pause, rocket_launch, dns, fact_check, check_circle, pending, schema, backup, cloud_done, linear_scale.
- **Lifecycle:** Release.

### 8.11 document_viewer_govintel_platform
- **Title:** `GovIntel Platform - Document Viewer`
- **Purpose:** Rich-text document editor/viewer with governance metadata rail (status, ownership, related objects, versions).
- **Shell:** B + top bar rendered as **non-link divs** (Home… as `<div>`s); `Project Alpha`.
- **Blocks:** toolbar row: `Back to Directory` / `Discard Draft` / `Save Changes` → formatting toolbar (block-format select `Heading 1 | Heading 2 | Normal Text`, bold, italic, underline, bulleted/numbered lists) → document canvas ("System Architecture Overview" with sections "1. Introduction", "2. Core Components") → **right InspectorPanel**: "Document Status" (APPROVED), "Ownership", "Related Objects" (TSK-892 Implementation Plan, BUG-104 Latency Issues, DIR-Core Assets), "Version History".
- **Forms:** format select only.
- **Entities:** DOC-2023-A-094, TSK-892, BUG-104.
- **Status vocab:** APPROVED.
- **Affordances:** WYSIWYG editing, draft/save flow, related-object deep links.
- **Icons:** notifications, settings, help, add, dashboard, layers, group, warning, verified, analytics, download, archive, arrow_back, format_bold, format_italic, format_underlined, format_list_bulleted, format_list_numbered, check_circle, task, bug_report, folder.
- **Lifecycle:** Cross-cutting (documents).

### 8.12 documents_hub_govintel_platform
- **Title:** `Documents Hub - GovIntel Platform`
- **Purpose:** Project document library with upload, list/grid views and per-document status/version.
- **Shell:** B′ + top bar w/ "Search documents..." — **sidebar deviation: extra `Documents` (folder) item**; `Project Alpha`.
- **Blocks:** page header "Documents Hub" + `List | Grid` toggle + `Upload File` → documents **table** with file-type icons (description, article, picture_as_pdf) and row menus.
- **Table:** `Name | Status | Version | Modified | Actions`.
- **Status vocab:** APPROVED, DRAFT.
- **Affordances:** view toggle, upload, search, row menus.
- **Icons:** search, notifications, settings, help, add, dashboard, layers, folder, group, warning, verified, analytics, download, archive, upload, description, check_circle, more_vert, article, edit_document, picture_as_pdf.
- **Lifecycle:** Cross-cutting (documents).

### 8.13 evidence_govintel_platform
- **Title:** `Evidence Repository - GST Compliance Platform` *(GST branding)*
- **Purpose:** Repository of verification evidence artifacts linked to requirements/gates, with traceability map entry point.
- **Shell:** B′ — **no global top bar**; sidebar (nav-rendered) with extra `Documents` item; project label `Project Alpha` (as H1 — heading-level inconsistency); shield logo.
- **Blocks:** page header "Evidence Repository" + search "Search evidence..." + filter → featured evidence card "Q3 Infrastructure Security Audit Report" (PDF, owner, `View Details`) → "Traceability Map" card (`Open Full Map`) → "Recent Submissions" **table** with view_list/grid_view toggle → pagination.
- **Table:** `Artifact ID | Name & Type | Linked Requirement | Status | Actions` — rows ART-7490/91/92 → GST-REQ-112 (VERIFIED), GST-GATE-04 (FAILED), GST-REQ-088 (PENDING).
- **Entities:** ART-7490..7492, GST-REQ-088/099/112, GST-GATE-04.
- **Status vocab:** VERIFIED, FAILED, PENDING.
- **Affordances:** search, filter, list/grid toggle, pagination, requirement deep-links.
- **Icons:** shield, add, dashboard, layers, folder, warning, verified, analytics, download, archive, menu, search, filter_list, picture_as_pdf, person, arrow_forward, account_tree, view_list, grid_view, article, link, check_circle, cancel, image, code, pending, more_vert, chevron_left, chevron_right.
- **Lifecycle:** Verification.

### 8.14 execution_board_govintel_platform
- **Title:** `Execution Board - GovIntel Platform`
- **Purpose:** Kanban board of work items across the execution flow.
- **Shell:** A + top bar (terminal); `Project Alpha` (as H1).
- **Blocks:** page header "Execution Board" + `Filter` + `View` (view_kanban) → **kanban board, 5 columns**: `Backlog` (+add), `Ready`, `In Progress`, `Review`, `Done`; cards e.g. "Update tax rate tables for Q3 compliance" (GST-104), "Audit logs generation…" (GST-088), "Implement API endpoint for cross-border reconciliation" (GST-109, warning flag).
- **Tables/Forms:** none.
- **Entities:** GST-088, GST-104, GST-109.
- **Status vocab:** Backlog, Ready, In Progress, Review, Done, Blocked, High, Low.
- **Affordances:** filter, view switch, add-card per column, card menus (more_horiz) — kanban implies drag-and-drop.
- **Icons:** add, dashboard, account_tree, group, warning, verified, insights, settings, tune, search, terminal, notifications, help, filter_list, view_kanban, more_horiz.
- **Lifecycle:** Execution.

### 8.15 forecasts_estimates_govintel_platform
- **Title:** `Forecasts & Estimates - GovIntel` *(short brand)*
- **Purpose:** Predictive analytics: completion trajectory, budget forecast and risk trends, switchable between deterministic and ML-learned models.
- **Shell:** B + top bar w/ "Search platforms..."; `Project Alpha`.
- **Blocks:** page header "Forecasts & Estimates" + mode toggle `DETERMINISTIC | LEARNED PREDICTIONS` → "Completion Trajectory" chart (SVG, timeline icon) → "Budget Forecast" panel (labels: PROJECTED TOTAL, ESTIMATED SHORTFALL, BURN RATE, TARGET, VARIANCE, CONFIDENCE, ML PREDICTION, OCT 15) → "Risk Trends" (radar) with items "Vendor Integration", "Compliance Audit" (IMPACT PROBABILITY) → `VIEW FULL RISK REGISTER`.
- **Tables/Forms:** none.
- **Status vocab:** HIGH, MODERATE (risk levels).
- **Affordances:** model-mode segmented toggle; drill-through to risk register.
- **Icons:** search, notifications, settings, help, dashboard, layers, group, warning, verified, analytics, download, archive, timeline, account_balance, radar.
- **Lifecycle:** Discovery/Forecasting.

### 8.16 impact_analysis_govintel_platform
- **Title:** `GovIntel Platform - Impact Analysis`
- **Purpose:** Impact assessment of a change request (CR-8924): dependency blast radius, summary metrics, findings and per-module effort.
- **Shell:** A + top bar (terminal); no project label; **icon bug**: `Resources` uses account_tree.
- **Blocks:** page header "Impact Analysis" + `Export Report` / `Approve Change` → "Dependency Graph" (SVG) → "Impact Summary" stat chips (labels ARCHITECTURE / TASKS / BUDGET / PROPOSED CHANGE / CRITICAL IMPACT) → "Critical Findings" (gavel) → "Detailed Resource Impact" **table** + filter.
- **Table:** `MODULE | OWNER | ESTIMATED EFFORT | STATUS`.
- **Entities:** CR-8924.
- **Status vocab:** Approved, Blocked, Critical, HIGH, CRITICAL IMPACT.
- **Affordances:** approve action, export, filter.
- **Icons:** search, terminal, notifications, help, dashboard, account_tree, warning, verified, insights, settings, tune, trending_up, gavel, filter_list, check_circle.
- **Lifecycle:** Approval/Governance.

### 8.17 intake_wizard_govintel_platform
- **Title:** `Project Intake Wizard - GovIntel` *(short brand)*
- **Purpose:** Multi-step guided intake capturing project identity, architecture type (with confidence level) and objectives.
- **Shell:** **None** (focused wizard chrome: logo, close, `Save & Exit`). No top bar/sidebar.
- **Blocks:** wizard header "Project Intake" → "Intelligent Default Suggested" AI-hint callout (lightbulb) → **form section "Core Identity"** → **radio-card section "Project Architecture Type"** → confidence segmented buttons `I know | Not sure | Don't know` → **"Key Objectives"** textarea → footer `Cancel | Previous | Continue to Requirements`.
- **Form fields:**
  - `Project Name` — text, placeholder "e.g., Nexus Operations"
  - `Primary Domain` — select: Select Domain… / Defense & Intelligence / Public Infrastructure / Data Analytics / Internal Operations
  - Architecture type — 3 radio cards: `Web Application` ("Browser-based interface for distributed access"), `API / Microservice` ("Backend processing and data integration layers"), `Mobile Native` ("iOS/Android optimized field applications")
  - Confidence — 3-way segmented: I know / Not sure / Don't know
  - `Key Objectives` — textarea, placeholder "Describe the primary goals and expected outcomes of this initiative..."
- **Status vocab:** none.
- **Affordances:** wizard prev/next, save-and-exit, radio cards, AI suggestion.
- **Icons:** policy, close, lightbulb, expand_more, check_circle, web, api, smartphone, arrow_forward.
- **Lifecycle:** Idea/Intake.

### 8.18 integrations_govintel_platform
- **Title:** `Integrations - GovIntel` *(short brand)*
- **Purpose:** Catalogue of external tool connections (SCM, CI/CD, cloud, comms) with connect/configure/sync management.
- **Shell:** C + top bar; sidebar label "GovIntel" (H1) instead of project name; mobile menu icon.
- **Blocks:** page header "Integrations" + `Sync All` / `New Connection` → section "Source Control": GitHub Enterprise (`Configure`), GitLab (`Configure`, merge_type) → "CI/CD": Jenkins Pipeline (account_tree/schedule) → "Cloud Infrastructure": AWS GovCloud (cloud_done, `Manage Resources`) → "Communication": Slack (tag, `Install Integration`, add_circle).
- **Tables/Forms:** none.
- **Status vocab:** Planned (connection state); connected states implied by icons.
- **Affordances:** sync-all, per-integration configure/install/manage.
- **Icons:** dashboard, hub, security, payments, event, gavel, add, help_outline, analytics, menu, search, notifications, settings, sync, code, merge_type, build, account_tree, schedule, cloud, cloud_done, forum, tag, add_circle.
- **Lifecycle:** Cross-cutting/Admin.

### 8.19 landing_page_govintel_platform
- **Title:** `GovIntel Platform - Software Project Intelligence`
- **Purpose:** Marketing landing hero introducing the product and funneling into project creation.
- **Shell:** top bar only (with search "Search projects..." + terminal); no sidebar.
- **Blocks:** hero H1 "Turn your software idea into an executable engineering system." → CTAs `Start a Project` (arrow_forward) / `Explore how it works` (visibility) → feature icon grid (code, architecture, database, lightbulb, memory, rocket_launch).
- **Tables/Forms/Statuses:** none.
- **Icons:** settings_b_roll, search, terminal, notifications, help, arrow_forward, visibility, code, architecture, database, lightbulb, memory, rocket_launch.
- **Lifecycle:** Idea/Intake.

### 8.20 members_roles_govintel_platform
- **Title:** `Members & Roles - GovIntel` *(short brand)*
- **Purpose:** Team roster administration: membership, roles, project assignment and permission levels.
- **Shell:** C + top bar; `Project Alpha`; CTA `Add Milestone` (shell-C default, mismatched with page intent).
- **Blocks:** page header "Members & Roles" + `Invite External` (person_add) / `Add Member` → FilterBar: search "Search members...", select `All Roles` (Architect / Dev / PM / SecOps), select `All Projects` (Project Alpha / Project Beta) → members **table** with permission icons (admin_panel_settings, edit, visibility, shield_person) and row menus.
- **Table:** `Member | Role | Project Assignment | Permission Level | Actions`.
- **Status vocab:** none (permission levels expressed as icons).
- **Affordances:** search, role/project filters, invite flows, row menus.
- **Icons:** search, notifications, settings, add, dashboard, hub, security, payments, event, gavel, help_outline, analytics, person_add, person, admin_panel_settings, edit, shield_person, visibility, more_vert.
- **Lifecycle:** Cross-cutting/Admin.

### 8.21 milestones_govintel_platform
- **Title:** `Screen 17: MILESTONES - GST Compliance Platform` ⚠ *(leftover screen prefix + GST branding)*
- **Purpose:** Milestone detail (M3: Core Tax Engine Alpha) with evidence artifacts and acceptance criteria checklist.
- **Shell:** A + top bar (terminal); `Project Alpha`.
- **Blocks:** page header "M3: Core Tax Engine Alpha" (MILESTONE TRACKER overline, IN PROGRESS/COMPLETION chips) → "Overview" (calendar_today dates) → "Evidence Artifacts": "Github PR #4092 Merged to main" (code, open_in_new), "Security Audit Doc v1.2_final.pdf" (security, open_in_new) → "Acceptance Criteria" checklist: 1. Schema Validated ✓, 2. Calculation Core 100% Coverage ✓, 3. Security Review Pass (pending/sync).
- **Tables/Forms:** none.
- **Status vocab:** PASS, IN PROGRESS, COMPLETION.
- **Affordances:** external evidence links, criteria check states.
- **Icons:** dashboard, account_tree, group, warning, verified, insights, settings, tune, terminal, notifications, help, calendar_today, code, open_in_new, security, check_circle, done, pending, sync.
- **Lifecycle:** Planning.

### 8.22 my_projects_govintel_platform
- **Title:** `GovIntel - My Projects` *(short brand)*
- **Purpose:** Personal project portfolio with phase/health filtering and grid/list views.
- **Shell:** C + top bar w/ "Search projects..."; duplicate H1 (responsive); shell-C sidebar duplicated as drawer.
- **Blocks:** page header "My Projects" → FilterBar: select `All Phases` (Discovery / Planning / Execution / Operating), select `All Health` (Nominal / At Risk / Critical), grid_view/view_list toggle → project cards: "GST Compliance Platform" (check_circle, Nominal), "Urban Mobility Hub" (warning, At Risk), "Internal API Gateway" (pending) — each with more_vert menu + update timestamp.
- **Tables/Forms:** filter selects only.
- **Entities:** PRJ-7721, PRJ-8102, PRJ-9942.
- **Status vocab:** NOMINAL, AT RISK, Critical, DISCOVERY, EXECUTION, OPERATING.
- **Affordances:** phase/health filters, grid/list toggle, card menus.
- **Icons:** search, notifications, settings, add, dashboard, hub, security, payments, event, gavel, help_outline, analytics, expand_more, grid_view, view_list, check_circle, more_vert, update, warning, pending.
- **Lifecycle:** Cross-cutting/Admin (portfolio).

### 8.23 operations_govintel_platform
- **Title:** `Operations - GovIntel Platform`
- **Purpose:** Live operations command view: production load, incidents, service health, tech-debt/vulnerabilities and maintenance windows.
- **Shell:** A + top bar (terminal); `Project Alpha`.
- **Blocks:** page header "Operations Command" (SYSTEM NOMINAL banner) → KPI panels: "PRODUCTION LOAD" (speed; CLUSTER CPU, MEMORY I/O), "ACTIVE INCIDENTS" (error; INC-4920, INC-4921, SEV-1), "SERVICE HEALTH" (dns; 6-service check grid, 1 error) → "DEBT & VULNERABILITIES" **table** → "MAINTENANCE WINDOWS": "Database Index Rebuild", "OS Patching Cycle".
- **Table:** `ID | Component | Status` (T-882, T-901).
- **Entities:** INC-4920, INC-4921, SEV-1, T-882, T-901.
- **Status vocab:** SYSTEM NOMINAL, LIVE, BLOCKED, IN PROGRESS, CRITICAL DEBT ITEMS, SEV-1 VULNS.
- **Affordances:** none beyond nav (monitoring view).
- **Icons:** terminal, notifications, help, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, speed, error, dns, check_circle, security, pending, calendar_today.
- **Lifecycle:** Production/Operations.

### 8.24 organization_overview_govintel_platform
- **Title:** `Organization Overview - GovIntel` *(short brand)*
- **Purpose:** Executive portfolio dashboard: org-wide budget trajectory, project health, resource utilization and major risks.
- **Shell:** **top bar only — no sidebar** (unique among dashboard screens).
- **Blocks:** page header "Engineering Command" + scope toggle `Global | Regional | Local` → "Budget vs. Spend Trajectory" chart (SVG) → "Project Health Monitor" **table** + `View All Directory` → "Resource Utilization" → "Major Risks".
- **Table:** `Project ID | Name | Status | Burn Rate` (PRJ-092 ON TRACK, PRJ-104 DELAYED, PRJ-118 BLOCKED).
- **Entities:** PRJ-092, PRJ-104, PRJ-118.
- **Status vocab:** ON TRACK, DELAYED, BLOCKED, HIGH, MED.
- **Affordances:** scope segmented toggle, drill-through link.
- **Icons:** search, notifications, settings, more_horiz, check_circle, warning, schedule.
- **Lifecycle:** Cross-cutting/Admin (org).

### 8.25 organization_resources_govintel_platform
- **Title:** `Organization Resources - GovIntel` *(short brand)*
- **Purpose:** Org-level shared resources: cloud infrastructure, tool licenses and a registry of reusable architectural components.
- **Shell:** C + top bar w/ "Search resources..."; label `Project Alpha` (scope mismatch — org screen w/ project sidebar).
- **Blocks:** page header "Organization Resources" + **complexity toggle `Beginner | Professional | Enterprise`** → "Cloud Infrastructure" card (check state) → "Tool Subscriptions" (`Manage Licenses`) → "Reusable Architectural Components" **table** with type filter select (`All Types`: Auth / Database / UI).
- **Table:** `Component ID | Description | Maintainer | Usage | Status` (statuses STABLE / HEALTHY / BETA / DEPRECATED; construction icon).
- **Status vocab:** STABLE, HEALTHY, BETA, DEPRECATED.
- **Affordances:** complexity toggle, type filter, license management.
- **Icons:** search, notifications, settings, corporate_fare, dashboard, hub, security, payments, event, gavel, help_outline, analytics, add, cloud, check_circle, subscriptions, extension, filter_list, warning, construction.
- **Lifecycle:** Cross-cutting/Admin (org).

### 8.26 production_verification_govintel_platform
- **Title:** `Production Verification - GovIntel Platform`
- **Purpose:** Post-deployment verification report: deployment status, critical user journeys, security evidence and API/telemetry health.
- **Shell:** A + top bar (terminal); no project label.
- **Blocks:** page header "Production Verification" + `Download Report` / `Acknowledge` → "Deployment Status" (check + health_and_safety) → "Critical User Journeys" checklist (4 checks) → "Security & Network Evidence" (lock, policy, public; "HSTS / CSP OK") → "API Health & Logging" + "Telemetry Status" (receipt_long, show_chart, timeline).
- **Tables/Forms:** none.
- **Entities:** ENV-892.
- **Status vocab:** PASS, HSTS / CSP OK.
- **Affordances:** acknowledge action, report download.
- **Icons:** search, terminal, notifications, help, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, check_circle, health_and_safety, route, security, lock, policy, public, api, receipt_long, show_chart, timeline.
- **Lifecycle:** Release.

### 8.27 project_baselines_govintel_platform
- **Title:** `GovIntel Platform - Project Baselines`
- **Purpose:** Baseline management with earned-value variance tracking (SV/CV), S-curve and WBS-level EVM table; snapshot creation.
- **Shell:** A + top bar w/ "Search baselines..." (terminal); `Project Alpha` (as H1).
- **Blocks:** page header "Project Baselines" + `Export Report` / `Create Snapshot` → variance stat tiles: "Schedule Variance (SV)" (warning), "Cost Variance (CV)" (check), "Scope Changes" → "Cumulative Cost Curve (S-Curve)" chart (SVG) → "Work Breakdown Structure (WBS) Variance" **table** (folder/account_tree/dns row icons).
- **Table:** `WBS Element | Status | BAC | EV | CPI`.
- **Entities:** EVM terms BAC, EV, CPI, SV, CV; Q3 2023.
- **Status vocab:** Approved, COMPLETE, DELAYED, IN PROGRESS.
- **Affordances:** snapshot creation (Baseline = snapshot), export.
- **Icons:** dashboard, account_tree, group, warning, verified, insights, settings, tune, search, terminal, notifications, help, download, add, check_circle, folder, dns.
- **Lifecycle:** Planning/Control.

### 8.28 project_feasibility_govintel_platform
- **Title:** `GST Compliance Platform - Project Feasibility` *(GST branding)*
- **Purpose:** Feasibility verdict for an intake: overall assessment, constraints, assumptions, per-dimension breakdown and approve/revise decision.
- **Shell:** A + top bar (terminal); `Project Alpha`; breadcrumb chevron.
- **Blocks:** H1 "PROJECT FEASIBILITY" → "Overall Assessment Status" verdict card: **FEASIBLE WITH RISK** (warning) → "Major Constraints" (gavel, event_busy) → "Key Assumptions" (psychology, api) → "Dimensional Breakdown" + `VIEW RAW DATA` — dimension rows: budget ✓ (account_balance_wallet), schedule ⚠, team ✓ (group), architecture ✓, build ⚠ → "Recommendation" panel: `APPROVE WITH MITIGATION` (play_arrow) / `REQUEST REVISION` (assignment_return).
- **Tables/Forms:** none.
- **Entities:** CMP-004.
- **Status vocab:** FEASIBLE WITH RISK, APPROVE WITH MITIGATION, REQUEST REVISION.
- **Affordances:** approve/revise decision, raw-data drill-down.
- **Icons:** account_tree, add, dashboard, group, warning, verified, insights, settings, tune, search, terminal, notifications, help, chevron_right, gavel, event_busy, psychology, api, account_balance_wallet, check_circle, schedule, architecture, build, assistant_direction, play_arrow, assignment_return.
- **Lifecycle:** Discovery/Feasibility.

### 8.29 project_handover_govintel_platform
- **Title:** `GST Compliance Platform - Handover` *(GST branding)*
- **Purpose:** Final handover checklist and sign-off gate transferring the completed system to its owner.
- **Shell:** C + top bar w/ "Search architecture..."; `Project Alpha`; shield logo.
- **Blocks:** page header (H1 = "GST Compliance Platform", hourglass state) → checklist groups: "Requirements Validation" (fact_check, ✓ GATE PASSED), "Testing & Security Resolution" (bug_report, ✓), "Administration & Documentation" (folder_managed, pending) → "Final Handover Sign-off" panel (verified): `Sign & Approve Handover` (lock) + "Transfer Meta-Data".
- **Tables/Forms:** none.
- **Entities:** SYS.ID // G-COMP-992, GST-PLAT-V1, PROD-CLUSTER-A.
- **Status vocab:** GATE PASSED, PASS, BLOCKED, IN PROGRESS.
- **Affordances:** gated sign-off button (locked until checklist complete).
- **Icons:** shield, search, notifications, settings, account_tree, dashboard, hub, security, payments, event, gavel, help_outline, analytics, add, hourglass_empty, fact_check, check_circle, bug_report, folder_managed, pending, verified, lock.
- **Lifecycle:** Completion/Archive.

### 8.30 project_health_govintel_platform
- **Title:** `GovIntel Platform - Project Health`
- **Purpose:** Seven-dimension project health scorecard plus the active risk register.
- **Shell:** B + top bar — **sidebar item order scrambled** (Analytics precedes Overview).
- **Blocks:** page header "Project Health" → 7 dimension cards: Security ✓, Budget (error), Schedule (info), Scope ✓ (fact_check), Quality ✓ (high_quality), Resources ⚠ (group_work), Dependencies ✓ (account_tree) → "Risk Register (Active)" **table**.
- **Table:** `ID | Description | Severity | Mitigation` (RSK-042, RSK-048).
- **Status vocab:** NOMINAL, AT RISK, STRAINED, STABLE, CLEAR, MONITOR, HIGH, MEDIUM, COMPLIANCE, VULNERABILITIES.
- **Affordances:** none beyond nav (scorecard view).
- **Icons:** add, analytics, dashboard, layers, group, warning, verified, download, archive, notifications, settings, help, security, check_circle, account_balance_wallet, error, calendar_month, info, fact_check, high_quality, group_work, account_tree.
- **Lifecycle:** Execution (monitoring).

### 8.31 project_settings_govintel_platform
- **Title:** `GovIntel - Project Settings` *(short brand)*
- **Purpose:** Project administration: metadata, access control, data export and lifecycle (archive/delete).
- **Shell:** C + top bar; `Project Alpha`; mobile drawer dupe w/ stray H1 "GovIntel".
- **Blocks:** page header "Project Settings" → **form "Metadata Configuration"** → **radio group "Access Control"** → "Data Export" buttons `Export PDF | Export JSON | Export CSV` → "Lifecycle Controls" danger zone: "Archive Project" (`Archive`), "Delete Project" (`Delete`).
- **Form fields:**
  - `Project Name` — text
  - `Project Description` — textarea
  - `Primary Department` — select: Revenue & Taxation / Auditing / Legal Compliance
  - `Project Identifier (UUID)` — text (read-only w/ copy icon)
  - Access Control — radios: `Private` ("Only specific invited members."), `Internal (Gov)` ("Anyone with a verified .gov domain."), `Public` ("Visible to external stakeholders.")
- **Status vocab:** none.
- **Affordances:** save changes, copy UUID, export formats, archive/delete confirmations implied.
- **Icons:** dashboard, hub, security, payments, event, gavel, help_outline, analytics, menu, notifications, settings, edit_document, content_copy, shield_lock, download, picture_as_pdf, data_object, table_view, warning.
- **Lifecycle:** Cross-cutting/Admin.

### 8.32 project_specification_govintel_platform
- **Title:** `GovIntel - Project Specification` *(short brand)*
- **Purpose:** Generated engineering specification document with pipeline-gate status and version history.
- **Shell:** C + top bar; no project label.
- **Blocks:** page header "Project Specification" + `Export` → spec document view with mono/code affordances (data_object, content_copy, unfold_more collapsible sections) → "Pipeline Gates" status strip (2 × check_circle, 1 × error) → "Version History".
- **Tables/Forms:** none.
- **Entities:** CP-2024, SEC-0042, AES-256.
- **Status vocab:** PASS, FAIL, VALIDATED.
- **Affordances:** export, copy blocks, expand/collapse sections.
- **Icons:** search, notifications, settings, add, dashboard, hub, security, payments, event, gavel, help_outline, analytics, download, data_object, content_copy, unfold_more, check_circle, error.
- **Lifecycle:** Planning (spec artifact).

### 8.33 quality_gates_govintel_platform
- **Title:** `Quality Gates - GST Compliance Platform` *(GST branding)*
- **Purpose:** Sequential lifecycle quality gates with per-gate status, evidence links and audit trails; blocked gate surfaces its blocker.
- **Shell:** A + top bar w/ "Search gates..." (terminal); `Project Alpha`; hub logo.
- **Blocks:** page header "Quality Gates" → gate cards in sequence:
  1. "Requirements Gate" — PASS ✓, evidence link `BRD_v1.4.pdf`, `View Audit Trail`
  2. "Architecture Gate" — PASS ✓, evidence `SAD_Final.docx`, `View Audit Trail`
  3. "Development Gate" — **BLOCKED** (error) with "Critical Blocker Identified" callout → `Review ADL-14`
  4. "Testing Gate" — NOT READY (schedule + lock; gated until prior passes).
- **Tables/Forms:** none.
- **Entities:** ADL-14; artifacts BRD_v1.4.pdf, SAD_Final.docx.
- **Status vocab:** PASS, BLOCKED, NOT READY, Approved.
- **Affordances:** evidence links, audit trail drill-down, blocker review.
- **Icons:** search, terminal, notifications, help, hub, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, description, check_circle, link, arrow_forward, architecture, code, error, report, edit_document, schedule, lock.
- **Lifecycle:** Approval/Governance (gates).

### 8.34 recommendations_exceptions_govintel_platform
- **Title:** `Recommendations & Exceptions - GovIntel Platform`
- **Purpose:** Critical exception feed with per-exception resolution actions and acknowledge-all.
- **Shell:** B + top bar; no project label; CTA `New Task`.
- **Blocks:** H1 "CRITICAL EXCEPTIONS" + `Filter` / `Acknowledge All` → exception cards: "Structural Integrity Review" (block → `Resolve`), "Quality Assurance: Thermal Tolerance" (cancel → `Review Data`), "Procurement: Titanium Alloy" (trending_up → `Adjust`).
- ⚠ **Content mismatch:** card copy is aerospace/manufacturing-flavored, not software governance — structure is reusable, copy must be rewritten.
- **Tables/Forms:** none.
- **Status vocab:** Blocked, CRITICAL EXCEPTIONS.
- **Affordances:** filter, bulk acknowledge, per-card resolve actions.
- **Icons:** notifications, settings, help, dashboard, layers, group, warning, verified, analytics, download, archive, block, arrow_forward, cancel, trending_up.
- **Lifecycle:** Cross-cutting (alerts).

### 8.35 requirements_govintel_platform
- **Title:** `GST Compliance Platform - Requirements` *(GST branding)*
- **Purpose:** Requirements register with typed IDs, status and traceability coverage, exportable as a matrix.
- **Shell:** A + top bar w/ "Search requirements..." (terminal, person avatar); no project label.
- **Blocks:** page header "Requirements Traceability" + `Export Matrix` / `New Requirement` → summary stat chips (list_alt, check_circle) → filter chip row: `All Types` (dropdown), `Status: Draft`, `Missing Links (18)` → requirements **table** (type icons per row: domain=business, functions=functional, speed=non-functional, security) → pagination `1 2 3`.
- **Table:** `Req ID | Description | Type | Status | Traceability | Actions`.
- **Entities:** BR-1, FR-12, NFR-3, SR-5 (typed requirement ID scheme: BR/FR/NFR/SR), AES-256.
- **Status vocab:** APPROVED, DRAFT, VERIFIED, MISSING LINK.
- **Affordances:** type/status/missing-link filters, pagination, export matrix, new requirement.
- **Icons:** search, terminal, notifications, help, person, account_tree, add, dashboard, group, warning, verified, insights, settings, tune, download, list_alt, check_circle, arrow_drop_down, domain, functions, speed, security, edit_document, more_horiz, chevron_left, chevron_right.
- **Lifecycle:** Planning.

### 8.36 retrospective_govintel_platform
- **Title:** `GovIntel - Retrospective` *(short brand)*
- **Purpose:** Post-project retrospective: variance metrics, successful decisions, failed assumptions and lessons learned with follow-up actions.
- **Shell:** C + top bar; `Project Alpha`; drawer dupe.
- **Blocks:** page header "Retrospective & Lessons Learned" + `Export Report` → stat panels "Budget vs Actual Variance" (monitoring, trending_up) and "Schedule Delta" (schedule, warning) → "Successful Decisions": "AI Coding Agents for Unit Tests" (smart_toy), "Schema-First API Design" (dataset) → "Failed Assumptions": "Vendor API Stability" (api), "Stakeholder Availability" (group) → "Lessons Learned & Action Items": "Mandate Interface Agreements" → `Assign Owner`; "Standardize AI Test Gen" → `Create Ticket`; "Decouple UAT Schedules" → `Update Runbook`.
- **Tables/Forms:** none.
- **Entities:** GOV-LL-01, GOV-LL-02, GOV-LL-03 (lessons-learned IDs); CONFIDENTIAL tag.
- **Status vocab:** Planned, CONFIDENTIAL.
- **Affordances:** export, per-lesson action creation.
- **Icons:** notifications, settings, dashboard, hub, security, payments, event, gavel, help_outline, analytics, monitoring, trending_up, schedule, warning, check_circle, smart_toy, dataset, cancel, api, group, lightbulb, arrow_forward.
- **Lifecycle:** Completion/Archive.

### 8.37 risks_blockers_govintel_platform
- **Title:** `Screen 24: RISKS & BLOCKERS` ⚠ *(leftover screen prefix, no product suffix)*
- **Purpose:** Active blockers surface plus the full risk register with probability/impact/status.
- **Shell:** A + top bar (terminal); `Project Alpha`; drawer dupe with stray H1 "GovIntel Platform".
- **Blocks:** page header "Risks & Blockers" → "Active Blockers" card: "Security Audit delay" (warning, BLK-9942, `View Details`) → "Risk Register" **table** (view_list) with filter + download.
- **Table:** `Risk ID | Description | Probability | Impact | Status` (RSK-0892 Active/monitoring, RSK-1104 MITIGATED ✓).
- **Entities:** BLK-9942, RSK-0892, RSK-1104.
- **Status vocab:** Active, MITIGATED, HIGH, MEDIUM, LOW, HIGH IMPACT.
- **Affordances:** filter, export/download, blocker drill-down.
- **Icons:** add, dashboard, account_tree, group, warning, verified, insights, settings, tune, terminal, notifications, help, block, view_list, filter_list, download, monitoring, check_circle.
- **Lifecycle:** Execution (risk mgmt).

### 8.38 roadmap_govintel_platform
- **Title:** `GovIntel Platform - Project Roadmap`
- **Purpose:** Lifecycle roadmap: phase sequence with gates between phases and current operational focus.
- **Shell:** A + top bar (terminal); `Project Alpha`; rocket logo.
- **Blocks:** H2 "PROJECT ROADMAP" → "Lifecycle Status Summary" (autorenew/target chips) → "Active Operations" → "Phase Sequence & Gates" horizontal track: `Discovery` → `Requirements` → `Architecture` (gate: gavel ✓) → `Planning` → `Development` (sync = in progress) → `Testing` (gate: gavel, bug_report) → `Security Audit` (hourglass = upcoming).
- **Tables/Forms:** none.
- **Entities:** PHASE-05-EXE.
- **Status vocab:** COMPLETE, IN PROGRESS, PENDING, UPCOMING, PASS, Done.
- **Affordances:** phase/gate drill-down implied.
- **Icons:** rocket_launch, dashboard, account_tree, group, warning, verified, insights, add, settings, tune, terminal, notifications, help, autorenew, target, gavel, check_circle, sync, pending, bug_report, hourglass_empty.
- **Lifecycle:** Planning.

### 8.39 save_project_govintel_platform
- **Title:** `Save Project - GovIntel` *(short brand)*
- **Purpose:** Account-creation gate to persist an anonymous draft project (auth wall).
- **Shell:** **None** — split layout: left brand pane (aside), right auth form; close icon.
- **Blocks:** left pane: H1 "Keep your project." + value props "Data Persistence" (cloud_sync), "Secure Collaboration" (group_add) → right: H2 "Create an account" **form** → `Save Project & Continue` (arrow_forward) → `Sign in` link → `Terms of Service` / `Privacy Policy` links.
- **Form fields:** `Corporate Email` — email, placeholder "name@organization.gov" (mail icon); `Password` — password (lock icon).
- **Status vocab:** none.
- **Affordances:** auth submit, sign-in switch, dismiss (close).
- **Icons:** account_balance, folder_managed, cloud_sync, group_add, mail, lock, arrow_forward, close.
- **Lifecycle:** Idea/Intake.

### 8.40 scenario_planning_govintel_platform
- **Title:** `GovIntel Platform - Scenario Planning`
- **Purpose:** Side-by-side comparison of delivery scenarios (team size/cost/time) with risk assessment and apply-selection.
- **Shell:** B sidebar; **no global top-nav links** (only notifications/settings icons); `Project Alpha`.
- **Blocks:** page header "Scenario Planning" + `Export Models` / `Apply Selected` → scenario card "Lean Execution" (MODEL_A, group icon, "Risk Assessment") vs scenario card "Scaled Delivery" (MODEL_B, groups icon, "Risk Assessment", RECOMMENDED badge).
- **Tables/Forms:** none.
- **Status vocab:** MODEL_A, MODEL_B, RECOMMENDED.
- **Affordances:** scenario selection + apply, export.
- **Icons:** notifications, settings, add, dashboard, layers, group, warning, verified, analytics, download, archive, groups.
- **Lifecycle:** Discovery/Feasibility.

### 8.41 security_govintel_platform
- **Title:** `GovIntel Platform - Security Posture`
- **Purpose:** Security posture dashboard: release-blocker alert, auth/data-protection/dependency panels and open vulnerability register.
- **Shell:** B + top bar; `Project Alpha`; drawer dupe.
- **Blocks:** page header "Security Posture" (update timestamp) → alert banner "Critical Release Blocker Detected" (error) + `View Details` / `Acknowledge` → posture cards: "Authentication" (key), "Data Protection" (shield; AES-256, TLS 1.3), "Dependencies" (account_tree, `Run Scan`) → "Open Vulnerabilities" **table** + filter + download.
- **Table:** `ID | Component | Severity | Status | Mitigation | Action` (rows CVE-2023-ABC, CVE-2023-XYZ, SAST-992; action buttons `Review`).
- **Entities:** CVE-2023-ABC, CVE-2023-XYZ, SAST-992, AES-256, TLS 1.3, US-EAST-1.
- **Status vocab:** CRIT, CRITICAL, HIGH, MED, MEDIUM, Open, In Progress, Review, AT RISK, HEALTHY, Active.
- **Affordances:** acknowledge, run scan, filter, export, per-row review.
- **Icons:** add, dashboard, layers, group, warning, verified, analytics, download, archive, notifications, settings, help, update, error, key, shield, account_tree, bug_report, filter_list.
- **Lifecycle:** Verification.

### 8.42 start_project_govintel_platform
- **Title:** `Start New Project - GovIntel Platform`
- **Purpose:** Minimal idea-capture entry point: describe the idea in free text, let AI analyze, or import an existing spec.
- **Shell:** **None** (centered focus layout).
- **Blocks:** H1 "What are you planning?" → textarea (placeholder "e.g., I want to build a SaaS for medical inventory management...") → `Analyze Project Idea` (auto_awesome) → `Import existing spec` (upload_file) → recent drafts links: "Project Alpha - Initial Phase (2 hrs ago)", "Urban Mobility Subsystem (1 day ago)".
- **Form:** single textarea.
- **Status vocab:** none.
- **Affordances:** AI analyze, file import, draft resume links.
- **Icons:** auto_awesome, upload_file, draft.
- **Lifecycle:** Idea/Intake.

### 8.43 task_detail_govintel_platform
- **Title:** `GST Compliance Platform - Task Detail` *(GST branding)*
- **Purpose:** Task detail slide-over panel opened over the WBS: description, traceability vectors and implementation status/commits.
- **Shell:** A sidebar; **no global top-nav**. Background page = "Work Breakdown Structure"; right **InspectorPanel** = the task.
- **Blocks:** background H1 "Work Breakdown Structure" → slide-over: H2 "Implement IGST Calculation" (TSK-553, close icon) → "Description" → "Traceability Vectors" (links up to requirement R-101 / component C-44, description/schema/visibility icons) → implementation status rows (terminal/code, check_circle PASS / pending) → `View Commit Log`.
- **Tables/Forms:** none.
- **Entities:** TSK-553, R-101, C-44.
- **Status vocab:** PASS, PENDING.
- **Affordances:** slide-over close, trace links, commit log link.
- **Icons:** hexagon, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, close, arrow_forward, description, schema, visibility, terminal, check_circle, code, pending.
- **Lifecycle:** Execution.

### 8.44 team_resources_govintel_platform
- **Title:** `GovIntel Platform - Team & Resources`
- **Purpose:** Resource allocation across human and AI-agent resources, with a detail panel per resource.
- **Shell:** B + top bar; `Project Alpha`; breadcrumb chevron.
- **Blocks:** page header "Resource Allocation" + `Grid | List` toggle → resource cards: human "Dr. Elena Rostova" (person, HUM tag), AI agent "Claude-3-Opus" (smart_toy/memory) → "Resource Details" **InspectorPanel** (close): selected resource "Claude-3-Opus" → "Current Mandate" → `Reassign` / `View Logs`.
- **Tables/Forms:** none.
- **Entities:** resource typing HUM (vs AI); named agent Claude-3-Opus.
- **Status vocab:** HUM, High (allocation).
- **Affordances:** grid/list toggle, resource select → detail panel, reassign.
- **Icons:** search, notifications, settings, help, dashboard, layers, group, warning, verified, analytics, download, archive, chevron_right, grid_view, list, person, smart_toy, memory, close.
- **Lifecycle:** Planning (resourcing).

### 8.45 testing_verification_govintel_platform
- **Title:** `GovIntel Platform - Testing & Verification`
- **Purpose:** Test execution dashboard: coverage/status/defect KPIs, per-category execution table and recent requirement-level failures with evidence links.
- **Shell:** B + top bar; `Project Alpha`; breadcrumb chevron.
- **Blocks:** page header "Testing & Verification" + `RUN ALL` (play_arrow) → KPI tiles: "GLOBAL CODE COVERAGE" (arrow_upward trend), "EXECUTION STATUS" (TOTAL TESTS RUN), "CRITICAL DEFECTS" (+ `VIEW JIRA`) → "Test Execution by Category" **table** (rows: unit=code_blocks ✓, integration=integration_instructions ✗, e2e=route pending, performance=speed ✓, security=security ✓) → "Recent Requirement Failures": REQ-GST-1042 "Tax Calculation API Integration" and REQ-AUTH-091 "MFA Token Validation", each with `Evidence Log` link.
- **Table:** `CATEGORY | EXECUTION RATE | PASS RATE | TOTAL / FAILED | STATUS`.
- **Entities:** REQ-GST-1042, REQ-AUTH-091; JIRA.
- **Status vocab:** PASS, FAIL, RUNNING, ACTIVE, EXECUTION PHASE.
- **Affordances:** run-all trigger, Jira link, evidence links; chart (SVG).
- **Icons:** notifications, settings, help, account_tree, dashboard, layers, group, warning, verified, analytics, download, archive, chevron_right, play_arrow, arrow_upward, code_blocks, check_circle, integration_instructions, cancel, route, pending, speed, security, link.
- **Lifecycle:** Verification.

### 8.46 timeline_govintel_platform
- **Title:** `GST Compliance Platform - Timeline & Calendar` *(GST branding)*
- **Purpose:** Schedule management as a month-scale gantt with phase bars and milestone markers, switchable to calendar view.
- **Shell:** A + top bar (terminal); `Project Alpha` (as H1).
- **Blocks:** page header "Schedule Management" + view toggle `Timeline` (timeline icon) `| Calendar` (calendar_month) → gantt canvas: month axis Jan–Dec; phase bar "Dev Phase (Jul 1 – Sep 30)"; milestone markers "Mar 1", "Jun 10 (Active)", "Nov 15 (Hard Deadline) — Regulatory Submission"; status icons (check ×2, clock_loader_40, pending, warning, flag). *Bars are presentational divs — verify visual details against screen.png.*
- **Tables/Forms:** none.
- **Status vocab:** Scheduled, (Active), (Hard Deadline).
- **Affordances:** timeline/calendar toggle.
- **Icons:** dashboard, account_tree, group, warning, verified, insights, add, settings, tune, search, terminal, notifications, help, timeline, calendar_month, check_circle, clock_loader_40, pending, flag.
- **Lifecycle:** Planning.

### 8.47 today_govintel_platform
- **Title:** `GovIntel Platform - Focus Mode`
- **Purpose:** Personal "today" view: single active task hero plus a prioritized queue.
- **Shell:** A + top bar w/ "Search resources..." (terminal); `Project Alpha`.
- **Blocks:** page header "Focus Mode" → hero card "Review Tax Logic Implementation" (`Continue Task`, play_arrow; chips ACTIVE TASK, METRIC, T-MINUS 1D, PR_442; checklist/warning/flag icons) → "Your Priorities Queue" list (arrow_forward rows).
- **Tables/Forms:** none.
- **Entities:** PR_442.
- **Status vocab:** ACTIVE TASK, BLOCKED, T-MINUS 1D.
- **Affordances:** continue-task CTA, queue navigation.
- **Icons:** search, terminal, notifications, help, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, play_arrow, checklist, flag, arrow_forward.
- **Lifecycle:** Execution.

### 8.48 traceability_govintel_platform
- **Title:** `Screen 26: REQUIREMENT TRACEABILITY` ⚠ *(leftover screen prefix, no product suffix)*
- **Purpose:** End-to-end traceability board: requirement → architecture → work → test → release, exposing missing links.
- **Shell:** A + top bar (terminal); no project label.
- **Blocks:** page header "Requirement Traceability" → 5-column trace board (SVG connectors):
  - `Requirement`: FR-15 "Compliance Reporting" ✓, BR-1 "Audit Log Capture" ⚠
  - `Architecture`: ARC-04 "Data Pipeline Service", ARC-12 "Logging Cluster DB"
  - `Work`: TSK-89 "Impl API endpoint", TSK-90 "Schema migration", TSK-112 "Setup Elastic Node"
  - `Test`: TC-404 "E2E Sync Test" (✓/warning: MISSING TEST)
  - `Release`: "Q3 Feature Pack" (rocket_launch)
- **Tables/Forms:** none.
- **Entities:** FR-15, BR-1, ARC-04, ARC-12, TSK-89, TSK-90, TSK-112, TC-404.
- **Status vocab:** TRACED, MISSING, MISSING TEST, DONE, IN PROG.
- **Affordances:** node cards as links.
- **Icons:** dashboard, account_tree, group, warning, verified, insights, settings, tune, search, terminal, notifications, help, check_circle, database, rocket_launch.
- **Lifecycle:** Verification (traceability).

### 8.49 work_breakdown_govintel_platform
- **Title:** `Work Breakdown - GST Compliance Platform` *(GST branding)*
- **Purpose:** Hierarchical WBS tree (project → workstream/epic → task → subtask) with status chips and tree/list views.
- **Shell:** A + top bar w/ "Search architecture, nodes..." (terminal); `Project Alpha`; breadcrumb chevron; menu icon.
- **Blocks:** page header "Work Breakdown Structure" + `Tree | List` toggle + filter → expandable tree (expand_more per level; tree-line connectors): PRJ-9012 (folder_special) → workstream WS-BE-01 (schema) → epic EPC-1104 (engineering) → milestone (flag) → board node (view_kanban ✓) → task TSK-8821/8822 (assignment; edit_note) → subtask SUB-4011 "Unit test for inter-state transfers" (radio_button_unchecked, chip `TODO`).
- **Tables/Forms:** none.
- **Entities:** PRJ-9012, WS-BE-01, EPC-1104, TSK-8821, TSK-8822, SUB-4011, GST-2024-Q3, PHS-DEV, MS-CTE-A, API-V2.
- **Status vocab:** TODO, IN_PROG, DONE, ACTIVE, WBS.
- **Affordances:** expand/collapse tree, tree/list toggle, filter, inline edit (edit_note).
- **Icons:** menu, dataset, add, dashboard, account_tree, group, warning, verified, insights, settings, tune, search, terminal, notifications, help, chevron_right, view_list, filter_list, expand_more, folder_special, schema, engineering, flag, view_kanban, check_circle, assignment, radio_button_unchecked, edit_note, check.
- **Lifecycle:** Planning.

### 8.50 workload_capacity_govintel_platform
- **Title:** `Workload & Capacity - GovIntel Platform`
- **Purpose:** Team workload/capacity analytics with an 8-month utilization heatmap per resource role.
- **Shell:** B + top bar; no project label; menu icon.
- **Blocks:** page header "Workload & Capacity" + density toggle `Enterprise | Professional` (⚠ only 2 of the 3 canonical modes rendered) → KPI tiles (schedule, assignment_turned_in, warning, trending_up) → "Resource Utilization Heatmap" **table** (cells are heat-colored).
- **Table:** `Resource Role | M1 (Jan) | M2 (Feb) | M3 (Mar) | M4 (Apr) | M5 (May) | M6 (Jun) | M7 (Jul) | M8 (Aug)`.
- **Status vocab:** none textual (heat colors carry the signal).
- **Affordances:** density toggle; heatmap cells implied interactive.
- **Icons:** menu, notifications, settings, help, account_tree, dashboard, layers, group, warning, verified, analytics, download, archive, schedule, assignment_turned_in, trending_up.
- **Lifecycle:** Planning (capacity).

---

## 9. Domain Vocabulary (union)

**Core nouns:** Project, Phase, Milestone, Quality Gate, Baseline (snapshot), Requirement, Change Request, Impact Analysis, WBS (Workstream / Epic / Task / Subtask), Evidence / Artifact, Traceability (Vector / Matrix / Map), Decision, Assumption, Unknown, Risk, Blocker, Incident, Vulnerability, Release, Deployment, Environment, Migration, Handover, Retrospective / Lesson Learned, Scenario / Model, Resource (Human `HUM` / AI agent), Integration, Complexity mode.

**ID schemes observed:** PRJ-, PHS-, MS-/M{n}, GATE-, REQ-/BR-/FR-/NFR-/SR-, CR-, TSK-, SUB-, EPC-, WS-, ARC-, TC-/TST-, ART-, DOC-, DIR-, BUG-, RSK-, BLK-, DEC-, ASM-, UNK-, INC-, SEV-, CVE-, SAST-, MIG-, ENV-, LI-, LL-/GOV-LL-, ADL-, CMP-/COMP-, EXT-, CFG-, PR_/PR #.

**Status vocabularies by family:**
- **Gates:** PASS / FAIL / BLOCKED / EXCEPTION / NOT READY / GATE PASSED / VALIDATED
- **Work items:** TODO / Backlog / Ready / IN_PROG / In Progress / Review / Done / DONE / ACTIVE
- **Approvals:** PENDING / PENDING REVIEW / APPROVED / REJECTED / DEFER / AWAITING APPROVAL / SIGNED-off
- **Health (RAG-ish):** NOMINAL / HEALTHY / ON TRACK / STABLE / CLEAR ↔ AT RISK / STRAINED / MONITOR / SLIGHT DELAY / DELAYED ↔ CRITICAL / BLOCKED / OFF states
- **Docs:** DRAFT / APPROVED
- **Evidence/tests:** VERIFIED / FAILED / PENDING / RUNNING / MISSING LINK / MISSING TEST / TRACED
- **Risk:** Active / MITIGATED / HIGH / MEDIUM / LOW
- **Severity:** CRIT / HIGH / MED / LOW / SEV-1
- **Components/assets:** STABLE / HEALTHY / BETA / DEPRECATED / LIVE / Planned
- **Audit actions:** CREATE / UPDATE / DELETE
- **Lifecycle phases:** Discovery / Planning / Execution / Operating (+ roadmap phases Discovery→Requirements→Architecture→Planning→Development→Testing→Security Audit)

---

## 10. Build Recommendations (summary)

1. Build **one AppShell** (TopNav + Sidebar) with the sidebar item-set driven by scope (project vs org) — do not replicate the 3 shell forks or the 8 per-screen deviations.
2. Canonicalize branding to **"GovIntel Platform"**; keep "GST Compliance Platform" only as seed/demo project data; strip the 3 `Screen NN:` titles.
3. Extract the §5 component library in rank order; DataTable + StatusChip + PageHeader + FilterBar cover the majority of screens.
4. Adopt one canonical `tailwind.config` (colors are already identical); **resolve the radius-scale conflict with DESIGN.md** (esp. `rounded-full`).
5. Design **EmptyState and Modal** net-new — no export contains them, but every table/list screen will need empty/loading states.
6. Rewrite `recommendations_exceptions` copy into the software-governance domain.
7. The Complexity (Beginner/Professional/Enterprise) switch appears both as a nav destination (shell A) and as inline segmented controls — implement as a global density context, not a page.
