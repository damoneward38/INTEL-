import { listCorpusChunks } from '../corpusIndex.ts';
import { listProvenance } from '../provenance.ts';
import { listSimulationJobs } from '../simulationEngine.ts';
import type { EcoAuditReport, EcoRegionSpec } from '../types.ts';

export const ECO_REGIONS: EcoRegionSpec[] = [
  {
    id: 'eu-north1',
    label: 'Stockholm / Hydro & Wind (eu-north1)',
    carbonIntensityGPerKwh: 28,
    pue: 1.12,
    sourceCitation: 'ElectricityMaps / IEA Nordic Grid 2025 (28 gCO2eq/kWh, PUE 1.12)',
  },
  {
    id: 'us-west1',
    label: 'Oregon / Hydro Grid (us-west1)',
    carbonIntensityGPerKwh: 195,
    pue: 1.15,
    sourceCitation: 'EPA eGRID NWPP Subregion 2025 (195 gCO2eq/kWh, PUE 1.15)',
  },
  {
    id: 'us-east1',
    label: 'Virginia / Mixed Grid (us-east1)',
    carbonIntensityGPerKwh: 380,
    pue: 1.18,
    sourceCitation: 'EPA eGRID SRVC Subregion 2025 (380 gCO2eq/kWh, PUE 1.18)',
  },
  {
    id: 'il-central',
    label: 'Tel Aviv / Natural Gas Grid (il-central)',
    carbonIntensityGPerKwh: 465,
    pue: 1.21,
    sourceCitation: 'Israel Ministry of Energy Grid Factor 2025 (465 gCO2eq/kWh, PUE 1.21)',
  },
];

// Boavizta / Cloud Carbon Footprint reference hardware constants
const WORKER_POWER_KW = 0.085; // 85W isolated worker thread average draw
const INFERENCE_KWH_PER_CALL = 0.0014; // Server-side Gemini remote inference amortized energy
const INDEX_KWH_PER_CHUNK = 0.00012; // Local TF-IDF + SHA-256 chunk indexing
const WATER_L_PER_KWH = 1.2; // WUE 1.2 L/kWh evaporative cooling reference

export function generateEcoAuditReport(regionId = 'us-west1'): EcoAuditReport {
  const region =
    ECO_REGIONS.find((r) => r.id === regionId) ?? ECO_REGIONS[1];

  const sims = listSimulationJobs();
  const provenance = listProvenance(300);
  const chunks = listCorpusChunks();

  const totalSimSeconds = sims.reduce((acc, s) => {
    const ms = s.summary?.elapsedMs ?? 900;
    return acc + ms / 1000;
  }, 0);

  const simEnergyKwh = Math.max(
    0.0005,
    (totalSimSeconds / 3600) * WORKER_POWER_KW * region.pue
  );

  const inferenceCalls = provenance.filter((p) => p.kind === 'research').length;
  const inferenceEnergyKwh = inferenceCalls * INFERENCE_KWH_PER_CALL * region.pue;

  const indexingEnergyKwh = chunks.length * INDEX_KWH_PER_CHUNK * region.pue;

  const simCarbon = simEnergyKwh * region.carbonIntensityGPerKwh;
  const infCarbon = inferenceEnergyKwh * region.carbonIntensityGPerKwh;
  const idxCarbon = indexingEnergyKwh * region.carbonIntensityGPerKwh;

  const totalEnergyKwh = Number(
    (simEnergyKwh + inferenceEnergyKwh + indexingEnergyKwh).toFixed(5)
  );
  const totalCarbonGCo2Eq = Number(
    (simCarbon + infCarbon + idxCarbon).toFixed(3)
  );
  const totalWaterLiters = Number((totalEnergyKwh * WATER_L_PER_KWH).toFixed(4));

  const lowestRegion = ECO_REGIONS[0];
  const shiftSavingsPct =
    region.id === lowestRegion.id
      ? 0
      : Math.round(
          ((region.carbonIntensityGPerKwh - lowestRegion.carbonIntensityGPerKwh) /
            region.carbonIntensityGPerKwh) *
            100
        );

  const recommendations: EcoAuditReport['recommendations'] = [
    ...(shiftSavingsPct > 0
      ? [
          {
            title: `Schedule heavy MD/SCF worker batches in ${lowestRegion.label}`,
            estimatedSavingsPct: shiftSavingsPct,
            rationale: `Lowers grid carbon factor from ${region.carbonIntensityGPerKwh} to ${lowestRegion.carbonIntensityGPerKwh} gCO2eq/kWh.`,
          },
        ]
      : []),
    {
      title: 'Enable SHA-256 content deduplication prior to chunk vectorization',
      estimatedSavingsPct: 35,
      rationale:
        'Skipping duplicate abstracts during arXiv/PubMed ingestion eliminates redundant tokenization and embedding passes.',
    },
    {
      title: 'Use Standard (Low Thinking) depth for exploratory screening before Comprehensive runs',
      estimatedSavingsPct: 48,
      rationale:
        'Reserves high-reasoning tokens for peer-reviewed final synthesis while keeping exploratory latency and Wh draw minimal.',
    },
  ];

  return {
    region,
    totalEnergyKwh,
    totalCarbonGCo2Eq,
    totalWaterLiters,
    breakdown: [
      {
        category: 'simulations',
        count: sims.length,
        energyKwh: Number(simEnergyKwh.toFixed(5)),
        carbonGCo2Eq: Number(simCarbon.toFixed(3)),
      },
      {
        category: 'ai_inference',
        count: inferenceCalls,
        energyKwh: Number(inferenceEnergyKwh.toFixed(5)),
        carbonGCo2Eq: Number(infCarbon.toFixed(3)),
      },
      {
        category: 'corpus_indexing',
        count: chunks.length,
        energyKwh: Number(indexingEnergyKwh.toFixed(5)),
        carbonGCo2Eq: Number(idxCarbon.toFixed(3)),
      },
    ],
    recommendations,
    formulaSummary: `E_total = PUE(${region.pue}) * [Sim_hrs * 0.085kW + LLM_calls * 0.0014kWh + Chunks * 0.00012kWh]; CO2eq = E_total * ${region.carbonIntensityGPerKwh} g/kWh; Water = E_total * 1.2 L/kWh`,
    generatedAt: new Date().toISOString(),
  };
}
