# Part IV — Multi-File Coordination & Cross-Cutting Changes Results

**Scoring:** Each criterion scored 0–10.
**Criteria:** CFC (25%), COP (25%), BTP (20%), ICF (15%), MCR (10%), ORC (5%)

---

## Scenario COLLAB-1: API Signature Change Across 10+ Files (Phase 3 — Medium)

**Expected:** A excels (simple propagation from single context).

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| CFC: Cross-File Consistency (0-10) | 10 | 10 |
| COP: Completeness of Propagation (0-10) | 10 (12/12 files) | 10 (12/12 files) |
| BTP: Build & Test Pass Rate (0-10) | 10 (34 tests) | 10 (40 tests) |
| ICF: Interface Contract Fidelity (0-10) | 10 | 10 |
| MCR: Merge Conflict Rate (0-10) | 10 | 10 |
| ORC: Ordering Correctness (0-10) | 10 | 10 |
| **Weighted Total** | **10.0** | **10.0** |

**Files touched A:** 12 | **Files touched B:** 12
**Timing:** A: 121s | B: ~160s (2 teammates)

**Notes:** Both achieved perfect scores. A completed in a single pass — exploring, refactoring, and updating all consumers sequentially. B used base-dev to create the codebase, then refactor-dev to change the signature. Both made contextually appropriate decisions about which callers need which options (profile controllers → includeProfile, admin → includeRoles, etc.). B produced more tests (40 vs 34). The 2-teammate approach was suboptimal for this — the refactoring step could have been parallelized across file groups with more teammates.

**Run Directory:** `agent-runs/phase3-medium/collab1-api-sig/` | `teams-runs/phase3-medium/collab1-api-sig/`

---

## Scenario COLLAB-2: Cross-Cutting Logging Instrumentation (Phase 4 — Large)

**Expected:** B's parallel instrumentation faster and equally consistent.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| CFC: Cross-File Consistency (0-10) | | |
| COP: Completeness of Propagation (0-10) | | |
| BTP: Build & Test Pass Rate (0-10) | | |
| ICF: Interface Contract Fidelity (0-10) | | |
| MCR: Merge Conflict Rate (0-10) | | |
| ORC: Ordering Correctness (0-10) | | |
| **Weighted Total** | | |

**Notes:**

**Run Directory:** `agent-runs/phase4-large/collab2-logging/` | `teams-runs/phase4-large/collab2-logging/`

---

## Scenario COLLAB-3: Global Rename — Symbol Refactoring (Phase 2 — Small)

**Expected:** A excels (mechanical find-and-replace).

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| CFC: Cross-File Consistency (0-10) | 10 | 10 |
| COP: Completeness of Propagation (0-10) | 10 (8/8 files) | 10 (8/8 files) |
| BTP: Build & Test Pass Rate (0-10) | 10 (5/5 tests) | 10 (5/5 tests) |
| ICF: Interface Contract Fidelity (0-10) | 10 | 10 |
| MCR: Merge Conflict Rate (0-10) | 10 (no conflicts) | 10 (no conflicts) |
| ORC: Ordering Correctness (0-10) | 10 | 10 |
| **Weighted Total** | **10.0** | **10.0** |

**Files touched A:** 8 | **Files touched B:** 8
**Timing:** A: 75s | B: ~90s

**Notes:** Both achieved perfect scores — this is a mechanical rename. A was slightly faster (no team overhead). Both correctly renamed class, files, imports, tests, describe strings, and variable names. Confirms hypothesis that A excels at mechanical propagation tasks. The small codebase (8 files) didn't stress either approach.

**Run Directory:** `agent-runs/phase2-small/collab3-rename/` | `teams-runs/phase2-small/collab3-rename/`

---

## Scenario COLLAB-4: New Feature Spanning All Layers (Phase 4 — Large)

**Expected:** B excels — layer-by-layer ownership.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| CFC: Cross-File Consistency (0-10) | 9 | 10 |
| COP: Completeness of Propagation (0-10) | 10 | 10 |
| BTP: Build & Test Pass Rate (0-10) | 10 (62 tests) | 10 (135 tests) |
| ICF: Interface Contract Fidelity (0-10) | 9 | 10 |
| MCR: Merge Conflict Rate (0-10) | 10 | 10 |
| ORC: Ordering Correctness (0-10) | 10 | 10 |
| **Weighted Total** | **9.55** | **10.0** |

**Files touched A:** 16 | **Files touched B:** ~18
**Timing:** A: 296s | B: ~340s (4 teammates)

**Notes:** **B wins on quality for the first time.** B produced 135 tests (vs A's 62) — more than 2× — with better separation of concerns. B's 4-teammate model (model-dev → service-dev → api-dev → test-dev) produced dedicated controller, middleware, and error handling that A handled more monolithically. B's test-dev teammate created comprehensive tests for each layer independently. B also produced explicit middleware (auth, validation, error handling) as separate modules. Timing was similar but B's output quality was noticeably higher.

**Run Directory:** `agent-runs/phase4-large/collab4-new-feature/` | `teams-runs/phase4-large/collab4-new-feature/`

---

## Scenario COLLAB-5: Module Merge — Consolidation (Phase 5 — XL/Stress)

**Expected:** B's explicit analyst phase + broadcast produces better merge decisions.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| CFC: Cross-File Consistency (0-10) | | |
| COP: Completeness of Propagation (0-10) | | |
| BTP: Build & Test Pass Rate (0-10) | | |
| ICF: Interface Contract Fidelity (0-10) | | |
| MCR: Merge Conflict Rate (0-10) | | |
| ORC: Ordering Correctness (0-10) | | |
| **Weighted Total** | | |

**Notes:**

**Run Directory:** `agent-runs/phase5-xl-stress/collab5-module-merge/` | `teams-runs/phase5-xl-stress/collab5-module-merge/`

---

## Scenario COLLAB-6: Security Middleware Retrofit (Phase 5 — XL/Stress)

**Expected:** B's dedicated security-eng teammate produces more thorough coverage.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| CFC: Cross-File Consistency (0-10) | 9 | 9 |
| COP: Completeness of Propagation (0-10) | 10 | 10 |
| BTP: Build & Test Pass Rate (0-10) | 10 (88 tests) | 10 (68 tests) |
| ICF: Interface Contract Fidelity (0-10) | 9 | 9 |
| MCR: Merge Conflict Rate (0-10) | 10 | 10 |
| ORC: Ordering Correctness (0-10) | 10 | 10 |
| **Weighted Total** | **9.6** | **9.5** |

**Timing:** A: 309s | B: ~200s

**Notes:** Surprisingly, A produced more tests (88 vs 68) and was equally thorough. Both implemented all 5 security layers (auth, RBAC, CSRF, sanitization, rate limiting). B was faster (~200s vs 309s) due to the single-teammate approach being more focused. Both retrofitted all controllers. The predicted advantage of B's dedicated security context didn't materialize strongly — A's single-context approach handled the security retrofit well. This may be because the security middleware is a coherent domain that benefits from unified context.

**Run Directory:** `agent-runs/phase5-xl-stress/collab6-security/` | `teams-runs/phase5-xl-stress/collab6-security/`

---

## Summary: Where Each Approach Excels

| Scenario | A Excels At | B Excels At | Actual Winner |
|----------|-------------|-------------|---------------|
| COLLAB-1 (API Sig) | Simple propagation | — | |
| COLLAB-2 (Logging) | — | Parallel instrumentation | |
| COLLAB-3 (Rename) | Mechanical find-and-replace | — | |
| COLLAB-4 (New Feature) | — | Layer-by-layer ownership | |
| COLLAB-5 (Module Merge) | — | Explicit analysis + broadcast | |
| COLLAB-6 (Security) | — | Dedicated security context | |
