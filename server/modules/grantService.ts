import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { searchCorpus } from '../corpusIndex.ts';
import { logger } from '../logger.ts';
import { recordProvenance } from '../provenance.ts';
import { listSimulationJobs } from '../simulationEngine.ts';
import type { AuthSession, GrantDraft } from '../types.ts';

const grantStore: GrantDraft[] = [];

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateGrantDraft(
  input: {
    topic: string;
    template: GrantDraft['template'];
    budgetCapUsd: number;
    durationMonths: number;
    language: 'en' | 'he';
  },
  session: AuthSession
): Promise<GrantDraft> {
  const sources = searchCorpus(input.topic, 5);
  const completedSims = listSimulationJobs().filter((j) => j.state === 'completed');
  const simSummaryText =
    completedSims.length > 0
      ? completedSims
          .slice(0, 2)
          .map(
            (s) =>
              `${s.engine} (${s.parameters.steps} steps, meanTemp=${s.summary?.meanTempK}K, benchmarkPassed=${s.referenceValidation?.passed})`
          )
          .join('; ')
      : 'Preliminary worker validation pending.';

  const citationsBlock = sources
    .map((s, idx) => `[C${idx + 1}] ${s.title} (${s.license}) - ${s.sourceUrl}: ${s.text}`)
    .join('\n');

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Generate a structured ${input.template} grant proposal draft (language=${input.language}) for topic: "${input.topic}".\nTotal Budget Cap: $${input.budgetCapUsd} USD over ${input.durationMonths} months.\nSimulation Preliminary Benchmarks: ${simSummaryText}\n\nVerified Sources:\n${citationsBlock}`,
    config: {
      systemInstruction:
        'You are a scientific grant proposal architect. Produce rigorous, realistic budget line items summing near the budget cap, quarterly milestones, figure placeholders grounded in supplied data, and cite supplied sources honestly without fabricating experimental results.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          abstract: { type: Type.STRING },
          specificAims: { type: Type.ARRAY, items: { type: Type.STRING } },
          methodology: { type: Type.STRING },
          budgetItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                justification: { type: Type.STRING },
                amountUsd: { type: Type.NUMBER },
              },
              required: ['category', 'justification', 'amountUsd'],
            },
          },
          milestones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                quarter: { type: Type.STRING },
                deliverable: { type: Type.STRING },
                verificationMetric: { type: Type.STRING },
              },
              required: ['quarter', 'deliverable', 'verificationMetric'],
            },
          },
          figurePlaceholders: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                figureNumber: { type: Type.STRING },
                caption: { type: Type.STRING },
                linkedSource: { type: Type.STRING },
              },
              required: ['figureNumber', 'caption', 'linkedSource'],
            },
          },
        },
        required: [
          'title',
          'abstract',
          'specificAims',
          'methodology',
          'budgetItems',
          'milestones',
          'figurePlaceholders',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
    GrantDraft,
    'id' | 'template' | 'verifiedSources' | 'createdAt'
  >;

  const draft: GrantDraft = {
    id: `grant-${crypto.randomUUID().slice(0, 8)}`,
    template: input.template,
    title: parsed.title || input.topic,
    abstract: parsed.abstract || '',
    specificAims: parsed.specificAims ?? [],
    methodology: parsed.methodology || '',
    budgetItems: parsed.budgetItems ?? [],
    milestones: parsed.milestones ?? [],
    figurePlaceholders: parsed.figurePlaceholders ?? [],
    verifiedSources: sources.map((s) => ({
      title: s.title,
      license: s.license,
      sourceUrl: s.sourceUrl,
      verified: s.licenseVerified ?? true,
    })),
    createdAt: new Date().toISOString(),
  };

  grantStore.unshift(draft);
  if (grantStore.length > 25) grantStore.length = 25;

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: `grant:draft:${input.template}`,
    rawInput: input.topic,
    modelOrEngine: 'gemini-4-hydrogen',
    licenses: sources.map((s) => s.license),
    sourceUrls: sources.map((s) => s.sourceUrl),
    metadata: {
      grantId: draft.id,
      budgetCapUsd: input.budgetCapUsd,
    },
  });

  logger.info('grant-draft', 'Generated structured grant proposal', {
    grantId: draft.id,
    template: input.template,
  });

  return draft;
}

export function listGrantDrafts(): GrantDraft[] {
  return grantStore;
}
