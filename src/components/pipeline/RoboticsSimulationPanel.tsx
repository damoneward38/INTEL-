import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Cpu, Play, ShieldAlert } from 'lucide-react';
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

const DEFAULT_ARM: RoboticsResearchConfig = {
  robot: {
    name: 'Two Link Research Arm',
    robot_type: 'two_link_arm',
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

interface Props {
  onLaunchInPipeline: (commandText: string, configJson: string) => void;
}

export default function RoboticsSimulationPanel({ onLaunchInPipeline }: Props) {
  const [robotMode, setRobotMode] = useState<
    'differential_drive' | 'two_link_arm' | 'research_upload_example'
  >('differential_drive');
  const [configText, setConfigText] = useState(JSON.stringify(DEFAULT_MOBILE, null, 2));
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

  function selectPreset(kind: 'differential_drive' | 'two_link_arm' | 'research_upload_example') {
    setRobotMode(kind);
    const preset =
      kind === 'two_link_arm'
        ? DEFAULT_ARM
        : kind === 'research_upload_example'
          ? DEFAULT_UPLOAD_EXAMPLE
          : DEFAULT_MOBILE;
    setConfigText(JSON.stringify(preset, null, 2));
    setError(null);
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
      };
      const l1 = report.robot.arm_link_1_m || 0.5;
      const l2 = report.robot.arm_link_2_m || 0.4;
      const maxReach = l1 + l2;
      const scale = 95 / Math.max(0.5, maxReach);
      const cx = 130;
      const cy = 125;

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

      return (
        <svg
          viewBox="0 0 260 220"
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
            2-DOF IK: {trial.reachable ? 'REACHABLE' : 'OUT OF REACH'}
          </text>
          <text x={10} y={208} fill="#cbd5e1" fontSize="9.5" fontFamily="monospace">
            {angles ? `θ1=${angles[0]}° · θ2=${angles[1]}°` : 'Target outside annulus'}
          </text>
        </svg>
      );
    }

    const start = report.environment.start ?? [0, 0];
    const goal = report.environment.goal ?? [4, 4];
    const obstacles = report.environment.obstacles ?? [];
    const margin = report.simulation.obstacle_margin_m ?? 0.15;

    const maxSpan = Math.max(
      4.5,
      Math.abs(start[0]),
      Math.abs(start[1]),
      Math.abs(goal[0]),
      Math.abs(goal[1]),
      ...obstacles.map((o) => Math.max(o.center[0] + o.radius, o.center[1] + o.radius))
    );
    const pxScale = Math.min(36, 155 / maxSpan);
    const mapPt = (pt: [number, number]): [number, number] => [
      28 + (Number(pt[0]) + 0.5) * pxScale,
      195 - (Number(pt[1]) + 0.5) * pxScale,
    ];
    const [sx, sy] = mapPt(start);
    const [gx, gy] = mapPt(goal);
    const firstTrial = (report.trials[0] ?? {}) as {
      final_position?: [number, number];
      completed?: boolean;
      collision_events?: number;
    };
    const [fx, fy] = mapPt(firstTrial.final_position ?? start);

    return (
      <svg
        viewBox="0 0 260 220"
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
              <circle cx={ox} cy={oy} r={obs.radius * pxScale} fill="#ef444466" stroke="#f87171" />
            </g>
          );
        })}
        <line
          x1={sx}
          y1={sy}
          x2={fx}
          y2={fy}
          stroke={firstTrial.collision_events ? '#f43f5e' : '#38bdf8'}
          strokeWidth={2.5}
        />
        <circle cx={sx} cy={sy} r={4.5} fill="#94a3b8" />
        <circle cx={gx} cy={gy} r={5.5} fill="none" stroke="#10b981" strokeWidth={2} />
        <circle cx={fx} cy={fy} r={4.5} fill={firstTrial.completed ? '#10b981' : '#f59e0b'} />
        <text x={10} y={18} fill="#94a3b8" fontSize="10" fontFamily="monospace">
          Start [{start.join(',')}] → Goal [{goal.join(',')}]
        </text>
        <text x={10} y={208} fill="#cbd5e1" fontSize="9.5" fontFamily="monospace">
          End [{(firstTrial.final_position ?? start).join(', ')}] · Collisions:{' '}
          {String(firstTrial.collision_events ?? 0)}
        </text>
      </svg>
    );
  }

  return (
    <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            <span>Virtual Robotics Research Engine (robotics_engine.py · v1.0.0)</span>
          </h3>
          <p className="text-xs text-slate-400">
            SIMULATION_ONLY = True · Physical hardware disconnected · SHA-256 signed JSON trials
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => selectPreset('differential_drive')}
            className={`px-2.5 py-1 rounded-lg border text-xs ${
              robotMode === 'differential_drive'
                ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700 text-slate-300'
            }`}
          >
            Differential Drive
          </button>
          <button
            type="button"
            onClick={() => selectPreset('two_link_arm')}
            className={`px-2.5 py-1 rounded-lg border text-xs ${
              robotMode === 'two_link_arm'
                ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700 text-slate-300'
            }`}
          >
            2-Link Planar Arm
          </button>
          <button
            type="button"
            onClick={() => selectPreset('research_upload_example')}
            className={`px-2.5 py-1 rounded-lg border text-xs ${
              robotMode === 'research_upload_example'
                ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700 text-slate-300'
            }`}
          >
            Upload Dataset Example
          </button>
        </div>
      </div>

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
          </div>
        </div>

        <div className="lg:col-span-6 space-y-3">
          {latestReport ? (
            <>
              {renderTelemetryVisual(latestReport)}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
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
                    trials: latestReport.trials.slice(0, 2),
                    streamEvents: latestEvents.length,
                    savedRunsCount: savedRuns.length,
                  },
                  null,
                  2
                )}
              </pre>
            </>
          ) : (
            <div className="h-56 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-center text-xs text-slate-400 p-4 text-center">
              Execute `Run Virtual Robotics Trial` to compute differential-drive or 2-link arm
              kinematics with SHA-256 provenance.
            </div>
          )}
        </div>
      </div>

      {manifest && (
        <div className="pt-3 border-t border-slate-800 space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
            <span className="font-semibold">
              Robotics Pipeline Manifest ({manifest.pipeline.length} Stages · {manifest.execution_mode})
            </span>
            <span className="font-mono text-amber-300">
              Hardware Execution: {String(manifest.hardware_execution.enabled)} (Approval Required)
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {manifest.future_simulator_adapters.map((a) => (
              <span
                key={a.name}
                className="px-2 py-0.5 rounded border border-slate-800 bg-slate-950/70 text-slate-400 font-mono"
                title={a.purpose}
              >
                {a.name}: {a.enabled ? 'enabled' : 'planned/disabled'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
