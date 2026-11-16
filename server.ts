import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  attachSession,
  authenticateCredentials,
  DIRECTORY_USERS,
  registerAccount,
  requireRole,
  signSessionToken,
  type AuthenticatedRequest,
} from './server/auth.ts';
import {
  getCorpusDomains,
  ingestDocument,
  initializeCorpus,
  listCorpusChunks,
  searchCorpus,
} from './server/corpusIndex.ts';
import { listFeedback, saveFeedback } from './server/feedbackStore.ts';
import { listLicenseRecords, verifyLicenseRecord } from './server/governance.ts';
import { runExternalIngestion } from './server/ingestionService.ts';
import { logger } from './server/logger.ts';
import { listProvenance, recordProvenance } from './server/provenance.ts';
import { runResearchChat, runResearchQuery } from './server/researchService.ts';
import {
  cancelSimulationJob,
  getSimulationJob,
  listSimulationJobs,
  submitSimulationJob,
  subscribeToJob,
} from './server/simulationEngine.ts';
import {
  getFluxStats,
  listFluxEvents,
  subscribeToFlux,
} from './server/modules/knowledgeFlux.ts';
import {
  applySandboxYjsUpdate,
  createSandboxSnapshot,
  getSandboxStateBase64,
  registerSandboxPeer,
  removeSandboxPeer,
  restoreSandboxSnapshot,
} from './server/modules/sandboxService.ts';
import {
  generateThoughtPrototype,
  listThoughtPrototypes,
  probeOllamaGateway,
} from './server/modules/thoughtPrototypes.ts';
import {
  analyzePgxSample,
  listPgxSamples,
  revokePgxConsent,
  storeEncryptedPgxSample,
} from './server/modules/pgxVault.ts';
import { buildNarrativeTimeline } from './server/modules/narrativeService.ts';
import { ECO_REGIONS, generateEcoAuditReport } from './server/modules/ecoAuditor.ts';
import {
  acquireMarketDataset,
  listMarketDatasets,
  listMarketTransactions,
  publishMarketDataset,
} from './server/modules/openDataMarket.ts';
import { generateGrantDraft, listGrantDrafts } from './server/modules/grantService.ts';
import {
  addMentorMemoryNote,
  clearAllMentorMemory,
  deleteMentorMemoryNote,
  evaluatePredictiveRisks,
  getMentorMemory,
  setMentorMemoryEnabled,
} from './server/modules/aiMentor.ts';
import multer from 'multer';
import {
  AllUploadError,
  MAX_UPLOAD_BYTES,
  createAllUploadPlan,
  getAllUploadCapabilities,
  indexUploadedArtifactToCorpus,
  listAllUploads,
  processAllUploadFile,
} from './server/modules/allUploadService.ts';
import {
  CommercialSuiteError,
  assertQuotaAvailable,
  calculateEnterpriseQuote,
  consumeSimulationQuota,
  createCheckoutOrder,
  getEnterpriseOverview,
  getQuotaStatus,
  gradeSubmissionWithRubric,
  settlePartnerPayout,
  toggleLaunchChecklistItem,
  updateActiveQuotaTier,
  updateBrandConfig,
} from './server/modules/commercialSuite.ts';
import {
  AutoOptimizeError,
  approveAutoOptimizeProtocol,
  createAutoOptimizeProtocol,
  getAutoOptimizeProtocol,
  getAutoOptimizeStatus,
  listAutoOptimizeProtocols,
  proposeAutoOptimizeIncrement,
  recordAutoOptimizeResult,
  runAutoOptimizeEntityPipeline,
  searchAutoOptimizeGraph,
  toggleAutoOptimizeLock,
} from './server/modules/autoOptimizeService.ts';
import {
  getOrchestratorAuditOverview,
  recordUiButtonAudit,
  runMasterPipeline,
} from './server/modules/orchestratorService.ts';
import {
  AutonomousControllerError,
  getAutonomousOverview,
  getAutonomousRunReport,
  planPolicyBatch,
  recordPolicyFeedback,
  runClosedLoopAutonomousSimulation,
  runVirtualSimulationReplicate,
  validateParameters,
  verifyAutonomousAuditChain,
} from './server/modules/autonomousController.ts';
import { buildUploadedArtifact } from './server/commandPipeline/interpreter.ts';
import {
  approvePipelineJob,
  cancelPipelineJob,
  submitCommandJob,
  subscribeToPipelineJob,
} from './server/commandPipeline/orchestrator.ts';
import { SIMULATOR_ADAPTERS } from './server/commandPipeline/simulators.ts';
import {
  getJobRecord,
  getPipelineDb,
  getPipelineSettings,
  listAuditChainEntries,
  listJobEvents,
  listJobRecords,
  listUploadedArtifacts,
  recoverInterruptedJobs,
  savePipelineSettings,
  saveUploadedArtifact,
  verifyAuditChainIntegrity,
} from './server/commandPipeline/sqliteStore.ts';
import { PIPELINE_STAGE_DEFINITIONS } from './server/commandPipeline/stages.ts';
import {
  DEFAULT_ARM_ROBOT_CONFIG,
  DEFAULT_MOBILE_ROBOT_CONFIG,
  DEFAULT_RESEARCH_UPLOAD_CONFIG,
  getRoboticsPipelineManifest,
  getSavedRoboticsRun,
  listRoboticsConfigs,
  listSavedRoboticsRuns,
  runRoboticsEnginePython,
} from './server/commandPipeline/roboticsBridge.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const researchSchema = z.object({
  query: z.string().trim().min(2).max(4000),
  language: z.enum(['en', 'he']).default('en'),
  depth: z.enum(['standard', 'deep', 'comprehensive']).default('standard'),
  inputMode: z.enum(['text', 'voice']).optional(),
});

const simulationSchema = z.object({
  engine: z
    .enum(['langevin-md', 'verlet-nve', 'psi4-scf', 'blast-align'])
    .default('langevin-md'),
  temperature: z.number().min(50).max(1500).default(300),
  pressure: z.number().min(0.1).max(100).default(1),
  steps: z.number().int().min(100).max(50000).default(1200),
  particleCount: z.number().int().min(12).max(48).optional(),
});

const ingestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  authors: z.string().trim().min(2).max(200),
  domain: z.string().trim().min(2).max(80),
  license: z.string().trim().min(2).max(80),
  sourceUrl: z.string().url(),
  content: z.string().trim().min(20).max(20000),
});

const externalIngestionSchema = z.object({
  source: z.enum(['pubmed', 'arxiv', 'wikidata', 'gutenberg']),
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(10).default(3),
});

const feedbackSchema = z.object({
  provenanceId: z.string().trim().min(3),
  question: z.string().trim().min(2).max(4000),
  answerExcerpt: z.string().trim().min(1).max(4000),
  rating: z.number().int().min(1).max(5),
  comments: z.string().trim().max(1500).optional(),
  reviewDecision: z.enum(['approved', 'needs_revision', 'flagged']).optional(),
});

const licenseVerifySchema = z.object({
  verified: z.boolean().optional(),
  commercialUseAllowed: z.boolean().optional(),
  trainingAllowed: z.boolean().optional(),
  license: z.string().trim().min(2).max(80).optional(),
});

const loginSchema = z.object({
  roleOrEmail: z.string().trim().min(2),
  accessCode: z.string().trim().optional(),
});

export function createApp() {
  initializeCorpus();
  getPipelineDb();
  recoverInterruptedJobs();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(attachSession);

  app.get('/api/health', (_req, res) => {
    const jobs = listJobRecords(100);
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      corpusChunks: listCorpusChunks().length,
      activeSimulations: listSimulationJobs().filter((j) => j.state === 'running').length,
      commandPipeline: {
        sqliteReady: true,
        totalJobs: jobs.length,
        activeJobs: jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
        simulatorCount: SIMULATOR_ADAPTERS.length,
        stageCount: PIPELINE_STAGE_DEFINITIONS.length,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/auth/session', (req, res) => {
    const authReq = req as AuthenticatedRequest;
    res.json({ session: authReq.sessionUser });
  });

  app.get('/api/auth/directory', (_req, res) => {
    res.json({
      accounts: DIRECTORY_USERS.map((u) => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        role: u.role,
        accessCodeHint: u.accessCode,
      })),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid login payload.' });
      return;
    }

    const session = authenticateCredentials(
      parsed.data.roleOrEmail,
      parsed.data.accessCode
    );

    if (!session) {
      logger.warn('auth', 'Failed login attempt', {
        target: parsed.data.roleOrEmail,
      });
      res.status(401).json({ error: 'Invalid credentials or access code.' });
      return;
    }

    const token = signSessionToken(session);
    recordProvenance({
      kind: 'auth',
      actorId: session.userId,
      actorRole: session.role,
      action: 'auth:login',
      rawInput: session.email,
      modelOrEngine: 'hmac-sha256-session',
      licenses: ['Internal Session'],
      sourceUrls: [],
    });

    res.json({ token, session });
  });

  const signupSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(160),
    organization: z.string().trim().max(120).optional(),
    role: z.enum(['researcher', 'principal_investigator']).default('researcher'),
    accessCode: z.string().trim().min(6).max(80),
  });

  app.post('/api/auth/signup', (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Provide valid name, email, role, and access code (min 6 chars).',
        issues: parsed.error.issues,
      });
      return;
    }

    const result = registerAccount(parsed.data);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const token = signSessionToken(result.session);
    recordProvenance({
      kind: 'auth',
      actorId: result.session.userId,
      actorRole: result.session.role,
      action: 'auth:signup',
      rawInput: result.session.email,
      modelOrEngine: 'hmac-sha256-session',
      licenses: ['Internal Session'],
      sourceUrls: [],
      metadata: {
        organization: result.session.organization ?? 'Partner Laboratory',
        role: result.session.role,
      },
    });

    res.status(201).json({ token, session: result.session });
  });

  app.get('/api/corpus', (req, res) => {
    const domain = typeof req.query.domain === 'string' ? req.query.domain : undefined;
    res.json({
      domains: getCorpusDomains(),
      chunks: listCorpusChunks(domain),
    });
  });

  app.post(
    '/api/corpus/ingest',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const parsed = ingestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid document schema.',
          issues: parsed.error.issues,
        });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      const created = ingestDocument(parsed.data);
      const provenance = recordProvenance({
        kind: 'corpus_ingest',
        actorId: authReq.sessionUser.userId,
        actorRole: authReq.sessionUser.role,
        action: 'corpus:ingest',
        rawInput: parsed.data.content,
        modelOrEngine: 'tfidf-vector-indexer',
        licenses: [parsed.data.license],
        sourceUrls: [parsed.data.sourceUrl],
        metadata: {
          title: parsed.data.title,
          chunksCreated: created.length,
        },
      });

      logger.info('corpus', 'Ingested new research document', {
        title: parsed.data.title,
        chunksCreated: created.length,
        actor: authReq.sessionUser.role,
      });

      res.status(201).json({
        chunks: created,
        provenanceId: provenance.id,
      });
    }
  );

  app.post('/api/research', async (req, res) => {
    const parsed = researchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid research request.',
        issues: parsed.error.issues,
      });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    if (
      parsed.data.depth === 'comprehensive' &&
      authReq.sessionUser.role === 'guest'
    ) {
      res.status(403).json({
        error:
          'Comprehensive depth requires Researcher or Principal Investigator sign-in.',
        requiredRoles: ['researcher', 'principal_investigator'],
      });
      return;
    }

    try {
      const result = await runResearchQuery(parsed.data, authReq.sessionUser);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Research execution error';
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/research/chat', async (req, res) => {
    const schema = z.object({
      message: z.string().trim().min(2).max(4000),
      persona: z.enum(['synthesizer', 'protocol', 'simulation']).default('synthesizer'),
      language: z.enum(['en', 'he']).default('en'),
      history: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            text: z.string().max(4000),
          })
        )
        .max(20)
        .default([]),
      artifactContext: z
        .object({
          filename: z.string().trim().min(1).max(200),
          excerpt: z.string().max(8000).optional(),
          summary: z.string().max(2000).optional(),
        })
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid research chat payload.', issues: parsed.error.issues });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    try {
      const chatResult = await runResearchChat(
        {
          message: parsed.data.message,
          persona: parsed.data.persona,
          language: parsed.data.language,
          history: parsed.data.history.map((h) => ({ role: h.role, text: h.text })),
          artifactContext: parsed.data.artifactContext,
        },
        authReq.sessionUser
      );
      res.json(chatResult);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Research chatbot error.',
      });
    }
  });

  app.post('/api/simulation/run', (req, res) => {
    const parsed = simulationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid simulation parameters.',
        issues: parsed.error.issues,
      });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    if (parsed.data.steps > 5000 && authReq.sessionUser.role === 'guest') {
      res.status(403).json({
        error: 'Simulations above 5,000 steps require Researcher or PI sign-in.',
        requiredRoles: ['researcher', 'principal_investigator'],
      });
      return;
    }

    try {
      consumeSimulationQuota(1);
    } catch (err) {
      if (err instanceof CommercialSuiteError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }

    const job = submitSimulationJob(parsed.data, authReq.sessionUser);
    res.status(202).json(job);
  });

  app.get('/api/simulations', (_req, res) => {
    res.json({ jobs: listSimulationJobs().slice(0, 20) });
  });

  app.get('/api/simulation/:jobId', (req, res) => {
    const job = getSimulationJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Simulation job not found.' });
      return;
    }
    res.json(job);
  });

  app.post('/api/simulation/:jobId/cancel', async (req, res) => {
    const job = await cancelSimulationJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Simulation job not found.' });
      return;
    }
    res.json(job);
  });

  app.get('/api/provenance', (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const isPrivileged =
      authReq.sessionUser.role === 'auditor' ||
      authReq.sessionUser.role === 'principal_investigator';

    const records = listProvenance(100).map((rec) =>
      isPrivileged
        ? rec
        : {
            ...rec,
            actorId: rec.actorRole,
          }
    );

    res.json({
      privileged: isPrivileged,
      records,
    });
  });

  app.get('/api/retrieval/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 8;
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(25, Math.round(limitRaw)))
      : 8;

    if (q.length < 2) {
      res.status(400).json({ error: 'Query parameter q must be at least 2 characters.' });
      return;
    }

    const results = searchCorpus(q, limit);
    res.json({ query: q, limit, results });
  });

  app.post(
    '/api/ingestion/start',
    requireRole(['researcher', 'principal_investigator']),
    async (req, res) => {
      const parsed = externalIngestionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid external ingestion request.',
          issues: parsed.error.issues,
        });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      try {
        const result = await runExternalIngestion(
          parsed.data.source,
          parsed.data.query,
          parsed.data.limit,
          authReq.sessionUser
        );
        res.status(201).json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'External ingestion failed.';
        logger.error('ingestion', 'External connector failed', {
          source: parsed.data.source,
          error: message,
        });
        res.status(502).json({ error: message });
      }
    }
  );

  app.post('/api/feedback/submit', (req, res) => {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid feedback payload (rating must be 1-5).',
        issues: parsed.error.issues,
      });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const saved = saveFeedback(parsed.data, authReq.sessionUser);
    res.status(201).json(saved);
  });

  app.get('/api/feedback', (_req, res) => {
    res.json({ feedback: listFeedback(50) });
  });

  app.get('/api/governance/licenses', (_req, res) => {
    res.json({ licenses: listLicenseRecords() });
  });

  app.post(
    '/api/governance/licenses/:docId/verify',
    requireRole(['auditor', 'principal_investigator']),
    (req, res) => {
      const parsed = licenseVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid license verification payload.' });
        return;
      }
      const updated = verifyLicenseRecord(req.params.docId, parsed.data);
      if (!updated) {
        res.status(404).json({ error: 'Document license record not found.' });
        return;
      }
      res.json({ license: updated });
    }
  );

  app.get(
    '/api/logs',
    requireRole(['auditor', 'principal_investigator']),
    (_req, res) => {
      res.json({ logs: logger.getRecent(120) });
    }
  );

  // -------------------------------------------------------------------------
  // 1. Live Knowledge Flux (Kafka-compatible partitioned log & stats)
  // -------------------------------------------------------------------------
  app.get('/api/flux/events', (req, res) => {
    const topic = typeof req.query.topic === 'string' ? req.query.topic : 'all';
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    res.json({
      stats: getFluxStats(),
      events: listFluxEvents(Number.isFinite(limit) ? limit : 50, topic),
    });
  });

  // -------------------------------------------------------------------------
  // 2. Collaborative Design Sandbox (Yjs CRDT + WebRTC + Snapshots)
  // -------------------------------------------------------------------------
  app.get('/api/sandbox/:roomId', (req, res) => {
    res.json(getSandboxStateBase64(req.params.roomId));
  });

  app.post(
    '/api/sandbox/:roomId/update',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({ updateBase64: z.string().min(4) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid CRDT update payload.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      const result = applySandboxYjsUpdate(
        req.params.roomId,
        parsed.data.updateBase64,
        authReq.sessionUser
      );
      res.json(result);
    }
  );

  app.post(
    '/api/sandbox/:roomId/snapshot',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({ title: z.string().trim().min(2).max(120) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Snapshot title is required.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      const snapshot = createSandboxSnapshot(
        req.params.roomId,
        parsed.data.title,
        authReq.sessionUser
      );
      res.status(201).json({ snapshot });
    }
  );

  app.post(
    '/api/sandbox/:roomId/restore/:snapshotId',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const restored = restoreSandboxSnapshot(
        req.params.roomId,
        req.params.snapshotId,
        authReq.sessionUser
      );
      if (!restored) {
        res.status(404).json({ error: 'Sandbox snapshot not found.' });
        return;
      }
      res.json(restored);
    }
  );

  // -------------------------------------------------------------------------
  // 3. AI Thought-Prototypes (Ollama probe + Gemini + Mermaid workflows)
  // -------------------------------------------------------------------------
  app.get('/api/prototypes', async (_req, res) => {
    const ollama = await probeOllamaGateway();
    res.json({ ollama, prototypes: listThoughtPrototypes() });
  });

  app.post('/api/prototypes/generate', async (req, res) => {
    const schema = z.object({
      hypothesis: z.string().trim().min(5).max(2000),
      language: z.enum(['en', 'he']).default('en'),
      preferOllama: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid hypothesis payload.' });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    try {
      const prototype = await generateThoughtPrototype(
        parsed.data,
        authReq.sessionUser
      );
      res.status(201).json({ prototype });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Prototype generation failed.';
      res.status(502).json({ error: message });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Pharmacogenomics Vault (AES-256-GCM + Consent + CPIC Evidence)
  // -------------------------------------------------------------------------
  app.get(
    '/api/pgx/samples',
    requireRole(['researcher', 'principal_investigator', 'auditor']),
    (_req, res) => {
      res.json({ samples: listPgxSamples() });
    }
  );

  app.post(
    '/api/pgx/upload',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({
        sampleAlias: z.string().trim().min(2).max(80),
        genomicPayload: z.string().trim().min(6).max(50000),
        consentGranted: z.boolean(),
        consentScope: z.string().trim().min(3).max(200),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid genomic vault upload schema.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      try {
        const result = storeEncryptedPgxSample(parsed.data, authReq.sessionUser);
        res.status(201).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Consent error.';
        res.status(403).json({ error: message });
      }
    }
  );

  app.post(
    '/api/pgx/samples/:sampleId/analyze',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const authReq = req as AuthenticatedRequest;
      try {
        const report = analyzePgxSample(req.params.sampleId, authReq.sessionUser);
        res.json(report);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Vault error.';
        res.status(403).json({ error: message });
      }
    }
  );

  app.post(
    '/api/pgx/samples/:sampleId/revoke',
    requireRole(['researcher', 'principal_investigator', 'auditor']),
    (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const updated = revokePgxConsent(req.params.sampleId, authReq.sessionUser);
      if (!updated) {
        res.status(404).json({ error: 'PGx sample not found.' });
        return;
      }
      res.json({ summary: updated });
    }
  );

  // -------------------------------------------------------------------------
  // 5. 3D Narrative Mode
  // -------------------------------------------------------------------------
  app.get('/api/narrative/timeline', (_req, res) => {
    res.json(buildNarrativeTimeline());
  });

  // -------------------------------------------------------------------------
  // 6. Eco-Impact Auditor
  // -------------------------------------------------------------------------
  app.get('/api/eco/audit', (req, res) => {
    const region = typeof req.query.region === 'string' ? req.query.region : 'us-west1';
    res.json({
      regions: ECO_REGIONS,
      report: generateEcoAuditReport(region),
    });
  });

  // -------------------------------------------------------------------------
  // 8. Open-Data Market (SPDX + IPFS CIDv1 without blockchain)
  // -------------------------------------------------------------------------
  app.get('/api/market/datasets', (_req, res) => {
    res.json({
      datasets: listMarketDatasets(),
      transactions: listMarketTransactions(),
    });
  });

  app.post(
    '/api/market/publish',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(3).max(160),
        domain: z.string().trim().min(2).max(80),
        owner: z.string().trim().min(2).max(120),
        license: z.string().trim().min(2).max(60),
        sizeMb: z.number().positive().max(100000),
        recordsCount: z.number().int().positive(),
        summary: z.string().trim().min(10).max(1200),
        sourceUrl: z.string().url(),
        contentSample: z.string().trim().min(20).max(5000),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid Open-Data Market dataset metadata.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      try {
        const dataset = publishMarketDataset(parsed.data, authReq.sessionUser);
        res.status(201).json({ dataset });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'License validation error.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    '/api/market/acquire',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({
        datasetId: z.string().trim().min(3),
        indexIntoCorpus: z.boolean().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid acquisition request.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      try {
        const result = acquireMarketDataset(
          parsed.data.datasetId,
          parsed.data.indexIntoCorpus,
          authReq.sessionUser
        );
        res.status(201).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Acquisition failed.';
        res.status(400).json({ error: message });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 9. Automated Grant Draft
  // -------------------------------------------------------------------------
  app.get('/api/grants', (_req, res) => {
    res.json({ drafts: listGrantDrafts() });
  });

  app.post(
    '/api/grants/generate',
    requireRole(['researcher', 'principal_investigator']),
    async (req, res) => {
      const schema = z.object({
        topic: z.string().trim().min(4).max(1500),
        template: z.enum(['NIH-R01', 'NSF-CAREER', 'HORIZON-EU', 'ISF-IL']).default('NIH-R01'),
        budgetCapUsd: z.number().min(10000).max(10000000).default(250000),
        durationMonths: z.number().int().min(6).max(60).default(36),
        language: z.enum(['en', 'he']).default('en'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid grant draft parameters.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      try {
        const draft = await generateGrantDraft(parsed.data, authReq.sessionUser);
        res.status(201).json({ draft });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Grant draft failed.';
        res.status(502).json({ error: message });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 10. Predictive AI-Mentor (Privacy-controlled memory + risk explanations)
  // -------------------------------------------------------------------------
  app.get('/api/mentor/insights', (req, res) => {
    const authReq = req as AuthenticatedRequest;
    res.json({
      risks: evaluatePredictiveRisks(authReq.sessionUser),
      memory: getMentorMemory(authReq.sessionUser),
    });
  });

  app.post('/api/mentor/memory/toggle', (req, res) => {
    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid toggle payload.' });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    res.json(setMentorMemoryEnabled(authReq.sessionUser, parsed.data.enabled));
  });

  app.post('/api/mentor/memory', (req, res) => {
    const schema = z.object({
      topic: z.string().trim().min(2).max(120),
      content: z.string().trim().min(3).max(1000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Topic and content required.' });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    try {
      const note = addMentorMemoryNote(
        authReq.sessionUser,
        parsed.data.topic,
        parsed.data.content
      );
      res.status(201).json({ note });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Memory paused.';
      res.status(403).json({ error: message });
    }
  });

  app.delete('/api/mentor/memory/:noteId', (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest;
    const deleted = deleteMentorMemoryNote(authReq.sessionUser, req.params.noteId);
    if (!deleted) {
      res.status(404).json({ error: 'Memory note not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  app.delete('/api/mentor/memory', (req, res) => {
    const authReq = req as AuthenticatedRequest;
    clearAllMentorMemory(authReq.sessionUser);
    res.json({ cleared: true });
  });

  // -------------------------------------------------------------------------
  // 11. אינטל-All-Upload (Universal File-Agnostic Research Optimizer)
  // -------------------------------------------------------------------------
  const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  app.get('/api/all-upload/capabilities', (_req, res) => {
    res.json(getAllUploadCapabilities());
  });

  app.get('/api/all-upload/history', (_req, res) => {
    res.json({ uploads: listAllUploads(30) });
  });

  app.post('/api/all-upload/upload', (req, res) => {
    uploadMiddleware.single('file')(req, res, async (multerErr) => {
      if (multerErr) {
        if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File exceeds 100 MB limit.' });
          return;
        }
        res.status(400).json({ error: multerErr instanceof Error ? multerErr.message : 'Upload error.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'Multipart file field "file" is required.' });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      try {
        const record = await processAllUploadFile({
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          buffer: req.file.buffer,
          session: authReq.sessionUser,
        });
        res.json(record);
      } catch (err) {
        if (err instanceof AllUploadError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        const message = err instanceof Error ? err.message : 'File processing failed.';
        res.status(422).json({ error: message });
      }
    });
  });

  app.post('/api/all-upload/plan', async (req, res) => {
    const schema = z.object({
      researchQuestion: z.string().trim().min(10).max(5000),
      domain: z.string().trim().max(100).default('general'),
      context: z.string().max(20000).default(''),
      uploadId: z.string().trim().optional(),
      useGemini: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid planner payload.', issues: parsed.error.issues });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const plan = await createAllUploadPlan(parsed.data, authReq.sessionUser);
    res.json(plan);
  });

  app.post(
    '/api/all-upload/:uploadId/index-corpus',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(3).max(200),
        authors: z.string().trim().min(2).max(200),
        domain: z.string().trim().min(2).max(80),
        license: z.string().trim().min(2).max(80),
        sourceUrl: z.string().url().default('https://intel-lab.local/uploads'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid corpus indexing metadata.', issues: parsed.error.issues });
        return;
      }
      const authReq = req as unknown as AuthenticatedRequest;
      try {
        const result = indexUploadedArtifactToCorpus(
          {
            uploadId: req.params.uploadId,
            title: parsed.data.title,
            authors: parsed.data.authors,
            domain: parsed.data.domain,
            license: parsed.data.license,
            sourceUrl: parsed.data.sourceUrl,
          },
          authReq.sessionUser
        );
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof AllUploadError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Indexing failed.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 12. Enterprise Commercialization, White-Label & Extra Modules Suite
  // -------------------------------------------------------------------------
  app.get('/api/enterprise/overview', (_req, res) => {
    res.json(getEnterpriseOverview());
  });

  app.get('/api/enterprise/quota', (_req, res) => {
    res.json({ quota: getQuotaStatus() });
  });

  app.post(
    '/api/enterprise/quota',
    requireRole(['researcher', 'principal_investigator', 'auditor']),
    (req, res) => {
      const schema = z.object({
        tier: z.enum(['starter', 'growth', 'enterprise']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid quota tier selection.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      const quota = updateActiveQuotaTier(parsed.data.tier, authReq.sessionUser);
      res.json({ quota });
    }
  );

  app.post('/api/enterprise/quote', (req, res) => {
    const schema = z.object({
      tier: z.enum(['starter', 'growth', 'enterprise']),
      numUsers: z.number().int().min(1).max(10000),
      customization: z.boolean().default(false),
      billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid quote calculation request.' });
      return;
    }
    res.json({ quote: calculateEnterpriseQuote(parsed.data) });
  });

  app.post(
    '/api/enterprise/whitelabel',
    requireRole(['principal_investigator', 'auditor']),
    (req, res) => {
      const schema = z.object({
        enabled: z.boolean(),
        brandName: z.string().trim().min(1).max(60),
        brandNameHe: z.string().trim().min(1).max(60),
        tagline: z.string().trim().min(2).max(140),
        taglineHe: z.string().trim().min(2).max(140),
        accentColor: z.enum(['cyan', 'emerald', 'amber', 'violet']),
        customDomain: z.string().trim().min(3).max(120),
        hipaaReady: z.boolean().optional(),
        iso27001Controls: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid white-label configuration.' });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      const whiteLabel = updateBrandConfig(parsed.data, authReq.sessionUser);
      res.json({ whiteLabel });
    }
  );

  app.post(
    '/api/enterprise/checklist/:itemId/toggle',
    requireRole(['principal_investigator', 'auditor']),
    (req, res) => {
      const authReq = req as unknown as AuthenticatedRequest;
      const checklist = toggleLaunchChecklistItem(req.params.itemId, authReq.sessionUser);
      if (!checklist) {
        res.status(404).json({ error: 'Checklist item not found.' });
        return;
      }
      res.json({ checklist });
    }
  );

  app.post('/api/enterprise/rubric/grade', (req, res) => {
    const schema = z.object({
      title: z.string().trim().min(2).max(200),
      submissionText: z.string().trim().min(20).max(50000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide submission title and text (>= 20 chars).' });
      return;
    }
    res.json({ result: gradeSubmissionWithRubric(parsed.data) });
  });

  app.post(
    '/api/enterprise/checkout',
    requireRole(['researcher', 'principal_investigator', 'auditor']),
    (req, res) => {
      const schema = z.object({
        tier: z.enum(['starter', 'growth', 'enterprise']),
        numUsers: z.number().int().min(1).max(10000),
        customization: z.boolean().default(false),
        billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
        organization: z.string().trim().min(2).max(160),
        billingEmail: z.string().trim().email().max(160),
        partnerName: z.string().trim().max(160).optional(),
        partnerEmail: z.string().trim().email().max(160).optional(),
        activateTrialFirst: z.boolean().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid enterprise checkout payload.',
          issues: parsed.error.issues,
        });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      const result = createCheckoutOrder(parsed.data, authReq.sessionUser);
      res.status(201).json(result);
    }
  );

  app.post(
    '/api/enterprise/payouts/:payoutId/settle',
    requireRole(['principal_investigator', 'auditor']),
    (req, res) => {
      const authReq = req as unknown as AuthenticatedRequest;
      try {
        const payout = settlePartnerPayout(req.params.payoutId, authReq.sessionUser);
        res.json({ payout });
      } catch (err) {
        if (err instanceof CommercialSuiteError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Payout settlement failed.',
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 13. AutoOptimizeAI (Constrained Human-Supervised Protocol Optimizer)
  // -------------------------------------------------------------------------
  app.get('/api/auto-optimize/status', (_req, res) => {
    res.json(getAutoOptimizeStatus());
  });

  app.get('/api/auto-optimize/protocols', (_req, res) => {
    res.json({ protocols: listAutoOptimizeProtocols() });
  });

  app.get('/api/auto-optimize/protocols/:protocolId', (req, res) => {
    const protocol = getAutoOptimizeProtocol(req.params.protocolId);
    if (!protocol) {
      res.status(404).json({ error: 'Protocol not found.' });
      return;
    }
    res.json({ protocol });
  });

  app.post(
    '/api/auto-optimize/protocols',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(3).max(160),
        objective: z.enum(['maximize', 'minimize']).default('maximize'),
        parameter: z.object({
          name: z.string().trim().min(1).max(80),
          initial: z.number(),
          minimum: z.number(),
          maximum: z.number(),
          step: z.number().positive(),
          unit: z.string().trim().min(1).max(40).default('arbitrary_units'),
        }),
        budget: z.number().positive().max(100000),
        maximumExperiments: z.number().int().min(1).max(500),
        maximumCostPerExperiment: z.number().positive().max(10000),
        safetyLimit: z.number().min(0).max(1).default(0.8),
        safetyAcknowledged: z.boolean(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid AutoOptimizeAI protocol payload.', issues: parsed.error.issues });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      try {
        const protocol = createAutoOptimizeProtocol(parsed.data, authReq.sessionUser);
        res.status(201).json({ protocol });
      } catch (err) {
        if (err instanceof AutoOptimizeError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Protocol error.' });
      }
    }
  );

  app.post(
    '/api/auto-optimize/protocols/:protocolId/approve',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const authReq = req as unknown as AuthenticatedRequest;
      try {
        const protocol = approveAutoOptimizeProtocol(
          req.params.protocolId,
          authReq.sessionUser
        );
        res.json({ protocol });
      } catch (err) {
        if (err instanceof AutoOptimizeError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Approval failed.' });
      }
    }
  );

  app.post(
    '/api/auto-optimize/protocols/:protocolId/propose',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const authReq = req as unknown as AuthenticatedRequest;
      try {
        const proposal = proposeAutoOptimizeIncrement(
          req.params.protocolId,
          authReq.sessionUser
        );
        res.json({ proposal, protocol: getAutoOptimizeProtocol(req.params.protocolId) });
      } catch (err) {
        if (err instanceof AutoOptimizeError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Proposal failed.' });
      }
    }
  );

  app.post(
    '/api/auto-optimize/protocols/:protocolId/results',
    requireRole(['researcher', 'principal_investigator']),
    async (req, res) => {
      const schema = z.object({
        measurements: z.object({
          efficiency: z.number().min(0).max(1),
          safety: z.number().min(0).max(1),
          cost: z.number().min(0),
          novelty: z.number().min(0).max(1).default(0),
        }),
        experimentCost: z.number().min(0).default(1),
        proposalId: z.string().optional(),
        executor: z
          .enum(['human_verified', 'isolated_sim_bridge'])
          .default('human_verified'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid measurement payload.', issues: parsed.error.issues });
        return;
      }
      const authReq = req as unknown as AuthenticatedRequest;
      try {
        const outcome = await recordAutoOptimizeResult(
          req.params.protocolId,
          parsed.data,
          authReq.sessionUser
        );
        res.status(201).json(outcome);
      } catch (err) {
        if (err instanceof AutoOptimizeError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Recording failed.' });
      }
    }
  );

  app.post(
    '/api/auto-optimize/protocols/:protocolId/lock',
    requireRole(['principal_investigator', 'auditor']),
    (req, res) => {
      const authReq = req as unknown as AuthenticatedRequest;
      try {
        const protocol = toggleAutoOptimizeLock(
          req.params.protocolId,
          authReq.sessionUser
        );
        res.json({ protocol });
      } catch (err) {
        if (err instanceof AutoOptimizeError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Lock error.' });
      }
    }
  );

  app.post('/api/auto-optimize/ingest', async (req, res) => {
    const schema = z.object({
      filename: z.string().trim().max(180).optional(),
      text: z.string().max(100000).optional(),
      uploadId: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid NLP pipeline payload.' });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    try {
      const doc = await runAutoOptimizeEntityPipeline(parsed.data, authReq.sessionUser);
      res.status(201).json({ document: doc });
    } catch (err) {
      if (err instanceof AutoOptimizeError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : 'Pipeline error.' });
    }
  });

  app.get('/api/auto-optimize/graph', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    res.json(searchAutoOptimizeGraph(q, Number.isFinite(limit) ? limit : 50));
  });

  // -------------------------------------------------------------------------
  // 14. Master End-to-End Orchestrator & UI Coverage Audit
  // -------------------------------------------------------------------------
  app.get('/api/orchestrator/audits', (_req, res) => {
    res.json(getOrchestratorAuditOverview());
  });

  app.post(
    '/api/orchestrator/run',
    requireRole(['researcher', 'principal_investigator']),
    (req, res) => {
      const handleBody = async () => {
        const schema = z.object({
          uploadId: z.string().trim().optional(),
          filename: z.string().trim().max(180).optional(),
          text: z.string().max(100000).optional(),
          engine: z
            .enum(['langevin-md', 'verlet-nve', 'psi4-scf', 'blast-align'])
            .default('langevin-md'),
          safetyLimit: z.coerce.number().min(0).max(1).default(0.8),
          enableSimulator: z
            .union([z.boolean(), z.enum(['true', 'false'])])
            .optional()
            .transform((v) => v === true || v === 'true'),
          lockIfBest: z
            .union([z.boolean(), z.enum(['true', 'false'])])
            .optional()
            .transform((v) => v === true || v === 'true'),
        });

        const parsed = schema.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid master orchestrator payload.',
            issues: parsed.error.issues,
          });
          return;
        }

        const authReq = req as AuthenticatedRequest;
        try {
          const result = await runMasterPipeline(
            {
              file: req.file
                ? {
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    buffer: req.file.buffer,
                  }
                : undefined,
              uploadId: parsed.data.uploadId,
              filename: parsed.data.filename,
              text: parsed.data.text,
              engine: parsed.data.engine,
              safetyLimit: parsed.data.safetyLimit,
              enableSimulator: parsed.data.enableSimulator,
              lockIfBest: parsed.data.lockIfBest,
            },
            authReq.sessionUser
          );
          res.status(201).json(result);
        } catch (err) {
          if (err instanceof AllUploadError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
          }
          if (err instanceof AutoOptimizeError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
          }
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Master pipeline error.',
          });
        }
      };

      if (req.is('multipart/form-data')) {
        uploadMiddleware.single('file')(req, res, (multerErr) => {
          if (multerErr) {
            if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
              res.status(413).json({ error: 'File exceeds 100 MB limit.' });
              return;
            }
            res.status(400).json({
              error: multerErr instanceof Error ? multerErr.message : 'Upload error.',
            });
            return;
          }
          void handleBody();
        });
      } else {
        void handleBody();
      }
    }
  );

  app.post('/api/orchestrator/ui-audit', (req, res) => {
    const schema = z.object({
      harnessMode: z
        .enum(['dom-live-sweep', 'playwright-chromium', 'http-ws-contract-probe'])
        .default('dom-live-sweep'),
      targetUrl: z.string().trim().min(3).max(400),
      viewsVisited: z.array(z.string()).min(1).max(100),
      results: z
        .array(
          z.object({
            view: z.string(),
            label: z.string(),
            disabled: z.boolean(),
            safeMarked: z.boolean().optional(),
            status: z.enum([
              'OK',
              'CLICKED',
              'GUARDED_DISABLED',
              'SKIPPED_UNMARKED',
              'SKIPPED_NOT_VISIBLE',
              'SKIPPED_DISABLED',
              'FAIL',
            ]),
            detail: z.string().optional(),
          })
        )
        .max(1000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid UI button audit payload.',
        issues: parsed.error.issues,
      });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const summary = recordUiButtonAudit(parsed.data, authReq.sessionUser);
    res.status(201).json({ summary });
  });

  // -------------------------------------------------------------------------
  // 15. Closed-Loop Autonomous Virtual Simulation Controller + Python Adapters
  // -------------------------------------------------------------------------
  app.get('/api/autonomous/overview', (_req, res) => {
    res.json(getAutonomousOverview());
  });

  app.get('/api/autonomous/verify', (req, res) => {
    const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    res.json(verifyAutonomousAuditChain(runId));
  });

  app.get('/api/autonomous/runs/:runId', (req, res) => {
    const run = getAutonomousRunReport(req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'Autonomous run report not found.' });
      return;
    }
    const chain = verifyAutonomousAuditChain(run.runId);
    res.json({ run, chain });
  });

  app.post(
    '/api/autonomous/run',
    requireRole(['researcher', 'principal_investigator']),
    async (req, res) => {
      const schema = z.object({
        batchSize: z.number().int().min(1).max(32).default(8),
        replicates: z.number().int().min(3).max(10).default(3),
        maxIterations: z.number().int().min(1).max(40).default(12),
        maxParallelSimulations: z.number().int().min(1).max(16).default(4),
        targetReward: z.number().min(-1).max(2).default(0.75),
        confidenceLevel: z.number().min(0.5).max(0.999).default(0.95),
        minSuccessfulReplicates: z.number().int().min(1).max(10).default(3),
        maxConfidenceIntervalWidth: z.number().positive().max(2).default(0.2),
        convergencePatience: z.number().int().min(1).max(30).default(5),
        randomSeed: z.number().int().min(0).max(1_000_000).default(42),
        bootstrapSamples: z.number().int().min(200).max(5000).default(3000),
        virtualModeConfirmed: z.boolean(),
      });

      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid autonomous controller configuration.',
          issues: parsed.error.issues,
        });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      try {
        assertQuotaAvailable(1);
        const run = await runClosedLoopAutonomousSimulation(
          parsed.data,
          authReq.sessionUser
        );
        consumeSimulationQuota(1);
        res.status(201).json({ run });
      } catch (err) {
        if (err instanceof CommercialSuiteError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        if (err instanceof AutonomousControllerError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Autonomous controller failed.',
        });
      }
    }
  );

  // HTTP adapters matching autonomous_controller.py (POLICY_URL / SIMULATOR_URL)
  app.post('/plan', (req, res) => {
    const schema = z.object({
      run_id: z.string().trim().min(1),
      iteration: z.number().int().min(0),
      batch_size: z.number().int().min(1).max(64),
      best_reward: z.number().nullable().optional(),
      best_candidate: z
        .object({ parameters: z.record(z.string(), z.number()).optional() })
        .nullable()
        .optional(),
      parameter_bounds: z
        .record(z.string(), z.tuple([z.number(), z.number()]))
        .optional(),
      mode: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid /plan request.', issues: parsed.error.issues });
      return;
    }
    try {
      const batch = planPolicyBatch({
        runId: parsed.data.run_id,
        iteration: parsed.data.iteration,
        batchSize: parsed.data.batch_size,
        bestReward: parsed.data.best_reward,
        bestCandidate: parsed.data.best_candidate,
        parameterBounds: parsed.data.parameter_bounds,
      });
      res.json({ batch, mode: 'virtual_simulation' });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Planning error.' });
    }
  });

  app.post('/simulate', (req, res) => {
    const schema = z.object({
      candidate_id: z.string().trim().min(1),
      iteration: z.number().int().min(0),
      replicate: z.number().int().min(1),
      parameters: z.record(z.string(), z.number()),
      mode: z.string().default('virtual'),
      physical_execution: z.literal(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid /simulate request (physical_execution must be false).',
        issues: parsed.error.issues,
      });
      return;
    }
    try {
      validateParameters(parsed.data.parameters);
      const output = runVirtualSimulationReplicate(
        parsed.data.parameters,
        parsed.data.iteration,
        parsed.data.replicate
      );
      res.json(output);
    } catch (err) {
      if (err instanceof AutonomousControllerError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : 'Simulation error.' });
    }
  });

  app.post('/update', (req, res) => {
    const schema = z.object({
      run_id: z.string().trim().min(1),
      candidate_id: z.string().trim().min(1),
      parameters: z.record(z.string(), z.number()),
      reward: z.number(),
      confidence_interval: z.tuple([z.number(), z.number()]).optional(),
      metrics_mean: z.record(z.string(), z.number()).optional(),
      replicates: z.number().int().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid /update request.', issues: parsed.error.issues });
      return;
    }
    const feedback = recordPolicyFeedback({
      runId: parsed.data.run_id,
      candidateId: parsed.data.candidate_id,
      parameters: parsed.data.parameters,
      reward: parsed.data.reward,
    });
    res.json(feedback);
  });

  // -------------------------------------------------------------------------
  // 14. Command Center — 30-Stage Autonomous Formulation, Pipeline & 3D Demo
  // -------------------------------------------------------------------------
  const commandUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.post('/api/upload', (req, res) => {
    commandUploadMiddleware.single('file')(req, res, (multerErr) => {
      if (multerErr) {
        res.status(400).json({ error: multerErr instanceof Error ? multerErr.message : 'Upload failed.' });
        return;
      }
      if (req.file) {
        const artifact = buildUploadedArtifact({
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          buffer: req.file.buffer,
        });
        saveUploadedArtifact(artifact);
        res.status(201).json({ artifact });
        return;
      }
      const schema = z.object({
        filename: z.string().trim().min(1).max(200).default('matrix_input.json'),
        content: z.string().min(1),
        mimeType: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Provide multipart "file" or JSON { filename, content }.' });
        return;
      }
      const artifact = buildUploadedArtifact({
        filename: parsed.data.filename,
        mimeType: parsed.data.mimeType || 'text/plain',
        buffer: Buffer.from(parsed.data.content, 'utf8'),
      });
      saveUploadedArtifact(artifact);
      res.status(201).json({ artifact });
    });
  });

  const commandSchema = z.object({
    commandText: z.string().trim().min(2).max(4000),
    inputMode: z.enum(['voice', 'text', 'file', 'matrix', 'dataset', 'api']).optional(),
    uploadId: z.string().trim().optional(),
    inlineDataText: z.string().max(40000).optional(),
    matrix: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).max(100).optional(),
    idempotencyKey: z.string().trim().max(120).optional(),
  });

  app.post('/api/command', (req, res) => {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid command request.', issues: parsed.error.issues });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    const { job, deduplicated } = submitCommandJob({
      ...parsed.data,
      actor: {
        userId: authReq.sessionUser.userId,
        role: authReq.sessionUser.role,
        name: authReq.sessionUser.name,
      },
    });
    res.status(deduplicated ? 200 : 202).json({ job, deduplicated });
  });

  app.post('/api/jobs', (req, res) => {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid job payload.', issues: parsed.error.issues });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    const { job, deduplicated } = submitCommandJob({
      ...parsed.data,
      actor: {
        userId: authReq.sessionUser.userId,
        role: authReq.sessionUser.role,
        name: authReq.sessionUser.name,
      },
    });
    res.status(deduplicated ? 200 : 201).json({ job, deduplicated });
  });

  app.get('/api/jobs', (req, res) => {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 40;
    res.json({
      jobs: listJobRecords(Number.isFinite(limit) ? Math.min(100, limit) : 40),
      uploads: listUploadedArtifacts(20),
    });
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    const job = getJobRecord(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Pipeline job not found.' });
      return;
    }
    res.json({ job });
  });

  app.get('/api/jobs/:jobId/events', (req, res) => {
    const job = getJobRecord(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Pipeline job not found.' });
      return;
    }
    const afterSeq = typeof req.query.afterSequence === 'string' ? Number(req.query.afterSequence) : 0;
    const events = listJobEvents(job.jobId, Number.isFinite(afterSeq) ? afterSeq : 0);
    res.json({ jobId: job.jobId, events });
  });

  app.get('/api/jobs/:jobId/results', (req, res) => {
    const job = getJobRecord(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Pipeline job not found.' });
      return;
    }
    const winner = job.candidates.find((c) => c.candidateId === job.selectedCandidateId) ?? null;
    res.json({
      jobId: job.jobId,
      status: job.status,
      intent: job.intent,
      domain: job.domain,
      simulatorId: job.simulatorId,
      selectedCandidate: winner,
      candidates: job.candidates,
      optimizationHistory: job.optimizationHistory,
      entities: job.entities,
      knowledgeEdges: job.knowledgeEdges,
      limitations: job.limitations,
    });
  });

  app.get('/api/jobs/:jobId/report', (req, res) => {
    const job = getJobRecord(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Pipeline job not found.' });
      return;
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      reportMarkdown: job.reportMarkdown ?? 'Report not yet finalized.',
      selectedCandidate:
        job.candidates.find((c) => c.candidateId === job.selectedCandidateId) ?? null,
      candidates: job.candidates,
      auditEntries: listAuditChainEntries(job.jobId),
      auditVerification: verifyAuditChainIntegrity(),
    });
  });

  app.post('/api/jobs/:jobId/cancel', (req, res) => {
    const updated = cancelPipelineJob(req.params.jobId);
    if (!updated) {
      res.status(404).json({ error: 'Pipeline job not found.' });
      return;
    }
    res.json({ job: updated });
  });

  app.post(
    '/api/jobs/:jobId/approve',
    requireRole(['researcher', 'principal_investigator', 'auditor']),
    (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const updated = approvePipelineJob(req.params.jobId, {
        userId: authReq.sessionUser.userId,
        name: authReq.sessionUser.name,
        role: authReq.sessionUser.role,
      });
      if (!updated) {
        res.status(404).json({ error: 'Pipeline job not found.' });
        return;
      }
      res.json({ job: updated });
    }
  );

  app.get('/api/pipeline/stages', (_req, res) => {
    res.json({ stages: PIPELINE_STAGE_DEFINITIONS });
  });

  app.get('/api/simulators', (_req, res) => {
    res.json({ simulators: SIMULATOR_ADAPTERS });
  });

  app.get('/api/pipeline/audit', (req, res) => {
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : undefined;
    res.json({
      entries: listAuditChainEntries(jobId, 200),
      verification: verifyAuditChainIntegrity(),
    });
  });

  app.get('/api/pipeline/settings', (_req, res) => {
    res.json({ settings: getPipelineSettings() });
  });

  app.post(
    '/api/pipeline/settings',
    requireRole(['principal_investigator', 'auditor']),
    (req, res) => {
      const schema = z.object({
        maxConcurrentJobs: z.number().int().min(1).max(8).optional(),
        defaultReplicates: z.number().int().min(2).max(12).optional(),
        defaultRetryLimit: z.number().int().min(0).max(5).optional(),
        voiceAutoSpeak: z.boolean().optional(),
        enforceMedicalSafetyGate: z.boolean().optional(),
        preferredModel: z.string().trim().min(2).max(80).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid pipeline settings payload.' });
        return;
      }
      const settings = savePipelineSettings(parsed.data);
      res.json({ settings });
    }
  );

  // -------------------------------------------------------------------------
  // 15. Virtual Robotics Research Engine (robotics_engine.py bridge)
  // -------------------------------------------------------------------------
  app.get('/api/robotics/manifest', (_req, res) => {
    res.json({
      manifest: getRoboticsPipelineManifest(),
      configs: listRoboticsConfigs(),
    });
  });

  app.get('/api/robotics/runs', (_req, res) => {
    res.json({
      runs: listSavedRoboticsRuns(25),
      presets: {
        differential_drive: DEFAULT_MOBILE_ROBOT_CONFIG,
        two_link_arm: DEFAULT_ARM_ROBOT_CONFIG,
        research_upload_example: DEFAULT_RESEARCH_UPLOAD_CONFIG,
      },
      manifest: getRoboticsPipelineManifest(),
      simulationOnly: true,
    });
  });

  app.get('/api/robotics/runs/:jobId', (req, res) => {
    const found = getSavedRoboticsRun(req.params.jobId);
    if (!found) {
      res.status(404).json({ error: 'Robotics run report not found.' });
      return;
    }
    res.json(found);
  });

  app.post('/api/robotics/run', async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const result = await runRoboticsEnginePython(
        req.body,
        authReq.sessionUser?.userId ?? 'research-operator'
      );
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Robotics simulation failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket: WebSocket, _req: http.IncomingMessage, jobId: string) => {
    const existing = getSimulationJob(jobId);
    if (!existing) {
      socket.send(
        JSON.stringify({
          jobId,
          state: 'not_found',
          progress: 0,
          frames: [],
          particles: [],
        })
      );
      socket.close();
      return;
    }

    const unsubscribe = subscribeToJob(jobId, (job) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            jobId: job.jobId,
            engine: job.engine,
            state: job.state,
            progress: job.progress,
            frames: job.frames,
            particles: job.particles,
            summary: job.summary,
            error: job.error,
          })
        );
      }
      if (
        job.state === 'completed' ||
        job.state === 'failed' ||
        job.state === 'cancelled'
      ) {
        setTimeout(() => {
          if (socket.readyState === socket.OPEN) {
            socket.close();
          }
        }, 120);
      }
    });

    socket.on('close', () => {
      unsubscribe();
    });
  });

  const fluxWss = new WebSocketServer({ noServer: true });
  fluxWss.on('connection', (socket: WebSocket) => {
    socket.send(
      JSON.stringify({
        type: 'init',
        stats: getFluxStats(),
        events: listFluxEvents(30),
      })
    );
    const unsubscribe = subscribeToFlux((event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'event',
            stats: getFluxStats(),
            event,
          })
        );
      }
    });
    socket.on('close', () => unsubscribe());
  });

  const sandboxClients = new Map<string, Set<{ peerId: string; socket: WebSocket }>>();
  const sandboxWss = new WebSocketServer({ noServer: true });
  sandboxWss.on(
    'connection',
    (
      socket: WebSocket,
      _req: http.IncomingMessage,
      info: { roomId: string; peerId: string; name: string; role: string }
    ) => {
      const { roomId, peerId, name, role } = info;
      if (!sandboxClients.has(roomId)) {
        sandboxClients.set(roomId, new Set());
      }
      const clientEntry = { peerId, socket };
      sandboxClients.get(roomId)!.add(clientEntry);

      const peers = registerSandboxPeer(roomId, {
        peerId,
        name,
        role: (role as 'guest' | 'researcher' | 'principal_investigator' | 'auditor') || 'guest',
        joinedAt: new Date().toISOString(),
      });

      const snapshot = getSandboxStateBase64(roomId);
      socket.send(
        JSON.stringify({
          type: 'sync',
          roomId,
          stateBase64: snapshot.stateBase64,
          peers,
        })
      );

      // Broadcast updated presence to other peers
      for (const peer of sandboxClients.get(roomId)!) {
        if (peer.socket !== socket && peer.socket.readyState === peer.socket.OPEN) {
          peer.socket.send(JSON.stringify({ type: 'presence', peers }));
        }
      }

      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString('utf8')) as {
            type: string;
            updateBase64?: string;
            targetPeerId?: string;
            signal?: unknown;
          };
          if (msg.type === 'yjs-update' && typeof msg.updateBase64 === 'string') {
            applySandboxYjsUpdate(roomId, msg.updateBase64, {
              userId: peerId,
              name,
              email: '',
              role: (role as 'guest' | 'researcher' | 'principal_investigator' | 'auditor') || 'guest',
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            });
            for (const peer of sandboxClients.get(roomId) ?? []) {
              if (peer.socket !== socket && peer.socket.readyState === peer.socket.OPEN) {
                peer.socket.send(
                  JSON.stringify({ type: 'yjs-update', updateBase64: msg.updateBase64 })
                );
              }
            }
          } else if (msg.type === 'webrtc-signal' && msg.targetPeerId) {
            for (const peer of sandboxClients.get(roomId) ?? []) {
              if (peer.peerId === msg.targetPeerId && peer.socket.readyState === peer.socket.OPEN) {
                peer.socket.send(
                  JSON.stringify({
                    type: 'webrtc-signal',
                    fromPeerId: peerId,
                    signal: msg.signal,
                  })
                );
              }
            }
          }
        } catch {
          // Ignore malformed message
        }
      });

      socket.on('close', () => {
        sandboxClients.get(roomId)?.delete(clientEntry);
        const remaining = removeSandboxPeer(roomId, peerId);
        for (const peer of sandboxClients.get(roomId) ?? []) {
          if (peer.socket.readyState === peer.socket.OPEN) {
            peer.socket.send(JSON.stringify({ type: 'presence', peers: remaining }));
          }
        }
      });
    }
  );

  const jobsWss = new WebSocketServer({ noServer: true });
  jobsWss.on(
    'connection',
    (
      socket: WebSocket,
      _req: http.IncomingMessage,
      info: { jobId: string; afterSequence: number }
    ) => {
      const job = getJobRecord(info.jobId);
      if (!job) {
        socket.send(
          JSON.stringify({
            type: 'job.failed',
            job_id: info.jobId,
            sequence: 0,
            message: 'Requested job ID does not exist.',
          })
        );
        socket.close();
        return;
      }

      let lastSentSeq = info.afterSequence;
      const backlog = listJobEvents(info.jobId, info.afterSequence);
      for (const evt of backlog) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(evt));
          lastSentSeq = Math.max(lastSentSeq, evt.sequence);
        }
      }

      const unsubscribe = subscribeToPipelineJob(info.jobId, (evt) => {
        if (evt.sequence <= lastSentSeq) return;
        lastSentSeq = evt.sequence;
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(evt));
        }
      });

      socket.on('close', () => {
        unsubscribe();
      });
    }
  );

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    const simMatch = reqUrl.match(/^\/ws\/simulations\/([^/?#]+)/);
    if (simMatch) {
      const jobId = decodeURIComponent(simMatch[1]);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, jobId);
      });
      return;
    }

    if (reqUrl.startsWith('/ws/flux')) {
      fluxWss.handleUpgrade(request, socket, head, (ws) => {
        fluxWss.emit('connection', ws, request);
      });
      return;
    }

    const jobsWsMatch = reqUrl.match(/^\/ws\/jobs\/([^/?#]+)(\?.*)?$/);
    if (jobsWsMatch) {
      const jobId = decodeURIComponent(jobsWsMatch[1]);
      const params = new URLSearchParams(jobsWsMatch[2] || '');
      const afterSequence = Number(params.get('afterSequence') || '0') || 0;
      jobsWss.handleUpgrade(request, socket, head, (ws) => {
        jobsWss.emit('connection', ws, request, { jobId, afterSequence });
      });
      return;
    }

    const sandboxMatch = reqUrl.match(/^\/ws\/sandbox\/([^/?#]+)(\?.*)?$/);
    if (sandboxMatch) {
      const roomId = decodeURIComponent(sandboxMatch[1]);
      const params = new URLSearchParams(sandboxMatch[2] || '');
      const peerId = params.get('peerId') || `peer-${Math.random().toString(36).slice(2, 8)}`;
      const name = params.get('name') || 'Collaborator';
      const role = params.get('role') || 'guest';
      sandboxWss.handleUpgrade(request, socket, head, (ws) => {
        sandboxWss.emit('connection', ws, request, { roomId, peerId, name, role });
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    logger.info('server', `INTEL Research Command Center listening on port ${PORT}`);
  });
}

const isEntryPoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  startServer().catch((err) => {
    logger.error('server', 'Failed to start server', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
