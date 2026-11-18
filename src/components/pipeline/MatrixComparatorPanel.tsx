import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  GitCompare,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { triggerFileDownload } from '../../utils/exportReport';
import {
  compareMatricesApi,
  fetchMatrixPresetsApi,
  type MatrixComparisonPreset,
  type MatrixComparisonResult,
  type MatrixEvaluatedCandidate,
} from '../../services/pipelineApi';

const FALLBACK_PRESETS: MatrixComparisonPreset[] = [
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
];

interface MatrixDraft {
  name: string;
  rowsText: string;
}

interface Props {
  onLaunchWinnerInPipeline?: (commandText: string, matrixJson: string) => void;
}

export default function MatrixComparatorPanel({ onLaunchWinnerInPipeline }: Props) {
  const [presets, setPresets] = useState<MatrixComparisonPreset[]>(FALLBACK_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('formulation-three-matrix');
  const [simulatorId, setSimulatorId] = useState<string>('langevin-md-adapter');
  const [domain, setDomain] = useState<string>('Formulation & Stability');
  const [replicates, setReplicates] = useState<number>(4);
  const [verifyPython, setVerifyPython] = useState<boolean>(false);

  const [drafts, setDrafts] = useState<MatrixDraft[]>(
    FALLBACK_PRESETS[0].matrices.map((m) => ({
      name: m.name,
      rowsText: JSON.stringify(m.rows, null, 2),
    }))
  );
  const [activeDraftIdx, setActiveDraftIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatrixComparisonResult | null>(null);
  const [inspectedCandId, setInspectedCandId] = useState<string | null>(null);

  useEffect(() => {
    void fetchMatrixPresetsApi()
      .then((res) => {
        if (res.presets && res.presets.length > 0) {
          setPresets(res.presets);
        }
      })
      .catch(() => {
        // Fallback preset stays active cleanly
      });
  }, []);

  function applyPreset(preset: MatrixComparisonPreset) {
    setSelectedPresetId(preset.id);
    setSimulatorId(preset.simulatorId);
    setDomain(preset.domain);
    setVerifyPython(preset.simulatorId === 'robotics-kinematics-adapter');
    setDrafts(
      preset.matrices.map((m) => ({
        name: m.name,
        rowsText: JSON.stringify(m.rows, null, 2),
      }))
    );
    setActiveDraftIdx(0);
    setError(null);
  }

  async function handleRunComparison() {
    setError(null);
    const parsedMatrices: Array<{
      name: string;
      rows: Array<Record<string, number | string>>;
    }> = [];

    for (let i = 0; i < drafts.length; i += 1) {
      const d = drafts[i];
      let rows: unknown;
      try {
        rows = JSON.parse(d.rowsText);
      } catch {
        setError(`"${d.name || `Matrix ${i + 1}`}" contains invalid JSON.`);
        return;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        setError(`"${d.name || `Matrix ${i + 1}`}" must be a non-empty JSON array of rows.`);
        return;
      }
      parsedMatrices.push({
        name: d.name.trim() || `Matrix ${i + 1}`,
        rows: rows as Array<Record<string, number | string>>,
      });
    }

    setLoading(true);
    try {
      const res = await compareMatricesApi({
        matrices: parsedMatrices,
        domain,
        simulatorId,
        replicates,
        verifyWithRoboticsPython: verifyPython,
      });
      setResult(res.comparison);
      setInspectedCandId(
        res.comparison.winnerCandidateId ??
          res.comparison.evaluatedCandidates[0]?.candidateId ??
          null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matrix comparison failed.');
    } finally {
      setLoading(false);
    }
  }

  const inspectedCand: MatrixEvaluatedCandidate | null =
    result?.evaluatedCandidates.find((c) => c.candidateId === inspectedCandId) ??
    result?.evaluatedCandidates.find((c) => c.candidateId === result.winnerCandidateId) ??
    result?.evaluatedCandidates[0] ??
    null;

  const winnerCand =
    result?.evaluatedCandidates.find((c) => c.candidateId === result.winnerCandidateId) ?? null;

  return (
    <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-cyan-400" />
            <span>Multi-Matrix Diff &amp; Parameter Sweep Bench</span>
          </h2>
          <p className="text-xs text-slate-400">
            Structural &amp; numeric delta comparison across 2–5 matrices · Pareto frontier ranking · Automated constraint fix rationale
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-colors ${
                selectedPresetId === p.id
                  ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {p.title.split(' ')[0]} {p.title.split(' ')[1]}
            </button>
          ))}
        </div>
      </div>

      {/* Calibration Control Strip */}
      <div className="flex flex-wrap items-center gap-4 px-3 py-2.5 rounded-lg border border-slate-800 bg-slate-950/70 text-xs">
        <label className="flex items-center gap-2 text-slate-300">
          <span className="text-slate-400">Simulator</span>
          <select
            value={simulatorId}
            aria-label="Matrix Comparator Simulator"
            onChange={(e) => {
              const id = e.target.value;
              setSimulatorId(id);
              setVerifyPython(id === 'robotics-kinematics-adapter');
              setDomain(
                id === 'robotics-kinematics-adapter'
                  ? 'Robotics & Autonomous Kinematics'
                  : id === 'thermal-process-adapter'
                    ? 'Chemical Process Engineering'
                    : id === 'psi4-scf-adapter'
                      ? 'Quantum Chemistry'
                      : id === 'blast-bio-adapter'
                        ? 'Bioinformatics & Genomics'
                        : 'Formulation & Stability'
              );
            }}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
          >
            <option value="langevin-md-adapter">langevin-md-adapter</option>
            <option value="robotics-kinematics-adapter">robotics-kinematics-adapter</option>
            <option value="thermal-process-adapter">thermal-process-adapter</option>
            <option value="psi4-scf-adapter">psi4-scf-adapter</option>
            <option value="blast-bio-adapter">blast-bio-adapter</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-slate-300">
          <span className="text-slate-400">Replicates</span>
          <input
            type="number"
            min={2}
            max={12}
            value={replicates}
            onChange={(e) => setReplicates(Math.max(2, Math.min(12, Number(e.target.value) || 4)))}
            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono tabular-nums text-xs text-slate-100"
          />
        </label>

        {simulatorId === 'robotics-kinematics-adapter' && (
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={verifyPython}
              onChange={(e) => setVerifyPython(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-cyan-500"
            />
            <span>Verify Winner via robotics_engine.py</span>
          </label>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {drafts.length < 5 && (
            <button
              type="button"
              onClick={() => {
                const nextIdx = drafts.length;
                setDrafts((prev) => [
                  ...prev,
                  {
                    name: `Matrix ${String.fromCharCode(65 + nextIdx)}`,
                    rowsText: prev[0]?.rowsText ?? '[]',
                  },
                ]);
                setActiveDraftIdx(nextIdx);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-slate-500 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Matrix</span>
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRunComparison()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{loading ? 'Comparing Matrices...' : 'Run Matrix Diff & Sweep'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Asymmetric Split Console: Matrix Editors Left + Analytical Stage Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {drafts.map((d, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveDraftIdx(idx)}
                className={`px-2.5 py-1 rounded-md border text-xs whitespace-nowrap transition-colors ${
                  activeDraftIdx === idx
                    ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {d.name || `Matrix ${idx + 1}`}
              </button>
            ))}
          </div>

          {drafts[activeDraftIdx] && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={drafts[activeDraftIdx].name}
                  aria-label="Active Matrix Name"
                  onChange={(e) => {
                    const val = e.target.value;
                    setDrafts((prev) =>
                      prev.map((m, i) => (i === activeDraftIdx ? { ...m, name: val } : m))
                    );
                  }}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                />
                {drafts.length > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = drafts.filter((_, i) => i !== activeDraftIdx);
                      setDrafts(next);
                      setActiveDraftIdx(Math.max(0, activeDraftIdx - 1));
                    }}
                    className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300"
                    title="Remove Matrix"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <textarea
                rows={11}
                value={drafts[activeDraftIdx].rowsText}
                aria-label="Active Matrix JSON Rows"
                onChange={(e) => {
                  const val = e.target.value;
                  setDrafts((prev) =>
                    prev.map((m, i) => (i === activeDraftIdx ? { ...m, rowsText: val } : m))
                  );
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200"
              />
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-4">
          {result ? (
            <>
              {/* Precision Telemetry KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums">
                <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] uppercase text-slate-400">Candidates</div>
                  <div className="text-lg font-semibold text-slate-100">
                    {result.evaluatedCandidates.length}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {result.matrixNames.length} matrices · {result.replicatesPerCandidate} reps
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] uppercase text-slate-400">Pass / Reject</div>
                  <div className="text-lg font-semibold text-emerald-300">
                    {result.evaluatedCandidates.filter((c) => c.status !== 'rejected').length} /{' '}
                    <span className="text-rose-400">
                      {result.evaluatedCandidates.filter((c) => c.status === 'rejected').length}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {result.paretoCandidateIds.length} Pareto optimal
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] uppercase text-slate-400">Leading Score</div>
                  <div className="text-lg font-semibold text-cyan-300">
                    {winnerCand ? winnerCand.metrics.compositeScore : 'None'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {winnerCand
                      ? `CI [${winnerCand.confidenceInterval95[0]}, ${winnerCand.confidenceInterval95[1]}]`
                      : 'No compliant candidate'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/70">
                  <div className="text-[10px] uppercase text-slate-400">Audit Digest</div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1 mt-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{result.sha256.slice(0, 12)}...</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{result.simulatorId}</div>
                </div>
              </div>

              {/* Pareto Tradeoff Scatter Plot: Safety Score (X) vs Composite Score (Y) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-7">
                  <svg
                    viewBox="0 0 320 190"
                    className="w-full h-48 rounded-lg border border-slate-800 bg-slate-950"
                  >
                    {/* Safety Floor line at x=0.72 */}
                    <line
                      x1={32 + 0.72 * 265}
                      y1={16}
                      x2={32 + 0.72 * 265}
                      y2={162}
                      stroke="#f59e0b"
                      strokeOpacity={0.55}
                      strokeDasharray="3 3"
                    />
                    <text
                      x={32 + 0.72 * 265 - 26}
                      y={24}
                      fill="#f59e0b"
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      Floor 0.72
                    </text>

                    {/* Axes */}
                    <line x1={32} y1={162} x2={302} y2={162} stroke="#334155" />
                    <line x1={32} y1={16} x2={32} y2={162} stroke="#334155" />

                    {result.evaluatedCandidates.map((c) => {
                      const cx = 32 + Math.max(0, Math.min(1, c.metrics.safetyScore)) * 265;
                      const cy = 162 - Math.max(0, Math.min(1, c.metrics.compositeScore)) * 138;
                      const isSel = c.candidateId === inspectedCand?.candidateId;
                      const fill =
                        c.status === 'selected'
                          ? '#f8fafc'
                          : c.status === 'rejected'
                            ? '#ef4444'
                            : c.paretoOptimal
                              ? '#22d3ee'
                              : '#10b981';
                      return (
                        <g
                          key={c.candidateId}
                          onClick={() => setInspectedCandId(c.candidateId)}
                          className="cursor-pointer"
                        >
                          {isSel && (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={8}
                              fill="none"
                              stroke="#38bdf8"
                              strokeWidth={1.5}
                            />
                          )}
                          <circle cx={cx} cy={cy} r={c.status === 'selected' ? 5.5 : 4.2} fill={fill} />
                        </g>
                      );
                    })}

                    <text x={112} y={180} fill="#94a3b8" fontSize="9" fontFamily="monospace">
                      Safety Score (0.0 → 1.0)
                    </text>
                    <text
                      x={12}
                      y={128}
                      fill="#94a3b8"
                      fontSize="9"
                      fontFamily="monospace"
                      transform="rotate(-90 12 128)"
                    >
                      Composite Score
                    </text>
                  </svg>
                </div>

                {/* Selected Candidate Inspector */}
                <div className="md:col-span-5 p-3 rounded-lg border border-slate-800 bg-slate-950/70 text-xs space-y-1.5">
                  {inspectedCand && (
                    <>
                      <div className="font-semibold text-slate-100">{inspectedCand.label}</div>
                      <div className="font-mono text-[11px] text-cyan-300">
                        Status: {inspectedCand.status.toUpperCase()}
                        {inspectedCand.paretoOptimal ? ' · PARETO OPTIMAL' : ''}
                      </div>
                      <div className="font-mono tabular-nums text-[11px] text-slate-300">
                        Composite {inspectedCand.metrics.compositeScore} · Safety{' '}
                        {inspectedCand.metrics.safetyScore} · Drift{' '}
                        {inspectedCand.metrics.energyDrift}
                      </div>
                      <div className="text-[11px] text-slate-300">{inspectedCand.rationale}</div>
                      {inspectedCand.recommendedFix && (
                        <div className="text-[11px] text-amber-300">
                          Recommended Fix: {inspectedCand.recommendedFix}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="h-64 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-center text-xs text-slate-400 p-6 text-center">
              Configure 2 to 5 parameter matrices on the left and execute `Run Matrix Diff &amp;
              Sweep` to inspect structural parameter deltas, Pareto tradeoffs, and failure fixes.
            </div>
          )}
        </div>
      </div>

      {/* Structural & Numeric Cross-Matrix Parameter Diff Table */}
      {result && (
        <div className="space-y-4 pt-3 border-t border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Cross-Matrix Parameter Deltas vs {result.matrixNames[0]}
            </h3>
            <div className="flex flex-wrap gap-2">
              {winnerCand && onLaunchWinnerInPipeline && (
                <button
                  type="button"
                  onClick={() =>
                    onLaunchWinnerInPipeline(
                      `Validate matrix comparison winner "${winnerCand.label}" in ${result.domain} simulation.`,
                      JSON.stringify([winnerCand.parameters], null, 2)
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold"
                >
                  Launch Winner in 3D Pipeline
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `${result.comparisonId}.json`,
                    JSON.stringify(result, null, 2),
                    'application/json'
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>Download Diff JSON</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-sans">Parameter</th>
                  <th className="py-2 pr-3 font-sans">Bounds</th>
                  <th className="py-2 pr-3">Spread</th>
                  {result.matrixNames.map((mName) => (
                    <th key={mName} className="py-2 pr-3 font-sans">
                      {mName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.parameterDiffs.map((diff) => (
                  <tr key={diff.parameter} className="border-b border-slate-800/60 text-slate-200">
                    <td className="py-2 pr-3 font-medium">
                      {diff.parameter} <span className="text-slate-500">({diff.unit})</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-400">
                      {diff.bounds ? `[${diff.bounds[0]}, ${diff.bounds[1]}]` : 'Open'}
                    </td>
                    <td className="py-2 pr-3 text-amber-300">{diff.spread}</td>
                    {result.matrixNames.map((mName, idx) => {
                      const val = diff.matrixMeans[mName];
                      const delta = diff.deltaVsFirstMatrix[mName];
                      return (
                        <td key={mName} className="py-2 pr-3">
                          {val === null ? (
                            <span className="text-rose-400">Missing</span>
                          ) : (
                            <span>
                              {val}{' '}
                              {idx > 0 && delta !== null && (
                                <span
                                  className={
                                    delta > 0
                                      ? 'text-cyan-300'
                                      : delta < 0
                                        ? 'text-purple-300'
                                        : 'text-slate-500'
                                  }
                                >
                                  ({delta >= 0 ? `+${delta}` : delta})
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.roboticsVerificationReport && (
            <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/15 text-xs font-mono text-emerald-200">
              Python robotics_engine.py verification passed for winner · Job{' '}
              {result.roboticsVerificationReport.job_id.slice(0, 8)} · Score{' '}
              {String(result.roboticsVerificationReport.evaluation.score)} · SHA-256{' '}
              {result.roboticsVerificationReport.sha256.slice(0, 14)}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
