import crypto from 'node:crypto';
import { ingestDocument } from '../corpusIndex.ts';
import { inferLicensePolicy } from '../governance.ts';
import { logger } from '../logger.ts';
import { recordProvenance } from '../provenance.ts';
import type { AuthSession, CorpusChunk, MarketDataset, MarketTransaction } from '../types.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';

function computeIpfsCidV1(payload: string): string {
  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return `bafybeig${hash.slice(0, 38)}`;
}

const CATALOG_SEEDS: Array<Omit<MarketDataset, 'cidV1'>> = [
  {
    datasetId: 'ds-nist-lj-eos-v4',
    title: 'NIST Lennard-Jones Reference Trajectory & Virial Benchmark Archive',
    domain: 'Thermodynamics',
    owner: 'NIST Standard Reference Data',
    license: 'CC0-1.0',
    verified: true,
    sizeMb: 42.5,
    recordsCount: 12000,
    summary:
      'Calibrated canonical NVT and NVE molecular dynamics reference pressures and radial distribution functions across reduced state points.',
    sourceUrl: 'https://www.nist.gov/mml/csd/informatics/lammps-md-equation-state-validation',
    contentSample:
      'NIST Lennard-Jones 12-6 reference archive establishes T* = 2.50 canonical benchmarks, virial pressure tables, and long-range tail correction verification protocols for molecular dynamics engines.',
  },
  {
    datasetId: 'ds-cpic-pgx-alleles-2026',
    title: 'CPIC Curated Drug-Gene Star Allele Diplotype Mapping Corpus',
    domain: 'Pharmacogenomics',
    owner: 'Clinical Pharmacogenetics Implementation Consortium',
    license: 'CC-BY-4.0',
    verified: true,
    sizeMb: 18.2,
    recordsCount: 4850,
    summary:
      'Open-access Level 1A/1B evidence mappings linking CYP2C19, CYP2D6, TPMT, SLCO1B1, VKORC1, and DPYD variants to peer-reviewed clinical pharmacokinetics literature.',
    sourceUrl: 'https://cpicpgx.org/genes-drugs/',
    contentSample:
      'CPIC Level 1A pharmacogenomics evidence catalog standardizes allele function definitions, activity scores, and drug metabolism phenotypes with explicit clinical uncertainty qualifiers.',
  },
  {
    datasetId: 'ds-psi4-gmtkn55-subset',
    title: 'Psi4 Quantum Chemistry SCF Convergence & Basis-Set Benchmark Set',
    domain: 'Quantum Chemistry',
    owner: 'Psi4 Open Source Consortium',
    license: 'MIT',
    verified: true,
    sizeMb: 64.0,
    recordsCount: 3100,
    summary:
      'Ab initio RHF, MP2, and DFT total electronic energies across cc-pVDZ and aug-cc-pVTZ basis sets with DIIS convergence traces.',
    sourceUrl: 'https://psicode.org/',
    contentSample:
      'Psi4 quantum chemistry benchmark dataset includes closed-shell H2O -76.0268 Hartree RHF/cc-pVDZ single-point convergence curves and density-fitting integral tolerances.',
  },
  {
    datasetId: 'ds-wikidata-bio-ontology',
    title: 'Wikidata Open Biomedical & Protein Ontology Snapshot',
    domain: 'Biophysics',
    owner: 'Wikidata Scientific Commons',
    license: 'CC0-1.0',
    verified: true,
    sizeMb: 112.8,
    recordsCount: 85000,
    summary:
      'Structured RDF/JSON-LD triples connecting human genes, UniProt protein identifiers, enzymatic pathways, and PubMed citations.',
    sourceUrl: 'https://www.wikidata.org/wiki/Wikidata:WikiProject_Molecular_biology',
    contentSample:
      'Wikidata Molecular Biology Knowledge Graph snapshot bridges UniProt identifiers, Gene Ontology biological processes, and curated biomedical literature links under CC0.',
  },
];

const marketCatalog = new Map<string, MarketDataset>();
const marketTransactions: MarketTransaction[] = [];

function ensureCatalog(): void {
  if (marketCatalog.size > 0) return;
  for (const seed of CATALOG_SEEDS) {
    marketCatalog.set(seed.datasetId, {
      ...seed,
      cidV1: computeIpfsCidV1(`${seed.datasetId}:${seed.sourceUrl}:${seed.contentSample}`),
    });
  }
}

export function listMarketDatasets(): MarketDataset[] {
  ensureCatalog();
  return Array.from(marketCatalog.values());
}

export function publishMarketDataset(
  input: {
    title: string;
    domain: string;
    owner: string;
    license: string;
    sizeMb: number;
    recordsCount: number;
    summary: string;
    sourceUrl: string;
    contentSample: string;
  },
  session: AuthSession
): MarketDataset {
  ensureCatalog();
  const policy = inferLicensePolicy(input.license);
  if (!policy.verifiedByDefault) {
    throw new Error(
      `License '${input.license}' must be an SPDX open-data license (CC0-1.0, CC-BY-4.0, MIT, Apache-2.0) to list on the Open-Data Market.`
    );
  }

  const datasetId = `ds-${crypto.randomUUID().slice(0, 8)}`;
  const cidV1 = computeIpfsCidV1(`${input.title}:${input.sourceUrl}:${input.contentSample}`);
  const created: MarketDataset = {
    datasetId,
    title: input.title.trim(),
    domain: input.domain.trim(),
    owner: input.owner.trim(),
    license: input.license.trim(),
    verified: true,
    cidV1,
    sizeMb: Number(input.sizeMb.toFixed(2)),
    recordsCount: input.recordsCount,
    summary: input.summary.trim(),
    sourceUrl: input.sourceUrl.trim(),
    contentSample: input.contentSample.trim(),
  };

  marketCatalog.set(datasetId, created);

  publishFluxEvent({
    topic: 'market.transaction',
    key: datasetId,
    actorRole: session.role,
    summary: `Published open dataset "${created.title}" (${created.license})`,
    payload: { datasetId, cidV1, license: created.license },
  });

  return created;
}

export function acquireMarketDataset(
  datasetId: string,
  indexIntoCorpus: boolean,
  session: AuthSession
): {
  transaction: MarketTransaction;
  dataset: MarketDataset;
  indexedChunks: CorpusChunk[];
} {
  ensureCatalog();
  const dataset = marketCatalog.get(datasetId);
  if (!dataset) {
    throw new Error('Dataset not found in Open-Data Market catalog.');
  }
  if (!dataset.verified) {
    throw new Error('Dataset license verification failed; acquisition blocked.');
  }

  let indexedChunks: CorpusChunk[] = [];
  if (indexIntoCorpus) {
    indexedChunks = ingestDocument({
      source: 'open-data-market',
      title: dataset.title,
      authors: dataset.owner,
      domain: dataset.domain,
      license: dataset.license,
      sourceUrl: dataset.sourceUrl,
      content: `${dataset.summary} ${dataset.contentSample}`,
      verified: true,
    });
  }

  const provenance = recordProvenance({
    kind: 'corpus_ingest',
    actorId: session.userId,
    actorRole: session.role,
    action: 'market:acquire_dataset',
    rawInput: `${dataset.datasetId}:${dataset.cidV1}`,
    modelOrEngine: 'ipfs-cidv1-content-address',
    licenses: [dataset.license],
    sourceUrls: [dataset.sourceUrl],
    metadata: {
      datasetId: dataset.datasetId,
      cidV1: dataset.cidV1,
      indexedIntoCorpus: indexIntoCorpus,
    },
  });

  const transaction: MarketTransaction = {
    txId: `tx-${crypto.randomUUID().slice(0, 8)}`,
    datasetId: dataset.datasetId,
    cidV1: dataset.cidV1,
    license: dataset.license,
    buyerId: session.userId,
    buyerRole: session.role,
    indexedIntoCorpus: indexIntoCorpus,
    provenanceId: provenance.id,
    timestamp: new Date().toISOString(),
  };

  marketTransactions.unshift(transaction);

  publishFluxEvent({
    topic: 'market.transaction',
    key: dataset.datasetId,
    actorRole: session.role,
    summary: `Acquired & verified ${dataset.title} (${dataset.cidV1.slice(0, 14)}...)`,
    payload: { txId: transaction.txId, indexedChunks: indexedChunks.length },
  });

  logger.info('open-data-market', 'Dataset license verified and acquired', {
    txId: transaction.txId,
    datasetId: dataset.datasetId,
    cidV1: dataset.cidV1,
  });

  return { transaction, dataset, indexedChunks };
}

export function listMarketTransactions(): MarketTransaction[] {
  return marketTransactions.slice(0, 50);
}
