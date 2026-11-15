import crypto from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import { extractText as extractPdfText } from 'unpdf';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from '@google/genai';
import { ingestDocument } from '../corpusIndex.ts';
import { inferLicensePolicy } from '../governance.ts';
import { logger } from '../logger.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';
import { recordProvenance } from '../provenance.ts';
import type {
  AllUploadAnalysis,
  AllUploadArchiveSummary,
  AllUploadCapabilities,
  AllUploadCsvProfile,
  AllUploadFlag,
  AllUploadPlanResponse,
  AllUploadRecommendation,
  AllUploadRecord,
  AuthSession,
  CorpusChunk,
  SimulationEngine,
} from '../types.ts';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_ARCHIVE_FILES = 2000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 500 * 1024 * 1024; // 500 MB

export const ALLOWED_EXTENSIONS = new Set<string>([
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.xlsx',
  '.xls',
  '.json',
  '.ipynb',
  '.zip',
  '.pdb',
  '.cif',
  '.fasta',
  '.fa',
  '.fastq',
  '.fq',
  '.sdf',
  '.mol',
  '.xyz',
  '.py',
  '.r',
  '.js',
  '.ts',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_EXTENSIONS = new Set<string>([
  '.txt',
  '.md',
  '.py',
  '.r',
  '.js',
  '.ts',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
  '.pdb',
  '.cif',
  '.fasta',
  '.fa',
  '.fastq',
  '.fq',
  '.sdf',
  '.mol',
  '.xyz',
]);

const uploadHistory: Array<{ record: AllUploadRecord; fullText: string }> = [];
const MAX_UPLOAD_HISTORY = 100;

export class AllUploadError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function sanitizeFilename(rawName: string): string {
  const base = path.basename(rawName || 'upload.bin');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
  return cleaned || 'upload.bin';
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function inspectDelimitedTable(
  text: string,
  delimiter = ','
): AllUploadCsvProfile {
  try {
    const lines = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return {
        rows: 0,
        columns: 0,
        columnNames: [],
        missingCells: 0,
        missingFraction: 0,
        duplicateRows: 0,
      };
    }

    const header = parseDelimitedLine(lines[0], delimiter).map((c) => c.trim());
    const colCount = header.length;
    const dataLines = lines.slice(1, 10001);

    let missingCells = 0;
    let duplicateRows = 0;
    const seenRows = new Set<string>();

    for (const rawLine of dataLines) {
      const parsed = parseDelimitedLine(rawLine, delimiter);
      const normalizedCells: string[] = [];
      for (let i = 0; i < colCount; i++) {
        const val = (parsed[i] ?? '').trim();
        normalizedCells.push(val);
        if (
          val === '' ||
          val.toLowerCase() === 'na' ||
          val.toLowerCase() === 'nan' ||
          val.toLowerCase() === 'null'
        ) {
          missingCells++;
        }
      }
      const key = JSON.stringify(normalizedCells);
      if (seenRows.has(key)) {
        duplicateRows++;
      } else {
        seenRows.add(key);
      }
    }

    const totalCells = dataLines.length * colCount;
    return {
      rows: dataLines.length,
      columns: colCount,
      columnNames: header,
      missingCells,
      missingFraction: totalCells > 0 ? Number((missingCells / totalCells).toFixed(4)) : 0,
      duplicateRows,
    };
  } catch (err) {
    return {
      rows: 0,
      columns: 0,
      columnNames: [],
      missingCells: 0,
      missingFraction: 0,
      duplicateRows: 0,
      inspectionError: err instanceof Error ? err.message : 'Failed to parse delimited table.',
    };
  }
}

export function analyzeScientificText(
  text: string,
  extension: string
): AllUploadAnalysis {
  const words = text.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  const lower = text.toLowerCase();

  const checks: Record<string, string[]> = {
    sample_size: ['sample size', 'participants', 'subjects', 'cohort', 'n =', 'גודל מדגם', 'נבדקים'],
    randomization: ['randomized', 'randomised', 'randomization', 'randomisation', 'רנדומיזציה', 'אקראי'],
    blinding: ['blinded', 'blind', 'double-blind', 'double blind', 'סמיות'],
    controls: ['control group', 'control condition', 'placebo', 'negative control', 'קבוצת ביקורת', 'ביקורת'],
    limitations: ['limitations', 'limitation', 'study limitations', 'מגבלות'],
    ethics: ['irb', 'ethics approval', 'ethical approval', 'informed consent', 'אישור אתי', 'הסכמה מדעת'],
    statistics: ['confidence interval', 'p-value', 'p value', 'standard deviation', 'רווח בר-סמך', 'מובהקות'],
    preregistration: ['preregistered', 'pre-registered', 'clinicaltrials.gov', 'osf.io', 'רישום מראש'],
  };

  const detectedSections: Record<string, boolean> = {};
  for (const [key, terms] of Object.entries(checks)) {
    detectedSections[key] = terms.some((term) => lower.includes(term));
  }

  const flags: AllUploadFlag[] = [];
  for (const [key, present] of Object.entries(detectedSections)) {
    if (!present) {
      flags.push({
        code: `NOT_DETECTED_${key.toUpperCase()}`,
        severity: 'review',
        message: `No explicit ${key.replace('_', ' ')} information detected. This may be absent or expressed differently.`,
      });
    }
  }

  const recommendations: AllUploadRecommendation[] = [];
  if (!detectedSections.controls) {
    recommendations.push({
      category: 'design',
      priority: 'high',
      action:
        'Review whether suitable control conditions are needed and scientifically justified.',
    });
  }
  if (!detectedSections.statistics) {
    recommendations.push({
      category: 'analysis',
      priority: 'medium',
      action:
        'Document the statistical methods, uncertainty estimates, and analysis assumptions.',
    });
  }
  if (!detectedSections.limitations) {
    recommendations.push({
      category: 'reporting',
      priority: 'medium',
      action:
        'Add a limitations section describing bias, uncertainty, and generalizability.',
    });
  }
  if (!detectedSections.ethics) {
    recommendations.push({
      category: 'ethics',
      priority: 'high',
      action:
        'Have an appropriate human reviewer verify whether ethics approval, consent, or an exemption applies.',
    });
  }

  const detectedCount = Object.values(detectedSections).filter(Boolean).length;
  const score = Math.round((100 * detectedCount) / Object.keys(detectedSections).length);

  let dataProfile: AllUploadCsvProfile | null = null;
  if (extension === '.csv') {
    dataProfile = inspectDelimitedTable(text, ',');
  } else if (extension === '.tsv') {
    dataProfile = inspectDelimitedTable(text, '\t');
  } else if (extension === '.xlsx' || extension === '.xls') {
    // Extracted sheet text uses CSV format after `## SheetName`
    const firstSheetCsv = text.replace(/^##[^\n]*\n/, '').split(/\n\n## /)[0] || '';
    dataProfile = inspectDelimitedTable(firstSheetCsv, ',');
  }

  let domainHint = 'General Scientific Research';
  let suggestedSimEngine: SimulationEngine | undefined;
  if (['.pdb', '.cif', '.xyz', '.sdf', '.mol'].includes(extension)) {
    domainHint = 'Structural Biology / Molecular Mechanics';
    suggestedSimEngine = 'langevin-md';
  } else if (['.fasta', '.fa', '.fastq', '.fq'].includes(extension)) {
    domainHint = 'Genomics & Sequence Alignment';
    suggestedSimEngine = 'blast-align';
  } else if (lower.includes('hartree-fock') || lower.includes('basis set') || lower.includes('dft')) {
    domainHint = 'Quantum Chemistry';
    suggestedSimEngine = 'psi4-scf';
  } else if (['.csv', '.tsv', '.xlsx', '.xls'].includes(extension)) {
    domainHint = 'Tabular Empirical Dataset';
  }

  return {
    wordCount: words.length,
    characterCount: text.length,
    detectedSections,
    heuristicCompletenessScore: score,
    scoreWarning:
      'This is a keyword-based completeness indicator, not a scientific validity or publication-readiness score.',
    flags,
    recommendations,
    dataProfile,
    domainHint,
    suggestedSimEngine,
  };
}

function inspectZipArchive(buffer: Buffer): {
  archive: AllUploadArchiveSummary;
  combinedText: string;
} {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new AllUploadError(400, 'Invalid ZIP archive.');
  }

  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_FILES) {
    throw new AllUploadError(413, 'Archive contains too many files.');
  }

  let totalExpandedBytes = 0;
  const files: Array<{ path: string; bytes: number }> = [];
  const textSnippets: string[] = [];

  for (const entry of entries) {
    const rawEntryName = entry.entryName.replace(/\\/g, '/');
    const normalized = path.posix.normalize(rawEntryName);

    if (
      rawEntryName.startsWith('/') ||
      /^[A-Za-z]:/.test(rawEntryName) ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      rawEntryName.split('/').includes('..')
    ) {
      throw new AllUploadError(400, 'Unsafe archive path detected.');
    }

    if (entry.isDirectory) continue;

    const declaredSize = entry.header?.size ?? 0;
    totalExpandedBytes += declaredSize;
    if (totalExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new AllUploadError(413, 'Expanded archive exceeds size limit.');
    }

    const ext = path.extname(normalized).toLowerCase();
    files.push({ path: normalized, bytes: declaredSize });

    if (
      textSnippets.length < 6 &&
      declaredSize <= 250_000 &&
      (TEXT_EXTENSIONS.has(ext) || ext === '.csv' || ext === '.tsv' || ext === '.json')
    ) {
      try {
        const content = entry.getData().toString('utf8').slice(0, 2000);
        textSnippets.push(`### ${normalized}\n${content}`);
      } catch {
        // Ignore unreadable member
      }
    }
  }

  return {
    archive: {
      archiveFileCount: files.length,
      expandedBytes: totalExpandedBytes,
      files: files.slice(0, 250),
    },
    combinedText: textSnippets.join('\n\n'),
  };
}

async function extractBufferText(buffer: Buffer, extension: string): Promise<string> {
  if (extension === '.pdf') {
    const result = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
    return typeof result.text === 'string' ? result.text : '';
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      return `## ${sheetName}\n${csv.split('\n').slice(0, 10000).join('\n')}`;
    }).join('\n\n');
  }

  if (extension === '.json' || extension === '.ipynb') {
    const raw = buffer.toString('utf8');
    const parsed = JSON.parse(raw) as {
      cells?: Array<{ source?: string | string[] }>;
    };
    if (extension === '.ipynb' && Array.isArray(parsed.cells)) {
      return parsed.cells
        .map((cell) =>
          Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '')
        )
        .join('\n\n');
    }
    return JSON.stringify(parsed, null, 2);
  }

  if (extension === '.csv' || extension === '.tsv' || TEXT_EXTENSIONS.has(extension)) {
    return buffer.toString('utf8');
  }

  return '';
}

export async function processAllUploadFile(params: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  session: AuthSession;
}): Promise<AllUploadRecord> {
  const filename = sanitizeFilename(params.originalname);
  const extension = path.extname(filename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new AllUploadError(415, `Unsupported file extension: ${extension || '(none)'}`);
  }

  if (params.buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new AllUploadError(413, 'File exceeds 100 MB limit.');
  }

  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const uploadId = `upl-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  let record: AllUploadRecord;
  let fullText = '';

  if (extension === '.zip') {
    const { archive, combinedText } = inspectZipArchive(params.buffer);
    fullText = combinedText;
    record = {
      uploadId,
      filename,
      extension,
      mimeType: params.mimetype || 'application/zip',
      sizeBytes: params.buffer.byteLength,
      sha256,
      storage: 'local',
      analysisStatus: 'archive_extracted_review_required',
      extractedTextBytes: Buffer.byteLength(combinedText, 'utf8'),
      extractedPreview: combinedText.slice(0, 3500),
      archive,
      analysis: combinedText.trim()
        ? analyzeScientificText(combinedText, '.txt')
        : undefined,
      uploadedBy: params.session.userId,
      createdAt: now,
    };
  } else {
    try {
      fullText = await extractBufferText(params.buffer, extension);
    } catch (err) {
      throw new AllUploadError(
        422,
        `File processing failed: ${err instanceof Error ? err.message : 'Parser error'}`
      );
    }

    const analysis = analyzeScientificText(fullText, extension);
    record = {
      uploadId,
      filename,
      extension,
      mimeType: params.mimetype || 'application/octet-stream',
      sizeBytes: params.buffer.byteLength,
      sha256,
      storage: 'local',
      analysisStatus: 'completed',
      extractedTextBytes: Buffer.byteLength(fullText, 'utf8'),
      extractedPreview: fullText.slice(0, 3500),
      analysis,
      uploadedBy: params.session.userId,
      createdAt: now,
    };
  }

  uploadHistory.unshift({ record, fullText });
  if (uploadHistory.length > MAX_UPLOAD_HISTORY) {
    uploadHistory.length = MAX_UPLOAD_HISTORY;
  }

  recordProvenance({
    kind: 'corpus_ingest',
    actorId: params.session.userId,
    actorRole: params.session.role,
    action: 'all-upload:process',
    rawInput: `${filename}:${sha256}:${fullText.slice(0, 2000)}`,
    modelOrEngine: `all-upload-${extension.slice(1) || 'bin'}`,
    licenses: ['User-Uploaded Artifact (Pending Verification)'],
    sourceUrls: [],
    metadata: {
      uploadId,
      filename,
      sizeBytes: params.buffer.byteLength,
      sha256,
      heuristicScore: record.analysis?.heuristicCompletenessScore ?? -1,
    },
  });

  publishFluxEvent({
    topic: 'knowledge.ingested',
    key: uploadId,
    actorRole: params.session.role,
    summary: `All-Upload processed ${filename} (${params.buffer.byteLength} bytes, SHA-256 ${sha256.slice(0, 12)})`,
    payload: {
      uploadId,
      filename,
      extension,
      sizeBytes: params.buffer.byteLength,
      sha256,
    },
  });

  logger.info('all-upload', 'Processed scientific upload', {
    uploadId,
    filename,
    extension,
    sizeBytes: params.buffer.byteLength,
  });

  return record;
}

export function listAllUploads(limit = 30): AllUploadRecord[] {
  return uploadHistory.slice(0, limit).map((item) => item.record);
}

export function getAllUploadFullText(uploadId: string): {
  record: AllUploadRecord;
  fullText: string;
} | null {
  return uploadHistory.find((item) => item.record.uploadId === uploadId) ?? null;
}

export async function createAllUploadPlan(
  params: {
    researchQuestion: string;
    domain: string;
    context: string;
    uploadId?: string;
    useGemini?: boolean;
  },
  session: AuthSession
): Promise<AllUploadPlanResponse> {
  let effectiveContext = params.context.trim();
  if (!effectiveContext && params.uploadId) {
    const found = getAllUploadFullText(params.uploadId);
    if (found) {
      effectiveContext = found.fullText.slice(0, 8000);
    }
  }

  const baseSteps = [
    {
      stage: 'hypothesis',
      action: 'Define a testable hypothesis and primary outcome.',
    },
    {
      stage: 'data',
      action:
        'Identify data provenance, inclusion criteria, missingness, and permissions.',
    },
    {
      stage: 'design',
      action:
        'Review controls, sample-size rationale, randomization, and bias risks.',
    },
    {
      stage: 'analysis',
      action: 'Predefine statistical methods and sensitivity analyses.',
    },
    {
      stage: 'validation',
      action: 'Validate results independently and document uncertainty.',
    },
    {
      stage: 'reporting',
      action:
        'Prepare a transparent report with reproducible methods and citations.',
    },
  ];

  let groundedSynthesis: string | undefined;
  let modelUsed: AllUploadPlanResponse['modelUsed'] = 'deterministic';

  if (params.useGemini && process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a scientific methodology advisor. Given this research question, domain, and uploaded artifact excerpt, provide concise, factual experimental planning improvements (max 5 bullet points, explicitly noting any assumptions).\nDomain: ${params.domain}\nQuestion: ${params.researchQuestion}\nExcerpt:\n${effectiveContext.slice(0, 4000)}`,
      });
      if (response.text) {
        groundedSynthesis = response.text.trim();
        modelUsed = 'gemini-4-hydrogen';
      }
    } catch (err) {
      logger.warn('all-upload', 'Optional Gemini plan synthesis unavailable, returning deterministic plan', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: 'all-upload:plan',
    rawInput: `${params.domain}:${params.researchQuestion}`,
    modelOrEngine: modelUsed,
    licenses: ['Draft Plan — Expert Review Required'],
    sourceUrls: [],
  });

  return {
    researchQuestion: params.researchQuestion,
    domain: params.domain,
    status: 'draft_requires_expert_review',
    steps: baseSteps,
    groundedSynthesis,
    modelUsed,
    contextReceived: Boolean(effectiveContext),
    executionEnabled: false,
    createdAt: new Date().toISOString(),
  };
}

export function indexUploadedArtifactToCorpus(
  params: {
    uploadId: string;
    title: string;
    authors: string;
    domain: string;
    license: string;
    sourceUrl: string;
  },
  session: AuthSession
): { chunks: CorpusChunk[]; provenanceId: string } {
  const found = getAllUploadFullText(params.uploadId);
  if (!found) {
    throw new AllUploadError(404, 'Uploaded file session not found.');
  }
  const content = found.fullText.trim();
  if (content.length < 20) {
    throw new AllUploadError(
      400,
      'Extracted text is too short (< 20 characters) to index safely.'
    );
  }

  const inferred = inferLicensePolicy(params.license);
  if (params.license.toLowerCase().includes('proprietary') || params.license.toLowerCase().includes('all rights reserved')) {
    throw new AllUploadError(
      400,
      'Proprietary or All-Rights-Reserved files cannot be indexed into the shared RAG corpus.'
    );
  }

  const created = ingestDocument({
    source: `all-upload:${found.record.extension.slice(1) || 'file'}`,
    title: params.title,
    authors: params.authors,
    domain: params.domain,
    license: params.license,
    sourceUrl: params.sourceUrl,
    content: content.slice(0, 20000),
    verified: inferred.verifiedByDefault,
    commercialUseAllowed: inferred.commercialUseAllowed,
    trainingAllowed: inferred.trainingAllowed,
  });

  found.record.indexedDocId = created[0]?.docId;

  const prov = recordProvenance({
    kind: 'corpus_ingest',
    actorId: session.userId,
    actorRole: session.role,
    action: 'all-upload:index-corpus',
    rawInput: `${params.uploadId}:${params.title}`,
    modelOrEngine: 'tfidf-vector-indexer',
    licenses: [params.license],
    sourceUrls: [params.sourceUrl],
    metadata: {
      uploadId: params.uploadId,
      sha256: found.record.sha256,
      chunksCreated: created.length,
    },
  });

  return { chunks: created, provenanceId: prov.id };
}

export function getAllUploadCapabilities(): AllUploadCapabilities {
  return {
    allowedExtensions: Array.from(ALLOWED_EXTENSIONS),
    maxFileBytes: MAX_UPLOAD_BYTES,
    maxArchiveFiles: MAX_ARCHIVE_FILES,
    maxArchiveExpandedBytes: MAX_ARCHIVE_EXPANDED_BYTES,
    ingest: [
      'PDF text extraction (unpdf)',
      'DOCX text extraction (mammoth)',
      'CSV and TSV profiling (missingness + duplicate detection)',
      'XLSX and XLS multi-sheet workbook extraction',
      'JSON and Jupyter notebook (.ipynb) cell extraction',
      'ZIP archive inspection with traversal and expansion guardrails',
      'Plain text, R/Python/TS/JS code, and bioinformatics formats (.pdb, .cif, .fasta, .fastq, .sdf, .mol, .xyz)',
    ],
    analysis: [
      'Heuristic methodology completeness review (with non-validity disclaimer)',
      'Tabular missing-data & duplicate-row profiling',
      'Review flags and prioritized study recommendations',
      'SHA-256 cryptographic integrity hashing',
      'Provenance ledger & Knowledge Flux event emission',
      'Direct one-click hand-off into INTEL RAG Corpus or MD/SCF/BLAST Simulation',
    ],
    integratedIntelCapabilities: [
      'Gemini 4 Hydrogen grounded synthesis & research planning',
      'Hybrid TF-IDF + reranker RAG corpus indexing with SPDX gates',
      'Isolated worker simulations (Langevin MD, Verlet NVE, Psi4 SCF, BLAST Align)',
      'Three.js 3D spatial lattice & narrative timeline',
      'AES-256-GCM Pharmacogenomics Vault & HMAC-SHA256 RBAC sessions',
    ],
    notYetIntegrated: [
      'OCR engine for scanned image-only PDFs',
      'BioBERT and SciSpaCy NER models',
      'External Neo4j graph DB & live Stripe/K8s billing cluster',
      'Production clamav malware scanning daemon',
      'Clinical decision support validation',
    ],
    safety: {
      medicalDecisions: 'Not supported',
      automatedExperimentExecution: 'Disabled (explicit human trigger required)',
      humanReviewRequired: true,
    },
  };
}
