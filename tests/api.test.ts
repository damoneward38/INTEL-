import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import {
  ingestDocument,
  initializeCorpus,
  searchCorpus,
} from '../server/corpusIndex.ts';
import { clearFeedbackForTest } from '../server/feedbackStore.ts';
import {
  eligibleForOperation,
  getLicenseRecord,
  listLicenseRecords,
} from '../server/governance.ts';
import { authenticateCredentials } from '../server/auth.ts';
import { getSimulationJob, submitSimulationJob } from '../server/simulationEngine.ts';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  initializeCorpus();
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function loginAs(
  roleOrEmail: string,
  accessCode: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleOrEmail, accessCode }),
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { token: string };
  return data.token;
}

describe('License Governance & Document Versioning', () => {
  it('enforces retrieval/training/commercial eligibility and increments document version on re-ingest', () => {
    const firstChunks = ingestDocument({
      source: 'manual',
      title: 'Proprietary Crystal Lattice Dataset v1',
      authors: 'Governance Test Lab',
      domain: 'Materials Science',
      license: 'Custom Proprietary License',
      sourceUrl: 'https://example.org/lattice-prop',
      verified: false,
      commercialUseAllowed: false,
      trainingAllowed: false,
      content:
        'Proprietary phonon spectrum measurements for silicon carbide polytypes requiring explicit auditor sign-off prior to retrieval or model training.',
    });

    const docId = firstChunks[0].docId;
    expect(firstChunks[0].version).toBe(1);
    const unverifiedRecord = getLicenseRecord(docId)!;
    expect(eligibleForOperation(unverifiedRecord, 'retrieval')).toBe(false);
    expect(eligibleForOperation(unverifiedRecord, 'training')).toBe(false);

    // Unverified document must not appear in retrieval search results
    const blockedHits = searchCorpus('silicon carbide polytypes proprietary phonon', 5);
    expect(blockedHits.some((h) => h.title.includes('Proprietary Crystal Lattice'))).toBe(
      false
    );

    // Re-ingest with verified=true and trainingAllowed=false increments version
    const secondChunks = ingestDocument({
      source: 'manual',
      title: 'Proprietary Crystal Lattice Dataset v1',
      authors: 'Governance Test Lab',
      domain: 'Materials Science',
      license: 'CC-BY-NC-ND-4.0',
      sourceUrl: 'https://example.org/lattice-prop',
      verified: true,
      commercialUseAllowed: false,
      trainingAllowed: false,
      content:
        'Verified read-only phonon spectrum measurements for silicon carbide polytypes allowing cited retrieval while blocking derivative training and commercial reuse.',
    });

    expect(secondChunks[0].version).toBe(2);
    const verifiedReadOnly = getLicenseRecord(docId)!;
    expect(eligibleForOperation(verifiedReadOnly, 'retrieval')).toBe(true);
    expect(eligibleForOperation(verifiedReadOnly, 'training')).toBe(false);
    expect(eligibleForOperation(verifiedReadOnly, 'commercial')).toBe(false);

    const allowedHits = searchCorpus('silicon carbide polytypes phonon spectrum', 5);
    expect(allowedHits.some((h) => h.title.includes('Proprietary Crystal Lattice'))).toBe(
      true
    );
  });
});

describe('Known-Answer Scientific Retrieval Validation', () => {
  it('ranks canonical ground-truth documents #1 for standard benchmark questions', () => {
    initializeCorpus();

    const cases: Array<{ query: string; expectedTitleFragment: string }> = [
      {
        query: 'How does LangevinMiddleIntegrator maintain NVT canonical sampling in OpenMM?',
        expectedTitleFragment: 'OpenMM 8',
      },
      {
        query: 'What is the 12-6 Lennard-Jones reduced critical temperature in NIST SRSW?',
        expectedTitleFragment: 'Lennard-Jones Fluid',
      },
      {
        query: 'What fault-tolerant error threshold do 2D surface code lattice stabilizers achieve?',
        expectedTitleFragment: 'Surface Code',
      },
      {
        query: 'What restricted Hartree-Fock cc-pVDZ SCF energy does Psi4 converge to for H2O?',
        expectedTitleFragment: 'Psi4 Ab Initio',
      },
    ];

    for (const tc of cases) {
      const hits = searchCorpus(tc.query, 3);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].title).toContain(tc.expectedTitleFragment);
    }
  });
});

describe('Simulation Reference Dataset Validation', () => {
  it('validates langevin-md and psi4-scf outputs against reference tolerances', async () => {
    const researcher = authenticateCredentials('researcher', 'RESEARCH-2026')!;

    const psi4Job = submitSimulationJob(
      {
        engine: 'psi4-scf',
        temperature: 300,
        pressure: 1,
        steps: 300,
        particleCount: 16,
      },
      researcher
    );

    const deadline = Date.now() + 6000;
    let latest = getSimulationJob(psi4Job.jobId);
    while (latest && latest.state === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 80));
      latest = getSimulationJob(psi4Job.jobId);
    }

    expect(latest?.state).toBe('completed');
    expect(latest?.referenceValidation?.passed).toBe(true);
    expect(latest?.referenceValidation?.benchmarkName).toContain('Psi4');

    const ljJob = submitSimulationJob(
      {
        engine: 'langevin-md',
        temperature: 300,
        pressure: 1,
        steps: 200,
        particleCount: 16,
      },
      researcher
    );

    const ljDeadline = Date.now() + 6000;
    let ljLatest = getSimulationJob(ljJob.jobId);
    while (ljLatest && ljLatest.state === 'running' && Date.now() < ljDeadline) {
      await new Promise((r) => setTimeout(r, 80));
      ljLatest = getSimulationJob(ljJob.jobId);
    }

    expect(ljLatest?.state).toBe('completed');
    expect(ljLatest?.referenceValidation?.passed).toBe(true);
    expect(ljLatest?.referenceValidation?.benchmarkName).toContain('NIST Lennard-Jones');
  });
});

describe('Full Express API Route Coverage & RBAC', () => {
  it('serves health, auth directory/session/login, and rejects bad credentials', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { status: string; corpusChunks: number };
    expect(health.status).toBe('ok');
    expect(health.corpusChunks).toBeGreaterThanOrEqual(7);

    const dirRes = await fetch(`${baseUrl}/api/auth/directory`);
    expect(dirRes.status).toBe(200);
    const dir = (await dirRes.json()) as { accounts: Array<{ role: string }> };
    expect(dir.accounts.length).toBeGreaterThanOrEqual(3);

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
    expect(sessionRes.status).toBe(200);
    const sess = (await sessionRes.json()) as { session: { role: string } };
    expect(sess.session.role).toBe('guest');

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleOrEmail: 'researcher', accessCode: 'WRONG' }),
    });
    expect(badLogin.status).toBe(401);
  });

  it('enforces corpus, hybrid search, mocked external arXiv ingestion, and governance routes', async () => {
    const corpusRes = await fetch(`${baseUrl}/api/corpus`);
    expect(corpusRes.status).toBe(200);

    const shortSearch = await fetch(`${baseUrl}/api/retrieval/search?q=a`);
    expect(shortSearch.status).toBe(400);

    const validSearch = await fetch(
      `${baseUrl}/api/retrieval/search?q=${encodeURIComponent('Langevin thermostat')}&limit=3`
    );
    expect(validSearch.status).toBe(200);
    const validSearchJson = (await validSearch.json()) as {
      results: Array<{ title: string }>;
    };
    expect(validSearchJson.results.length).toBeGreaterThan(0);

    // Guest blocked from ingestion
    const guestIngest = await fetch(`${baseUrl}/api/corpus/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(guestIngest.status).toBe(401);

    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');
    const researcherIngest = await fetch(`${baseUrl}/api/corpus/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        title: 'API Integration Test Paper',
        authors: 'Dr. Test',
        domain: 'Quantum Chemistry',
        license: 'MIT',
        sourceUrl: 'https://example.org/api-paper',
        content:
          'Density functional theory benchmarks validate Hartree-Fock exchange functional accuracy across molecular dimers.',
      }),
    });
    expect(researcherIngest.status).toBe(201);

    // Mock external fetch for /api/ingestion/start while preserving local loopback requests
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://export.arxiv.org/')) {
        return new Response(
          `<feed><entry><id>https://arxiv.org/abs/2501.00001</id><title>Mocked Symplectic Integrator Study</title><summary>We demonstrate long-time energy conservation in symplectic Verlet molecular dynamics integrators.</summary><author><name>A. Integrator</name></author></entry></feed>`,
          { status: 200, headers: { 'Content-Type': 'application/xml' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const extIngest = await fetch(`${baseUrl}/api/ingestion/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({
          source: 'arxiv',
          query: 'symplectic integrator',
          limit: 1,
        }),
      });
      expect(extIngest.status).toBe(201);
      const extJson = (await extIngest.json()) as {
        chunksIndexed: number;
        provenanceId: string;
      };
      expect(extJson.chunksIndexed).toBeGreaterThanOrEqual(1);
      expect(extJson.provenanceId).toMatch(/^prov-/);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Governance licenses list & auditor-only verification
    const licensesRes = await fetch(`${baseUrl}/api/governance/licenses`);
    expect(licensesRes.status).toBe(200);
    const licensesJson = (await licensesRes.json()) as {
      licenses: Array<{ documentId: string }>;
    };
    const targetDocId =
      listLicenseRecords()[0]?.documentId ?? licensesJson.licenses[0].documentId;

    const researcherVerify = await fetch(
      `${baseUrl}/api/governance/licenses/${targetDocId}/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({ trainingAllowed: false }),
      }
    );
    expect(researcherVerify.status).toBe(403);

    const auditorToken = await loginAs('auditor', 'AUDIT-2026');
    const auditorVerify = await fetch(
      `${baseUrl}/api/governance/licenses/${targetDocId}/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auditorToken}`,
        },
        body: JSON.stringify({ trainingAllowed: false }),
      }
    );
    expect(auditorVerify.status).toBe(200);
    const verifiedJson = (await auditorVerify.json()) as {
      license: { trainingAllowed: boolean };
    };
    expect(verifiedJson.license.trainingAllowed).toBe(false);
  });

  it('enforces research RBAC, simulation submit/list/get/cancel, feedback quarantine, provenance & logs', async () => {
    clearFeedbackForTest();

    // Comprehensive research blocked for guest
    const guestResearch = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Explain quantum error correction surface codes',
        language: 'en',
        depth: 'comprehensive',
      }),
    });
    expect(guestResearch.status).toBe(403);

    // Simulation > 5000 steps blocked for guest
    const blockedSim = await fetch(`${baseUrl}/api/simulation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: 'blast-align',
        temperature: 300,
        pressure: 1,
        steps: 8000,
      }),
    });
    expect(blockedSim.status).toBe(403);

    // Submit allowed blast-align simulation as guest
    const simRes = await fetch(`${baseUrl}/api/simulation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: 'blast-align',
        temperature: 300,
        pressure: 1,
        steps: 400,
        particleCount: 16,
      }),
    });
    expect(simRes.status).toBe(202);
    const simJob = (await simRes.json()) as { jobId: string };

    const simsRes = await fetch(`${baseUrl}/api/simulations`);
    expect(simsRes.status).toBe(200);

    const getSimRes = await fetch(`${baseUrl}/api/simulation/${simJob.jobId}`);
    expect(getSimRes.status).toBe(200);

    const cancelRes = await fetch(`${baseUrl}/api/simulation/${simJob.jobId}/cancel`, {
      method: 'POST',
    });
    expect(cancelRes.status).toBe(200);

    // Feedback validation & quarantine enforcement
    const badFeedback = await fetch(`${baseUrl}/api/feedback/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provenanceId: 'prov-1',
        question: 'Test question',
        answerExcerpt: 'Test excerpt',
        rating: 6,
      }),
    });
    expect(badFeedback.status).toBe(400);

    const goodFeedback = await fetch(`${baseUrl}/api/feedback/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provenanceId: 'prov-1',
        question: 'Does Langevin thermostat conserve canonical NVT temperature?',
        answerExcerpt: 'Yes, mean kinetic temperature converges around 300 K.',
        rating: 5,
        comments: 'Verified against OpenMM benchmark.',
        reviewDecision: 'approved',
      }),
    });
    expect(goodFeedback.status).toBe(201);
    const fbJson = (await goodFeedback.json()) as { autoTrainingBlocked: boolean };
    expect(fbJson.autoTrainingBlocked).toBe(true);

    const fbListRes = await fetch(`${baseUrl}/api/feedback`);
    expect(fbListRes.status).toBe(200);
    const fbList = (await fbListRes.json()) as { feedback: Array<{ rating: number }> };
    expect(fbList.feedback.length).toBe(1);
    expect(fbList.feedback[0].rating).toBe(5);

    // Provenance redaction vs auditor privilege & /api/logs
    const guestProvRes = await fetch(`${baseUrl}/api/provenance`);
    expect(guestProvRes.status).toBe(200);
    const guestProv = (await guestProvRes.json()) as { privileged: boolean };
    expect(guestProv.privileged).toBe(false);

    const guestLogsRes = await fetch(`${baseUrl}/api/logs`);
    expect(guestLogsRes.status).toBe(401);

    const auditorToken = await loginAs('auditor', 'AUDIT-2026');
    const auditorLogsRes = await fetch(`${baseUrl}/api/logs`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    expect(auditorLogsRes.status).toBe(200);

    // Unmatched /api/* routes must return JSON 404 instead of falling through to Vite/SPA
    const missingApiRes = await fetch(`${baseUrl}/api/nonexistent-endpoint-check`);
    expect(missingApiRes.status).toBe(404);
    const missingApiJson = (await missingApiRes.json()) as { error?: string };
    expect(typeof missingApiJson.error).toBe('string');
    expect(missingApiJson.error).toContain('API endpoint not found');
  });

  it('configures Vite allowedHosts: true so preview hosts do not receive 403 Blocked request', async () => {
    const fs = await import('node:fs');
    const viteCfg = fs.readFileSync('vite.config.ts', 'utf8');
    expect(viteCfg).toContain('allowedHosts: true');
  });
});

