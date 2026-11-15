import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import he from '../src/i18n/he.json';
import {
  buildCsvReport,
  buildJsonReport,
  buildPdfReportBytes,
} from '../src/utils/exportReport';
import type { ResearchResult, SimulationJobResponse } from '../src/types';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}

describe('Bilingual i18n Dictionaries', () => {
  it('maintains identical key parity between English and Hebrew locales', () => {
    const enKeys = collectKeys(en as Record<string, unknown>);
    const heKeys = collectKeys(he as Record<string, unknown>);
    expect(enKeys).toEqual(heKeys);
  });
});

describe('JSON, CSV, and PDF Scientific Report Exporters', () => {
  const mockResearch: ResearchResult = {
    provenanceId: 'prov-1234',
    query: 'Thermostat stability',
    language: 'en',
    depth: 'standard',
    model: 'gemini-4-hydrogen',
    answer: 'Langevin thermostat maintains canonical ensemble.',
    sources: [
      {
        id: 'doc-1-c1',
        title: 'OpenMM 8',
        license: 'MIT',
        sourceUrl: 'https://openmm.org',
        text: 'Excerpt',
        score: 0.91,
        origin: 'indexed_corpus',
      },
    ],
    corpusHits: 1,
    webHits: 0,
    durationMs: 250,
    reviewStatus: 'pending_human_review',
    createdAt: '2026-11-15T00:00:00.000Z',
  };

  const mockSim: SimulationJobResponse = {
    jobId: 'sim-abcd',
    engine: 'langevin-md',
    state: 'completed',
    progress: 100,
    parameters: { engine: 'langevin-md', temperature: 300, pressure: 1, steps: 200 },
    frames: [
      {
        step: 100,
        timePs: 0.2,
        kineticEnergy: 12.5,
        potentialEnergy: -45.2,
        totalEnergy: -32.7,
        temperatureInst: 299.4,
        pressureInst: 1.02,
        rmsd: 0.0412,
      },
    ],
    particles: [[0.1, -0.2, 0.3]],
  };

  it('produces valid JSON, CSV, and PDF telemetry exports', () => {
    const jsonText = buildJsonReport(mockResearch, mockSim);
    const parsed = JSON.parse(jsonText);
    expect(parsed.research.provenanceId).toBe('prov-1234');
    expect(parsed.simulation.jobId).toBe('sim-abcd');

    const csvText = buildCsvReport(mockResearch, mockSim);
    expect(csvText).toContain('simulation_frame,100,0.2,12.5,-45.2,-32.7,299.4,1.02,0.0412');
    expect(csvText).toContain('research_source,doc-1-c1,indexed_corpus,OpenMM 8,MIT,0.91,https://openmm.org');

    const pdfBytes = buildPdfReportBytes(mockResearch, mockSim);
    const pdfHeader = new TextDecoder().decode(new Uint8Array(pdfBytes).slice(0, 5));
    expect(pdfHeader).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);
  });
});

