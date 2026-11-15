import { jsPDF } from 'jspdf';
import type { ResearchResult, SimulationJobResponse } from '../types';

export function buildJsonReport(
  research: ResearchResult | null,
  simulation: SimulationJobResponse | null
): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      platform: 'INTEL Research Intelligence',
      research,
      simulation,
    },
    null,
    2
  );
}

function escapeCsvCell(value: string | number | undefined): string {
  const str = value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvReport(
  research: ResearchResult | null,
  simulation: SimulationJobResponse | null
): string {
  const lines: string[] = [];

  if (simulation && simulation.frames.length > 0) {
    lines.push(
      'section,step,time_ps,kinetic_kj_mol,potential_kj_mol,total_kj_mol,temp_k,pressure_atm,rmsd_nm'
    );
    for (const f of simulation.frames) {
      lines.push(
        [
          'simulation_frame',
          f.step,
          f.timePs,
          f.kineticEnergy,
          f.potentialEnergy,
          f.totalEnergy,
          f.temperatureInst,
          f.pressureInst,
          f.rmsd,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  if (research) {
    if (lines.length > 0) lines.push('');
    lines.push('section,id,origin,title,license,score,source_url');
    for (const src of research.sources) {
      lines.push(
        [
          'research_source',
          src.id,
          src.origin,
          src.title,
          src.license,
          src.score,
          src.sourceUrl,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  if (lines.length === 0) {
    lines.push('section,status');
    lines.push('export,no_research_or_simulation_data');
  }

  return lines.join('\n');
}

export function buildPdfReportBytes(
  research: ResearchResult | null,
  simulation: SimulationJobResponse | null
): ArrayBuffer {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 48;

  const writeSection = (heading: string, body: string) => {
    if (y > 750) {
      pdf.addPage();
      y = 48;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(heading, 46, y);
    y += 16;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const wrapped = pdf.splitTextToSize(body, 500) as string[];
    for (const line of wrapped) {
      if (y > 780) {
        pdf.addPage();
        y = 48;
      }
      pdf.text(line, 46, y);
      y += 14;
    }
    y += 10;
  };

  writeSection(
    'INTEL Research Intelligence Report',
    `Generated: ${new Date().toISOString()}`
  );

  if (research) {
    writeSection(`Research Query (${research.model})`, research.query);
    writeSection('Grounded Synthesis', research.answer);
    if (research.sources.length > 0) {
      writeSection(
        'Verified Sources',
        research.sources
          .map((s, idx) => `${idx + 1}. ${s.title} [${s.license}] (${s.sourceUrl})`)
          .join('\n')
      );
    }
  }

  if (simulation) {
    writeSection(
      `Simulation Telemetry (${simulation.engine})`,
      [
        `Job ID: ${simulation.jobId} | State: ${simulation.state}`,
        simulation.summary
          ? `Mean Temp: ${simulation.summary.meanTempK} K | Mean Pressure: ${simulation.summary.meanPressureAtm} atm | Final RMSD: ${simulation.summary.finalRmsd}`
          : 'Summary pending',
        simulation.referenceValidation
          ? `Benchmark (${simulation.referenceValidation.benchmarkName}): ${simulation.referenceValidation.observedValue} (${simulation.referenceValidation.passed ? 'PASS' : 'DRIFT'})`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return pdf.output('arraybuffer');
}

export function downloadPdfReport(
  research: ResearchResult | null,
  simulation: SimulationJobResponse | null
): void {
  const bytes = buildPdfReportBytes(research, simulation);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `intel-report-${Date.now()}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function triggerFileDownload(
  filename: string,
  content: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

