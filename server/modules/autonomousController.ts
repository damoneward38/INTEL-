import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.ts';
import { recordProvenance } from '../provenance.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';
import type {
  AuthSession,
  AutonomousAuditEventRecord,
  AutonomousCandidate,
  AutonomousControllerConfig,
  AutonomousEvaluation,
  AutonomousIterationPoint,
  AutonomousOverviewResponse,
  AutonomousRewardWeights,
  AutonomousRunReport,
} from '../types.ts';

export class AutonomousControllerError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const DATA_DIR = path.resolve(process.cwd(), 'autonomous_data');
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'autonomous_audit.jsonl');

export const DEFAULT_PARAMETER_BOUNDS: Record<string, [number, number]> = {
  parameter_a: [0.0, 1.0],
  parameter_b: [0.0, 1.0],
  parameter_c: [0.0, 1.0],
};

export const DEFAULT_REWARD_WEIGHTS: AutonomousRewardWeights = {
  yield: 1.0,
  toxicity: 0.2,
  cost: 0.05,
};

export const DEFAULT_AUTONOMOUS_CONFIG: AutonomousControllerConfig = {
  batchSize: 8,
  replicates: 3,
  maxIterations: 12,
  maxParallelSimulations: 4,
  targetReward: 0.75,
  confidenceLevel: 0.95,
  minSuccessfulReplicates: 3,
  maxConfidenceIntervalWidth: 0.2,
  convergencePatience: 5,
  randomSeed: 42,
  bootstrapSamples: 3000,
  parameterBounds: DEFAULT_PARAMETER_BOUNDS,
  rewardWeights: DEFAULT_REWARD_WEIGHTS,
  virtualModeConfirmed: false,
};

// Deterministic seeded PRNG (Mulberry32)
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        out[key] = stableSortValue(item);
      }
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function stableHash(value: unknown): string {
  const canonical = JSON.stringify(stableSortValue(value));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateParameters(
  parameters: Record<string, number>,
  bounds: Record<string, [number, number]> = DEFAULT_PARAMETER_BOUNDS
): void {
  const paramKeys = Object.keys(parameters).sort();
  const boundKeys = Object.keys(bounds).sort();
  if (
    paramKeys.length !== boundKeys.length ||
    paramKeys.some((k, idx) => k !== boundKeys[idx])
  ) {
    throw new AutonomousControllerError(
      400,
      'Candidate parameter keys do not match configured bounds.'
    );
  }

  for (const [name, [minimum, maximum]] of Object.entries(bounds)) {
    const val = parameters[name];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new AutonomousControllerError(400, `${name} must be a finite number.`);
    }
    if (val < minimum || val > maximum) {
      throw new AutonomousControllerError(
        400,
        `${name}=${val} is outside configured bounds [${minimum}, ${maximum}].`
      );
    }
  }
}

// ============================================================
// HASH-CHAINED APPEND-ONLY AUDIT STORE
// ============================================================

const auditEvents: AutonomousAuditEventRecord[] = [];
const completedRuns: AutonomousRunReport[] = [];
let auditCounter = 0;
let previousHash = 'GENESIS';

function loadExistingAuditChain(): void {
  if (auditEvents.length > 0) return;
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return;
    const raw = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const parsed = JSON.parse(line) as AutonomousAuditEventRecord;
      auditEvents.push(parsed);
      auditCounter = Math.max(auditCounter, parsed.id);
      previousHash = parsed.recordHash;
    }
  } catch (err) {
    logger.warn('autonomous', 'Could not reload existing autonomous audit JSONL', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

loadExistingAuditChain();

function writeAuditEvent(
  runId: string,
  event: string,
  payload: Record<string, unknown> = {}
): AutonomousAuditEventRecord {
  loadExistingAuditChain();
  auditCounter += 1;
  const baseRecord = {
    eventId: crypto.randomUUID(),
    runId,
    timestamp: new Date().toISOString(),
    event,
    payload: stableSortValue(payload) as Record<string, unknown>,
    previousHash,
  };
  const recordHash = stableHash(baseRecord);
  const fullRecord: AutonomousAuditEventRecord = {
    id: auditCounter,
    ...baseRecord,
    recordHash,
  };
  previousHash = recordHash;
  auditEvents.push(fullRecord);
  if (auditEvents.length > 4000) {
    auditEvents.shift();
  }

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(fullRecord)}\n`, 'utf8');
  } catch (err) {
    logger.warn('autonomous', 'Could not append autonomous audit record to disk', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return fullRecord;
}

export function verifyAutonomousAuditChain(runIdFilter?: string): {
  valid: boolean;
  checkedEvents: number;
  headRecordHash: string;
} {
  loadExistingAuditChain();
  let expectedPrev = 'GENESIS';
  let chainValid = true;

  for (const row of auditEvents) {
    if (row.previousHash !== expectedPrev) {
      chainValid = false;
      break;
    }
    const calculated = stableHash({
      eventId: row.eventId,
      runId: row.runId,
      timestamp: row.timestamp,
      event: row.event,
      payload: row.payload,
      previousHash: row.previousHash,
    });
    if (calculated !== row.recordHash) {
      chainValid = false;
      break;
    }
    expectedPrev = row.recordHash;
  }

  const scopedCount = runIdFilter
    ? auditEvents.filter((e) => e.runId === runIdFilter).length
    : auditEvents.length;

  return {
    valid: chainValid,
    checkedEvents: scopedCount,
    headRecordHash: previousHash,
  };
}

// ============================================================
// STATISTICAL EVALUATION & BOOTSTRAP CONFIDENCE INTERVALS
// ============================================================

export function rewardFromMetrics(
  metrics: { yield: number; toxicity: number; cost: number },
  weights: AutonomousRewardWeights = DEFAULT_REWARD_WEIGHTS
): number {
  return (
    weights.yield * metrics.yield -
    weights.toxicity * metrics.toxicity -
    weights.cost * metrics.cost
  );
}

export function bootstrapConfidenceInterval(
  values: number[],
  confidence = 0.95,
  bootstrapSamples = 3000,
  seed = 42,
  minSuccessfulReplicates = 3
): [number, number] {
  if (values.length < minSuccessfulReplicates) {
    throw new AutonomousControllerError(400, 'Not enough successful replicates.');
  }
  const rng = createSeededRng(seed);
  const means: number[] = [];

  for (let b = 0; b < bootstrapSamples; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      const idx = Math.floor(rng() * values.length);
      sum += values[idx];
    }
    means.push(sum / values.length);
  }

  means.sort((a, b) => a - b);
  const tail = (1.0 - confidence) / 2.0;
  const lowerIndex = Math.max(0, Math.floor(tail * means.length));
  const upperIndex = Math.min(
    means.length - 1,
    Math.floor((1.0 - tail) * means.length) - 1
  );

  return [means[lowerIndex], means[upperIndex]];
}

export function evaluateCandidate(
  candidate: AutonomousCandidate,
  replicateMetrics: Array<{ status: 'success' | 'failed'; metrics?: { yield: number; toxicity: number; cost: number } }>,
  config: AutonomousControllerConfig
): AutonomousEvaluation | null {
  const successful = replicateMetrics.filter(
    (r): r is { status: 'success'; metrics: { yield: number; toxicity: number; cost: number } } =>
      r.status === 'success' && Boolean(r.metrics)
  );

  if (successful.length < config.minSuccessfulReplicates) {
    return null;
  }

  const rewards = successful.map((r) =>
    rewardFromMetrics(r.metrics, config.rewardWeights)
  );
  const meanReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  const variance =
    rewards.length > 1
      ? rewards.reduce((acc, val) => acc + (val - meanReward) ** 2, 0) /
        (rewards.length - 1)
      : 0;
  const standardDeviation = Math.sqrt(variance);

  const [lower, upper] = bootstrapConfidenceInterval(
    rewards,
    config.confidenceLevel,
    config.bootstrapSamples,
    config.randomSeed + candidate.iteration,
    config.minSuccessfulReplicates
  );

  const metricsMean = {
    yield: Number(
      (
        successful.reduce((a, r) => a + r.metrics.yield, 0) / successful.length
      ).toFixed(4)
    ),
    toxicity: Number(
      (
        successful.reduce((a, r) => a + r.metrics.toxicity, 0) /
        successful.length
      ).toFixed(4)
    ),
    cost: Number(
      (
        successful.reduce((a, r) => a + r.metrics.cost, 0) / successful.length
      ).toFixed(4)
    ),
  };

  const evalSummary: AutonomousEvaluation = {
    candidateId: candidate.candidateId,
    iteration: candidate.iteration,
    parameters: candidate.parameters,
    replicateCount: successful.length,
    meanReward: Number(meanReward.toFixed(5)),
    standardDeviation: Number(standardDeviation.toFixed(5)),
    confidenceLower: Number(lower.toFixed(5)),
    confidenceUpper: Number(upper.toFixed(5)),
    confidenceWidth: Number((upper - lower).toFixed(5)),
    metricsMean,
    lockCriteriaMet: false,
  };

  evalSummary.lockCriteriaMet = lockCriteriaMet(evalSummary, config);
  return evalSummary;
}

export function lockCriteriaMet(
  evaluation: Pick<
    AutonomousEvaluation,
    'meanReward' | 'confidenceLower' | 'confidenceWidth' | 'replicateCount'
  >,
  config: AutonomousControllerConfig
): boolean {
  return (
    evaluation.meanReward >= config.targetReward &&
    evaluation.confidenceLower >= config.targetReward &&
    evaluation.confidenceWidth <= config.maxConfidenceIntervalWidth &&
    evaluation.replicateCount >= config.minSuccessfulReplicates
  );
}

// ============================================================
// VIRTUAL SIMULATOR KERNEL & POLICY ADAPTER (NO PHYSICAL EXECUTION)
// ============================================================

export function runVirtualSimulationReplicate(
  parameters: Record<string, number>,
  iteration: number,
  replicate: number,
  seedOffset = 42
): {
  status: 'completed';
  metrics: { yield: number; toxicity: number; cost: number };
  physical_execution: false;
} {
  const a = parameters.parameter_a ?? 0.5;
  const b = parameters.parameter_b ?? 0.5;
  const c = parameters.parameter_c ?? 0.5;

  // Deterministic pseudo-random replicate noise anchored on candidate + replicate
  const paramSeed =
    Math.round(a * 1000) * 131 +
    Math.round(b * 1000) * 257 +
    Math.round(c * 1000) * 521 +
    replicate * 97 +
    iteration * 31 +
    seedOffset;
  const rng = createSeededRng(paramSeed);
  const gaussianApprox = ((rng() + rng() + rng()) / 3 - 0.5) * 0.036;

  // Smooth multi-peak landscape reaching >= 0.88 net yield around optimum (0.78, 0.34, 0.62)
  const distSq =
    (a - 0.78) ** 2 * 1.45 + (b - 0.34) ** 2 * 1.35 + (c - 0.62) ** 2 * 1.25;
  const baseYield = Math.max(0.05, Math.min(0.99, 0.94 * Math.exp(-distSq * 1.65)));
  const yieldVal = Number(
    Math.max(0.01, Math.min(1.0, baseYield + gaussianApprox)).toFixed(5)
  );

  // Toxicity rises with extreme b and a
  const toxicityVal = Number(
    Math.max(
      0.01,
      Math.min(1.0, 0.08 + 0.38 * Math.max(0, b - 0.3) ** 1.4 + 0.09 * a * a + rng() * 0.012)
    ).toFixed(5)
  );

  // Resource cost scales gently with parameter magnitudes
  const costVal = Number(
    Math.max(0.02, Math.min(1.0, 0.12 + 0.18 * a + 0.14 * c + rng() * 0.01)).toFixed(5)
  );

  return {
    status: 'completed',
    metrics: {
      yield: yieldVal,
      toxicity: toxicityVal,
      cost: costVal,
    },
    physical_execution: false,
  };
}

interface PolicyRunMemory {
  bestReward: number;
  bestParameters: Record<string, number> | null;
  evaluations: Array<{ parameters: Record<string, number>; reward: number }>;
  rng: () => number;
}

const policyRunMemory = new Map<string, PolicyRunMemory>();

function getOrCreatePolicyMemory(runId: string, seed = 42): PolicyRunMemory {
  let mem = policyRunMemory.get(runId);
  if (!mem) {
    mem = {
      bestReward: Number.NEGATIVE_INFINITY,
      bestParameters: null,
      evaluations: [],
      rng: createSeededRng(seed + 777),
    };
    policyRunMemory.set(runId, mem);
  }
  return mem;
}

export function planPolicyBatch(params: {
  runId: string;
  iteration: number;
  batchSize: number;
  bestReward?: number | null;
  bestCandidate?: { parameters?: Record<string, number> } | null;
  parameterBounds?: Record<string, [number, number]>;
  seed?: number;
}): Array<{ parameters: Record<string, number> }> {
  const bounds = params.parameterBounds ?? DEFAULT_PARAMETER_BOUNDS;
  const mem = getOrCreatePolicyMemory(params.runId, params.seed ?? 42);
  if (
    params.bestCandidate?.parameters &&
    typeof params.bestReward === 'number' &&
    params.bestReward > mem.bestReward
  ) {
    mem.bestReward = params.bestReward;
    mem.bestParameters = { ...params.bestCandidate.parameters };
  }

  const batch: Array<{ parameters: Record<string, number> }> = [];
  const radius = Math.max(0.06, 0.42 * Math.exp(-0.22 * Math.max(0, params.iteration - 1)));

  for (let i = 0; i < params.batchSize; i++) {
    const candidateParams: Record<string, number> = {};
    const exploit = mem.bestParameters !== null && i < Math.ceil(params.batchSize * 0.7);

    for (const [key, [minVal, maxVal]] of Object.entries(bounds)) {
      const span = maxVal - minVal;
      let val: number;
      if (exploit && mem.bestParameters && typeof mem.bestParameters[key] === 'number') {
        const delta = (mem.rng() * 2 - 1) * radius * span;
        val = mem.bestParameters[key] + delta;
      } else {
        val = minVal + mem.rng() * span;
      }
      val = Math.max(minVal, Math.min(maxVal, val));
      candidateParams[key] = Number(val.toFixed(4));
    }

    validateParameters(candidateParams, bounds);
    batch.push({ parameters: candidateParams });
  }

  return batch;
}

export function recordPolicyFeedback(params: {
  runId: string;
  candidateId: string;
  parameters: Record<string, number>;
  reward: number;
}): { acknowledged: true; observedEvaluations: number; bestReward: number } {
  const mem = getOrCreatePolicyMemory(params.runId);
  mem.evaluations.push({ parameters: { ...params.parameters }, reward: params.reward });
  if (params.reward > mem.bestReward) {
    mem.bestReward = params.reward;
    mem.bestParameters = { ...params.parameters };
  }
  return {
    acknowledged: true,
    observedEvaluations: mem.evaluations.length,
    bestReward: mem.bestReward,
  };
}

// ============================================================
// CLOSED-LOOP AUTONOMOUS CONTROLLER RUNNER
// ============================================================

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  maxParallel: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await tasks[idx]();
    }
  }

  const poolSize = Math.min(maxParallel, Math.max(1, tasks.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

export async function runClosedLoopAutonomousSimulation(
  partialConfig: Partial<AutonomousControllerConfig>,
  session: AuthSession
): Promise<AutonomousRunReport> {
  if (!partialConfig.virtualModeConfirmed) {
    throw new AutonomousControllerError(
      400,
      'Explicit virtual simulation opt-in (virtualModeConfirmed=true) is required; physical execution is disabled.'
    );
  }

  const config: AutonomousControllerConfig = {
    batchSize: partialConfig.batchSize ?? DEFAULT_AUTONOMOUS_CONFIG.batchSize,
    replicates: partialConfig.replicates ?? DEFAULT_AUTONOMOUS_CONFIG.replicates,
    maxIterations:
      partialConfig.maxIterations ?? DEFAULT_AUTONOMOUS_CONFIG.maxIterations,
    maxParallelSimulations:
      partialConfig.maxParallelSimulations ??
      DEFAULT_AUTONOMOUS_CONFIG.maxParallelSimulations,
    targetReward: partialConfig.targetReward ?? DEFAULT_AUTONOMOUS_CONFIG.targetReward,
    confidenceLevel:
      partialConfig.confidenceLevel ?? DEFAULT_AUTONOMOUS_CONFIG.confidenceLevel,
    minSuccessfulReplicates:
      partialConfig.minSuccessfulReplicates ??
      DEFAULT_AUTONOMOUS_CONFIG.minSuccessfulReplicates,
    maxConfidenceIntervalWidth:
      partialConfig.maxConfidenceIntervalWidth ??
      DEFAULT_AUTONOMOUS_CONFIG.maxConfidenceIntervalWidth,
    convergencePatience:
      partialConfig.convergencePatience ??
      DEFAULT_AUTONOMOUS_CONFIG.convergencePatience,
    randomSeed: partialConfig.randomSeed ?? DEFAULT_AUTONOMOUS_CONFIG.randomSeed,
    bootstrapSamples:
      partialConfig.bootstrapSamples ?? DEFAULT_AUTONOMOUS_CONFIG.bootstrapSamples,
    parameterBounds:
      partialConfig.parameterBounds ?? DEFAULT_AUTONOMOUS_CONFIG.parameterBounds,
    rewardWeights:
      partialConfig.rewardWeights ?? DEFAULT_AUTONOMOUS_CONFIG.rewardWeights,
    virtualModeConfirmed: true,
  };

  if (config.replicates < config.minSuccessfulReplicates) {
    throw new AutonomousControllerError(
      400,
      `Replicates (${config.replicates}) must be >= minSuccessfulReplicates (${config.minSuccessfulReplicates}).`
    );
  }

  const runId = `auto-${crypto.randomUUID().slice(0, 8)}`;
  const evaluations: AutonomousEvaluation[] = [];
  const iterationHistory: AutonomousIterationPoint[] = [];

  let bestReward = Number.NEGATIVE_INFINITY;
  let bestCandidate: AutonomousEvaluation | null = null;
  let iterationsWithoutImprovement = 0;
  let totalSimulations = 0;
  let successfulSimulations = 0;
  let failedSimulations = 0;
  let completedIterations = 0;
  let status: AutonomousRunReport['status'] = 'max_iterations_reached';

  writeAuditEvent(runId, 'controller.started', {
    actorId: session.userId,
    batchSize: config.batchSize,
    replicates: config.replicates,
    maxIterations: config.maxIterations,
    parameterBounds: config.parameterBounds,
    physical_execution: false,
  });

  try {
    for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
      completedIterations = iteration;

      const planned = planPolicyBatch({
        runId,
        iteration,
        batchSize: config.batchSize,
        bestReward: Number.isFinite(bestReward) ? bestReward : null,
        bestCandidate,
        parameterBounds: config.parameterBounds,
        seed: config.randomSeed,
      });

      const candidates: AutonomousCandidate[] = planned.map((item) => ({
        candidateId: crypto.randomUUID(),
        iteration,
        parameters: item.parameters,
      }));

      writeAuditEvent(runId, 'candidate_batch_created', {
        iteration,
        candidateCount: candidates.length,
      });

      const simTasks = candidates.flatMap((cand) =>
        Array.from({ length: config.replicates }, (_, idx) => {
          const replicate = idx + 1;
          return async () => {
            const simOut = runVirtualSimulationReplicate(
              cand.parameters,
              iteration,
              replicate,
              config.randomSeed
            );
            await Promise.resolve();
            writeAuditEvent(runId, 'simulation_replicate', {
              candidateId: cand.candidateId,
              replicate,
              status: 'success',
              metrics: simOut.metrics,
            });
            return {
              candidateId: cand.candidateId,
              replicate,
              status: 'success' as const,
              metrics: simOut.metrics,
            };
          };
        })
      );

      const allReplicateResults = await runWithConcurrencyLimit(
        simTasks,
        config.maxParallelSimulations
      );

      totalSimulations += allReplicateResults.length;
      successfulSimulations += allReplicateResults.length;

      let iterationBest: AutonomousEvaluation | null = null;
      let convergedThisIteration = false;

      for (const candidate of candidates) {
        const candResults = allReplicateResults.filter(
          (r) => r.candidateId === candidate.candidateId
        );
        const evaluation = evaluateCandidate(candidate, candResults, config);
        if (!evaluation) {
          writeAuditEvent(runId, 'candidate_rejected', {
            candidateId: candidate.candidateId,
            reason: 'Insufficient successful replicates.',
          });
          continue;
        }

        evaluations.push(evaluation);
        writeAuditEvent(runId, 'candidate_evaluated', {
          candidateId: evaluation.candidateId,
          iteration: evaluation.iteration,
          meanReward: evaluation.meanReward,
          confidenceLower: evaluation.confidenceLower,
          confidenceUpper: evaluation.confidenceUpper,
        });

        recordPolicyFeedback({
          runId,
          candidateId: evaluation.candidateId,
          parameters: evaluation.parameters,
          reward: evaluation.meanReward,
        });

        if (!iterationBest || evaluation.meanReward > iterationBest.meanReward) {
          iterationBest = evaluation;
        }

        if (evaluation.meanReward > bestReward) {
          bestReward = evaluation.meanReward;
          bestCandidate = evaluation;
          iterationsWithoutImprovement = 0;
          writeAuditEvent(runId, 'new_best_candidate', {
            candidateId: evaluation.candidateId,
            meanReward: evaluation.meanReward,
            parameters: evaluation.parameters,
          });
        } else {
          iterationsWithoutImprovement += 1;
        }

        if (evaluation.lockCriteriaMet) {
          status = 'converged';
          bestCandidate = evaluation;
          bestReward = evaluation.meanReward;
          convergedThisIteration = true;
          writeAuditEvent(runId, 'lock_criteria_met', {
            candidateId: evaluation.candidateId,
            meanReward: evaluation.meanReward,
            confidenceLower: evaluation.confidenceLower,
            confidenceWidth: evaluation.confidenceWidth,
          });
          break;
        }
      }

      iterationHistory.push({
        iteration,
        candidatesEvaluated: candidates.length,
        iterationBestReward: iterationBest ? iterationBest.meanReward : null,
        globalBestReward: Number.isFinite(bestReward) ? bestReward : null,
        bestConfidenceLower: bestCandidate ? bestCandidate.confidenceLower : null,
        bestConfidenceUpper: bestCandidate ? bestCandidate.confidenceUpper : null,
        iterationsWithoutImprovement,
      });

      writeAuditEvent(runId, 'iteration.completed', {
        iteration,
        iterationBestReward: iterationBest?.meanReward ?? null,
        globalBestReward: Number.isFinite(bestReward) ? bestReward : null,
      });

      if (convergedThisIteration) {
        break;
      }

      if (iterationsWithoutImprovement >= config.convergencePatience) {
        status = 'stopped_no_improvement';
        writeAuditEvent(runId, 'controller.stopped', {
          reason: 'Convergence patience exhausted.',
        });
        break;
      }
    }
  } catch (err) {
    status = 'failed';
    writeAuditEvent(runId, 'controller.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const chainBeforeFinish = verifyAutonomousAuditChain(runId);
  if (!chainBeforeFinish.valid) {
    status = 'audit_integrity_failure';
  }

  const reportRelPath = `autonomous_data/reports/${runId}.json`;
  const reportAbsPath = path.join(REPORT_DIR, `${runId}.json`);
  const generatedAt = new Date().toISOString();

  writeAuditEvent(runId, 'controller.finished', {
    status,
    report: reportRelPath,
    audit_chain_valid_before_finish: chainBeforeFinish.valid,
    best_reward: Number.isFinite(bestReward) ? bestReward : null,
    physical_execution: false,
  });

  const finalChain = verifyAutonomousAuditChain(runId);

  const report: AutonomousRunReport = {
    runId,
    generatedAt,
    status,
    iterations: completedIterations,
    totalSimulations,
    successfulSimulations,
    failedSimulations,
    bestCandidate,
    bestReward: Number.isFinite(bestReward) ? bestReward : null,
    auditChainValid: finalChain.valid,
    headRecordHash: finalChain.headRecordHash,
    reportPath: reportRelPath,
    physicalExecution: false,
    config,
    iterationHistory,
    evaluations,
  };

  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(reportAbsPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    logger.warn('autonomous', 'Could not write autonomous report JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  completedRuns.unshift(report);
  if (completedRuns.length > 30) {
    completedRuns.length = 30;
  }

  recordProvenance({
    kind: 'simulation',
    actorId: session.userId,
    actorRole: session.role,
    action: `autonomous:closed-loop:${status}`,
    rawInput: JSON.stringify({ runId, bestReward: report.bestReward, status }),
    modelOrEngine: 'autonomous-virtual-controller',
    licenses: ['Virtual Simulation Only'],
    sourceUrls: [],
    metadata: {
      runId,
      iterations: report.iterations,
      totalSimulations: report.totalSimulations,
      auditChainValid: report.auditChainValid,
    },
  });

  publishFluxEvent({
    topic: 'simulation.telemetry',
    key: runId,
    actorRole: session.role,
    summary: `Closed-loop virtual controller ${status} (${report.iterations} iters, ${report.totalSimulations} sims, best=${report.bestReward ?? 'N/A'})`,
    payload: {
      runId,
      status,
      bestReward: report.bestReward,
      auditChainValid: report.auditChainValid,
      physicalExecution: false,
    },
  });

  logger.info('autonomous', 'Closed-loop virtual controller run finished', {
    runId,
    status,
    iterations: report.iterations,
    bestReward: report.bestReward,
    auditChainValid: report.auditChainValid,
  });

  return report;
}

export function getAutonomousRunReport(runId: string): AutonomousRunReport | null {
  return completedRuns.find((r) => r.runId === runId) ?? null;
}

export function getAutonomousOverview(): AutonomousOverviewResponse {
  const chain = verifyAutonomousAuditChain();
  return {
    defaultConfig: DEFAULT_AUTONOMOUS_CONFIG,
    auditChainValid: chain.valid,
    totalAuditEvents: chain.checkedEvents,
    headRecordHash: chain.headRecordHash,
    auditFilePath: 'autonomous_data/autonomous_audit.jsonl',
    runs: completedRuns.slice(0, 15),
    recentAuditEvents: auditEvents.slice(-60).reverse(),
  };
}
