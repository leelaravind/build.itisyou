# DESIGN SCREEN MAP

**Date:** 2026-08-31
**Contract refs:** `MASTER_IMPLEMENTATION_PLAN.md` §4.2 and §24, `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §3.5
**Status:** Phase 0 — routes and components are the *planned* target; status columns are updated as
implementation proceeds.

---

## 1. Reconciliation summary

| | Count |
|---|---:|
| Locked screens in plan §24 | **64** |
| Design exports supplied | **50** |
| Exports mapping 1:1 to a locked screen | **50** |
| Exports with no locked-screen counterpart | **0** |
| Locked screens with **no** export — must be DERIVED | **14** |

Every supplied export corresponds to exactly one locked screen. Nothing in the export is orphaned, and
nothing is discarded. The 14 gaps are concentrated in three predictable clusters: the mid-intake and
AI-import flow, two auth/preference utility screens, and the entire mobile set.

### 1.1 The 14 derived screens

| # | Locked screen | Cluster | Derivation basis |
|---:|---|---|---|
| 4 | Resources & Constraints | Intake | Extends `intake_wizard` — same wizard chrome, stepper, field patterns |
| 5 | What We Know | Intake | Confirmed/assumed/unknown summary; reuses status-chip vocabulary from `requirements` |
| 6 | Missing Information | Intake | Exception-first list pattern from `recommendations_exceptions` |
| 8 | Import AI Response | AI interchange | Paste/upload surface; reuses form + dropzone patterns from `evidence` |
| 9 | Import Validation | AI interchange | Validation-result list; reuses severity/status patterns from `quality_gates` |
| 10 | Generated Project Preview | AI interchange | Read-only composite of `work_breakdown` + `roadmap` + `budget_cost_control` summaries |
| 51 | Login | Auth | Direct sibling of `save_project` (which is the signup surface) |
| 56 | Preferences | Admin | Direct sibling of `project_settings` — same settings-form chrome |
| 59 | Mobile Project Home | Mobile | Responsive derivation of `command_center` |
| 60 | Mobile Today | Mobile | Responsive derivation of `today` |
| 61 | Mobile Task Detail | Mobile | Responsive derivation of `task_detail` |
| 62 | Mobile Approval | Mobile | Responsive derivation of `approvals_sign_offs` |
| 63 | Mobile Project Health | Mobile | Responsive derivation of `project_health` |
| 64 | Mobile Notifications | Mobile | New surface; reuses list + status-chip primitives |

Per gap-spec §3.5, each is built from the established design system, reuses existing primitives,
preserves navigation and visual language, and is marked **DERIVED** — never invented as a new visual
language. The mobile six are responsive treatments of existing screens rather than separate pages,
except Mobile Notifications which has no desktop counterpart in the export.

> **Note on the design-system spec.** `technical_precision_command/` is not a screen. It is the token
> specification (`DESIGN.md`) and is consumed by `docs/DESIGN_HANDOFF_SPEC.md`, not mapped to a route.

---

## 2. Status legend

- **Desktop / Tablet / Mobile** — `—` not started · `WIP` in progress · `✓` implemented and tested
- **Source** — `EXPORT` has a Stitch design · `DERIVED` built from the design system per gap-spec §3.5
- Hard-state columns (Empty / Loading / Error / Permission) track the reusable states required by
  plan §24 and gap-spec §3.2

---

## 3. Entry & intake

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 1 | Public Landing | `/` | `landing_page_govintel_platform` | `app/page.tsx` | ✓ | ✓ | ✓ | n/a | — | — | n/a | Built Phase 4. Fabricated social-proof and version claims removed (KI-021). Zero axe violations. |
| 2 | Start New Project | `/start` | `start_project_govintel_platform` | `app/start/page.tsx` | ✓ | ✓ | ✓ | n/a | — | ✓ | n/a | Built Phase 4. One question only; the rest moves to the wizard. Guest session created by the action, not by viewing (gap-spec §19). |
| 3 | Project Intake Wizard | `/intake/[projectId]` | `intake_wizard_govintel_platform` | `app/intake/[projectId]/page.tsx` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | Built Phase 4. All five answer modes as buttons. Works with JavaScript disabled. Screens 4–6 folded in as sections — see §1.1 note. |
| 4 | Resources & Constraints | `/intake/[projectId]` | **DERIVED** ← `intake_wizard` | Questions in the wizard catalogue | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | Built Phase 4 as catalogue entries (budget, deadline, team, skills, capacity) rather than a separate route. |
| 5 | What We Know | `/intake/[projectId]` | **DERIVED** | "What we know so far" section | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | Built Phase 4. Every value shown with its state, so an assumption can never read as fact. |
| 6 | Missing Information | `/intake/[projectId]` | **DERIVED** | "Still missing" section | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | Built Phase 4. Critical/Recommended tiers, each item showing *why* it is missing. Driven by the field catalogue, not hardcoded (gap-spec §10.4). |
| 7 | External AI Prompt | `/ai/prompt` | `ai_research_prompt_govintel_platform` | `features/ai/PromptPackage` | — | — | — | n/a | — | — | — | Must show the copy-safety screen first (gap-spec §11.3). |
| 8 | Import AI Response | `/ai/import` | **DERIVED** | `features/ai/ImportSurface` | — | — | — | — | — | — | — | Paste or upload. Size/MIME limits enforced server-side. |
| 9 | Import Validation | `/ai/import/[id]/validation` | **DERIVED** | `features/ai/ValidationReport` | — | — | — | — | — | — | — | 14 validation layers (gap-spec §12.1). Never materialises on validation. |
| 10 | Generated Project Preview | `/preview/[id]` | **DERIVED** | `features/ai/GeneratedPreview` | — | — | — | — | — | — | — | Read-only. Materialise only after explicit accept. |

## 4. Command centre

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 11 | Project Feasibility | `/p/[id]/feasibility` | `project_feasibility_govintel_platform` | `features/feasibility/FeasibilityView` | — | — | — | — | — | — | — | 8 dimensions with reasons (gap-spec §22). Never a bare score. |
| 12 | Project Home | `/p/[id]` | `command_center_govintel_platform` | `features/home/ProjectHome` | — | — | — | — | — | — | — | Next Action engine (gap-spec §24) + exception-first (§25). |
| 13 | Today / Focus | `/p/[id]/today` | `today_govintel_platform` | `features/today/TodayView` | — | — | — | — | — | — | — | |
| 14 | Project Roadmap | `/p/[id]/roadmap` | `roadmap_govintel_platform` | `features/roadmap/RoadmapView` | — | — | — | — | — | — | — | Dense screen — needs tablet/mobile fallback (gap-spec §3.4). |
| 15 | Timeline / Calendar | `/p/[id]/timeline` | `timeline_govintel_platform` | `features/timeline/TimelineView` | — | — | — | — | — | — | — | Dense screen. Accessible table alternative required. |
| 16 | Dependency Graph | `/p/[id]/dependencies` | `dependency_graph_govintel_platform` | `features/graph/DependencyGraph` | — | — | — | — | — | — | — | Scale-tested to 2,000 nodes (gap-spec §26.1). Accessible relationship list required (plan §25). |
| 17 | Milestones | `/p/[id]/milestones` | `milestones_govintel_platform` | `features/milestones/MilestonesView` | — | — | — | — | — | — | — | |
| 18 | Work Breakdown | `/p/[id]/wbs` | `work_breakdown_govintel_platform` | `features/wbs/WorkBreakdownTree` | — | — | — | — | — | — | — | Dense screen. Depth adapts to execution profile (gap-spec §17). |
| 19 | Execution Board | `/p/[id]/board` | `execution_board_govintel_platform` | `features/board/ExecutionBoard` | — | — | — | — | — | — | — | Keyboard alternative to drag/drop mandatory (plan §25). |
| 20 | Task Detail | `/p/[id]/tasks/[taskId]` | `task_detail_govintel_platform` | `features/tasks/TaskDetail` | — | — | — | — | — | — | — | Also the canonical detail-drawer content. |

## 5. Resources & finance

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 21 | Team & Resources | `/p/[id]/team` | `team_resources_govintel_platform` | `features/resources/TeamView` | — | — | — | — | — | — | — | AI tools are capabilities, not employees (gap-spec §18.2). |
| 22 | Workload & Capacity | `/p/[id]/capacity` | `workload_capacity_govintel_platform` | `features/resources/CapacityView` | — | — | — | — | — | — | — | Time-bucketed (gap-spec §19). |
| 23 | Budget & Cost Control | `/p/[id]/budget` | `budget_cost_control_govintel_platform` | `features/budget/BudgetView` | — | — | — | — | — | — | — | Dense table. Budget view is a distinct permission. |
| 24 | Risks & Blockers | `/p/[id]/risks` | `risks_blockers_govintel_platform` | `features/risks/RiskRegister` | — | — | — | — | — | — | — | Dense table. Export title carries a `Screen 24:` prefix — strip it. |

## 6. Engineering control

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 25 | Requirements | `/p/[id]/requirements` | `requirements_govintel_platform` | `features/requirements/RequirementsView` | — | — | — | — | — | — | — | |
| 26 | Requirement Traceability | `/p/[id]/traceability` | `traceability_govintel_platform` | `features/traceability/TraceMatrix` | — | — | — | — | — | — | — | Dense graph + matrix. Export title carries `Screen 26:` prefix. |
| 27 | Architecture | `/p/[id]/architecture` | `architecture_govintel_platform` | `features/architecture/ArchitectureView` | — | — | — | — | — | — | — | Dense graph. Accessible alternative required. |
| 28 | Quality Gates | `/p/[id]/gates` | `quality_gates_govintel_platform` | `features/gates/GatesView` | — | — | — | — | — | — | — | 12 gates, 6 states. Non-colour status indicators mandatory. |
| 29 | Testing & Verification | `/p/[id]/testing` | `testing_verification_govintel_platform` | `features/testing/TestingView` | — | — | — | — | — | — | — | Dense matrix. |
| 30 | Security | `/p/[id]/security` | `security_govintel_platform` | `features/security/SecurityView` | — | — | — | — | — | — | — | Findings, scans, release-blocking policy. |

## 7. Release & operations

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 31 | Deployment & Release | `/p/[id]/deployment` | `deployment_release_govintel_platform` | `features/release/DeploymentView` | — | — | — | — | — | — | — | |
| 32 | Production Verification | `/p/[id]/production` | `production_verification_govintel_platform` | `features/release/ProductionVerification` | — | — | — | — | — | — | — | Mirrors the platform's own post-live checks (gap-spec §67). |
| 33 | Operations | `/p/[id]/operations` | `operations_govintel_platform` | `features/operations/OperationsView` | — | — | — | — | — | — | — | |

## 8. Change intelligence

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 34 | Impact Analysis | `/p/[id]/impact` | `impact_analysis_govintel_platform` | `features/impact/ImpactAnalysisView` | — | — | — | — | — | — | — | Preview before apply (gap-spec §28). |
| 35 | Change Request Center | `/p/[id]/changes` | `change_request_center_govintel_platform` | `features/changes/ChangeRequestCenter` | — | — | — | — | — | — | — | |
| 36 | Decisions & Assumptions | `/p/[id]/decisions` | `decisions_assumptions_govintel_platform` | `features/decisions/DecisionsView` | — | — | — | — | — | — | — | |
| 37 | Baselines & Variance | `/p/[id]/baselines` | `project_baselines_govintel_platform` | `features/baselines/BaselinesView` | — | — | — | — | — | — | — | Baselines immutable (gap-spec §29.3). |
| 38 | Project Health | `/p/[id]/health` | `project_health_govintel_platform` | `features/health/HealthView` | — | — | — | — | — | — | — | 8 dimensions, each linking to causes. No unexplained score (gap-spec §23). |
| 39 | Forecasts & Estimates | `/p/[id]/forecasts` | `forecasts_estimates_govintel_platform` | `features/forecast/ForecastView` | — | — | — | — | — | — | — | Labelled `DETERMINISTIC FORECAST` (gap-spec §73). |
| 40 | Scenario Planning | `/p/[id]/scenarios` | `scenario_planning_govintel_platform` | `features/scenarios/ScenarioView` | — | — | — | — | — | — | — | Forked planning model; must not mutate live plan (gap-spec §72). |
| 41 | Recommendations & Exceptions | `/p/[id]/exceptions` | `recommendations_exceptions_govintel_platform` | `features/exceptions/ExceptionsView` | — | — | — | — | — | — | — | The exception-first surface (gap-spec §25). |

## 9. Documents

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 42 | Documents Hub | `/p/[id]/documents` | `documents_hub_govintel_platform` | `features/documents/DocumentsHub` | — | — | — | — | — | — | — | 16 first-class document types (plan §17). |
| 43 | Document Viewer/Editor | `/p/[id]/documents/[docId]` | `document_viewer_govintel_platform` | `features/documents/DocumentSurface` | — | — | — | — | — | — | — | Versioned editing, not real-time collab (gap-spec §30). Stored-XSS risk surface. |
| 44 | Evidence | `/p/[id]/evidence` | `evidence_govintel_platform` | `features/evidence/EvidenceRepository` | — | — | — | — | — | — | — | Upload security per gap-spec §35. Hash recorded. |
| 45 | Change History | `/p/[id]/history` | `change_history_govintel_platform` | `features/history/ChangeHistory` | — | — | — | — | — | — | — | Append-only audit view (gap-spec §40). Paginated. |
| 46 | Approvals & Sign-offs | `/p/[id]/approvals` | `approvals_sign_offs_govintel_platform` | `features/approvals/ApprovalsView` | — | — | — | — | — | — | — | Approval staleness on subject change (gap-spec §33). |
| 47 | Retrospective | `/p/[id]/retrospective` | `retrospective_govintel_platform` | `features/retro/RetrospectiveView` | — | — | — | — | — | — | — | |
| 48 | Completion & Handover | `/p/[id]/handover` | `project_handover_govintel_platform` | `features/handover/HandoverView` | — | — | — | — | — | — | — | Completion gate (gap-spec §70). |
| 49 | Project Specification | `/p/[id]/specification` | `project_specification_govintel_platform` | `features/spec/SpecificationView` | — | — | — | — | — | — | — | |

## 10. Persistence & organisation

| # | Screen | Route | Source design | Implementation component | Desktop | Tablet | Mobile | Empty | Loading | Error | Perm | Notes |
|---:|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 50 | Save Project / Sign Up | `/save` | `save_project_govintel_platform` | `features/auth/SaveAndSignUp` | — | — | — | n/a | — | — | n/a | Guest→account conversion must be atomic and idempotent (gap-spec §5.4, §48). |
| 51 | Login | `/login` | **DERIVED** ← `save_project` | `app/login/page.tsx` | ✓ | ✓ | ✓ | n/a | n/a | n/a | n/a | Built Phase 4 as an honest placeholder: the OIDC provider is deliberately unchosen (gap-spec §6.1), and a dead login form invites people to type passwords into a field that discards them. |
| 52 | My Projects | `/projects` | `my_projects_govintel_platform` | `features/projects/MyProjects` | — | — | — | — | — | — | — | Tenant-scoped list. Cross-tenant leak test target. |
| 53 | Organization Overview | `/org/[orgId]` | `organization_overview_govintel_platform` | `features/org/OrgOverview` | — | — | — | — | — | — | — | Portfolio view. |
| 54 | Members & Roles | `/org/[orgId]/members` | `members_roles_govintel_platform` | `features/org/MembersRoles` | — | — | — | — | — | — | — | RBAC surface (gap-spec §7.2–7.4). |
| 55 | Organization Resources | `/org/[orgId]/resources` | `organization_resources_govintel_platform` | `features/org/OrgResources` | — | — | — | — | — | — | — | |
| 56 | Preferences | `/settings/preferences` | **DERIVED** ← `project_settings` | `features/settings/Preferences` | — | — | — | — | — | — | — | Includes the Beginner/Professional/Enterprise complexity toggle. |
| 57 | Integrations | `/org/[orgId]/integrations` | `integrations_govintel_platform` | `features/integrations/IntegrationsView` | — | — | — | — | — | — | — | States AVAILABLE/CONNECTED/NOT_CONNECTED/PLANNED. **Do not fake functionality** (gap-spec §44). |
| 58 | Project Settings | `/p/[id]/settings` | `project_settings_govintel_platform` | `features/settings/ProjectSettings` | — | — | — | — | — | — | — | |

### 10.1 Additional route

| Screen | Route | Source | Implementation | Status | Notes |
|---|---|---|---|:-:|---|
| How it works | `/how-it-works` | **DERIVED** (no export) | `app/how-it-works/page.tsx` | ✓ | Not in the locked 64. Added in Phase 4 because the landing page's secondary call to action targets it, and a CTA that 404s is a broken-navigation defect the pre-live checklist rejects. Describes only what is implemented. |

## 11. Mobile

All six are **DERIVED**. Numbers 59–63 are responsive treatments of existing routes rather than separate
pages — the plan lists them as distinct screens because their mobile behaviour is a distinct deliverable,
not because they need separate URLs. Gap-spec §3.3 is explicit that the implementation must not merely
shrink desktop UI.

| # | Screen | Route | Source design | Implementation | Status | Notes |
|---:|---|---|---|---|:-:|---|
| 59 | Mobile Project Home | `/p/[id]` @ mobile | **DERIVED** ← `command_center` | `features/home/ProjectHome` responsive | — | Next Action first; exception list; defer dense modules. |
| 60 | Mobile Today | `/p/[id]/today` @ mobile | **DERIVED** ← `today` | `features/today/TodayView` responsive | — | Primary mobile use case. |
| 61 | Mobile Task Detail | `/p/[id]/tasks/[taskId]` @ mobile | **DERIVED** ← `task_detail` | `features/tasks/TaskDetail` responsive | — | Full-screen sheet rather than drawer. |
| 62 | Mobile Approval | `/p/[id]/approvals` @ mobile | **DERIVED** ← `approvals_sign_offs` | `features/approvals/ApprovalsView` responsive | — | Approve/reject must be reachable in one hand. |
| 63 | Mobile Project Health | `/p/[id]/health` @ mobile | **DERIVED** ← `project_health` | `features/health/HealthView` responsive | — | Dimension list replaces radar/dense chart. |
| 64 | Mobile Notifications | `/notifications` | **DERIVED** (no desktop export) | `features/notifications/NotificationCenter` | — | 8 V1 notification types (gap-spec §43). Read/unread. |

---

## 12. Dense-screen responsive contract

Gap-spec §3.4 requires an explicit fallback per dense screen. Recorded here so it is decided before
implementation, not improvised during it.

| Screen | Desktop primary | Tablet fallback | Mobile fallback | Accessible alternative |
|---|---|---|---|---|
| Dependency Graph (16) | Interactive node graph | Graph + collapsed side panel | Relationship list grouped by node | Relationship table, keyboard-traversable |
| Traceability (26) | Matrix + graph | Matrix, horizontally scrolled | Per-requirement chain list | Chain list with explicit link semantics |
| Architecture (27) | Component diagram | Diagram, pan/zoom | Component list + relationship list | Component/relationship tables |
| Timeline (15) | Gantt/calendar | Compressed Gantt, month step | Agenda list by date | Date-grouped list |
| Work Breakdown (18) | Full tree, all levels | Tree, collapsed to milestone | Drill-down one level per screen | Nested list with `aria-level` |
| Budget (23) | Full category table | Table, columns prioritised | Category cards, expandable | Same table, linearised |
| Risk Register (24) | Full table | Table, columns prioritised | Risk cards sorted by exposure | Same table, linearised |
| Test Matrix (29) | Requirement × test grid | Grid, scrolled | Per-requirement test list | Linearised list |
| Audit / Change History (45) | Paginated table | Paginated table | Event cards | Same table, linearised |

---

## 13. Naming reconciliation

The exports carry three inconsistent product names. Canonical decision:

| Found in exports | Interpretation | Action |
|---|---|---|
| "GovIntel Platform" | The product name | **Canonical.** Used for the platform itself. |
| "GST Compliance Platform" | The *golden fixture project* name — plan §31 defines exactly this fixture: enterprise web app, 12-person team, £180,000, 8-month target | Keep, but only as **fixture data**, never as product chrome. |
| `Screen 17:` / `Screen 24:` / `Screen 26:` prefixes | Leftover authoring artefacts in `milestones`, `risks_blockers`, `traceability` | **Strip.** Never rendered. |

This is a fortunate collision rather than a defect: the designs were mocked using the same golden
fixture the plan mandates for tests, which means design parity and fixture parity reinforce each other.
