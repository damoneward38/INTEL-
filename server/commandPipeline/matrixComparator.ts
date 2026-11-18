import crypto from 'node:crypto';
import { z } from 'zod';
import {
  DEFAULT_AVOIDANCE_ROBOT_CONFIG,
  runRoboticsEnginePython,
  type RoboticsReportRecord,
} from './roboticsBridge.ts';
import {
  SIMULATOR_ADAPTERS,
  runVirtualReplicates,
  selectCompatibleSimulator,
} from './simulators.ts';
import { appendAuditChainEntry } from './sqliteStore.ts';
import type { CandidateRecord } from './types.ts';

export const matrixInputSchema = z.object({
  matrices: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        rows: z
          .array(z.record(z.string(), z.union([z.number(), z.string()])))
          .min(1)
          .max(20),
      })
    )
    .min(2)
    .max(5),
  domain: z.string().trim().max(100).optional(),
  simulatorId: z.string().trim().max(80).optional(),
  replicates: z.number().int().min(2).max(12).default(4),
  verifyWithRoboticsPython: z.boolean().default(false),
});

export type MatrixComparisonInput = z.infer<typeof matrixInputSchema>;

export interface ParameterDiffSummary {
  parameter: string;
  unit: string;
  bounds: [number, number] | null;
  min: number;
  max: number;
  mean: number;
  spread: number;
  presentInMatrices: string[];
  missingInMatrices: string[];
  matrixMeans: Record<string, number | null>;
  deltaVsFirstMatrix: Record<string, number | null>;
}

export interface EvaluatedMatrixCandidate {
  matrixName: string;
  rowIndex: number;
  candidateId: string;
  label: string;
  parameters: Record<string, number>;
  metrics: NonNullable<CandidateRecord['metrics']>;
  confidenceInterval95: [number, number];
  status: 'accepted' | 'rejected' | 'selected';
  paretoOptimal: boolean;
  constraintViolations: string[];
  deltaFromBaseline: Record<string, number>;
  rationale: string;
  recommendedFix: string | null;
}

export interface MatrixComparisonResult {
  comparisonId: string;
  createdAt: string;
  domain: string;
  simulatorId: string;
  simulatorName: string;
  replicatesPerCandidate: number;
  matrixNames: string[];
  parameterDiffs: ParameterDiffSummary[];
  evaluatedCandidates: EvaluatedMatrixCandidate[];
  paretoCandidateIds: string[];
  winnerCandidateId: string | null;
  roboticsVerificationReport: RoboticsReportRecord | null;
  sha256: string;
}

export const MATRIX_COMPARISON_PRESETS = [
  {
    id: 'formulation-three-matrix',
    title: 'Three-Matrix Formulation Stability Study',
    domain: 'Formulation & Stability',
    simulatorId: 'langevin-md-adapter',
    matrices: [
      {
        name: 'Matrix A (Baseline Buffer)',
        rows: [
          { temperature: 300, pressure: 1.0, pH: 7.2, ionicStrength: 0.14 },
          { temperature: 312, pressure: 1.2, pH: 7.0, ionicStrength: 0.16 },
        ],
      },
      {
        name: 'Matrix B (Cryo-Stabilized)',
        rows: [
          { temperature: 294, pressure: 1.0, pH: 7.15, ionicStrength: 0.12 },
          { temperature: 308, pressure: 1.1, pH: 7.18, ionicStrength: 0.15 },
        ],
      },
      {
        name: 'Matrix C (Thermal Stress)',
        rows: [
          { temperature: 405, pressure: 11.5, pH: 4.3, ionicStrength: 0.44 },
          { temperature: 445, pressure: 14.0, pH: 3.6, ionicStrength: 0.52 },
        ],
      },
    ],
  },
  {
    id: 'robotics-parameter-sweep',
    title: 'Robotics Rover Speed vs Obstacle-Margin Sweep',
    domain: 'Robotics & Autonomous Kinematics',
    simulatorId: 'robotics-kinematics-adapter',
    matrices: [
      {
        name: 'Matrix A (Conservative Fleet)',
        rows: [
          { max_speed: 0.7, payload_kg: 1.5, obstacle_margin_m: 0.25, joint_limit_deg: 150 },
          { max_speed: 0.9, payload_kg: 2.0, obstacle_margin_m: 0.22, joint_limit_deg: 150 },
        ],
      },
      {
        name: 'Matrix B (High-Throughput Corridor)',
        rows: [
          { max_speed: 1.25, payload_kg: 2.0, obstacle_margin_m: 0.3, joint_limit_deg: 150 },
          { max_speed: 1.45, payload_kg: 3.0, obstacle_margin_m: 0.28, joint_limit_deg: 150 },
        ],
      },
      {
        name: 'Matrix C (Over-Speed Margin Failure)',
        rows: [
          { max_speed: 3.1, payload_kg: 18.0, obstacle_margin_m: 0.06, joint_limit_deg: 140 },
          { max_speed: 4.1, payload_kg: 22.0, obstacle_margin_m: 0.04, joint_limit_deg: 140 },
        ],
      },
    ],
  },
  {
    id: 'thermal-process-sweep',
    title: 'Thermal Catalyst Process Corridor Comparison',
    domain: 'Chemical Process Engineering',
    simulatorId: 'thermal-process-adapter',
    matrices: [
      {
        name: 'Matrix A (Nominal Reactor)',
        rows: [
          { temperature: 350, pressure: 2.2, stabilizerPct: 5.0, residenceTime: 45 },
          { temperature: 360, pressure: 2.6, stabilizerPct: 6.5, residenceTime: 55 },
        ],
      },
      {
        name: 'Matrix B (Elevated Stabilizer)',
        rows: [
          { temperature: 354, pressure: 1.8, stabilizerPct: 9.0, residenceTime: 60 },
          { temperature: 372, pressure: 3.0, stabilizerPct: 8.5, residenceTime: 50 },
        ],
      },
      {
        name: 'Matrix C (Runaway Envelope)',
        rows: [
          { temperature: 510, pressure: 26.0, stabilizerPct: 0.5, residenceTime: 160 },
          { temperature: 690, pressure: 35.0, stabilizerPct: 0.0, residenceTime: 190 },
        ],
      },
    ],
  },
];

function computeRecommendedFix(
  params: Record<string, number>,
  violations: string[],
  boundsMap: Record<string, [number, number]>,
  defaultsMap: Record<string, number>
): string | null {
  if (violations.length === 0) return null;
  const fixes: string[] = [];
  for (const [k, [minV, maxV]] of Object.entries(boundsMap)) {
    const val = params[k];
    if (typeof val !== 'number') continue;
    if (val < minV) {
      fixes.push(`Increase ${k} from ${val} to >= ${minV}`);
    } else if (val > maxV) {
      fixes.push(`Clamp ${k} from ${val} to <= ${maxV} (recommended ${defaultsMap[k] ?? maxV})`);
    }
  }
  if (fixes.length === 0) {
    const firstKey = Object.keys(defaultsMap)[0];
    if (firstKey) {
      fixes.push(
        `Shift ${firstKey} closer to calibrated center (${defaultsMap[firstKey]}) to satisfy safety floor >= 0.72 and energyDrift <= 0.25`
      );
    }
  }
  return fixes.join('; ');
}

export async function compareMatricesAndEvaluate(
  rawInput: unknown,
  actorId = 'system'
): Promise<MatrixComparisonResult> {
  const input = matrixInputSchema.parse(rawInput);

  const explicitAdapter = input.simulatorId
    ? SIMULATOR_ADAPTERS.find((a) => a.id === input.simulatorId) ?? null
    : null;
  const selection = explicitAdapter
    ? { adapter: explicitAdapter, compatible: true }
    : selectCompatibleSimulator(
        input.domain ?? 'Formulation & Stability',
        JSON.stringify(input.matrices[0]?.rows[0] ?? {})
      );

  const adapter = selection.adapter ?? SIMULATOR_ADAPTERS[0];
  const domain = input.domain || adapter.supportedDomains[0];

  const baseDefaults: Record<string, number> = {};
  const unitMap: Record<string, string> = {};
  for (const v of adapter.supportedVariables) {
    baseDefaults[v.name] = v.defaultValue;
    unitMap[v.name] = v.unit;
  }

  // Collect all numeric keys appearing across any matrix row plus adapter variables
  const allKeys = new Set<string>(Object.keys(baseDefaults));
  for (const mat of input.matrices) {
    for (const row of mat.rows) {
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          allKeys.add(k);
        }
      }
    }
  }

  const parameterList = Array.from(allKeys);
  const firstMatrixName = input.matrices[0].name;

  // Build structural & statistical diff across matrices
  const parameterDiffs: ParameterDiffSummary[] = [];
  for (const param of parameterList) {
    const presentInMatrices: string[] = [];
    const missingInMatrices: string[] = [];
    const matrixMeans: Record<string, number | null> = {};
    const allValues: number[] = [];

    for (const mat of input.matrices) {
      const vals = mat.rows
        .map((r) => r[param])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (vals.length > 0) {
        presentInMatrices.push(mat.name);
        const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
        matrixMeans[mat.name] = Number(avg.toFixed(4));
        allValues.push(...vals);
      } else {
        missingInMatrices.push(mat.name);
        matrixMeans[mat.name] = null;
      }
    }

    if (allValues.length === 0) continue;

    const firstMean = matrixMeans[firstMatrixName];
    const deltaVsFirstMatrix: Record<string, number | null> = {};
    for (const mat of input.matrices) {
      const mMean = matrixMeans[mat.name];
      deltaVsFirstMatrix[mat.name] =
        firstMean !== null && mMean !== null ? Number((mMean - firstMean).toFixed(4)) : null;
    }

    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    const meanVal = allValues.reduce((s, x) => s + x, 0) / allValues.length;
    parameterDiffs.push({
      parameter: param,
      unit: unitMap[param] ?? 'unit',
      bounds: adapter.parameterBounds[param] ?? null,
      min: Number(minVal.toFixed(4)),
      max: Number(maxVal.toFixed(4)),
      mean: Number(meanVal.toFixed(4)),
      spread: Number((maxVal - minVal).toFixed(4)),
      presentInMatrices,
      missingInMatrices,
      matrixMeans,
      deltaVsFirstMatrix,
    });
  }

  // Baseline first row parameters for per-candidate delta computation
  const baselineParams: Record<string, number> = { ...baseDefaults };
  const firstRow = input.matrices[0].rows[0] ?? {};
  for (const k of Object.keys(baseDefaults)) {
    const raw = firstRow[k];
    if (typeof raw === 'number' && Number.isFinite(raw)) baselineParams[k] = raw;
  }

  const evaluatedCandidates: EvaluatedMatrixCandidate[] = [];
  let idxCounter = 0;

  for (const mat of input.matrices) {
    mat.rows.forEach((row, rIdx) => {
      idxCounter += 1;
      const candidateId = `mtx-cand-${idxCounter}`;
      const params: Record<string, number> = { ...baseDefaults };
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          params[k] = v;
        }
      }

      const cand: CandidateRecord = {
        candidateId,
        batch: 1,
        label: `${mat.name} #${rIdx + 1}`,
        parameters: params,
        status: 'pending',
        reason: `Row ${rIdx + 1} from ${mat.name}`,
        replicatesCompleted: 0,
        replicatesTotal: input.replicates,
        metrics: null,
        confidenceInterval95: null,
        constraintViolations: [],
      };

      const simOut = runVirtualReplicates(adapter, cand, input.replicates);
      const passed = simOut.constraintViolations.length === 0;
      const deltaFromBaseline: Record<string, number> = {};
      for (const [k, v] of Object.entries(params)) {
        const baseVal = baselineParams[k] ?? v;
        deltaFromBaseline[k] = Number((v - baseVal).toFixed(4));
      }

      evaluatedCandidates.push({
        matrixName: mat.name,
        rowIndex: rIdx + 1,
        candidateId,
        label: cand.label,
        parameters: params,
        metrics: simOut.meanMetrics,
        confidenceInterval95: simOut.confidenceInterval95,
        status: passed ? 'accepted' : 'rejected',
        paretoOptimal: false,
        constraintViolations: simOut.constraintViolations,
        deltaFromBaseline,
        rationale: passed
          ? `Compliant across ${input.replicates} virtual replicates (composite=${simOut.meanMetrics.compositeScore}, safety=${simOut.meanMetrics.safetyScore}).`
          : simOut.constraintViolations.join(' '),
        recommendedFix: computeRecommendedFix(
          params,
          simOut.constraintViolations,
          adapter.parameterBounds,
          baseDefaults
        ),
      });
    });
  }

  // Compute Pareto frontier among accepted candidates (maximizing compositeScore & safetyScore)
  const accepted = evaluatedCandidates.filter((c) => c.status === 'accepted');
  const paretoCandidateIds: string[] = [];
  for (const cand of accepted) {
    const dominated = accepted.some(
      (other) =>
        other.candidateId !== cand.candidateId &&
        other.metrics.compositeScore >= cand.metrics.compositeScore &&
        other.metrics.safetyScore >= cand.metrics.safetyScore &&
        (other.metrics.compositeScore > cand.metrics.compositeScore ||
          other.metrics.safetyScore > cand.metrics.safetyScore)
    );
    if (!dominated) {
      cand.paretoOptimal = true;
      paretoCandidateIds.push(cand.candidateId);
    }
  }

  // Select top winner (highest lower-95%-CI bound among accepted candidates)
  let winnerCandidateId: string | null = null;
  if (accepted.length > 0) {
    const sorted = [...accepted].sort(
      (a, b) =>
        b.confidenceInterval95[0] +
        b.metrics.safetyScore * 0.25 -
        (a.confidenceInterval95[0] + a.metrics.safetyScore * 0.25)
    );
    sorted[0].status = 'selected';
    winnerCandidateId = sorted[0].candidateId;
  }

  let roboticsVerificationReport: RoboticsReportRecord | null = null;
  if (input.verifyWithRoboticsPython && adapter.id === 'robotics-kinematics-adapter') {
    const winner =
      evaluatedCandidates.find((c) => c.candidateId === winnerCandidateId) ??
      evaluatedCandidates[0];
    const robCfg = {
      ...DEFAULT_AVOIDANCE_ROBOT_CONFIG,
      robot: {
        ...DEFAULT_AVOIDANCE_ROBOT_CONFIG.robot,
        max_speed: winner?.parameters.max_speed ?? DEFAULT_AVOIDANCE_ROBOT_CONFIG.robot.max_speed,
        payload_kg: winner?.parameters.payload_kg ?? DEFAULT_AVOIDANCE_ROBOT_CONFIG.robot.payload_kg,
        joint_limit_deg:
          winner?.parameters.joint_limit_deg ??
          DEFAULT_AVOIDANCE_ROBOT_CONFIG.robot.joint_limit_deg,
      },
      simulation: {
        ...DEFAULT_AVOIDANCE_ROBOT_CONFIG.simulation,
        obstacle_margin_m:
          winner?.parameters.obstacle_margin_m ??
          DEFAULT_AVOIDANCE_ROBOT_CONFIG.simulation?.obstacle_margin_m ??
          0.2,
      },
    };
    const pyRes = await runRoboticsEnginePython(robCfg, actorId);
    roboticsVerificationReport = pyRes.report;
  }

  const comparisonId = `mtx-cmp-${crypto.randomUUID().slice(0, 8)}`;
  const payloadWithoutHash = {
    comparisonId,
    domain,
    simulatorId: adapter.id,
    matrixNames: input.matrices.map((m) => m.name),
    parameterDiffs,
    evaluatedCandidates: evaluatedCandidates.map((c) => ({
      candidateId: c.candidateId,
      status: c.status,
      metrics: c.metrics,
    })),
    winnerCandidateId,
  };
  const sha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(payloadWithoutHash))
    .digest('hex');

  appendAuditChainEntry({
    jobId: comparisonId,
    eventType: 'validation.completed',
    stage: 'comparison-engine',
    actorId,
    summary: `Compared ${input.matrices.length} matrices (${evaluatedCandidates.length} rows) on ${adapter.id}; pareto=${paretoCandidateIds.length}; winner=${winnerCandidateId ?? 'none'}`,
  });

  return {
    comparisonId,
    createdAt: new Date().toISOString(),
    domain,
    simulatorId: adapter.id,
    simulatorName: adapter.name,
    replicatesPerCandidate: input.replicates,
    matrixNames: input.matrices.map((m) => m.name),
    parameterDiffs,
    evaluatedCandidates,
    paretoCandidateIds,
    winnerCandidateId,
    roboticsVerificationReport,
    sha256,
  };
}
