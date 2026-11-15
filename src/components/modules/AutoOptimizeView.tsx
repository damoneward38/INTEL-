import { useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  GitBranch,
  Lock,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Sliders,
  Unlock,
} from 'lucide-react';
import {
  approveAutoOptimizeProtocolApi,
  createAutoOptimizeProtocolApi,
  fetchAllUploadHistoryApi,
  fetchAutoOptimizeGraphApi,
  fetchAutoOptimizeProtocolsApi,
  fetchAutoOptimizeStatusApi,
  fetchSimulationJobApi,
  proposeAutoOptimizeIncrementApi,
  recordAutoOptimizeResultApi,
  runAutoOptimizeEntityPipelineApi,
  submitSimulationApi,
  toggleAutoOptimizeLockApi,
} from '../../services/api';
import type {
  AllUploadRecord,
  AutoOptimizeIngestedDoc,
  AutoOptimizeProtocol,
  AutoOptimizeStatusSummary,
  UserRole,
} from '../../types';

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
}

export default function AutoOptimizeView({ language, userRole }: Props) {
  const isHe = language === 'he';
  const [status, setStatus] = useState<AutoOptimizeStatusSummary | null>(null);
  const [protocols, setProtocols] = useState<AutoOptimizeProtocol[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create protocol state
  const [newName, setNewName] = useState('Langevin Thermostat Damping Calibration');
  const [newObjective, setNewObjective] = useState<'maximize' | 'minimize'>('maximize');
  const [paramName, setParamName] = useState('friction_ps_inv');
  const [paramInit, setParamInit] = useState(1.0);
  const [paramMin, setParamMin] = useState(0.2);
  const [paramMax, setParamMax] = useState(5.0);
  const [paramStep, setParamStep] = useState(0.2);
  const [paramUnit, setParamUnit] = useState('ps^-1');
  const [budget, setBudget] = useState(50);
  const [maxExperiments, setMaxExperiments] = useState(15);
  const [maxCostPerExp, setMaxCostPerExp] = useState(10);
  const [safetyLimit, setSafetyLimit] = useState(0.8);
  const [safetyAck, setSafetyAck] = useState(true);

  // Measurement state
  const [efficiency, setEfficiency] = useState(0.88);
  const [safety, setSafety] = useState(0.92);
  const [cost, setCost] = useState(0.25);
  const [novelty, setNovelty] = useState(0.6);
  const [experimentCost, setExperimentCost] = useState(2);

  // Feedback / notice
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Entity Graph & NLP Pipeline state
  const [uploads, setUploads] = useState<AllUploadRecord[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState('');
  const [docFilename, setDocFilename] = useState('benchmark_abstract.txt');
  const [docText, setDocText] = useState(
    'Study authored by lab@intel-research.org (2026) under DOI 10.1021/acs.jpcb.3c06662 evaluated 300 K thermostatted ensembles at 1 atm with 94.5% structural stability. Repository: https://github.com/openmm/openmm'
  );
  const [graphQuery, setGraphQuery] = useState('');
  const [graphDocs, setGraphDocs] = useState<AutoOptimizeIngestedDoc[]>([]);
  const [graphMatches, setGraphMatches] = useState<
    Array<{
      documentId: string;
      filename: string;
      name: string;
      entityType: string;
      language: string;
    }>
  >([]);

  const canOperate =
    userRole === 'researcher' || userRole === 'principal_investigator';
  const canLock =
    userRole === 'principal_investigator' || userRole === 'auditor';

  const selectedProtocol =
    protocols.find((p) => p.id === selectedId) ?? protocols[0] ?? null;

  async function refreshAll(q = graphQuery) {
    try {
      const [st, pr, gr, hist] = await Promise.all([
        fetchAutoOptimizeStatusApi(),
        fetchAutoOptimizeProtocolsApi(),
        fetchAutoOptimizeGraphApi(q),
        fetchAllUploadHistoryApi(),
      ]);
      setStatus(st);
      setProtocols(pr.protocols);
      if (!selectedId && pr.protocols.length > 0) {
        setSelectedId(pr.protocols[0].id);
      }
      setGraphDocs(gr.docs);
      setGraphMatches(gr.matches);
      setUploads(hist.uploads);
    } catch {
      // Ignore initial errors
    }
  }

  useEffect(() => {
    void refreshAll('');
  }, []);

  async function handleCreateProtocol() {
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await createAutoOptimizeProtocolApi({
        name: newName,
        objective: newObjective,
        parameter: {
          name: paramName,
          initial: paramInit,
          minimum: paramMin,
          maximum: paramMax,
          step: paramStep,
          unit: paramUnit,
        },
        budget,
        maximumExperiments: maxExperiments,
        maximumCostPerExperiment: maxCostPerExp,
        safetyLimit,
        safetyAcknowledged: safetyAck,
      });
      setProtocols((prev) => [res.protocol, ...prev]);
      setSelectedId(res.protocol.id);
      setShowCreateForm(false);
      setActionNotice(`Created protocol "${res.protocol.name}" pending human approval.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Create failed.');
    }
  }

  async function handleApprove() {
    if (!selectedProtocol) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await approveAutoOptimizeProtocolApi(selectedProtocol.id);
      setProtocols((prev) =>
        prev.map((p) => (p.id === res.protocol.id ? res.protocol : p))
      );
      setActionNotice(
        `Protocol "${res.protocol.name}" human-approved. Bounded increments unlocked.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approval failed.');
    }
  }

  async function handlePropose() {
    if (!selectedProtocol) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await proposeAutoOptimizeIncrementApi(selectedProtocol.id);
      setProtocols((prev) =>
        prev.map((p) => (p.id === res.protocol.id ? res.protocol : p))
      );
      setActionNotice(
        `Proposed ${res.proposal.parameter}: ${res.proposal.oldValue} -> ${res.proposal.newValue} (${res.proposal.direction}) [software_only]`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Proposal blocked.');
    }
  }

  const [simBridgeRunning, setSimBridgeRunning] = useState(false);

  async function handleRecordResult(executor: 'human_verified' | 'isolated_sim_bridge') {
    if (!selectedProtocol) return;
    setActionError(null);
    setActionNotice(null);
    try {
      let measured = { efficiency, safety, cost, novelty };

      if (executor === 'isolated_sim_bridge') {
        setSimBridgeRunning(true);
        const paramVal = Object.values(selectedProtocol.currentParameters)[0] ?? 5;
        const targetTemp = Math.min(900, Math.max(200, Math.round(260 + paramVal * 12)));
        const submitted = await submitSimulationApi({
          engine: 'langevin-md',
          temperature: targetTemp,
          pressure: 1,
          steps: 400,
        });

        let job = submitted;
        for (let i = 0; i < 20; i++) {
          if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') {
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
          job = await fetchSimulationJobApi(submitted.jobId);
        }

        if (job.state === 'completed' && job.summary) {
          const rmsdNorm = Math.min(1, Math.max(0.5, 1 - job.summary.finalRmsd * 0.4));
          const safeVal = job.referenceValidation?.passed ? 0.94 : 0.72;
          measured = {
            efficiency: Number(rmsdNorm.toFixed(3)),
            safety: safeVal,
            cost: Number(Math.min(1, 400 / 2000).toFixed(3)),
            novelty: 0.55,
          };
          setEfficiency(measured.efficiency);
          setSafety(measured.safety);
          setCost(measured.cost);
        }
      }

      const res = await recordAutoOptimizeResultApi(selectedProtocol.id, {
        measurements: measured,
        experimentCost,
        executor,
      });
      setProtocols((prev) =>
        prev.map((p) => (p.id === res.protocol.id ? res.protocol : p))
      );
      setActionNotice(
        `Recorded ${res.run.experimentId} via ${executor}: reward=${res.run.reward}${res.isNewBest ? ' (New Best Protocol!)' : ''}`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Result rejected.');
    } finally {
      setSimBridgeRunning(false);
    }
  }

  async function handleToggleLock() {
    if (!selectedProtocol) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await toggleAutoOptimizeLockApi(selectedProtocol.id);
      setProtocols((prev) =>
        prev.map((p) => (p.id === res.protocol.id ? res.protocol : p))
      );
      setActionNotice(
        res.protocol.locked
          ? 'Best-protocol registry LOCKED against further overwrites.'
          : 'Protocol registry unlocked.'
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Lock error.');
    }
  }

  async function handleRunEntityPipeline() {
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await runAutoOptimizeEntityPipelineApi(
        selectedUploadId
          ? { uploadId: selectedUploadId }
          : { filename: docFilename, text: docText }
      );
      setActionNotice(
        `Extracted ${res.document.entitiesCount} entities (lang=${res.document.language}, Ollama embed=${res.document.embeddingGenerated})`
      );
      await refreshAll(graphQuery);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'NLP pipeline error.');
    }
  }

  async function handleSearchGraph(q: string) {
    setGraphQuery(q);
    try {
      const gr = await fetchAutoOptimizeGraphApi(q);
      setGraphDocs(gr.docs);
      setGraphMatches(gr.matches);
    } catch {
      // Ignore
    }
  }

  return (
    <div className="space-y-6">
      {/* Safety Banner */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <span>
              {isHe
                ? 'AutoOptimizeAI · אופטימיזציית פרוטוקולים מוגבלת בפיקוח אנושי'
                : 'AutoOptimizeAI · Constrained Human-Supervised Protocol Optimizer'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isHe
              ? 'לולאת שער בטיחות קשיח (Safety >= 0.80), הצעות צעד מוגבלות בגבולות (software-only), רישום Hash SHA-256 וגרף ישויות למסמכים.'
              : 'Hard safety threshold constraint, bounded deterministic increment proposals (software-only, no physical actuators), SHA-256 audit hashes, and searchable entity graph.'}
          </p>
        </div>
        <div className="text-xs font-mono text-amber-300">
          Physical Execution: {status ? String(status.physicalExecution) : 'false'} · Role Gate:{' '}
          {userRole}
        </div>
      </div>

      {/* Notices */}
      {actionNotice && (
        <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/25 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}
      {actionError && (
        <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Main Optimizer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Protocol Selector & Creation */}
        <section className="lg:col-span-4 space-y-4">
          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Registered Protocols
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateForm((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showCreateForm ? 'Close' : 'New Protocol'}</span>
              </button>
            </div>

            {showCreateForm && (
              <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800 space-y-2.5 text-xs">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Protocol name"
                  className="w-full px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={paramName}
                    onChange={(e) => setParamName(e.target.value)}
                    placeholder="Parameter name"
                    className="px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                  />
                  <select
                    value={newObjective}
                    onChange={(e) =>
                      setNewObjective(e.target.value as 'maximize' | 'minimize')
                    }
                    className="px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                  >
                    <option value="maximize">Maximize Reward</option>
                    <option value="minimize">Minimize Cost</option>
                  </select>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <label className="text-[10px] text-slate-400">
                    Init
                    <input
                      type="number"
                      step="0.1"
                      value={paramInit}
                      onChange={(e) => setParamInit(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-[10px] text-slate-400">
                    Min
                    <input
                      type="number"
                      step="0.1"
                      value={paramMin}
                      onChange={(e) => setParamMin(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-[10px] text-slate-400">
                    Max
                    <input
                      type="number"
                      step="0.1"
                      value={paramMax}
                      onChange={(e) => setParamMax(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-[10px] text-slate-400">
                    Step
                    <input
                      type="number"
                      step="0.05"
                      value={paramStep}
                      onChange={(e) => setParamStep(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="text-[10px] text-slate-400">
                    Budget
                    <input
                      type="number"
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-[10px] text-slate-400">
                    Max Runs
                    <input
                      type="number"
                      value={maxExperiments}
                      onChange={(e) => setMaxExperiments(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-[10px] text-slate-400">
                    Safety Min
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      value={safetyLimit}
                      onChange={(e) => setSafetyLimit(Number(e.target.value))}
                      className="w-full px-2 py-1 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={safetyAck}
                    onChange={(e) => setSafetyAck(e.target.checked)}
                  />
                  <span>Acknowledge safety bounds & human review</span>
                </label>
                <button
                  type="button"
                  disabled={!canOperate}
                  onClick={handleCreateProtocol}
                  className="w-full py-1.5 font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded"
                >
                  {canOperate ? 'Register Protocol' : 'Sign in as Researcher / PI'}
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {protocols.map((proto) => (
                <button
                  key={proto.id}
                  type="button"
                  onClick={() => setSelectedId(proto.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedProtocol?.id === proto.id
                      ? 'bg-cyan-500/10 border-cyan-500/40'
                      : 'bg-[#080C15] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {proto.name}
                    </span>
                    {proto.locked && <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" />}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-1">
                    {proto.status} · {proto.runs.length}/{proto.maximumExperiments} runs ·
                    best {proto.bestReward ?? '—'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right Column: Supervised Optimization Controls & Telemetry */}
        <section className="lg:col-span-8 space-y-4">
          {selectedProtocol && (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    {selectedProtocol.name}
                  </h3>
                  <div className="text-[11px] font-mono text-slate-400 mt-1">
                    {selectedProtocol.parameter.name} ={' '}
                    {selectedProtocol.currentParameters[selectedProtocol.parameter.name]}{' '}
                    {selectedProtocol.parameter.unit} (bounds [
                    {selectedProtocol.parameter.minimum},{' '}
                    {selectedProtocol.parameter.maximum}]) · Budget{' '}
                    {selectedProtocol.spentBudget}/{selectedProtocol.budget} · Safety Min{' '}
                    {selectedProtocol.safetyLimit}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedProtocol.status === 'draft_pending_approval' && (
                    <button
                      type="button"
                      disabled={!canOperate}
                      onClick={handleApprove}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Human Approve</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!canOperate || selectedProtocol.status !== 'approved'}
                    onClick={handlePropose}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Propose Bounded Step</span>
                  </button>

                  <button
                    type="button"
                    disabled={!canLock}
                    onClick={handleToggleLock}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
                  >
                    {selectedProtocol.locked ? (
                      <>
                        <Unlock className="w-3.5 h-3.5 text-amber-300" />
                        <span>Unlock Best</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Lock Best</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {selectedProtocol.lastProposal && (
                <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-500/30 text-xs text-cyan-100">
                  <div className="font-mono text-[11px]">
                    Latest Proposal {selectedProtocol.lastProposal.proposalId}:{' '}
                    {selectedProtocol.lastProposal.parameter}{' '}
                    {selectedProtocol.lastProposal.oldValue} →{' '}
                    {selectedProtocol.lastProposal.newValue} (
                    {selectedProtocol.lastProposal.direction})
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {selectedProtocol.lastProposal.plannerNotice}
                  </div>
                </div>
              )}

              {/* Record Experiment Measurement & Safety Gate */}
              <div className="p-4 rounded-xl bg-[#080C15] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <span>
                      Record Measurement & Evaluate Constrained Reward (Safety &ge;{' '}
                      {selectedProtocol.safetyLimit})
                    </span>
                  </h4>
                  {!canOperate && (
                    <span className="text-[11px] text-amber-300">
                      Sign in as Researcher / PI to record runs
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  <label className="text-slate-400 space-y-1">
                    <span>Efficiency (0-1)</span>
                    <input
                      type="number"
                      step="0.02"
                      min={0}
                      max={1}
                      value={efficiency}
                      onChange={(e) => setEfficiency(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400 space-y-1">
                    <span>Safety (0-1)</span>
                    <input
                      type="number"
                      step="0.02"
                      min={0}
                      max={1}
                      value={safety}
                      onChange={(e) => setSafety(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400 space-y-1">
                    <span>Normalized Cost</span>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={10}
                      value={cost}
                      onChange={(e) => setCost(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400 space-y-1">
                    <span>Novelty (0-1)</span>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      value={novelty}
                      onChange={(e) => setNovelty(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400 space-y-1">
                    <span>Budget Cost ($)</span>
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={experimentCost}
                      onChange={(e) => setExperimentCost(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-[#0D1320] border border-slate-800 rounded text-slate-100"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={!canOperate}
                    onClick={() => handleRecordResult('human_verified')}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
                  >
                    Evaluate & Record Result
                  </button>
                  <button
                    type="button"
                    disabled={!canOperate || simBridgeRunning}
                    onClick={() => handleRecordResult('isolated_sim_bridge')}
                    className="px-3.5 py-1.5 text-xs font-medium border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
                  >
                    {simBridgeRunning
                      ? 'Running Isolated MD Sim...'
                      : 'Evaluate via Isolated MD Sim Bridge'}
                  </button>
                </div>
              </div>

              {/* Learning Trajectory Bars + Audit Hash History */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                  <span>Audited Learning History ({selectedProtocol.runs.length} runs)</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    State SHA-256: {selectedProtocol.stateHash.slice(0, 16)}…
                  </span>
                </div>

                {selectedProtocol.runs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    Approve the protocol, propose a bounded parameter step, and submit validated measurements to inspect reward progression.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {selectedProtocol.runs.map((run) => (
                      <div
                        key={run.experimentId}
                        className="p-2.5 rounded-lg bg-[#080C15] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="font-mono text-slate-200">
                          {run.experimentId} ·{' '}
                          {Object.entries(run.parametersSnapshot)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(', ')}
                        </div>
                        <div className="font-mono text-[11px] text-cyan-300">
                          Reward {run.reward} · Safety {run.measurements.safety} · Eff{' '}
                          {run.measurements.efficiency} · Hash {run.stateHash.slice(0, 10)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Document NLP Entity Graph + Implementation Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Network className="w-4 h-4 text-cyan-400" />
            <span>Document Language, Entity Extraction & Searchable Graph</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <select
              value={selectedUploadId}
              onChange={(e) => setSelectedUploadId(e.target.value)}
              className="px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
            >
              <option value="">Use inline research text below</option>
              {uploads.map((u) => (
                <option key={u.uploadId} value={u.uploadId}>
                  All-Upload: {u.filename}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={docFilename}
              onChange={(e) => setDocFilename(e.target.value)}
              placeholder="Document identifier"
              disabled={Boolean(selectedUploadId)}
              className="px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100 disabled:opacity-50"
            />
          </div>

          {!selectedUploadId && (
            <textarea
              rows={3}
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRunEntityPipeline}
              className="px-3.5 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg"
            >
              Run Entity & Language Pipeline
            </button>
            <div className="flex-1 min-w-[200px] relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={graphQuery}
                onChange={(e) => void handleSearchGraph(e.target.value)}
                placeholder="Search entity graph (DOI, year, unit, keyword)..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </div>
          </div>

          {graphMatches.length > 0 && (
            <div className="max-h-44 overflow-y-auto space-y-1 text-xs">
              {graphMatches.slice(0, 20).map((m, idx) => (
                <div
                  key={`${m.documentId}-${m.name}-${idx}`}
                  className="px-2.5 py-1.5 rounded bg-[#080C15] border border-slate-800 flex justify-between gap-2"
                >
                  <span className="font-mono text-cyan-300 truncate">
                    [{m.entityType}] {m.name}
                  </span>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {m.filename} ({m.language})
                  </span>
                </div>
              ))}
            </div>
          )}
          {graphDocs.length > 0 && (
            <div className="text-[11px] font-mono text-slate-500">
              {graphDocs.length} document(s) indexed into entity graph
            </div>
          )}
        </section>

        {/* Honest Status Matrix */}
        <section className="lg:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">
            AutoOptimizeAI Implementation Matrix
          </h3>
          {status && (
            <div className="space-y-3 text-xs">
              <div className="max-h-44 overflow-y-auto space-y-1">
                {status.implementedStages.map((s) => (
                  <div key={s.stage} className="text-slate-300">
                    <span className="font-mono text-emerald-300">{s.stage}:</span>{' '}
                    {s.detail}
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="font-semibold text-amber-300 mb-1">
                  Not Claimed as Implemented
                </div>
                <ul className="text-slate-400 list-disc list-inside space-y-0.5">
                  {status.notClaimed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
