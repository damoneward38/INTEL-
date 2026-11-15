import { listCorpusChunks } from '../corpusIndex.ts';
import { listFeedback } from '../feedbackStore.ts';
import { listProvenance } from '../provenance.ts';
import { listSimulationJobs } from '../simulationEngine.ts';
import type { NarrativeNode } from '../types.ts';
import { listMarketTransactions } from './openDataMarket.ts';
import { listThoughtPrototypes } from './thoughtPrototypes.ts';

export function buildNarrativeTimeline(): {
  nodes: NarrativeNode[];
  edges: Array<{ from: string; to: string; relation: string }>;
} {
  const nodes: NarrativeNode[] = [];
  const edges: Array<{ from: string; to: string; relation: string }> = [];

  const chunks = listCorpusChunks().slice(0, 6);
  const sims = listSimulationJobs().slice(0, 5);
  const provs = listProvenance(20).filter((p) => p.kind === 'research').slice(0, 5);
  const reviews = listFeedback(10).slice(0, 4);
  const protos = listThoughtPrototypes().slice(0, 4);
  const txs = listMarketTransactions().slice(0, 4);

  let stepIdx = 0;
  function nextPos(): [number, number, number] {
    const angle = stepIdx * 0.68;
    const radius = 2.6 + (stepIdx % 3) * 0.55;
    const x = Number((Math.cos(angle) * radius).toFixed(3));
    const y = Number((((stepIdx % 5) - 2) * 0.45).toFixed(3));
    const z = Number((stepIdx * 1.1 - 3.5).toFixed(3));
    stepIdx += 1;
    return [x, y, z];
  }

  for (const chunk of chunks) {
    nodes.push({
      id: chunk.id,
      kind: 'corpus',
      title: chunk.title,
      subtitle: `${chunk.domain} · v${chunk.version}`,
      timestamp: chunk.ingestedAt,
      position: nextPos(),
      sourceUrl: chunk.sourceUrl,
      license: chunk.license,
      metrics: {
        tokens: chunk.tokenCount,
        verified: chunk.licenseRecord.verified,
      },
      linkedIds: [],
    });
  }

  for (const sim of sims) {
    const linked = chunks.length > 0 ? [chunks[0].id] : [];
    nodes.push({
      id: sim.jobId,
      kind: 'simulation',
      title: `${sim.engine.toUpperCase()} (${sim.state})`,
      subtitle: `${sim.parameters.temperature} K · ${sim.parameters.steps} steps`,
      timestamp: sim.createdAt,
      position: nextPos(),
      metrics: {
        progress: sim.progress,
        benchmarkPassed: sim.referenceValidation?.passed ?? false,
      },
      linkedIds: linked,
    });
    for (const target of linked) {
      edges.push({ from: target, to: sim.jobId, relation: 'parameterizes' });
    }
  }

  for (const rec of provs) {
    const linked = chunks.slice(0, 2).map((c) => c.id);
    nodes.push({
      id: rec.id,
      kind: 'research',
      title: `Grounded Synthesis (${rec.action})`,
      subtitle: `Digest ${rec.digestSha256.slice(0, 12)}...`,
      timestamp: rec.timestamp,
      position: nextPos(),
      sourceUrl: rec.sourceUrls[0],
      license: rec.licenses[0],
      metrics: {
        corpusHits: Number(rec.metadata.corpusHits ?? 0),
        webHits: Number(rec.metadata.webHits ?? 0),
      },
      linkedIds: linked,
    });
    for (const target of linked) {
      edges.push({ from: target, to: rec.id, relation: 'cites' });
    }
  }

  for (const proto of protos) {
    const linked = proto.citations.slice(0, 2).map((c) => c.id);
    nodes.push({
      id: proto.id,
      kind: 'prototype',
      title: proto.title,
      subtitle: `Hypothesis Protocol (${proto.gatewayUsed})`,
      timestamp: proto.createdAt,
      position: nextPos(),
      metrics: { steps: proto.protocolSteps.length },
      linkedIds: linked,
    });
    for (const target of linked) {
      edges.push({ from: target, to: proto.id, relation: 'inspires' });
    }
  }

  for (const fb of reviews) {
    nodes.push({
      id: fb.id,
      kind: 'review',
      title: `Peer Review (${fb.reviewDecision})`,
      subtitle: `Rating ${fb.rating}/5 · Auto-training blocked`,
      timestamp: fb.createdAt,
      position: nextPos(),
      metrics: { rating: fb.rating, quarantined: fb.autoTrainingBlocked },
      linkedIds: [fb.provenanceId],
    });
    if (nodes.some((n) => n.id === fb.provenanceId)) {
      edges.push({ from: fb.provenanceId, to: fb.id, relation: 'reviewed_by' });
    }
  }

  for (const tx of txs) {
    nodes.push({
      id: tx.txId,
      kind: 'market',
      title: `Open Dataset ${tx.datasetId}`,
      subtitle: `CID ${tx.cidV1.slice(0, 14)}...`,
      timestamp: tx.timestamp,
      position: nextPos(),
      license: tx.license,
      metrics: { indexed: tx.indexedIntoCorpus },
      linkedIds: [],
    });
  }

  nodes.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  // Connect consecutive chronological nodes along the 3D research spine
  for (let i = 1; i < nodes.length; i++) {
    edges.push({
      from: nodes[i - 1].id,
      to: nodes[i].id,
      relation: 'chronology',
    });
  }

  return { nodes, edges };
}
