export type UserRole = 'guest' | 'researcher' | 'principal_investigator' | 'auditor';

export type ResearchDepth = 'standard' | 'deep' | 'comprehensive';

export type SimulationEngine = 'langevin-md' | 'verlet-nve' | 'psi4-scf' | 'blast-align';

export interface AuthSession {
  userId: string;
  name: string;
  email: string;
  organization?: string;
  role: UserRole;
  issuedAt: string;
  expiresAt: string;
}

export interface LicenseRecord {
  source: string;
  documentId: string;
  license: string;
  verified: boolean;
  attribution: string;
  commercialUseAllowed: boolean;
  trainingAllowed: boolean;
  version: number;
  updatedAt: string;
}

export interface CorpusDocumentInput {
  title: string;
  authors: string;
  domain: string;
  license: string;
  sourceUrl: string;
  content: string;
  source?: string;
  verified?: boolean;
  commercialUseAllowed?: boolean;
  trainingAllowed?: boolean;
}

export interface CorpusChunk {
  id: string;
  docId: string;
  title: string;
  authors: string;
  domain: string;
  license: string;
  sourceUrl: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  version: number;
  licenseRecord: LicenseRecord;
  ingestedAt: string;
}

export interface RetrievedSource {
  id: string;
  title: string;
  authors?: string;
  domain?: string;
  license: string;
  licenseVerified?: boolean;
  trainingAllowed?: boolean;
  sourceUrl: string;
  text: string;
  score: number;
  origin: 'indexed_corpus' | 'google_search';
}

export interface ResearchRequestPayload {
  query: string;
  language: 'en' | 'he';
  depth: ResearchDepth;
  inputMode?: 'text' | 'voice';
}

export interface ResearchResponsePayload {
  provenanceId: string;
  query: string;
  language: 'en' | 'he';
  depth: ResearchDepth;
  model: string;
  answer: string;
  sources: RetrievedSource[];
  corpusHits: number;
  webHits: number;
  durationMs: number;
  reviewStatus: 'pending_human_review' | 'reviewed_approved' | 'flagged';
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  provenanceId: string;
  question: string;
  answerExcerpt: string;
  rating: number;
  comments: string;
  reviewDecision: 'approved' | 'needs_revision' | 'flagged';
  reviewerId: string;
  reviewerRole: UserRole;
  autoTrainingBlocked: true;
  createdAt: string;
}

export interface SimulationParameters {
  engine: SimulationEngine;
  temperature: number;
  pressure: number;
  steps: number;
  particleCount?: number;
}

export interface SimulationFrame {
  step: number;
  timePs: number;
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  temperatureInst: number;
  pressureInst: number;
  rmsd: number;
}

export interface ReferenceValidation {
  benchmarkName: string;
  expectedRange: string;
  observedValue: string;
  passed: boolean;
}

export interface SimulationJob {
  jobId: string;
  engine: SimulationEngine;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  parameters: SimulationParameters;
  frames: SimulationFrame[];
  particles: Array<[number, number, number]>;
  summary?: {
    meanTempK: number;
    meanPressureAtm: number;
    meanTotalEnergy: number;
    finalRmsd: number;
    elapsedMs: number;
  };
  referenceValidation?: ReferenceValidation;
  error?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProvenanceRecord {
  id: string;
  kind: 'research' | 'simulation' | 'corpus_ingest' | 'auth' | 'feedback';
  actorId: string;
  actorRole: UserRole;
  action: string;
  digestSha256: string;
  modelOrEngine: string;
  licenses: string[];
  sourceUrls: string[];
  metadata: Record<string, string | number | boolean>;
  timestamp: string;
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export type FluxTopic =
  | 'knowledge.ingested'
  | 'knowledge.indexed'
  | 'simulation.telemetry'
  | 'governance.audit'
  | 'sandbox.update'
  | 'vault.access'
  | 'market.transaction'
  | 'mentor.alert';

export interface FluxEvent {
  id: string;
  topic: FluxTopic;
  partition: number;
  offset: number;
  key: string;
  actorRole: UserRole;
  summary: string;
  payload: Record<string, unknown>;
  digestSha256: string;
  timestamp: string;
}

export interface SandboxSnapshot {
  snapshotId: string;
  roomId: string;
  title: string;
  createdBy: string;
  role: UserRole;
  timestamp: string;
  updateBase64: string;
  summary: {
    hypothesis: string;
    protocol: string;
    temperatureK: number;
    steps: number;
  };
}

export interface ThoughtPrototype {
  id: string;
  hypothesis: string;
  title: string;
  gatewayUsed: 'gemini-4-hydrogen' | 'ollama-local';
  variables: {
    independent: string[];
    dependent: string[];
    controls: string[];
  };
  protocolSteps: string[];
  falsificationCriteria: string;
  mermaidDiagram: string;
  citations: Array<{ id: string; title: string; sourceUrl: string; license: string }>;
  createdAt: string;
}

export interface PgxEvidenceMatch {
  gene: string;
  alleleOrVariant: string;
  phenotype: string;
  affectedDrugs: string[];
  evidenceLevel: '1A' | '1B' | '2A';
  citation: string;
  sourceUrl: string;
  uncertaintyNote: string;
}

export interface PgxSampleSummary {
  sampleId: string;
  sampleAlias: string;
  format: 'vcf' | 'star-allele' | 'fasta-header';
  consentGranted: boolean;
  consentScope: string;
  uploadedBy: string;
  variantCount: number;
  cipherAlgorithm: 'aes-256-gcm';
  digestSha256: string;
  createdAt: string;
}

export interface NarrativeNode {
  id: string;
  kind: 'corpus' | 'research' | 'simulation' | 'review' | 'prototype' | 'market';
  title: string;
  subtitle: string;
  timestamp: string;
  position: [number, number, number];
  sourceUrl?: string;
  license?: string;
  metrics?: Record<string, string | number | boolean>;
  linkedIds: string[];
}

export interface EcoRegionSpec {
  id: string;
  label: string;
  carbonIntensityGPerKwh: number;
  pue: number;
  sourceCitation: string;
}

export interface EcoAuditReport {
  region: EcoRegionSpec;
  totalEnergyKwh: number;
  totalCarbonGCo2Eq: number;
  totalWaterLiters: number;
  breakdown: Array<{
    category: 'simulations' | 'ai_inference' | 'corpus_indexing';
    count: number;
    energyKwh: number;
    carbonGCo2Eq: number;
  }>;
  recommendations: Array<{
    title: string;
    estimatedSavingsPct: number;
    rationale: string;
  }>;
  formulaSummary: string;
  generatedAt: string;
}

export interface MarketDataset {
  datasetId: string;
  title: string;
  domain: string;
  owner: string;
  license: string;
  verified: boolean;
  cidV1: string;
  sizeMb: number;
  recordsCount: number;
  summary: string;
  sourceUrl: string;
  contentSample: string;
}

export interface MarketTransaction {
  txId: string;
  datasetId: string;
  cidV1: string;
  license: string;
  buyerId: string;
  buyerRole: UserRole;
  indexedIntoCorpus: boolean;
  provenanceId: string;
  timestamp: string;
}

export interface GrantDraft {
  id: string;
  template: 'NIH-R01' | 'NSF-CAREER' | 'HORIZON-EU' | 'ISF-IL';
  title: string;
  abstract: string;
  specificAims: string[];
  methodology: string;
  budgetItems: Array<{ category: string; justification: string; amountUsd: number }>;
  milestones: Array<{ quarter: string; deliverable: string; verificationMetric: string }>;
  figurePlaceholders: Array<{ figureNumber: string; caption: string; linkedSource: string }>;
  verifiedSources: Array<{ title: string; license: string; sourceUrl: string; verified: boolean }>;
  createdAt: string;
}

export interface MentorMemoryNote {
  id: string;
  userId: string;
  topic: string;
  content: string;
  createdAt: string;
}

export interface MentorRiskAlert {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  recommendation: string;
  whyDetected: string;
  triggeredByMetrics: string[];
}

export interface AllUploadCsvProfile {
  rows: number;
  columns: number;
  columnNames: string[];
  missingCells: number;
  missingFraction: number;
  duplicateRows: number;
  inspectionError?: string;
}

export interface AllUploadFlag {
  code: string;
  severity: 'review' | 'info';
  message: string;
}

export interface AllUploadRecommendation {
  category: string;
  priority: 'high' | 'medium' | 'low';
  action: string;
}

export interface AllUploadAnalysis {
  wordCount: number;
  characterCount: number;
  detectedSections: Record<string, boolean>;
  heuristicCompletenessScore: number;
  scoreWarning: string;
  flags: AllUploadFlag[];
  recommendations: AllUploadRecommendation[];
  dataProfile: AllUploadCsvProfile | null;
  domainHint?: string;
  suggestedSimEngine?: SimulationEngine;
}

export interface AllUploadArchiveSummary {
  archiveFileCount: number;
  expandedBytes: number;
  files: Array<{ path: string; bytes: number }>;
}

export interface AllUploadRecord {
  uploadId: string;
  filename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storage: 'local';
  analysisStatus: 'completed' | 'archive_extracted_review_required';
  extractedTextBytes: number;
  extractedPreview: string;
  archive?: AllUploadArchiveSummary;
  analysis?: AllUploadAnalysis;
  uploadedBy: string;
  indexedDocId?: string;
  createdAt: string;
}

export interface AllUploadPlanResponse {
  researchQuestion: string;
  domain: string;
  status: 'draft_requires_expert_review';
  steps: Array<{ stage: string; action: string }>;
  groundedSynthesis?: string;
  modelUsed: 'deterministic' | 'gemini-4-hydrogen';
  contextReceived: boolean;
  executionEnabled: false;
  createdAt: string;
}

export interface AllUploadCapabilities {
  allowedExtensions: string[];
  maxFileBytes: number;
  maxArchiveFiles: number;
  maxArchiveExpandedBytes: number;
  ingest: string[];
  analysis: string[];
  integratedIntelCapabilities: string[];
  notYetIntegrated: string[];
  safety: {
    medicalDecisions: string;
    automatedExperimentExecution: string;
    humanReviewRequired: boolean;
  };
}

export type EnterpriseTierId = 'starter' | 'growth' | 'enterprise';

export interface PricingTierSpec {
  id: EnterpriseTierId;
  name: string;
  targetAudience: string;
  monthlyBaseUsd: number;
  vectorQuotaLabel: string;
  simulationsQuotaLabel: string;
  coreFeatures: string[];
  addOns: string[];
  trialDays: number;
  yearlyDiscountPct: number;
}

export interface EnterpriseQuoteResult {
  tier: EnterpriseTierId;
  tierName: string;
  numUsers: number;
  customization: boolean;
  billingCycle: 'monthly' | 'yearly';
  baseMonthlyUsd: number;
  perUserMonthlyUsd: number;
  seatCostMonthlyUsd: number;
  whiteLabelSetupFeeUsd: number;
  monthlyRecurringUsd: number;
  effectiveMonthlyAfterDiscountUsd: number;
  firstMonthTotalUsd: number;
  annualContractUsd: number;
  annualSavingsUsd: number;
  trialDays: number;
}

export interface WhiteLabelConfig {
  enabled: boolean;
  brandName: string;
  brandNameHe: string;
  tagline: string;
  taglineHe: string;
  accentColor: 'cyan' | 'emerald' | 'amber' | 'violet';
  customDomain: string;
  complianceSuite: {
    hipaaReady: boolean;
    iso27001Controls: boolean;
    auditRetentionDays: number;
  };
  updatedBy: string;
  updatedAt: string;
}

export interface PartnershipStage {
  step: number;
  phase: string;
  timeline: string;
  focus: string;
  deliverable: string;
  commercialModel: string;
}

export interface LaunchChecklistItem {
  id: string;
  category: string;
  task: string;
  done: boolean;
}

export interface UsageAnalyticsSummary {
  corpusChunks: number;
  totalUploads: number;
  simulationsCompleted: number;
  provenanceEvents: number;
  peerReviewsSubmitted: number;
  fluxEventsTotal: number;
  estimatedHoursSaved: number;
}

export interface RubricCriterionResult {
  criterion: string;
  maxPoints: number;
  earnedPoints: number;
  status: 'met' | 'partial' | 'missing';
  feedback: string;
}

export interface RubricGradeResult {
  title: string;
  totalScore: number;
  maxScore: number;
  gradeBand: 'Exemplary' | 'Proficient' | 'Developing' | 'Needs Revision';
  criteria: RubricCriterionResult[];
  evaluatedAt: string;
}

export interface EnterpriseCheckoutOrder {
  orderId: string;
  invoiceNumber: string;
  buyerUserId: string;
  buyerRole: UserRole;
  organization: string;
  billingEmail: string;
  partnerName: string;
  tier: EnterpriseTierId;
  tierName: string;
  numUsers: number;
  customization: boolean;
  billingCycle: 'monthly' | 'yearly';
  trialStatus: 'active_90d_trial' | 'invoiced_immediate';
  dueTodayUsd: number;
  contractTotalUsd: number;
  paymentMode: 'internal_sandbox_ledger';
  billingNotice: string;
  receiptDigestSha256: string;
  createdAt: string;
}

export interface PartnerPayoutRecord {
  payoutId: string;
  orderId: string;
  invoiceNumber: string;
  partnerName: string;
  partnerEmail: string;
  grossUsd: number;
  platformShareUsd: number;
  partnerShareUsd: number;
  splitRatio: '55/45';
  status: 'pending_payout' | 'settled';
  settlementReference?: string;
  settlementMode: 'internal_sandbox_ledger';
  settledBy?: string;
  settledAt?: string;
  createdAt: string;
}

export interface PartnerPayoutTotals {
  grossUsd: number;
  platform55Usd: number;
  partner45Usd: number;
  pendingUsd: number;
  settledUsd: number;
  orderCount: number;
  settledCount: number;
}

export interface EnterpriseQuotaStatus {
  activeTier: EnterpriseTierId;
  activeTierName: string;
  simulationsUsed: number;
  simulationsMax: number | null;
  simulationsRemaining: number | null;
  vectorQuotaMb: number;
  storageUsedMb: number;
  utilizationPct: number;
  ledgerPath: string;
  persistedAt: string;
}

export interface EnterpriseOverviewResponse {
  tiers: PricingTierSpec[];
  whiteLabel: WhiteLabelConfig;
  partnershipPlaybook: PartnershipStage[];
  checklist: LaunchChecklistItem[];
  analytics: UsageAnalyticsSummary;
  alerts: Array<{ id: string; level: 'info' | 'warn'; title: string; detail: string }>;
  orders: EnterpriseCheckoutOrder[];
  payouts: PartnerPayoutRecord[];
  payoutTotals: PartnerPayoutTotals;
  quota: EnterpriseQuotaStatus;
}

export interface AutoOptimizeParameterSpec {
  name: string;
  initial: number;
  minimum: number;
  maximum: number;
  step: number;
  unit: string;
}

export interface AutoOptimizeProposal {
  proposalId: string;
  protocolId: string;
  parameter: string;
  oldValue: number;
  newValue: number;
  direction: 'increase' | 'decrease' | 'hold';
  plannerNotice: string;
  executionMode: 'software_only';
  physicalExecution: false;
  createdAt: string;
}

export interface AutoOptimizeMeasurement {
  efficiency: number;
  safety: number;
  cost: number;
  novelty: number;
}

export interface AutoOptimizeExperimentRun {
  experimentId: string;
  protocolId: string;
  proposalId?: string;
  parametersSnapshot: Record<string, number>;
  measurements: AutoOptimizeMeasurement;
  reward: number;
  cost: number;
  status: 'evaluated' | 'rejected_safety';
  executor: 'human_verified' | 'isolated_sim_bridge';
  stateHash: string;
  createdAt: string;
}

export interface AutoOptimizeProtocol {
  id: string;
  name: string;
  objective: 'maximize' | 'minimize';
  parameter: AutoOptimizeParameterSpec;
  currentParameters: Record<string, number>;
  bounds: Record<string, [number, number]>;
  budget: number;
  spentBudget: number;
  maximumExperiments: number;
  maximumCostPerExperiment: number;
  safetyLimit: number;
  safetyAcknowledged: boolean;
  status: 'draft_pending_approval' | 'approved' | 'locked' | 'budget_exhausted';
  approvedBy?: string;
  approvedAt?: string;
  bestExperimentId?: string;
  bestReward?: number;
  bestParameters?: Record<string, number>;
  locked: boolean;
  stateHash: string;
  runs: AutoOptimizeExperimentRun[];
  lastProposal?: AutoOptimizeProposal;
  createdBy: string;
  createdAt: string;
}

export interface AutoOptimizeEntity {
  text: string;
  type: 'email' | 'doi' | 'url' | 'year' | 'number' | 'keyword';
  start: number;
  end: number;
}

export interface AutoOptimizeIngestedDoc {
  documentId: string;
  filename: string;
  language: string;
  textLength: number;
  entitiesCount: number;
  entities: AutoOptimizeEntity[];
  embeddingGenerated: boolean;
  embeddingDimensions: number;
  auditId: string;
  createdAt: string;
}

export interface AutoOptimizeStatusSummary {
  physicalExecution: false;
  slackConfigured: boolean;
  ollamaUrl: string;
  implementedStages: Array<{ stage: string; detail: string }>;
  notClaimed: string[];
}

export type OrchestratorStageName =
  | 'ingest'
  | 'detect_lang'
  | 'extract_entities'
  | 'embed_text'
  | 'link_graph'
  | 'plan_policy'
  | 'execute'
  | 'evaluate'
  | 'learn_and_lock';

export interface OrchestratorStageRecord {
  stage: OrchestratorStageName;
  status: 'completed' | 'skipped' | 'failed';
  durationMs: number;
  summary: string;
  digestSha256: string;
  metrics?: Record<string, string | number | boolean>;
}

export interface OrchestratorRunResult {
  auditUuid: string;
  auditLogPath: string;
  reportPath: string;
  simulatorEnabled: boolean;
  evaluationStatus: 'evaluated' | 'not_evaluated';
  physicalExecution: false;
  filename: string;
  uploadId?: string;
  language: string;
  entitiesCount: number;
  embeddingSource: 'ollama' | 'tfidf-hash-64d';
  embeddingDimensions: number;
  protocolId: string;
  proposalId?: string;
  simulationJobId?: string;
  simulationEngine: SimulationEngine;
  reward: number | null;
  safetyPassed: boolean;
  locked: boolean;
  slackAlertSent: boolean;
  stages: OrchestratorStageRecord[];
  reportMarkdown: string;
  createdAt: string;
}

export interface UiButtonAuditItem {
  view: string;
  label: string;
  disabled: boolean;
  safeMarked?: boolean;
  status:
    | 'OK'
    | 'CLICKED'
    | 'GUARDED_DISABLED'
    | 'SKIPPED_UNMARKED'
    | 'SKIPPED_NOT_VISIBLE'
    | 'SKIPPED_DISABLED'
    | 'FAIL';
  detail?: string;
}

export interface UiButtonAuditSummary {
  auditUuid: string;
  harnessMode: 'dom-live-sweep' | 'playwright-chromium' | 'http-ws-contract-probe';
  targetUrl: string;
  viewsVisited: string[];
  totalButtons: number;
  passedCount: number;
  guardedDisabledCount: number;
  failedCount: number;
  results: UiButtonAuditItem[];
  createdAt: string;
}

export interface OrchestratorAuditEntry {
  uuid: string;
  event: string;
  stage?: string;
  actorRole: UserRole;
  digestSha256: string;
  summary: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AutonomousRewardWeights {
  yield: number;
  toxicity: number;
  cost: number;
}

export interface AutonomousControllerConfig {
  batchSize: number;
  replicates: number;
  maxIterations: number;
  maxParallelSimulations: number;
  targetReward: number;
  confidenceLevel: number;
  minSuccessfulReplicates: number;
  maxConfidenceIntervalWidth: number;
  convergencePatience: number;
  randomSeed: number;
  bootstrapSamples: number;
  parameterBounds: Record<string, [number, number]>;
  rewardWeights: AutonomousRewardWeights;
  virtualModeConfirmed: boolean;
}

export interface AutonomousCandidate {
  candidateId: string;
  iteration: number;
  parameters: Record<string, number>;
}

export interface AutonomousEvaluation {
  candidateId: string;
  iteration: number;
  parameters: Record<string, number>;
  replicateCount: number;
  meanReward: number;
  standardDeviation: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceWidth: number;
  metricsMean: {
    yield: number;
    toxicity: number;
    cost: number;
  };
  lockCriteriaMet: boolean;
}

export interface AutonomousIterationPoint {
  iteration: number;
  candidatesEvaluated: number;
  iterationBestReward: number | null;
  globalBestReward: number | null;
  bestConfidenceLower: number | null;
  bestConfidenceUpper: number | null;
  iterationsWithoutImprovement: number;
}

export interface AutonomousAuditEventRecord {
  id: number;
  eventId: string;
  runId: string;
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
  previousHash: string;
  recordHash: string;
}

export interface AutonomousRunReport {
  runId: string;
  generatedAt: string;
  status:
    | 'converged'
    | 'stopped_no_improvement'
    | 'max_iterations_reached'
    | 'failed'
    | 'audit_integrity_failure';
  iterations: number;
  totalSimulations: number;
  successfulSimulations: number;
  failedSimulations: number;
  bestCandidate: AutonomousEvaluation | null;
  bestReward: number | null;
  auditChainValid: boolean;
  headRecordHash: string;
  reportPath: string;
  physicalExecution: false;
  config: AutonomousControllerConfig;
  iterationHistory: AutonomousIterationPoint[];
  evaluations: AutonomousEvaluation[];
}

export interface AutonomousOverviewResponse {
  defaultConfig: AutonomousControllerConfig;
  auditChainValid: boolean;
  totalAuditEvents: number;
  headRecordHash: string;
  auditFilePath: string;
  runs: AutonomousRunReport[];
  recentAuditEvents: AutonomousAuditEventRecord[];
}

export type ResearchChatPersona = 'synthesizer' | 'protocol' | 'simulation';

export interface ResearchChatHistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

export interface ResearchChatRequestPayload {
  message: string;
  persona: ResearchChatPersona;
  language: 'en' | 'he';
  history: ResearchChatHistoryItem[];
  artifactContext?: {
    filename: string;
    excerpt?: string;
    summary?: string;
  };
}

export interface ResearchChatResponsePayload {
  provenanceId: string;
  persona: ResearchChatPersona;
  language: 'en' | 'he';
  model: string;
  reply: string;
  suggestions: string[];
  sources: RetrievedSource[];
  durationMs: number;
  createdAt: string;
}





