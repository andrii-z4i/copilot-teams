# Test Strategy: Built-in Agents vs. Copilot Teams

**Comprehensive Quality Comparison Framework**

> Consolidated from 5 specialist QE reports produced by team `quality-comparison-v2`.
> Generated: 2026-02-27

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Part I — Output Correctness & Completeness](#2-part-i--output-correctness--completeness)
3. [Part II — Performance & Efficiency](#3-part-ii--performance--efficiency)
4. [Part III — Complex Multi-Step Task Handling](#4-part-iii--complex-multi-step-task-handling)
5. [Part IV — Multi-File Coordination & Cross-Cutting Changes](#5-part-iv--multi-file-coordination--cross-cutting-changes)
6. [Part V — Reliability, Consistency & Error Recovery](#6-part-v--reliability-consistency--error-recovery)
7. [Cross-Cutting Hypotheses](#7-cross-cutting-hypotheses)
8. [Unified Execution Plan](#8-unified-execution-plan)

---

## 1. Executive Summary

This document defines a rigorous test strategy for comparing two orchestration approaches for AI-assisted software engineering:

- **Approach A — Built-in Agents**: Uses explore, general-purpose, task, and code-review sub-agents orchestrated from a single main context window. Coordination is implicit; the main agent sees all sub-agent output.
- **Approach B — Copilot Teams**: Uses independently-running teammate processes with explicit coordination via file claims, messaging, sprints, and task backlogs. Each teammate has its own isolated context.

The strategy is divided into 5 quality dimensions, each with its own criteria, scenarios, prompts for both approaches, scoring rubrics, and data-collection templates. Together they provide **~25 test scenarios** across correctness, performance, complexity, collaboration, and reliability.

### Key Architectural Differences

| Dimension | Approach A (Built-in Agents) | Approach B (Copilot Teams) |
|---|---|---|
| **Context sharing** | Implicit — main agent sees all sub-agent output | Explicit — via messages, reports, file state |
| **Parallelism** | Limited — sequential general-purpose calls | Native — independent teammate processes |
| **Failure isolation** | Single process; sub-agent failure returns to main | Independent processes; crash isolated to one teammate |
| **State persistence** | None between retries | File-based (reports, messages, claims) survives crashes |
| **Coordination** | Zero overhead; single brain | Explicit overhead: sprints, claims, messaging |
| **Recovery** | Main agent retries manually | Auto-respawn (max 3) with reconstructed context |

---

## 2. Part I — Output Correctness & Completeness

**Author:** qe-correctness | **Focus:** Whether generated code is functionally correct, complete, and meets all stated requirements.

### 2.1 Criteria & Metrics

| Metric ID | Metric | Description | Weight |
|-----------|--------|-------------|--------|
| C1 | **Compilation Success** | Code compiles/transpiles without errors | 15% |
| C2 | **Test Pass Rate** | Percentage of generated tests that pass | 20% |
| C3 | **Requirement Coverage** | Fraction of explicit requirements implemented | 25% |
| C4 | **Functional Correctness** | Code produces correct outputs for defined inputs | 25% |
| C5 | **API Contract Compliance** | Endpoints/interfaces match the specified contract | 10% |
| C6 | **No Dead/Stub Code** | No TODO, FIXME, placeholder, or stub implementations left | 5% |

**Scoring Formula:** `Total = (C1 × 0.15) + (C2 × 0.20) + (C3 × 0.25) + (C4 × 0.25) + (C5 × 0.10) + (C6 × 0.05)` — each metric scored 0–100.

Secondary metrics (tracked, not scored): Type Safety, Edge Case Handling, Import Completeness.

### 2.2 Severity Ratings

| Severity | Description | Score Impact |
|----------|-------------|--------------|
| **Critical** | Doesn't compile, security vulnerability, infinite loop, data loss | −30 to −50 |
| **Major** | Requirement completely missing, test suite doesn't run, wrong algorithm | −15 to −25 |
| **Moderate** | Edge case not handled, partial requirement, flaky test | −5 to −10 |
| **Minor** | Suboptimal but correct, missing optional feature, weak typing | −1 to −3 |
| **Info** | Style preference, naming convention, documentation gap | Not scored |

### 2.3 Scenarios

#### Scenario C-1: REST CRUD API with Validation

**Objective:** Generate a complete CRUD REST API for a `Product` resource with input validation, error handling, and tests.

**Requirements (R1–R10):**
- R1: `Product` model — id (UUID), name (string, 1–100 chars), price (number, > 0), category (enum: electronics|clothing|food), createdAt (ISO date)
- R2: `POST /products` — create; return 201
- R3: `GET /products` — list all; support `?category=` filter
- R4: `GET /products/:id` — get single; return 404 if not found
- R5: `PUT /products/:id` — full update; return 404 if not found
- R6: `DELETE /products/:id` — delete; return 204 or 404
- R7: Input validation via Zod; return 400 with structured errors
- R8: In-memory storage
- R9: Comprehensive test suite
- R10: All tests pass with `vitest run`

**Approach A Prompt:**
```
Implement a REST CRUD API for a Product resource in this Express/TypeScript project.

Requirements: [R1–R10 as above]

Execute this plan:
1. Explore agent: analyze project structure, package.json, tsconfig.
2. General-purpose agent: implement Product model + Zod schema in src/models/product.ts, in-memory store in src/store.ts.
3. General-purpose agent: implement all route handlers in src/routes/products.ts, wire into src/index.ts.
4. General-purpose agent: write comprehensive tests in tests/products.test.ts.
5. Task agent: run 'npx vitest run'.
6. Code-review agent: verify correctness and completeness.
```

**Approach B Prompt:**
```
Create team 'crud-api' with teammates:
- model-dev: Create Product model + Zod schema in src/models/product.ts, in-memory store in src/store.ts. Claim those files. Broadcast interface shape when done.
- routes-dev: Implement all CRUD route handlers in src/routes/products.ts. Depends on model-dev. Claim route file.
- test-dev: Write comprehensive vitest tests. Depends on model-dev and routes-dev. Claim tests/.
- integrator: Wire routes into src/index.ts, run build + tests, fix any issues.

Sprint 1: model-dev. Sprint 2: routes-dev. Sprint 3: test-dev + integrator.
```

#### Scenario C-2: ETL Data Pipeline

**Objective:** Build a multi-stage data pipeline: CSV parser → validator → transformer → aggregator → reporter.

**Key Requirements:** 5 pipeline stages, each as separate module. Typed interfaces between stages. Error accumulation (don't halt on single bad record). Summary statistics. Tests for each stage + integration test.

#### Scenario C-3: State Machine (Order Processing)

**Objective:** Implement a finite state machine for order processing: Draft → Submitted → Approved → Shipped → Delivered, with rejection/cancellation branches.

**Key Requirements:** Strict transition validation, guard conditions, event logging, undo support for specific transitions, exhaustive test matrix.

#### Scenario C-4: Auth Module with Security

**Objective:** JWT authentication with registration, login, token refresh, role-based access control, password hashing.

**Key Requirements:** bcrypt hashing, JWT with expiry, refresh token rotation, role-based middleware, secure password rules, comprehensive security tests.

#### Scenario C-5: Algorithm Suite

**Objective:** Implement 5 classic algorithms with TypeScript generics: binary search, merge sort, Dijkstra's shortest path, LRU cache, trie.

**Key Requirements:** Generic type signatures, edge case handling, Big-O documentation, property-based tests.

#### Scenario C-6: Form Validation Library

**Objective:** Composable validation library with chainable validators, custom error messages, async validation, field dependencies.

**Key Requirements:** Type-safe builder pattern, 10+ built-in validators, async support, cross-field validation, i18n error messages.

### 2.4 Hypotheses

| # | Hypothesis | Expected Direction |
|---|-----------|-------------------|
| H1 | Approach A produces more internally consistent code (one brain coordinates all) | A ≥ B |
| H2 | Approach B handles complex dependency chains better (dedicated context per slice) | B ≥ A for complex scenarios |
| H3 | Approach A has fewer import/interface mismatches (shared context) | A > B |
| H4 | Approach B produces more complete test coverage (dedicated test teammate) | B ≥ A |
| H5 | Approach A leaves fewer stubs (main agent tracks overall completeness) | A > B |
| H6 | Both achieve similar correctness on simple scenarios; differences emerge with complexity | Diverge with complexity |

### 2.5 Recommended Execution Order

1. **C-5** (Algorithms) — simplest, isolated functions, establishes baseline
2. **C-6** (Form Validator) — medium complexity, single-domain
3. **C-1** (CRUD API) — standard web scenario
4. **C-2** (Data Pipeline) — multi-stage processing
5. **C-3** (State Machine) — complex transition logic
6. **C-4** (Auth Module) — security-critical, most nuanced

---

## 3. Part II — Performance & Efficiency

**Author:** qe-performance | **Focus:** Wall-clock time, token consumption, coordination overhead, and parallelism across task sizes S–XL.

### 3.1 Criteria & Metrics

| Metric | ID | Definition | How Measured |
|---|---|---|---|
| **Wall-Clock Time** | M-WCT | Elapsed seconds from prompt to final output | Timestamp diff in session logs |
| **LLM Turn Count** | M-TURN | Total LLM inference calls across all agents/teammates | Count of assistant responses |
| **Tool Call Count** | M-TOOL | Total tool invocations | Count in session transcript(s) |
| **Token Usage** | M-TOK | Total input + output tokens | API usage metadata |
| **Coordination Overhead** | M-COORD | Turns spent on orchestration vs. productive work | Count orchestration-specific calls |
| **Effective Parallelism** | M-PAR | `sum(individual_task_times) / wall_clock_time` | Ratio calculation |
| **First-Output Latency** | M-FOL | Time to first meaningful code written | Timestamp of first edit/create |
| **Overhead Ratio** | M-OHR | `coordination_turns / total_turns` | Ratio calculation |

### 3.2 Evaluation Protocol

- Same machine, same model versions, same repo state (git SHA pinned)
- Run sequentially to avoid rate-limit interference
- 3 runs per scenario per approach; report median
- Statistical: Wilcoxon signed-rank test if runs > 5

### 3.3 Scenarios

#### PERF-S1: Single File Bug Fix (Size: S)

**Goal:** Baseline overhead on trivially small task — parallelism has no benefit.

**Setup:** Introduce a deliberate `===` → `!==` bug in message filtering.

**Expected:** Approach A wins — no spawn overhead. B incurs team/sprint setup cost.

| Rating | Wall-Clock | Turns | Overhead Ratio |
|---|---|---|---|
| 5 (Excellent) | < 30s | ≤ 5 | < 5% |
| 4 (Good) | 30–60s | 6–10 | 5–10% |
| 3 (Acceptable) | 60–120s | 11–15 | 10–20% |
| 2 (Poor) | 120–180s | 16–25 | 20–40% |
| 1 (Failing) | > 180s | > 25 | > 40% |

#### PERF-S2: Add a Utility Function + Tests (Size: S)

**Goal:** Efficiency on small additive task with no parallelism opportunity.

**Expected:** Approach A wins (lower overhead).

#### PERF-M1: Refactor Module with 3 Consumers (Size: M)

**Goal:** Test file contention — 3 consumers need updates after refactoring a shared module.

**Expected:** Uncertain — file contention in B may negate parallelism.

#### PERF-M2: Add Feature with Sequential Dependencies (Size: M)

**Goal:** Strictly sequential multi-step task.

**Expected:** Approach A wins (inherent sequentiality eliminates B's parallelism advantage).

#### PERF-L1: Cross-Package Feature (Size: L, 4 parallel units with deps)

**Goal:** Feature spanning 4 packages with partial dependencies.

**Expected:** Approach B edges ahead (partial parallelism overcomes overhead).

#### PERF-L2: Independent Test Suites for 6 Modules (Size: L)

**Goal:** Pure parallel workload — 6 independent test suites.

**Expected:** Approach B wins decisively (2.5–4× faster).

#### PERF-XL1: Full-Stack Feature (Size: XL, 8 parallel streams)

**Goal:** Large feature requiring 8 independent work streams.

**Expected:** Approach B dominates (4–7× faster).

#### PERF-XL2: Multi-Stream Data Processing (Size: XL, 4×2 streams)

**Goal:** 4 parallel pipelines, each with 2 sequential stages.

**Expected:** Approach B wins (3–4× faster).

### 3.4 Expected Crossover Point

| Scenario | Size | Parallel Units | Expected Winner | Expected Speedup |
|---|---|---|---|---|
| PERF-S1 | S | 1 | **Approach A** | 1.5–2× faster |
| PERF-S2 | S | 1 | **Approach A** | 1.3–1.5× faster |
| PERF-M1 | M | 3 (contended) | **Uncertain** | ~1.0× |
| PERF-M2 | M | 2 (sequential) | **Approach A** | 1.2–1.5× faster |
| PERF-L1 | L | 4 (partial deps) | **Approach B** (slight) | 1.2–1.5× faster |
| PERF-L2 | L | 6 (independent) | **Approach B** | 2.5–4× faster |
| PERF-XL1 | XL | 8 (independent) | **Approach B** | 4–7× faster |
| PERF-XL2 | XL | 4×2 (streams) | **Approach B** | 3–4× faster |

**Key Insight:** The crossover occurs at approximately **4+ independent parallel work streams each taking >60 seconds**. Below this, built-in agents win due to lower setup overhead. Above it, Teams parallelism dominates.

### 3.5 Risks

| Risk | Mitigation |
|------|-----------|
| Rate limiting affects parallel runs | Run at low-traffic times; add detection |
| Model version drift | Pin versions; run A and B back-to-back |
| File contention deadlocks (Teams) | Monitor claim timeouts; document as valid finding |
| Teammate crash/respawn | Record crashes separately; report with/without recovery time |
| Context window overflow (large tasks) | Monitor truncation errors; note context pressure |

---

## 4. Part III — Complex Multi-Step Task Handling

**Author:** qe-complexity | **Focus:** Decomposition quality, dependency management, coherence over long chains, and coordination overhead as task complexity scales.

### 4.1 Criteria & Metrics

| Criterion | ID | Weight |
|---|---|---|
| **Decomposition Quality** | DQ | 25% |
| **Dependency Management** | DM | 20% |
| **Coherence Over Chains** | CC | 20% |
| **Parallel Efficiency** | PE | 15% |
| **Synthesis Quality** | SQ | 10% |
| **Coordination Overhead** | CO | 10% |

### 4.2 Scoring Rubric (1–5 per criterion)

**Decomposition Quality (DQ):**
- 5: Every subtask single-responsibility, no missing/redundant steps
- 3: 2-3 overlapping subtasks or one significant step missing
- 1: No meaningful decomposition; monolithic execution

**Dependency Management (DM):**
- 5: All dependencies correct; no premature starts, no unnecessary blocking
- 3: One violation, self-corrected
- 1: No dependency awareness; arbitrary order

**Coherence Over Chains (CC):**
- 5: Every step correctly builds on prior outputs; no contradictions
- 3: 2-3 inconsistencies requiring manual fixes
- 1: Complete coherence breakdown

**Parallel Efficiency (PE):**
- 5: All parallelizable work correctly identified and concurrent
- 3: Some parallelism; 2-3 steps unnecessarily serialized
- 1: Fully serial despite clear opportunities

**Synthesis Quality (SQ):**
- 5: Merge steps produce coherent, well-integrated output
- 3: Integration requires manual fixes but core logic connects
- 1: No meaningful integration; outputs disconnected

**Coordination Overhead (CO):**
- 5: Minimal overhead; all coordination serves clear purpose
- 3: Noticeable wasted work or redundant coordination
- 1: Overhead dominates; more effort coordinating than producing

### 4.3 Scenarios

#### CX-1: Linear 3-Step Pipeline (Low Complexity)

**Objective:** Calibration baseline — model → service → test.

**Steps:** Create data model → Build service layer using model → Write tests for service.

**Expected:** Both approaches perform similarly. Establishes baseline.

#### CX-2: Diamond Dependency (Medium Complexity)

**Objective:** Task graph with fork-join pattern.

```
     [shared-types]
       /         \
[service-A]   [service-B]
       \         /
     [integration]
```

**Steps:** 7-step DAG with parallel branches merging at integration.

**Expected:** Approach B's explicit task graph excels at fork-join.

#### CX-3: 8-Step Feature with 3 Parallel Branches (Medium-High)

**Objective:** Feature with setup → 3 parallel branches → merge → test.

**Expected:** Tests whether Approach A can manage 3 concurrent branches; B's sprint model natural fit.

#### CX-4: 12-Step Refactoring Chain (High Complexity)

**Objective:** Long sequential chain with intermediate checkpoints.

**Steps:** 12 dependent refactoring steps across packages. Tests coherence over extended chains.

**Expected:** Approach A's CC score drops sharply (context window pressure); B maintains via file-based state.

#### CX-5: 15-Step DAG with Parallel Branches and Merges (Very High)

**Objective:** Maximum complexity — 15 steps, multiple fork-join patterns, 3 merge points.

**Expected:** Approach B's explicit task graph and file claims provide structural advantage.

### 4.4 Hypotheses

| Hypothesis | Rationale |
|---|---|
| H1: Teams (B) outperforms at CX-4+ complexity | Explicit task graph, file claims, inter-process isolation prevent context overflow |
| H2: Built-in (A) outperforms at CX-1–CX-2 | Lower overhead; single context maintains perfect coherence for short chains |
| H3: Synthesis steps show biggest quality gap | Built-in has implicit access to all prior context; Teams relies on reports/messages |
| H4: Teams' CO is worst at CX-3 (medium) | Not enough complexity to justify overhead, but enough to require coordination |
| H5: Built-in's CC drops sharply between CX-3 and CX-4 | 12-step chains exceed practical context window for single-orchestrator coherence |

---

## 5. Part IV — Multi-File Coordination & Cross-Cutting Changes

**Author:** qe-collaboration | **Focus:** Changes spanning many files that require coordinated edits and consistency across module boundaries.

### 5.1 Key Tradeoff

- **Approach A** relies on *implicit coordination*: single context window = single source of truth, but sub-agents can't see each other's work and sequential calls create a bottleneck.
- **Approach B** relies on *explicit coordination*: file claims prevent conflicts, messaging enables information sharing, sprints order work — but isolated contexts require active communication.

### 5.2 Criteria & Metrics

| Criterion | ID | Weight |
|---|---|---|
| **Cross-File Consistency** | CFC | 25% |
| **Completeness of Propagation** | COP | 25% |
| **Build & Test Pass Rate** | BTP | 20% |
| **Interface Contract Fidelity** | ICF | 15% |
| **Merge Conflict Rate** | MCR | 10% |
| **Ordering Correctness** | ORC | 5% |

Each scored 0–10 per scenario.

### 5.3 Environment

Reference TypeScript monorepo with 4 layers:
```
test-fixture/
├── models/          (5-8 files)
├── services/        (4-8 files)
├── controllers/     (5-10 files)
├── middleware/       (2-3 files)
├── utils/           (3-5 files)
├── tests/           (10-15 files)
├── types.ts
├── tsconfig.json
└── package.json
```

### 5.4 Scenarios

#### COLLAB-1: API Signature Change Across 10+ Files

**Setup:** `UserService.getUser(id: string)` called from 25+ files. Change to `getUser(id: string, options?: GetUserOptions)`.

**Expected:** A excels (simple propagation from single context). B's messaging overhead may not help.

#### COLLAB-2: Cross-Cutting Logging Instrumentation

**Setup:** Add structured logging to every service method, controller handler, and middleware function (~30 files). Consistent log format, correlation IDs.

**Expected:** B's parallel instrumentation with shared Logger API broadcast should be faster and equally consistent.

#### COLLAB-3: Global Rename (Symbol Refactoring)

**Setup:** Rename `UserRepository` → `AccountRepository` across entire codebase (class name, file names, imports, tests, docs).

**Expected:** A excels (mechanical find-and-replace benefits from sequential shared context).

#### COLLAB-4: New Feature Spanning All Layers

**Setup:** Add "product reviews" feature: model, service, controller, middleware (auth), tests — 15+ new files, 10+ modified files.

**Expected:** B excels — layer-by-layer ownership with interface broadcasting produces more architecturally coherent code.

#### COLLAB-5: Module Merge (Consolidation)

**Setup:** Merge `UserService` and `ProfileService` into unified `AccountService`. Requires analysis of both modules, then coordinated updates to all consumers.

**Expected:** B's explicit analyst phase and broadcast mechanism produces better merge decisions.

#### COLLAB-6: Security Middleware Retrofit

**Setup:** Add authentication + authorization middleware to all controller routes, CSRF protection, input sanitization — touching 20+ files with security implications.

**Expected:** B's dedicated security-eng teammate with focused context produces more thorough coverage.

### 5.5 Expected Results

| Scenario | Where A Excels | Where B Excels |
|---|---|---|
| COLLAB-1 (API Sig) | Simple propagation from single context | — |
| COLLAB-2 (Logging) | — | Parallel instrumentation |
| COLLAB-3 (Rename) | Mechanical find-and-replace | — |
| COLLAB-4 (New Feature) | — | Layer-by-layer ownership |
| COLLAB-5 (Module Merge) | — | Explicit analysis + broadcast |
| COLLAB-6 (Security) | — | Dedicated security context |

---

## 6. Part V — Reliability, Consistency & Error Recovery

**Author:** qe-reliability | **Focus:** Output variance, crash recovery, error handling, and failure isolation under adverse conditions.

### 6.1 Key Architectural Differences

| Dimension | Approach A | Approach B |
|---|---|---|
| Failure isolation | Single process | Independent processes |
| State persistence | None between retries | File-based, survives crashes |
| Recovery | Manual retry by main agent | Auto-respawn (max 3) |
| Blocking risks | None | Plan approval stalls, permission blocks |
| Concurrency risks | None | File claim conflicts, lock contention |

### 6.2 Statistical Framework

- **Trials per scenario:** N = 10 (minimum 5)
- Trial order randomized; approach order alternated (ABABABAB)
- Clean git checkout between trials
- Timeout: 15 minutes per trial (hard kill at 20)

**Statistics:**
- Central tendency: Mean and Median
- Dispersion: σ, IQR
- Confidence interval: 95% CI (bootstrap, 10k resamples)
- Comparison: Wilcoxon rank-sum test (non-parametric)
- Effect size: Cliff's δ (< 0.147 negligible, < 0.33 small, < 0.474 medium, ≥ 0.474 large)
- Significance: p < 0.05 (two-tailed), Bonferroni correction

### 6.3 Scenarios

#### REL-1: Repeat-Run Consistency

**Objective:** Measure output variance when same task executed 10× per approach.

**Task:** Add input validation (Zod) to 3 API endpoints.

**Metrics:** Structural similarity (AST diff), files-changed variance, lines-changed variance, test pass rate.

**Expected:** A has lower variance (single coherent context). B may produce structurally different but functionally equivalent code.

#### REL-2: Recovery from Compile Error

**Objective:** Seed a task where initial output has a compile error; measure recovery quality.

**Task:** Implement a feature in a codebase with a subtle type incompatibility trap.

**Metrics:** Error detection rate, recovery attempts, final correctness, time to recovery.

**Expected:** Both recover, but A may be faster (error visible in main context). B's auto-respawn provides structured retry.

#### REL-3: Handling Ambiguous Requirements

**Objective:** Give an intentionally ambiguous specification; measure consistency of interpretation.

**Task:** "Add caching to the API" (no specifics on what to cache, TTL, invalidation strategy).

**Metrics:** Interpretation consistency across trials, feature completeness, architectural coherence.

**Expected:** A produces more consistent interpretations (single context). B may diverge (each teammate interprets differently).

#### REL-4: Degradation Under Scale

**Objective:** Measure quality as task size grows from 20 to 80 exported functions.

**Task:** Generate typed wrappers for progressively larger APIs.

**Metrics:** Quality degradation slope (β₁), completion rate at each scale, error rate trend.

**Expected:** B scales better (distributed workload). A degrades as context window fills.

#### REL-5: Scale Stress — Large Task Degradation

**Objective:** Push both approaches to their limits with extremely large scope.

**Metrics:** Completion rate, quality at scale, resource exhaustion indicators.

#### REL-6: Cascading Failure & Isolation

**Objective:** Introduce a failure in one sub-task; measure contamination of other sub-tasks.

**Setup:** Poison one file that will cause one agent/teammate to fail. Measure whether failure spreads.

**Metrics:** Contamination rate (failure in task A causes previously-correct task B to break), isolation quality.

**Expected:** B has better isolation (independent processes). A risks cascade (error in context pollutes subsequent work).

### 6.4 Criteria Definitions

| Term | Definition |
|---|---|
| **Completion Rate** | Proportion of trials reaching terminal success. 95% CI via Clopper-Pearson exact binomial. |
| **Consistency (σ)** | Standard deviation of output metric across trials. Lower = better. |
| **Recovery Success Rate** | Proportion of error-encountering trials that eventually succeed. |
| **Contamination Rate** | Proportion of trials where one sub-task failure corrupts another. |
| **Quality Degradation Slope** | β₁ from `quality = β₀ + β₁ × task_index`. Negative = degradation. |
| **Functional Equivalence** | Identical behavior for all inputs, verified via test suite, regardless of code structure. |
| **Effect Size (Cliff's δ)** | Non-parametric: how often values in one group exceed the other. |

### 6.5 Severity Ratings

- **Critical (P0):** Fundamental failure (cascade destroys all work)
- **High (P1):** Statistically significant, large effect size (Cliff's δ ≥ 0.474)
- **Medium (P2):** Significant, medium effect size
- **Low (P3):** Significant, small effect size
- **Informational:** Observable but not statistically significant

### 6.6 Hypotheses

| Hypothesis | Rationale | Favors |
|---|---|---|
| H1: Teams has better failure isolation | Independent processes; crash isolated | B |
| H2: Built-in has lower variance on simple tasks | Less overhead, single coherent context | A |
| H3: Teams recovers better from crashes | Auto-respawn with file-based state | B |
| H4: Built-in has better consistency on ambiguous tasks | Single context = coherent interpretation | A |
| H5: Teams scales better for large tasks | Parallel teammates, distributed workload | B |
| H6: Teams has higher coordination failure risk | File claim conflicts, permission blocking, plan stalls | B (negative) |

---

## 7. Cross-Cutting Hypotheses

Synthesizing across all 5 quality dimensions:

| # | Hypothesis | Dimensions | Expected Winner |
|---|-----------|-----------|-----------------|
| 1 | **Approach A dominates for small, simple tasks** | Perf, Correctness, Reliability | A |
| 2 | **Approach B dominates for large, parallelizable tasks** | Perf, Complexity, Collaboration | B |
| 3 | **The crossover point is ~4 independent parallel streams, each >60s** | Perf | — |
| 4 | **Approach A has better coherence for sequential chains** | Complexity, Correctness | A |
| 5 | **Approach B has better failure isolation and recovery** | Reliability | B |
| 6 | **Approach A has lower output variance (more deterministic)** | Reliability | A |
| 7 | **Approach B excels at multi-file coordination with explicit ownership** | Collaboration | B |
| 8 | **Approach A excels at mechanical propagation (rename, signature change)** | Collaboration | A |
| 9 | **Synthesis/merge steps are where the biggest quality gap appears** | Complexity, Collaboration | Context-dependent |
| 10 | **Both approaches achieve similar correctness on simple scenarios; differences emerge with complexity** | All | Diverge |

---

## 8. Unified Execution Plan

### 8.1 Prerequisites

1. **Test repository**: Purpose-built TypeScript monorepo (~50 files, ~5k LOC) with seeded defects
2. **Baseline**: Green build + all tests passing, tagged as `baseline`
3. **Infrastructure**: Automated trial runner, diff analyzer, token counter, message log analyzer
4. **Evaluators**: 2 independent reviewers (inter-rater reliability target: Cohen's κ > 0.7)

### 8.2 Execution Order

| Phase | Scenarios | Purpose |
|-------|-----------|---------|
| **Phase 1: Calibration** | C-5, PERF-S1, CX-1, REL-1 | Baseline — expect similar results |
| **Phase 2: Small Tasks** | C-6, PERF-S2, COLLAB-3 | Confirm A's advantage on small scope |
| **Phase 3: Medium Tasks** | C-1, PERF-M1, PERF-M2, CX-2, CX-3, COLLAB-1, REL-2, REL-3 | Find the crossover point |
| **Phase 4: Large Tasks** | C-2, C-3, PERF-L1, PERF-L2, CX-4, COLLAB-2, COLLAB-4, REL-4 | Confirm B's scaling advantage |
| **Phase 5: XL / Stress** | C-4, PERF-XL1, PERF-XL2, CX-5, COLLAB-5, COLLAB-6, REL-5, REL-6 | Push limits; validate isolation |

### 8.3 Per-Trial Protocol

1. Reset repo to `baseline` (`git checkout -- . && git clean -fdx && npm install`)
2. Record start timestamp
3. Submit exact prompt (no human intervention)
4. Record end timestamp on completion
5. Run `tsc --noEmit` + `vitest run` → capture build/test results
6. Extract metrics: tokens, turns, tool calls, timing
7. Export git diff + session transcript
8. Two evaluators score independently, then reconcile

### 8.4 Statistical Analysis

- **Per scenario**: 3 runs minimum (10 for reliability), report median
- **Comparison**: Wilcoxon rank-sum test, Cliff's δ for effect size
- **Significance**: p < 0.05 with Bonferroni correction
- **Visualization**: Complexity curves, crossover plots, radar charts per dimension

### 8.5 Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Model variance / non-determinism | Temperature=0; 3–10 runs per scenario |
| Prompt engineering bias | Both prompts reviewed by 2 independent engineers |
| Rate limiting | Sequential runs; low-traffic times |
| Infrastructure variance | Same machine, pinned model versions |
| Evaluator bias | Independent scoring + Cohen's κ |
| Timeout fairness | Same timeout for both; orchestration overhead is a valid measurement |
| Learning effect | Balanced trial ordering (Latin square) |

### 8.6 Deliverables

1. **Raw data**: JSON results per scenario per trial per approach
2. **Statistical summary**: Mean, median, σ, 95% CI, effect sizes per metric
3. **Comparison report**: Winner per scenario, crossover analysis, hypothesis validation
4. **Recommendation**: When to use each approach, decision framework for teams
