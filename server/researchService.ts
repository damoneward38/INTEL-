import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { searchCorpus } from './corpusIndex.ts';
import { logger } from './logger.ts';
import { recordProvenance } from './provenance.ts';
import type {
  AuthSession,
  ResearchDepth,
  ResearchRequestPayload,
  ResearchResponsePayload,
  RetrievedSource,
} from './types.ts';

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

function getDepthConfig(depth: ResearchDepth): { topK: number; thinkingLevel: ThinkingLevel } {
  switch (depth) {
    case 'comprehensive':
      return { topK: 6, thinkingLevel: ThinkingLevel.HIGH };
    case 'deep':
      return { topK: 4, thinkingLevel: ThinkingLevel.MEDIUM };
    case 'standard':
    default:
      return { topK: 3, thinkingLevel: ThinkingLevel.LOW };
  }
}

export async function runResearchQuery(
  payload: ResearchRequestPayload,
  session: AuthSession
): Promise<ResearchResponsePayload> {
  const startedAt = Date.now();
  const { topK, thinkingLevel } = getDepthConfig(payload.depth);
  const corpusSources = searchCorpus(payload.query, topK);

  const contextBlock = corpusSources
    .map(
      (src, idx) =>
        `[C${idx + 1}] Title: ${src.title} | Domain: ${src.domain ?? 'General'} | License: ${src.license} | URL: ${src.sourceUrl}\nExcerpt: ${src.text}`
    )
    .join('\n\n');

  const isHebrew =
    payload.language === 'he' || /[\u0590-\u05FF]/.test(payload.query);

  const systemInstruction = isHebrew
    ? `אתה חוקר מדעי בכיר במערכת INTEL. ספק ניתוח מדעי מדויק בעברית המבוסס אך ורק על הראיות שסופקו וחיפוש אינטרנט מאומת. חלק את התשובה ל: 1) ממצאים מבוססים (Established findings), 2) השערות והסתייגויות (Hypotheses & uncertainty), 3) מגבלות ודרישת סקירת מומחה (Limitations & human review note). צטט מקורות באמצעות [C1], [C2].`
    : `You are a senior scientific intelligence analyst at INTEL. Use the supplied evidence and verified web grounding for factual claims. Structure your answer clearly with: 1) Established Findings, 2) Hypotheses & Uncertainty, and 3) Limitations & Human Review Scope. Always cite indexed corpus chunks inline using [C1], [C2], etc.`;

  const prompt = `Research Query (${payload.inputMode ?? 'text'} input, depth=${payload.depth}):\n${payload.query}\n\nIndexed Research Corpus Chunks:\n${contextBlock}`;

  const modelName = 'gemini-4-hydrogen';
  let answerText = '';
  const webSources: RetrievedSource[] = [];

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel },
        tools: [{ googleSearch: {} }],
      },
    });

    answerText = (response.text ?? '').trim();

    const groundingChunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    groundingChunks.forEach((chunk, index) => {
      if (chunk.web?.uri) {
        webSources.push({
          id: `web-${index + 1}`,
          title: chunk.web.title || chunk.web.uri,
          license: 'External Web Source (Verify Original License)',
          licenseVerified: false,
          trainingAllowed: false,
          sourceUrl: chunk.web.uri,
          text: `Grounded web reference retrieved via Google Search for: "${payload.query.slice(0, 80)}"`,
          score: Number(Math.max(0.55, 0.92 - index * 0.06).toFixed(4)),
          origin: 'google_search',
        });
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Gemini API error';
    logger.error('research', 'Gemini API call failed', {
      error: message,
      queryLength: payload.query.length,
      depth: payload.depth,
    });
    throw new Error(`Research synthesis failed: ${message}`);
  }

  const allSources = [...corpusSources, ...webSources];
  const provenance = recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: `research:${payload.depth}:${payload.inputMode ?? 'text'}`,
    rawInput: payload.query,
    modelOrEngine: modelName,
    licenses: allSources.map((s) => s.license),
    sourceUrls: allSources.map((s) => s.sourceUrl),
    metadata: {
      corpusHits: corpusSources.length,
      webHits: webSources.length,
      language: isHebrew ? 'he' : 'en',
      durationMs: Date.now() - startedAt,
      reviewStatus: 'pending_human_review',
    },
  });

  logger.info('research', 'Research query completed', {
    provenanceId: provenance.id,
    corpusHits: corpusSources.length,
    webHits: webSources.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    provenanceId: provenance.id,
    query: payload.query,
    language: isHebrew ? 'he' : 'en',
    depth: payload.depth,
    model: modelName,
    answer: answerText || 'No synthesis generated for this query.',
    sources: allSources,
    corpusHits: corpusSources.length,
    webHits: webSources.length,
    durationMs: Date.now() - startedAt,
    reviewStatus: 'pending_human_review',
    createdAt: new Date().toISOString(),
  };
}
