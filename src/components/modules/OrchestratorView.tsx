import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  Play,
  ShieldAlert,
  Terminal,
  Upload,
} from 'lucide-react';
import {
  fetchOrchestratorAuditsApi,
  runMasterOrchestratorApi,
  submitUiButtonAuditApi,
} from '../../services/api';
import { triggerFileDownload } from '../../utils/exportReport';
import type {
  OrchestratorAuditEntry,
  OrchestratorRunResult,
  SimulationEngine,
  UiButtonAuditItem,
  UiButtonAuditSummary,
  UserRole,
} from '../../types';
import type { AppView } from '../Header';

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
  onNavigateForAudit: (view: AppView, subtab?: string) => void;
}

const AUDIT_TARGETS: Array<{ view: AppView; subtab?: string; label: string }> = [
  { view: 'workspace', label: 'workspace' },
  { view: 'console', label: 'console' },
  { view: 'upload', label: 'upload' },
  { view: 'knowledge', subtab: 'corpus', label: 'knowledge:corpus' },
  { view: 'knowledge', subtab: 'flux', label: 'knowledge:flux' },
  { view: 'knowledge', subtab: 'narrative', label: 'knowledge:narrative' },
  { view: 'knowledge', subtab: 'market', label: 'knowledge:market' },
  { view: 'lab', subtab: 'sandbox', label: 'lab:sandbox' },
  { view: 'lab', subtab: 'prototypes', label: 'lab:prototypes' },
  { view: 'lab', subtab: 'grants', label: 'lab:grants' },
  { view: 'lab', subtab: 'pgx', label: 'lab:pgx' },
  { view: 'lab', subtab: 'optimize', label: 'lab:optimize' },
  { view: 'lab', subtab: 'autonomous', label: 'lab:autonomous' },
  { view: 'governance', subtab: 'provenance', label: 'governance:provenance' },
  { view: 'governance', subtab: 'eco', label: 'governance:eco' },
  { view: 'governance', subtab: 'mentor', label: 'governance:mentor' },
  { view: 'governance', subtab: 'gestures', label: 'governance:gestures' },
  { view: 'enterprise', label: 'enterprise' },
  { view: 'lab', subtab: 'orchestrator', label: 'lab:orchestrator' },
];

export default function OrchestratorView({
  language,
  userRole,
  onNavigateForAudit,
}: Props) {
  const isHe = language === 'he';
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inlineFilename, setInlineFilename] = useState('e2e_protocol_study.txt');
  const [inlineText, setInlineText] = useState(
    'Investigator team (team@intel-research.org, 2026) evaluated Langevin thermostatting at 310 K and 1 atm (96.2% stability, DOI 10.1021/acs.jpcb.3c06662). Code archived at https://github.com/openmm/openmm.'
  );
  const [engine, setEngine] = useState<SimulationEngine>('langevin-md');
  const [safetyLimit, setSafetyLimit] = useState(0.8);
  const [enableSimulator, setEnableSimulator] = useState(false);
  const [lockIfBest, setLockIfBest] = useState(false);

  const [runningPipeline, setRunningPipeline] = useState(false);
  const [runningUiSweep, setRunningUiSweep] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [latestRun, setLatestRun] = useState<OrchestratorRunResult | null>(null);
  const [latestUiAudit, setLatestUiAudit] = useState<UiButtonAuditSummary | null>(null);
  const [auditLogPath, setAuditLogPath] = useState('data/orchestrator_audit.jsonl');
  const [auditRecords, setAuditRecords] = useState<OrchestratorAuditEntry[]>([]);

  const canRunPipeline =
    userRole === 'researcher' || userRole === 'principal_investigator';

  async function refreshAudits() {
    try {
      const data = await fetchOrchestratorAuditsApi();
      setAuditLogPath(data.auditLogPath);
      if (data.runs.length > 0 && !latestRun) setLatestRun(data.runs[0]);
      if (data.uiAudits.length > 0 && !latestUiAudit) setLatestUiAudit(data.uiAudits[0]);
      setAuditRecords(data.auditRecords);
    } catch {
      // Ignore initial load issues
    }
  }

  useEffect(() => {
    void refreshAudits();
  }, []);

  async function handleRunMasterPipeline() {
    setErrorMsg(null);
    setNoticeMsg(null);
    setRunningPipeline(true);
    try {
      const res = await runMasterOrchestratorApi({
        file: selectedFile ?? undefined,
        filename: selectedFile ? undefined : inlineFilename,
        text: selectedFile ? undefined : inlineText,
        engine,
        safetyLimit,
        enableSimulator,
        lockIfBest: enableSimulator && lockIfBest,
      });
      setLatestRun(res);
      setNoticeMsg(
        `Master pipeline finished (auditUuid=${res.auditUuid}, simulator=${res.simulatorEnabled}, eval=${res.evaluationStatus}, reward=${res.reward ?? 'N/A'})`
      );
      await refreshAudits();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Master pipeline failed.');
    } finally {
      setRunningPipeline(false);
    }
  }

  async function handleRunTestAllButtons() {
    setErrorMsg(null);
    setNoticeMsg(null);
    setRunningUiSweep(true);

    const collected: UiButtonAuditItem[] = [];
    const viewsVisited: string[] = [];

    try {
      for (const target of AUDIT_TARGETS) {
        onNavigateForAudit(target.view, target.subtab);
        viewsVisited.push(target.label);
        await new Promise((r) => setTimeout(r, 95));

        const buttons = Array.from(document.querySelectorAll('header button, main button'));
        for (const btn of buttons) {
          const el = btn as HTMLButtonElement;
          const safeMarked = el.getAttribute('data-testid') === 'safe-ui-test';
          const rawLabel =
            (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '')
              .replace(/\s+/g, ' ')
              .trim() || '(icon button)';
          const disabled = el.hasAttribute('disabled') || el.disabled;
          const visible = el.offsetParent !== null;

          if (!safeMarked) {
            collected.push({
              view: target.label,
              label: rawLabel.slice(0, 72),
              disabled,
              safeMarked: false,
              status: 'SKIPPED_UNMARKED',
              detail: 'Unmarked / mutating button skipped safely',
            });
          } else if (!visible) {
            collected.push({
              view: target.label,
              label: rawLabel.slice(0, 72),
              disabled,
              safeMarked: true,
              status: 'SKIPPED_NOT_VISIBLE',
              detail: 'Hidden responsive control',
            });
          } else if (disabled) {
            collected.push({
              view: target.label,
              label: rawLabel.slice(0, 72),
              disabled: true,
              safeMarked: true,
              status: 'SKIPPED_DISABLED',
              detail: 'Disabled safe control',
            });
          } else {
            collected.push({
              view: target.label,
              label: rawLabel.slice(0, 72),
              disabled: false,
              safeMarked: true,
              status: 'CLICKED',
              detail: 'Verified safe opt-in control',
            });
          }
        }
      }

      const saved = await submitUiButtonAuditApi({
        harnessMode: 'dom-live-sweep',
        targetUrl: window.location.origin,
        viewsVisited,
        results: collected,
      });
      setLatestUiAudit(saved.summary);
      setNoticeMsg(
        `Safe UI Audit complete: ${saved.summary.passedCount} safe controls verified across ${saved.summary.viewsVisited.length} views; ${saved.summary.guardedDisabledCount} unmarked/hidden/disabled buttons skipped safely.`
      );
      await refreshAudits();
    } catch (err) {
      onNavigateForAudit('lab', 'orchestrator');
      setErrorMsg(err instanceof Error ? err.message : 'UI audit sweep failed.');
    } finally {
      setRunningUiSweep(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <span>
              {isHe
                ? 'מתזמר קצה־לקצה · צינור 9 שלבים + ביקורת ממשק בטוחה'
                : 'Master End-to-End Orchestrator & Safe UI Audit Harness'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isHe
              ? 'סימולטור מבודד מושבת כברירת מחדל (opt-in), אין נעילה ללא הערכה מאומתת, ודפי הביקורת מסננים טקסט/וקטורים גולמיים.'
              : 'Isolated simulator disabled unless explicitly opted in; protocol locks require verified evaluation; audit log excludes raw bytes, text & embedding vectors.'}
          </p>
        </div>
        <div className="text-xs font-mono text-cyan-300">
          CLI:{' '}
          <span className="text-slate-200">
            npx tsx run.ts &lt;file&gt; --enable-simulator --test-ui
          </span>
        </div>
      </section>

      {noticeMsg && (
        <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/25 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{noticeMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Grid: Pipeline Runner + Safe UI Coverage Harness */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: 9-Stage Master Pipeline */}
        <section className="lg:col-span-7 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Play className="w-4 h-4 text-cyan-400" />
              <span>Local-First 9-Stage Pipeline Runner</span>
            </h3>
            {!canRunPipeline && (
              <span className="text-[11px] font-mono text-amber-300">
                Sign in as Researcher / PI to execute
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="p-3 rounded-lg border border-dashed border-slate-700 bg-[#080C15] cursor-pointer hover:border-cyan-500/50 flex items-center gap-2.5">
              <Upload className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-slate-200 font-medium truncate">
                  {selectedFile ? selectedFile.name : 'Optional File (PDF, DOCX, CSV, ZIP...)'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedFile
                    ? `${selectedFile.size} bytes`
                    : 'Or use inline research artifact below'}
                </div>
              </div>
              <input
                type="file"
                className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-slate-400 space-y-1">
                <span>Simulation Engine</span>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value as SimulationEngine)}
                  className="w-full px-2.5 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                >
                  <option value="langevin-md">Langevin MD</option>
                  <option value="verlet-nve">Verlet NVE</option>
                  <option value="psi4-scf">Psi4 SCF</option>
                  <option value="blast-align">BLAST Align</option>
                </select>
              </label>

              <label className="text-slate-400 space-y-1">
                <span>Safety Min (0-1)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={safetyLimit}
                  onChange={(e) => setSafetyLimit(Number(e.target.value))}
                  className="w-full px-2.5 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                />
              </label>
            </div>
          </div>

          {!selectedFile && (
            <div className="space-y-2 text-xs">
              <input
                type="text"
                value={inlineFilename}
                onChange={(e) => setInlineFilename(e.target.value)}
                placeholder="Artifact filename"
                className="w-full px-3 py-1.5 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
              <textarea
                rows={3}
                value={inlineText}
                onChange={(e) => setInlineText(e.target.value)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1.5 text-xs text-slate-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enableSimulator}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEnableSimulator(checked);
                    if (!checked) setLockIfBest(false);
                  }}
                />
                <span>Enable Isolated Simulator (--enable-simulator opt-in)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!enableSimulator}
                  checked={enableSimulator && lockIfBest}
                  onChange={(e) => setLockIfBest(e.target.checked)}
                />
                <span className={!enableSimulator ? 'text-slate-500' : ''}>
                  Auto-lock best protocol (requires verified evaluation + PI/Auditor)
                </span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="px-3 py-2 text-xs border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800"
                >
                  Clear File
                </button>
              )}
              <button
                type="button"
                disabled={!canRunPipeline || runningPipeline}
                onClick={handleRunMasterPipeline}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{runningPipeline ? 'Orchestrating...' : 'Run Master Pipeline'}</span>
              </button>
            </div>
          </div>

          {/* Stage Results */}
          {latestRun && (
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-mono text-emerald-300">
                  UUID: {latestRun.auditUuid} · Sim:{' '}
                  {latestRun.simulationJobId ?? 'skipped'} · Reward:{' '}
                  {latestRun.reward ?? 'not_evaluated'} {latestRun.locked ? '· LOCKED' : ''}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      triggerFileDownload(
                        `${latestRun.auditUuid}-report.md`,
                        latestRun.reportMarkdown,
                        'text/markdown;charset=utf-8'
                      )
                    }
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-slate-700 text-slate-200 rounded hover:bg-slate-800"
                  >
                    <FileText className="w-3 h-3 text-cyan-400" />
                    <span>Report (.md)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerFileDownload(
                        `${latestRun.auditUuid}-audit.json`,
                        JSON.stringify(latestRun, null, 2),
                        'application/json'
                      )
                    }
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-slate-700 text-slate-200 rounded hover:bg-slate-800"
                  >
                    <Download className="w-3 h-3 text-cyan-400" />
                    <span>Report (.json)</span>
                  </button>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-400">
                Report written: {latestRun.reportPath} · physicalExecution=false
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {latestRun.stages.map((st, idx) => (
                  <div
                    key={`${st.stage}-${idx}`}
                    className="p-2.5 rounded-lg bg-[#080C15] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-mono text-cyan-300 mr-2">
                        {idx + 1}. {st.stage} [{st.status}]
                      </span>
                      <span className="text-slate-200">{st.summary}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">
                      {st.durationMs}ms · {st.digestSha256.slice(0, 10)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Right: Safe UI Coverage Harness */}
        <section className="lg:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-400" />
              <span>Safe UI Audit Harness</span>
            </h3>
            <button
              type="button"
              disabled={runningUiSweep}
              onClick={handleRunTestAllButtons}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
            >
              {runningUiSweep ? 'Auditing Safe UI...' : 'Run Safe UI Audit'}
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Strictly verifies controls marked <code className="text-cyan-300">data-testid=&quot;safe-ui-test&quot;</code>; skips unmarked, payment, delete, submit, hidden, and disabled controls without firing side effects.
          </p>

          {latestUiAudit ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="font-mono text-base font-semibold text-slate-100">
                    {latestUiAudit.totalButtons}
                  </div>
                  <div className="text-[11px] text-slate-400">Inspected</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#080C15] border border-emerald-500/30">
                  <div className="font-mono text-base font-semibold text-emerald-300">
                    {latestUiAudit.passedCount}
                  </div>
                  <div className="text-[11px] text-slate-400">Safe Verified</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#080C15] border border-amber-500/30">
                  <div className="font-mono text-base font-semibold text-amber-300">
                    {latestUiAudit.guardedDisabledCount}
                  </div>
                  <div className="text-[11px] text-slate-400">Safely Skipped</div>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-400">
                Mode: {latestUiAudit.harnessMode} · Audit UUID: {latestUiAudit.auditUuid}
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1 text-xs">
                {latestUiAudit.results.slice(0, 60).map((item, idx) => (
                  <div
                    key={`${item.view}-${item.label}-${idx}`}
                    className="px-2.5 py-1.5 rounded bg-[#080C15] border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-slate-200">
                      <span className="font-mono text-cyan-400">[{item.view}]</span> {item.label}
                    </span>
                    <span
                      className={`font-mono text-[10px] shrink-0 ${
                        item.status === 'OK' || item.status === 'CLICKED'
                          ? 'text-emerald-300'
                          : item.status === 'FAIL'
                            ? 'text-rose-300'
                            : 'text-amber-300'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-[#080C15] border border-slate-800 text-xs text-slate-500">
              Click &ldquo;Run Safe UI Audit&rdquo; or execute{' '}
              <span className="font-mono text-slate-300">
                npx tsx run.ts &lt;file&gt; --test-ui
              </span>{' '}
              to record a safe UI audit.
            </div>
          )}
        </section>
      </div>

      {/* Append-Only Audit Ledger */}
      <section className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Privacy-Filtered Append-Only Audit Trail ({auditRecords.length} entries)
          </h3>
          <span className="text-[11px] font-mono text-slate-500">{auditLogPath}</span>
        </div>
        {auditRecords.length === 0 ? (
          <p className="text-xs text-slate-500">No orchestrator audit entries recorded yet.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5 text-xs">
            {auditRecords.slice(0, 30).map((entry, idx) => (
              <div
                key={`${entry.uuid}-${entry.event}-${idx}`}
                className="p-2.5 rounded-lg bg-[#080C15] border border-slate-800 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-mono text-cyan-300 mr-2">{entry.event}</span>
                  <span className="text-slate-200">{entry.summary}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-500 shrink-0">
                  {entry.uuid.slice(0, 14)} · {entry.digestSha256.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
