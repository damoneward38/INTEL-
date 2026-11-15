import type {
  AllUploadCapabilities,
  AllUploadPlanResponse,
  AllUploadRecord,
  AuthSession,
  AutoOptimizeExperimentRun,
  AutoOptimizeIngestedDoc,
  AutoOptimizeMeasurement,
  AutoOptimizeParameterSpec,
  AutoOptimizeProposal,
  AutoOptimizeProtocol,
  AutoOptimizeStatusSummary,
  CorpusChunk,
  DirectoryAccount,
  EcoAuditReport,
  EcoRegionSpec,
  EnterpriseCheckoutOrder,
  EnterpriseOverviewResponse,
  EnterpriseQuoteResult,
  EnterpriseTierId,
  FeedbackRecord,
  FluxEvent,
  GrantDraft,
  LaunchChecklistItem,
  LicenseRecord,
  LogEntry,
  MarketDataset,
  MarketTransaction,
  MentorMemoryNote,
  MentorRiskAlert,
  NarrativeNode,
  OrchestratorAuditEntry,
  OrchestratorRunResult,
  PartnerPayoutRecord,
  PgxEvidenceMatch,
  PgxSampleSummary,
  ProvenanceRecord,
  ResearchDepth,
  ResearchResult,
  RetrievedSource,
  RubricGradeResult,
  SandboxPeer,
  SandboxSnapshot,
  SimulationEngine,
  SimulationJobResponse,
  SimulationParameters,
  ThoughtPrototype,
  UiButtonAuditItem,
  UiButtonAuditSummary,
  WhiteLabelConfig,
} from '../types';

const TOKEN_STORAGE_KEY = 'intel_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function fetchSession(): Promise<{ session: AuthSession }> {
  return apiFetch('/api/auth/session');
}

export async function fetchDirectoryAccounts(): Promise<{ accounts: DirectoryAccount[] }> {
  return apiFetch('/api/auth/directory');
}

export async function loginWithCredentials(
  roleOrEmail: string,
  accessCode?: string
): Promise<{ token: string; session: AuthSession }> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ roleOrEmail, accessCode }),
  });
}

export async function signupAccountApi(payload: {
  name: string;
  email: string;
  organization?: string;
  role: 'researcher' | 'principal_investigator';
  accessCode: string;
}): Promise<{ token: string; session: AuthSession }> {
  return apiFetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runResearchApi(payload: {
  query: string;
  language: 'en' | 'he';
  depth: ResearchDepth;
  inputMode?: 'text' | 'voice';
}): Promise<ResearchResult> {
  return apiFetch('/api/research', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchCorpusApi(domain?: string): Promise<{
  domains: string[];
  chunks: CorpusChunk[];
}> {
  const qs = domain && domain !== 'all' ? `?domain=${encodeURIComponent(domain)}` : '';
  return apiFetch(`/api/corpus${qs}`);
}

export async function searchRetrievalApi(
  query: string,
  limit = 8
): Promise<{ query: string; limit: number; results: RetrievedSource[] }> {
  return apiFetch(
    `/api/retrieval/search?q=${encodeURIComponent(query)}&limit=${limit}`
  );
}

export async function ingestCorpusApi(doc: {
  title: string;
  authors: string;
  domain: string;
  license: string;
  sourceUrl: string;
  content: string;
}): Promise<{ chunks: CorpusChunk[]; provenanceId: string }> {
  return apiFetch('/api/corpus/ingest', {
    method: 'POST',
    body: JSON.stringify(doc),
  });
}

export async function startExternalIngestionApi(payload: {
  source: 'pubmed' | 'arxiv' | 'wikidata' | 'gutenberg';
  query: string;
  limit: number;
}): Promise<{
  source: string;
  query: string;
  documentsFetched: number;
  chunksIndexed: number;
  chunks: CorpusChunk[];
  provenanceId: string;
}> {
  return apiFetch('/api/ingestion/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function submitFeedbackApi(payload: {
  provenanceId: string;
  question: string;
  answerExcerpt: string;
  rating: number;
  comments?: string;
  reviewDecision?: 'approved' | 'needs_revision' | 'flagged';
}): Promise<FeedbackRecord> {
  return apiFetch('/api/feedback/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchFeedbackApi(): Promise<{ feedback: FeedbackRecord[] }> {
  return apiFetch('/api/feedback');
}

export async function fetchLicensesApi(): Promise<{ licenses: LicenseRecord[] }> {
  return apiFetch('/api/governance/licenses');
}

export async function verifyLicenseApi(
  docId: string,
  updates: Partial<Pick<LicenseRecord, 'verified' | 'commercialUseAllowed' | 'trainingAllowed'>>
): Promise<{ license: LicenseRecord }> {
  return apiFetch(`/api/governance/licenses/${encodeURIComponent(docId)}/verify`, {
    method: 'POST',
    body: JSON.stringify(updates),
  });
}

export async function submitSimulationApi(
  parameters: SimulationParameters
): Promise<SimulationJobResponse> {
  return apiFetch('/api/simulation/run', {
    method: 'POST',
    body: JSON.stringify(parameters),
  });
}

export async function fetchSimulationJobApi(
  jobId: string
): Promise<SimulationJobResponse> {
  return apiFetch(`/api/simulation/${encodeURIComponent(jobId)}`);
}

export async function cancelSimulationApi(
  jobId: string
): Promise<SimulationJobResponse> {
  return apiFetch(`/api/simulation/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
}

export async function fetchProvenanceApi(): Promise<{
  privileged: boolean;
  records: ProvenanceRecord[];
}> {
  return apiFetch('/api/provenance');
}

export async function fetchServerLogsApi(): Promise<{ logs: LogEntry[] }> {
  return apiFetch('/api/logs');
}

export async function fetchFluxEventsApi(topic = 'all'): Promise<{
  stats: { totalEvents: number; topics: Record<string, number>; deduplicatedDigests: number };
  events: FluxEvent[];
}> {
  return apiFetch(`/api/flux/events?topic=${encodeURIComponent(topic)}`);
}

export async function fetchSandboxStateApi(roomId: string): Promise<{
  roomId: string;
  stateBase64: string;
  peers: SandboxPeer[];
  snapshots: SandboxSnapshot[];
}> {
  return apiFetch(`/api/sandbox/${encodeURIComponent(roomId)}`);
}

export async function createSandboxSnapshotApi(
  roomId: string,
  title: string
): Promise<{ snapshot: SandboxSnapshot }> {
  return apiFetch(`/api/sandbox/${encodeURIComponent(roomId)}/snapshot`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function restoreSandboxSnapshotApi(
  roomId: string,
  snapshotId: string
): Promise<{ stateBase64: string }> {
  return apiFetch(
    `/api/sandbox/${encodeURIComponent(roomId)}/restore/${encodeURIComponent(snapshotId)}`,
    { method: 'POST' }
  );
}

export async function fetchThoughtPrototypesApi(): Promise<{
  ollama: { reachable: boolean; url: string; models: string[] };
  prototypes: ThoughtPrototype[];
}> {
  return apiFetch('/api/prototypes');
}

export async function generateThoughtPrototypeApi(payload: {
  hypothesis: string;
  language: 'en' | 'he';
  preferOllama?: boolean;
}): Promise<{ prototype: ThoughtPrototype }> {
  return apiFetch('/api/prototypes/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPgxSamplesApi(): Promise<{ samples: PgxSampleSummary[] }> {
  return apiFetch('/api/pgx/samples');
}

export async function uploadPgxSampleApi(payload: {
  sampleAlias: string;
  genomicPayload: string;
  consentGranted: boolean;
  consentScope: string;
}): Promise<{ summary: PgxSampleSummary; evidenceMatchesCount: number }> {
  return apiFetch('/api/pgx/upload', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function analyzePgxSampleApi(sampleId: string): Promise<{
  summary: PgxSampleSummary;
  evidence: PgxEvidenceMatch[];
  clinicalPolicyNotice: string;
}> {
  return apiFetch(`/api/pgx/samples/${encodeURIComponent(sampleId)}/analyze`, {
    method: 'POST',
  });
}

export async function revokePgxConsentApi(
  sampleId: string
): Promise<{ summary: PgxSampleSummary }> {
  return apiFetch(`/api/pgx/samples/${encodeURIComponent(sampleId)}/revoke`, {
    method: 'POST',
  });
}

export async function fetchNarrativeTimelineApi(): Promise<{
  nodes: NarrativeNode[];
  edges: Array<{ from: string; to: string; relation: string }>;
}> {
  return apiFetch('/api/narrative/timeline');
}

export async function fetchEcoAuditApi(region = 'us-west1'): Promise<{
  regions: EcoRegionSpec[];
  report: EcoAuditReport;
}> {
  return apiFetch(`/api/eco/audit?region=${encodeURIComponent(region)}`);
}

export async function fetchMarketCatalogApi(): Promise<{
  datasets: MarketDataset[];
  transactions: MarketTransaction[];
}> {
  return apiFetch('/api/market/datasets');
}

export async function acquireMarketDatasetApi(payload: {
  datasetId: string;
  indexIntoCorpus: boolean;
}): Promise<{
  transaction: MarketTransaction;
  dataset: MarketDataset;
  indexedChunks: CorpusChunk[];
}> {
  return apiFetch('/api/market/acquire', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchGrantDraftsApi(): Promise<{ drafts: GrantDraft[] }> {
  return apiFetch('/api/grants');
}

export async function generateGrantDraftApi(payload: {
  topic: string;
  template: GrantDraft['template'];
  budgetCapUsd: number;
  durationMonths: number;
  language: 'en' | 'he';
}): Promise<{ draft: GrantDraft }> {
  return apiFetch('/api/grants/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchMentorInsightsApi(): Promise<{
  risks: { alerts: MentorRiskAlert[]; memoryCount: number; memoryEnabled: boolean };
  memory: { memoryEnabled: boolean; notes: MentorMemoryNote[] };
}> {
  return apiFetch('/api/mentor/insights');
}

export async function toggleMentorMemoryApi(enabled: boolean): Promise<{ memoryEnabled: boolean }> {
  return apiFetch('/api/mentor/memory/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export async function addMentorMemoryApi(
  topic: string,
  content: string
): Promise<{ note: MentorMemoryNote }> {
  return apiFetch('/api/mentor/memory', {
    method: 'POST',
    body: JSON.stringify({ topic, content }),
  });
}

export async function deleteMentorMemoryApi(noteId: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/mentor/memory/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
  });
}

export async function clearAllMentorMemoryApi(): Promise<{ cleared: boolean }> {
  return apiFetch('/api/mentor/memory', { method: 'DELETE' });
}

export async function fetchAllUploadCapabilitiesApi(): Promise<AllUploadCapabilities> {
  return apiFetch('/api/all-upload/capabilities');
}

export async function fetchAllUploadHistoryApi(): Promise<{ uploads: AllUploadRecord[] }> {
  return apiFetch('/api/all-upload/history');
}

export async function uploadScientificFileApi(file: File): Promise<AllUploadRecord> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch('/api/all-upload/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function createAllUploadPlanApi(payload: {
  researchQuestion: string;
  domain: string;
  context: string;
  uploadId?: string;
  useGemini?: boolean;
}): Promise<AllUploadPlanResponse> {
  return apiFetch('/api/all-upload/plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function indexAllUploadToCorpusApi(
  uploadId: string,
  payload: {
    title: string;
    authors: string;
    domain: string;
    license: string;
    sourceUrl: string;
  }
): Promise<{ chunks: CorpusChunk[]; provenanceId: string }> {
  return apiFetch(`/api/all-upload/${encodeURIComponent(uploadId)}/index-corpus`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchEnterpriseOverviewApi(): Promise<EnterpriseOverviewResponse> {
  return apiFetch('/api/enterprise/overview');
}

export async function calculateEnterpriseQuoteApi(payload: {
  tier: EnterpriseTierId;
  numUsers: number;
  customization: boolean;
  billingCycle: 'monthly' | 'yearly';
}): Promise<{ quote: EnterpriseQuoteResult }> {
  return apiFetch('/api/enterprise/quote', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateWhiteLabelConfigApi(payload: {
  enabled: boolean;
  brandName: string;
  brandNameHe: string;
  tagline: string;
  taglineHe: string;
  accentColor: WhiteLabelConfig['accentColor'];
  customDomain: string;
  hipaaReady?: boolean;
  iso27001Controls?: boolean;
}): Promise<{ whiteLabel: WhiteLabelConfig }> {
  return apiFetch('/api/enterprise/whitelabel', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function toggleChecklistItemApi(
  itemId: string
): Promise<{ checklist: LaunchChecklistItem[] }> {
  return apiFetch(`/api/enterprise/checklist/${encodeURIComponent(itemId)}/toggle`, {
    method: 'POST',
  });
}

export async function gradeRubricSubmissionApi(payload: {
  title: string;
  submissionText: string;
}): Promise<{ result: RubricGradeResult }> {
  return apiFetch('/api/enterprise/rubric/grade', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function submitEnterpriseCheckoutApi(payload: {
  tier: EnterpriseTierId;
  numUsers: number;
  customization: boolean;
  billingCycle: 'monthly' | 'yearly';
  organization: string;
  billingEmail: string;
  partnerName?: string;
  partnerEmail?: string;
  activateTrialFirst: boolean;
}): Promise<{
  order: EnterpriseCheckoutOrder;
  payout: PartnerPayoutRecord;
  quote: EnterpriseQuoteResult;
}> {
  return apiFetch('/api/enterprise/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function settlePartnerPayoutApi(
  payoutId: string
): Promise<{ payout: PartnerPayoutRecord }> {
  return apiFetch(
    `/api/enterprise/payouts/${encodeURIComponent(payoutId)}/settle`,
    { method: 'POST' }
  );
}

export async function fetchAutoOptimizeStatusApi(): Promise<AutoOptimizeStatusSummary> {
  return apiFetch('/api/auto-optimize/status');
}

export async function fetchAutoOptimizeProtocolsApi(): Promise<{
  protocols: AutoOptimizeProtocol[];
}> {
  return apiFetch('/api/auto-optimize/protocols');
}

export async function createAutoOptimizeProtocolApi(payload: {
  name: string;
  objective: 'maximize' | 'minimize';
  parameter: AutoOptimizeParameterSpec;
  budget: number;
  maximumExperiments: number;
  maximumCostPerExperiment: number;
  safetyLimit: number;
  safetyAcknowledged: boolean;
}): Promise<{ protocol: AutoOptimizeProtocol }> {
  return apiFetch('/api/auto-optimize/protocols', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function approveAutoOptimizeProtocolApi(
  protocolId: string
): Promise<{ protocol: AutoOptimizeProtocol }> {
  return apiFetch(
    `/api/auto-optimize/protocols/${encodeURIComponent(protocolId)}/approve`,
    { method: 'POST' }
  );
}

export async function proposeAutoOptimizeIncrementApi(
  protocolId: string
): Promise<{ proposal: AutoOptimizeProposal; protocol: AutoOptimizeProtocol }> {
  return apiFetch(
    `/api/auto-optimize/protocols/${encodeURIComponent(protocolId)}/propose`,
    { method: 'POST' }
  );
}

export async function recordAutoOptimizeResultApi(
  protocolId: string,
  payload: {
    measurements: AutoOptimizeMeasurement;
    experimentCost: number;
    proposalId?: string;
    executor: 'human_verified' | 'isolated_sim_bridge';
  }
): Promise<{
  run: AutoOptimizeExperimentRun;
  protocol: AutoOptimizeProtocol;
  isNewBest: boolean;
  slackAlertSent: boolean;
}> {
  return apiFetch(
    `/api/auto-optimize/protocols/${encodeURIComponent(protocolId)}/results`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function toggleAutoOptimizeLockApi(
  protocolId: string
): Promise<{ protocol: AutoOptimizeProtocol }> {
  return apiFetch(
    `/api/auto-optimize/protocols/${encodeURIComponent(protocolId)}/lock`,
    { method: 'POST' }
  );
}

export async function runAutoOptimizeEntityPipelineApi(payload: {
  filename?: string;
  text?: string;
  uploadId?: string;
}): Promise<{ document: AutoOptimizeIngestedDoc }> {
  return apiFetch('/api/auto-optimize/ingest', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAutoOptimizeGraphApi(q = ''): Promise<{
  docs: AutoOptimizeIngestedDoc[];
  matches: Array<{
    documentId: string;
    filename: string;
    name: string;
    entityType: string;
    language: string;
  }>;
}> {
  return apiFetch(`/api/auto-optimize/graph?q=${encodeURIComponent(q)}`);
}

export async function fetchOrchestratorAuditsApi(): Promise<{
  auditLogPath: string;
  runs: OrchestratorRunResult[];
  uiAudits: UiButtonAuditSummary[];
  auditRecords: OrchestratorAuditEntry[];
}> {
  return apiFetch('/api/orchestrator/audits');
}

export async function runMasterOrchestratorApi(payload: {
  file?: File;
  uploadId?: string;
  filename?: string;
  text?: string;
  engine: SimulationEngine;
  safetyLimit?: number;
  enableSimulator?: boolean;
  lockIfBest?: boolean;
}): Promise<OrchestratorRunResult> {
  if (payload.file) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('engine', payload.engine);
    if (payload.safetyLimit !== undefined) {
      form.append('safetyLimit', String(payload.safetyLimit));
    }
    form.append('enableSimulator', String(Boolean(payload.enableSimulator)));
    form.append('lockIfBest', String(Boolean(payload.lockIfBest)));
    return apiFetch('/api/orchestrator/run', {
      method: 'POST',
      body: form,
    });
  }

  return apiFetch('/api/orchestrator/run', {
    method: 'POST',
    body: JSON.stringify({
      uploadId: payload.uploadId,
      filename: payload.filename,
      text: payload.text,
      engine: payload.engine,
      safetyLimit: payload.safetyLimit,
      enableSimulator: Boolean(payload.enableSimulator),
      lockIfBest: payload.lockIfBest,
    }),
  });
}

export async function submitUiButtonAuditApi(payload: {
  harnessMode: UiButtonAuditSummary['harnessMode'];
  targetUrl: string;
  viewsVisited: string[];
  results: UiButtonAuditItem[];
}): Promise<{ summary: UiButtonAuditSummary }> {
  return apiFetch('/api/orchestrator/ui-audit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}




