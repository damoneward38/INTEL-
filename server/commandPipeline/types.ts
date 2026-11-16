export type CommandIntent =
  | 'information'
  | 'formulation'
  | 'data_analysis'
  | 'virtual_simulation'
  | 'optimization'
  | 'troubleshooting'
  | 'human_authorization_required';

export type StageStatus =
  | 'waiting'
  | 'processing'
  | 'completed'
  | 'needs_review'
  | 'failed'
  | 'optimization'
  | 'selected';

export type PipelineStageId =
  | 'command-ingest'
  | 'input-classification'
  | 'file-ingest'
  | 'format-detection'
  | 'language-detection'
  | 'text-extraction'
  | 'data-validation'
  | 'entity-extraction'
  | 'knowledge-extraction'
  | 'context-embedding'
  | 'knowledge-graph'
  | 'domain-identification'
  | 'requirements-engine'
  | 'constraint-engine'
  | 'safety-policy'
  | 'simulator-selection'
  | 'policy-planner'
  | 'candidate-generator'
  | 'virtual-simulation'
  | 'metrics-collection'
  | 'candidate-evaluation'
  | 'confidence-analysis'
  | 'comparison-engine'
  | 'optimization-engine'
  | 'learning-update'
  | 'validation-engine'
  | 'protocol-registry'
  | 'report-generator'
  | 'audit-trail'
  | '3d-visualization';

export type PipelineEventType =
  | 'job.created'
  | 'job.started'
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  | 'stage.started'
  | 'stage.progress'
  | 'stage.completed'
  | 'stage.failed'
  | 'candidate.created'
  | 'candidate.rejected'
  | 'candidate.selected'
  | 'simulation.started'
  | 'simulation.progress'
  | 'simulation.completed'
  | 'simulation.failed'
  | 'metrics.updated'
  | 'comparison.completed'
  | 'optimization.started'
  | 'optimization.completed'
  | 'validation.completed'
  | 'report.created'
  | 'audit.recorded';

export interface PipelineStageDefinition {
  number: number;
  id: PipelineStageId;
  name: string;
  phase: 'ingest' | 'knowledge' | 'policy' | 'simulation' | 'optimization' | 'governance';
  inputSchema: string;
  outputSchema: string;
  retryLimit: number;
  timeoutMs: number;
}

export interface PipelineStageState {
  number: number;
  id: PipelineStageId;
  name: string;
  phase: PipelineStageDefinition['phase'];
  status: StageStatus;
  progress: number;
  durationMs: number;
  startedAt: string | null;
  completedAt: string | null;
  inputCount: number;
  outputCount: number;
  errorCount: number;
  summary: string;
  data?: Record<string, unknown>;
}

export interface PipelineEvent {
  event_id: string;
  job_id: string;
  timestamp: string;
  sequence: number;
  type: PipelineEventType;
  stage: PipelineStageId | 'system';
  status: StageStatus;
  progress: number;
  message: string;
  data: Record<string, unknown>;
}

export interface SimulatorVariableSpec {
  name: string;
  unit: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface SimulatorAdapterDescriptor {
  id: string;
  name: string;
  version: string;
  license: string;
  supportedDomains: string[];
  supportedInputFormats: string[];
  supportedVariables: SimulatorVariableSpec[];
  parameterBounds: Record<string, [number, number]>;
  resourceRequirements: {
    cpuCores: number;
    memoryMb: number;
    isolatedSandbox: boolean;
    physicalExecution: false;
  };
  validationRules: string[];
  outputSchema: string[];
}

export interface CandidateRecord {
  candidateId: string;
  batch: number;
  label: string;
  parameters: Record<string, number>;
  status: 'pending' | 'running' | 'accepted' | 'rejected' | 'selected';
  reason: string;
  replicatesCompleted: number;
  replicatesTotal: number;
  metrics: {
    stabilityScore: number;
    safetyScore: number;
    yieldScore: number;
    energyDrift: number;
    compositeScore: number;
  } | null;
  confidenceInterval95: [number, number] | null;
  constraintViolations: string[];
}

export interface TimelineStepRecord {
  stepNumber: number;
  title: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  doing: string;
  why: string;
  inputUsed: string;
  operation: string;
  resultReceived: string;
  nextAction: string;
  updatedAt: string | null;
}

export interface ExtractedEntity {
  id: string;
  label: string;
  category: 'compound' | 'parameter' | 'metric' | 'constraint' | 'domain' | 'hazard';
  value: string;
  confidence: number;
}

export interface KnowledgeGraphEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export interface UploadedArtifactRecord {
  uploadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  detectedFormat: string;
  detectedLanguage: 'en' | 'he' | 'mixed';
  extractedText: string;
  parsedRowsCount: number;
  parsedMatrix: Array<Record<string, number | string>>;
  sha256: string;
  createdAt: string;
}

export interface PipelineJobRecord {
  jobId: string;
  idempotencyKey: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_review';
  progress: number;
  inputMode: 'voice' | 'text' | 'file' | 'matrix' | 'dataset' | 'api';
  commandText: string;
  intent: CommandIntent;
  domain: string;
  requiresHumanReview: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  simulatorId: string | null;
  blockedReason: string | null;
  uploadId: string | null;
  uploadedFilename: string | null;
  createdBy: {
    userId: string;
    role: string;
    name: string;
  };
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  stages: PipelineStageState[];
  timelineSteps: TimelineStepRecord[];
  entities: ExtractedEntity[];
  knowledgeEdges: KnowledgeGraphEdge[];
  candidates: CandidateRecord[];
  selectedCandidateId: string | null;
  optimizationHistory: Array<{
    batch: number;
    bestScore: number;
    acceptedCount: number;
    rejectedCount: number;
    strategy: string;
    timestamp: string;
  }>;
  limitations: string[];
  reportMarkdown: string | null;
  error: string | null;
}

export interface AuditChainEntry {
  seq: number;
  auditId: string;
  jobId: string;
  eventType: string;
  stage: string;
  actorId: string;
  summary: string;
  prevHash: string;
  entryHash: string;
  timestamp: string;
}

export interface PipelineSystemSettings {
  maxConcurrentJobs: number;
  defaultReplicates: number;
  defaultRetryLimit: number;
  voiceAutoSpeak: boolean;
  enforceMedicalSafetyGate: boolean;
  preferredModel: string;
  updatedAt: string;
}
