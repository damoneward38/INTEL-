import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Cpu, Download, Play, ShieldAlert } from 'lucide-react';
import { triggerFileDownload } from '../../utils/exportReport';
import {
  fetchRoboticsRunsApi,
  runRoboticsEngineApi,
  type RoboticsPipelineManifest,
  type RoboticsReportRecord,
  type RoboticsResearchConfig,
  type RoboticsStreamEvent,
} from '../../services/pipelineApi';

const DEFAULT_MOBILE: RoboticsResearchConfig = {
  robot: {
    name: 'Research Mobile Robot',
    robot_type: 'differential_drive',
    wheel_radius: 0.05,
    wheel_base: 0.3,
    max_speed: 0.8,
    max_acceleration: 0.5,
    battery_capacity_wh: 100,
    payload_kg: 2,
  },
  simulation: {
    duration_s: 20,
    timestep_s: 0.1,
    trials: 5,
    obstacle_margin_m: 0.15,
    target_tolerance_m: 0.1,
    seed: 42,
    planner: 'straight_line',
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

const DEFAULT_AVOIDANCE: RoboticsResearchConfig = {
  research: {
    title: 'Obstacle-Avoidance Potential Field Navigation',
    source: 'Extended Robotics Benchmark v1.1',
    version: '1.1',
    description:
      'Navigate around inline obstacles using artificial potential fields + tangential curl deflection.',
  },
  robot: {
    name: 'Autonomous Avoidance Rover',
    robot_type: 'differential_drive',
    wheel_radius: 0.05,
    wheel_base: 0.3,
    max_speed: 0.85,
    max_acceleration: 0.5,
    battery_capacity_wh: 100,
    payload_kg: 2,
  },
  simulation: {
    duration_s: 25,
    timestep_s: 0.1,
    trials: 5,
    obstacle_margin_m: 0.15,
    target_tolerance_m: 0.1,
    seed: 42,
    planner: 'potential_field',
  },
  environment: {
    start: [0, 0],
    goal: [4, 4],
    obstacles: [
      { center: [2, 2], radius: 0.3 },
      { center: [3.2, 2.5], radius: 0.25 },
    ],
  },
  objectives: ['navigation', 'obstacle_avoidance', 'path_planning', 'energy_efficiency'],
};

const DEFAULT_ARM: RoboticsResearchConfig = {
  robot: {
    name: 'Two Link Research Arm',
    robot_type: 'two_link_arm',
    arm_link_1_m: 0.5,
    arm_link_2_m: 0.4,
    joint_limit_deg: 150,
    elbow_config: 'elbow_down',
    max_speed: 1,
    max_acceleration: 0.5,
    battery_capacity_wh: 100,
    payload_kg: 1,
  },
  simulation: {
    duration_s: 10,
    timestep_s: 0.1,
    trials: 1,
  },
  environment: {
    waypoints: [
      [0.65, 0.2],
      [0.5, 0.4],
      [0.25, 0.65],
    ],
    target: [0.25, 0.65],
  },
  objectives: [
    'inverse_kinematics',
    'target_reachability',
    'joint_limit_validation',
  ],
};

const DEFAULT_QUADROTOR: RoboticsResearchConfig = {
  research: {
    title: '3D Aerial Quadrotor Waypoint Inspection',
    source: 'Extended Robotics Benchmark v1.1',
    version: '1.1',
    description:
      'Evaluate 3D flight path planning, rotor aerodynamic energy burn, and cylindrical tower clearance.',
  },
  robot: {
    name: 'Autonomous Quadrotor Inspector',
    robot_type: 'quadrotor_3d',
    max_speed: 1.4,
    max_acceleration: 1.2,
    battery_capacity_wh: 95,
    payload_kg: 1.2,
    rotor_count: 4,
    cruise_altitude_m: 2.4,
  },
  simulation: {
    duration_s: 25,
    timestep_s: 0.1,
    trials: 5,
    obstacle_margin_m: 0.2,
    target_tolerance_m: 0.12,
    seed: 42,
    planner: 'potential_field',
  },
  environment: {
    start: [0, 0, 0.4],
    waypoints: [
      [1.2, 1.5, 2.2],
      [3.3, 2.8, 2.5],
    ],
    goal: [5, 4, 1.2],
    obstacles: [
      { center: [2.2, 1.8], radius: 0.35, height_m: 3.4 },
      { center: [4.0, 3.2], radius: 0.3, height_m: 3.0 },
    ],
  },
  objectives: ['3d_navigation', 'obstacle_avoidance', 'battery_reserve', 'altitude_stability'],
};

const DEFAULT_UPLOAD_EXAMPLE: RoboticsResearchConfig = {
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
  },
  simulation: {
    duration_s: 30,
    timestep_s: 0.1,
    trials: 10,
    obstacle_margin_m: 0.2,
    target_tolerance_m: 0.1,
    planner: 'straight_line',
  },
  environment: {
    start: [0, 0],
    goal: [5, 3],
    obstacles: [
      { center: [2, 1], radius: 0.4 },
      { center: [3, 2], radius: 0.3 },
    ],
  },
  objectives: ['navigation', 'collision_avoidance', 'energy_efficiency', 'repeatability'],
};

type PresetKey =
  | 'differential_drive'
  | 'potential_field'
  | 'two_link_arm'
  | 'quadrotor_3d'
  | 'research_upload_example';

interface Props {
  onLaunchInPipeline: (commandText: string, configJson: string) => void;
}

export default function RoboticsSimulationPanel({ onLaunchInPipeline }: Props) {
  const [robotMode, setRobotMode] = useState<PresetKey>('potential_field');
  const [configText, setConfigText] = useState(JSON.stringify(DEFAULT_AVOIDANCE, null, 2));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestReport, setLatestReport] = useState<RoboticsReportRecord | null>(null);
  const [latestEvents, setLatestEvents] = useState<RoboticsStreamEvent[]>([]);
  const [savedRuns, setSavedRuns] = useState<RoboticsReportRecord[]>([]);
  const [manifest, setManifest] = useState<RoboticsPipelineManifest | null>(null);

  useEffect(() => {
    void fetchRoboticsRunsApi()
      .then((res) => {
        setSavedRuns(res.runs ?? []);
        if (res.manifest) setManifest(res.manifest);
        if (res.runs && res.runs.length > 0 && !latestReport) {
          setLatestReport(res.runs[0]);
        }
      })
      .catch(() => {
        // Initial optional load
      });
  }, []);

  function selectPreset(kind: PresetKey) {
    setRobotMode(kind);
    const preset =
      kind === 'two_link_arm'
        ? DEFAULT_ARM
        : kind === 'potential_field'
          ? DEFAULT_AVOIDANCE
          : kind === 'quadrotor_3d'
            ? DEFAULT_QUADROTOR
            : kind === 'research_upload_example'
              ? DEFAULT_UPLOAD_EXAMPLE
              : DEFAULT_MOBILE;
    setConfigText(JSON.stringify(preset, null, 2));
    setError(null);
  }

  function updateConfigField(mutator: (cfg: RoboticsResearchConfig) => void) {
    try {
      const parsed = JSON.parse(configText) as RoboticsResearchConfig;
      mutator(parsed);
      setConfigText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch {
      setError('Cannot apply parameter tweak because JSON configuration has syntax errors.');
    }
  }

  async function handleRunPythonEngine() {
    setError(null);
    let parsed: RoboticsResearchConfig;
    try {
      parsed = JSON.parse(configText) as RoboticsResearchConfig;
    } catch {
      setError('Configuration JSON is invalid.');
      return;
    }
    setRunning(true);
    try {
      const res = await runRoboticsEngineApi(parsed);
      setLatestReport(res.report);
      setLatestEvents(res.events);
      const list = await fetchRoboticsRunsApi();
      setSavedRuns(list.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Robotics simulation failed.');
    } finally {
      setRunning(false);
    }
  }

  function renderTelemetryVisual(report: RoboticsReportRecord) {
    if (report.robot.robot_type === 'two_link_arm') {
      const trial = (report.trials[0] ?? {}) as {
        reachable?: boolean;
        within_joint_limits?: boolean;
        target?: [number, number];
        joint_angles_deg?: [number, number] | null;
        trajectory?: Array<{
          elbow?: [number, number];
          end_effector?: [number, number];
        }>;
      };
      const l1 = report.robot.arm_link_1_m || 0.5;
      const l2 = report.robot.arm_link_2_m || 0.4;
      const maxReach = l1 + l2;
      const scale = 92 / Math.max(0.5, maxReach);
      const cx = 135;
      const cy = 128;

      const angles = trial.joint_angles_deg;
      const t1 = angles ? (angles[0] * Math.PI) / 180 : 0.4;
      const t2 = angles ? (angles[1] * Math.PI) / 180 : 0.4;
      const elbowX = cx + l1 * scale * Math.cos(t1);
      const elbowY = cy - l1 * scale * Math.sin(t1);
      const effX = elbowX + l2 * scale * Math.cos(t1 + t2);
      const effY = elbowY - l2 * scale * Math.sin(t1 + t2);
      const target = trial.target ?? report.environment.target ?? [0.5, 0.4];
      const tx = cx + Number(target[0]) * scale;
      const ty = cy - Number(target[1]) * scale;

      const sweepPts = (trial.trajectory ?? [])
        .filter((f) => Array.isArray(f.end_effector))
        .map((f) => {
          const [px, py] = f.end_effector!;
          return `${cx + px * scale},${cy - py * scale}`;
        })
        .join(' ');

      const waypoints = (report.environment.waypoints ?? []) as Array<[number, number]>;

      return (
        <svg
          viewBox="0 0 270 220"
          className="w-full h-56 rounded-lg border border-slate-800 bg-slate-950"
        >
          <circle
            cx={cx}
            cy={cy}
            r={maxReach * scale}
            fill="none"
            stroke="#1e293b"
            strokeDasharray="4 4"
          />
          <circle
            cx={cx}
            cy={cy}
            r={Math.abs(l1 - l2) * scale}
            fill="none"
            stroke="#334155"
            strokeDasharray="2 3"
          />
          {sweepPts && (
            <polyline
              fill="none"
              stroke="#22d3ee"
              strokeOpacity={0.6}
              strokeWidth={1.6}
              strokeDasharray="3 2"
              points={sweepPts}
            />
          )}
          {waypoints.map((wp, idx) => (
            <circle
              key={idx}
              cx={cx + Number(wp[0]) * scale}
              cy={cy - Number(wp[1]) * scale}
              r={3}
              fill="#f59e0b"
            />
          ))}
          <line x1={cx} y1={cy} x2={elbowX} y2={elbowY} stroke="#38bdf8" strokeWidth={4} />
          <line x1={elbowX} y1={elbowY} x2={effX} y2={effY} stroke="#a855f7" strokeWidth={3.5} />
          <circle cx={cx} cy={cy} r={5} fill="#e2e8f0" />
          <circle cx={elbowX} cy={elbowY} r={4} fill="#38bdf8" />
          <circle
            cx={tx}
            cy={ty}
            r={5}
            fill="none"
            stroke={trial.reachable ? '#10b981' : '#f43f5e'}
            strokeWidth={2}
          />
          <text x={10} y={18} fill="#94a3b8" fontSize="10" fontFamily="monospace">
            2-DOF IK ({report.robot.elbow_config ?? 'elbow_down'}):{' '}
            {trial.reachable ? 'REACHABLE' : 'OUT OF REACH'}
          </text>
          <text x={10} y={208} fill="#cbd5e1" fontSize="9.5" fontFamily="monospace">
            {angles ? `θ1=${angles[0]}° · θ2=${angles[1]}°` : 'Target outside annulus'}
          </text>
        </svg>
      );
    }

    const start = (report.environment.start ?? [0, 0]) as number[];
    const goal = (report.environment.goal ?? [4, 4]) as number[];
    const obstacles = report.environment.obstacles ?? [];
    const margin = report.simulation.obstacle_margin_m ?? 0.15;
    const waypoints = (report.environment.waypoints ?? []) as number[][];

    const firstTrial = (report.trials[0] ?? {}) as {
      final_position?: number[];
      completed?: boolean;
      collision_events?: number;
      trajectory?: number[][];
      battery_remaining_pct?: number;
    };

    const traj = Array.isArray(firstTrial.trajectory) && firstTrial.trajectory.length > 0
      ? firstTrial.trajectory
      : [start, firstTrial.final_position ?? start];

    const maxSpan = Math.max(
      4.5,
      Math.abs(start[0]),
      Math.abs(start[1]),
      Math.abs(goal[0]),
      Math.abs(goal[1]),
      ...traj.map((pt) => Math.max(Math.abs(pt[0]), Math.abs(pt[1]))),
      ...obstacles.map((o) => Math.max(o.center[0] + o.radius, o.center[1] + o.radius))
    );
    const pxScale = Math.min(34, 152 / maxSpan);
    const mapPt = (pt: number[]): [number, number] => [
      26 + (Number(pt[0]) + 0.5) * pxScale,
      192 - (Number(pt[1]) + 0.5) * pxScale,
    ];
    const [sx, sy] = mapPt(start);
    const [gx, gy] = mapPt(goal);
    const [fx, fy] = mapPt(firstTrial.final_position ?? start);
    const polyPts = traj.map((pt) => mapPt(pt).join(',')).join(' ');
    const isQuad = report.robot.robot_type === 'quadrotor_3d';

    const maxAlt = Math.max(3.0, ...traj.map((pt) => Number(pt[2] ?? 0)));

    return (
      <div className="space-y-2">
        <svg
          viewBox="0 0 270 220"
          className="w-full h-56 rounded-lg border border-slate-800 bg-slate-950"
        >
          {obstacles.map((obs, i) => {
            const [ox, oy] = mapPt(obs.center);
            return (
              <g key={i}>
                <circle
                  cx={ox}
                  cy={oy}
                  r={(obs.radius + margin) * pxScale}
                  fill="#f59e0b14"
                  stroke="#f59e0b66"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={ox}
                  cy={oy}
                  r={obs.radius * pxScale}
                  fill="#ef444466"
                  stroke="#f87171"
                />
              </g>
            );
          })}
          {waypoints.map((wp, wIdx) => {
            const [wx, wy] = mapPt(wp);
            return (
              <circle
                key={wIdx}
                cx={wx}
                cy={wy}
                r={3.5}
                fill="#0f172a"
                stroke="#f59e0b"
                strokeWidth={1.8}
              />
            );
          })}
          <polyline
            fill="none"
            stroke={firstTrial.collision_events ? '#f43f5e' : '#38bdf8'}
            strokeWidth={2.4}
            points={polyPts}
          />
          <circle cx={sx} cy={sy} r={4.5} fill="#94a3b8" />
          <circle cx={gx} cy={gy} r={5.5} fill="none" stroke="#10b981" strokeWidth={2} />
          <circle cx={fx} cy={fy} r={4.5} fill={firstTrial.completed ? '#10b981' : '#f59e0b'} />
          <text x={10} y={18} fill="#94a3b8" fontSize="10" fontFamily="monospace">
            {isQuad ? '3D Quadrotor Top-Down' : `Planner: ${report.simulation.planner ?? 'straight_line'}`} · Start [{start.slice(0, 2).join(',')}] → Goal [{goal.slice(0, 2).join(',')}]
          </text>
          <text x={10} y={208} fill="#cbd5e1" fontSize="9.5" fontFamily="monospace">
            End [{(firstTrial.final_position ?? start).join(', ')}] · Collisions: {String(firstTrial.collision_events ?? 0)}
            {isQuad && firstTrial.battery_remaining_pct !== undefined
              ? ` · Batt ${firstTrial.battery_remaining_pct}%`
              : ''}
          </text>
        </svg>

        {isQuad && traj.length > 1 && (
          <svg
            viewBox="0 0 270 68"
            className="w-full h-16 rounded-lg border border-slate-800 bg-slate-950"
          >
            <polyline
              fill="none"
              stroke="#a855f7"
              strokeWidth={2}
              points={traj
                .map((pt, idx) => {
                  const x = 14 + (idx / Math.max(1, traj.length - 1)) * 242;
                  const y = 56 - ((Number(pt[2] ?? 0) / maxAlt) * 38);
                  return `${x},${y}`;
                })
                .join(' ')}
            />
            <text x={10} y={14} fill="#94a3b8" fontSize="9" fontFamily="monospace">
              Altitude Z(t) Profile · Peak {Math.max(...traj.map((p) => Number(p[2] ?? 0))).toFixed(2)}m
            </text>
          </svg>
        )}
      </div>
    );
  }

  let parsedEditorConfig: RoboticsResearchConfig | null = null;
  try {
    parsedEditorConfig = JSON.parse(configText) as RoboticsResearchConfig;
  } catch {
    parsedEditorConfig = null;
  }

  return (
    <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            <span>Virtual Robotics Research Engine (v1.1.0)</span>
          </h3>
          <p className="text-xs text-slate-400">
            Simulation Only · Differential Drive, Potential Field Avoidance, 2-Link IK &amp; 3D Quadrotor · SHA-256 Signed
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['differential_drive', 'Straight Line'],
              ['potential_field', 'Obstacle Avoidance'],
              ['two_link_arm', '2-Link Arm IK'],
              ['quadrotor_3d', '3D Quadrotor'],
              ['research_upload_example', 'Dataset Example'],
            ] as Array<[PresetKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => selectPreset(key)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-colors ${
                robotMode === key
                  ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {parsedEditorConfig && (
        <div className="flex flex-wrap items-center gap-4 px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/70 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Planner</span>
            <select
              value={parsedEditorConfig.simulation?.planner ?? 'straight_line'}
              aria-label="Robotics Path Planner"
              disabled={parsedEditorConfig.robot.robot_type === 'two_link_arm'}
              onChange={(e) =>
                updateConfigField((cfg) => {
                  cfg.simulation = cfg.simulation ?? {};
                  cfg.simulation.planner = e.target.value as 'straight_line' | 'potential_field';
                })
              }
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 disabled:opacity-50"
            >
              <option value="straight_line">straight_line</option>
              <option value="potential_field">potential_field</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-slate-300">
            <span className="text-slate-400">Max Speed (m/s)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="5"
              value={parsedEditorConfig.robot.max_speed ?? 0.8}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) {
                  updateConfigField((cfg) => {
                    cfg.robot.max_speed = v;
                  });
                }
              }}
              className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono tabular-nums text-xs text-slate-100"
            />
          </label>

          <label className="flex items-center gap-2 text-slate-300">
            <span className="text-slate-400">Margin (m)</span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="2"
              value={parsedEditorConfig.simulation?.obstacle_margin_m ?? 0.15}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) {
                  updateConfigField((cfg) => {
                    cfg.simulation = cfg.simulation ?? {};
                    cfg.simulation.obstacle_margin_m = v;
                  });
                }
              }}
              className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono tabular-nums text-xs text-slate-100"
            />
          </label>
        </div>
      )}

      {error && (
        <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 space-y-2.5">
          <textarea
            rows={12}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            aria-label="Robotics Engine Configuration JSON"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={running}
              onClick={() => void handleRunPythonEngine()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{running ? 'Running Python Engine...' : 'Run Virtual Robotics Trial'}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onLaunchInPipeline(
                  `Optimize ${robotMode} robotics kinematics and energy efficiency in virtual simulation.`,
                  configText
                )
              }
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-200 hover:border-cyan-500/50"
            >
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>Launch in 30-Stage 3D Pipeline</span>
            </button>
            {latestReport && (
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `robotics-report-${latestReport.job_id.slice(0, 8)}.json`,
                    JSON.stringify(latestReport, null, 2),
                    'application/json'
                  )
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-200 hover:border-emerald-500/50"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Download JSON Report</span>
              </button>
            )}
          </div>
          {savedRuns.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-400 shrink-0">Saved Robotics Runs:</label>
              <select
                value={latestReport?.job_id ?? ''}
                onChange={(e) => {
                  const found = savedRuns.find((r) => r.job_id === e.target.value);
                  if (found) setLatestReport(found);
                }}
                aria-label="Saved Robotics Simulation Runs"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200"
              >
                {savedRuns.map((r) => (
                  <option key={r.job_id} value={r.job_id}>
                    {r.robot.name} ({r.robot.robot_type}) · score={String(r.evaluation.score ?? 'N/A')} ·{' '}
                    {r.job_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="lg:col-span-6 space-y-3">
          {latestReport ? (
            <>
              {renderTelemetryVisual(latestReport)}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2 rounded border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] text-slate-400">Evaluation Score</div>
                  <div className="text-emerald-300 font-semibold">
                    {String(latestReport.evaluation.score ?? 'N/A')}
                  </div>
                </div>
                <div className="p-2 rounded border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] text-slate-400">Events Emitted</div>
                  <div className="text-slate-100">{latestReport.event_count}</div>
                </div>
                <div className="p-2 rounded border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] text-slate-400">SHA-256 Verified</div>
                  <div className="text-cyan-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{latestReport.sha256.slice(0, 10)}...</span>
                  </div>
                </div>
              </div>
              <pre className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 text-[11px] font-mono text-slate-300 max-h-28 overflow-y-auto">
                {JSON.stringify(
                  {
                    evaluation: latestReport.evaluation,
                    trials: latestReport.trials.slice(0, 1).map((t) => ({
                      ...t,
                      trajectoryPoints: Array.isArray(t.trajectory) ? t.trajectory.length : 0,
                    })),
                    streamEvents: latestEvents.length,
                    limitations: latestReport.limitations,
                  },
                  null,
                  2
                )}
              </pre>
            </>
          ) : (
            <div className="h-56 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-center text-xs text-slate-400 p-4 text-center">
              Execute `Run Virtual Robotics Trial` to compute differential-drive, potential-field
              avoidance, 2-link arm IK, or 3D quadrotor trajectories with SHA-256 provenance.
            </div>
          )}
        </div>
      </div>

      {manifest && (
        <div className="pt-3 border-t border-slate-800 space-y-1.5 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
            <span className="font-semibold">
              Robotics Pipeline Manifest ({manifest.pipeline.length} Stages · v{manifest.version} · {manifest.execution_mode})
            </span>
            <span className="font-mono text-amber-300">
              Hardware Execution: {String(manifest.hardware_execution.enabled)} (Approval Required)
            </span>
          </div>
          <p className="text-slate-400 font-mono text-[10px]">
            Active Models: {manifest.supported_initial_models.join(' · ')} · Planners:{' '}
            {(manifest.supported_planners ?? ['straight_line', 'potential_field']).join(' · ')}
          </p>
          <p className="text-slate-400 font-mono text-[10px]">
            Stages: {manifest.pipeline.map((s, idx) => `${String(idx + 1).padStart(2, '0')}.${s}`).join(' → ')}
          </p>
          <p className="text-slate-500 font-mono text-[10px]">
            Future External Adapters (Disabled):{' '}
            {manifest.future_simulator_adapters
              .map((a) => `${a.name} (${a.enabled ? 'enabled' : 'disabled'})`)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}
