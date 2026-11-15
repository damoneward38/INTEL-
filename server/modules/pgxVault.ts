import crypto from 'node:crypto';
import type {
  AuthSession,
  PgxEvidenceMatch,
  PgxSampleSummary,
} from '../types.ts';
import { logger } from '../logger.ts';
import { computeSha256, recordProvenance } from '../provenance.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';

interface EncryptedPgxRecord {
  summary: PgxSampleSummary;
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
}

interface CpicRule {
  pattern: RegExp;
  gene: string;
  alleleOrVariant: string;
  phenotype: string;
  affectedDrugs: string[];
  evidenceLevel: '1A' | '1B' | '2A';
  citation: string;
  sourceUrl: string;
  uncertaintyNote: string;
}

const CPIC_KNOWLEDGE_BASE: CpicRule[] = [
  {
    pattern: /CYP2C19\*2|rs4244285|10:94781859/i,
    gene: 'CYP2C19',
    alleleOrVariant: 'CYP2C19*2 (rs4244285)',
    phenotype: 'Reduced CYP2C19 enzymatic activation (No-function allele)',
    affectedDrugs: ['Clopidogrel', 'Voriconazole', 'Escitalopram'],
    evidenceLevel: '1A',
    citation: 'CPIC Guideline for CYP2C19 and Clopidogrel Therapy (Lee et al., Clin Pharmacol Ther 2022)',
    sourceUrl: 'https://cpicpgx.org/guidelines/guideline-for-clopidogrel-and-cyp2c19/',
    uncertaintyNote:
      'Phenotype assignment depends on diplotype phase (*1/*2 vs *2/*2) and concomitant CYP inhibitors. Informational research evidence only — consult a licensed clinician.',
  },
  {
    pattern: /CYP2D6\*4|rs3892097|22:42128945/i,
    gene: 'CYP2D6',
    alleleOrVariant: 'CYP2D6*4 (rs3892097)',
    phenotype: 'Non-functional CYP2D6 splice defect variant',
    affectedDrugs: ['Codeine', 'Tamoxifen', 'Ondansetron'],
    evidenceLevel: '1A',
    citation: 'CPIC Guideline for CYP2D6 and Opioids (Crews et al., Clin Pharmacol Ther 2021)',
    sourceUrl: 'https://cpicpgx.org/guidelines/cpic-guideline-for-codeine-and-cyp2d6/',
    uncertaintyNote:
      'CYP2D6 gene copy number variations (*4xN or *5 deletion) cannot be resolved from single SNV lines alone; targeted CNV validation required.',
  },
  {
    pattern: /TPMT\*3A|rs1800460|rs1142345/i,
    gene: 'TPMT',
    alleleOrVariant: 'TPMT*3A (rs1800460 / rs1142345)',
    phenotype: 'Deficient thiopurine S-methyltransferase activity',
    affectedDrugs: ['Azathioprine', 'Mercaptopurine', 'Thioguanine'],
    evidenceLevel: '1A',
    citation: 'CPIC Guideline for Thiopurine Dosing Based on TPMT and NUDT15 (Relling et al., 2019)',
    sourceUrl: 'https://cpicpgx.org/guidelines/guideline-for-thiopurines-and-tpmt/',
    uncertaintyNote:
      'Cis/trans haplotype phasing and co-inherited NUDT15 variants modulate clinical risk. Never use for autonomous dosing.',
  },
  {
    pattern: /SLCO1B1\*5|rs4149056|12:21178615/i,
    gene: 'SLCO1B1',
    alleleOrVariant: 'SLCO1B1*5 (rs4149056)',
    phenotype: 'Decreased hepatic OATP1B1 statin transporter uptake',
    affectedDrugs: ['Simvastatin', 'Atorvastatin', 'Rosuvastatin'],
    evidenceLevel: '1A',
    citation: 'CPIC Guideline for Statins and SLCO1B1, ABCG2, and CYP2C9 (Cooper-DeHoff et al., 2022)',
    sourceUrl: 'https://cpicpgx.org/guidelines/cpic-guideline-for-statins/',
    uncertaintyNote:
      'Myopathy risk varies by statin lipophilicity, renal status, and age.',
  },
  {
    pattern: /VKORC1|rs9923231|-1639G>A/i,
    gene: 'VKORC1',
    alleleOrVariant: 'VKORC1 -1639G>A (rs9923231)',
    phenotype: 'Increased vitamin K epoxide reductase sensitivity',
    affectedDrugs: ['Warfarin'],
    evidenceLevel: '1A',
    citation: 'CPIC Guideline for Pharmacogenetics-Guided Warfarin Dosing (Johnson et al., 2017)',
    sourceUrl: 'https://cpicpgx.org/guidelines/guideline-for-warfarin-and-cyp2c9-and-vkorc1/',
    uncertaintyNote:
      'Warfarin sensitivity also depends strongly on CYP2C9 alleles, CYP4F2, dietary vitamin K, and clinical INR monitoring.',
  },
  {
    pattern: /DPYD\*2A|rs3918290|c\.1905\+1G>A/i,
    gene: 'DPYD',
    alleleOrVariant: 'DPYD*2A (rs3918290)',
    phenotype: 'Complete loss of function of dihydropyrimidine dehydrogenase allele',
    affectedDrugs: ['Fluorouracil (5-FU)', 'Capecitabine'],
    evidenceLevel: '1A',
    citation: 'CPIC Guideline for Fluoropyrimidines and DPYD (Amstutz et al., Clin Pharmacol Ther 2018)',
    sourceUrl: 'https://cpicpgx.org/guidelines/guideline-for-fluoropyrimidines-and-dpyd/',
    uncertaintyNote:
      'Additional DPYD variants (c.2846A>T, HapB3) should be screened in formal oncology panels.',
  },
];

// Dedicated 256-bit vault encryption key derived at runtime from env or CSPRNG
const VAULT_MASTER_KEY = process.env.PGX_VAULT_SECRET
  ? crypto.createHash('sha256').update(process.env.PGX_VAULT_SECRET).digest()
  : crypto.randomBytes(32);

const vaultStore = new Map<string, EncryptedPgxRecord>();

function detectFormat(raw: string): PgxSampleSummary['format'] {
  if (/^##fileformat=VCF|#CHROM\tPOS/m.test(raw)) return 'vcf';
  if (/^>/m.test(raw)) return 'fasta-header';
  return 'star-allele';
}

export function matchPgxEvidence(rawText: string): PgxEvidenceMatch[] {
  const matches: PgxEvidenceMatch[] = [];
  for (const rule of CPIC_KNOWLEDGE_BASE) {
    if (rule.pattern.test(rawText)) {
      matches.push({
        gene: rule.gene,
        alleleOrVariant: rule.alleleOrVariant,
        phenotype: rule.phenotype,
        affectedDrugs: rule.affectedDrugs,
        evidenceLevel: rule.evidenceLevel,
        citation: rule.citation,
        sourceUrl: rule.sourceUrl,
        uncertaintyNote: rule.uncertaintyNote,
      });
    }
  }
  return matches;
}

export function storeEncryptedPgxSample(
  input: {
    sampleAlias: string;
    genomicPayload: string;
    consentGranted: boolean;
    consentScope: string;
  },
  session: AuthSession
): { summary: PgxSampleSummary; evidenceMatchesCount: number } {
  if (!input.consentGranted) {
    throw new Error('Explicit participant consent (consentGranted=true) is required before encrypting genomic data.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_MASTER_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(input.genomicPayload, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const matches = matchPgxEvidence(input.genomicPayload);
  const variantLines = input.genomicPayload
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#')).length;

  const sampleId = `pgx-${crypto.randomUUID().slice(0, 8)}`;
  const summary: PgxSampleSummary = {
    sampleId,
    sampleAlias: input.sampleAlias.trim(),
    format: detectFormat(input.genomicPayload),
    consentGranted: true,
    consentScope: input.consentScope.trim() || 'Research Evidence Annotation Only',
    uploadedBy: session.userId,
    variantCount: Math.max(variantLines, matches.length),
    cipherAlgorithm: 'aes-256-gcm',
    digestSha256: computeSha256(input.genomicPayload),
    createdAt: new Date().toISOString(),
  };

  vaultStore.set(sampleId, {
    summary,
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: encrypted.toString('hex'),
  });

  recordProvenance({
    kind: 'vault_access' as never,
    actorId: session.userId,
    actorRole: session.role,
    action: 'pgx:encrypt_store',
    rawInput: summary.digestSha256, // Never log raw genomic payload
    modelOrEngine: 'aes-256-gcm-cpic-annotator',
    licenses: ['Participant Consent + CPIC Open Evidence'],
    sourceUrls: matches.map((m) => m.sourceUrl),
    metadata: {
      sampleId,
      consentGranted: true,
      matchesFound: matches.length,
    },
  });

  publishFluxEvent({
    topic: 'vault.access',
    key: sampleId,
    actorRole: session.role,
    summary: `Encrypted PGx sample ${summary.sampleAlias} stored (AES-256-GCM)`,
    payload: {
      sampleId,
      format: summary.format,
      matchesFound: matches.length,
    },
  });

  logger.info('pgx-vault', 'Stored AES-256-GCM encrypted genomic sample', {
    sampleId,
    format: summary.format,
    actorRole: session.role,
  });

  return { summary, evidenceMatchesCount: matches.length };
}

export function listPgxSamples(): PgxSampleSummary[] {
  return Array.from(vaultStore.values())
    .map((entry) => entry.summary)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function analyzePgxSample(
  sampleId: string,
  session: AuthSession
): {
  summary: PgxSampleSummary;
  evidence: PgxEvidenceMatch[];
  clinicalPolicyNotice: string;
} {
  const entry = vaultStore.get(sampleId);
  if (!entry) {
    throw new Error('Encrypted genomic sample not found.');
  }
  if (!entry.summary.consentGranted) {
    throw new Error('Participant consent revoked; decryption blocked.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    VAULT_MASTER_KEY,
    Buffer.from(entry.ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(entry.authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');

  const evidence = matchPgxEvidence(plaintext);

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: 'pgx:cpic_evidence_query',
    rawInput: sampleId,
    modelOrEngine: 'cpic-evidence-mapper',
    licenses: ['CPIC Guidelines (CC-BY)'],
    sourceUrls: evidence.map((e) => e.sourceUrl),
    metadata: {
      sampleId,
      evidenceCount: evidence.length,
      autonomousPrescribingBlocked: true,
    },
  });

  return {
    summary: entry.summary,
    evidence,
    clinicalPolicyNotice:
      'INFORMATIONAL RESEARCH EVIDENCE ONLY: INTEL prohibits autonomous prescribing, automated medication orders, or clinical dosing recommendations without licensed clinician & laboratory confirmation.',
  };
}

export function revokePgxConsent(sampleId: string, session: AuthSession): PgxSampleSummary | null {
  const entry = vaultStore.get(sampleId);
  if (!entry) return null;
  entry.summary = {
    ...entry.summary,
    consentGranted: false,
    consentScope: 'REVOKED BY CUSTODIAN',
  };
  publishFluxEvent({
    topic: 'vault.access',
    key: sampleId,
    actorRole: session.role,
    summary: `Participant consent revoked for PGx sample ${entry.summary.sampleAlias}`,
    payload: { sampleId },
  });
  return entry.summary;
}
