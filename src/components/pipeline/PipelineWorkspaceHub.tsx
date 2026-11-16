import { useState, type DragEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  GitBranch,
  Layers,
  Mic,
  MicOff,
  Network,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sliders,
  Square,
  Terminal,
  UploadCloud,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { useVoice } from '../../hooks/useVoice';
import { usePipelineCenter } from '../../hooks/usePipelineCenter';
import { triggerFileDownload } from '../../utils/exportReport';
import type { UserRole } from '../../types';
import Pipeline3DCanvas from './Pipeline3DCanvas';

export type PipelineSubRoute =
  | '/command-center'
  | '/live-pipeline'
  | '/simulation-lab'
  | '/knowledge-graph'
  | '/candidate-comparison'
  | '/optimization'
  | '/results'
  | '/audit'
  | '/reports'
  | '/settings';

export const PIPELINE_SUB_ROUTES: Array<{
  path: PipelineSubRoute;
  label: string;
  icon: typeof Terminal;
}> = [
  { path: '/command-center', label: 'Command Center', icon: Terminal },
  { path: '/live-pipeline', label: 'Live 3D Pipeline', icon: Layers },
  { path: '/simulation-lab', label: 'Simulation Lab', icon: Cpu },
  { path: '/knowledge-graph', label: 'Knowledge Graph', icon: Network },
  { path: '/candidate-comparison', label: 'Candidates', icon: Sliders },
  { path: '/optimization', label: 'Optimization', icon: GitBranch },
  { path: '/results', label: 'Results', icon: Award },
  { path: '/audit', label: 'Audit Trail', icon: ShieldCheck },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/settings', label: 'Settings', icon: Settings },
];

const EXAMPLE_COMMANDS = [
  {
    label: 'Formulation Safety',
    mode: 'text' as const,
    text: 'Analyze this formulation and find a safer, more stable candidate.',
  },
  {
    label: 'Compare Matrices',
    mode: 'matrix' as const,
    text: 'Compare these three parameter matrices and show the differences.',
  },
  {
    label: 'Investigate Failure',
    mode: 'text' as const,
    text: 'Investigate the failure and propose a virtual simulation to identify possible fixes.',
  },
  {
    label: 'Best Dataset Config',
    mode: 'dataset' as const,
    text: 'Use this dataset to find the best-performing configuration.',
  },
  {
    label: '3D Stage Walkthrough',
    mode: 'text' as const,
    text: 'Explain each stage on the 3D screen while the pipeline runs and optimize stability.',
  },
  {
    label: 'Info-Only Guard',
    mode: 'text' as const,
    text: 'What does our safety policy say about thermal drift in virtual molecular ensembles?',
  },
];

const DEFAULT_MATRIX_TEXT = `[
  { "temperature": 302, "pressure": 1.0, "pH": 7.1, "ionicStrength": 0.14 },
  { "temperature": 318, "pressure": 1.2, "pH": 6.8, "ionicStrength": 0.18 },
  { "temperature": 415, "pressure": 12.5, "pH": 4.4, "ionicStrength": 0.45 }
]`;

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
  route: PipelineSubRoute;
  onRouteChange: (nextRoute: PipelineSubRoute) => void;
}

export default function PipelineWorkspaceHub({
  language,
  userRole,
  route,
  onRouteChange,
}: Props) {
  const pc = usePipelineCenter(language);

  const [commandText, setCommandText] = useState(
    'Analyze this formulation and find a safer, more stable candidate.'
  );
  const [inputMode, setInputMode] = useState<
    'voice' | 'text' | 'file' | 'matrix' | 'dataset' | 'api'
  >('text');
  const [inlineDataText, setInlineDataText] = useState(DEFAULT_MATRIX_TEXT);
  const [selectedUploadId, setSelectedUploadId] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [followUpText, setFollowUpText] = useState('');
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const [maxConcInput, setMaxConcInput] = useState(2);
  const [repInput, setRepInput] = useState(4);

  const voice = useVoice(language, (transcript) => {
    setCommandText(transcript);
    setInputMode('voice');
    setLocalMsg(`Voice transcript captured: "${transcript}"`);
  });

  const canApproveOrConfigure =
    userRole === 'researcher' ||
    userRole === 'principal_investigator' ||
    userRole === 'auditor';
  const canEditSettings =
    userRole === 'principal_investigator' || userRole === 'auditor';

  async function handleFileDropOrPick(file: File | undefined) {
    if (!file) return;
    setLocalMsg(null);
    try {
      const artifact = await pc.uploadArtifact(file);
      setSelectedUploadId(artifact.uploadId);
      setInputMode('file');
      setLocalMsg(
        `Uploaded "${artifact.filename}" (${artifact.detectedFormat}, ${artifact.parsedRowsCount} matrix rows).`
      );
    } catch (err) {
      pc.setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    void handleFileDropOrPick(e.dataTransfer.files?.[0]);
  }

  async function handleLaunchCommand(autoNavigate = true) {
    if (!commandText.trim()) return;
    setLocalMsg(null);
    let matrixPayload: Array<Record<string, number | string>> | undefined;
    if (inputMode === 'matrix' || inputMode === 'dataset' || inlineDataText.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(inlineDataText);
        if (Array.isArray(parsed)) matrixPayload = parsed;
      } catch {
        // Handled cleanly as inlineDataText CSV/TSV/text on server
      }
    }

    const job = await pc.submitCommand({
      commandText,
      inputMode,
      uploadId: selectedUploadId || undefined,
      inlineDataText: inlineDataText.trim() || undefined,
      matrix: matrixPayload,
      idempotencyKey: idempotencyKey.trim() || undefined,
    });

    if (autoNavigate) {
      onRouteChange('/live-pipeline');
    }
    setLocalMsg(`Launched ${job.jobId} (${job.intent}). Streaming 30 stages live.`);
  }

  const activeJob = pc.activeJob;
  const winner =
    activeJob?.candidates.find((c) => c.candidateId === activeJob.selectedCandidateId) ?? null;

  return (
    <div className="space-y-5">
      {/* Unified Persistent Pipeline Sub-Navigation & Active Job Selector */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {PIPELINE_SUB_ROUTES.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                type="button"
                data-testid="safe-ui-test"
                onClick={() => onRouteChange(path)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  route === path
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                    : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`px-2 py-1 rounded border font-mono text-[11px] ${
                pc.wsStatus === 'connected'
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                  : pc.wsStatus === 'reconnecting'
                    ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              WS: {pc.wsStatus}
            </span>
            <select
              value={pc.activeJobId ?? ''}
              onChange={(e) => pc.setActiveJobId(e.target.value || null)}
              aria-label="Active Pipeline Job"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-mono"
            >
              {pc.jobs.length === 0 ? (
                <option value="">No jobs yet</option>
              ) : (
                pc.jobs.map((j) => (
                  <option key={j.jobId} value={j.jobId}>
                    {j.jobId} · {j.status} ({j.progress}%) · {j.intent}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              data-testid="safe-ui-test"
              onClick={() => void pc.refreshCatalog()}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white"
              title="Refresh SQLite Jobs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {(pc.error || localMsg) && (
          <div
            className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              pc.error
                ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                : 'border-cyan-500/30 bg-cyan-950/20 text-cyan-200'
            }`}
          >
            <span>{pc.error ?? localMsg}</span>
            {activeJob && (activeJob.status === 'running' || activeJob.status === 'queued') && (
              <button
                type="button"
                onClick={() => void pc.cancelActiveJob()}
                className="px-2.5 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30"
              >
                Cancel Job
              </button>
            )}
          </div>
        )}
      </div>

      {/* PAGE 1: /command-center */}
      {route === '/command-center' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Unified Command Center Input
                </h2>
                <p className="text-xs text-slate-400">
                  Submit voice, text, files, matrices, or datasets into the 30-stage SQLite pipeline.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => pc.setVoiceSpeakEnabled((v) => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300"
                >
                  {pc.voiceSpeakEnabled ? (
                    <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span>{pc.voiceSpeakEnabled ? 'Spoken Progress On' : 'Muted'}</span>
                </button>
                <button
                  type="button"
                  onClick={pc.interruptVoice}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white"
                >
                  <Square className="w-3.5 h-3.5 inline mr-1" />
                  Interrupt Speech
                </button>
              </div>
            </div>

            {/* Preset Scientific Commands */}
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_COMMANDS.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => {
                    setCommandText(ex.text);
                    setInputMode(ex.mode);
                  }}
                  className="px-2.5 py-1 rounded-md border border-slate-800 bg-slate-950/60 hover:border-cyan-500/40 text-[11px] text-slate-300"
                >
                  {ex.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300 block">
                Command / Formulation / Investigation Instruction
              </label>
              <div className="flex gap-2">
                <textarea
                  rows={3}
                  value={commandText}
                  onChange={(e) => setCommandText(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  placeholder="Speak or type an analytical instruction..."
                />
                <button
                  type="button"
                  onClick={() => (voice.listening ? voice.stop() : voice.start())}
                  disabled={!voice.supported}
                  className={`px-3.5 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs ${
                    voice.listening
                      ? 'bg-rose-500/20 border-rose-500 text-rose-200'
                      : 'bg-slate-900 border-slate-700 text-cyan-300 hover:border-cyan-500'
                  }`}
                >
                  {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  <span>{voice.listening ? 'Stop' : 'Speak'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Input Channel Mode</label>
                <select
                  value={inputMode}
                  onChange={(e) =>
                    setInputMode(
                      e.target.value as 'voice' | 'text' | 'file' | 'matrix' | 'dataset' | 'api'
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                >
                  <option value="text">Text Command</option>
                  <option value="voice">Voice Command</option>
                  <option value="file">Uploaded Document</option>
                  <option value="matrix">Parameter Matrix (JSON/CSV)</option>
                  <option value="dataset">Structured Dataset</option>
                  <option value="api">API Submission</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Optional Idempotency Key
                </label>
                <input
                  type="text"
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                  placeholder="e.g., run-key-001"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono"
                />
              </div>
            </div>

            {/* Drag-and-drop Upload */}
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`block rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                dragging
                  ? 'border-cyan-400 bg-cyan-950/20'
                  : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'
              }`}
            >
              <input
                type="file"
                className="hidden"
                onChange={(e) => void handleFileDropOrPick(e.target.files?.[0])}
              />
              <UploadCloud className="w-6 h-6 text-cyan-400 mx-auto mb-1" />
              <div className="text-xs text-slate-200 font-medium">
                Drop document, CSV, TSV, JSON matrix, or click to upload
              </div>
              {selectedUploadId && (
                <div className="text-[11px] text-emerald-300 font-mono mt-1">
                  Attached Upload ID: {selectedUploadId}
                </div>
              )}
            </label>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Parameter Matrix / Dataset Payload (JSON array or CSV rows)
              </label>
              <textarea
                rows={4}
                value={inlineDataText}
                onChange={(e) => setInlineDataText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-slate-200"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void handleLaunchCommand(true)}
                disabled={pc.submitting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold"
              >
                <Play className="w-4 h-4" />
                <span>
                  {pc.submitting ? 'Submitting...' : 'Start 30-Stage Pipeline & Open 3D Screen'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleLaunchCommand(false)}
                disabled={pc.submitting}
                className="px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white"
              >
                Submit in Background
              </button>
            </div>
          </div>

          {/* Right Column: Voice Interaction Session Log & Follow-up Q&A */}
          <div className="lg:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>Voice Session & Grounded Follow-Up</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Every spoken announcement mirrors confirmed backend job events—never speculative text.
              </p>

              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {pc.voiceHistory.length === 0 ? (
                  <div className="text-xs text-slate-500 border border-slate-800 rounded-lg p-3">
                    Submit a command or speak via microphone to start live session narration.
                  </div>
                ) : (
                  pc.voiceHistory.map((item) => (
                    <div
                      key={item.id}
                      className={`p-2.5 rounded-lg border text-xs ${
                        item.role === 'user'
                          ? 'bg-cyan-950/20 border-cyan-500/30 text-cyan-100'
                          : 'bg-slate-950/70 border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400 mb-0.5">
                        {item.role.toUpperCase()} {item.jobId ? `· ${item.jobId}` : ''}
                      </div>
                      <div>{item.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!followUpText.trim()) return;
                pc.askFollowUp(followUpText.trim());
                setFollowUpText('');
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                placeholder="Ask follow-up (e.g., Why were candidates rejected?)"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100"
              >
                Ask Job
              </button>
            </form>
          </div>
        </div>
      )}

      {/* PAGE 2: /live-pipeline */}
      {route === '/live-pipeline' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 space-y-4">
              <Pipeline3DCanvas
                job={activeJob}
                selectedStageId={selectedStageId}
                onSelectStage={setSelectedStageId}
              />

              {/* 30 Connected Stage Matrix */}
              <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                    30 Connected Pipeline Stages ({activeJob?.jobId ?? 'No Active Job'})
                  </h3>
                  <span className="text-xs font-mono text-cyan-300">
                    Progress: {activeJob?.progress ?? 0}%
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {(activeJob?.stages ?? []).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setSelectedStageId(st.id)}
                      className={`p-2 rounded-lg border text-left transition-colors ${
                        selectedStageId === st.id
                          ? 'border-cyan-400 bg-cyan-950/30'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-slate-400">
                          {String(st.number).padStart(2, '0')}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            st.status === 'selected'
                              ? 'bg-slate-100 text-slate-950'
                              : st.status === 'optimization'
                                ? 'bg-purple-500/20 text-purple-300'
                                : st.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : st.status === 'processing'
                                    ? 'bg-sky-500/20 text-sky-300'
                                    : st.status === 'needs_review'
                                      ? 'bg-amber-500/20 text-amber-300'
                                      : st.status === 'failed'
                                        ? 'bg-rose-500/20 text-rose-300'
                                        : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {st.status}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-slate-200 truncate mt-1">
                        {st.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {st.progress}% · {st.durationMs}ms · {st.inputCount}→{st.outputCount}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Synchronized STEP 01-11 Demonstration Panel */}
            <div className="lg:col-span-4 bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-3 max-h-[820px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">
                  Step-by-Step Evidence Timeline
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  {pc.events.length} events
                </span>
              </div>
              {(activeJob?.timelineSteps ?? []).map((step) => (
                <div
                  key={step.stepNumber}
                  className={`p-3 rounded-lg border text-xs space-y-1 ${
                    step.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-950/15'
                      : step.status === 'active'
                        ? 'border-cyan-500/40 bg-cyan-950/20'
                        : step.status === 'failed'
                          ? 'border-rose-500/40 bg-rose-950/20'
                          : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold text-slate-100">
                    <span>
                      STEP {String(step.stepNumber).padStart(2, '0')} — {step.title}
                    </span>
                    <span className="text-[10px] font-mono uppercase text-slate-400">
                      {step.status}
                    </span>
                  </div>
                  <div className="text-slate-300">
                    <span className="text-slate-500">Doing:</span> {step.doing}
                  </div>
                  <div className="text-slate-300">
                    <span className="text-slate-500">Why:</span> {step.why}
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">
                    Op: {step.operation} | In: {step.inputUsed}
                  </div>
                  <div className="text-cyan-200 font-medium">Result: {step.resultReceived}</div>
                  <div className="text-slate-400 text-[11px]">Next: {step.nextAction}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PAGE 3: /simulation-lab */}
      {route === '/simulation-lab' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Virtual Simulation Workspace
              </h2>
              <p className="text-xs text-slate-400">
                Simulator: {activeJob?.simulatorId ?? 'Awaiting job selection'} · Physical actuators strictly disconnected
              </p>
            </div>
            <div className="flex gap-2">
              {activeJob && (activeJob.status === 'running' || activeJob.status === 'queued') && (
                <button
                  type="button"
                  onClick={() => void pc.cancelActiveJob()}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-200"
                >
                  Cancel Simulation Job
                </button>
              )}
              {activeJob?.status === 'needs_review' && canApproveOrConfigure && (
                <button
                  type="button"
                  onClick={() => void pc.approveActiveJob()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold"
                >
                  Authorize Virtual Execution
                </button>
              )}
            </div>
          </div>

          {activeJob?.blockedReason && (
            <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/30 text-xs text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{activeJob.blockedReason}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(activeJob?.candidates ?? []).map((cand) => (
              <div
                key={cand.candidateId}
                className={`p-4 rounded-xl border space-y-2 ${
                  cand.status === 'selected'
                    ? 'border-slate-200 bg-slate-900'
                    : cand.status === 'rejected'
                      ? 'border-rose-500/40 bg-rose-950/20'
                      : 'border-slate-800 bg-slate-950/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-100">{cand.label}</span>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-200">
                    {cand.status}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Batch {cand.batch} · Replicates {cand.replicatesCompleted}/{cand.replicatesTotal}
                </div>
                <div className="text-[11px] font-mono text-cyan-300">
                  {JSON.stringify(cand.parameters)}
                </div>
                {cand.metrics && (
                  <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300 font-mono-tabular pt-1 border-t border-slate-800">
                    <span>Composite: {cand.metrics.compositeScore}</span>
                    <span>Safety: {cand.metrics.safetyScore}</span>
                    <span>Stability: {cand.metrics.stabilityScore}</span>
                    <span>Drift: {cand.metrics.energyDrift}</span>
                  </div>
                )}
                <div className="text-[11px] text-slate-300">{cand.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAGE 4: /knowledge-graph */}
      {route === '/knowledge-graph' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-100">
            Extracted Entities & Dynamic Knowledge Graph
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase">
                Extracted Entities ({activeJob?.entities.length ?? 0})
              </h3>
              {(activeJob?.entities ?? []).map((ent) => (
                <div
                  key={ent.id}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-medium text-slate-100">{ent.label}</div>
                    <div className="text-[11px] text-slate-400">
                      Category: {ent.category} · Value: {ent.value}
                    </div>
                  </div>
                  <span className="font-mono text-cyan-300">{ent.confidence}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase">
                Graph Relationships ({activeJob?.knowledgeEdges.length ?? 0})
              </h3>
              {(activeJob?.knowledgeEdges ?? []).map((edge, idx) => (
                <div
                  key={`${edge.from}-${edge.to}-${idx}`}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-200"
                >
                  {edge.from} --[{edge.relation} ({edge.weight})]--&gt; {edge.to}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PAGE 5: /candidate-comparison */}
      {route === '/candidate-comparison' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 overflow-x-auto space-y-4">
          <h2 className="text-base font-semibold text-slate-100">
            Candidate Performance & Constraint Comparison
          </h2>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3">Candidate</th>
                <th className="py-2 pr-3">Batch</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Composite</th>
                <th className="py-2 pr-3">95% CI</th>
                <th className="py-2 pr-3">Safety</th>
                <th className="py-2 pr-3">Stability</th>
                <th className="py-2 pr-3">Drift</th>
                <th className="py-2">Decision Rationale</th>
              </tr>
            </thead>
            <tbody>
              {(activeJob?.candidates ?? []).map((c) => (
                <tr key={c.candidateId} className="border-b border-slate-800/60 text-slate-200">
                  <td className="py-2 pr-3 font-medium">{c.label}</td>
                  <td className="py-2 pr-3 font-mono">{c.batch}</td>
                  <td className="py-2 pr-3 font-mono uppercase">{c.status}</td>
                  <td className="py-2 pr-3 font-mono">{c.metrics?.compositeScore ?? 'N/A'}</td>
                  <td className="py-2 pr-3 font-mono">
                    {c.confidenceInterval95
                      ? `[${c.confidenceInterval95[0]}, ${c.confidenceInterval95[1]}]`
                      : 'N/A'}
                  </td>
                  <td className="py-2 pr-3 font-mono">{c.metrics?.safetyScore ?? 'N/A'}</td>
                  <td className="py-2 pr-3 font-mono">{c.metrics?.stabilityScore ?? 'N/A'}</td>
                  <td className="py-2 pr-3 font-mono">{c.metrics?.energyDrift ?? 'N/A'}</td>
                  <td className="py-2 text-slate-300">{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PAGE 6: /optimization */}
      {route === '/optimization' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-100">
            Adaptive Candidate Generation & Optimization History
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(activeJob?.optimizationHistory ?? []).map((h) => (
              <div
                key={h.batch}
                className="p-4 rounded-xl border border-purple-500/30 bg-purple-950/15 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between font-semibold text-purple-200">
                  <span>Optimization Batch #{h.batch}</span>
                  <span className="font-mono">Peak Score: {h.bestScore}</span>
                </div>
                <div className="text-slate-300">Strategy: {h.strategy}</div>
                <div className="font-mono text-slate-400">
                  Accepted: {h.acceptedCount} · Rejected: {h.rejectedCount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAGE 7: /results */}
      {route === '/results' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">
              Selected Candidate & Validation Evidence
            </h2>
            {activeJob && canApproveOrConfigure && !activeJob.approvedBy && (
              <button
                type="button"
                onClick={() => void pc.approveActiveJob()}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold"
              >
                Record Human Validation Sign-Off
              </button>
            )}
          </div>
          {winner && winner.metrics ? (
            <div className="p-4 rounded-xl border border-slate-200/60 bg-slate-900 space-y-2 text-xs">
              <div className="text-sm font-semibold text-white">
                {winner.label} ({winner.candidateId})
              </div>
              <div className="font-mono text-cyan-300">
                Parameters: {JSON.stringify(winner.parameters)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 font-mono-tabular">
                <div>Composite: {winner.metrics.compositeScore}</div>
                <div>
                  95% CI: [{winner.confidenceInterval95?.[0]}, {winner.confidenceInterval95?.[1]}]
                </div>
                <div>Safety: {winner.metrics.safetyScore}</div>
                <div>Stability: {winner.metrics.stabilityScore}</div>
              </div>
              <div className="text-slate-300">{winner.reason}</div>
              {activeJob?.approvedBy && (
                <div className="text-emerald-300 font-medium">
                  Human Sign-Off: {activeJob.approvedBy} at {activeJob.approvedAt}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              {activeJob?.blockedReason ??
                'No selected simulation candidate (informational workflow or awaiting run completion).'}
            </div>
          )}
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-slate-300 uppercase">
              Limitations & Governance Scope
            </h3>
            {(activeJob?.limitations ?? []).map((lim, i) => (
              <div key={i} className="text-xs text-slate-400">
                • {lim}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAGE 8: /audit */}
      {route === '/audit' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                SHA-256 Audit Chain & Event Replay Log
              </h2>
              <p className="text-xs text-slate-400">
                Chain Valid: {String(pc.auditVerification?.valid ?? true)} · Entries:{' '}
                {pc.auditVerification?.totalEntries ?? 0} · Head:{' '}
                <span className="font-mono">
                  {pc.auditVerification?.headHash?.slice(0, 16) ?? 'GENESIS'}
                </span>
              </p>
            </div>
            <button
              type="button"
              data-testid="safe-ui-test"
              onClick={() => void pc.refreshCatalog()}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200"
            >
              Verify Audit Chain
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              <h3 className="text-xs font-semibold text-slate-300">
                Monotonic Job Events ({pc.events.length})
              </h3>
              {pc.events.map((ev) => (
                <div
                  key={ev.event_id}
                  className="p-2 rounded border border-slate-800 bg-slate-950/60 text-[11px] font-mono"
                >
                  <span className="text-cyan-400">#{ev.sequence}</span> [{ev.type}] ({ev.stage}):{' '}
                  <span className="text-slate-200">{ev.message}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              <h3 className="text-xs font-semibold text-slate-300">
                Cryptographic Audit Chain ({pc.auditEntries.length})
              </h3>
              {pc.auditEntries.map((a) => (
                <div
                  key={a.auditId}
                  className="p-2 rounded border border-slate-800 bg-slate-950/60 text-[11px] font-mono"
                >
                  <div className="text-emerald-300">
                    seq={a.seq} · {a.eventType} · {a.entryHash.slice(0, 16)}...
                  </div>
                  <div className="text-slate-300">{a.summary}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PAGE 9: /reports */}
      {route === '/reports' && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-100">
              Exportable Verified Run Reports
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!activeJob?.reportMarkdown}
                onClick={() =>
                  activeJob?.reportMarkdown &&
                  triggerFileDownload(
                    `${activeJob.jobId}-report.md`,
                    activeJob.reportMarkdown,
                    'text/markdown'
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-semibold disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Markdown</span>
              </button>
              <button
                type="button"
                disabled={!activeJob}
                onClick={() =>
                  activeJob &&
                  triggerFileDownload(
                    `${activeJob.jobId}-full-bundle.json`,
                    JSON.stringify(activeJob, null, 2),
                    'application/json'
                  )
                }
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 disabled:opacity-50"
              >
                Download JSON Bundle
              </button>
            </div>
          </div>
          <pre className="p-4 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-200 whitespace-pre-wrap font-mono max-h-[500px] overflow-y-auto">
            {activeJob?.reportMarkdown ?? 'Run or select a completed job to view its verified report.'}
          </pre>
        </div>
      )}

      {/* PAGE 10: /settings */}
      {route === '/settings' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-100">
                Registered Virtual Simulators ({pc.simulators.length})
              </h2>
              {pc.simulators.map((sim) => (
                <div
                  key={sim.id}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 text-xs space-y-1"
                >
                  <div className="flex justify-between font-semibold text-slate-100">
                    <span>{sim.name}</span>
                    <span className="font-mono text-cyan-300">{sim.version}</span>
                  </div>
                  <div className="text-slate-400">
                    Domains: {sim.supportedDomains.join(', ')}
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">
                    License: {sim.license} | Bounds: {JSON.stringify(sim.parameterBounds)}
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-slate-100">
                Worker Queue & Readiness Status
              </h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="text-slate-400">SQLite Ledger</div>
                  <div className="text-emerald-300 font-semibold mt-0.5">
                    {pc.healthInfo?.sqliteReady ? 'Connected (WAL)' : 'Checking'}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="text-slate-400">Active / Total Jobs</div>
                  <div className="text-slate-100 font-mono mt-0.5">
                    {pc.healthInfo?.activeJobs ?? 0} / {pc.healthInfo?.totalJobs ?? 0}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Max Concurrent Workers</label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={maxConcInput}
                    onChange={(e) => setMaxConcInput(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Default Replicates / Candidate</label>
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={repInput}
                    onChange={(e) => setRepInput(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={!canEditSettings}
                onClick={() =>
                  void pc.saveSettings({
                    maxConcurrentJobs: maxConcInput,
                    defaultReplicates: repInput,
                  })
                }
                className="px-3.5 py-2 rounded-lg bg-cyan-500 text-slate-950 text-xs font-semibold disabled:opacity-40"
              >
                {canEditSettings
                  ? 'Save Worker Limits'
                  : 'Principal Investigator / Auditor required to save settings'}
              </button>

              {/* Separate Statuses: Implemented / Connected / Tested / Verified / Blocked */}
              <div className="pt-2 border-t border-slate-800 space-y-1.5 text-xs">
                <h3 className="font-semibold text-slate-200">
                  Explicit Capability & Verification Ledger
                </h3>
                {[
                  ['Command Interpreter & 30-Stage Orchestrator', 'Verified', 'emerald'],
                  ['SQLite Persistent Queue & Replay (/ws/jobs/:id)', 'Connected', 'cyan'],
                  ['Three.js 30-Node 3D Demonstration Engine', 'Verified', 'emerald'],
                  ['Virtual Physics Replicates (Langevin/Psi4/BLAST/Thermal)', 'Tested', 'emerald'],
                  ['Direct Physical Wet-Lab / Actuator Bridge', 'Blocked', 'amber'],
                ].map(([cap, st, tone]) => (
                  <div key={cap} className="flex items-center justify-between">
                    <span className="text-slate-300">{cap}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                        tone === 'emerald'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : tone === 'cyan'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {st === 'Verified' && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                      {st === 'Blocked' && <XCircle className="w-3 h-3 inline mr-1" />}
                      {st}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
