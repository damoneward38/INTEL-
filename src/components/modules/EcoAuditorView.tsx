import { useEffect, useState } from 'react';
import { Leaf, RefreshCw } from 'lucide-react';
import { fetchEcoAuditApi } from '../../services/api';
import type { EcoAuditReport, EcoRegionSpec } from '../../types';

export default function EcoAuditorView() {
  const [regionId, setRegionId] = useState('us-west1');
  const [regions, setRegions] = useState<EcoRegionSpec[]>([]);
  const [report, setReport] = useState<EcoAuditReport | null>(null);

  async function refresh(targetRegion = regionId) {
    try {
      const data = await fetchEcoAuditApi(targetRegion);
      setRegions(data.regions);
      setReport(data.report);
    } catch {
      // Ignore transient load error
    }
  }

  useEffect(() => {
    refresh(regionId);
  }, [regionId]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Leaf className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-100">
              Eco-Impact & Green Computing Auditor
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Calculates operational kWh, gCO2eq, and cooling water from live INTEL simulations, AI synthesis, and indexing runs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => refresh(regionId)}
            className="p-2 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800"
            title="Recalculate"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Total Energy Draw
              </div>
              <div className="text-2xl font-mono font-semibold text-slate-100 mt-1">
                {report.totalEnergyKwh.toFixed(5)} kWh
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Estimated Carbon Footprint
              </div>
              <div className="text-2xl font-mono font-semibold text-emerald-300 mt-1">
                {report.totalCarbonGCo2Eq.toFixed(3)} gCO2eq
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Cooling Water Footprint
              </div>
              <div className="text-2xl font-mono font-semibold text-cyan-300 mt-1">
                {report.totalWaterLiters.toFixed(4)} L
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-100">
                Workload Emissions Breakdown
              </h3>
              <div className="space-y-2">
                {report.breakdown.map((item) => (
                  <div
                    key={item.category}
                    className="rounded-lg border border-slate-800 bg-[#07090E] px-3.5 py-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-200 uppercase">
                        {item.category.replace('_', ' ')}
                      </span>
                      <span className="text-slate-400 ml-2">({item.count} units)</span>
                    </div>
                    <div className="font-mono text-slate-300">
                      {item.energyKwh} kWh · {item.carbonGCo2Eq} gCO2eq
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#07090E] p-3 text-[11px] font-mono text-slate-400 space-y-1">
                <div>Formula: {report.formulaSummary}</div>
                <div>Source: {report.region.sourceCitation}</div>
              </div>
            </div>

            <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-100">
                Green-Computing Recommendations
              </h3>
              <div className="space-y-2.5">
                {report.recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-300">{rec.title}</span>
                      <span className="font-mono text-emerald-400">
                        -{rec.estimatedSavingsPct}% CO2
                      </span>
                    </div>
                    <p className="text-slate-300">{rec.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
