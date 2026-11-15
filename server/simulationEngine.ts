import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { logger } from './logger.ts';
import { recordProvenance } from './provenance.ts';
import type {
  AuthSession,
  ReferenceValidation,
  SimulationFrame,
  SimulationJob,
  SimulationParameters,
} from './types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, 'simulationWorker.mjs');
const WORKER_TIMEOUT_MS = 25_000;

type JobListener = (job: SimulationJob) => void;

const jobs = new Map<string, SimulationJob>();
const activeWorkers = new Map<string, Worker>();
const jobListeners = new Map<string, Set<JobListener>>();

function notifyListeners(jobId: string): void {
  const job = jobs.get(jobId);
  const listeners = jobListeners.get(jobId);
  if (!job || !listeners) return;
  for (const listener of listeners) {
    try {
      listener(job);
    } catch {
      // Ignore closed socket listener errors
    }
  }
}

export function subscribeToJob(jobId: string, listener: JobListener): () => void {
  if (!jobListeners.has(jobId)) {
    jobListeners.set(jobId, new Set());
  }
  jobListeners.get(jobId)!.add(listener);
  const existing = jobs.get(jobId);
  if (existing) {
    listener(existing);
  }
  return () => {
    const set = jobListeners.get(jobId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      jobListeners.delete(jobId);
    }
  };
}

export function submitSimulationJob(
  parameters: SimulationParameters,
  session: AuthSession
): SimulationJob {
  const jobId = `sim-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const job: SimulationJob = {
    jobId,
    engine: parameters.engine,
    state: 'queued',
    progress: 0,
    parameters,
    frames: [],
    particles: [],
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(jobId, job);

  const worker = new Worker(WORKER_PATH, {
    workerData: {
      engine: parameters.engine,
      temperature: parameters.temperature,
      pressure: parameters.pressure,
      steps: parameters.steps,
      particleCount: parameters.particleCount ?? 28,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 32,
    },
  });

  const timeoutHandle = setTimeout(() => {
    const current = jobs.get(jobId);
    if (current && current.state === 'running') {
      worker.terminate().catch(() => {});
      current.state = 'failed';
      current.error = `Worker exceeded ${WORKER_TIMEOUT_MS}ms resource limit.`;
      current.updatedAt = new Date().toISOString();
      activeWorkers.delete(jobId);
      notifyListeners(jobId);
      logger.warn('simulation', 'Terminated simulation worker exceeding timeout', {
        jobId,
      });
    }
  }, WORKER_TIMEOUT_MS);

  activeWorkers.set(jobId, worker);
  job.state = 'running';
  job.updatedAt = new Date().toISOString();
  notifyListeners(jobId);

  recordProvenance({
    kind: 'simulation',
    actorId: session.userId,
    actorRole: session.role,
    action: `simulation:submit:${parameters.engine}`,
    rawInput: JSON.stringify(parameters),
    modelOrEngine: parameters.engine,
    licenses: ['Apache-2.0 (INTEL Isolated Worker)'],
    sourceUrls: [
      'https://www.nist.gov/mml/csd/informatics/lammps-md-equation-state-validation',
    ],
    metadata: {
      jobId,
      temperature: parameters.temperature,
      pressure: parameters.pressure,
      steps: parameters.steps,
    },
  });

  logger.info('simulation', 'Started isolated simulation worker job', {
    jobId,
    engine: parameters.engine,
    steps: parameters.steps,
  });

  worker.on(
    'message',
    (msg: {
      type: string;
      progress?: number;
      frames?: SimulationFrame[];
      particles?: Array<[number, number, number]>;
      elapsedMs?: number;
      referenceValidation?: ReferenceValidation;
    }) => {
      const current = jobs.get(jobId);
      if (!current) return;

      if (msg.type === 'progress') {
        current.progress = msg.progress ?? current.progress;
        if (Array.isArray(msg.frames) && msg.frames.length > 0) {
          current.frames.push(...msg.frames);
        }
        if (Array.isArray(msg.particles)) {
          current.particles = msg.particles;
        }
        current.updatedAt = new Date().toISOString();
        notifyListeners(jobId);
      } else if (msg.type === 'completed') {
        clearTimeout(timeoutHandle);
        current.state = 'completed';
        current.progress = 100;
        const frameCount = current.frames.length || 1;
        const meanTempK =
          current.frames.reduce((acc, f) => acc + f.temperatureInst, 0) / frameCount;
        const meanPressureAtm =
          current.frames.reduce((acc, f) => acc + f.pressureInst, 0) / frameCount;
        const meanTotalEnergy =
          current.frames.reduce((acc, f) => acc + f.totalEnergy, 0) / frameCount;
        const finalRmsd = current.frames[current.frames.length - 1]?.rmsd ?? 0;

        current.summary = {
          meanTempK: Number(meanTempK.toFixed(2)),
          meanPressureAtm: Number(meanPressureAtm.toFixed(3)),
          meanTotalEnergy: Number(meanTotalEnergy.toFixed(3)),
          finalRmsd,
          elapsedMs: msg.elapsedMs ?? 0,
        };
        current.referenceValidation = msg.referenceValidation;
        current.updatedAt = new Date().toISOString();
        activeWorkers.delete(jobId);
        notifyListeners(jobId);

        logger.info('simulation', 'Simulation worker completed', {
          jobId,
          elapsedMs: current.summary.elapsedMs,
          benchmarkPassed: msg.referenceValidation?.passed ?? true,
        });
      } else if (msg.type === 'cancelled') {
        clearTimeout(timeoutHandle);
        current.state = 'cancelled';
        current.updatedAt = new Date().toISOString();
        activeWorkers.delete(jobId);
        notifyListeners(jobId);
      }
    }
  );

  worker.on('error', (err) => {
    clearTimeout(timeoutHandle);
    const current = jobs.get(jobId);
    if (current) {
      current.state = 'failed';
      current.error = err.message;
      current.updatedAt = new Date().toISOString();
      notifyListeners(jobId);
    }
    activeWorkers.delete(jobId);
    logger.error('simulation', 'Simulation worker crashed', {
      jobId,
      error: err.message,
    });
  });

  worker.on('exit', (code) => {
    clearTimeout(timeoutHandle);
    activeWorkers.delete(jobId);
    const current = jobs.get(jobId);
    if (current && current.state === 'running' && code !== 0) {
      current.state = 'failed';
      current.error = `Worker exited unexpectedly with code ${code}`;
      current.updatedAt = new Date().toISOString();
      notifyListeners(jobId);
    }
  });

  return job;
}

export function getSimulationJob(jobId: string): SimulationJob | undefined {
  return jobs.get(jobId);
}

export function listSimulationJobs(): SimulationJob[] {
  return Array.from(jobs.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

export async function cancelSimulationJob(jobId: string): Promise<SimulationJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.postMessage({ type: 'cancel' });
    await worker.terminate();
    activeWorkers.delete(jobId);
  }
  if (job.state === 'running' || job.state === 'queued') {
    job.state = 'cancelled';
    job.updatedAt = new Date().toISOString();
    notifyListeners(jobId);
    logger.info('simulation', 'Simulation job cancelled', { jobId });
  }
  return job;
}
