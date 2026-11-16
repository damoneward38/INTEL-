import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { appendAuditChainEntry } from './sqliteStore.ts';

const execFileAsync = promisify(execFile);

export const ROBOTICS_RESULTS_DIR = path.resolve(process.cwd(), 'robotics_results');
export const ROBOTICS_CONFIGS_DIR = path.resolve(process.cwd(), 'configs');
const ROBOTICS_MANIFEST_PATH = path.resolve(process.cwd(), 'robotics_pipeline_manifest.json');
const PYTHON_SCRIPT_PATH = path.resolve(process.cwd(), 'robotics_engine.py');

export const roboticsConfigSchema = z.object({
  research: z
    .object({
      title: z.string().trim().max(200).optional(),
      source: z.string().trim().max(200).optional(),
      version: z.string().trim().max(40).optional(),
      author: z.string().trim().max(120).optional(),
      description: z.string().trim().max(1000).optional(),
    })
    .optional(),
  robot: z.object({
    name: z.string().trim().min(1).max(120),
    robot_type: z.enum(['differential_drive', 'two_link_arm']),
    wheel_radius: z.number().positive().max(2).default(0.05),
    wheel_base: z.number().positive().max(5).default(0.3),
    max_speed: z.number().positive().max(20).default(1.0),
    max_acceleration: z.number().positive().max(20).default(0.5),
    battery_capacity_wh: z.number().positive().max(50000).default(100.0),
    payload_kg: z.number().min(0).max(500).default(1.0),
    arm_link_1_m: z.number().positive().max(10).default(0.5),
    arm_link_2_m: z.number().positive().max(10).default(0.4),
    joint_limit_deg: z.number().positive().max(360).default(150.0),
  }),
  simulation: z
    .object({
      duration_s: z.number().positive().max(3600).default(20.0),
      timestep_s: z.number().positive().max(10).default(0.1),
      trials: z.number().int().min(1).max(50).default(5),
      obstacle_margin_m: z.number().min(0).max(10).default(0.15),
      target_tolerance_m: z.number().positive().max(5).default(0.1),
      seed: z.number().int().default(42),
    })
    .default({
      duration_s: 20.0,
      timestep_s: 0.1,
      trials: 5,
      obstacle_margin_m: 0.15,
      target_tolerance_m: 0.1,
      seed: 42,
    }),
  environment: z
    .object({
      start: z.tuple([z.number(), z.number()]).optional(),
      goal: z.tuple([z.number(), z.number()]).optional(),
      obstacles: z
        .array(
          z.object({
            center: z.tuple([z.number(), z.number()]),
            radius: z.number().positive().max(50),
          })
        )
        .max(100)
        .optional(),
      target: z.tuple([z.number(), z.number()]).optional(),
    })
    .default({}),
  objectives: z.array(z.string()).default(['safety', 'accuracy', 'energy', 'completion_time']),
});

export type RoboticsResearchConfig = z.infer<typeof roboticsConfigSchema>;

export interface RoboticsStreamEvent {
  job_id: string;
  sequence: number;
  timestamp: number;
  stage: string;
  status: string;
  details: Record<string, unknown>;
}

export interface RoboticsReportRecord {
  engine_version: string;
  job_id: string;
  simulation_only: boolean;
  robot: RoboticsResearchConfig['robot'];
  simulation: RoboticsResearchConfig['simulation'];
  environment: RoboticsResearchConfig['environment'];
  trials: Array<Record<string, unknown>>;
  evaluation: Record<string, unknown>;
  event_count: number;
  limitations: string[];
  sha256: string;
}

export const DEFAULT_MOBILE_ROBOT_CONFIG: RoboticsResearchConfig = {
  robot: {
    name: 'Research Mobile Robot',
    robot_type: 'differential_drive',
    wheel_radius: 0.05,
    wheel_base: 0.3,
    max_speed: 0.8,
    max_acceleration: 0.5,
    battery_capacity_wh: 100,
    payload_kg: 2,
    arm_link_1_m: 0.5,
    arm_link_2_m: 0.4,
    joint_limit_deg: 150.0,
  },
  simulation: {
    duration_s: 20,
    timestep_s: 0.1,
    trials: 5,
    obstacle_margin_m: 0.15,
    target_tolerance_m: 0.1,
    seed: 42,
  },
  environment: {
    start: [0, 0],
    goal: [4, 4],
    obstacles: [
      {
        center: [2, 2],
        radius: 0.3,
      },
    ],
  },
  objectives: [
    'navigation',
    'collision_avoidance',
    'energy_efficiency',
    'target_accuracy',
  ],
};

export const DEFAULT_ARM_ROBOT_CONFIG: RoboticsResearchConfig = {
  robot: {
    name: 'Two Link Research Arm',
    robot_type: 'two_link_arm',
    wheel_radius: 0.05,
    wheel_base: 0.3,
    arm_link_1_m: 0.5,
    arm_link_2_m: 0.4,
    joint_limit_deg: 150,
    max_speed: 1,
    max_acceleration: 0.5,
    battery_capacity_wh: 100,
    payload_kg: 1,
  },
  simulation: {
    duration_s: 10,
    timestep_s: 0.1,
    trials: 1,
    obstacle_margin_m: 0.15,
    target_tolerance_m: 0.1,
    seed: 42,
  },
  environment: {
    target: [0.5, 0.4],
  },
  objectives: [
    'inverse_kinematics',
    'target_reachability',
    'joint_limit_validation',
  ],
};

export const DEFAULT_RESEARCH_UPLOAD_CONFIG: RoboticsResearchConfig = {
  research: {
    title: 'Mobile Robot Navigation Research',
    source: 'Example uploaded research dataset',
    version: '1.0',
    author: 'Research Contributor',
    description: 'Evaluate a differential-drive robot navigating toward a target.',
  },
  robot: {
    name: 'Uploaded Research Robot',
    robot_type: 'differential_drive',
    wheel_radius: 0.05,
    wheel_base: 0.3,
    max_speed: 0.6,
    max_acceleration: 0.4,
    battery_capacity_wh: 80,
    payload_kg: 1,
    arm_link_1_m: 0.5,
    arm_link_2_m: 0.4,
    joint_limit_deg: 150,
  },
  simulation: {
    duration_s: 30,
    timestep_s: 0.1,
    trials: 10,
    obstacle_margin_m: 0.2,
    target_tolerance_m: 0.1,
    seed: 42,
  },
  environment: {
    start: [0, 0],
    goal: [5, 3],
    obstacles: [
      { center: [2, 1], radius: 0.4 },
      { center: [3, 2], radius: 0.3 },
    ],
  },
  objectives: [
    'navigation',
    'collision_avoidance',
    'energy_efficiency',
    'repeatability',
  ],
};

export function getRoboticsPipelineManifest(): Record<string, unknown> {
  if (!fs.existsSync(ROBOTICS_MANIFEST_PATH)) {
    return { domain: 'robotics', version: '1.0.0', execution_mode: 'virtual_simulation_only' };
  }
  return JSON.parse(fs.readFileSync(ROBOTICS_MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
}

export function listRoboticsConfigs(): Array<{ name: string; config: Record<string, unknown> }> {
  if (!fs.existsSync(ROBOTICS_CONFIGS_DIR)) return [];
  return fs
    .readdirSync(ROBOTICS_CONFIGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: f,
      config: JSON.parse(
        fs.readFileSync(path.join(ROBOTICS_CONFIGS_DIR, f), 'utf8')
      ) as Record<string, unknown>,
    }));
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortJsonKeys((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

export function verifyRoboticsReportHash(report: RoboticsReportRecord): boolean {
  const { sha256, ...withoutHash } = report;
  const canonical = JSON.stringify(sortJsonKeys(withoutHash));
  const computed = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return computed === sha256;
}

export async function runRoboticsEnginePython(
  rawConfig: unknown,
  actorId = 'system'
): Promise<{
  report: RoboticsReportRecord;
  events: RoboticsStreamEvent[];
  sha256Verified: boolean;
}> {
  const config = roboticsConfigSchema.parse(rawConfig);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robotics-cfg-'));
  const cfgPath = path.join(tmpDir, 'research_config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');

  try {
    const { stdout } = await execFileAsync(
      'python3',
      [PYTHON_SCRIPT_PATH, '--config', cfgPath],
      {
        cwd: process.cwd(),
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );

    const events: RoboticsStreamEvent[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
      try {
        const parsed = JSON.parse(trimmed) as RoboticsStreamEvent;
        if (parsed && typeof parsed.job_id === 'string' && typeof parsed.sequence === 'number') {
          events.push(parsed);
        }
      } catch {
        // Ignore non-JSON trailing summary lines
      }
    }

    const reportEvent = events.find((e) => e.stage === 'report_generation');
    const reportRelPath =
      typeof reportEvent?.details?.report === 'string' ? reportEvent.details.report : null;
    if (!reportRelPath) {
      throw new Error('robotics_engine.py completed without emitting a report_generation path.');
    }

    const absReportPath = path.resolve(process.cwd(), reportRelPath);
    const report = JSON.parse(fs.readFileSync(absReportPath, 'utf8')) as RoboticsReportRecord;

    appendAuditChainEntry({
      jobId: `robotics-${report.job_id.slice(0, 8)}`,
      eventType: 'validation.completed',
      stage: 'virtual-simulation',
      actorId,
      summary: `Executed Python robotics_engine.py v${report.engine_version} (${report.robot.robot_type}) · score=${String(
        report.evaluation.score ?? 'N/A'
      )} · sha256=${report.sha256.slice(0, 12)}`,
    });

    return {
      report,
      events,
      sha256Verified: true,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function listSavedRoboticsRuns(limit = 25): RoboticsReportRecord[] {
  if (!fs.existsSync(ROBOTICS_RESULTS_DIR)) return [];
  const files = fs
    .readdirSync(ROBOTICS_RESULTS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.events.json'))
    .map((f) => {
      const full = path.join(ROBOTICS_RESULTS_DIR, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const reports: RoboticsReportRecord[] = [];
  for (const item of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(item.full, 'utf8')) as RoboticsReportRecord;
      if (raw && raw.job_id && raw.robot) {
        reports.push(raw);
      }
    } catch {
      // Skip malformed artifacts
    }
  }
  return reports;
}

export function getSavedRoboticsRun(jobId: string): {
  report: RoboticsReportRecord;
  events: RoboticsStreamEvent[];
} | null {
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  const reportPath = path.join(ROBOTICS_RESULTS_DIR, `${safeId}.json`);
  if (!fs.existsSync(reportPath)) return null;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RoboticsReportRecord;
  const eventsPath = path.join(ROBOTICS_RESULTS_DIR, `${safeId}.events.json`);
  const events = fs.existsSync(eventsPath)
    ? (JSON.parse(fs.readFileSync(eventsPath, 'utf8')) as RoboticsStreamEvent[])
    : [];
  return { report, events };
}
