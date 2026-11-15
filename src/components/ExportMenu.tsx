import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ResearchResult, SimulationJobResponse } from '../types';
import {
  buildCsvReport,
  buildJsonReport,
  downloadPdfReport,
  triggerFileDownload,
} from '../utils/exportReport';

interface Props {
  research: ResearchResult | null;
  simulation: SimulationJobResponse | null;
}

export default function ExportMenu({ research, simulation }: Props) {
  const { t } = useTranslation();
  const hasData = Boolean(research || (simulation && simulation.frames.length > 0));

  function handleJsonExport() {
    const json = buildJsonReport(research, simulation);
    triggerFileDownload(
      `intel-report-${Date.now()}.json`,
      json,
      'application/json'
    );
  }

  function handleCsvExport() {
    const csv = buildCsvReport(research, simulation);
    triggerFileDownload(`intel-telemetry-${Date.now()}.csv`, csv, 'text/csv');
  }

  function handlePdfExport() {
    downloadPdfReport(research, simulation);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleJsonExport}
        disabled={!hasData}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg disabled:opacity-40 whitespace-nowrap transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span>{t('insights.exportJson')}</span>
      </button>

      <button
        type="button"
        onClick={handleCsvExport}
        disabled={!hasData}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg disabled:opacity-40 whitespace-nowrap transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span>{t('insights.exportCsv')}</span>
      </button>

      <button
        type="button"
        onClick={handlePdfExport}
        disabled={!hasData}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg disabled:opacity-40 whitespace-nowrap transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span>{t('insights.exportPdf')}</span>
      </button>
    </div>
  );
}
