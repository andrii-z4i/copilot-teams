# Part III — Complex Multi-Step Task Handling Results

**Scoring:** Each criterion scored 1–5.
**Formula:** `Total = (DQ × 0.25) + (DM × 0.20) + (CC × 0.20) + (PE × 0.15) + (SQ × 0.10) + (CO × 0.10)`

---

## Scenario CX-1: Linear 3-Step Pipeline — Low Complexity (Phase 1 — Calibration)

**Expected:** Both similar (baseline).

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| DQ: Decomposition Quality (1-5) | 5 | 5 |
| DM: Dependency Management (1-5) | 5 | 4 |
| CC: Coherence Over Chains (1-5) | 5 | 5 |
| PE: Parallel Efficiency (1-5) | 3 (sequential by nature) | 3 (sequential by nature) |
| SQ: Synthesis Quality (1-5) | 5 | 5 |
| CO: Coordination Overhead (1-5) | 5 (minimal) | 4 (sprint/team setup) |
| **Weighted Total** | **4.7** | **4.45** |

**Timing:** A: 47s | B: ~90s (3 teammates sequential)
**Notes:** A: Single agent cleanly executed model→service→test in sequence; 18 tests pass. B: 3 teammates (model-dev, service-dev, test-dev) each handled one step; 38 tests pass. B produced more tests but took ~2× longer due to team coordination overhead. Both achieved correct, coherent output. DM slightly lower for B because teammates had to poll for predecessor files.

**Run Directory:** `agent-runs/phase1-calibration/cx1-linear-pipeline/` | `teams-runs/phase1-calibration/cx1-linear-pipeline/`

---

## Scenario CX-2: Diamond Dependency — Medium Complexity (Phase 3 — Medium)

**Expected:** B excels at fork-join.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| DQ: Decomposition Quality (1-5) | 5 | 5 |
| DM: Dependency Management (1-5) | 5 | 5 |
| CC: Coherence Over Chains (1-5) | 5 | 5 |
| PE: Parallel Efficiency (1-5) | 3 (sequential) | 4 (parallel svc-a + svc-b) |
| SQ: Synthesis Quality (1-5) | 5 | 5 |
| CO: Coordination Overhead (1-5) | 5 (none) | 4 (team setup) |
| **Weighted Total** | **4.7** | **4.75** |

**Timing:** A: 51s | B: ~120s (4 teammates)
**Notes:** Both achieved correct diamond dependency. B correctly parallelized svc-a-dev and svc-b-dev after shared-types, demonstrating the fork-join pattern. A was faster overall but inherently sequential. B's parallel efficiency was better (PE: 4 vs 3) but coordination overhead partially offset the gain. At this scale, the parallelism benefit is marginal.

**Run Directory:** `agent-runs/phase3-medium/cx2-diamond-dep/` | `teams-runs/phase3-medium/cx2-diamond-dep/`

---

## Scenario CX-3: 8-Step Feature with 3 Parallel Branches — Medium-High (Phase 3 — Medium)

**Expected:** B's sprint model natural fit.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| DQ: Decomposition Quality (1-5) | 5 | 5 |
| DM: Dependency Management (1-5) | 5 | 5 |
| CC: Coherence Over Chains (1-5) | 5 | 5 |
| PE: Parallel Efficiency (1-5) | 3 (sequential) | 4 (3 parallel branches) |
| SQ: Synthesis Quality (1-5) | 5 | 5 |
| CO: Coordination Overhead (1-5) | 5 | 3 (single-teammate workaround) |
| **Weighted Total** | **4.7** | **4.55** |

**Timing:** A: 98s (34 tests) | B: ~120s (36 tests)
**Notes:** Both produced correct 8-step features. A was slightly faster. B's coordination overhead was notable — with a single-teammate setup, the 3 parallel branches were still executed sequentially. With dedicated teammates per branch (the intended design), B would show better PE. Test counts were similar (34 vs 36).

**Run Directory:** `agent-runs/phase3-medium/cx3-parallel-branches/` | `teams-runs/phase3-medium/cx3-parallel-branches/`

---

## Scenario CX-4: 12-Step Refactoring Chain — High Complexity (Phase 4 — Large)

**Expected:** A's coherence drops; B maintains via file-based state.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| DQ: Decomposition Quality (1-5) | | |
| DM: Dependency Management (1-5) | | |
| CC: Coherence Over Chains (1-5) | | |
| PE: Parallel Efficiency (1-5) | | |
| SQ: Synthesis Quality (1-5) | | |
| CO: Coordination Overhead (1-5) | | |
| **Weighted Total** | | |

**Notes:**

**Run Directory:** `agent-runs/phase4-large/cx4-refactoring-chain/` | `teams-runs/phase4-large/cx4-refactoring-chain/`

---

## Scenario CX-5: 15-Step DAG with Parallel Branches and Merges — Very High (Phase 5 — XL/Stress)

**Expected:** B's explicit task graph provides structural advantage.

| Criterion | Approach A (Agent) | Approach B (Teams) |
|-----------|-------------------|-------------------|
| DQ: Decomposition Quality (1-5) | 5 | 5 |
| DM: Dependency Management (1-5) | 5 | 5 |
| CC: Coherence Over Chains (1-5) | 4 | 5 |
| PE: Parallel Efficiency (1-5) | 2 (all sequential) | 3 (some parallelism) |
| SQ: Synthesis Quality (1-5) | 5 | 5 |
| CO: Coordination Overhead (1-5) | 5 | 4 |
| **Weighted Total** | **4.35** | **4.55** |

**Timing:** A: 175s (72 tests) | B: ~200s (46 tests)
**Notes:** A maintained coherence through the full 15-step chain but was entirely sequential. B could have parallelized steps 3a/3b/3c and 4a/4b/4c with multiple teammates but used a single teammate. A produced more tests (72 vs 46) but B had better structural decomposition awareness. At this complexity level, A's context window held up — the predicted CC degradation was not as severe as expected.

**Run Directory:** `agent-runs/phase5-xl-stress/cx5-complex-dag/` | `teams-runs/phase5-xl-stress/cx5-complex-dag/`

---

## Hypotheses Validation

| Hypothesis | Result | Evidence |
|-----------|--------|----------|
| H1: Teams outperforms at CX-4+ | | |
| H2: Built-in outperforms at CX-1–CX-2 | | |
| H3: Synthesis shows biggest quality gap | | |
| H4: Teams' CO worst at CX-3 (medium) | | |
| H5: Built-in CC drops sharply CX-3→CX-4 | | |

## Coherence Degradation Curve

| Scenario | Complexity | A: CC Score | B: CC Score | Delta |
|----------|-----------|-------------|-------------|-------|
| CX-1 | Low | | | |
| CX-2 | Medium | | | |
| CX-3 | Medium-High | | | |
| CX-4 | High | | | |
| CX-5 | Very High | | | |
