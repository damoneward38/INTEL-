import { getStoredToken } from './api';
import type {
  AuditChainEntry,
  CandidateRecord,
  ExtractedEntity,
  KnowledgeGraphEdge,
  PipelineEvent,
  PipelineJobRecord,
  PipelineStageDefinition,
  PipelineStageState,
  PipelineSystemSettings,
  SimulatorAdapterDescriptor,
  StageStatus,
  UploadedArtifactRecord,
} from '../../server/commandPipeline/types';

export type {
  AuditChainEntry,
  CandidateRecord,
  ExtractedEntity,
  KnowledgeGraphEdge,
  PipelineEvent,
  PipelineJobRecord,
  PipelineStageDefinition,
  PipelineStageState,
  PipelineSystemSettings,
  SimulatorAdapterDescriptor,
  StageStatus,
  UploadedArtifactRecord,
};

async function pipelineFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  const raw = await res.text().catch(() => '');
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') parsed = obj as Record<string, unknown>;
    } catch {
      // Non-JSON text
    }
  }
  if (!res.ok) {
    const msg =
      typeof parsed.error === 'string' && parsed.error.trim()
        ? parsed.error
        : raw.trim().slice(0, 200) || `Request failed with status ${res.status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export async function uploadCommandArtifactApi(
  fileOrPayload: File | { filename: string; content: string; mimeType?: string }
): Promise<{ artifact: UploadedArtifactRecord }> {
  if (fileOrPayload instanceof File) {
    const fd = new FormData();
    fd.append('file', fileOrPayload);
    return pipelineFetch('/api/upload', { method: 'POST', body: fd });
  }
  return pipelineFetch('/api/upload', {
    method: 'POST',
    body: JSON.stringify(fileOrPayload),
  });
}

export async function submitCommandApi(payload: {
  commandText: string;
  inputMode?: PipelineJobRecord['inputMode'];
  uploadId?: string;
  inlineDataText?: string;
  matrix?: Array<Record<string, number | string>>;
  idempotencyKey?: string;
}): Promise<{ job: PipelineJobRecord; deduplicated: boolean }> {
  return pipelineFetch('/api/command', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPipelineJobsApi(limit = 40): Promise<{
  jobs: PipelineJobRecord[];
  uploads: UploadedArtifactRecord[];
}> {
  return pipelineFetch(`/api/jobs?limit=${limit}`);
}

export async function fetchPipelineJobApi(jobId: string): Promise<{ job: PipelineJobRecord }> {
  return pipelineFetch(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function fetchPipelineJobEventsApi(
  jobId: string,
  afterSequence = 0
): Promise<{ jobId: string; events: PipelineEvent[] }> {
  return pipelineFetch(
    `/api/jobs/${encodeURIComponent(jobId)}/events?afterSequence=${afterSequence}`
  );
}

export async function fetchPipelineJobReportApi(jobId: string): Promise<{
  jobId: string;
  status: PipelineJobRecord['status'];
  reportMarkdown: string;
  selectedCandidate: CandidateRecord | null;
  candidates: CandidateRecord[];
  auditEntries: AuditChainEntry[];
  auditVerification: {
    valid: boolean;
    totalEntries: number;
    brokenAtSeq: number | null;
    headHash: string | null;
  };
}> {
  return pipelineFetch(`/api/jobs/${encodeURIComponent(jobId)}/report`);
}

export async function cancelPipelineJobApi(jobId: string): Promise<{ job: PipelineJobRecord }> {
  return pipelineFetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
}

export async function approvePipelineJobApi(jobId: string): Promise<{ job: PipelineJobRecord }> {
  return pipelineFetch(`/api/jobs/${encodeURIComponent(jobId)}/approve`, {
    method: 'POST',
  });
}

export async function fetchPipelineStagesApi(): Promise<{
  stages: PipelineStageDefinition[];
}> {
  return pipelineFetch('/api/pipeline/stages');
}

export async function fetchSimulatorsApi(): Promise<{
  simulators: SimulatorAdapterDescriptor[];
}> {
  return pipelineFetch('/api/simulators');
}

export async function fetchPipelineAuditApi(jobId?: string): Promise<{
  entries: AuditChainEntry[];
  verification: {
    valid: boolean;
    totalEntries: number;
    brokenAtSeq: number | null;
    headHash: string | null;
  };
}> {
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
  return pipelineFetch(`/api/pipeline/audit${qs}`);
}

export async function fetchPipelineSettingsApi(): Promise<{
  settings: PipelineSystemSettings;
}> {
  return pipelineFetch('/api/pipeline/settings');
}

export async function updatePipelineSettingsApi(
  updates: Partial<PipelineSystemSettings>
): Promise<{ settings: PipelineSystemSettings }> {
  return pipelineFetch('/api/pipeline/settings', {
    method: 'POST',
    body: JSON.stringify(updates),
  });
}

export async function fetchPipelineHealthApi(): Promise<{
  status: string;
  geminiConfigured: boolean;
  commandPipeline?: {
    sqliteReady: boolean;
    totalJobs: number;
    activeJobs: number;
    simulatorCount: number;
    stageCount: number;
  };
}> {
  return pipelineFetch('/api/health');
}

export interface RoboticsResearchConfig {
  research?: {
    title?: string;
    source?: string;
    version?: string;
    author?: string;
    description?: string;
  };
  robot: {
    name: string;
    robot_type: 'differential_drive' | 'two_link_arm';
    wheel_radius?: number;
    wheel_base?: number;
    max_speed?: number;
    max_acceleration?: number;
    battery_capacity_wh?: number;
    payload_kg?: number;
    arm_link_1_m?: number;
    arm_link_2_m?: number;
    joint_limit_deg?: number;
  };
  simulation?: {
    duration_s?: number;
    timestep_s?: number;
    trials?: number;
    obstacle_margin_m?: number;
    target_tolerance_m?: number;
    seed?: number;
  };
  environment?: {
    start?: [number, number];
    goal?: [number, number];
    obstacles?: Array<{ center: [number, number]; radius: number }>;
    target?: [number, number];
  };
  objectives?: string[];
}

export interface RoboticsPipelineManifest {
  domain: string;
  version: string;
  execution_mode: string;
  pipeline: string[];
  supported_initial_models: string[];
  future_simulator_adapters: Array<{
    name: string;
    purpose: string;
    enabled: boolean;
  }>;
  hardware_execution: {
    enabled: boolean;
    requires_human_approval: boolean;
    requires_independent_safety_validation: boolean;
  };
}

export interface RoboticsStreamEvent {
  job_id: string;
  sequence: number;
  timestamp: number;
  stage: string;
  status: string;
  details: Record<string, unknown>;
}

export interface RoboticsReportRecord {
  engine_version: string;
  job_id: string;
  simulation_only: boolean;
  robot: Required<RoboticsResearchConfig['robot']>;
  simulation: Required<NonNullable<RoboticsResearchConfig['simulation']>>;
  environment: NonNullable<RoboticsResearchConfig['environment']>;
  trials: Array<Record<string, unknown>>;
  evaluation: Record<string, unknown>;
  event_count: number;
  limitations: string[];
  sha256: string;
}

export async function fetchRoboticsRunsApi(): Promise<{
  runs: RoboticsReportRecord[];
  presets: {
    differential_drive: RoboticsResearchConfig;
    two_link_arm: RoboticsResearchConfig;
    research_upload_example?: RoboticsResearchConfig;
  };
  manifest?: RoboticsPipelineManifest;
  simulationOnly: boolean;
}> {
  return pipelineFetch('/api/robotics/runs');
}

export async function fetchRoboticsManifestApi(): Promise<{
  manifest: RoboticsPipelineManifest;
  configs: Array<{ name: string; config: RoboticsResearchConfig }>;
}> {
  return pipelineFetch('/api/robotics/manifest');
}

export async function runRoboticsEngineApi(config: RoboticsResearchConfig): Promise<{
  report: RoboticsReportRecord;
  events: RoboticsStreamEvent[];
  sha256Verified: boolean;
}> {
  return pipelineFetch('/api/robotics/run', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

