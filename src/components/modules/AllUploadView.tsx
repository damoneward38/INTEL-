import { useEffect, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  Bot,
  CheckCircle2,
  Database,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  ListChecks,
  Mic,
  MicOff,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  UploadCloud,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useVoice } from '../../hooks/useVoice';
import {
  createAllUploadPlanApi,
  fetchAllUploadCapabilitiesApi,
  fetchAllUploadHistoryApi,
  indexAllUploadToCorpusApi,
  sendResearchChatApi,
  uploadScientificFileApi,
} from '../../services/api';
import {
  isSpeechTalkSupported,
  speakAloud,
  stopSpeechTalk,
} from '../../utils/speechTalk';
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

  // Left-side AI Reader, Suggestions & Voice Talk state
  const [speaking, setSpeaking] = useState(false);
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  // Right-side Results: Planner & Index-to-Corpus state
  const [question, setQuestion] = useState(
    'Design a controlled benchmark protocol validating reproducible findings from this uploaded scientific artifact.'
  );
  const [domain, setDomain] = useState('Molecular Biology & Data Science');
  const [useGemini, setUseGemini] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [planResult, setPlanResult] = useState<AllUploadPlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

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
  const ttsSupported = isSpeechTalkSupported();

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
    void refreshMetadata();
    return () => {
      stopSpeechTalk();
    };
  }, []);

  function buildLocalSummaryText(record: AllUploadRecord): string {
    const score = record.analysis?.heuristicCompletenessScore ?? 0;
    const domainHint = record.analysis?.domainHint ?? 'General Science';
    const topRecs = (record.analysis?.recommendations ?? [])
      .slice(0, 2)
      .map((r) => r.action)
      .join(' ');
    const snippet = (record.extractedPreview ?? '').slice(0, 420);
    return `File ${record.filename}. Completeness indicator ${score} percent in ${domainHint}. ${topRecs} Excerpt: ${snippet}`;
  }

  function handleSpeakUploadedContent(customText?: string) {
    if (!ttsSupported) return;
    if (speaking && !customText) {
      stopSpeechTalk();
      setSpeaking(false);
      return;
    }
    const textToSpeak =
      customText ??
      (aiComment || (activeRecord ? buildLocalSummaryText(activeRecord) : ''));
    if (!textToSpeak.trim()) return;
    setSpeaking(true);
    speakAloud(textToSpeak, {
      language,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  async function askSideAiAboutFile(messageText: string, speakResponse = true) {
    if (!activeRecord || !messageText.trim() || aiLoading) return;
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await sendResearchChatApi({
        message: messageText.trim(),
        persona: 'protocol',
        language,
        history: aiComment ? [{ role: 'assistant', text: aiComment }] : [],
        artifactContext: {
          filename: activeRecord.filename,
          summary: activeRecord.analysis
            ? `Completeness ${activeRecord.analysis.heuristicCompletenessScore}%, domain ${activeRecord.analysis.domainHint}, flags: ${activeRecord.analysis.flags.join('; ')}`
            : undefined,
          excerpt: activeRecord.extractedPreview,
        },
      });
      setAiComment(res.reply);
      setAiSuggestions(res.suggestions);
      if (speakResponse && ttsSupported) {
        handleSpeakUploadedContent(res.reply);
      }
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'AI file companion unavailable.'
      );
    } finally {
      setAiLoading(false);
    }
  }

  const leftVoice = useVoice(language, (transcript) => {
    setAiPrompt(transcript);
    if (activeRecord) {
      void askSideAiAboutFile(transcript, true);
    }
  });

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setIndexNotice(null);
    setIndexError(null);
    setAiComment(null);
    setAiSuggestions([]);

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
    <div className="space-y-4 min-h-[calc(100vh-11rem)] flex flex-col">
      {/* Compact Split-Screen Studio Header */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl px-5 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {isHe
              ? 'אולפן קליטת קבצים מפוצל · קלט, קריאה והצעות AI משמאל | תוצאות וניתוח מימין'
              : 'All-Upload Split Studio · Input, AI Reader & Suggestions Left | Analysis Results Right'}
          </h2>
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
          Max 100 MB · Archive Guardrail 2,000 files / 500 MB · Human Review Required
        </div>
      </div>

      {/* True 50/50 Split-Side Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-start">
        {/* LEFT SIDE (6 cols): File Input + Pop-Up Content Reader + AI Suggestions + Voice Talk */}
        <section className="lg:col-span-6 space-y-4">
          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 space-y-4">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`block cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
                dragging
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-slate-700 bg-[#07090E] hover:border-cyan-500/60'
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
              <UploadCloud className="w-7 h-7 text-cyan-400 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-100">
                {uploading
                  ? isHe
                    ? 'מעבד קובץ ומחשב חתימת SHA-256...'
                    : 'Extracting file & verifying SHA-256...'
                  : isHe
                    ? 'גרור קובץ לכאן או לחץ להעלאה'
                    : 'Drop any research file here, or click to upload'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 font-mono">
                .pdf · .docx · .csv · .tsv · .xlsx · .ipynb · .json · .zip · .pdb · .fasta · .py · .r · .md
              </div>
            </label>

            {uploadError && (
              <div className="p-3 rounded-lg border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Recent Uploaded Selector */}
            {history.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>{isHe ? 'קבצים שהועלו' : 'Uploaded Inputs'}</span>
                  <span>{history.length} total</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                  {history.map((item) => (
                    <button
                      key={item.uploadId}
                      type="button"
                      data-testid="safe-ui-test"
                      onClick={() => {
                        setActiveRecord(item);
                        setCorpusTitle(item.filename.replace(/\.[^.]+$/, ''));
                      }}
                      className={`text-left p-2.5 rounded-lg border transition-colors ${
                        activeRecord?.uploadId === item.uploadId
                          ? 'bg-cyan-500/10 border-cyan-500/40'
                          : 'bg-[#07090E] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-100 truncate">
                          {item.filename}
                        </span>
                        <span className="font-mono text-cyan-300 shrink-0">
                          {item.analysis
                            ? `${item.analysis.heuristicCompletenessScore}%`
                            : item.extension}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Popped-Up Input Content Reader + Suggestions + Voice Talk */}
          {activeRecord && (
            <div className="bg-[#0D1320] border border-cyan-500/30 rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                    <Bot className="w-4 h-4" />
                    <span>
                      {isHe
                        ? `תוכן שקלטנו · ${activeRecord.filename}`
                        : `Pop-Up Input Reader & AI Suggestions · ${activeRecord.filename}`}
                    </span>
                  </h3>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {activeRecord.extractedTextBytes.toLocaleString()} bytes extracted
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {ttsSupported && (
                    <button
                      type="button"
                      data-testid="safe-ui-test"
                      onClick={() => handleSpeakUploadedContent()}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        speaking
                          ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                          : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                      }`}
                    >
                      {speaking ? (
                        <VolumeX className="w-3.5 h-3.5" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {speaking
                          ? isHe
                            ? 'עצור הקראה'
                            : 'Stop Talking'
                          : isHe
                            ? 'הקרא תוכן והצעות'
                            : 'Read Aloud & Talk'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      void askSideAiAboutFile(
                        isHe
                          ? 'עבור על הקובץ שהועלה, סכם מה חשוב בו ותן הצעות פרקטיות לשיפור.'
                          : 'Go over this uploaded file, summarize the key points clearly, and give concise practical suggestions.',
                        true
                      )
                    }
                    disabled={aiLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 text-slate-950 rounded-lg"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {aiLoading
                        ? isHe
                          ? 'קורא קובץ...'
                          : 'Reading File...'
                        : isHe
                          ? 'ניתוח והצעות AI'
                          : 'AI Review & Speak'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Pop-up Extracted Document Text right on the Left Input Side */}
              {activeRecord.extractedPreview && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-400 mb-1">
                    {isHe ? 'קטע מתוך הקובץ שהועלה' : 'Uploaded Content Pop-Up Excerpt'}
                  </div>
                  <pre className="p-3 rounded-lg bg-[#07090E] border border-slate-800 text-[11px] text-slate-200 max-h-44 overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
                    {activeRecord.extractedPreview}
                  </pre>
                </div>
              )}

              {/* AI Spoken Commentary / Suggestions Output */}
              {aiComment && (
                <div className="p-3.5 rounded-lg bg-cyan-950/25 border border-cyan-500/35 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-cyan-300">
                    <span>{isHe ? 'סקירה והצעות AI' : 'AI File Walkthrough & Commentary'}</span>
                    {ttsSupported && (
                      <button
                        type="button"
                        data-testid="safe-ui-test"
                        onClick={() => handleSpeakUploadedContent(aiComment)}
                        className="inline-flex items-center gap-1 text-slate-200 hover:text-cyan-200"
                      >
                        {speaking ? <Square className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                        <span>{speaking ? 'Stop' : 'Speak'}</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {aiComment}
                  </p>
                </div>
              )}

              {aiError && <p className="text-xs text-rose-300">{aiError}</p>}

              {/* Proactive Study Suggestions docked right on the Left Side */}
              {(aiSuggestions.length > 0 ||
                (activeRecord.analysis?.recommendations.length ?? 0) > 0) && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-300">
                    {isHe ? 'הצעות חכמות מתוך הקובץ' : 'Suggestions from This Input'}
                  </div>
                  <div className="space-y-1.5">
                    {aiSuggestions.map((s, idx) => (
                      <button
                        key={`ai-sug-${idx}`}
                        type="button"
                        data-testid="safe-ui-test"
                        onClick={() => setAiPrompt(s)}
                        className="w-full text-left p-2 rounded-lg bg-[#07090E] border border-slate-800 hover:border-cyan-500/40 text-xs text-cyan-200 transition-colors"
                      >
                        • {s}
                      </button>
                    ))}
                    {(activeRecord.analysis?.recommendations ?? []).map((rec, idx) => (
                      <div
                        key={`${rec.category}-${idx}`}
                        className="p-2.5 rounded-lg bg-[#07090E] border border-slate-800 text-xs text-slate-300"
                      >
                        <span className="font-mono uppercase text-[11px] text-amber-300">
                          [{rec.priority} · {rec.category}]
                        </span>{' '}
                        {rec.action}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Talk / Mic Prompt for the Uploaded File */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={leftVoice.listening ? leftVoice.stop : leftVoice.start}
                  disabled={!leftVoice.supported}
                  title={leftVoice.supported ? 'Ask about this file by voice' : 'Speech recognition unavailable'}
                  className={`p-2 rounded-lg border shrink-0 ${
                    leftVoice.listening
                      ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                      : 'border-slate-700 bg-[#07090E] text-slate-300 hover:border-cyan-500/50 disabled:opacity-45'
                  }`}
                >
                  {leftVoice.listening ? (
                    <MicOff className="w-3.5 h-3.5" />
                  ) : (
                    <Mic className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                </button>
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && aiPrompt.trim().length >= 2) {
                      void askSideAiAboutFile(aiPrompt, true);
                    }
                  }}
                  placeholder={
                    isHe
                      ? 'שאל את ה־AI על הקובץ או הקטע שלמעלה...'
                      : 'Ask or talk to the AI about this uploaded file...'
                  }
                  className="flex-1 rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void askSideAiAboutFile(aiPrompt, true)}
                  disabled={aiLoading || aiPrompt.trim().length < 2}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-semibold shrink-0"
                >
                  <Send className="w-3 h-3" />
                  <span>{isHe ? 'שאל' : 'Ask'}</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT SIDE (6 cols): All Results, Profiler, Study Methodology Plan & Corpus Output */}
        <section className="lg:col-span-6 space-y-4">
          {!activeRecord ? (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-10 text-center text-slate-400 text-xs">
              <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              {isHe
                ? 'תוצאות הניתוח, מדדי האיכות, פרופיל הנתונים ותוכנית המחקר יופיעו בצד זה מיד לאחר העלאת קובץ.'
                : 'Analysis results, data profiles, methodology indicators, and structured plans appear on this side immediately after uploading a file.'}
            </div>
          ) : (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-cyan-400" />
                    <span>
                      {isHe ? 'תוצאות ניתוח' : 'Results'} · {activeRecord.filename}
                    </span>
                  </h3>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
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
                      Run {activeRecord.analysis.suggestedSimEngine}
                    </span>
                  </button>
                )}
              </div>

              {activeRecord.analysis && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                    <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Completeness</div>
                      <div className="text-lg font-semibold text-cyan-300 mt-0.5">
                        {activeRecord.analysis.heuristicCompletenessScore}%
                      </div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Words</div>
                      <div className="text-lg font-semibold text-slate-100 mt-0.5">
                        {activeRecord.analysis.wordCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Flags</div>
                      <div className="text-lg font-semibold text-amber-300 mt-0.5">
                        {activeRecord.analysis.flags.length}
                      </div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3">
                      <div className="text-[11px] text-slate-400">Domain</div>
                      <div className="text-xs font-medium text-slate-200 mt-1 truncate">
                        {activeRecord.analysis.domainHint}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <span>{activeRecord.analysis.scoreWarning}</span>
                  </div>

                  {activeRecord.analysis.dataProfile && (
                    <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3.5 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
                        <span>Tabular Data Profile</span>
                      </div>
                      <div className="text-xs text-slate-300 font-mono tabular-nums">
                        Rows: {activeRecord.analysis.dataProfile.rows} · Columns:{' '}
                        {activeRecord.analysis.dataProfile.columns} · Missing:{' '}
                        {activeRecord.analysis.dataProfile.missingCells} (
                        {(activeRecord.analysis.dataProfile.missingFraction * 100).toFixed(1)}
                        %) · Duplicates: {activeRecord.analysis.dataProfile.duplicateRows}
                      </div>
                    </div>
                  )}

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
                </div>
              )}

              {activeRecord.archive && (
                <div className="bg-[#07090E] border border-slate-800 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Archive className="w-4 h-4 text-cyan-400" />
                    <span>Guarded Archive Manifest</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums">
                    Files: {activeRecord.archive.archiveFileCount} · Expanded:{' '}
                    {activeRecord.archive.expandedBytes.toLocaleString()} bytes
                  </div>
                </div>
              )}

              {/* Index to Corpus */}
              <div className="border-t border-slate-800 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Index Uploaded Artifact into RAG Corpus</span>
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
                    className="px-3 py-2 text-xs bg-[#07090E] border border-slate-800 rounded-lg text-slate-100"
                  />
                  <input
                    type="text"
                    value={corpusLicense}
                    onChange={(e) => setCorpusLicense(e.target.value)}
                    placeholder="SPDX License"
                    className="px-3 py-2 text-xs bg-[#07090E] border border-slate-800 rounded-lg text-slate-100"
                  />
                  <input
                    type="text"
                    value={corpusAuthors}
                    onChange={(e) => setCorpusAuthors(e.target.value)}
                    placeholder="Authors"
                    className="px-3 py-2 text-xs bg-[#07090E] border border-slate-800 rounded-lg text-slate-100"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleIndexCorpus()}
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

          {/* 6-Stage Research Plan Output Card on Right Results Side */}
          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-cyan-400" />
                <span>
                  {isHe
                    ? 'מתכנן פרוטוקול מחקר ותוצאות תכנון'
                    : '6-Stage Scientific Improvement Plan Results'}
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Research question..."
                className="sm:col-span-2 px-3 py-2 text-xs bg-[#07090E] border border-slate-800 rounded-lg text-slate-100"
              />
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="Domain"
                className="px-3 py-2 text-xs bg-[#07090E] border border-slate-800 rounded-lg text-slate-100"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleGeneratePlan()}
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
                      className="p-3 rounded-lg bg-[#07090E] border border-slate-800"
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
          </div>

          {capabilities && (
            <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 text-[11px] font-mono text-slate-400">
              Medical Decisions: {capabilities.safety.medicalDecisions} · Auto Execution:{' '}
              {capabilities.safety.automatedExperimentExecution}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
