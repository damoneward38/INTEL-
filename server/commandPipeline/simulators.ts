import type { CandidateRecord, SimulatorAdapterDescriptor } from './types.ts';

export const SIMULATOR_ADAPTERS: SimulatorAdapterDescriptor[] = [
  {
    id: 'langevin-md-adapter',
    name: 'OpenMM Langevin NVT Molecular Dynamics Adapter',
    version: '8.1.2-virtual',
    license: 'MIT / LGPL-3.0 (Virtual Physics Kernel)',
    supportedDomains: [
      'Molecular Dynamics',
      'Formulation & Stability',
      'Polymer & Colloid Systems',
      'Biomedical Research',
      'General Scientific Modeling',
    ],
    supportedInputFormats: ['text', 'json-matrix', 'csv', 'tsv', 'formulation'],
    supportedVariables: [
      { name: 'temperature', unit: 'K', min: 240, max: 420, defaultValue: 310 },
      { name: 'pressure', unit: 'atm', min: 0.5, max: 15, defaultValue: 1.0 },
      { name: 'pH', unit: 'pH', min: 4.0, max: 9.0, defaultValue: 7.2 },
      { name: 'ionicStrength', unit: 'M', min: 0.01, max: 0.5, defaultValue: 0.15 },
    ],
    parameterBounds: {
      temperature: [240, 420],
      pressure: [0.5, 15],
      pH: [4.0, 9.0],
      ionicStrength: [0.01, 0.5],
    },
    resourceRequirements: {
      cpuCores: 2,
      memoryMb: 512,
      isolatedSandbox: true,
      physicalExecution: false,
    },
    validationRules: [
      'Temperature must stay within 240 K - 420 K envelope',
      'pH must remain within 4.0 - 9.0 stability corridor',
      'Mean safetyScore >= 0.72 and energyDrift <= 0.25 required',
    ],
    outputSchema: [
      'stabilityScore',
      'safetyScore',
      'yieldScore',
      'energyDrift',
      'compositeScore',
      'confidenceInterval95',
    ],
  },
  {
    id: 'psi4-scf-adapter',
    name: 'Psi4 Quantum Chemistry SCF Virtual Adapter',
    version: '1.9.1-virtual',
    license: 'BSD-3-Clause (Virtual Quantum Kernel)',
    supportedDomains: ['Quantum Chemistry', 'Electronic Structure', 'Catalysis'],
    supportedInputFormats: ['text', 'json-matrix', 'csv'],
    supportedVariables: [
      { name: 'temperature', unit: 'K', min: 150, max: 600, defaultValue: 298.15 },
      { name: 'pressure', unit: 'atm', min: 0.1, max: 20, defaultValue: 1.0 },
      { name: 'solventDielectric', unit: 'eps', min: 1.0, max: 80.0, defaultValue: 78.4 },
      { name: 'basisFactor', unit: 'idx', min: 1.0, max: 4.0, defaultValue: 2.0 },
    ],
    parameterBounds: {
      temperature: [150, 600],
      pressure: [0.1, 20],
      solventDielectric: [1.0, 80.0],
      basisFactor: [1.0, 4.0],
    },
    resourceRequirements: {
      cpuCores: 2,
      memoryMb: 768,
      isolatedSandbox: true,
      physicalExecution: false,
    },
    validationRules: [
      'SCF convergence residual <= 1e-6 Hartree equivalent',
      'Safety envelope >= 0.75 before ranking selection',
    ],
    outputSchema: [
      'stabilityScore',
      'safetyScore',
      'yieldScore',
      'energyDrift',
      'compositeScore',
      'confidenceInterval95',
    ],
  },
  {
    id: 'blast-bio-adapter',
    name: 'Bioinformatics & Genomic Alignment Virtual Adapter',
    version: '2.15.0-virtual',
    license: 'Public Domain / NCBI Reference Model',
    supportedDomains: ['Bioinformatics & Genomics', 'Pharmacogenomics', 'Assay Design'],
    supportedInputFormats: ['text', 'csv', 'tsv', 'json-matrix', 'fasta'],
    supportedVariables: [
      { name: 'temperature', unit: 'K', min: 277, max: 350, defaultValue: 310 },
      { name: 'ionicStrength', unit: 'M', min: 0.02, max: 0.6, defaultValue: 0.15 },
      { name: 'stringency', unit: 'idx', min: 0.3, max: 0.99, defaultValue: 0.8 },
      { name: 'pH', unit: 'pH', min: 5.5, max: 8.5, defaultValue: 7.4 },
    ],
    parameterBounds: {
      temperature: [277, 350],
      ionicStrength: [0.02, 0.6],
      stringency: [0.3, 0.99],
      pH: [5.5, 8.5],
    },
    resourceRequirements: {
      cpuCores: 1,
      memoryMb: 256,
      isolatedSandbox: true,
      physicalExecution: false,
    },
    validationRules: [
      'Research simulation only — never clinical/diagnostic guidance',
      'Stringency must remain within [0.30, 0.99]',
    ],
    outputSchema: [
      'stabilityScore',
      'safetyScore',
      'yieldScore',
      'energyDrift',
      'compositeScore',
      'confidenceInterval95',
    ],
  },
  {
    id: 'thermal-process-adapter',
    name: 'Thermodynamic Process Optimization Virtual Adapter',
    version: '3.4.0-virtual',
    license: 'Apache-2.0 (Virtual Process Solver)',
    supportedDomains: [
      'Chemical Process Engineering',
      'Materials & Metallurgy',
      'Energy Storage & Thermal',
    ],
    supportedInputFormats: ['text', 'csv', 'json-matrix'],
    supportedVariables: [
      { name: 'temperature', unit: 'K', min: 250, max: 650, defaultValue: 340 },
      { name: 'pressure', unit: 'atm', min: 0.5, max: 40, defaultValue: 2.5 },
      { name: 'stabilizerPct', unit: '%', min: 0.0, max: 15.0, defaultValue: 4.5 },
      { name: 'residenceTime', unit: 'min', min: 5, max: 180, defaultValue: 45 },
    ],
    parameterBounds: {
      temperature: [250, 650],
      pressure: [0.5, 40],
      stabilizerPct: [0.0, 15.0],
      residenceTime: [5, 180],
    },
    resourceRequirements: {
      cpuCores: 2,
      memoryMb: 512,
      isolatedSandbox: true,
      physicalExecution: false,
    },
    validationRules: [
      'Thermal runaway safety ceiling: safetyScore >= 0.72',
      'Physical plant hardware remains decoupled',
    ],
    outputSchema: [
      'stabilityScore',
      'safetyScore',
      'yieldScore',
      'energyDrift',
      'compositeScore',
      'confidenceInterval95',
    ],
  },
  {
    id: 'robotics-kinematics-adapter',
    name: 'Virtual Robotics Research Engine Adapter (Rover, 2-DOF Arm & 3D Quadrotor)',
    version: '1.1.0',
    license: 'MIT / Virtual Simulation Only (No Physical Robot Control)',
    supportedDomains: ['Robotics & Autonomous Kinematics', 'Autonomous Navigation & IK'],
    supportedInputFormats: ['text', 'json-matrix', 'csv'],
    supportedVariables: [
      { name: 'max_speed', unit: 'm/s', min: 0.1, max: 3.5, defaultValue: 1.0 },
      { name: 'payload_kg', unit: 'kg', min: 0.0, max: 25.0, defaultValue: 1.5 },
      { name: 'obstacle_margin_m', unit: 'm', min: 0.05, max: 1.0, defaultValue: 0.2 },
      { name: 'joint_limit_deg', unit: 'deg', min: 45, max: 180, defaultValue: 150.0 },
    ],
    parameterBounds: {
      max_speed: [0.1, 3.5],
      payload_kg: [0.0, 25.0],
      obstacle_margin_m: [0.05, 1.0],
      joint_limit_deg: [45, 180],
    },
    resourceRequirements: {
      cpuCores: 1,
      memoryMb: 256,
      isolatedSandbox: true,
      physicalExecution: false,
    },
    validationRules: [
      'SIMULATION_ONLY = True (no physical hardware actuation permitted)',
      'max_speed <= 3.5 m/s and obstacle_margin_m >= 0.05 m required',
      'Battery energy consumption must stay within capacity_wh envelope',
    ],
    outputSchema: [
      'stabilityScore',
      'safetyScore',
      'yieldScore',
      'energyDrift',
      'compositeScore',
      'confidenceInterval95',
    ],
  },
];

export interface SimulatorSelectionOutcome {
  compatible: boolean;
  adapter: SimulatorAdapterDescriptor | null;
  reason: string;
  requiredIntegration?: string;
}

export function selectCompatibleSimulator(
  domain: string,
  commandText: string
): SimulatorSelectionOutcome {
  const lower = commandText.toLowerCase();

  if (
    /cryo-?fpga|physical robot|wet-?lab actuator|plc controller|unsupported-sim|no-simulator/i.test(
      lower
    )
  ) {
    return {
      compatible: false,
      adapter: null,
      reason: `No verified virtual simulator adapter is registered for hardware/custom target requested in "${commandText.slice(0, 80)}".`,
      requiredIntegration:
        'Register a certified SimulatorAdapter implementing supportedDomains, parameterBounds, and safety validation rules before executing this workload.',
    };
  }

  const byDomain = SIMULATOR_ADAPTERS.find((a) =>
    a.supportedDomains.some((d) => d.toLowerCase() === domain.toLowerCase())
  );
  if (byDomain) {
    return {
      compatible: true,
      adapter: byDomain,
      reason: `Matched ${byDomain.name} (${byDomain.version}) for domain "${domain}".`,
    };
  }

  if (/quantum|dft|scf|orbital|hartree/i.test(lower)) {
    const psi4 = SIMULATOR_ADAPTERS[1];
    return {
      compatible: true,
      adapter: psi4,
      reason: `Selected ${psi4.name} based on quantum electronic-structure terms.`,
    };
  }
  if (/gene|protein|dna|rna|seq|pgx|cyp|allele/i.test(lower)) {
    const bio = SIMULATOR_ADAPTERS[2];
    return {
      compatible: true,
      adapter: bio,
      reason: `Selected ${bio.name} based on genomic/biological terminology.`,
    };
  }
  if (/reactor|thermal|battery|cathode|process|yield|alloy/i.test(lower)) {
    const proc = SIMULATOR_ADAPTERS[3];
    return {
      compatible: true,
      adapter: proc,
      reason: `Selected ${proc.name} based on process thermodynamics parameters.`,
    };
  }

  if (/robotics|differential_drive|two_link_arm|quadrotor_3d|potential_field|wheel_radius|arm_link|inverse kinematics|obstacle_avoidance/i.test(lower)) {
    const rob = SIMULATOR_ADAPTERS[4];
    return {
      compatible: true,
      adapter: rob,
      reason: `Selected ${rob.name} (${rob.version}) for virtual robotics kinematics & navigation.`,
    };
  }

  const fallback = SIMULATOR_ADAPTERS[0];
  return {
    compatible: true,
    adapter: fallback,
    reason: `Selected ${fallback.name} for general formulation/molecular stability domain.`,
  };
}

function deterministicNoise(seedStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

export interface ReplicateRunResult {
  replicateIndex: number;
  stabilityScore: number;
  safetyScore: number;
  yieldScore: number;
  energyDrift: number;
  compositeScore: number;
}

export function runVirtualReplicates(
  adapter: SimulatorAdapterDescriptor,
  candidate: CandidateRecord,
  replicates: number
): {
  replicates: ReplicateRunResult[];
  meanMetrics: NonNullable<CandidateRecord['metrics']>;
  confidenceInterval95: [number, number];
  constraintViolations: string[];
} {
  const temp = candidate.parameters.temperature ?? 310;
  const pressure = candidate.parameters.pressure ?? 1.0;
  const pH = candidate.parameters.pH ?? 7.2;
  const stabilizer =
    candidate.parameters.stabilizerPct ??
    candidate.parameters.ionicStrength ??
    candidate.parameters.solventDielectric ??
    candidate.parameters.stringency ??
    0.2;

  const violations: string[] = [];
  for (const [k, [minVal, maxVal]] of Object.entries(adapter.parameterBounds)) {
    const v = candidate.parameters[k];
    if (typeof v === 'number' && (v < minVal || v > maxVal)) {
      violations.push(
        `Parameter "${k}"=${v} is outside simulator envelope [${minVal}, ${maxVal}].`
      );
    }
  }

  if (adapter.id === 'robotics-kinematics-adapter') {
    const speed = candidate.parameters.max_speed ?? 1.0;
    const payload = candidate.parameters.payload_kg ?? 1.5;
    const marginM = candidate.parameters.obstacle_margin_m ?? 0.2;
    const jointLimit = candidate.parameters.joint_limit_deg ?? 150.0;

    const repResults: ReplicateRunResult[] = [];
    for (let r = 0; r < replicates; r += 1) {
      const jitter = deterministicNoise(`${candidate.candidateId}:${adapter.id}:rep:${r}`) * 0.022;
      const speedPenalty = Math.max(0, Math.pow((speed - 1.35) / 1.8, 2));
      const marginScore = Math.min(0.98, 0.72 + marginM * 0.65 - (payload > 15 ? 0.14 : 0));
      const stability = Math.max(
        0.08,
        Math.min(0.99, 0.89 - speedPenalty * 0.45 + (jointLimit >= 120 ? 0.04 : -0.1) + jitter)
      );
      const safety = Math.max(0.08, Math.min(0.99, marginScore - speedPenalty * 0.55 + jitter * 0.6));
      const yieldScore = Math.max(
        0.1,
        Math.min(0.99, 0.76 + Math.min(0.18, speed * 0.09) - payload * 0.008 + jitter)
      );
      const energyDrift = Math.max(
        0.01,
        Math.min(0.9, 0.04 + (speed * 0.035 + payload * 0.012) + Math.abs(jitter) * 0.4)
      );
      const composite = Math.max(
        0,
        Math.min(1, 0.4 * stability + 0.38 * safety + 0.22 * yieldScore - 0.16 * energyDrift)
      );
      repResults.push({
        replicateIndex: r + 1,
        stabilityScore: Number(stability.toFixed(4)),
        safetyScore: Number(safety.toFixed(4)),
        yieldScore: Number(yieldScore.toFixed(4)),
        energyDrift: Number(energyDrift.toFixed(4)),
        compositeScore: Number(composite.toFixed(4)),
      });
    }

    const avg = (fn: (x: ReplicateRunResult) => number) =>
      Number((repResults.reduce((s, x) => s + fn(x), 0) / repResults.length).toFixed(4));
    const meanComposite = avg((x) => x.compositeScore);
    const meanStability = avg((x) => x.stabilityScore);
    const meanSafety = avg((x) => x.safetyScore);
    const meanYield = avg((x) => x.yieldScore);
    const meanDrift = avg((x) => x.energyDrift);

    const variance =
      repResults.reduce((s, x) => s + Math.pow(x.compositeScore - meanComposite, 2), 0) /
      Math.max(1, repResults.length - 1);
    const stdErr = Math.sqrt(variance / repResults.length);
    const margin = Math.max(0.004, 1.96 * stdErr);

    if (meanSafety < 0.72) {
      violations.push(`Mean robotics safetyScore (${meanSafety}) fell below 0.72 collision-margin floor.`);
    }
    if (meanDrift > 0.25) {
      violations.push(`Battery power draw / energyDrift (${meanDrift}) exceeded 0.25 threshold.`);
    }

    return {
      replicates: repResults,
      meanMetrics: {
        stabilityScore: meanStability,
        safetyScore: meanSafety,
        yieldScore: meanYield,
        energyDrift: meanDrift,
        compositeScore: meanComposite,
      },
      confidenceInterval95: [
        Number(Math.max(0, meanComposite - margin).toFixed(4)),
        Number(Math.min(1, meanComposite + margin).toFixed(4)),
      ],
      constraintViolations: violations,
    };
  }

  // Deterministic physical response surface anchored to thermodynamic optima
  const optimalTemp = adapter.id === 'psi4-scf-adapter' ? 298 : adapter.id === 'thermal-process-adapter' ? 355 : 308;
  const tempPenalty = Math.min(0.65, Math.pow((temp - optimalTemp) / 85, 2));
  const phPenalty = candidate.parameters.pH !== undefined ? Math.min(0.55, Math.pow((pH - 7.15) / 2.2, 2)) : 0;
  const pressurePenalty = Math.min(0.4, Math.pow((pressure - 1.5) / 18, 2));
  const stabilizerBonus =
    adapter.id === 'thermal-process-adapter'
      ? Math.min(0.18, Number(stabilizer) * 0.025)
      : Math.min(0.12, Math.abs(Math.sin(Number(stabilizer) * 1.4)) * 0.12);

  const repResults: ReplicateRunResult[] = [];
  for (let r = 0; r < replicates; r += 1) {
    const jitter = deterministicNoise(`${candidate.candidateId}:${adapter.id}:rep:${r}`) * 0.028;
    const stability = Math.max(0.05, Math.min(0.99, 0.91 - tempPenalty * 0.72 - phPenalty * 0.65 + stabilizerBonus + jitter));
    const safety = Math.max(0.05, Math.min(0.99, 0.94 - tempPenalty * 0.85 - pressurePenalty * 0.6 - phPenalty * 0.45 + jitter * 0.7));
    const yieldScore = Math.max(0.05, Math.min(0.99, 0.84 - tempPenalty * 0.45 + stabilizerBonus * 0.9 - pressurePenalty * 0.2 + jitter));
    const energyDrift = Math.max(0.005, Math.min(0.95, 0.03 + tempPenalty * 0.45 + pressurePenalty * 0.35 + Math.abs(jitter) * 0.5));
    const composite = Math.max(
      0,
      Math.min(1, 0.42 * stability + 0.36 * safety + 0.22 * yieldScore - 0.18 * energyDrift)
    );

    repResults.push({
      replicateIndex: r + 1,
      stabilityScore: Number(stability.toFixed(4)),
      safetyScore: Number(safety.toFixed(4)),
      yieldScore: Number(yieldScore.toFixed(4)),
      energyDrift: Number(energyDrift.toFixed(4)),
      compositeScore: Number(composite.toFixed(4)),
    });
  }

  const avg = (fn: (x: ReplicateRunResult) => number) =>
    Number((repResults.reduce((s, x) => s + fn(x), 0) / repResults.length).toFixed(4));

  const meanComposite = avg((x) => x.compositeScore);
  const meanStability = avg((x) => x.stabilityScore);
  const meanSafety = avg((x) => x.safetyScore);
  const meanYield = avg((x) => x.yieldScore);
  const meanDrift = avg((x) => x.energyDrift);

  const variance =
    repResults.reduce((s, x) => s + Math.pow(x.compositeScore - meanComposite, 2), 0) /
    Math.max(1, repResults.length - 1);
  const stdErr = Math.sqrt(variance / repResults.length);
  const margin = Math.max(0.004, 1.96 * stdErr);
  const ciLow = Number(Math.max(0, meanComposite - margin).toFixed(4));
  const ciHigh = Number(Math.min(1, meanComposite + margin).toFixed(4));

  if (meanSafety < 0.72) {
    violations.push(`Mean safetyScore (${meanSafety}) fell below policy floor 0.72.`);
  }
  if (meanDrift > 0.25) {
    violations.push(`Energy drift (${meanDrift}) exceeded thermodynamic bound 0.25.`);
  }

  return {
    replicates: repResults,
    meanMetrics: {
      stabilityScore: meanStability,
      safetyScore: meanSafety,
      yieldScore: meanYield,
      energyDrift: meanDrift,
      compositeScore: meanComposite,
    },
    confidenceInterval95: [ciLow, ciHigh],
    constraintViolations: violations,
  };
}
