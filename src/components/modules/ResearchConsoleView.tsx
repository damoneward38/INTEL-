import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  FileText,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useVoice } from '../../hooks/useVoice';
import {
  fetchAllUploadHistoryApi,
  sendResearchChatApi,
} from '../../services/api';
import {
  isSpeechTalkSupported,
  speakAloud,
  stopSpeechTalk,
} from '../../utils/speechTalk';
import type {
  AllUploadRecord,
  ResearchChatHistoryItem,
  ResearchChatPersona,
  RetrievedSource,
} from '../../types';

interface Props {
  language: 'en' | 'he';
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  persona?: ResearchChatPersona;
  suggestions?: string[];
  sources?: RetrievedSource[];
  timestamp: string;
}

const PERSONAS: Array<{
  id: ResearchChatPersona;
  labelEn: string;
  labelHe: string;
  descEn: string;
  descHe: string;
}> = [
  {
    id: 'synthesizer',
    labelEn: 'Research Synthesizer',
    labelHe: 'מסנתז מחקר',
    descEn: 'Grounded RAG & literature Q&A',
    descHe: 'שאלות ותשובות מבוססות מאגר',
  },
  {
    id: 'protocol',
    labelEn: 'Protocol Advisor',
    labelHe: 'יועץ פרוטוקולים',
    descEn: 'Controls, stats & study bias audit',
    descHe: 'בקרות, סטטיסטיקה וביקורת מתודולוגיה',
  },
  {
    id: 'simulation',
    labelEn: 'Simulation Guide',
    labelHe: 'מדריך סימולציה',
    descEn: 'OpenMM / Psi4 / autonomous loop help',
    descHe: 'כוונון סימולציות OpenMM ו־Psi4',
  },
];

export default function ResearchConsoleView({ language }: Props) {
  const isHe = language === 'he';
  const [persona, setPersona] = useState<ResearchChatPersona>('synthesizer');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speakingTurnId, setSpeakingTurnId] = useState<string | null>(null);
  const [autoSendVoice, setAutoSendVoice] = useState(true);
  const [micPermission, setMicPermission] = useState<
    'unknown' | 'ready' | 'denied' | 'unsupported'
  >('unknown');

  const [uploads, setUploads] = useState<AllUploadRecord[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string>('');
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome-turn',
      role: 'assistant',
      persona: 'synthesizer',
      text: isHe
        ? 'שלום! אני קונסולת המחקר הקולית של INTEL. אפשר לדבר אליי דרך המיקרופון, לבחור קובץ שהועלה לניתוח, או לבחור אחד מהצ׳אטבוטים למעלה.'
        : 'Welcome to the INTEL Research Command Console. Use your microphone to speak directly, attach an uploaded research file on the left, or switch chatbot specialists above—I can read findings aloud and suggest next steps.',
      suggestions: isHe
        ? [
            'סכם את המסמכים במאגר המחקר',
            'אילו פרמטרים מומלצים לסימולציית Langevin MD?',
            'עבור איתי על הקובץ האחרון שהועלה',
          ]
        : [
            'Summarize the key insights in our indexed corpus',
            'What study controls improve Langevin MD reproducibility?',
            'Review the latest uploaded research file with me',
          ],
      timestamp: new Date().toISOString(),
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const ttsSupported = isSpeechTalkSupported();

  const selectedUpload =
    uploads.find((u) => u.uploadId === selectedUploadId) ?? null;

  useEffect(() => {
    fetchAllUploadHistoryApi()
      .then((res) => {
        setUploads(res.uploads);
        if (res.uploads.length > 0 && !selectedUploadId) {
          setSelectedUploadId(res.uploads[0].uploadId);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

  useEffect(() => {
    return () => {
      stopSpeechTalk();
    };
  }, []);

  async function probeMicrophoneHardware() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setMicPermission('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission('ready');
    } catch {
      setMicPermission('denied');
    }
  }

  function handleSpeak(turnId: string, text: string) {
    if (!ttsSupported) return;
    if (speakingTurnId === turnId) {
      stopSpeechTalk();
      setSpeakingTurnId(null);
      return;
    }
    setSpeakingTurnId(turnId);
    speakAloud(text, {
      language,
      rate: speechRate,
      onStart: () => setSpeakingTurnId(turnId),
      onEnd: () => setSpeakingTurnId(null),
      onError: () => setSpeakingTurnId(null),
    });
  }

  async function submitMessage(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed || sending) return;

    setErrorMsg(null);
    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    const nextHistory: ResearchChatHistoryItem[] = [...turns, userTurn]
      .slice(-10)
      .map((t) => ({ role: t.role, text: t.text }));

    setTurns((prev) => [...prev, userTurn]);
    setInput('');
    setSending(true);

    try {
      const res = await sendResearchChatApi({
        message: trimmed,
        persona,
        language,
        history: nextHistory,
        artifactContext: selectedUpload
          ? {
              filename: selectedUpload.filename,
              summary: selectedUpload.analysis
                ? `Completeness ${selectedUpload.analysis.heuristicCompletenessScore}%, domain ${selectedUpload.analysis.domainHint}, flags ${selectedUpload.analysis.flags.length}`
                : undefined,
              excerpt: selectedUpload.extractedPreview,
            }
          : undefined,
      });

      const assistantTurn: ChatTurn = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        persona: res.persona,
        text: res.reply,
        suggestions: res.suggestions,
        sources: res.sources,
        timestamp: res.createdAt,
      };
      setTurns((prev) => [...prev, assistantTurn]);

      if (autoSpeak && ttsSupported) {
        handleSpeak(assistantTurn.id, assistantTurn.text);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Research chatbot request failed.'
      );
    } finally {
      setSending(false);
    }
  }

  const voice = useVoice(language, (transcript) => {
    if (autoSendVoice) {
      void submitMessage(transcript);
    } else {
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    }
  });

  function toggleMicListening() {
    if (voice.listening) {
      voice.stop();
    } else {
      void probeMicrophoneHardware();
      voice.start();
    }
  }

  const activeSuggestions =
    [...turns].reverse().find((t) => t.role === 'assistant' && t.suggestions?.length)
      ?.suggestions ?? [];

  return (
    <div className="space-y-4 min-h-[calc(100vh-11rem)] flex flex-col">
      {/* Console Header & Chatbot Mode Selector */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            <span>
              {isHe
                ? 'קונסולת פיקוד מחקר קולית וצ׳אטבוטים'
                : 'Research Command Console · Voice, Microphone & AI Chatbots'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isHe
              ? 'דף מלא לשיחה דו־כיוונית עם מיקרופון, הקראת תשובות בקול, צ׳אטבוטים מתמחים וקישור קבצים.'
              : 'Dedicated full-page AI research workspace with live microphone dictation, spoken voice replies, specialist chatbots, and file context.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PERSONAS.map((p) => {
            const active = persona === p.id;
            return (
              <button
                key={p.id}
                type="button"
                data-testid="safe-ui-test"
                onClick={() => setPersona(p.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                  active
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200 font-semibold'
                    : 'bg-[#07090E] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title={isHe ? p.descHe : p.descEn}
              >
                {isHe ? p.labelHe : p.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Split Workspace: Voice/Context Dock (Left 4) + Full Chatbot Stage (Right 8) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
        {/* Left Control & Microphone Dock */}
        <aside className="lg:col-span-4 bg-[#0D1320] border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
          {/* Microphone & Speech Talk Controls */}
          <div className="bg-[#07090E] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                {isHe ? 'מיקרופון ודיבור AI' : 'Microphone & AI Voice'}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {voice.listening
                  ? '● Listening'
                  : micPermission === 'ready'
                    ? '● Mic Ready'
                    : voice.supported
                      ? 'Speech Ready'
                      : 'Browser Mic N/A'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleMicListening}
                disabled={!voice.supported}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                  voice.listening
                    ? 'border-rose-500/70 bg-rose-500/20 text-rose-200'
                    : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-45'
                }`}
              >
                {voice.listening ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                <span>
                  {voice.listening
                    ? isHe
                      ? 'הפסק האזנה'
                      : 'Stop Listening'
                    : isHe
                      ? 'דבר למיקרופון'
                      : 'Talk to AI (Mic)'}
                </span>
              </button>

              <button
                type="button"
                data-testid="safe-ui-test"
                onClick={() => void probeMicrophoneHardware()}
                className="px-3 py-2.5 text-xs rounded-lg border border-slate-700 bg-[#0D1320] text-slate-300 hover:border-slate-500"
              >
                {isHe ? 'בדוק מיקרופון' : 'Test Mic'}
              </button>
            </div>

            {voice.interimTranscript && (
              <div className="text-xs font-mono text-cyan-300 bg-cyan-950/30 border border-cyan-500/30 rounded-lg px-3 py-2">
                “{voice.interimTranscript}”
              </div>
            )}
            {voice.voiceError && (
              <div className="text-xs text-rose-300">{voice.voiceError}</div>
            )}
            {micPermission === 'denied' && (
              <div className="text-[11px] text-amber-300">
                Microphone permission blocked in browser settings; type questions directly below.
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 space-y-2.5 text-xs">
              <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                <span>
                  {isHe ? 'הקראת תשובות AI אוטומטית' : 'Auto-Speak AI Responses'}
                </span>
                <input
                  type="checkbox"
                  checked={autoSpeak}
                  onChange={(e) => {
                    setAutoSpeak(e.target.checked);
                    if (!e.target.checked) {
                      stopSpeechTalk();
                      setSpeakingTurnId(null);
                    }
                  }}
                  className="rounded border-slate-600 bg-[#0D1320] text-cyan-500"
                />
              </label>

              <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                <span>
                  {isHe ? 'שליחה אוטומטית בסיום דיבור' : 'Auto-Send Voice Dictation'}
                </span>
                <input
                  type="checkbox"
                  checked={autoSendVoice}
                  onChange={(e) => setAutoSendVoice(e.target.checked)}
                  className="rounded border-slate-600 bg-[#0D1320] text-cyan-500"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">
                  {isHe ? 'מהירות דיבור:' : 'Voice Speed:'} {speechRate.toFixed(2)}x
                </span>
                <input
                  type="range"
                  min={0.8}
                  max={1.35}
                  step={0.05}
                  value={speechRate}
                  onChange={(e) => setSpeechRate(Number(e.target.value))}
                  className="w-28 accent-cyan-500"
                />
              </div>

              {speakingTurnId && (
                <button
                  type="button"
                  data-testid="safe-ui-test"
                  onClick={() => {
                    stopSpeechTalk();
                    setSpeakingTurnId(null);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200"
                >
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>{isHe ? 'עצור הקראה קולית' : 'Stop Voice Readout'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Grounded Uploaded File Context Linker */}
          <div className="bg-[#07090E] border border-slate-800 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isHe ? 'קובץ מקושר לשיחה' : 'Linked File Context'}</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {uploads.length} files
              </span>
            </div>

            <select
              value={selectedUploadId}
              onChange={(e) => setSelectedUploadId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#0D1320] px-2.5 py-2 text-xs text-slate-100"
            >
              <option value="">
                {isHe ? 'ללא קובץ מצורף (מאגר כללי בלבד)' : 'No file attached (Corpus only)'}
              </option>
              {uploads.map((u) => (
                <option key={u.uploadId} value={u.uploadId}>
                  {u.filename} ({u.analysis ? `${u.analysis.heuristicCompletenessScore}%` : u.extension})
                </option>
              ))}
            </select>

            {selectedUpload?.extractedPreview && (
              <div className="text-[11px] font-mono text-slate-400 bg-[#0D1320] border border-slate-800 rounded-lg p-2.5 max-h-28 overflow-y-auto whitespace-pre-wrap">
                {selectedUpload.extractedPreview.slice(0, 320)}
                {selectedUpload.extractedPreview.length > 320 ? '…' : ''}
              </div>
            )}
          </div>

          {/* Suggested Follow-Up Chips */}
          {activeSuggestions.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isHe ? 'הצעות להמשך' : 'Suggested Prompts'}</span>
              </div>
              <div className="space-y-1.5">
                {activeSuggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    data-testid="safe-ui-test"
                    onClick={() => setInput(s)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-slate-800 bg-[#07090E] hover:border-cyan-500/40 text-xs text-slate-300 hover:text-cyan-200 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Right Full-Height Chatbot Thread */}
        <section className="lg:col-span-8 bg-[#0D1320] border border-slate-800 rounded-xl flex flex-col overflow-hidden min-h-[540px]">
          <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="text-xs font-mono text-slate-300">
              Active Chatbot:{' '}
              <span className="text-cyan-300 font-semibold">
                {PERSONAS.find((p) => p.id === persona)?.[isHe ? 'labelHe' : 'labelEn']}
              </span>
              {selectedUpload && (
                <>
                  {' '}
                  · Reading <span className="text-emerald-300">{selectedUpload.filename}</span>
                </>
              )}
            </div>
            <button
              type="button"
              data-testid="safe-ui-test"
              onClick={() => {
                stopSpeechTalk();
                setSpeakingTurnId(null);
                setTurns((prev) => prev.slice(0, 1));
              }}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-slate-800"
            >
              <Trash2 className="w-3 h-3" />
              <span>{isHe ? 'נקה שיחה' : 'Reset Thread'}</span>
            </button>
          </div>

          {/* Chat Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {turns.map((turn) => {
              const isUser = turn.role === 'user';
              const isSpeaking = speakingTurnId === turn.id;
              return (
                <div
                  key={turn.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl border px-4 py-3 space-y-2 ${
                      isUser
                        ? 'bg-cyan-500/12 border-cyan-500/35 text-slate-100'
                        : 'bg-[#07090E] border-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 text-[11px] font-mono text-slate-400">
                      <span>
                        {isUser
                          ? isHe
                            ? 'את/ה'
                            : 'Researcher'
                          : `INTEL AI · ${turn.persona ?? 'synthesizer'}`}
                      </span>
                      {!isUser && ttsSupported && (
                        <button
                          type="button"
                          data-testid="safe-ui-test"
                          onClick={() => handleSpeak(turn.id, turn.text)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                            isSpeaking
                              ? 'border-amber-400/50 text-amber-200 bg-amber-500/10'
                              : 'border-slate-700 text-slate-300 hover:border-cyan-500/40'
                          }`}
                        >
                          {isSpeaking ? (
                            <Square className="w-2.5 h-2.5" />
                          ) : (
                            <Volume2 className="w-3 h-3 text-cyan-400" />
                          )}
                          <span>
                            {isSpeaking
                              ? isHe
                                ? 'עצור'
                                : 'Stop'
                              : isHe
                                ? 'הקרא בקול'
                                : 'Read Aloud'}
                          </span>
                        </button>
                      )}
                    </div>

                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {turn.text}
                    </div>

                    {turn.sources && turn.sources.length > 0 && (
                      <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-2 text-[11px] font-mono text-slate-400">
                        {turn.sources.slice(0, 3).map((src, idx) => (
                          <span key={src.id}>
                            [C{idx + 1}] {src.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {sending && (
              <div className="text-xs font-mono text-cyan-300 px-2">
                {isHe ? 'מכין תשובה מבוססת ראיות...' : 'Synthesizing grounded response...'}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {errorMsg && (
            <div className="mx-4 mb-2 rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-slate-800 p-3 bg-[#080C15] flex items-end gap-2.5">
            <button
              type="button"
              onClick={toggleMicListening}
              disabled={!voice.supported}
              title={isHe ? 'הכתבה קולית' : 'Voice Dictation'}
              className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
                voice.listening
                  ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                  : 'border-slate-700 bg-[#0D1320] text-slate-300 hover:border-cyan-500/50 disabled:opacity-45'
              }`}
            >
              {voice.listening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4 text-cyan-400" />
              )}
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submitMessage(input);
                }
              }}
              rows={2}
              placeholder={
                isHe
                  ? 'הקלד שאלה או דבר למיקרופון כדי לשוחח עם ה־AI...'
                  : 'Ask the AI chatbot or use your microphone to talk through research findings...'
              }
              className="flex-1 rounded-lg border border-slate-700 bg-[#0D1320] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 resize-none focus:border-cyan-500 focus:outline-none"
            />

            <button
              type="button"
              onClick={() => void submitMessage(input)}
              disabled={sending || input.trim().length < 2}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-semibold shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isHe ? 'שלח' : 'Send'}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
