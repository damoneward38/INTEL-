import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Send, Square } from 'lucide-react';
import type {
  ResearchDepth,
  SimulationEngine,
  SimulationParameters,
} from '../types';
import VoiceControl from './VoiceControl';

interface Props {
  language: 'en' | 'he';
  researchLoading: boolean;
  researchError: string | null;
  onRunResearch: (
    query: string,
    depth: ResearchDepth,
    inputMode: 'text' | 'voice'
  ) => void;
  simParameters: SimulationParameters;
  onSimParametersChange: (next: SimulationParameters) => void;
  simRunning: boolean;
  simProgress: number;
  simError: string | null;
  onRunSimulation: () => void;
  onCancelSimulation: () => void;
  onOpenConsole?: () => void;
}

export default function ControlTower({
  language,
  researchLoading,
  researchError,
  onRunResearch,
  simParameters,
  onSimParametersChange,
  simRunning,
  simProgress,
  simError,
  onRunSimulation,
  onCancelSimulation,
  onOpenConsole,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<ResearchDepth>('standard');

  const samples = t('command.samples', { returnObjects: true }) as string[];

  function submitTextResearch() {
    if (!query.trim() || researchLoading) return;
    onRunResearch(query.trim(), depth, 'text');
  }

  function handleVoiceTranscript(transcript: string) {
    setQuery(transcript);
    onRunResearch(transcript, depth, 'voice');
  }

  return (
    <aside className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-[#0D121D] p-5">
      {/* Research Command Section */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-slate-100">
            {t('command.title')}
          </h2>
          <div className="flex items-center gap-2">
            {onOpenConsole && (
              <button
                type="button"
                data-testid="safe-ui-test"
                onClick={onOpenConsole}
                className="px-2 py-1 text-[11px] font-medium rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 whitespace-nowrap"
              >
                {language === 'he' ? 'פתח קונסולה מלאה' : 'Full Voice Console'}
              </button>
            )}
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as ResearchDepth)}
              aria-label={t('command.depth')}
              className="rounded-md border border-slate-700 bg-[#07090E] px-2.5 py-1 text-xs text-slate-200 max-w-[160px] truncate"
            >
              <option value="standard">{t('command.depths.standard')}</option>
              <option value="deep">{t('command.depths.deep')}</option>
              <option value="comprehensive">{t('command.depths.comprehensive')}</option>
            </select>
          </div>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitTextResearch();
            }
          }}
          rows={4}
          placeholder={t('command.placeholder')}
          className="w-full rounded-lg border border-slate-700 bg-[#07090E] p-3 text-sm text-slate-100 placeholder:text-slate-500 resize-y focus:border-cyan-500"
        />

        {/* Sample Prompts */}
        {Array.isArray(samples) && samples.length > 0 && (
          <div className="mt-2.5">
            <div className="text-[11px] font-medium text-slate-400 mb-1.5">
              {t('command.sampleLabel')}
            </div>
            <div className="flex flex-col gap-1">
              {samples.slice(0, 2).map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setQuery(sample)}
                  className="text-start text-xs text-slate-300 hover:text-cyan-300 truncate py-1 px-2 rounded bg-[#07090E]/80 border border-slate-800/80 hover:border-slate-700 transition-colors"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
          <VoiceControl language={language} onResult={handleVoiceTranscript} />

          <button
            type="button"
            onClick={submitTextResearch}
            disabled={researchLoading || !query.trim()}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {researchLoading ? t('command.processing') : t('command.runResearch')}
            </span>
          </button>
        </div>

        {researchError && (
          <p className="mt-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">
            {researchError}
          </p>
        )}
      </div>

      <hr className="border-slate-800" />

      {/* Molecular Dynamics Parameters Section */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {t('simulation.title')}
          </h3>
          <span className="text-xs font-mono-tabular text-cyan-400">
            {simProgress}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {t('simulation.engine')}
            </label>
            <select
              value={simParameters.engine}
              onChange={(e) =>
                onSimParametersChange({
                  ...simParameters,
                  engine: e.target.value as SimulationEngine,
                })
              }
              disabled={simRunning}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-2 text-xs text-slate-100"
            >
              <option value="langevin-md">OpenMM / Langevin NVT (MD)</option>
              <option value="verlet-nve">Velocity-Verlet Microcanonical (NVE)</option>
              <option value="psi4-scf">Psi4 Ab Initio SCF (Quantum)</option>
              <option value="blast-align">BLAST Sequence Alignment</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {t('simulation.temperature')}
            </label>
            <input
              type="number"
              min={50}
              max={1500}
              step={10}
              disabled={simRunning}
              value={simParameters.temperature}
              onChange={(e) =>
                onSimParametersChange({
                  ...simParameters,
                  temperature: Number(e.target.value) || 300,
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {t('simulation.pressure')}
            </label>
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.5}
              disabled={simRunning}
              value={simParameters.pressure}
              onChange={(e) =>
                onSimParametersChange({
                  ...simParameters,
                  pressure: Number(e.target.value) || 1,
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
            />
          </div>

          <div className="col-span-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>{t('simulation.steps')}</span>
              <span className="font-mono-tabular text-slate-200">
                {simParameters.steps.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min={200}
              max={10000}
              step={200}
              disabled={simRunning}
              value={simParameters.steps}
              onChange={(e) =>
                onSimParametersChange({
                  ...simParameters,
                  steps: Number(e.target.value),
                })
              }
              className="w-full accent-cyan-500"
            />
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-150"
            style={{ width: `${simProgress}%` }}
          />
        </div>

        <div className="mt-3.5 flex items-center justify-end gap-2">
          {simRunning ? (
            <button
              type="button"
              onClick={onCancelSimulation}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              <span>{t('simulation.cancel')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onRunSimulation}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-white text-slate-950 rounded-lg transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t('simulation.run')}</span>
            </button>
          )}
        </div>

        {simError && (
          <p className="mt-2.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">
            {simError}
          </p>
        )}
      </div>
    </aside>
  );
}
