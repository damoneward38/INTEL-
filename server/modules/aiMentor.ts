import crypto from 'node:crypto';
import { listFeedback } from '../feedbackStore.ts';
import { listLicenseRecords } from '../governance.ts';
import { listProvenance } from '../provenance.ts';
import { listSimulationJobs } from '../simulationEngine.ts';
import type { AuthSession, MentorMemoryNote, MentorRiskAlert } from '../types.ts';
import { generateEcoAuditReport } from './ecoAuditor.ts';
import { listPgxSamples } from './pgxVault.ts';

interface UserMemoryState {
  memoryEnabled: boolean;
  notes: MentorMemoryNote[];
}

const memoryByUser = new Map<string, UserMemoryState>();

function getOrCreateUserState(userId: string): UserMemoryState {
  let state = memoryByUser.get(userId);
  if (!state) {
    state = {
      memoryEnabled: true,
      notes: [
        {
          id: `mem-${crypto.randomUUID().slice(0, 8)}`,
          userId,
          topic: 'Active Research Focus',
          content:
            'Prefer NIST-calibrated MD validation and strict SPDX CC-BY/MIT compliance across ingested sources.',
          createdAt: new Date().toISOString(),
        },
      ],
    };
    memoryByUser.set(userId, state);
  }
  return state;
}

export function getMentorMemory(session: AuthSession): {
  memoryEnabled: boolean;
  notes: MentorMemoryNote[];
} {
  const state = getOrCreateUserState(session.userId);
  return {
    memoryEnabled: state.memoryEnabled,
    notes: state.notes,
  };
}

export function setMentorMemoryEnabled(
  session: AuthSession,
  enabled: boolean
): { memoryEnabled: boolean } {
  const state = getOrCreateUserState(session.userId);
  state.memoryEnabled = enabled;
  return { memoryEnabled: state.memoryEnabled };
}

export function addMentorMemoryNote(
  session: AuthSession,
  topic: string,
  content: string
): MentorMemoryNote {
  const state = getOrCreateUserState(session.userId);
  if (!state.memoryEnabled) {
    throw new Error('Local project memory is paused by user privacy setting.');
  }
  const note: MentorMemoryNote = {
    id: `mem-${crypto.randomUUID().slice(0, 8)}`,
    userId: session.userId,
    topic: topic.trim(),
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
  state.notes.unshift(note);
  if (state.notes.length > 50) state.notes.length = 50;
  return note;
}

export function deleteMentorMemoryNote(session: AuthSession, noteId: string): boolean {
  const state = getOrCreateUserState(session.userId);
  const idx = state.notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return false;
  state.notes.splice(idx, 1);
  return true;
}

export function clearAllMentorMemory(session: AuthSession): void {
  const state = getOrCreateUserState(session.userId);
  state.notes = [];
}

export function evaluatePredictiveRisks(session: AuthSession): {
  alerts: MentorRiskAlert[];
  memoryCount: number;
  memoryEnabled: boolean;
} {
  const state = getOrCreateUserState(session.userId);
  const alerts: MentorRiskAlert[] = [];

  const licenses = listLicenseRecords();
  const unverified = licenses.filter((l) => !l.verified);
  if (unverified.length > 0) {
    alerts.push({
      id: 'risk-unverified-license',
      severity: 'high',
      title: `${unverified.length} source license(s) pending auditor verification`,
      recommendation:
        'Open Governance & Audit to verify SPDX terms before referencing these documents in grant drafts or training workflows.',
      whyDetected:
        'Unverified sources are automatically withheld from vector retrieval and training pipelines by eligibleForOperation().',
      triggeredByMetrics: unverified.map((u) => `${u.documentId} (${u.license})`),
    });
  }

  const researchProvs = listProvenance(80).filter((p) => p.kind === 'research');
  const reviewedIds = new Set(listFeedback(100).map((f) => f.provenanceId));
  const unreviewed = researchProvs.filter((p) => !reviewedIds.has(p.id));
  if (unreviewed.length > 0) {
    alerts.push({
      id: 'risk-unreviewed-synthesis',
      severity: 'medium',
      title: `${unreviewed.length} AI synthesis output(s) awaiting human peer review`,
      recommendation:
        'Record a 1–5 peer review verdict in the Workspace insight panel before citing outputs in publications or grant aims.',
      whyDetected:
        'All generated synthesis outputs start with reviewStatus="pending_human_review" and must pass domain expert sign-off.',
      triggeredByMetrics: unreviewed.slice(0, 3).map((u) => u.id),
    });
  }

  const sims = listSimulationJobs();
  const driftedSims = sims.filter(
    (s) => s.state === 'completed' && s.referenceValidation && !s.referenceValidation.passed
  );
  if (driftedSims.length > 0) {
    alerts.push({
      id: 'risk-sim-drift',
      severity: 'high',
      title: `${driftedSims.length} simulation run(s) drifted outside NIST/Psi4 reference bounds`,
      recommendation:
        'Lower integration step perturbation or switch from NVE Verlet to Langevin NVT thermostatting for thermal stability.',
      whyDetected:
        'Reference dataset validation detected observed temperature/energy outside calibrated tolerance.',
      triggeredByMetrics: driftedSims.map(
        (d) => `${d.jobId}: ${d.referenceValidation?.observedValue}`
      ),
    });
  }

  const revokedPgx = listPgxSamples().filter((s) => !s.consentGranted);
  if (revokedPgx.length > 0) {
    alerts.push({
      id: 'risk-pgx-consent',
      severity: 'medium',
      title: `${revokedPgx.length} Pharmacogenomics Vault sample(s) have revoked consent`,
      recommendation:
        'Purge or re-confirm IRB participant consent before scheduling downstream cohort annotations.',
      whyDetected:
        'Consent gate flagged samples with consentGranted=false while encrypted payloads remain in vault storage.',
      triggeredByMetrics: revokedPgx.map((s) => s.sampleAlias),
    });
  }

  const eco = generateEcoAuditReport('us-east1');
  if (eco.totalCarbonGCo2Eq > 5) {
    alerts.push({
      id: 'risk-eco-intensity',
      severity: 'low',
      title: 'Compute workload running on moderate-to-high grid carbon intensity',
      recommendation:
        'Batch non-urgent MD/SCF jobs into eu-north1 (28 gCO2eq/kWh) and keep SHA-256 deduplication enabled.',
      whyDetected: `Baseline us-east1 estimate is ${eco.totalCarbonGCo2Eq} gCO2eq across ${sims.length} simulation jobs.`,
      triggeredByMetrics: [`totalCarbonGCo2Eq=${eco.totalCarbonGCo2Eq}`],
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: 'risk-nominal',
      severity: 'low',
      title: 'All workspace governance, simulation, and review checks are nominal',
      recommendation:
        'Continue logging experimental milestones into the Collaborative Sandbox and 3D Narrative timeline.',
      whyDetected: 'Zero unverified licenses, drifted simulations, or unconsented vault operations detected.',
      triggeredByMetrics: [`licenses=${licenses.length}`, `sims=${sims.length}`],
    });
  }

  return {
    alerts,
    memoryCount: state.notes.length,
    memoryEnabled: state.memoryEnabled,
  };
}
