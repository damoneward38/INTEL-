import crypto from 'node:crypto';
import type {
  CommandIntent,
  ExtractedEntity,
  KnowledgeGraphEdge,
  UploadedArtifactRecord,
} from './types.ts';

export function classifyCommandIntent(commandText: string): {
  intent: CommandIntent;
  allowsSimulation: boolean;
  requiresHumanReview: boolean;
  rationale: string;
} {
  const lower = commandText.toLowerCase();

  if (
    /execute on physical|send to robot|dispense|synthesize in lab|clinical dosing|patient treatment|override safety|deploy production/i.test(
      lower
    )
  ) {
    return {
      intent: 'human_authorization_required',
      allowsSimulation: false,
      requiresHumanReview: true,
      rationale:
        'Detected physical/clinical execution directive; paused simulation execution pending qualified human authorization.',
    };
  }

  if (
    /investigate|failure|troubleshoot|root cause|diagnose|why did .* fail|fix/i.test(lower)
  ) {
    return {
      intent: 'troubleshooting',
      allowsSimulation: true,
      requiresHumanReview: /clinical|pharma|patient|drug|biologic/i.test(lower),
      rationale:
        'Classified as troubleshooting & failure-isolation workflow with corrective candidate simulation.',
    };
  }

  if (
    /optimi[sz]e|best-performing|best configuration|refine|maximize|minimize|sweep|tune/i.test(
      lower
    )
  ) {
    return {
      intent: 'optimization',
      allowsSimulation: true,
      requiresHumanReview: /clinical|pharma|patient|drug|biologic/i.test(lower),
      rationale:
        'Classified as bounded parameter optimization workflow across adaptive simulation batches.',
    };
  }

  if (
    /formulat|safer|more stable candidate|stabiliz|excipient|solvent|polymer|alloy|blend/i.test(
      lower
    )
  ) {
    return {
      intent: 'formulation',
      allowsSimulation: true,
      requiresHumanReview: /clinical|pharma|patient|drug|biologic|medicine|therapy/i.test(lower),
      rationale:
        'Classified as formulation discovery & stability screening pipeline.',
    };
  }

  if (
    /simulat|langevin|verlet|psi4|scf|monte carlo|virtual experiment|run model/i.test(
      lower
    )
  ) {
    return {
      intent: 'virtual_simulation',
      allowsSimulation: true,
      requiresHumanReview: /clinical|pharma|patient|drug|biologic/i.test(lower),
      rationale:
        'Classified as direct virtual simulation workflow.',
    };
  }

  if (
    /compare|matrix|matrices|dataset|csv|tsv|variance|difference|correlat|analyze data/i.test(
      lower
    )
  ) {
    return {
      intent: 'data_analysis',
      allowsSimulation: true,
      requiresHumanReview: false,
      rationale:
        'Classified as structured dataset & parameter-matrix comparative analysis.',
    };
  }

  return {
    intent: 'information',
    allowsSimulation: false,
    requiresHumanReview: false,
    rationale:
      'Classified as informational inquiry. Knowledge retrieval & synthesis only; no simulation or experiment executed without explicit request.',
  };
}

export function detectDomain(commandText: string, artifactText = ''): {
  domain: string;
  highRiskDomain: boolean;
} {
  const combined = `${commandText}\n${artifactText}`.toLowerCase();
  if (/clinical|pharma|drug|medicine|patient|therapeutic|toxicity|dosage/i.test(combined)) {
    return { domain: 'Biomedical Research', highRiskDomain: true };
  }
  if (/pgx|cyp2c19|tpmt|genom|dna|rna|allele|sequence|blast/i.test(combined)) {
    return { domain: 'Bioinformatics & Genomics', highRiskDomain: true };
  }
  if (/quantum|hartree|scf|psi4|orbital|dft|dipole/i.test(combined)) {
    return { domain: 'Quantum Chemistry', highRiskDomain: false };
  }
  if (/battery|reactor|thermal|catalyst|process|yield|alloy|pressure vessel/i.test(combined)) {
    return { domain: 'Chemical Process Engineering', highRiskDomain: true };
  }
  if (/formulat|colloid|emulsion|polymer|excipient|viscosity/i.test(combined)) {
    return { domain: 'Formulation & Stability', highRiskDomain: false };
  }
  return { domain: 'Molecular Dynamics', highRiskDomain: false };
}

export function detectLanguage(text: string): 'en' | 'he' | 'mixed' {
  const hasHe = /[\u0590-\u05FF]/.test(text);
  const hasEn = /[A-Za-z]/.test(text);
  if (hasHe && hasEn) return 'mixed';
  if (hasHe) return 'he';
  return 'en';
}

export function parseStructuredInputText(
  rawText: string,
  filename = 'inline-input.txt'
): {
  detectedFormat: string;
  parsedMatrix: Array<Record<string, number | string>>;
} {
  const trimmed = rawText.trim();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const rows = parsed.filter(
          (r): r is Record<string, number | string> => Boolean(r && typeof r === 'object')
        );
        return { detectedFormat: 'json-matrix', parsedMatrix: rows };
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.matrix)) {
          return {
            detectedFormat: 'json-matrix',
            parsedMatrix: obj.matrix.filter(
              (r): r is Record<string, number | string> => Boolean(r && typeof r === 'object')
            ),
          };
        }
        return {
          detectedFormat: 'json-matrix',
          parsedMatrix: [obj as Record<string, number | string>],
        };
      }
    } catch {
      // Fall through to delimiter detection
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length >= 2 && (lines[0].includes(',') || lines[0].includes('\t'))) {
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(sep).map((h) => h.trim());
    const rows: Array<Record<string, number | string>> = [];
    for (let i = 1; i < Math.min(lines.length, 60); i += 1) {
      const cols = lines[i].split(sep).map((c) => c.trim());
      if (cols.length < 2) continue;
      const row: Record<string, number | string> = {};
      headers.forEach((h, idx) => {
        const val = cols[idx] ?? '';
        const num = Number(val);
        row[h] = val !== '' && Number.isFinite(num) ? num : val;
      });
      rows.push(row);
    }
    if (rows.length > 0) {
      return {
        detectedFormat: sep === '\t' ? 'tsv' : 'csv',
        parsedMatrix: rows,
      };
    }
  }

  return {
    detectedFormat: ext || 'text',
    parsedMatrix: [],
  };
}

export function buildUploadedArtifact(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): UploadedArtifactRecord {
  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const rawText = input.buffer.toString('utf8').replace(/\0/g, ' ').trim();
  const { detectedFormat, parsedMatrix } = parseStructuredInputText(rawText, input.filename);

  return {
    uploadId: `upl-${crypto.randomUUID().slice(0, 8)}`,
    filename: input.filename,
    mimeType: input.mimeType || 'text/plain',
    sizeBytes: input.buffer.length,
    detectedFormat,
    detectedLanguage: detectLanguage(rawText),
    extractedText: rawText.slice(0, 24000),
    parsedRowsCount: parsedMatrix.length,
    parsedMatrix: parsedMatrix.slice(0, 40),
    sha256,
    createdAt: new Date().toISOString(),
  };
}

export function extractEntitiesAndGraph(
  commandText: string,
  domain: string,
  matrix: Array<Record<string, number | string>>,
  artifactText = ''
): {
  entities: ExtractedEntity[];
  edges: KnowledgeGraphEdge[];
} {
  const combined = `${commandText}\n${artifactText}`;
  const entities: ExtractedEntity[] = [
    {
      id: 'ent-domain',
      label: domain,
      category: 'domain',
      value: domain,
      confidence: 0.96,
    },
  ];

  const paramMatches = combined.matchAll(
    /\b(temperature|temp|pressure|pH|ionicStrength|stabilizerPct|solventDielectric|stringency|residenceTime)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/gi
  );
  let idx = 0;
  for (const m of paramMatches) {
    idx += 1;
    entities.push({
      id: `ent-param-${idx}`,
      label: `${m[1]} = ${m[2]}`,
      category: 'parameter',
      value: m[2],
      confidence: 0.91,
    });
    if (idx >= 8) break;
  }

  const compoundMatches = combined.matchAll(
    /\b(Trehalose|Histidine|Polysorbate[-\s]?\d+|Sodium Citrate|Lipid nanoparticle|PEG-\d+|DMSO|Acetonitrile|Lennard-Jones|Water|CYP2C19\*2|TPMT\*3A)\b/gi
  );
  const seen = new Set<string>();
  for (const m of compoundMatches) {
    const clean = m[1];
    if (seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    entities.push({
      id: `ent-comp-${seen.size}`,
      label: clean,
      category: 'compound',
      value: clean,
      confidence: 0.89,
    });
  }

  if (matrix.length > 0) {
    const keys = Object.keys(matrix[0]).slice(0, 6);
    keys.forEach((k, kIdx) => {
      entities.push({
        id: `ent-col-${kIdx + 1}`,
        label: `Matrix Column: ${k}`,
        category: 'parameter',
        value: String(matrix[0][k]),
        confidence: 0.94,
      });
    });
  }

  if (/toxic|unstable|drift|fail|overflow|runaway|hazard/i.test(combined)) {
    entities.push({
      id: 'ent-hazard-1',
      label: 'Stability / Safety Failure Risk',
      category: 'hazard',
      value: 'Constraint Gate Active',
      confidence: 0.93,
    });
  }

  const edges: KnowledgeGraphEdge[] = [];
  for (let i = 1; i < entities.length; i += 1) {
    edges.push({
      from: 'ent-domain',
      to: entities[i].id,
      relation:
        entities[i].category === 'parameter'
          ? 'GOVERNED_PARAMETER'
          : entities[i].category === 'hazard'
            ? 'RISK_CONSTRAINT'
            : 'COMPONENT_OF',
      weight: Number(entities[i].confidence.toFixed(2)),
    });
  }
  if (entities.length >= 3) {
    edges.push({
      from: entities[1].id,
      to: entities[2].id,
      relation: 'COUPLED_INTERACTION',
      weight: 0.82,
    });
  }

  return { entities, edges };
}
