import { useEffect, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  ListChecks,
  ShieldAlert,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import {
  createAllUploadPlanApi,
  fetchAllUploadCapabilitiesApi,
  fetchAllUploadHistoryApi,
  indexAllUploadToCorpusApi,
  uploadScientificFileApi,
} from '../../services/api';
import type {
  AllUploadCapabilities,
  AllUploadPlanResponse,
  AllUploadRecord,
  SimulationEngine,
  UserRole,
} from '../../types';

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
  onCorpusUpdated: () => void;
  onLaunchSimulation: (engine: SimulationEngine) => void;
}

export default function AllUploadView({
  language,
  userRole,
  onCorpusUpdated,
  onLaunchSimulation,
}: Props) {
  const isHe = language === 'he';
  const [capabilities, setCapabilities] = useState<AllUploadCapabilities | null>(null);
  const [history, setHistory] = useState<AllUploadRecord[]>([]);
  const [activeRecord, setActiveRecord] = useState<AllUploadRecord | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Planner state
  const [question, setQuestion] = useState(
    'Design a controlled benchmark protocol validating reproducible findings from this uploaded scientific artifact.'
  );
  const [domain, setDomain] = useState('Molecular Biology & Data Science');
  const [useGemini, setUseGemini] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [planResult, setPlanResult] = useState<AllUploadPlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  // Index-to-Corpus state
  const [corpusTitle, setCorpusTitle] = useState('');
  const [corpusAuthors, setCorpusAuthors] = useState('Uploaded Research Team');
  const [corpusDomain, setCorpusDomain] = useState('Biomedical Research');
  const [corpusLicense, setCorpusLicense] = useState('CC-BY-4.0');
  const [corpusUrl, setCorpusUrl] = useState('https://intel-lab.local/uploads/artifact');
  const [indexing, setIndexing] = useState(false);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  const canIndexCorpus =
    userRole === 'researcher' || userRole === 'principal_investigator';

  async function refreshMetadata() {
    try {
      const [caps, hist] = await Promise.all([
        fetchAllUploadCapabilitiesApi(),
        fetchAllUploadHistoryApi(),
      ]);
      setCapabilities(caps);
      setHistory(hist.uploads);
      if (!activeRecord && hist.uploads.length > 0) {
        setActiveRecord(hist.uploads[0]);
      }
    } catch {
      // Ignore transient initial load failures
    }
  }

  useEffect(() => {
    refreshMetadata();
  }, []);

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setIndexNotice(null);
    setIndexError(null);

    try {
      const result = await uploadScientificFileApi(file);
      setActiveRecord(result);
      setHistory((prev) => [result, ...prev.filter((p) => p.uploadId !== result.uploadId)]);
      setCorpusTitle(result.filename.replace(/\.[^.]+$/, ''));
      if (result.analysis?.domainHint) {
        setDomain(result.analysis.domainHint);
        setCorpusDomain(result.analysis.domainHint);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    void handleFileUpload(file);
  }

  async function handleGeneratePlan() {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plan = await createAllUploadPlanApi({
        researchQuestion: question,
        domain,
        context: activeRecord?.extractedPreview ?? '',
        uploadId: activeRecord?.uploadId,
        useGemini,
      });
      setPlanResult(plan);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Planning failed.');
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleIndexCorpus() {
    if (!activeRecord || !canIndexCorpus) return;
    setIndexing(true);
    setIndexNotice(null);
    setIndexError(null);
    try {
      const res = await indexAllUploadToCorpusApi(activeRecord.uploadId, {
        title: corpusTitle || activeRecord.filename,
        authors: corpusAuthors,
        domain: corpusDomain,
        license: corpusLicense,
        sourceUrl: corpusUrl,
      });
      setIndexNotice(
        `Indexed ${res.chunks.length} searchable vector chunks (Provenance ${res.provenanceId}).`
      );
      onCorpusUpdated();
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : 'Corpus indexing failed.');
    } finally {
      setIndexing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            {isHe
              ? 'אינטל-All-Upload · קליטה, פירוק ואופטימיזציה של קבצים מדעיים'
              : 'INTEL-All-Upload · Universal Scientific File Optimizer'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isHe
              ? 'העלאת PDF, DOCX, CSV, TSV, XLSX, JSON, Jupyter, ZIP, PDB, FASTA וקוד מחקרי עם בדיקת שלמות מתודולוגית, פרופיל נתונים וחתימת SHA-256.'
              : 'Ingest PDF, DOCX, CSV/TSV, Excel workbooks, Jupyter notebooks, guarded ZIP archives, bioinformatics structures (.pdb/.cif/.fasta), and code with SHA-256 integrity hashing.'}
          </p>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          Max 100 MB · Archive Guardrail 2,000 files / 500 MB · Human Review Required
        </div>
      </div>

      {/* Main grid: Upload + Active Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-5 space-y-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`block cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragging
                ? 'border-cyan-400 bg-cyan-500/10'
                : 'border-slate-700 bg-[#0B101B] hover:border-cyan-500/60'
            }`}
          >
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                void handleFileUpload(file);
                e.currentTarget.value = '';
              }}
            />
            <UploadCloud className="w-8 h-8 text-cyan-400 mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-100">
              {uploading
                ? isHe
                  ? 'מעבד קובץ ומחשב חתימת SHA-256...'
                  : 'Extracting text & verifying SHA-256...'
                : isHe
                  ? 'גרור קובץ מדעי לכאן או לחץ לבחירה'
                  : 'Drop any supported research file here, or click to upload'}
            </div>
            <div className="text-xs text-slate-400 mt-1.5">
              .pdf · .docx · .csv · .tsv · .xlsx · .ipynb · .json · .zip · .pdb · .fasta · .py · .r · .md
            </div>
          </label>

          {uploadError && (
            <div className="p-3.5 rounded-xl border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Upload History */}
          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                {isHe ? 'העלאות אחרונות במעבדה' : 'Recent Analyzed Artifacts'}
              </h3>
              <span className="text-xs text-slate-500">{history.length} total</span>
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                {isHe
                  ? 'טרם הועלו קבצים בהפעלה זו.'
                  : 'No artifacts uploaded in this session yet.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.map((item) => (
                  <button
                    key={item.uploadId}
                    type="button"
                    onClick={() => {
                      setActiveRecord(item);
                      setCorpusTitle(item.filename.replace(/\.[^.]+$/, ''));
                    }}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                      activeRecord?.uploadId === item.uploadId
                        ? 'bg-cyan-500/10 border-cyan-500/40'
                        : 'bg-[#080C15] border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-100 truncate">
                        {item.filename}
                      </span>
                      <span className="text-[11px] font-mono text-cyan-300 shrink-0">
                        {item.analysis
                          ? `${item.analysis.heuristicCompletenessScore}%`
                          : item.extension}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
                      {item.sizeBytes.toLocaleString()} B · sha256:{item.sha256.slice(0, 12)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Active Inspection Result */}
        <section className="lg:col-span-7 space-y-4">
          {!activeRecord ? (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
              <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              {isHe
                ? 'העלה מסמך, טבלת נתונים, קובץ מבנה מולקולרי או ארכיון ZIP כדי להפיק ניתוח שלמות ופרופיל.'
                : 'Upload a scientific paper, tabular dataset, sequence/structure file, or ZIP archive to inspect SHA-256 integrity, CSV quality, and completeness metrics.'}
            </div>
          ) : (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-cyan-400" />
                    <span>{activeRecord.filename}</span>
                  </h3>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    {activeRecord.extension} · {activeRecord.sizeBytes.toLocaleString()} bytes · SHA-256{' '}
                    {activeRecord.sha256.slice(0, 16)}… · {activeRecord.analysisStatus}
                  </div>
                </div>

                {activeRecord.analysis?.suggestedSimEngine && (
                  <button
                    type="button"
                    onClick={() =>
                      onLaunchSimulation(activeRecord.analysis!.suggestedSimEngine!)
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 rounded-lg hover:bg-emerald-500/25"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>
                      Run {activeRecord.analysis.suggestedSimEngine} Simulation
                    </span>
                  </button>
                )}
              </div>

              {/* Heuristic Completeness + Explicit Warning */}
              {activeRecord.analysis && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-[#080C15] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Completeness Indicator</div>
                      <div className="text-lg font-semibold text-cyan-300 mt-0.5">
                        {activeRecord.analysis.heuristicCompletenessScore}%
                      </div>
                    </div>
                    <div className="bg-[#080C15] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Words Extracted</div>
                      <div className="text-lg font-semibold text-slate-100 mt-0.5">
                        {activeRecord.analysis.wordCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-[#080C15] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Review Flags</div>
                      <div className="text-lg font-semibold text-amber-300 mt-0.5">
                        {activeRecord.analysis.flags.length}
                      </div>
                    </div>
                    <div className="bg-[#080C15] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Domain Hint</div>
                      <div className="text-xs font-medium text-slate-200 mt-1 truncate">
                        {activeRecord.analysis.domainHint}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <span>{activeRecord.analysis.scoreWarning}</span>
                  </div>

                  {/* CSV / Tabular Data Profile */}
                  {activeRecord.analysis.dataProfile && (
                    <div className="bg-[#080C15] border border-slate-800 rounded-lg p-3.5 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
                        <span>Tabular Data Profile</span>
                      </div>
                      <div className="text-xs text-slate-300 font-mono">
                        Rows: {activeRecord.analysis.dataProfile.rows} · Columns:{' '}
                        {activeRecord.analysis.dataProfile.columns} · Missing Cells:{' '}
                        {activeRecord.analysis.dataProfile.missingCells} (
                        {(activeRecord.analysis.dataProfile.missingFraction * 100).toFixed(1)}
                        %) · Duplicate Rows: {activeRecord.analysis.dataProfile.duplicateRows}
                      </div>
                      {activeRecord.analysis.dataProfile.columnNames.length > 0 && (
                        <div className="text-[11px] text-slate-400">
                          Columns:{' '}
                          {activeRecord.analysis.dataProfile.columnNames.join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Detected Sections Checklist */}
                  <div>
                    <div className="text-xs font-semibold text-slate-300 mb-2">
                      Detected Methodology Indicators
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {Object.entries(activeRecord.analysis.detectedSections).map(
                        ([key, detected]) => (
                          <div
                            key={key}
                            className={`px-2.5 py-2 rounded-lg border text-xs flex items-center justify-between ${
                              detected
                                ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                                : 'bg-slate-900/60 border-slate-800 text-slate-400'
                            }`}
                          >
                            <span className="truncate capitalize">
                              {key.replace('_', ' ')}
                            </span>
                            <span className="font-mono text-[11px]">
                              {detected ? 'YES' : 'NO'}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  {/* Recommendations & Flags */}
                  {activeRecord.analysis.recommendations.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-slate-300">
                        Prioritized Study Improvement Suggestions
                      </div>
                      {activeRecord.analysis.recommendations.map((rec, idx) => (
                        <div
                          key={`${rec.category}-${idx}`}
                          className="p-2.5 rounded-lg bg-[#080C15] border border-slate-800 text-xs text-slate-300"
                        >
                          <span className="font-mono uppercase text-[11px] text-amber-300">
                            [{rec.priority} · {rec.category}]
                          </span>{' '}
                          {rec.action}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ZIP Archive Inspection */}
              {activeRecord.archive && (
                <div className="bg-[#080C15] border border-slate-800 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Archive className="w-4 h-4 text-cyan-400" />
                    <span>Guarded Archive Manifest</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    Files: {activeRecord.archive.archiveFileCount} · Expanded:{' '}
                    {activeRecord.archive.expandedBytes.toLocaleString()} bytes
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] font-mono text-slate-300">
                    {activeRecord.archive.files.map((f) => (
                      <div key={f.path} className="flex justify-between">
                        <span className="truncate">{f.path}</span>
                        <span className="text-slate-500 shrink-0 ml-2">
                          {f.bytes.toLocaleString()} B
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted Text Preview */}
              {activeRecord.extractedPreview && (
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-1.5">
                    Extracted Text Preview ({activeRecord.extractedTextBytes.toLocaleString()} bytes)
                  </div>
                  <pre className="p-3 rounded-lg bg-[#080C15] border border-slate-800 text-[11px] text-slate-300 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
                    {activeRecord.extractedPreview}
                  </pre>
                </div>
              )}

              {/* Index to Corpus Hand-off */}
              <div className="border-t border-slate-800 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Index Uploaded Artifact into INTEL RAG Corpus</span>
                  </h4>
                  {!canIndexCorpus && (
                    <span className="text-[11px] text-amber-300">
                      Sign in as Researcher or PI to index
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    value={corpusTitle}
                    onChange={(e) => setCorpusTitle(e.target.value)}
                    placeholder="Document title"
                    className="px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                  />
                  <input
                    type="text"
                    value={corpusLicense}
                    onChange={(e) => setCorpusLicense(e.target.value)}
                    placeholder="SPDX License (e.g. CC-BY-4.0)"
                    className="px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                  />
                  <input
                    type="text"
                    value={corpusAuthors}
                    onChange={(e) => setCorpusAuthors(e.target.value)}
                    placeholder="Authors / Organization"
                    className="px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleIndexCorpus}
                    disabled={!canIndexCorpus || indexing}
                    className="px-3.5 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg transition-colors"
                  >
                    {indexing ? 'Indexing…' : 'Verify SPDX & Index into RAG'}
                  </button>
                  {indexNotice && (
                    <span className="text-xs text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {indexNotice}
                    </span>
                  )}
                  {indexError && (
                    <span className="text-xs text-rose-300">{indexError}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Research Planner & Honest Capabilities Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-cyan-400" />
              <span>
                {isHe
                  ? 'מתכנן פרוטוקול מחקר דטרמיניסטי + סינתזת Gemini'
                  : '6-Stage Scientific Improvement Planner'}
              </span>
            </h3>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={useGemini}
                onChange={(e) => setUseGemini(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500"
              />
              <span>Enhance with Gemini</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Research question..."
              className="sm:col-span-2 px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
            />
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain"
              className="px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
            />
          </div>

          <button
            type="button"
            onClick={handleGeneratePlan}
            disabled={planLoading || question.trim().length < 10}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 text-slate-950 rounded-lg"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {planLoading
                ? 'Generating Plan...'
                : 'Generate Structured Research Plan'}
            </span>
          </button>

          {planError && <p className="text-xs text-rose-300">{planError}</p>}

          {planResult && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="text-[11px] font-mono text-slate-400">
                Status: {planResult.status} · Engine: {planResult.modelUsed} · Execution Enabled:{' '}
                {String(planResult.executionEnabled)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {planResult.steps.map((step) => (
                  <div
                    key={step.stage}
                    className="p-3 rounded-lg bg-[#080C15] border border-slate-800"
                  >
                    <div className="text-[11px] font-mono uppercase text-cyan-400">
                      {step.stage}
                    </div>
                    <div className="text-xs text-slate-200 mt-1">{step.action}</div>
                  </div>
                ))}
              </div>
              {planResult.groundedSynthesis && (
                <div className="p-3.5 rounded-lg bg-cyan-950/20 border border-cyan-500/30 text-xs text-slate-200 whitespace-pre-wrap">
                  {planResult.groundedSynthesis}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Honest Capabilities & Guardrails Matrix */}
        <section className="lg:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100">
            Platform Ingestion Capabilities & Scope Boundaries
          </h3>
          {capabilities ? (
            <div className="space-y-3 text-xs">
              <div>
                <div className="text-emerald-300 font-semibold mb-1">
                  Active Extractors & Analyzers
                </div>
                <ul className="space-y-1 text-slate-300 list-disc list-inside">
                  {capabilities.ingest.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-amber-300 font-semibold mb-1">
                  Not Integrated (External / Planned)
                </div>
                <ul className="space-y-1 text-slate-400 list-disc list-inside">
                  {capabilities.notYetIntegrated.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800 text-[11px] text-slate-400 font-mono">
                Medical Decisions: {capabilities.safety.medicalDecisions} · Auto Execution:{' '}
                {capabilities.safety.automatedExperimentExecution}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Loading capability registry...</p>
          )}
        </section>
      </div>
    </div>
  );
}
