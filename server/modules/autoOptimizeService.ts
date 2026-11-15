import crypto from 'node:crypto';
import { logger } from '../logger.ts';
import { recordProvenance } from '../provenance.ts';
import { getAllUploadFullText } from './allUploadService.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';
import type {
  AuthSession,
  AutoOptimizeEntity,
  AutoOptimizeExperimentRun,
  AutoOptimizeIngestedDoc,
  AutoOptimizeMeasurement,
  AutoOptimizeParameterSpec,
  AutoOptimizeProposal,
  AutoOptimizeProtocol,
  AutoOptimizeStatusSummary,
} from '../types.ts';

export class AutoOptimizeError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

const protocols: AutoOptimizeProtocol[] = [];
const ingestedDocs: AutoOptimizeIngestedDoc[] = [];
const entityGraph: Array<{
  documentId: string;
  filename: string;
  name: string;
  entityType: string;
  language: string;
}> = [];

function computeStateHash(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

function seedDefaultProtocol(): void {
  if (protocols.length > 0) return;
  const parameter: AutoOptimizeParameterSpec = {
    name: 'test_parameter',
    initial: 5.0,
    minimum: 0.0,
    maximum: 10.0,
    step: 0.1,
    unit: 'arbitrary_units',
  };
  const draft: AutoOptimizeProtocol = {
    id: 'proto-demo-01',
    name: 'Synthetic Parameter Optimization Demo',
    objective: 'maximize',
    parameter,
    currentParameters: { [parameter.name]: parameter.initial },
    bounds: { [parameter.name]: [parameter.minimum, parameter.maximum] },
    budget: 100,
    spentBudget: 0,
    maximumExperiments: 20,
    maximumCostPerExperiment: 10,
    safetyLimit: 0.8,
    safetyAcknowledged: true,
    status: 'draft_pending_approval',
    locked: false,
    stateHash: '',
    runs: [],
    createdBy: 'system',
    createdAt: new Date().toISOString(),
  };
  draft.stateHash = computeStateHash(draft);
  protocols.push(draft);
}

seedDefaultProtocol();

export function listAutoOptimizeProtocols(): AutoOptimizeProtocol[] {
  seedDefaultProtocol();
  return protocols;
}

export function getAutoOptimizeProtocol(protocolId: string): AutoOptimizeProtocol | null {
  seedDefaultProtocol();
  return protocols.find((p) => p.id === protocolId) ?? null;
}

export function createAutoOptimizeProtocol(
  input: {
    name: string;
    objective: 'maximize' | 'minimize';
    parameter: AutoOptimizeParameterSpec;
    budget: number;
    maximumExperiments: number;
    maximumCostPerExperiment: number;
    safetyLimit: number;
    safetyAcknowledged: boolean;
  },
  session: AuthSession
): AutoOptimizeProtocol {
  const { parameter } = input;
  if (parameter.minimum >= parameter.maximum) {
    throw new AutoOptimizeError(
      400,
      `Invalid bounds for ${parameter.name}: minimum must be less than maximum.`
    );
  }
  if (
    parameter.initial < parameter.minimum ||
    parameter.initial > parameter.maximum
  ) {
    throw new AutoOptimizeError(
      400,
      `Initial value ${parameter.initial} is outside bounds [${parameter.minimum}, ${parameter.maximum}].`
    );
  }
  if (parameter.step <= 0) {
    throw new AutoOptimizeError(400, 'Step size must be positive.');
  }

  const protocol: AutoOptimizeProtocol = {
    id: `proto-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name,
    objective: input.objective,
    parameter,
    currentParameters: { [parameter.name]: parameter.initial },
    bounds: { [parameter.name]: [parameter.minimum, parameter.maximum] },
    budget: input.budget,
    spentBudget: 0,
    maximumExperiments: input.maximumExperiments,
    maximumCostPerExperiment: input.maximumCostPerExperiment,
    safetyLimit: input.safetyLimit,
    safetyAcknowledged: input.safetyAcknowledged,
    status: 'draft_pending_approval',
    locked: false,
    stateHash: '',
    runs: [],
    createdBy: session.userId,
    createdAt: new Date().toISOString(),
  };
  protocol.stateHash = computeStateHash(protocol);
  protocols.unshift(protocol);

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: 'auto-optimize:protocol-created',
    rawInput: JSON.stringify(protocol),
    modelOrEngine: 'auto-optimize-registry',
    licenses: ['Internal Experimental Protocol'],
    sourceUrls: [],
  });

  return protocol;
}

export function approveAutoOptimizeProtocol(
  protocolId: string,
  session: AuthSession
): AutoOptimizeProtocol {
  const protocol = getAutoOptimizeProtocol(protocolId);
  if (!protocol) {
    throw new AutoOptimizeError(404, 'Protocol not found.');
  }
  if (!protocol.safetyAcknowledged) {
    throw new AutoOptimizeError(
      400,
      'Safety limits must be acknowledged before human approval.'
    );
  }
  protocol.status = protocol.locked ? 'locked' : 'approved';
  protocol.approvedBy = session.userId;
  protocol.approvedAt = new Date().toISOString();
  protocol.stateHash = computeStateHash({
    id: protocol.id,
    status: protocol.status,
    approvedBy: protocol.approvedBy,
    runsCount: protocol.runs.length,
  });

  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'auto-optimize:protocol-approved',
    rawInput: protocol.id,
    modelOrEngine: 'human-approval-gate',
    licenses: ['Human Supervised Protocol'],
    sourceUrls: [],
  });

  publishFluxEvent({
    topic: 'governance.audit',
    key: protocol.id,
    actorRole: session.role,
    summary: `Approved AutoOptimizeAI protocol "${protocol.name}"`,
    payload: { protocolId: protocol.id, approvedBy: session.userId },
  });

  return protocol;
}

export function proposeAutoOptimizeIncrement(
  protocolId: string,
  session: AuthSession
): AutoOptimizeProposal {
  const protocol = getAutoOptimizeProtocol(protocolId);
  if (!protocol) {
    throw new AutoOptimizeError(404, 'Protocol not found.');
  }
  if (protocol.status !== 'approved') {
    throw new AutoOptimizeError(
      403,
      `Protocol status is "${protocol.status}". Explicit human approval is required before proposing increments.`
    );
  }
  if (protocol.runs.length >= protocol.maximumExperiments) {
    protocol.status = 'budget_exhausted';
    throw new AutoOptimizeError(
      400,
      `Maximum experiments (${protocol.maximumExperiments}) reached for this protocol.`
    );
  }
  if (protocol.spentBudget >= protocol.budget) {
    protocol.status = 'budget_exhausted';
    throw new AutoOptimizeError(400, 'Protocol budget exhausted.');
  }

  const paramName = protocol.parameter.name;
  const [low, high] = protocol.bounds[paramName];
  const currentVal = protocol.currentParameters[paramName];
  const step = protocol.parameter.step;

  // Conservative deterministic incremental baseline (never exceeds bounds)
  let delta = step;
  const lastTwo = protocol.runs.slice(0, 2);
  if (lastTwo.length === 2) {
    const improved =
      protocol.objective === 'maximize'
        ? lastTwo[0].reward >= lastTwo[1].reward
        : lastTwo[0].reward <= lastTwo[1].reward;
    const prevParam = lastTwo[0].parametersSnapshot[paramName] ?? currentVal;
    const olderParam = lastTwo[1].parametersSnapshot[paramName] ?? currentVal;
    const lastDir = prevParam >= olderParam ? 1 : -1;
    delta = (improved ? lastDir : -lastDir) * step;
  }

  let nextVal = Number((currentVal + delta).toFixed(4));
  if (nextVal > high) {
    nextVal = Number(Math.max(low, currentVal - step).toFixed(4));
  } else if (nextVal < low) {
    nextVal = Number(Math.min(high, currentVal + step).toFixed(4));
  }

  const direction: AutoOptimizeProposal['direction'] =
    nextVal > currentVal ? 'increase' : nextVal < currentVal ? 'decrease' : 'hold';

  const proposal: AutoOptimizeProposal = {
    proposalId: `prop-${crypto.randomUUID().slice(0, 8)}`,
    protocolId: protocol.id,
    parameter: paramName,
    oldValue: currentVal,
    newValue: nextVal,
    direction,
    plannerNotice:
      'Conservative bounded heuristic proposal (software-only). Not a trained RL/A3C agent or Bayesian optimizer.',
    executionMode: 'software_only',
    physicalExecution: false,
    createdAt: new Date().toISOString(),
  };

  protocol.lastProposal = proposal;
  protocol.currentParameters[paramName] = nextVal;

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: 'auto-optimize:propose-increment',
    rawInput: JSON.stringify(proposal),
    modelOrEngine: 'bounded-heuristic-planner',
    licenses: ['Software-Only Proposal'],
    sourceUrls: [],
  });

  return proposal;
}

export function computeConstrainedReward(
  metrics: AutoOptimizeMeasurement,
  safetyLimit = 0.8
): number {
  if (metrics.safety < safetyLimit) {
    throw new AutoOptimizeError(
      422,
      `Safety threshold (${safetyLimit}) not met (observed ${metrics.safety}); reward rejected.`
    );
  }
  const normalizedCostPenalty = 0.15 * Math.min(metrics.cost, 1.0);
  const raw =
    0.5 * metrics.efficiency +
    0.3 * metrics.safety +
    0.05 * metrics.novelty -
    normalizedCostPenalty;
  return Number(raw.toFixed(4));
}

async function maybeSendSlackAlert(message: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL || '#research';
  if (!token) return false;

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text: message }),
    });
    const payload = (await res.json()) as { ok?: boolean };
    return Boolean(payload.ok);
  } catch {
    return false;
  }
}

export async function recordAutoOptimizeResult(
  protocolId: string,
  input: {
    measurements: AutoOptimizeMeasurement;
    experimentCost: number;
    proposalId?: string;
    executor: 'human_verified' | 'isolated_sim_bridge';
  },
  session: AuthSession
): Promise<{
  run: AutoOptimizeExperimentRun;
  protocol: AutoOptimizeProtocol;
  isNewBest: boolean;
  slackAlertSent: boolean;
}> {
  const protocol = getAutoOptimizeProtocol(protocolId);
  if (!protocol) {
    throw new AutoOptimizeError(404, 'Protocol not found.');
  }
  if (protocol.status !== 'approved' && protocol.status !== 'locked') {
    throw new AutoOptimizeError(
      403,
      'Protocol must be human-approved before recording experimental measurements.'
    );
  }
  if (input.experimentCost > protocol.maximumCostPerExperiment) {
    throw new AutoOptimizeError(
      400,
      `Experiment cost (${input.experimentCost}) exceeds per-experiment cap (${protocol.maximumCostPerExperiment}).`
    );
  }
  if (protocol.spentBudget + input.experimentCost > protocol.budget) {
    throw new AutoOptimizeError(400, 'Experiment cost would exceed protocol budget.');
  }

  let reward: number;
  try {
    reward = computeConstrainedReward(input.measurements, protocol.safetyLimit);
  } catch (err) {
    recordProvenance({
      kind: 'feedback',
      actorId: session.userId,
      actorRole: session.role,
      action: 'auto-optimize:safety-rejected',
      rawInput: JSON.stringify(input.measurements),
      modelOrEngine: 'safety-constraint-gate',
      licenses: ['Safety Rejection Audit'],
      sourceUrls: [],
    });
    throw err;
  }

  const runId = `exp-${crypto.randomUUID().slice(0, 8)}`;
  const snapshot = { ...protocol.currentParameters };
  const stateHash = computeStateHash({
    runId,
    snapshot,
    measurements: input.measurements,
    reward,
  });

  const run: AutoOptimizeExperimentRun = {
    experimentId: runId,
    protocolId: protocol.id,
    proposalId: input.proposalId ?? protocol.lastProposal?.proposalId,
    parametersSnapshot: snapshot,
    measurements: input.measurements,
    reward,
    cost: input.experimentCost,
    status: 'evaluated',
    executor: input.executor,
    stateHash,
    createdAt: new Date().toISOString(),
  };

  protocol.runs.unshift(run);
  protocol.spentBudget = Number((protocol.spentBudget + input.experimentCost).toFixed(2));
  if (
    protocol.runs.length >= protocol.maximumExperiments ||
    protocol.spentBudget >= protocol.budget
  ) {
    protocol.status = 'budget_exhausted';
  }

  let isNewBest = false;
  if (!protocol.locked) {
    const currentBest = protocol.bestReward;
    const better =
      currentBest === undefined ||
      (protocol.objective === 'maximize' ? reward > currentBest : reward < currentBest);
    if (better) {
      protocol.bestReward = reward;
      protocol.bestExperimentId = run.experimentId;
      protocol.bestParameters = { ...snapshot };
      isNewBest = true;
    }
  }

  protocol.stateHash = computeStateHash({
    id: protocol.id,
    runs: protocol.runs.length,
    bestReward: protocol.bestReward,
    spentBudget: protocol.spentBudget,
  });

  recordProvenance({
    kind: 'simulation',
    actorId: session.userId,
    actorRole: session.role,
    action: 'auto-optimize:record-result',
    rawInput: JSON.stringify(run),
    modelOrEngine: input.executor,
    licenses: ['Audited Experiment Result'],
    sourceUrls: [],
    metadata: {
      protocolId: protocol.id,
      reward,
      isNewBest,
    },
  });

  publishFluxEvent({
    topic: 'simulation.telemetry',
    key: protocol.id,
    actorRole: session.role,
    summary: `AutoOptimizeAI recorded ${run.experimentId} (reward=${reward}, safety=${input.measurements.safety})`,
    payload: {
      protocolId: protocol.id,
      experimentId: run.experimentId,
      reward,
      isNewBest,
    },
  });

  const slackAlertSent = isNewBest
    ? await maybeSendSlackAlert(
        `New best protocol "${protocol.name}" (${run.experimentId}): reward=${reward}`
      )
    : false;

  logger.info('auto-optimize', 'Recorded constrained experiment result', {
    protocolId: protocol.id,
    experimentId: run.experimentId,
    reward,
    isNewBest,
  });

  return { run, protocol, isNewBest, slackAlertSent };
}

export function toggleAutoOptimizeLock(
  protocolId: string,
  session: AuthSession
): AutoOptimizeProtocol {
  const protocol = getAutoOptimizeProtocol(protocolId);
  if (!protocol) {
    throw new AutoOptimizeError(404, 'Protocol not found.');
  }
  protocol.locked = !protocol.locked;
  if (protocol.locked && protocol.status === 'approved') {
    protocol.status = 'locked';
  } else if (!protocol.locked && protocol.status === 'locked') {
    protocol.status = 'approved';
  }
  protocol.stateHash = computeStateHash({
    id: protocol.id,
    locked: protocol.locked,
    bestExperimentId: protocol.bestExperimentId,
  });

  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'auto-optimize:registry-lock-toggle',
    rawInput: `${protocol.id}:locked=${protocol.locked}`,
    modelOrEngine: 'registry-lock',
    licenses: ['Governance Lock'],
    sourceUrls: [],
  });

  return protocol;
}

function detectLanguageHeuristic(text: string): string {
  const sample = text.trim().slice(0, 10000);
  if (sample.length < 20) return 'unknown';
  const hebrewMatches = sample.match(/[\u0590-\u05FF]/g)?.length ?? 0;
  const latinMatches = sample.match(/[A-Za-z]/g)?.length ?? 0;
  if (hebrewMatches > latinMatches * 0.35 && hebrewMatches >= 6) return 'he';
  if (latinMatches >= 10) return 'en';
  return 'unknown';
}

export function extractStructuredEntities(text: string): AutoOptimizeEntity[] {
  const patterns: Array<{ type: AutoOptimizeEntity['type']; regex: RegExp }> = [
    {
      type: 'email',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
    {
      type: 'doi',
      regex: /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/g,
    },
    {
      type: 'url',
      regex: /https?:\/\/[^\s<>]+/g,
    },
    {
      type: 'year',
      regex: /\b(?:18|19|20|21)\d{2}\b/g,
    },
    {
      type: 'number',
      regex: /\b\d+(?:\.\d+)?(?:\s?%|\s?(?:mg|g|kg|ml|L|K|atm))\b/gi,
    },
  ];

  const entities: AutoOptimizeEntity[] = [];
  for (const { type, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type,
        start: match.index,
        end: match.index + match[0].length,
      });
      if (entities.length >= 120) break;
    }
  }

  // Frequent domain keyword baseline (top 6 non-trivial words)
  const counts = new Map<string, number>();
  const words = text.match(/\b[A-Za-z][A-Za-z0-9-]{4,}\b/g) ?? [];
  const stopWords = new Set(['their', 'which', 'about', 'there', 'where', 'these', 'those', 'using', 'under', 'between', 'study']);
  for (const w of words) {
    const low = w.toLowerCase();
    if (!stopWords.has(low)) {
      counts.set(low, (counts.get(low) ?? 0) + 1);
    }
  }
  const topKeywords = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  for (const [kw] of topKeywords) {
    const idx = text.toLowerCase().indexOf(kw);
    entities.push({
      text: kw,
      type: 'keyword',
      start: idx >= 0 ? idx : 0,
      end: idx >= 0 ? idx + kw.length : kw.length,
    });
  }

  return entities;
}

async function probeOllamaEmbedding(text: string): Promise<number[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 850);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text.slice(0, 6000) }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    return Array.isArray(data.embeddings) && data.embeddings[0]
      ? data.embeddings[0]
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAutoOptimizeEntityPipeline(
  input: {
    filename?: string;
    text?: string;
    uploadId?: string;
  },
  session: AuthSession
): Promise<AutoOptimizeIngestedDoc> {
  let effectiveText = input.text?.trim() ?? '';
  let effectiveFilename = input.filename?.trim() || 'research-note.txt';

  if (input.uploadId) {
    const found = getAllUploadFullText(input.uploadId);
    if (!found) {
      throw new AutoOptimizeError(404, 'Referenced All-Upload artifact not found.');
    }
    effectiveText = found.fullText.trim();
    effectiveFilename = found.record.filename;
  }

  if (effectiveText.length < 10) {
    throw new AutoOptimizeError(
      400,
      'Provide document text (>= 10 characters) or a valid All-Upload uploadId.'
    );
  }

  const documentId = `aodoc-${crypto.randomUUID().slice(0, 8)}`;
  const language = detectLanguageHeuristic(effectiveText);
  const entities = extractStructuredEntities(effectiveText);
  const embedding = await probeOllamaEmbedding(effectiveText);

  for (const ent of entities) {
    entityGraph.unshift({
      documentId,
      filename: effectiveFilename,
      name: ent.text,
      entityType: ent.type,
      language,
    });
  }
  if (entityGraph.length > 2000) {
    entityGraph.length = 2000;
  }

  const prov = recordProvenance({
    kind: 'corpus_ingest',
    actorId: session.userId,
    actorRole: session.role,
    action: 'auto-optimize:nlp-graph-link',
    rawInput: `${effectiveFilename}:${effectiveText.slice(0, 1500)}`,
    modelOrEngine: embedding ? `ollama:${OLLAMA_EMBED_MODEL}` : 'regex-entity-graph',
    licenses: ['Analyzed Research Text'],
    sourceUrls: [],
    metadata: {
      documentId,
      language,
      entitiesCount: entities.length,
    },
  });

  const record: AutoOptimizeIngestedDoc = {
    documentId,
    filename: effectiveFilename,
    language,
    textLength: effectiveText.length,
    entitiesCount: entities.length,
    entities,
    embeddingGenerated: Boolean(embedding),
    embeddingDimensions: embedding?.length ?? 0,
    auditId: prov.id,
    createdAt: new Date().toISOString(),
  };

  ingestedDocs.unshift(record);
  if (ingestedDocs.length > 50) ingestedDocs.length = 50;

  return record;
}

export function searchAutoOptimizeGraph(term = '', limit = 50): {
  docs: AutoOptimizeIngestedDoc[];
  matches: Array<{
    documentId: string;
    filename: string;
    name: string;
    entityType: string;
    language: string;
  }>;
} {
  const clean = term.trim().toLowerCase();
  const matches = clean
    ? entityGraph.filter(
        (e) =>
          e.name.toLowerCase().includes(clean) ||
          e.entityType.toLowerCase().includes(clean) ||
          e.filename.toLowerCase().includes(clean)
      )
    : entityGraph;

  return {
    docs: ingestedDocs.slice(0, 20),
    matches: matches.slice(0, limit),
  };
}

export function getAutoOptimizeStatus(): AutoOptimizeStatusSummary {
  return {
    physicalExecution: false,
    slackConfigured: Boolean(process.env.SLACK_BOT_TOKEN),
    ollamaUrl: OLLAMA_URL,
    implementedStages: [
      { stage: 'Ingest-File', detail: 'Connected to INTEL All-Upload (PDF, DOCX, CSV, JSON, TXT, MD) & direct text' },
      { stage: 'Lang-Detect', detail: 'Bilingual English / Hebrew / Latin heuristic baseline' },
      { stage: 'NLP-Extract', detail: 'Regex DOI, URL, Email, Year, Units + top domain keywords' },
      { stage: 'Embed-Context', detail: 'Optional live local Ollama /api/embed probe' },
      { stage: 'Graph-Link', detail: 'In-memory searchable document-entity graph' },
      { stage: 'Policy-Planner', detail: 'Conservative bounded incremental baseline' },
      { stage: 'Executor-Call', detail: 'Software-only & isolated simulation adapter boundary' },
      { stage: 'Measure-Collect', detail: 'Validated efficiency, safety, cost, and novelty schema' },
      { stage: 'Eval-Reward', detail: 'Hard safety threshold constraint (default >= 0.80) + weighted score' },
      { stage: 'Learner-Update', detail: 'Protocol run history & SHA-256 state hash chain' },
      { stage: 'Registry-Lock', detail: 'Best-protocol registry with governance lock toggle' },
      { stage: 'Alert-System', detail: 'Optional live Slack Web API alert when SLACK_BOT_TOKEN is set' },
      { stage: 'Audit-Trail', detail: 'Unified INTEL cryptographic provenance ledger' },
    ],
    notClaimed: [
      'OCR engine for scanned images',
      'Trained RL / A3C policy',
      'Bayesian optimization',
      'Physical laboratory hardware or robot control',
      'Clinical / patient decision support',
    ],
  };
}
