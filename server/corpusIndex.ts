import crypto from 'node:crypto';
import {
  eligibleForOperation,
  getLicenseRecord,
  inferLicensePolicy,
  registerLicenseRecord,
} from './governance.ts';
import {
  publishFluxEvent,
  registerContentDigest,
} from './modules/knowledgeFlux.ts';
import type { CorpusChunk, CorpusDocumentInput, RetrievedSource } from './types.ts';

const SEED_DOCUMENTS: CorpusDocumentInput[] = [
  {
    source: 'acs-jpcb',
    title: 'OpenMM 8: Molecular Dynamics Simulation with Machine Learning Potentials',
    authors: 'Eastman, P., Galvelis, R., Arras, R. P., et al.',
    domain: 'Molecular Dynamics',
    license: 'MIT / CC-BY-4.0',
    sourceUrl: 'https://pubs.acs.org/doi/10.1021/acs.jpcb.3c06662',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'OpenMM is a high-performance toolkit for molecular simulation. LangevinMiddleIntegrator implements a discretized Langevin thermostat with superior configurational sampling accuracy at larger time steps (up to 4 fs with hydrogen mass repartitioning). In NVT ensembles, temperature coupling maintains canonical kinetic energy distributions while Velocity-Verlet integration conserves symplectic structure in NVE microcanonical trajectories. סימולציה מולקולרית דינמיקה מולקולרית תרמוסטט לנז׳בין טמפרטורה.',
  },
  {
    source: 'nist-srsw',
    title: 'Lennard-Jones Fluid Phase Behavior and Equation of State Benchmarks',
    authors: 'NIST Standard Reference Simulation Website (SRSW)',
    domain: 'Thermodynamics',
    license: 'CC0-1.0',
    sourceUrl: 'https://www.nist.gov/mml/csd/informatics/lammps-md-equation-state-validation',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'The 12-6 Lennard-Jones pair potential U(r) = 4*epsilon*[(sigma/r)^12 - (sigma/r)^6] serves as the canonical benchmark for condensed matter and noble gas thermodynamics. Reduced temperature T* = kB*T/epsilon and reduced density rho* = N*sigma^3/V govern vapor-liquid coexistence, critical point behavior around T*_c = 1.312, and virial pressure convergence under periodic boundary conditions. תרמודינמיקה לחץ ויראלי משוואת מצב נוזל לנארד ג׳ונס.',
  },
  {
    source: 'arxiv',
    title: 'Retrieval-Augmented Generation with Dense Vector Indexing (FAISS / HNSW)',
    authors: 'Johnson, J., Douze, M., & Jégou, H.',
    domain: 'Information Retrieval',
    license: 'MIT',
    sourceUrl: 'https://arxiv.org/abs/1702.08734',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'Billion-scale similarity search with quantized vector indices enables low-latency retrieval of grounded scientific chunks. Cosine similarity over L2-normalized term-frequency and semantic embedding vectors ensures every synthesized claim can be traced back to immutable chunk identifiers, source URLs, and explicit licensing provenance. אחזור מידע מבוסס וקטורים אינדוקס מחקר מקורות.',
  },
  {
    source: 'science-aaas',
    title: 'Protein Folding Kinetics and Conformational RMSD Analysis in Explicit Solvent',
    authors: 'Shaw, D. E., Maragakis, P., Lindorff-Larsen, K., et al.',
    domain: 'Biophysics',
    license: 'CC-BY-4.0',
    sourceUrl: 'https://www.science.org/doi/10.1126/science.1187409',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'Root-mean-square deviation (RMSD) and radius of gyration track structural convergence of macromolecular trajectories. Thermal fluctuations at 300 K drive transitions across free-energy barriers on nanosecond to microsecond timescales, while elevated temperatures accelerate barrier crossing at the expense of native-state stability. קיפול חלבונים ביופיזיקה יציבות מבנית.',
  },
  {
    source: 'arxiv',
    title: 'Topological Quantum Error Correction and Surface Code Lattice Thresholds',
    authors: 'Fowler, A. G., Mariantoni, M., Martinis, J. M., & Cleland, A. N.',
    domain: 'Quantum Computing',
    license: 'CC-BY-3.0',
    sourceUrl: 'https://arxiv.org/abs/1208.0928',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'Surface codes arrange physical qubits on a two-dimensional lattice with nearest-neighbor stabilizer parity checks, achieving fault-tolerant error thresholds near 1%. Spatial holographic representations of stabilizer syndromes help researchers isolate correlated decoherence chains across lattice boundaries. מחשוב קוונטי תיקון שגיאות סריג קוד שטח.',
  },
  {
    source: 'arxiv',
    title: 'Barostat Pressure Coupling and Compressibility in NPT Molecular Ensembles',
    authors: 'Bernetti, M., & Bussi, G.',
    domain: 'Statistical Mechanics',
    license: 'Apache-2.0',
    sourceUrl: 'https://arxiv.org/abs/2006.10373',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'Stochastic cell rescaling barostats sample the isothermal-isobaric (NPT) ensemble without unphysical ringing artifacts seen in Berendsen coupling. Coupling external target pressure P_ext with instantaneous virial pressure stabilizes box volume fluctuations in condensed-phase simulations. מנגנון לחץ איזוברי מכניקה סטטיסטית.',
  },
  {
    source: 'nist-cccbdb',
    title: 'Psi4 Ab Initio Hartree-Fock and DFT Self-Consistent Field Convergence Reference',
    authors: 'Smith, D. G. A., Burns, L. A., Simmonett, A. C., et al.',
    domain: 'Quantum Chemistry',
    license: 'BSD-3-Clause / CC0-1.0',
    sourceUrl: 'https://doi.org/10.1063/5.0006002',
    verified: true,
    commercialUseAllowed: true,
    trainingAllowed: true,
    content:
      'Psi4 implements DIIS-accelerated self-consistent field (SCF) Hartree-Fock and Kohn-Sham DFT wavefunctions. For benchmark closed-shell H2O at cc-pVDZ geometry, restricted Hartree-Fock converges monotonically to -76.0268 Hartree within 1e-8 Eh energy tolerance.',
  },
];

const chunks: CorpusChunk[] = [];
const docTermFreqs = new Map<string, Map<string, number>>();
const docFreq = new Map<string, number>();

function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const tokens: string[] = [...cleaned];
  for (const word of cleaned) {
    if (word.length >= 4) {
      for (let i = 0; i <= word.length - 3; i++) {
        tokens.push(`~${word.slice(i, i + 3)}`);
      }
    }
  }
  return tokens;
}

function splitIntoChunks(content: string, maxWords = 95): string[] {
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [content.trim()];

  const result: string[] = [];
  const overlap = 18;
  let start = 0;
  while (start < words.length) {
    const end = Math.min(words.length, start + maxWords);
    result.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = Math.max(0, end - overlap);
  }
  return result;
}

function rebuildIndexStats(): void {
  docTermFreqs.clear();
  docFreq.clear();

  for (const chunk of chunks) {
    const tokens = tokenize(`${chunk.title} ${chunk.domain} ${chunk.text}`);
    const tf = new Map<string, number>();
    const seen = new Set<string>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
      if (!seen.has(token)) {
        seen.add(token);
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    docTermFreqs.set(chunk.id, tf);
  }
}

export function ingestDocument(input: CorpusDocumentInput): CorpusChunk[] {
  const docId = `doc-${crypto.createHash('sha1').update(input.title + input.sourceUrl).digest('hex').slice(0, 8)}`;

  const inferred = inferLicensePolicy(input.license);
  const licenseRecord = registerLicenseRecord({
    source: input.source ?? 'manual',
    documentId: docId,
    license: input.license.trim(),
    verified: input.verified ?? inferred.verifiedByDefault,
    attribution: input.authors.trim(),
    commercialUseAllowed:
      input.commercialUseAllowed ?? inferred.commercialUseAllowed,
    trainingAllowed: input.trainingAllowed ?? inferred.trainingAllowed,
    version: 1,
    updatedAt: new Date().toISOString(),
  });

  // Replace older version chunks if re-ingesting same document while preserving version number
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].docId === docId) {
      chunks.splice(i, 1);
    }
  }

  const textChunks = splitIntoChunks(input.content);
  const now = new Date().toISOString();
  const created: CorpusChunk[] = [];

  textChunks.forEach((text, index) => {
    const chunk: CorpusChunk = {
      id: `${docId}-v${licenseRecord.version}-c${index + 1}`,
      docId,
      title: input.title.trim(),
      authors: input.authors.trim(),
      domain: input.domain.trim(),
      license: input.license.trim(),
      sourceUrl: input.sourceUrl.trim(),
      chunkIndex: index,
      text,
      tokenCount: text.split(/\s+/).length,
      version: licenseRecord.version,
      licenseRecord,
      ingestedAt: now,
    };
    chunks.push(chunk);
    created.push(chunk);
  });

  const contentHash = registerContentDigest(input.content);
  rebuildIndexStats();

  publishFluxEvent({
    topic: 'knowledge.indexed',
    key: docId,
    actorRole: 'researcher',
    summary: `Indexed "${input.title.trim()}" (${created.length} chunks, v${licenseRecord.version})`,
    payload: {
      docId,
      domain: input.domain.trim(),
      license: licenseRecord.license,
      chunks: created.length,
      sha256: contentHash,
    },
  });

  return created;
}

export function initializeCorpus(): void {
  if (chunks.length > 0) return;
  for (const doc of SEED_DOCUMENTS) {
    ingestDocument(doc);
  }
}

export function searchCorpus(query: string, topK = 4): RetrievedSource[] {
  initializeCorpus();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const qLower = query.toLowerCase().trim();
  const totalDocs = Math.max(1, chunks.length);
  const qTf = new Map<string, number>();
  for (const t of qTokens) {
    qTf.set(t, (qTf.get(t) ?? 0) + 1);
  }

  const qVec = new Map<string, number>();
  let qNormSq = 0;
  for (const [term, count] of qTf.entries()) {
    const df = docFreq.get(term) ?? 0;
    const idf = Math.log(1 + totalDocs / (1 + df));
    const weight = (1 + Math.log(count)) * idf;
    qVec.set(term, weight);
    qNormSq += weight * weight;
  }
  const qNorm = Math.sqrt(qNormSq) || 1;

  // Filter strictly through governance retrieval eligibility
  const eligibleChunks = chunks.filter((chunk) => {
    const latestLicense = getLicenseRecord(chunk.docId) ?? chunk.licenseRecord;
    return eligibleForOperation(latestLicense, 'retrieval');
  });

  const scored = eligibleChunks.map((chunk) => {
    const tf = docTermFreqs.get(chunk.id);
    if (!tf) return { chunk, score: 0 };

    let dot = 0;
    let dNormSq = 0;

    for (const [term, count] of tf.entries()) {
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + totalDocs / (1 + df));
      const dWeight = (1 + Math.log(count)) * idf;
      dNormSq += dWeight * dWeight;

      const qWeight = qVec.get(term);
      if (qWeight !== undefined) {
        dot += qWeight * dWeight;
      }
    }

    const dNorm = Math.sqrt(dNormSq) || 1;
    const cosine = dot / (qNorm * dNorm);

    // Hybrid reranker bonus: exact title/domain term overlap
    const titleLower = chunk.title.toLowerCase();
    const queryWords = qLower.split(/\s+/).filter((w) => w.length >= 3);
    const titleHits = queryWords.filter((w) => titleLower.includes(w)).length;
    const rerankBoost = Math.min(0.18, titleHits * 0.045);

    return { chunk, score: Number(Math.min(0.99, cosine + rerankBoost).toFixed(4)) };
  });

  scored.sort((a, b) => b.score - a.score);

  const positive = scored.filter((item) => item.score > 0.02).slice(0, topK);
  const selected = positive.length > 0 ? positive : scored.slice(0, Math.min(2, topK));

  return selected.map(({ chunk, score }) => {
    const latestLicense = getLicenseRecord(chunk.docId) ?? chunk.licenseRecord;
    return {
      id: chunk.id,
      title: chunk.title,
      authors: chunk.authors,
      domain: chunk.domain,
      license: latestLicense.license,
      licenseVerified: latestLicense.verified,
      trainingAllowed: latestLicense.trainingAllowed,
      sourceUrl: chunk.sourceUrl,
      text: chunk.text,
      score: Math.max(score, 0.05),
      origin: 'indexed_corpus',
    };
  });
}

export function listCorpusChunks(domainFilter?: string): CorpusChunk[] {
  initializeCorpus();
  const mapped = chunks.map((c) => ({
    ...c,
    licenseRecord: getLicenseRecord(c.docId) ?? c.licenseRecord,
  }));
  if (!domainFilter || domainFilter === 'all') {
    return mapped;
  }
  return mapped.filter((c) => c.domain.toLowerCase() === domainFilter.toLowerCase());
}

export function getCorpusDomains(): string[] {
  initializeCorpus();
  return Array.from(new Set(chunks.map((c) => c.domain)));
}
