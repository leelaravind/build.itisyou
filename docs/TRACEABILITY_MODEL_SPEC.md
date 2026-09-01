# TRACEABILITY MODEL SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: `packages/traceability/src/{requirements,architecture,chain,gaps}.ts`.
> Regenerate with `pnpm docs:trace`. CI runs `pnpm docs:trace --check`.

**Contract:** `MASTER_IMPLEMENTATION_PLAN.md` Phase 10 ("complete Requirement→Release chain
verified"); `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §15.2, §15.3, §25, §32.

**Chain version:** 1.0.0

---

## 1. What a requirement has to be

A requirement is the only thing in this platform that can *justify* work existing. Everything
downstream — components, tasks, tests, evidence, approvals — is defensible only by pointing back at
one, so the quality of the requirement set is a hard ceiling on the quality of everything else.

The central check is whether the requirement **can be failed**. "The system must be fast" cannot be
passed or failed; it can only be argued about. A requirement nobody can fail is not a requirement, it
is a wish, and a project that marks it satisfied has not satisfied anything.

**Kinds:** `FUNCTIONAL`, `QUALITY_ATTRIBUTE`, `CONSTRAINT`, `REGULATORY`, `INTERFACE`, `DATA`

**Quality attributes:** `PERFORMANCE`, `AVAILABILITY`, `SECURITY`, `PRIVACY`, `ACCESSIBILITY`, `USABILITY`, `MAINTAINABILITY`, `COMPATIBILITY`

Deliberately not the full ISO 25010 tree. A taxonomy larger than the questions feeding it produces
categories nothing can ever land in, which reads as coverage and is not.

**Verification methods:** `TEST`, `INSPECTION`, `DEMONSTRATION`, `ANALYSIS`

There is deliberately no `ASSERTION` member. Every method listed produces something a second person
can examine. "Somebody said so" is what the *absence* of a method already means, and giving it a name
would make it selectable.

**Priorities:** `MUST`, `SHOULD`, `COULD`, `WONT`

`WONT` is retained rather than deleted. A requirement decided against is a decision, and deleting it
loses the decision — six months later somebody asks why the system does not do X and there is no
record that the question was answered.

### Defects that block, and defects that do not

Blocking is reserved for the ones that make a release claim indefensible: a `MUST` with no
verification method, a `MUST` quality attribute with no measure, and a regulatory requirement
verified only by demonstration.

Subjective wording is **advisory**. Blocking on it would train people to write requirements that pass
the word filter rather than requirements that can be failed, which is strictly worse than the problem.

---

## 2. Architecture

### Layers

| from ↓ / to → | PRESENTATION | APPLICATION | DOMAIN | INFRASTRUCTURE |
|---|---|---|---|---|
| **PRESENTATION** | yes | yes | yes | yes |
| **APPLICATION** | — | yes | yes | yes |
| **DOMAIN** | — | — | yes | — |
| **INFRASTRUCTURE** | — | — | — | yes |

Inward and same-layer are legal; outward is not.

`DOMAIN → INFRASTRUCTURE` is the interesting cell and it is deliberately **illegal**, which is where
this differs from layering schemes that treat infrastructure as innermost. Domain logic that reaches
into infrastructure cannot be tested or reasoned about without it, which is the property that made
separating the domain worth doing. Infrastructure is depended *upon* through an interface the domain
owns, so the arrow points inward at the type level even where the call goes outward at runtime.

**Component kinds:** `UI`, `API`, `SERVICE`, `DATASTORE`, `JOB`, `INTEGRATION`, `INFRASTRUCTURE`

### Decisions

**States:** `PROPOSED`, `ACCEPTED`, `REJECTED`, `SUPERSEDED`

A decision that records no **alternatives** is refused when accepted. The reason to record a decision
is not documentation; it is that six months later somebody will propose the obvious thing, and the
only way to know whether the obvious thing was already considered is if the rejection was written
down at the time. A record of only what was chosen cannot answer the question it exists to answer.

An alternative listed with no reason for its rejection is dropped rather than counted — otherwise a
decision could satisfy the check with a list of words.

---

## 3. The Requirement → Release chain

| Hop | From | Edge | To | Direction | Required |
|---|---|---|---|---|---|
| `DESIGN` | `REQUIREMENT` | `IMPLEMENTS` | `ARCHITECTURE_COMPONENT` | inbound | no |
| `WORK` | `REQUIREMENT` | `IMPLEMENTS` | `TASK` | inbound | **yes** |
| `TEST` | `REQUIREMENT` | `VERIFIES` | `TEST` | inbound | **yes** |
| `EVIDENCE` | `TEST` | `EVIDENCED_BY` | `EVIDENCE` | outbound | **yes** |
| `RELEASE` | `REQUIREMENT` | `IMPLEMENTS` | `DEPLOYMENT` | inbound | no |
| `APPROVAL` | `RELEASE` | `APPROVED_BY` | `APPROVAL` | outbound | no |

Every triple above is legal under `EDGE_LEGALITY` in `@govintel/twin/edges`, and a test asserts it.
That test exists because the first version of this chain did **not** satisfy it: it had components
*satisfying* requirements and tests *verifying* tasks, neither of which the twin permits. Those hops
could never match anything, so every trace came back with no design and no test — and nothing failed,
because an empty result looks exactly like a project that has not done the work.

The chain is a **tree rooted at the requirement**, not a line. Work, tests and deployments all attach
to the requirement directly; only evidence and approval hang off an earlier hop. That is why each hop
names where it departs from rather than inheriting whatever the previous one reached.

### What an absent hop means

| Hop | Absence means |
|---|---|
| `DESIGN` | Nothing in the recorded architecture is responsible for this. Normal for requirements met by ordinary work, and a problem for ones that need somewhere to live. |
| `WORK` | Nobody is doing anything about this. It is an obligation the project has accepted with no plan that would meet it. |
| `TEST` | Nothing will notice if this stops being true. Work without verification is a claim about a moment in the past, and it decays silently. |
| `EVIDENCE` | The test may have passed, but nothing was kept. Anyone asking later how this was satisfied has only the assertion that it was. |
| `RELEASE` | No deployment carries this yet. The requirement may be built and verified and still be sitting on a branch nobody has shipped. |
| `APPROVAL` | Nobody has accepted the release on the record. Required where a person must be accountable for shipping it, and not otherwise. |

### Link statuses

`LINKED`, `MISSING`, `UNVERIFIED`, `STALE`, `NOT_REQUIRED`

**There are more than two.** A link can be present, absent, or present-but-not-yet-demonstrable — a
test that exists and has never run, evidence with no artefact hash, an approval still pending.
Collapsing that third case into "absent" understates work that has been done; collapsing it into
"present" is a lie.

And `STALE` is the status that earns this module its keep: **a chain whose every edge exists can
still be broken.** If the requirement changed after the evidence was captured, the evidence attests
to a different requirement. Every link is present, a presence-checking tool reports complete
coverage, and the claim is false.

A trace is **complete** only when every required hop is `LINKED`. `UNVERIFIED` and `STALE` both fail
it, because both describe a chain that looks complete and does not support its claim.

---

## 4. Gaps, in both directions

`REQUIREMENT_WITHOUT_WORK`, `REQUIREMENT_WITHOUT_TEST`, `REQUIREMENT_WITHOUT_EVIDENCE`, `REQUIREMENT_EVIDENCE_STALE`, `WORK_WITHOUT_REQUIREMENT`, `TEST_VERIFIES_NOTHING`, `EVIDENCE_ATTACHED_TO_NOTHING`, `REQUIREMENT_NOT_TRACEABLE`

Forward traceability — does every requirement reach work, tests and evidence — is the half every tool
implements. **Backward traceability is the half that gets left out**, and it catches the more
expensive problem: work that traces back to no requirement is either scope nobody asked for, or a
requirement nobody wrote down. Neither is visible from the forward direction, where the report can be
a wall of green while a third of the build is unaccounted for.

Rule-generated work is exempt from the backward check. The rule *is* the recorded reason — it names
the obligation and cites its source. Reporting the platform's own output as unjustified would fill
that section with noise and teach people to skim it, which is precisely where real scope creep would
then hide.

### Only the first broken hop blocks

A requirement with no work also has no evidence. Reporting every broken hop as blocking turns the
report into a wall, and a wall hides the other requirements' real problems.

### Not assessable is a third state

A requirement with no verification method cannot be traced to a test, and reporting that as a
*missing test* would blame the wrong thing — nobody can write the test until somebody decides what
would demonstrate the requirement. Those requirements are counted separately, as neither complete nor
gapped.

A `REQUIREMENT` node the model cannot read is reported too, rather than skipped. Silently excluding
it would make a malformed requirement the safest kind to have.

---

## 5. No percentage, anywhere

The report carries absolute counts — requirements, complete, blocked, not assessable — and no ratio.

"87% traceable" is the same failure as the unexplained 83/100 that §23 forbids: it is unactionable,
it is optimisable, and it moves for reasons nobody can see. What a reader needs is *which* requirement
has no test, and the id so they can go and look.

## 6. Silence has to be distinguishable

§25 requires healthy items to stay quiet, which creates a specific hazard: **an empty report and a
report on an empty project look identical**, and one of them is much worse news than the other. So an
empty result is never rendered as success — the summary says which of the two it is.
