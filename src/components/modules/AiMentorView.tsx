import { useEffect, useState } from 'react';
import { Brain, ShieldAlert, Trash2 } from 'lucide-react';
import {
  addMentorMemoryApi,
  clearAllMentorMemoryApi,
  deleteMentorMemoryApi,
  fetchMentorInsightsApi,
  toggleMentorMemoryApi,
} from '../../services/api';
import type { MentorMemoryNote, MentorRiskAlert } from '../../types';

export default function AiMentorView() {
  const [alerts, setAlerts] = useState<MentorRiskAlert[]>([]);
  const [notes, setNotes] = useState<MentorMemoryNote[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await fetchMentorInsightsApi();
      setAlerts(data.risks.alerts);
      setNotes(data.memory.notes);
      setMemoryEnabled(data.memory.memoryEnabled);
    } catch {
      // Ignore fetch failure
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggleMemory(enabled: boolean) {
    setError(null);
    const res = await toggleMentorMemoryApi(enabled);
    setMemoryEnabled(res.memoryEnabled);
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addMentorMemoryApi(topic, content);
      setTopic('');
      setContent('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save note.');
    }
  }

  async function handleDeleteNote(noteId: string) {
    await deleteMentorMemoryApi(noteId);
    await refresh();
  }

  async function handleWipeAll() {
    await clearAllMentorMemoryApi();
    await refresh();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Explainable Risk Detections & Preventive Recommendations */}
      <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-cyan-400" />
          <h2 className="text-base font-semibold text-slate-100">
            Predictive AI-Mentor · Explainable Research Risk Radar
          </h2>
        </div>

        <div className="space-y-3">
          {alerts.map((al) => (
            <article
              key={al.id}
              className={`rounded-lg border p-4 space-y-1.5 text-xs ${
                al.severity === 'high'
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : al.severity === 'medium'
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/5'
              }`}
            >
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="uppercase font-semibold">{al.severity} RISK</span>
                <span className="text-slate-400">
                  Signals: {al.triggeredByMetrics.join(', ')}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{al.title}</h3>
              <p className="text-slate-200">
                <span className="font-semibold">Recommendation: </span>
                {al.recommendation}
              </p>
              <p className="text-[11px] text-slate-400">
                <span className="font-semibold">Explainability: </span>
                {al.whyDetected}
              </p>
            </article>
          ))}
        </div>
      </div>

      {/* Right: User-Controlled Project Memory & Privacy Wipe */}
      <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Private Project Memory Controls
            </h3>
          </div>
          <button
            type="button"
            onClick={handleWipeAll}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-rose-500/40 text-rose-300 rounded hover:bg-rose-500/10"
          >
            <Trash2 className="w-3 h-3" />
            <span>Wipe All</span>
          </button>
        </div>

        <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2 text-xs text-slate-200">
          <span>Enable Local Project Memory</span>
          <input
            type="checkbox"
            checked={memoryEnabled}
            onChange={(e) => handleToggleMemory(e.target.checked)}
            className="accent-cyan-500"
          />
        </label>

        <form onSubmit={handleAddNote} className="space-y-2.5">
          <input
            type="text"
            required
            placeholder="Preference or project goal topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
          />
          <textarea
            rows={2}
            required
            placeholder="Constraint, lab preference, or risk threshold note..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
          />
          <button
            type="submit"
            disabled={!memoryEnabled}
            className="w-full px-3.5 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-45"
          >
            Save Memory Note
          </button>
        </form>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="space-y-2 max-h-[260px] overflow-y-auto">
          {notes.map((n) => (
            <div
              key={n.id}
              className="rounded-lg border border-slate-800 bg-[#07090E] p-3 text-xs flex items-start justify-between gap-2"
            >
              <div>
                <div className="font-semibold text-cyan-300">{n.topic}</div>
                <p className="text-slate-300 mt-0.5">{n.content}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteNote(n.id)}
                className="text-slate-500 hover:text-rose-400 shrink-0"
                title="Delete memory note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
