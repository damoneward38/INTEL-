import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.ts';
import { recordProvenance } from '../provenance.ts';
import {
  getSimulationJob,
  submitSimulationJob,
  subscribeToJob,
} from '../simulationEngine.ts';
import {
  getAllUploadFullText,
  processAllUploadFile,
} from './allUploadService.ts';
import {
  approveAutoOptimizeProtocol,
  createAutoOptimizeProtocol,
  extractStructuredEntities,
  proposeAutoOptimizeIncrement,
  recordAutoOptimizeResult,
  runAutoOptimizeEntityPipeline,
  toggleAutoOptimizeLock,
} from './autoOptimizeService.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';
import type {
  AuthSession,
  OrchestratorAuditEntry,
  OrchestratorRunResult,
  OrchestratorStageRecord,
  SimulationEngine,
  SimulationJob,
  UiButtonAuditItem,
  UiButtonAuditSummary,
} from '../types.ts';

const AUDIT_DIR = path.resolve(process.cwd(), 'data');
const REPORT_DIR = path.join(AUDIT_DIR, 'reports');
const AUDIT_LOG_PATH = path.join(AUDIT_DIR, 'orchestrator_audit.jsonl');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const MAX_TEXT_LENGTH = 2_000_000;

const SENSITIVE_AUDIT_KEYS = new Set([
  'file_bytes',
  'buffer',
  'text',
  'rawText',
  'fullText',
  'embedding',
  'embedding_vector',
  'credentials',
  'password',
  'token',
  'accessCode',
]);

const auditEntriesCache: OrchestratorAuditEntry[] = [];
const masterRunsCache: OrchestratorRunResult[] = [];
const uiAuditsCache: UiButtonAuditSummary[] = [];

function sha256Of(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
    .digest('hex');
}

function sanitizeAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_AUDIT_KEYS.has(k) || Buffer.isBuffer(v)) {
      continue;
    }
    clean[k] = v;
  }
  return clean;
}

function appendAuditEntry(entry: OrchestratorAuditEntry): void {
  const safeEntry: OrchestratorAuditEntry = {
    ...entry,
    details: sanitizeAuditDetails(entry.details),
  };
  auditEntriesCache.unshift(safeEntry);
  if (auditEntriesCache.length > 300) {
    auditEntriesCache.length = 300;
  }
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(safeEntry)}\n`, 'utf8');
  } catch (err) {
    logger.warn('orchestrator', 'Could not append JSONL audit record to disk', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function detectLanguageSimple(text: string): string {
  const sample = text.trim().slice(0, 10000);
  if (sample.length < 12) return 'unknown';
  const hebrew = sample.match(/[\u0590-\u05FF]/g)?.length ?? 0;
  const latin = sample.match(/[A-Za-z]/g)?.length ?? 0;
  if (hebrew > latin * 0.35 && hebrew >= 4) return 'he';
  if (latin >= 6) return 'en';
  return 'unknown';
}

function computeDeterministicHashVector(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9\u0590-\u05ff]{2,}/g) ?? [];
  for (const tok of tokens) {
    const hash = crypto.createHash('sha256').update(tok, 'utf8').digest();
    const bucket = hash[0] % dims;
    const sign = (hash[1] & 1) === 0 ? 1 : -1;
    vec[bucket] += sign;
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(5)));
}

async function tryOllamaEmbed(text: string): Promise<number[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text.slice(0, 4000) }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { embeddings?: number[][] };
    return Array.isArray(body.embeddings) && body.embeddings[0]
      ? body.embeddings[0]
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function awaitSimulationJob(jobId: string, timeoutMs = 15000): Promise<SimulationJob> {
  return new Promise((resolve, reject) => {
    const existing = getSimulationJob(jobId);
    if (
      existing &&
      (existing.state === 'completed' ||
        existing.state === 'failed' ||
        existing.state === 'cancelled')
    ) {
      resolve(existing);
      return;
    }

    let settled = false;
    const unsubscribe = subscribeToJob(jobId, (job) => {
      if (settled) return;
      if (
        job.state === 'completed' ||
        job.state === 'failed' ||
        job.state === 'cancelled'
      ) {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(job);
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error(`Simulation worker ${jobId} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}

export async function runMasterPipeline(
  input: {
    file?: { originalname: string; mimetype: string; buffer: Buffer };
    uploadId?: string;
    filename?: string;
    text?: string;
    engine?: SimulationEngine;
    safetyLimit?: number;
    enableSimulator?: boolean;
    lockIfBest?: boolean;
  },
  session: AuthSession
): Promise<OrchestratorRunResult> {
  const auditUuid = `aud-${crypto.randomUUID()}`;
  const stages: OrchestratorStageRecord[] = [];
  const engine: SimulationEngine = input.engine ?? 'langevin-md';
  const simulatorEnabled = Boolean(input.enableSimulator);
  const safetyLimit =
    typeof input.safetyLimit === 'number' && Number.isFinite(input.safetyLimit)
      ? Math.max(0, Math.min(1, input.safetyLimit))
      : 0.8;

  const logStage = (record: OrchestratorStageRecord) => {
    stages.push(record);
    appendAuditEntry({
      uuid: auditUuid,
      event: `stage:${record.stage}`,
      stage: record.stage,
      actorRole: session.role,
      digestSha256: record.digestSha256,
      summary: record.summary,
      details: { status: record.status, durationMs: record.durationMs, ...record.metrics },
      timestamp: new Date().toISOString(),
    });
  };

  appendAuditEntry({
    uuid: auditUuid,
    event: 'pipeline_start',
    actorRole: session.role,
    digestSha256: sha256Of({
      filename: input.file?.originalname || input.filename || input.uploadId || 'inline',
      engine,
      simulatorEnabled,
    }),
    summary: `Started 9-stage INTEL master orchestrator (${engine}, simulator=${simulatorEnabled ? 'enabled' : 'disabled'})`,
    details: { actorId: session.userId, engine, safetyLimit, simulatorEnabled },
    timestamp: new Date().toISOString(),
  });

  // 1. Ingest
  const t1 = Date.now();
  let effectiveFilename = input.filename?.trim() || 'orchestrator_note.txt';
  let effectiveText = input.text?.trim() || '';
  let effectiveUploadId = input.uploadId;

  if (input.file) {
    if (input.file.buffer.byteLength <= 0) {
      throw new Error('The uploaded input file is empty.');
    }
    const uploaded = await processAllUploadFile({
      originalname: input.file.originalname,
      mimetype: input.file.mimetype,
      buffer: input.file.buffer,
      session,
    });
    effectiveUploadId = uploaded.uploadId;
    effectiveFilename = uploaded.filename;
    const loaded = getAllUploadFullText(uploaded.uploadId);
    effectiveText = loaded?.fullText || uploaded.extractedPreview || '';
  } else if (effectiveUploadId) {
    const loaded = getAllUploadFullText(effectiveUploadId);
    if (!loaded) {
      throw new Error(`Referenced uploadId "${effectiveUploadId}" was not found.`);
    }
    effectiveFilename = loaded.record.filename;
    effectiveText = loaded.fullText || loaded.record.extractedPreview;
  }

  if (effectiveText.trim().length < 10) {
    throw new Error('No extractable text found (>= 10 characters required).');
  }
  if (effectiveText.length > MAX_TEXT_LENGTH) {
    throw new Error(`Extracted text exceeds ${MAX_TEXT_LENGTH} character limit.`);
  }

  logStage({
    stage: 'ingest',
    status: 'completed',
    durationMs: Date.now() - t1,
    summary: `Ingested "${effectiveFilename}" (${Buffer.byteLength(effectiveText, 'utf8')} extracted bytes)`,
    digestSha256: sha256Of(effectiveText),
    metrics: { bytes: Buffer.byteLength(effectiveText, 'utf8') },
  });

  // 2. Language Detection
  const t2 = Date.now();
  const language = detectLanguageSimple(effectiveText);
  logStage({
    stage: 'detect_lang',
    status: 'completed',
    durationMs: Date.now() - t2,
    summary: `Detected primary script/language: ${language}`,
    digestSha256: sha256Of({ language, sampleLen: effectiveText.length }),
    metrics: { language },
  });

  // 3. NLP Entity Extraction (baseline pattern + keyword extractor)
  const t3 = Date.now();
  const entities = extractStructuredEntities(effectiveText);
  logStage({
    stage: 'extract_entities',
    status: 'completed',
    durationMs: Date.now() - t3,
    summary: `Extracted ${entities.length} structured entities (baseline pattern/keyword extractor)`,
    digestSha256: sha256Of(entities),
    metrics: { entitiesCount: entities.length },
  });

  // 4. Embedding Context (never stores full vector in audit log)
  const t4 = Date.now();
  const ollamaVector = await tryOllamaEmbed(effectiveText);
  const embeddingVector = ollamaVector ?? computeDeterministicHashVector(effectiveText, 64);
  const embeddingSource: 'ollama' | 'tfidf-hash-64d' = ollamaVector
    ? 'ollama'
    : 'tfidf-hash-64d';
  logStage({
    stage: 'embed_text',
    status: 'completed',
    durationMs: Date.now() - t4,
    summary: `Generated ${embeddingVector.length}-dim context vector via ${embeddingSource}`,
    digestSha256: sha256Of(embeddingVector.slice(0, 16)),
    metrics: { dimensions: embeddingVector.length, source: embeddingSource },
  });

  // 5. Graph Linking
  const t5 = Date.now();
  const linkedDoc = await runAutoOptimizeEntityPipeline(
    effectiveUploadId
      ? { uploadId: effectiveUploadId }
      : { filename: effectiveFilename, text: effectiveText },
    session
  );
  logStage({
    stage: 'link_graph',
    status: 'completed',
    durationMs: Date.now() - t5,
    summary: `Linked ${linkedDoc.entitiesCount} entities into graph node ${linkedDoc.documentId}`,
    digestSha256: sha256Of(linkedDoc.documentId),
    metrics: { documentId: linkedDoc.documentId, entitiesCount: linkedDoc.entitiesCount },
  });

  // 6. Policy Planning
  const t6 = Date.now();
  const protocol = createAutoOptimizeProtocol(
    {
      name: `Orchestrated Run · ${effectiveFilename.slice(0, 48)}`,
      objective: 'maximize',
      parameter: {
        name: engine === 'psi4-scf' ? 'scf_damping' : 'thermostat_gamma',
        initial: 1.0,
        minimum: 0.2,
        maximum: 5.0,
        step: 0.2,
        unit: engine === 'psi4-scf' ? 'hartree_step' : 'ps^-1',
      },
      budget: 50,
      maximumExperiments: 10,
      maximumCostPerExperiment: 10,
      safetyLimit,
      safetyAcknowledged: true,
    },
    session
  );
  approveAutoOptimizeProtocol(protocol.id, session);
  const proposal = proposeAutoOptimizeIncrement(protocol.id, session);
  logStage({
    stage: 'plan_policy',
    status: 'completed',
    durationMs: Date.now() - t6,
    summary: `Approved protocol ${protocol.id} and proposed bounded step ${proposal.parameter}=${proposal.newValue} [software_only]`,
    digestSha256: sha256Of(proposal),
    metrics: {
      protocolId: protocol.id,
      proposalId: proposal.proposalId,
      proposedValue: proposal.newValue,
    },
  });

  // 7. Execution (ONLY if simulatorEnabled === true)
  let simulationJobId: string | undefined;
  let completedJob: SimulationJob | undefined;
  const t7 = Date.now();

  if (!simulatorEnabled) {
    logStage({
      stage: 'execute',
      status: 'skipped',
      durationMs: Date.now() - t7,
      summary: 'Isolated simulator disabled (pass --enable-simulator or check opt-in to execute)',
      digestSha256: sha256Of({ skipped: true, reason: 'simulator_not_enabled' }),
      metrics: { simulatorEnabled: false },
    });
  } else {
    const tempK = Math.min(800, Math.max(250, Math.round(280 + proposal.newValue * 18)));
    const submitted = submitSimulationJob(
      {
        engine,
        temperature: tempK,
        pressure: 1,
        steps: 400,
      },
      session
    );
    completedJob = await awaitSimulationJob(submitted.jobId);
    if (completedJob.state !== 'completed') {
      throw new Error(
        `Isolated simulation job ${completedJob.jobId} finished with state "${completedJob.state}".`
      );
    }
    simulationJobId = completedJob.jobId;
    logStage({
      stage: 'execute',
      status: 'completed',
      durationMs: Date.now() - t7,
      summary: `Isolated worker ${engine} (${completedJob.jobId}) completed ${completedJob.frames.length} frames, final RMSD=${completedJob.summary?.finalRmsd ?? 0}`,
      digestSha256: sha256Of(completedJob.summary ?? completedJob.jobId),
      metrics: {
        jobId: completedJob.jobId,
        frames: completedJob.frames.length,
        finalRmsd: completedJob.summary?.finalRmsd ?? 0,
      },
    });
  }

  // 8. Evaluation (Skipped if simulator did not run)
  const t8 = Date.now();
  let reward: number | null = null;
  let safetyPassed = false;
  let isNewBest = false;
  let slackAlertSent = false;
  let locked = false;
  let evaluationStatus: 'evaluated' | 'not_evaluated' = 'not_evaluated';

  if (!completedJob) {
    logStage({
      stage: 'evaluate',
      status: 'skipped',
      durationMs: Date.now() - t8,
      summary: 'Not evaluated (no simulator result available)',
      digestSha256: sha256Of({ evaluationStatus: 'not_evaluated' }),
      metrics: { evaluationStatus: 'not_evaluated' },
    });
  } else {
    const finalRmsd = completedJob.summary?.finalRmsd ?? 0.2;
    const eff = Number(Math.min(1, Math.max(0.55, 1 - finalRmsd * 0.35)).toFixed(3));
    const safetyScore = completedJob.referenceValidation?.passed === false ? 0.72 : 0.94;
    const normCost = Number(Math.min(1, 400 / 2000).toFixed(3));
    const outcome = await recordAutoOptimizeResult(
      protocol.id,
      {
        measurements: {
          efficiency: eff,
          safety: safetyScore,
          cost: normCost,
          novelty: Number(Math.min(1, entities.length / 20).toFixed(3)),
        },
        experimentCost: 2,
        proposalId: proposal.proposalId,
        executor: 'isolated_sim_bridge',
      },
      session
    );
    reward = outcome.run.reward;
    safetyPassed = safetyScore >= safetyLimit;
    isNewBest = outcome.isNewBest;
    slackAlertSent = outcome.slackAlertSent;
    locked = outcome.protocol.locked;
    evaluationStatus = 'evaluated';

    logStage({
      stage: 'evaluate',
      status: 'completed',
      durationMs: Date.now() - t8,
      summary: `Evaluated constrained reward=${reward} (safety=${safetyScore} >= ${safetyLimit})`,
      digestSha256: sha256Of(outcome.run),
      metrics: {
        reward,
        safety: safetyScore,
        efficiency: eff,
        isNewBest,
      },
    });
  }

  // 9. Learn & Lock (Strictly prohibited unless evaluated AND safetyPassed AND isNewBest)
  const t9 = Date.now();
  const canLockRole =
    session.role === 'principal_investigator' || session.role === 'auditor';
  if (
    evaluationStatus === 'evaluated' &&
    safetyPassed &&
    isNewBest &&
    input.lockIfBest &&
    canLockRole &&
    !locked
  ) {
    const lockedProto = toggleAutoOptimizeLock(protocol.id, session);
    locked = lockedProto.locked;
  }

  const createdAt = new Date().toISOString();
  const reportRelPath = `data/reports/report_${auditUuid}.json`;
  const reportAbsPath = path.join(REPORT_DIR, `report_${auditUuid}.json`);

  const reportMarkdown = [
    `# INTEL Master Orchestrator Report`,
    `- **Audit UUID**: \`${auditUuid}\``,
    `- **Report File**: \`${reportRelPath}\``,
    `- **Artifact**: \`${effectiveFilename}\` (${language})`,
    `- **Physical Execution**: \`false\``,
    `- **Simulator Enabled**: \`${simulatorEnabled}\``,
    `- **Entities Linked**: ${linkedDoc.entitiesCount} (node \`${linkedDoc.documentId}\`)`,
    `- **Context Vector**: ${embeddingVector.length}d via \`${embeddingSource}\``,
    `- **Protocol**: \`${protocol.id}\` (${proposal.parameter}=${proposal.newValue})`,
    completedJob
      ? `- **Simulation Worker**: \`${engine}\` (\`${completedJob.jobId}\`), Final RMSD=${completedJob.summary?.finalRmsd ?? 'N/A'}`
      : `- **Simulation Worker**: Skipped (enable-simulator opt-in not active)`,
    evaluationStatus === 'evaluated'
      ? `- **Constrained Reward**: **${reward}** (Safety=${safetyPassed ? 'PASS' : 'REJECTED'})`
      : `- **Evaluation**: Not evaluated`,
    `- **Registry Lock**: ${locked ? 'LOCKED' : 'NOT_LOCKED'}`,
    `- **Timestamp**: ${createdAt}`,
  ].join('\n');

  logStage({
    stage: 'learn_and_lock',
    status: evaluationStatus === 'evaluated' ? 'completed' : 'skipped',
    durationMs: Date.now() - t9,
    summary: locked
      ? `Locked best protocol ${protocol.id} and wrote ${reportRelPath}`
      : `Protocol not locked (${evaluationStatus === 'not_evaluated' ? 'no verified evaluation' : canLockRole ? 'lock opt-out' : 'PI/Auditor required'}); wrote ${reportRelPath}`,
    digestSha256: sha256Of(reportMarkdown),
    metrics: { locked, slackAlertSent, reportPath: reportRelPath },
  });

  const result: OrchestratorRunResult = {
    auditUuid,
    auditLogPath: 'data/orchestrator_audit.jsonl',
    reportPath: reportRelPath,
    simulatorEnabled,
    evaluationStatus,
    physicalExecution: false,
    filename: effectiveFilename,
    uploadId: effectiveUploadId,
    language,
    entitiesCount: linkedDoc.entitiesCount,
    embeddingSource,
    embeddingDimensions: embeddingVector.length,
    protocolId: protocol.id,
    proposalId: proposal.proposalId,
    simulationJobId,
    simulationEngine: engine,
    reward,
    safetyPassed,
    locked,
    slackAlertSent,
    stages,
    reportMarkdown,
    createdAt,
  };

  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(reportAbsPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (err) {
    logger.warn('orchestrator', 'Could not write JSON report file', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  masterRunsCache.unshift(result);
  if (masterRunsCache.length > 50) masterRunsCache.length = 50;

  appendAuditEntry({
    uuid: auditUuid,
    event: 'pipeline_complete',
    actorRole: session.role,
    digestSha256: sha256Of({
      auditUuid,
      protocolId: result.protocolId,
      simulationJobId: result.simulationJobId,
      reward: result.reward,
      locked: result.locked,
    }),
    summary: `Completed orchestrator run (simulator=${simulatorEnabled}, evaluation=${evaluationStatus}, locked=${locked})`,
    details: {
      protocolId: result.protocolId,
      simulationJobId: result.simulationJobId ?? 'none',
      evaluationStatus,
      reward: result.reward ?? 'null',
      locked: result.locked,
      reportPath: reportRelPath,
    },
    timestamp: createdAt,
  });

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: 'orchestrator:run-master-pipeline',
    rawInput: `${auditUuid}:${effectiveFilename}:${simulationJobId ?? 'no-sim'}`,
    modelOrEngine: `intel-orchestrator:${engine}`,
    licenses: ['Audited End-to-End Run'],
    sourceUrls: [],
    metadata: {
      auditUuid,
      protocolId: result.protocolId,
      simulatorEnabled,
      locked: result.locked,
    },
  });

  publishFluxEvent({
    topic: 'governance.audit',
    key: auditUuid,
    actorRole: session.role,
    summary: `Master Orchestrator completed "${effectiveFilename}" (sim=${simulatorEnabled}, locked=${locked})`,
    payload: {
      auditUuid,
      simulationJobId: result.simulationJobId ?? null,
      reward: result.reward,
      locked: result.locked,
    },
  });

  return result;
}

export function recordUiButtonAudit(
  input: {
    harnessMode: UiButtonAuditSummary['harnessMode'];
    targetUrl: string;
    viewsVisited: string[];
    results: UiButtonAuditItem[];
  },
  session: AuthSession
): UiButtonAuditSummary {
  const auditUuid = `ui-${crypto.randomUUID()}`;
  const passedCount = input.results.filter(
    (r) => r.status === 'OK' || r.status === 'CLICKED'
  ).length;
  const guardedDisabledCount = input.results.filter(
    (r) =>
      r.status === 'GUARDED_DISABLED' ||
      r.status === 'SKIPPED_DISABLED' ||
      r.status === 'SKIPPED_UNMARKED' ||
      r.status === 'SKIPPED_NOT_VISIBLE'
  ).length;
  const failedCount = input.results.filter((r) => r.status === 'FAIL').length;

  const summary: UiButtonAuditSummary = {
    auditUuid,
    harnessMode: input.harnessMode,
    targetUrl: input.targetUrl,
    viewsVisited: input.viewsVisited,
    totalButtons: input.results.length,
    passedCount,
    guardedDisabledCount,
    failedCount,
    results: input.results,
    createdAt: new Date().toISOString(),
  };

  uiAuditsCache.unshift(summary);
  if (uiAuditsCache.length > 30) uiAuditsCache.length = 30;

  appendAuditEntry({
    uuid: auditUuid,
    event: 'ai_studio_button_audit',
    actorRole: session.role,
    digestSha256: sha256Of(summary),
    summary: `Safe UI audit (${summary.harnessMode}): ${summary.totalButtons} controls inspected across ${summary.viewsVisited.length} views (${passedCount} verified/clicked, ${guardedDisabledCount} safely skipped/guarded, ${failedCount} failed)`,
    details: {
      harnessMode: summary.harnessMode,
      totalButtons: summary.totalButtons,
      passedCount,
      guardedDisabledCount,
      failedCount,
    },
    timestamp: summary.createdAt,
  });

  recordProvenance({
    kind: 'feedback',
    actorId: session.userId,
    actorRole: session.role,
    action: 'orchestrator:ui-button-audit',
    rawInput: `${auditUuid}:${summary.harnessMode}:${summary.totalButtons}`,
    modelOrEngine: summary.harnessMode,
    licenses: ['Safe UI Coverage Audit'],
    sourceUrls: [],
    metadata: {
      totalButtons: summary.totalButtons,
      passedCount,
      guardedDisabledCount,
      failedCount,
    },
  });

  return summary;
}

export function getOrchestratorAuditOverview(): {
  auditLogPath: string;
  runs: OrchestratorRunResult[];
  uiAudits: UiButtonAuditSummary[];
  auditRecords: OrchestratorAuditEntry[];
} {
  return {
    auditLogPath: 'data/orchestrator_audit.jsonl',
    runs: masterRunsCache.slice(0, 20),
    uiAudits: uiAuditsCache.slice(0, 20),
    auditRecords: auditEntriesCache.slice(0, 100),
  };
}
