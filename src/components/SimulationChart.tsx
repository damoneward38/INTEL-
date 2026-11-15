import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type {
  ReferenceValidation,
  SimulationFrame,
  SimulationSummary,
} from '../types';

interface Props {
  frames: SimulationFrame[];
  summary?: SimulationSummary;
  referenceValidation?: ReferenceValidation;
}

type TraceKey =
  | 'totalEnergy'
  | 'potentialEnergy'
  | 'kineticEnergy'
  | 'temperatureInst'
  | 'pressureInst';

const TRACE_COLORS: Record<TraceKey, string> = {
  totalEnergy: '#06B6D4',
  potentialEnergy: '#38BDF8',
  kineticEnergy: '#10B981',
  temperatureInst: '#F59E0B',
  pressureInst: '#F43F5E',
};

export default function SimulationChart({
  frames,
  summary,
  referenceValidation,
}: Props) {
  const { t } = useTranslation();
  const [activeTrace, setActiveTrace] = useState<TraceKey>('totalEnergy');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chartGeometry = useMemo(() => {
    if (frames.length === 0) return null;
    const width = 620;
    const height = 220;
    const padL = 54;
    const padR = 16;
    const padT = 16;
    const padB = 34;

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const values = frames.map((f) => f[activeTrace]);
    let minVal = Math.min(...values);
    let maxVal = Math.max(...values);
    if (Math.abs(maxVal - minVal) < 1e-6) {
      minVal -= 1;
      maxVal += 1;
    } else {
      const span = maxVal - minVal;
      minVal -= span * 0.08;
      maxVal += span * 0.08;
    }

    const points = frames.map((f, idx) => {
      const x =
        frames.length === 1
          ? padL + plotW / 2
          : padL + (idx / (frames.length - 1)) * plotW;
      const y =
        padT +
        plotH -
        ((f[activeTrace] - minVal) / (maxVal - minVal)) * plotH;
      return { x, y, frame: f, value: f[activeTrace] };
    });

    const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath =
      `M ${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} ` +
      points.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
      ` L ${points[points.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      y: padT + plotH - ratio * plotH,
      val: minVal + ratio * (maxVal - minVal),
    }));

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      points,
      polyline,
      areaPath,
      yTicks,
    };
  }, [frames, activeTrace]);

  const inspected =
    chartGeometry && hoverIndex !== null && chartGeometry.points[hoverIndex]
      ? chartGeometry.points[hoverIndex]
      : chartGeometry?.points[chartGeometry.points.length - 1] ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Trace Selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(TRACE_COLORS) as TraceKey[]).map((key) => {
          const active = activeTrace === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTrace(key)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-800 text-slate-100 border-slate-600'
                  : 'bg-transparent text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: TRACE_COLORS[key] }}
              />
              {t(`simulation.traces.${key}`)}
            </button>
          );
        })}
      </div>

      {/* SVG Scientific Plot */}
      {!chartGeometry ? (
        <div className="h-[220px] flex items-center justify-center rounded-lg border border-slate-800/80 bg-[#07090E] px-4 text-center text-xs text-slate-400">
          {t('simulation.emptyChart')}
        </div>
      ) : (
        <div className="relative rounded-lg border border-slate-800 bg-[#07090E] p-2">
          {inspected && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 text-[11px] font-mono-tabular text-slate-300">
              <span>
                Step {inspected.frame.step} · t={inspected.frame.timePs.toFixed(2)} ps
              </span>
              <span style={{ color: TRACE_COLORS[activeTrace] }}>
                {inspected.value.toFixed(3)} · RMSD {inspected.frame.rmsd.toFixed(4)}
              </span>
            </div>
          )}

          <svg
            viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
            className="w-full h-[210px] cursor-crosshair select-none"
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX =
                ((e.clientX - rect.left) / rect.width) * chartGeometry.width;
              let closest = 0;
              let bestDist = Infinity;
              chartGeometry.points.forEach((p, idx) => {
                const dist = Math.abs(p.x - relX);
                if (dist < bestDist) {
                  bestDist = dist;
                  closest = idx;
                }
              });
              setHoverIndex(closest);
            }}
          >
            {chartGeometry.yTicks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={chartGeometry.padL}
                  x2={chartGeometry.width - chartGeometry.padR}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="#1E293B"
                  strokeWidth="1"
                />
                <text
                  x={chartGeometry.padL - 8}
                  y={tick.y + 3}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {tick.val.toFixed(1)}
                </text>
              </g>
            ))}

            <path
              d={chartGeometry.areaPath}
              fill={TRACE_COLORS[activeTrace]}
              fillOpacity="0.1"
            />

            <polyline
              fill="none"
              stroke={TRACE_COLORS[activeTrace]}
              strokeWidth="2"
              points={chartGeometry.polyline}
            />

            {inspected && (
              <g>
                <line
                  x1={inspected.x}
                  x2={inspected.x}
                  y1={chartGeometry.padT}
                  y2={chartGeometry.padT + chartGeometry.plotH}
                  stroke="#475569"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={inspected.x}
                  cy={inspected.y}
                  r="4"
                  fill={TRACE_COLORS[activeTrace]}
                  stroke="#07090E"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        </div>
      )}

      {/* Quantitative Summary Strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <div className="rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2">
            <div className="text-[11px] text-slate-400">{t('simulation.metrics.meanTemp')}</div>
            <div className="text-sm font-mono-tabular font-semibold text-slate-100 mt-0.5">
              {summary.meanTempK.toFixed(1)} K
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2">
            <div className="text-[11px] text-slate-400">{t('simulation.metrics.meanPressure')}</div>
            <div className="text-sm font-mono-tabular font-semibold text-slate-100 mt-0.5">
              {summary.meanPressureAtm.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2">
            <div className="text-[11px] text-slate-400">{t('simulation.metrics.totalEnergy')}</div>
            <div className="text-sm font-mono-tabular font-semibold text-slate-100 mt-0.5">
              {summary.meanTotalEnergy.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2">
            <div className="text-[11px] text-slate-400">{t('simulation.metrics.finalRmsd')}</div>
            <div className="text-sm font-mono-tabular font-semibold text-slate-100 mt-0.5">
              {summary.finalRmsd.toFixed(4)}
            </div>
          </div>
        </div>
      )}

      {/* Reference Dataset Validation */}
      {referenceValidation && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${
            referenceValidation.passed
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}
        >
          {referenceValidation.passed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="font-semibold">
              {referenceValidation.passed
                ? t('simulation.benchmarkPass')
                : t('simulation.benchmarkDrift')}{' '}
              · {referenceValidation.benchmarkName}
            </div>
            <div className="font-mono-tabular text-[11px] opacity-90 mt-0.5">
              Expected: {referenceValidation.expectedRange} · Observed:{' '}
              {referenceValidation.observedValue}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
