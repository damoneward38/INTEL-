import { useCallback, useEffect, useRef, useState } from 'react';
import {
  approvePipelineJobApi,
  cancelPipelineJobApi,
  fetchPipelineAuditApi,
  fetchPipelineHealthApi,
  fetchPipelineJobApi,
  fetchPipelineJobEventsApi,
  fetchPipelineJobsApi,
  fetchPipelineSettingsApi,
  fetchPipelineStagesApi,
  fetchSimulatorsApi,
  submitCommandApi,
  updatePipelineSettingsApi,
  uploadCommandArtifactApi,
  type AuditChainEntry,
  type PipelineEvent,
  type PipelineJobRecord,
  type PipelineStageDefinition,
  type PipelineSystemSettings,
  type SimulatorAdapterDescriptor,
  type UploadedArtifactRecord,
} from '../services/pipelineApi';
import { speakAloud, stopSpeechTalk } from '../utils/speechTalk';

export interface VoiceSessionEntry {
  id: string;
  role: 'user' | 'system';
  text: string;
  jobId?: string;
  timestamp: string;
}

export function usePipelineCenter(language: 'en' | 'he') {
  const [jobs, setJobs] = useState<PipelineJobRecord[]>([]);
  const [uploads, setUploads] = useState<UploadedArtifactRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<PipelineJobRecord | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [stagesSchema, setStagesSchema] = useState<PipelineStageDefinition[]>([]);
  const [simulators, setSimulators] = useState<SimulatorAdapterDescriptor[]>([]);
  const [settings, setSettings] = useState<PipelineSystemSettings | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditChainEntry[]>([]);
  const [auditVerification, setAuditVerification] = useState<{
    valid: boolean;
    totalEntries: number;
    brokenAtSeq: number | null;
    headHash: string | null;
  } | null>(null);
  const [healthInfo, setHealthInfo] = useState<{
    status: string;
    geminiConfigured: boolean;
    sqliteReady: boolean;
    totalJobs: number;
    activeJobs: number;
  } | null>(null);

  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  const [voiceSpeakEnabled, setVoiceSpeakEnabled] = useState(true);
  const [voiceHistory, setVoiceHistory] = useState<VoiceSessionEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxSequenceRef = useRef(0);
  const announcedKeysRef = useRef<Set<string>>(new Set());

  const announceEvent = useCallback(
    (key: string, text: string, jobId?: string) => {
      if (announcedKeysRef.current.has(key)) return;
      announcedKeysRef.current.add(key);
      setVoiceHistory((prev) => [
        ...prev.slice(-30),
        {
          id: `${key}-${Date.now()}`,
          role: 'system',
          text,
          jobId,
          timestamp: new Date().toISOString(),
        },
      ]);
      if (voiceSpeakEnabled) {
        speakAloud(text, { language });
      }
    },
    [language, voiceSpeakEnabled]
  );

  const refreshCatalog = useCallback(async () => {
    try {
      const [jobsRes, stagesRes, simsRes, settingsRes, auditRes, healthRes] =
        await Promise.all([
          fetchPipelineJobsApi(30),
          fetchPipelineStagesApi(),
          fetchSimulatorsApi(),
          fetchPipelineSettingsApi(),
          fetchPipelineAuditApi(),
          fetchPipelineHealthApi(),
        ]);
      setJobs(jobsRes.jobs);
      setUploads(jobsRes.uploads);
      setStagesSchema(stagesRes.stages);
      setSimulators(simsRes.simulators);
      setSettings(settingsRes.settings);
      setAuditEntries(auditRes.entries);
      setAuditVerification(auditRes.verification);
      setHealthInfo({
        status: healthRes.status,
        geminiConfigured: healthRes.geminiConfigured,
        sqliteReady: Boolean(healthRes.commandPipeline?.sqliteReady),
        totalJobs: healthRes.commandPipeline?.totalJobs ?? jobsRes.jobs.length,
        activeJobs: healthRes.commandPipeline?.activeJobs ?? 0,
      });

      if (!activeJobId && jobsRes.jobs.length > 0) {
        setActiveJobId(jobsRes.jobs[0].jobId);
        setActiveJob(jobsRes.jobs[0]);
      }
    } catch {
      // Keep UI responsive during transient refreshes
    }
  }, [activeJobId]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const refreshActiveJobState = useCallback(async (jobId: string) => {
    try {
      const [jobRes, auditRes] = await Promise.all([
        fetchPipelineJobApi(jobId),
        fetchPipelineAuditApi(jobId),
      ]);
      setActiveJob(jobRes.job);
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.jobId === jobRes.job.jobId);
        if (idx === -1) return [jobRes.job, ...prev];
        const copy = [...prev];
        copy[idx] = jobRes.job;
        return copy;
      });
      setAuditEntries(auditRes.entries);
      setAuditVerification(auditRes.verification);
    } catch {
      // Ignore refresh race
    }
  }, []);

  // Connect WebSocket with sequence replay and automatic reconnect
  useEffect(() => {
    if (!activeJobId) {
      setWsStatus('idle');
      return;
    }

    let closedByEffect = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pollTimer: number | null = null;

    maxSequenceRef.current = 0;
    setEvents([]);

    const handleIncomingEvent = (evt: PipelineEvent) => {
      if (evt.sequence <= maxSequenceRef.current) return;
      maxSequenceRef.current = evt.sequence;
      setEvents((prev) => [...prev, evt]);

      // Spoken status updates anchored strictly to verified backend events
      if (evt.type === 'job.started') {
        announceEvent(`${evt.job_id}:started`, evt.message, evt.job_id);
      } else if (evt.type === 'candidate.rejected') {
        announceEvent(`${evt.job_id}:rej:${evt.sequence}`, evt.message, evt.job_id);
      } else if (evt.type === 'optimization.started') {
        announceEvent(`${evt.job_id}:opt`, evt.message, evt.job_id);
      } else if (evt.type === 'validation.completed') {
        announceEvent(`${evt.job_id}:val`, evt.message, evt.job_id);
      } else if (evt.type === 'job.completed') {
        announceEvent(`${evt.job_id}:done`, evt.message, evt.job_id);
      } else if (evt.type === 'job.failed') {
        announceEvent(`${evt.job_id}:fail`, evt.message, evt.job_id);
      }

      if (
        evt.type === 'stage.completed' ||
        evt.type === 'stage.failed' ||
        evt.type === 'simulation.completed' ||
        evt.type === 'simulation.failed' ||
        evt.type === 'optimization.completed' ||
        evt.type === 'validation.completed' ||
        evt.type === 'job.completed' ||
        evt.type === 'job.failed'
      ) {
        void refreshActiveJobState(evt.job_id);
      }
    };

    const connectWs = () => {
      if (closedByEffect) return;
      setWsStatus(maxSequenceRef.current > 0 ? 'reconnecting' : 'connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/jobs/${encodeURIComponent(
        activeJobId
      )}?afterSequence=${maxSequenceRef.current}`;

      ws = new WebSocket(url);
      ws.onopen = () => {
        if (!closedByEffect) setWsStatus('connected');
      };
      ws.onmessage = (msg) => {
        try {
          const evt = JSON.parse(String(msg.data)) as PipelineEvent;
          if (evt && typeof evt.sequence === 'number' && evt.sequence > 0) {
            handleIncomingEvent(evt);
          }
        } catch {
          // Ignore malformed frame
        }
      };
      ws.onclose = () => {
        if (closedByEffect) return;
        setWsStatus('reconnecting');
        reconnectTimer = window.setTimeout(connectWs, 1200);
      };
    };

    void refreshActiveJobState(activeJobId);
    connectWs();

    // Periodic safety poll in case proxy temporarily buffers WebSockets
    pollTimer = window.setInterval(async () => {
      if (closedByEffect) return;
      try {
        const res = await fetchPipelineJobEventsApi(activeJobId, maxSequenceRef.current);
        res.events.forEach(handleIncomingEvent);
        await refreshActiveJobState(activeJobId);
      } catch {
        // Ignore poll glitch
      }
    }, 900);

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      ws?.close();
    };
  }, [activeJobId, announceEvent, refreshActiveJobState]);

  async function uploadArtifact(
    fileOrPayload: File | { filename: string; content: string; mimeType?: string }
  ): Promise<UploadedArtifactRecord> {
    setError(null);
    const { artifact } = await uploadCommandArtifactApi(fileOrPayload);
    setUploads((prev) => [artifact, ...prev.filter((u) => u.uploadId !== artifact.uploadId)]);
    return artifact;
  }

  async function submitCommand(payload: {
    commandText: string;
    inputMode?: PipelineJobRecord['inputMode'];
    uploadId?: string;
    inlineDataText?: string;
    matrix?: Array<Record<string, number | string>>;
    idempotencyKey?: string;
  }): Promise<PipelineJobRecord> {
    setSubmitting(true);
    setError(null);
    try {
      setVoiceHistory((prev) => [
        ...prev.slice(-30),
        {
          id: `usr-${Date.now()}`,
          role: 'user',
          text: payload.commandText,
          timestamp: new Date().toISOString(),
        },
      ]);
      const res = await submitCommandApi(payload);
      setActiveJob(res.job);
      setActiveJobId(res.job.jobId);
      setJobs((prev) => [res.job, ...prev.filter((j) => j.jobId !== res.job.jobId)]);
      announceEvent(
        `${res.job.jobId}:created`,
        `Command received. Identified ${res.job.intent.replace(/_/g, ' ')} task for ${res.job.domain} (Job ${res.job.jobId}).`,
        res.job.jobId
      );
      return res.job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Command submission failed.';
      setError(msg);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelActiveJob() {
    if (!activeJobId) return;
    stopSpeechTalk();
    const res = await cancelPipelineJobApi(activeJobId);
    setActiveJob(res.job);
    await refreshActiveJobState(activeJobId);
  }

  async function approveActiveJob() {
    if (!activeJobId) return;
    setError(null);
    try {
      const res = await approvePipelineJobApi(activeJobId);
      setActiveJob(res.job);
      await refreshActiveJobState(activeJobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed.');
    }
  }

  async function saveSettings(updates: Partial<PipelineSystemSettings>) {
    setError(null);
    try {
      const res = await updatePipelineSettingsApi(updates);
      setSettings(res.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings update failed.');
    }
  }

  function askFollowUp(question: string): string {
    if (!activeJob) {
      return 'No active pipeline job selected yet. Submit a command or upload a matrix first.';
    }
    const winner = activeJob.candidates.find(
      (c) => c.candidateId === activeJob.selectedCandidateId
    );
    const rejected = activeJob.candidates.filter((c) => c.status === 'rejected');
    const q = question.toLowerCase();
    let answer = '';
    if (/reject|fail|why/.test(q)) {
      answer =
        rejected.length > 0
          ? `${rejected.length} candidates failed constraints: ${rejected.map((r) => `${r.label} (${r.reason})`).join('; ')}.`
          : `Zero candidates failed constraints in Job ${activeJob.jobId}.`;
    } else if (/winner|best|select|result|confidence/.test(q)) {
      answer = winner && winner.metrics
        ? `Selected ${winner.label} with composite score ${winner.metrics.compositeScore} (95% CI [${winner.confidenceInterval95?.[0]}, ${winner.confidenceInterval95?.[1]}]).`
        : `Job ${activeJob.jobId} status is ${activeJob.status}; no selected simulation candidate yet.`;
    } else {
      answer = `Job ${activeJob.jobId} (${activeJob.intent}, ${activeJob.domain}) is ${activeJob.status} at ${activeJob.progress}% across ${activeJob.stages.filter((s) => s.status === 'completed' || s.status === 'selected' || s.status === 'optimization').length} of 30 stages.`;
    }
    setVoiceHistory((prev) => [
      ...prev.slice(-30),
      { id: `fq-u-${Date.now()}`, role: 'user', text: question, jobId: activeJob.jobId, timestamp: new Date().toISOString() },
      { id: `fq-a-${Date.now() + 1}`, role: 'system', text: answer, jobId: activeJob.jobId, timestamp: new Date().toISOString() },
    ]);
    if (voiceSpeakEnabled) {
      speakAloud(answer, { language });
    }
    return answer;
  }

  return {
    jobs,
    uploads,
    activeJobId,
    setActiveJobId,
    activeJob,
    events,
    stagesSchema,
    simulators,
    settings,
    auditEntries,
    auditVerification,
    healthInfo,
    wsStatus,
    voiceSpeakEnabled,
    setVoiceSpeakEnabled,
    voiceHistory,
    submitting,
    error,
    setError,
    refreshCatalog,
    uploadArtifact,
    submitCommand,
    cancelActiveJob,
    approveActiveJob,
    saveSettings,
    askFollowUp,
    interruptVoice: stopSpeechTalk,
  };
}
