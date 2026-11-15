import { useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';
import { Cpu, Download, Sparkles } from 'lucide-react';
import {
  fetchThoughtPrototypesApi,
  generateThoughtPrototypeApi,
} from '../../services/api';
import type { ThoughtPrototype } from '../../types';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
});

interface Props {
  language: 'en' | 'he';
}

export default function ThoughtPrototypesView({ language }: Props) {
  const [hypothesis, setHypothesis] = useState(
    'Hydrogen mass repartitioning at 4 fs maintains Langevin NVT stability while reducing GPU energy consumption by 40%.'
  );
  const [preferOllama, setPreferOllama] = useState(false);
  const [ollama, setOllama] = useState<{
    reachable: boolean;
    url: string;
    models: string[];
  }>({ reachable: false, url: 'http://127.0.0.1:11434', models: [] });
  const [prototypes, setPrototypes] = useState<ThoughtPrototype[]>([]);
  const [selected, setSelected] = useState<ThoughtPrototype | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, '');

  useEffect(() => {
    fetchThoughtPrototypesApi()
      .then((res) => {
        setOllama(res.ollama);
        setPrototypes(res.prototypes);
        if (res.prototypes[0]) setSelected(res.prototypes[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected?.mermaidDiagram) {
      setSvgMarkup('');
      return;
    }
    let cancelled = false;
    mermaid
      .render(`mermaid-${renderId}-${selected.id}`, selected.mermaidDiagram)
      .then(({ svg }) => {
        if (!cancelled) setSvgMarkup(svg);
      })
      .catch(() => {
        if (!cancelled) setSvgMarkup('');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, renderId]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await generateThoughtPrototypeApi({
        hypothesis,
        language,
        preferOllama,
      });
      setPrototypes((prev) => [res.prototype, ...prev]);
      setSelected(res.prototype);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prototype generation failed.');
    } finally {
      setLoading(false);
    }
  }

  function exportPlanMarkdown() {
    if (!selected) return;
    const md = [
      `# ${selected.title}`,
      `**Gateway**: ${selected.gatewayUsed}`,
      `**Hypothesis**: ${selected.hypothesis}`,
      `\n## Variables`,
      `- Independent: ${selected.variables.independent.join(', ')}`,
      `- Dependent: ${selected.variables.dependent.join(', ')}`,
      `- Controls: ${selected.variables.controls.join(', ')}`,
      `\n## Protocol Steps`,
      ...selected.protocolSteps.map((s, idx) => `${idx + 1}. ${s}`),
      `\n## Falsification Criteria\n${selected.falsificationCriteria}`,
      `\n## Mermaid Workflow\n\`\`\`mermaid\n${selected.mermaidDiagram}\n\`\`\``,
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.id}-research-plan.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Hypothesis Input & Local Ollama Gateway Status */}
      <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            AI Thought-Prototypes & Workflow Builder
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Converts scientific hypotheses into structured experiments, falsification gates, and Mermaid diagrams.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-300">Local Ollama Gateway ({ollama.url})</span>
          </div>
          <span
            className={`font-mono text-[11px] ${
              ollama.reachable ? 'text-emerald-400' : 'text-slate-500'
            }`}
          >
            {ollama.reachable ? `ONLINE (${ollama.models.length})` : 'OFFLINE · GEMINI ACTIVE'}
          </span>
        </div>

        <form onSubmit={handleGenerate} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Scientific Hypothesis
            </label>
            <textarea
              rows={4}
              required
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={preferOllama}
              disabled={!ollama.reachable}
              onChange={(e) => setPreferOllama(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>Route to local Ollama gateway (requires local daemon)</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{loading ? 'Generating Protocol...' : 'Synthesize Prototype & Diagram'}</span>
          </button>
        </form>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        {prototypes.length > 0 && (
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <h3 className="text-xs font-semibold text-slate-300">Recent Prototypes</h3>
            {prototypes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors ${
                  selected?.id === p.id
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-slate-100'
                    : 'border-slate-800 bg-[#07090E] text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: Rendered Mermaid Diagram & Exportable Experimental Plan */}
      <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        {!selected ? (
          <div className="h-[360px] flex items-center justify-center text-xs text-slate-500">
            Submit a hypothesis to generate an experimental workflow and Mermaid diagram.
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-100">{selected.title}</h3>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                  Engine: {selected.gatewayUsed} · {selected.citations.length} Grounded Citations
                </p>
              </div>
              <button
                type="button"
                onClick={exportPlanMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-700 rounded-lg text-slate-200 hover:bg-slate-800 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .md Plan</span>
              </button>
            </div>

            {/* Mermaid SVG Diagram */}
            <div className="rounded-lg border border-slate-800 bg-[#07090E] p-4 overflow-x-auto">
              {svgMarkup ? (
                <div
                  className="flex justify-center"
                  dangerouslySetInnerHTML={{ __html: svgMarkup }}
                />
              ) : (
                <pre className="text-[11px] font-mono text-cyan-300 whitespace-pre-wrap">
                  {selected.mermaidDiagram}
                </pre>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-slate-800 bg-[#07090E] p-3">
                <div className="font-semibold text-cyan-300 mb-1">Independent</div>
                <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                  {selected.variables.independent.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#07090E] p-3">
                <div className="font-semibold text-cyan-300 mb-1">Dependent</div>
                <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                  {selected.variables.dependent.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#07090E] p-3">
                <div className="font-semibold text-cyan-300 mb-1">Controls</div>
                <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                  {selected.variables.controls.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-slate-200">Protocol Steps</div>
              <ol className="list-decimal list-inside text-slate-300 space-y-1">
                {selected.protocolSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <span className="font-semibold">Falsification Gate: </span>
              {selected.falsificationCriteria}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
