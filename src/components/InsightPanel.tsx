import { useTranslation } from 'react-i18next';
import type {
  ResearchResult,
  RetrievedSource,
  SimulationFrame,
  SimulationJobResponse,
  SimulationSummary,
} from '../types';
import EvidencePanel from './EvidencePanel';
import ExportMenu from './ExportMenu';
import ResearchAnswer from './ResearchAnswer';
import SimulationChart from './SimulationChart';

interface Props {
  researchResult: ResearchResult | null;
  sources: RetrievedSource[];
  researchLoading: boolean;
  simulationJob: SimulationJobResponse | null;
  simulationFrames: SimulationFrame[];
  simulationSummary?: SimulationSummary;
}

export default function InsightPanel({
  researchResult,
  sources,
  researchLoading,
  simulationJob,
  simulationFrames,
  simulationSummary,
}: Props) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-100">
          {t('insights.title')}
        </h2>
        <ExportMenu research={researchResult} simulation={simulationJob} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
          <h3 className="text-sm font-semibold text-slate-100 mb-3">
            {t('insights.analysis')}
          </h3>
          <ResearchAnswer result={researchResult} loading={researchLoading} />
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
          <h3 className="text-sm font-semibold text-slate-100 mb-3">
            {t('insights.telemetry')}
          </h3>
          <SimulationChart
            frames={simulationFrames}
            summary={simulationSummary}
            referenceValidation={simulationJob?.referenceValidation}
          />
        </div>
      </div>

      <EvidencePanel sources={sources} />
    </section>
  );
}
