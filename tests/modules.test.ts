import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import { initializeCorpus } from '../server/corpusIndex.ts';
import { probeOllamaGateway } from '../server/modules/thoughtPrototypes.ts';

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

async function loginAs(roleOrEmail: string, accessCode: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleOrEmail, accessCode }),
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { token: string };
  return data.token;
}

describe('10 Future-Edge Modules Integrated Suite', () => {
  it('1. Live Knowledge Flux + Project Gutenberg connector + SHA-256 deduplication', async () => {
    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://gutendex.com/')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 1342,
                title: 'On the Origin of Species',
                authors: [{ name: 'Darwin, Charles' }],
                subjects: ['Natural selection', 'Evolution'],
                summaries: [
                  'Foundational treatise detailing variation, heritability, and evolutionary adaptation across populations.',
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const ingestRes = await fetch(`${baseUrl}/api/ingestion/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({
          source: 'gutenberg',
          query: 'Darwin',
          limit: 1,
        }),
      });
      expect(ingestRes.status).toBe(201);
      const ingestData = (await ingestRes.json()) as { chunksIndexed: number };
      expect(ingestData.chunksIndexed).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const fluxRes = await fetch(`${baseUrl}/api/flux/events`);
    expect(fluxRes.status).toBe(200);
    const fluxData = (await fluxRes.json()) as {
      stats: { totalEvents: number; deduplicatedDigests: number };
      events: Array<{ topic: string; digestSha256: string }>;
    };
    expect(fluxData.stats.totalEvents).toBeGreaterThan(0);
    expect(fluxData.stats.deduplicatedDigests).toBeGreaterThan(0);
    expect(fluxData.events.some((e) => e.topic === 'knowledge.ingested')).toBe(true);
  });

  it('2. Collaborative Design Sandbox syncs Yjs CRDT deltas and manages version snapshots', async () => {
    const guestUpdate = await fetch(`${baseUrl}/api/sandbox/quantum-md-alpha/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateBase64: 'AAAA' }),
    });
    expect(guestUpdate.status).toBe(401);

    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');
    const stateRes = await fetch(`${baseUrl}/api/sandbox/quantum-md-alpha`);
    expect(stateRes.status).toBe(200);
    const stateData = (await stateRes.json()) as { stateBase64: string };

    // Apply local Yjs edit and push binary delta to server
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, new Uint8Array(Buffer.from(stateData.stateBase64, 'base64')));
    let capturedDelta = '';
    clientDoc.on('update', (upd) => {
      capturedDelta = Buffer.from(upd).toString('base64');
    });
    clientDoc.transact(() => {
      clientDoc.getMap('experiment').set('temperatureK', 310);
    });

    const updateRes = await fetch(`${baseUrl}/api/sandbox/quantum-md-alpha/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ updateBase64: capturedDelta }),
    });
    expect(updateRes.status).toBe(200);

    const snapRes = await fetch(`${baseUrl}/api/sandbox/quantum-md-alpha/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ title: '310K Physiological Temp' }),
    });
    expect(snapRes.status).toBe(201);
    const snapData = (await snapRes.json()) as {
      snapshot: { snapshotId: string; summary: { temperatureK: number } };
    };
    expect(snapData.snapshot.summary.temperatureK).toBe(310);

    const restoreRes = await fetch(
      `${baseUrl}/api/sandbox/quantum-md-alpha/restore/${snapData.snapshot.snapshotId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(restoreRes.status).toBe(200);
  });

  it('3 & 9. Thought-Prototypes Ollama probe reflects real daemon status & Grant Draft RBAC', async () => {
    const probe = await probeOllamaGateway();
    expect(typeof probe.reachable).toBe('boolean');

    const protoRes = await fetch(`${baseUrl}/api/prototypes`);
    expect(protoRes.status).toBe(200);

    const guestGrantRes = await fetch(`${baseUrl}/api/grants/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Quantum Chemistry' }),
    });
    expect(guestGrantRes.status).toBe(401);
  });

  it('4. Pharmacogenomics Vault enforces AES-256-GCM encryption, consent gate, CPIC citations, and revocation', async () => {
    const guestList = await fetch(`${baseUrl}/api/pgx/samples`);
    expect(guestList.status).toBe(401);

    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');

    // Missing consent must be blocked
    const noConsent = await fetch(`${baseUrl}/api/pgx/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        sampleAlias: 'NO-CONSENT-01',
        genomicPayload: 'CYP2C19*2\nTPMT*3A',
        consentGranted: false,
        consentScope: 'None',
      }),
    });
    expect(noConsent.status).toBe(403);

    const secretMarker = 'CYP2C19*2\nDPYD*2A\nPRIVATE_GENOMIC_SEQ_DO_NOT_EXPOSURE';
    const uploadRes = await fetch(`${baseUrl}/api/pgx/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        sampleAlias: 'PGX-COHORT-99',
        genomicPayload: secretMarker,
        consentGranted: true,
        consentScope: 'CPIC Research Annotation Only',
      }),
    });
    expect(uploadRes.status).toBe(201);
    const uploadData = (await uploadRes.json()) as {
      summary: { sampleId: string; cipherAlgorithm: string };
      evidenceMatchesCount: number;
    };
    expect(uploadData.summary.cipherAlgorithm).toBe('aes-256-gcm');
    expect(uploadData.evidenceMatchesCount).toBe(2);

    // Raw genomic text must NEVER leak in list endpoint
    const listRes = await fetch(`${baseUrl}/api/pgx/samples`, {
      headers: { Authorization: `Bearer ${researcherToken}` },
    });
    const listText = await listRes.text();
    expect(listText).not.toContain('PRIVATE_GENOMIC_SEQ_DO_NOT_EXPOSURE');

    // Analyze returns CPIC cited evidence with uncertainty and no-prescribing notice
    const analyzeRes = await fetch(
      `${baseUrl}/api/pgx/samples/${uploadData.summary.sampleId}/analyze`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(analyzeRes.status).toBe(200);
    const analyzeData = (await analyzeRes.json()) as {
      evidence: Array<{ gene: string; uncertaintyNote: string; citation: string }>;
      clinicalPolicyNotice: string;
    };
    expect(analyzeData.evidence.some((e) => e.gene === 'CYP2C19')).toBe(true);
    expect(analyzeData.evidence[0].uncertaintyNote.length).toBeGreaterThan(10);
    expect(analyzeData.clinicalPolicyNotice).toContain('prohibits autonomous prescribing');

    // Revoking consent immediately blocks subsequent decryption
    const revokeRes = await fetch(
      `${baseUrl}/api/pgx/samples/${uploadData.summary.sampleId}/revoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(revokeRes.status).toBe(200);

    const blockedAfterRevoke = await fetch(
      `${baseUrl}/api/pgx/samples/${uploadData.summary.sampleId}/analyze`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(blockedAfterRevoke.status).toBe(403);
  });

  it('5, 6 & 8. 3D Narrative Mode, Eco-Impact Auditor, and Open-Data Market (IPFS CIDv1)', async () => {
    const narrativeRes = await fetch(`${baseUrl}/api/narrative/timeline`);
    expect(narrativeRes.status).toBe(200);
    const narrative = (await narrativeRes.json()) as {
      nodes: Array<{ position: [number, number, number] }>;
      edges: Array<{ from: string; to: string }>;
    };
    expect(narrative.nodes.length).toBeGreaterThan(0);
    expect(narrative.nodes[0].position).toHaveLength(3);

    const nordicEcoRes = await fetch(`${baseUrl}/api/eco/audit?region=eu-north1`);
    const eastEcoRes = await fetch(`${baseUrl}/api/eco/audit?region=us-east1`);
    expect(nordicEcoRes.status).toBe(200);
    const nordicEco = (await nordicEcoRes.json()) as {
      report: { totalCarbonGCo2Eq: number; formulaSummary: string };
    };
    const eastEco = (await eastEcoRes.json()) as {
      report: { totalCarbonGCo2Eq: number };
    };
    expect(nordicEco.report.totalCarbonGCo2Eq).toBeLessThan(eastEco.report.totalCarbonGCo2Eq);
    expect(nordicEco.report.formulaSummary).toContain('PUE');

    const marketRes = await fetch(`${baseUrl}/api/market/datasets`);
    expect(marketRes.status).toBe(200);
    const marketData = (await marketRes.json()) as {
      datasets: Array<{ datasetId: string; cidV1: string }>;
    };
    expect(marketData.datasets.length).toBeGreaterThanOrEqual(4);
    expect(marketData.datasets[0].cidV1.startsWith('bafybeig')).toBe(true);

    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');
    const badPublish = await fetch(`${baseUrl}/api/market/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        title: 'Closed Proprietary Dump',
        domain: 'Physics',
        owner: 'Private Co',
        license: 'All Rights Reserved',
        sizeMb: 12,
        recordsCount: 500,
        summary: 'Proprietary test dataset that should be rejected by SPDX check.',
        sourceUrl: 'https://example.org/prop',
        contentSample: 'Sample text exceeding twenty characters for validation.',
      }),
    });
    expect(badPublish.status).toBe(400);

    const acquireRes = await fetch(`${baseUrl}/api/market/acquire`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        datasetId: marketData.datasets[0].datasetId,
        indexIntoCorpus: true,
      }),
    });
    expect(acquireRes.status).toBe(201);
  });

  it('10. Predictive AI-Mentor enforces user-controlled memory privacy & explainable risks', async () => {
    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');

    const insightsRes = await fetch(`${baseUrl}/api/mentor/insights`, {
      headers: { Authorization: `Bearer ${researcherToken}` },
    });
    expect(insightsRes.status).toBe(200);
    const insights = (await insightsRes.json()) as {
      risks: { alerts: Array<{ whyDetected: string }> };
    };
    expect(insights.risks.alerts.length).toBeGreaterThan(0);
    expect(insights.risks.alerts[0].whyDetected.length).toBeGreaterThan(10);

    // Pause memory -> writing must fail cleanly
    await fetch(`${baseUrl}/api/mentor/memory/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ enabled: false }),
    });

    const blockedAdd = await fetch(`${baseUrl}/api/mentor/memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ topic: 'Goal', content: 'Should be rejected when paused' }),
    });
    expect(blockedAdd.status).toBe(403);

    // Wipe all user memory
    const wipeRes = await fetch(`${baseUrl}/api/mentor/memory`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${researcherToken}` },
    });
    expect(wipeRes.status).toBe(200);

    const afterWipeRes = await fetch(`${baseUrl}/api/mentor/insights`, {
      headers: { Authorization: `Bearer ${researcherToken}` },
    });
    const afterWipe = (await afterWipeRes.json()) as {
      memory: { notes: unknown[]; memoryEnabled: boolean };
    };
    expect(afterWipe.memory.notes).toHaveLength(0);
    expect(afterWipe.memory.memoryEnabled).toBe(false);
  });
});
