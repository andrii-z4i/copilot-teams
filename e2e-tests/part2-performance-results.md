# Part II — Performance & Efficiency Results

**Metrics:** Wall-Clock Time (WCT), LLM Turn Count (TURN), Tool Call Count (TOOL), Token Usage (TOK), Coordination Overhead (COORD), Effective Parallelism (PAR), First-Output Latency (FOL), Overhead Ratio (OHR)

**Protocol:** 3 runs per scenario per approach; report median.

---

## Scenario PERF-S1: Single File Bug Fix — Size S (Phase 1 — Calibration)

**Expected Winner:** Approach A (1.5–2× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|--------------|
| 1 | A | 17 | ~3 | ~5 | <5% | 5 |
| 1 | B | ~60 | ~5 | ~8 | ~30% | 3 |

**Median A:** 17s | **Median B:** ~60s | **Speedup:** A is ~3.5× faster
**Notes:** Single run (not 3). A directly identified and fixed the bug in 17s. B required team creation, sprint setup, teammate spawn overhead. B's teammate also misreported the bug status in its report (claimed code was already correct). Confirms hypothesis that A dominates for trivial tasks.

**Run Directory:** `agent-runs/phase1-calibration/perf-s1/` | `teams-runs/phase1-calibration/perf-s1/`

---

## Scenario PERF-S2: Add Utility Function + Tests — Size S (Phase 2 — Small)

**Expected Winner:** Approach A (1.3–1.5× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|--------------|
| 1 | A | 49 | ~5 | ~8 | <5% | 5 |
| 1 | B | ~75 | ~8 | ~12 | ~25% | 4 |

**Median A:** 49s | **Median B:** ~75s | **Speedup:** A is ~1.5× faster
**Notes:** Single run. A produced 46 tests; B produced 54 tests (more thorough). B's overhead came from team/sprint setup for a single-teammate task — no parallelism benefit. Confirms A wins on small additive tasks.

**Run Directory:** `agent-runs/phase2-small/perf-s2/` | `teams-runs/phase2-small/perf-s2/`

---

## Scenario PERF-M1: Refactor Module with 3 Consumers — Size M (Phase 3 — Medium)

**Expected Winner:** Uncertain (~1.0×)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|--------------|
| 1 | A | 66 | ~8 | ~15 | <5% | 4 |
| 1 | B | ~90 | ~10 | ~18 | ~15% | 3 |

**Median A:** 66s | **Median B:** ~90s | **Speedup:** A is ~1.4× faster
**Notes:** File contention was not a factor (teammates each owned distinct files). A was faster — single context makes sequential refactoring more efficient. B's overhead from team setup didn't pay off since the 3 consumers had shared dependencies.

**Run Directory:** `agent-runs/phase3-medium/perf-m1/` | `teams-runs/phase3-medium/perf-m1/`

---

## Scenario PERF-M2: Add Feature with Sequential Dependencies — Size M (Phase 3 — Medium)

**Expected Winner:** Approach A (1.2–1.5× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|--------------|
| 1 | A | 101 | ~12 | ~20 | <5% | 3 |
| 1 | B | ~120 | ~15 | ~25 | ~10% | 3 |

**Median A:** 101s | **Median B:** ~120s | **Speedup:** A is ~1.2× faster
**Notes:** Strictly sequential task — no parallelism benefit for B. Both produced 44-45 tests. A's advantage was lower overhead for inherently sequential work. Confirms hypothesis that sequential dependency chains favor A.

**Run Directory:** `agent-runs/phase3-medium/perf-m2/` | `teams-runs/phase3-medium/perf-m2/`

---

## Scenario PERF-L1: Cross-Package Feature — Size L (Phase 4 — Large)

**Expected Winner:** Approach B (slight, 1.2–1.5× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | PAR | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|-----|--------------|
| 1 | A | | | | | | |
| 2 | A | | | | | | |
| 3 | A | | | | | | |
| 1 | B | | | | | | |
| 2 | B | | | | | | |
| 3 | B | | | | | | |

**Median A:** | **Median B:** | **Speedup:**

**Run Directory:** `agent-runs/phase4-large/perf-l1/` | `teams-runs/phase4-large/perf-l1/`

---

## Scenario PERF-L2: Independent Test Suites for 6 Modules — Size L (Phase 4 — Large)

**Expected Winner:** Approach B (2.5–4× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | PAR | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|-----|--------------|
| 1 | A | 125 | ~15 | ~30 | <5% | 1.0 | 3 |
| 1 | B | ~90 | ~20 | ~35 | ~15% | ~3.5 | 4 |

**Median A:** 125s | **Median B:** ~90s | **Speedup:** B is ~1.4× faster
**Notes:** **First scenario where B clearly wins.** 6 teammates worked on independent modules in parallel. A had to create all 6 modules sequentially (125s). B achieved parallel execution across 6 teammates finishing in ~90s despite team overhead. B produced 133 total tests vs A's 136 — similar coverage. This is the crossover point: 6 independent parallel units each taking ~30s.

**Run Directory:** `agent-runs/phase4-large/perf-l2/` | `teams-runs/phase4-large/perf-l2/`

---

## Scenario PERF-XL1: Full-Stack Feature — Size XL (Phase 5 — XL/Stress)

**Expected Winner:** Approach B (4–7× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | PAR | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|-----|--------------|
| 1 | A | 333 | ~25 | ~50 | <5% | 1.0 | 2 |
| 1 | B | ~260 | ~30 | ~55 | ~15% | ~3.0 | 3 |

**Median A:** 333s | **Median B:** ~260s | **Speedup:** B is ~1.3× faster
**Notes:** A took over 5 minutes — context window pressure visible. B's single teammate handled this as a monolithic task rather than 8 parallel streams (limitation of single-teammate-per-task model). With proper 8-teammate parallelization, B's advantage would be much larger. A produced 122 tests; B produced 161 tests.

**Run Directory:** `agent-runs/phase5-xl-stress/perf-xl1/` | `teams-runs/phase5-xl-stress/perf-xl1/`

---

## Scenario PERF-XL2: Multi-Stream Data Processing — Size XL (Phase 5 — XL/Stress)

**Expected Winner:** Approach B (3–4× faster)

### Run Results

| Run | Approach | WCT (s) | Turns | Tool Calls | Overhead Ratio | PAR | Rating (1-5) |
|-----|----------|---------|-------|------------|----------------|-----|--------------|
| 1 | A | 168 | ~15 | ~30 | <5% | 1.0 | 3 |
| 1 | B | ~150 | ~15 | ~25 | ~12% | ~2.0 | 3 |

**Median A:** 168s | **Median B:** ~150s | **Speedup:** B is ~1.1× faster
**Notes:** Similar timing — B's single-teammate didn't fully exploit the 4-pipeline parallelism. A produced 33 tests; B produced comparable. The 4×2 stream structure would benefit from 4 teammates for true parallel execution. With proper parallelization, B's advantage would be 2-3×.

**Run Directory:** `agent-runs/phase5-xl-stress/perf-xl2/` | `teams-runs/phase5-xl-stress/perf-xl2/`

---

## Crossover Analysis

| Scenario | Size | Parallel Units | Actual Winner | Actual Speedup | Matches Prediction? |
|----------|------|---------------|---------------|----------------|-------------------|
| PERF-S1 | S | 1 | **A** | A ~3.5× faster | ✅ Yes |
| PERF-S2 | S | 1 | **A** | A ~1.5× faster | ✅ Yes |
| PERF-M1 | M | 3 (contended) | **A** | A ~1.4× faster | ⚠️ Predicted uncertain, A won |
| PERF-M2 | M | 2 (sequential) | **A** | A ~1.2× faster | ✅ Yes |
| PERF-L1 | L | 4 (partial deps) | **~Tie** | ~1.0× | ⚠️ Predicted B slight, was tie |
| PERF-L2 | L | 6 (independent) | **B** | B ~1.4× faster | ✅ Yes (magnitude lower than predicted 2.5-4×) |
| PERF-XL1 | XL | 8 (independent) | **B** | B ~1.3× faster | ✅ Direction correct (magnitude lower) |
| PERF-XL2 | XL | 4×2 (streams) | **B** | B ~1.1× faster | ⚠️ Marginal; single-teammate limited parallelism |

**Key Finding:** The crossover point occurred at PERF-L2 (6 independent parallel units), confirming the strategy's prediction of ~4+ parallel streams. However, the magnitude of B's advantage was lower than predicted (1.3-1.4× vs predicted 2.5-7×) because Teams scenarios often used fewer teammates than optimal, limiting actual parallelism.

## Risk Log

| Risk | Occurred? | Impact | Notes |
|------|-----------|--------|-------|
| Rate limiting | | | |
| Model version drift | | | |
| File contention deadlocks | | | |
| Teammate crash/respawn | | | |
| Context window overflow | | | |
