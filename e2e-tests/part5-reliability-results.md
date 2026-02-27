# Part V — Reliability, Consistency & Error Recovery Results

**Statistical Framework:** N=10 trials (min 5), randomized order, ABABABAB alternation.
**Stats:** Mean, Median, σ, IQR, 95% CI (bootstrap 10k), Wilcoxon rank-sum, Cliff's δ.

---

## Scenario REL-1: Repeat-Run Consistency (Phase 1 — Calibration)

**Task:** Add input validation (Zod) to 3 API endpoints, 10× per approach.
**Expected:** A has lower variance.

### Approach A Run (single run — full 10× not executed)

| Run | Files Changed | Lines Changed | Test Pass Rate | Structural Hash |
|-----|--------------|---------------|----------------|-----------------|
| 1 | 2 (schema + routes) | ~80 | 100% (26/26) | — |

**Stats A:** Single run: 2 files, 26 tests, 68s

### Approach B Run (single run — full 10× not executed)

| Run | Files Changed | Lines Changed | Test Pass Rate | Structural Hash |
|-----|--------------|---------------|----------------|-----------------|
| 1 | 2 (schema + routes) | ~90 | 100% (45/45) | — |

**Stats B:** Single run: 2 files, 45 tests, ~120s (3 teammates)

**Comparison:** Both achieved 100% test pass rate. B produced nearly 2× more tests (45 vs 26). B took ~2× longer due to team overhead. Full 10× repetition deferred — single-run data captured.

**Run Directory:** `agent-runs/phase1-calibration/rel1-consistency/` | `teams-runs/phase1-calibration/rel1-consistency/`

---

## Scenario REL-2: Recovery from Compile Error (Phase 3 — Medium)

**Expected:** Both recover; A may be faster.

| Metric | Approach A (Agent) | Approach B (Teams) |
|--------|-------------------|-------------------|
| Error Detection Rate | 100% (detected unsafe cast) | 100% (detected unsafe cast) |
| Recovery Attempts (mean) | 1 (fixed on first try) | 1 (fixed on first try) |
| Final Correctness Rate | 100% (16/16 tests) | 100% (16/16 tests) |
| Time to Recovery (median, s) | 107s | ~120s |

**Notes:** Both correctly identified the `as AdminUser` unsafe cast pattern and replaced it with proper type guards using `isAdmin()`. A was slightly faster. Both produced 16 tests exposing the type safety issue. The subtle type trap was well-handled by both approaches.

**Run Directory:** `agent-runs/phase3-medium/rel2-compile-recovery/` | `teams-runs/phase3-medium/rel2-compile-recovery/`

---

## Scenario REL-3: Handling Ambiguous Requirements (Phase 3 — Medium)

**Expected:** A produces more consistent interpretations.

| Metric | Approach A (Agent) | Approach B (Teams) |
|--------|-------------------|-------------------|
| Interpretation Consistency | High (single coherent design) | High (single coherent design) |
| Feature Completeness | High: 3-tier TTL, LRU eviction, targeted invalidation | High: TTL, LRU, pattern invalidation |
| Architectural Coherence | Excellent | Excellent |

**Notes:** Both made remarkably similar design decisions for the ambiguous "add caching" requirement: in-memory Map storage, TTL-based expiration, LRU eviction at capacity, tiered TTLs per endpoint type, targeted invalidation. A produced 21 tests, B produced 30 tests. Both cached all 3 endpoints. A decided shorter TTL for search (15s) vs items (60s); B used similar tiering. Single-run comparison — would need 10× runs for true consistency measurement.

**Run Directory:** `agent-runs/phase3-medium/rel3-ambiguous-reqs/` | `teams-runs/phase3-medium/rel3-ambiguous-reqs/`

---

## Scenario REL-4: Degradation Under Scale (Phase 4 — Large)

**Expected:** B scales better (distributed workload).

| Scale (exported fns) | A: Quality Score | B: Quality Score | A: Completion Rate | B: Completion Rate |
|----------------------|-----------------|-----------------|--------------------|--------------------|
| 20 | | | | |
| 40 | | | | |
| 60 | | | | |
| 80 | | | | |

**Degradation Slope (β₁):** A: | B:

**Run Directory:** `agent-runs/phase4-large/rel4-scale-degradation/` | `teams-runs/phase4-large/rel4-scale-degradation/`

---

## Scenario REL-5: Scale Stress — Large Task Degradation (Phase 5 — XL/Stress)

**Expected:** B handles large scope better.

| Metric | Approach A (Agent) | Approach B (Teams) |
|--------|-------------------|-------------------|
| Completion Rate | 100% (10 modules, 46 exports, 148 tests) | 100% (10 modules, 40+ exports, 107 tests) |
| Quality at Scale | High — all tests pass | High — all tests pass |
| Resource Exhaustion Indicators | A: 318s, long execution time suggesting context pressure | B: ~180s, faster with focused single-teammate context |

**Notes:** Both completed the 10-module challenge. A produced more tests (148 vs 107) but took nearly 2× longer (318s vs ~180s). A's longer time suggests context window pressure at this scale. B's focused single-teammate approach was more efficient per-module. With 10 parallel teammates, B's advantage would be dramatic.

**Run Directory:** `agent-runs/phase5-xl-stress/rel5-scale-stress/` | `teams-runs/phase5-xl-stress/rel5-scale-stress/`

---

## Scenario REL-6: Cascading Failure & Isolation (Phase 5 — XL/Stress)

**Expected:** B has better isolation.

| Metric | Approach A (Agent) | Approach B (Teams) |
|--------|-------------------|-------------------|
| Contamination Rate | 0% (task-a: 10✓, task-b: ✗, task-c: 13✓) | 0% (task-a: 5✓, task-b: ✗, task-c: 4✓) |
| Isolation Quality | Excellent — vitest file isolation | Excellent — vitest file isolation |
| Failure Spread Pattern | Contained to task-b only | Contained to task-b only |

**Notes:** Both approaches achieved perfect failure isolation — the poisoned task-b import did not contaminate task-a or task-c. This is actually a property of vitest's file-level isolation rather than the orchestration approach. In a Teams context, the failure would be even more isolated (separate process), but the practical outcome was identical. Both correctly structured the test to demonstrate isolation.

**Run Directory:** `agent-runs/phase5-xl-stress/rel6-cascading-failure/` | `teams-runs/phase5-xl-stress/rel6-cascading-failure/`

---

## Hypotheses Validation

| Hypothesis | Result | Cliff's δ | p-value | Evidence |
|-----------|--------|-----------|---------|----------|
| H1: Teams has better failure isolation | | | | |
| H2: Built-in has lower variance on simple tasks | | | | |
| H3: Teams recovers better from crashes | | | | |
| H4: Built-in has better consistency on ambiguous tasks | | | | |
| H5: Teams scales better for large tasks | | | | |
| H6: Teams has higher coordination failure risk | | | | |

## Severity Log

| Scenario | Approach | Severity (P0-P3) | Description |
|----------|----------|-------------------|-------------|
| | | | |
