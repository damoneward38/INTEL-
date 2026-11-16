import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchAutonomousOverviewApi,
  runAutonomousControllerApi,
  verifyAutonomousChainApi,
} from '../../services/api';
import { triggerFileDownload } from '../../utils/exportReport';
import type {
  AutonomousAuditEventRecord,
  AutonomousControllerConfig,
  AutonomousOverviewResponse,
  AutonomousRunReport,
  UserRole,
} from '../../types';

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
}

function formatNum(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function statusIndicator(status: AutonomousRunReport['status'], isHe: boolean): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case 'converged':
      return {
        label: isHe ? '● התכנס וננעל' : '● Converged & Locked',
        colorClass: 'text-emerald-400',
      };
    case 'stopped_no_improvement':
      return {
        label: isHe ? '● נעצר ללא שיפור' : '● Patience Cutoff',
        colorClass: 'text-amber-400',
      };
    case 'max_iterations_reached':
      return {
        label: isHe ? '● תקרת איטרציות' : '● Max Iterations Reached',
        colorClass: 'text-cyan-300',
      };
    case 'audit_integrity_failure':
      return {
        label: isHe ? '● כשל אימות שרשרת' : '● Audit Integrity Failure',
        colorClass: 'text-rose-400',
      };
    default:
      return {
        label: isHe ? '● נכשל' : '● Failed',
        colorClass: 'text-rose-400',
      };
  }
}

export default function AutonomousControllerView({ language, userRole }: Props) {
  const isHe = language === 'he';
  const canExecute =
    userRole === 'researcher' || userRole === 'principal_investigator';

  const [overview, setOverview] = useState<AutonomousOverviewResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [chainVerification, setChainVerification] = useState<{
    valid: boolean;
    checkedEvents: number;
    headRecordHash: string;
  } | null>(null);

  // Controller parameters aligned with autonomous_controller.py
  const [batchSize, setBatchSize] = useState(8);
  const [replicates, setReplicates] = useState(3);
  const [maxIterations, setMaxIterations] = useState(12);
  const [maxParallelSimulations, setMaxParallelSimulations] = useState(4);
  const [targetReward, setTargetReward] = useState(0.75);
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [minSuccessfulReplicates, setMinSuccessfulReplicates] = useState(3);
  const [maxConfidenceIntervalWidth, setMaxConfidenceIntervalWidth] = useState(0.2);
  const [convergencePatience, setConvergencePatience] = useState(5);
  const [randomSeed, setRandomSeed] = useState(42);
  const [bootstrapSamples, setBootstrapSamples] = useState(3000);
  const [virtualModeConfirmed, setVirtualModeConfirmed] = useState(false);

  async function loadOverview(preferredRunId?: string) {
    try {
      const data = await fetchAutonomousOverviewApi();
      setOverview(data);
      setChainVerification({
        valid: data.auditChainValid,
        checkedEvents: data.totalAuditEvents,
        headRecordHash: data.headRecordHash,
      });
      if (preferredRunId) {
        setSelectedRunId(preferredRunId);
      } else if (data.runs.length > 0 && !selectedRunId) {
        setSelectedRunId(data.runs[0].runId);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to load autonomous controller state.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const activeRun: AutonomousRunReport | null = useMemo(() => {
    if (!overview || overview.runs.length === 0) return null;
    if (selectedRunId) {
      const match = overview.runs.find((r) => r.runId === selectedRunId);
      if (match) return match;
    }
    return overview.runs[0];
  }, [overview, selectedRunId]);

  const activeAuditEvents: AutonomousAuditEventRecord[] = useMemo(() => {
    if (!overview) return [];
    if (!activeRun) return overview.recentAuditEvents.slice(0, 12);
    const filtered = overview.recentAuditEvents.filter(
      (ev) => ev.runId === activeRun.runId
    );
    return (filtered.length > 0 ? filtered : overview.recentAuditEvents).slice(0, 14);
  }, [overview, activeRun]);

  async function handleRunController() {
    setErrorMsg(null);
    setNoticeMsg(null);

    if (!canExecute) {
      setErrorMsg(
        isHe
          ? 'הרצת לולאת אופטימיזציה אוטונומית מחייבת תפקיד חוקר או חוקר ראשי.'
          : 'Running the closed-loop autonomous controller requires Researcher or Principal Investigator privileges.'
      );
      return;
    }
    if (!virtualModeConfirmed) {
      setErrorMsg(
        isHe
          ? 'יש לאשר ביצוע בסימולטור וירטואלי בלבד (physical_execution = false) לפני ההרצה.'
          : 'Explicit confirmation of Virtual Simulator Only mode (physical_execution = false) is required.'
      );
      return;
    }

    setRunning(true);
    try {
      const payload: Partial<AutonomousControllerConfig> & {
        virtualModeConfirmed: boolean;
      } = {
        batchSize,
        replicates,
        maxIterations,
        maxParallelSimulations,
        targetReward,
        confidenceLevel,
        minSuccessfulReplicates,
        maxConfidenceIntervalWidth,
        convergencePatience,
        randomSeed,
        bootstrapSamples,
        virtualModeConfirmed: true,
      };
      const res = await runAutonomousControllerApi(payload);
      await loadOverview(res.run.runId);
      setNoticeMsg(
        isHe
          ? `ריצה ${res.run.runId} הושלמה בסטטוס ${res.run.status} (${res.run.successfulSimulations}/${res.run.totalSimulations} סימולציות).`
          : `Run ${res.run.runId} completed with status "${res.run.status}" (${res.run.successfulSimulations}/${res.run.totalSimulations} virtual simulations).`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Autonomous closed-loop run failed.'
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleVerifyChain() {
    setErrorMsg(null);
    setVerifying(true);
    try {
      const verification = await verifyAutonomousChainApi();
      setChainVerification(verification);
      setNoticeMsg(
        verification.valid
          ? `SHA-256 hash chain verified across ${verification.checkedEvents} audit events (head ${verification.headRecordHash.slice(0, 12)}...).`
          : 'Hash-chain integrity check reported a mismatch.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to verify hash chain.'
      );
    } finally {
      setVerifying(false);
    }
  }

  function handleDownloadReport() {
    if (!activeRun) return;
    triggerFileDownload(
      `${activeRun.runId}_report.json`,
      JSON.stringify(activeRun, null, 2),
      'application/json'
    );
  }

  // SVG chart coordinate calculations
  const chartData = useMemo(() => {
    if (!activeRun || activeRun.iterationHistory.length === 0) return null;
    const points = activeRun.iterationHistory;
    const width = 680;
    const height = 220;
    const padLeft = 48;
    const padRight = 20;
    const padTop = 18;
    const padBottom = 32;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;

    const allVals: number[] = [activeRun.config.targetReward];
    for (const pt of points) {
      if (pt.iterationBestReward !== null) allVals.push(pt.iterationBestReward);
      if (pt.globalBestReward !== null) allVals.push(pt.globalBestReward);
      if (pt.bestConfidenceLower !== null) allVals.push(pt.bestConfidenceLower);
      if (pt.bestConfidenceUpper !== null) allVals.push(pt.bestConfidenceUpper);
    }
    const minVal = Math.min(...allVals, 0) - 0.05;
    const maxVal = Math.max(...allVals, 0.9) + 0.05;
    const range = Math.max(0.1, maxVal - minVal);

    const xForIndex = (idx: number) => {
      if (points.length === 1) return padLeft + innerW / 2;
      return padLeft + (idx / (points.length - 1)) * innerW;
    };
    const yForValue = (val: number) =>
      padTop + ((maxVal - val) / range) * innerH;

    const globalLine = points
      .filter((p) => p.globalBestReward !== null)
      .map((p) => {
        const idx = points.indexOf(p);
        return `${xForIndex(idx).toFixed(1)},${yForValue(p.globalBestReward!).toFixed(1)}`;
      })
      .join(' ');

    const iterLine = points
      .filter((p) => p.iterationBestReward !== null)
      .map((p) => {
        const idx = points.indexOf(p);
        return `${xForIndex(idx).toFixed(1)},${yForValue(p.iterationBestReward!).toFixed(1)}`;
      })
      .join(' ');

    const ciPoints = points.filter(
      (p) => p.bestConfidenceUpper !== null && p.bestConfidenceLower !== null
    );
    const upperCoords = ciPoints.map((p) => {
      const idx = points.indexOf(p);
      return `${xForIndex(idx).toFixed(1)},${yForValue(p.bestConfidenceUpper!).toFixed(1)}`;
    });
    const lowerCoordsReversed = [...ciPoints].reverse().map((p) => {
      const idx = points.indexOf(p);
      return `${xForIndex(idx).toFixed(1)},${yForValue(p.bestConfidenceLower!).toFixed(1)}`;
    });
    const ciPolygon =
      upperCoords.length >= 2
        ? [...upperCoords, ...lowerCoordsReversed].join(' ')
        : '';

    const targetY = yForValue(activeRun.config.targetReward);
    const yTicks = [minVal, (minVal + maxVal) / 2, maxVal].map((v) => ({
      value: v,
      y: yForValue(v),
    }));

    return {
      width,
      height,
      padLeft,
      padRight,
      padBottom,
      points,
      globalLine,
      iterLine,
      ciPolygon,
      targetY,
      yTicks,
      xForIndex,
      yForValue,
    };
  }, [activeRun]);

  const activeStatusMeta = activeRun
    ? statusIndicator(activeRun.status, isHe)
    : null;

  return (
    <div className="space-y-5">
      {/* Top Unboxed Instrument Header */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 tracking-tight">
            {isHe
              ? 'בקר סימולציה אוטונומי במעגל סגור (וירטואלי בלבד)'
              : 'Closed-Loop Autonomous Simulation Controller'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isHe
              ? 'ייצור מועמדים תחום · הערכה מקבילית עם שכפולים · רווח בר־סמך Bootstrap · יומן ביקורת משורשר SHA-256'
              : 'Bounded Candidate Planner · Replicated Parallel Simulation · Bootstrap CI · Append-Only SHA-256 Audit Chain'}
          </p>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-cyan-300">physical_execution: false</span>
            <span>·</span>
            <span>
              {isHe ? 'עצמאות מדיניות:' : 'Adapters:'}{' '}
              <span className="text-slate-200">/plan · /simulate · /update</span>
            </span>
            <span>·</span>
            <span>
              {isHe ? 'שלמות שרשרת:' : 'Audit Chain:'}{' '}
              <span
                className={
                  chainVerification?.valid ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                {chainVerification?.valid
                  ? `● Valid (${chainVerification.checkedEvents} events)`
                  : '● Unverified'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => void handleVerifyChain()}
            disabled={verifying}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-[#0A0F1A] text-slate-200 hover:border-cyan-500/40 disabled:opacity-50"
          >
            {verifying ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>{isHe ? 'אמת שרשרת SHA-256' : 'Verify Audit Chain'}</span>
          </button>

          {activeRun && (
            <button
              type="button"
              onClick={handleDownloadReport}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-[#0A0F1A] text-slate-200 hover:border-cyan-500/40"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isHe ? 'הורד דוח JSON' : 'Download Report JSON'}</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-950/35 border border-rose-500/40 rounded-lg px-4 py-2.5 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {noticeMsg && (
        <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-lg px-4 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{noticeMsg}</span>
        </div>
      )}

      {/* Asymmetric Split Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Control Column */}
        <section className="lg:col-span-4 bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              {isHe ? 'פרמטרי בקרה וגבולות' : 'Controller Configuration'}
            </h3>
            <span className="text-[11px] font-mono tabular-nums text-slate-400">
              seed={randomSeed}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'גודל אצווה (Batch)' : 'Batch Size'}
              </span>
              <input
                type="number"
                min={1}
                max={32}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'שכפולים (Replicates)' : 'Replicates'}
              </span>
              <input
                type="number"
                min={3}
                max={10}
                value={replicates}
                onChange={(e) => setReplicates(Number(e.target.value) || 3)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'תקרת איטרציות' : 'Max Iterations'}
              </span>
              <input
                type="number"
                min={1}
                max={40}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'מקביליות סימולציה' : 'Max Parallelism'}
              </span>
              <input
                type="number"
                min={1}
                max={16}
                value={maxParallelSimulations}
                onChange={(e) =>
                  setMaxParallelSimulations(Number(e.target.value) || 1)
                }
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'יעד תגמול (Target)' : 'Target Reward'}
              </span>
              <input
                type="number"
                step={0.05}
                min={-1}
                max={2}
                value={targetReward}
                onChange={(e) => setTargetReward(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'רוחב CI מרבי' : 'Max CI Width'}
              </span>
              <input
                type="number"
                step={0.02}
                min={0.02}
                max={2}
                value={maxConfidenceIntervalWidth}
                onChange={(e) =>
                  setMaxConfidenceIntervalWidth(Number(e.target.value))
                }
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'רמת ביטחון (CI)' : 'Confidence Level'}
              </span>
              <input
                type="number"
                step={0.01}
                min={0.5}
                max={0.999}
                value={confidenceLevel}
                onChange={(e) => setConfidenceLevel(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'סבלנות התכנסות' : 'Patience'}
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={convergencePatience}
                onChange={(e) =>
                  setConvergencePatience(Number(e.target.value) || 1)
                }
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'שכפולים תקינים מין.' : 'Min Replicates'}
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={minSuccessfulReplicates}
                onChange={(e) =>
                  setMinSuccessfulReplicates(Number(e.target.value) || 1)
                }
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'גרעין אקראיות (Seed)' : 'Random Seed'}
              </span>
              <input
                type="number"
                min={0}
                max={1000000}
                value={randomSeed}
                onChange={(e) => setRandomSeed(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>

            <label className="col-span-2 space-y-1">
              <span className="text-[11px] text-slate-400 block">
                {isHe ? 'דגימות Bootstrap' : 'Bootstrap Resamples'}
              </span>
              <input
                type="number"
                min={200}
                max={5000}
                step={200}
                value={bootstrapSamples}
                onChange={(e) =>
                  setBootstrapSamples(Number(e.target.value) || 200)
                }
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </label>
          </div>

          {/* Bounded Search Space & Reward Function Spec */}
          <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3 space-y-2 text-[11px] font-mono tabular-nums text-slate-300">
            <div className="text-slate-400 uppercase tracking-wider text-[10px]">
              {isHe ? 'מרחב חיפוש ופונקציית תגמול' : 'Bounds & Reward Function'}
            </div>
            <div>parameter_a ∈ [0.00, 1.00]</div>
            <div>parameter_b ∈ [0.00, 1.00]</div>
            <div>parameter_c ∈ [0.00, 1.00]</div>
            <div className="pt-1 border-t border-slate-800 text-cyan-300">
              R = 1.00·yield − 0.20·toxicity − 0.05·cost
            </div>
          </div>

          {/* Explicit Safety Opt-In */}
          <label className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#07090E] p-3 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={virtualModeConfirmed}
              onChange={(e) => setVirtualModeConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-600 bg-[#0D1320] text-cyan-500 focus:ring-cyan-500"
            />
            <span>
              {isHe
                ? 'אישור מפורש: הרצה בסימולטור וירטואלי בלבד (physical_execution = false, ללא גישת חומרה/מעבדה).'
                : 'Explicit opt-in: Execute strictly in Virtual Simulator mode (physical_execution = false, zero hardware actuation).'}
            </span>
          </label>

          {!canExecute && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-200">
              <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                {isHe
                  ? 'מצב צפייה בלבד. יש להתחבר כחוקר או חוקר ראשי כדי להריץ.'
                  : `Read-only role (${userRole}). Sign in as Researcher or Principal Investigator to run.`}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleRunController()}
            disabled={running || !canExecute || !virtualModeConfirmed}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-colors"
          >
            {running ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            <span>
              {running
                ? isHe
                  ? 'מריץ לולאה אוטונומית...'
                  : 'Running Closed-Loop Controller...'
                : isHe
                  ? 'הרץ בקר אוטונומי במעגל סגור'
                  : 'Run Closed-Loop Controller'}
            </span>
          </button>

          {/* Past Runs List */}
          {overview && overview.runs.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="text-[11px] font-medium text-slate-400">
                {isHe ? 'ריצות שמורות' : 'Recorded Closed-Loop Runs'}
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {overview.runs.map((run) => {
                  const selected = activeRun?.runId === run.runId;
                  const meta = statusIndicator(run.status, isHe);
                  return (
                    <button
                      key={run.runId}
                      type="button"
                      data-testid="safe-ui-test"
                      onClick={() => setSelectedRunId(run.runId)}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors ${
                        selected
                          ? 'border-cyan-500/50 bg-cyan-500/10'
                          : 'border-slate-800 bg-[#07090E] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono tabular-nums">
                        <span className="text-slate-100">{run.runId}</span>
                        <span className="text-cyan-300">
                          {formatNum(run.bestReward)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className={meta.colorClass}>{meta.label}</span>
                        <span className="text-slate-500 font-mono tabular-nums">
                          {run.iterations} iter · {run.successfulSimulations} sims
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right Telemetry & Evidence Stage */}
        <section className="lg:col-span-8 space-y-5">
          {loading ? (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-10 text-center text-xs text-slate-400">
              {isHe ? 'טוען נתוני בקר אוטונומי...' : 'Loading autonomous telemetry...'}
            </div>
          ) : !activeRun ? (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-10 text-center space-y-2">
              <div className="text-sm font-medium text-slate-200">
                {isHe
                  ? 'טרם הורצה לולאת סימולציה אוטונומית'
                  : 'No Closed-Loop Autonomous Run Recorded Yet'}
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {isHe
                  ? 'אשר מצב סימולטור וירטואלי בלבד והפעל את הבקר משמאל כדי לייצר אצוות מועמדים, לחשב רווח בר־סמך Bootstrap ולנעול תנאים מיטביים.'
                  : 'Confirm Virtual Simulator mode and start the controller on the left to execute bounded candidate batches, compute bootstrap confidence intervals, and verify convergence.'}
              </p>
            </div>
          ) : (
            <>
              {/* Active Run Metadata Strip */}
              <div className="bg-[#0D1320] border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-mono tabular-nums flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-slate-100 font-semibold">
                    {activeRun.runId}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className={activeStatusMeta?.colorClass}>
                    {activeStatusMeta?.label}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">
                    physical_execution={String(activeRun.physicalExecution)}
                  </span>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-400">
                  {activeRun.reportPath}
                </div>
              </div>

              {/* 4-Column KPI Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4">
                  <div className="text-[11px] text-slate-400">
                    {isHe ? 'תגמול ממוצע מיטבי' : 'Best Mean Reward'}
                  </div>
                  <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-cyan-300">
                    {formatNum(activeRun.bestReward)}
                  </div>
                  <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-400">
                    target ≥ {formatNum(activeRun.config.targetReward, 2)}
                  </div>
                </div>

                <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4">
                  <div className="text-[11px] text-slate-400">
                    {isHe ? 'רווח בר־סמך Bootstrap' : 'Bootstrap 95% CI'}
                  </div>
                  <div className="mt-1.5 text-sm font-mono tabular-nums font-semibold text-slate-100">
                    {activeRun.bestCandidate
                      ? `[${formatNum(activeRun.bestCandidate.confidenceLower, 3)}, ${formatNum(activeRun.bestCandidate.confidenceUpper, 3)}]`
                      : '—'}
                  </div>
                  <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-400">
                    width={formatNum(activeRun.bestCandidate?.confidenceWidth)} (max{' '}
                    {formatNum(activeRun.config.maxConfidenceIntervalWidth, 2)})
                  </div>
                </div>

                <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4">
                  <div className="text-[11px] text-slate-400">
                    {isHe ? 'פרמטרים מועמד מיטבי' : 'Best Candidate (a / b / c)'}
                  </div>
                  <div className="mt-1.5 text-sm font-mono tabular-nums font-semibold text-emerald-300">
                    {activeRun.bestCandidate
                      ? `${formatNum(activeRun.bestCandidate.parameters.parameter_a, 3)} · ${formatNum(activeRun.bestCandidate.parameters.parameter_b, 3)} · ${formatNum(activeRun.bestCandidate.parameters.parameter_c, 3)}`
                      : '—'}
                  </div>
                  <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-400">
                    {activeRun.bestCandidate?.lockCriteriaMet
                      ? '● Lock criteria satisfied'
                      : '○ Below lock threshold'}
                  </div>
                </div>

                <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4">
                  <div className="text-[11px] text-slate-400">
                    {isHe ? 'איטרציות וסימולציות' : 'Iterations & Simulations'}
                  </div>
                  <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-slate-100">
                    {activeRun.iterations} iter
                  </div>
                  <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-400">
                    {activeRun.successfulSimulations}/{activeRun.totalSimulations} passed ·{' '}
                    {activeRun.failedSimulations} failed
                  </div>
                </div>
              </div>

              {/* Convergence & Bootstrap Confidence Chart */}
              {chartData && (
                <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      {isHe
                        ? 'גרף התכנסות ותחום סמך Bootstrap'
                        : 'Convergence Trajectory & Bootstrap CI Band'}
                    </h3>
                    <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-0.5 bg-cyan-400" />
                        <span>globalBestReward</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-0.5 bg-slate-400 border-t border-dashed border-slate-300" />
                        <span>iterationBest</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-2 bg-cyan-500/20 border border-cyan-500/40" />
                        <span>95% CI</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-0.5 bg-amber-400" />
                        <span>target</span>
                      </span>
                    </div>
                  </div>

                  <div className="w-full overflow-x-auto">
                    <svg
                      viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                      className="w-full h-56 text-slate-400"
                      role="img"
                      aria-label="Autonomous optimization convergence chart"
                    >
                      {/* Y axis grid lines */}
                      {chartData.yTicks.map((tick, i) => (
                        <g key={i}>
                          <line
                            x1={chartData.padLeft}
                            y1={tick.y}
                            x2={chartData.width - chartData.padRight}
                            y2={tick.y}
                            stroke="#1E293B"
                            strokeWidth="1"
                          />
                          <text
                            x={chartData.padLeft - 6}
                            y={tick.y + 4}
                            textAnchor="end"
                            fill="#94A3B8"
                            fontSize="10"
                            fontFamily="monospace"
                          >
                            {tick.value.toFixed(2)}
                          </text>
                        </g>
                      ))}

                      {/* Target threshold line */}
                      <line
                        x1={chartData.padLeft}
                        y1={chartData.targetY}
                        x2={chartData.width - chartData.padRight}
                        y2={chartData.targetY}
                        stroke="#F59E0B"
                        strokeWidth="1.2"
                        strokeDasharray="4 4"
                      />

                      {/* Bootstrap CI Band */}
                      {chartData.ciPolygon && (
                        <polygon
                          points={chartData.ciPolygon}
                          fill="rgba(6, 182, 212, 0.14)"
                        />
                      )}

                      {/* Iteration best polyline */}
                      {chartData.iterLine && (
                        <polyline
                          fill="none"
                          stroke="#94A3B8"
                          strokeWidth="1.4"
                          strokeDasharray="3 3"
                          points={chartData.iterLine}
                        />
                      )}

                      {/* Global best polyline */}
                      {chartData.globalLine && (
                        <polyline
                          fill="none"
                          stroke="#06B6D4"
                          strokeWidth="2.2"
                          points={chartData.globalLine}
                        />
                      )}

                      {/* Points & X-axis labels */}
                      {chartData.points.map((pt, idx) => {
                        const cx = chartData.xForIndex(idx);
                        const cy =
                          pt.globalBestReward !== null
                            ? chartData.yForValue(pt.globalBestReward)
                            : null;
                        return (
                          <g key={pt.iteration}>
                            {cy !== null && (
                              <circle
                                cx={cx}
                                cy={cy}
                                r="3.5"
                                fill="#06B6D4"
                                stroke="#07090E"
                                strokeWidth="1.2"
                              />
                            )}
                            <text
                              x={cx}
                              y={chartData.height - 10}
                              textAnchor="middle"
                              fill="#94A3B8"
                              fontSize="10"
                              fontFamily="monospace"
                            >
                              {pt.iteration}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              )}

              {/* Replicated Candidate Evaluations Table */}
              <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    {isHe
                      ? 'הערכות מועמדים משוכפלות (מובילים)'
                      : 'Top Replicated Candidate Evaluations'}
                  </h3>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {activeRun.evaluations.length}{' '}
                    {isHe ? 'מועמדים הוערכו' : 'candidates evaluated'}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono tabular-nums border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                        <th className="py-2 pr-3 font-medium">Candidate</th>
                        <th className="py-2 pr-3 font-medium">Iter</th>
                        <th className="py-2 pr-3 font-medium">a / b / c</th>
                        <th className="py-2 pr-3 font-medium">Yield</th>
                        <th className="py-2 pr-3 font-medium">Tox</th>
                        <th className="py-2 pr-3 font-medium">Mean Reward</th>
                        <th className="py-2 pr-3 font-medium">95% CI</th>
                        <th className="py-2 font-medium">Lock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {[...activeRun.evaluations]
                        .sort((a, b) => b.meanReward - a.meanReward)
                        .slice(0, 10)
                        .map((ev) => (
                          <tr
                            key={ev.candidateId}
                            className="hover:bg-slate-900/40"
                          >
                            <td className="py-2 pr-3 text-slate-200">
                              {ev.candidateId}
                            </td>
                            <td className="py-2 pr-3 text-slate-400">
                              {ev.iteration}
                            </td>
                            <td className="py-2 pr-3 text-slate-300">
                              {ev.parameters.parameter_a.toFixed(3)} ·{' '}
                              {ev.parameters.parameter_b.toFixed(3)} ·{' '}
                              {ev.parameters.parameter_c.toFixed(3)}
                            </td>
                            <td className="py-2 pr-3 text-emerald-300">
                              {ev.metricsMean.yield.toFixed(3)}
                            </td>
                            <td className="py-2 pr-3 text-amber-300">
                              {ev.metricsMean.toxicity.toFixed(3)}
                            </td>
                            <td className="py-2 pr-3 text-cyan-300 font-semibold">
                              {ev.meanReward.toFixed(4)}
                            </td>
                            <td className="py-2 pr-3 text-slate-300">
                              [{ev.confidenceLower.toFixed(3)},{' '}
                              {ev.confidenceUpper.toFixed(3)}]
                            </td>
                            <td className="py-2">
                              {ev.lockCriteriaMet ? (
                                <span className="text-emerald-400">● Met</span>
                              ) : (
                                <span className="text-slate-500">○ No</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Hash-Chained Audit Ledger */}
          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                {isHe
                  ? 'יומן ביקורת משורשר SHA-256 (Append-Only)'
                  : 'Hash-Chained Audit Ledger (Append-Only JSONL)'}
              </h3>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                head: {chainVerification?.headRecordHash.slice(0, 16) ?? 'GENESIS'}…
              </span>
            </div>

            {activeAuditEvents.length === 0 ? (
              <div className="text-xs text-slate-500 py-3">
                {isHe ? 'אין רשומות ביקורת עדיין.' : 'No audit events recorded yet.'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto font-mono tabular-nums text-[11px]">
                {activeAuditEvents.map((ev) => (
                  <div
                    key={ev.eventId}
                    className="rounded-lg border border-slate-800/80 bg-[#07090E] px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                  >
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="text-slate-500">#{ev.id}</span>
                      <span className="text-cyan-300 font-semibold">{ev.event}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300">{ev.runId}</span>
                    </div>
                    <div className="text-slate-400">
                      {ev.previousHash.slice(0, 8)} →{' '}
                      <span className="text-emerald-400">
                        {ev.recordHash.slice(0, 12)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
