import { describe, expect, it } from 'vitest';
import {
  authenticateCredentials,
  hasRoleAtLeast,
  signSessionToken,
  verifySessionToken,
} from '../server/auth.ts';
import {
  ingestDocument,
  initializeCorpus,
  searchCorpus,
} from '../server/corpusIndex.ts';
import { clearProvenanceForTest, listProvenance, recordProvenance } from '../server/provenance.ts';
import { submitSimulationJob, getSimulationJob } from '../server/simulationEngine.ts';

describe('Backend Corpus Vector Index', () => {
  it('retrieves relevant indexed chunks with similarity scores and licenses', () => {
    initializeCorpus();
    const hits = searchCorpus('Langevin thermostat molecular dynamics', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].origin).toBe('indexed_corpus');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].license.length).toBeGreaterThan(0);
  });

  it('retrieves Hebrew queries against indexed chunks', () => {
    initializeCorpus();
    const hits = searchCorpus('סימולציה מולקולרית תרמוסטט', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toContain('OpenMM');
  });

  it('ingests new documents and indexes them for search', () => {
    const created = ingestDocument({
      title: 'Graphene Thermal Conductivity Verification',
      authors: 'Test Lab',
      domain: 'Materials Science',
      license: 'CC-BY-4.0',
      sourceUrl: 'https://example.org/graphene',
      content:
        'Monolayer graphene exhibits anomalous ballistic phonon transport and ultra-high thermal conductivity exceeding 3000 W/mK at room temperature.',
    });
    expect(created.length).toBeGreaterThan(0);

    const hits = searchCorpus('ballistic phonon transport graphene', 2);
    expect(hits.some((h) => h.title.includes('Graphene Thermal Conductivity'))).toBe(true);
  });
});

describe('Backend Auth, RBAC & Provenance', () => {
  it('signs and verifies HMAC session tokens and enforces roles', () => {
    const session = authenticateCredentials('researcher', 'RESEARCH-2026');
    expect(session).not.toBeNull();
    expect(session!.role).toBe('researcher');

    const token = signSessionToken(session!);
    const verified = verifySessionToken(token);
    expect(verified?.userId).toBe(session!.userId);
    expect(verifySessionToken(`${token}tampered`)).toBeNull();

    expect(hasRoleAtLeast('researcher', 'guest')).toBe(true);
    expect(hasRoleAtLeast('researcher', 'principal_investigator')).toBe(false);
    expect(hasRoleAtLeast('auditor', 'auditor')).toBe(true);
  });

  it('records SHA-256 provenance digests', () => {
    clearProvenanceForTest();
    const rec = recordProvenance({
      kind: 'research',
      actorId: 'usr-test',
      actorRole: 'researcher',
      action: 'research:standard:text',
      rawInput: 'test query',
      modelOrEngine: 'gemini-4-hydrogen',
      licenses: ['CC-BY-4.0'],
      sourceUrls: ['https://example.org'],
    });
    expect(rec.digestSha256).toHaveLength(64);
    expect(listProvenance(10)).toHaveLength(1);
  });
});

describe('Isolated Worker Simulation Engine', () => {
  it('submits and completes a real Lennard-Jones molecular dynamics job', async () => {
    const session = authenticateCredentials('researcher', 'RESEARCH-2026')!;
    const job = submitSimulationJob(
      {
        engine: 'langevin-md',
        temperature: 300,
        pressure: 1,
        steps: 200,
        particleCount: 16,
      },
      session
    );

    expect(job.jobId).toMatch(/^sim-/);

    // Wait for worker completion (200 steps finishes quickly)
    let latest = getSimulationJob(job.jobId);
    const deadline = Date.now() + 4500;
    while (latest && latest.state === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 80));
      latest = getSimulationJob(job.jobId);
    }

    expect(latest?.state).toBe('completed');
    expect(latest?.progress).toBe(100);
    expect(latest?.frames.length).toBeGreaterThan(5);
    expect(latest?.particles.length).toBe(16);
    expect(latest?.summary?.meanTempK).toBeGreaterThan(0);
  });
});
