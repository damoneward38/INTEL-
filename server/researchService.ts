import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { searchCorpus } from './corpusIndex.ts';
import { logger } from './logger.ts';
import { recordProvenance } from './provenance.ts';
import type {
  AuthSession,
  ResearchChatRequestPayload,
  ResearchChatResponsePayload,
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

  let groundingFallbackNote = '';

  try {
    const ai = getGeminiClient();
    let response;
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel },
          tools: [{ googleSearch: {} }],
        },
      });
    } catch (groundingErr) {
      const gMsg = groundingErr instanceof Error ? groundingErr.message : String(groundingErr);
      if (
        gMsg.includes('429') ||
        gMsg.includes('RESOURCE_EXHAUSTED') ||
        gMsg.includes('403') ||
        gMsg.includes('PERMISSION_DENIED')
      ) {
        logger.warn('research', 'Google Search grounding unavailable; falling back to indexed corpus synthesis', {
          reason: gMsg.slice(0, 200),
        });
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel },
          },
        });
        groundingFallbackNote = isHebrew
          ? '\n\n[הערת מערכת: חיפוש האינטרנט החיצוני הגיע למגבלת מכסה ולכן הסינתזה התבססה על מאגר המסמכים המאומת.]'
          : '\n\n[System Note: External Google Search grounding reached quota/access limits; synthesis is grounded exclusively in verified indexed corpus chunks above.]';
      } else {
        throw groundingErr;
      }
    }

    answerText = `${(response.text ?? '').trim()}${groundingFallbackNote}`;

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

export async function runResearchChat(
  payload: ResearchChatRequestPayload,
  session: AuthSession
): Promise<ResearchChatResponsePayload> {
  const startedAt = Date.now();
  const corpusSources = searchCorpus(payload.message, 4);
  const isHebrew =
    payload.language === 'he' || /[\u0590-\u05FF]/.test(payload.message);

  const corpusContext = corpusSources
    .map(
      (src, idx) =>
        `[C${idx + 1}] ${src.title} (${src.license}): ${src.text.slice(0, 320)}`
    )
    .join('\n');

  const artifactBlock = payload.artifactContext
    ? `\n\nActive Uploaded File Context ("${payload.artifactContext.filename}"):\nSummary: ${payload.artifactContext.summary ?? 'N/A'}\nExcerpt:\n${(payload.artifactContext.excerpt ?? '').slice(0, 2200)}`
    : '';

  const recentTurns = payload.history
    .slice(-8)
    .map((h) => `${h.role === 'user' ? 'Researcher' : 'INTEL AI'}: ${h.text}`)
    .join('\n');

  const personaGuide =
    payload.persona === 'protocol'
      ? 'You are INTEL Protocol Advisor. Focus on controls, sample size, statistical validation, study limitations, and reproducible methodology.'
      : payload.persona === 'simulation'
        ? 'You are INTEL Simulation & Compute Guide. Focus on OpenMM/Langevin parameters, Psi4 SCF convergence, BLAST alignments, and virtual parameter bounds.'
        : 'You are INTEL Research Synthesizer. Answer conversationally in clear spoken-friendly scientific prose with inline [C1], [C2] citations.';

  const systemInstruction = isHebrew
    ? `${personaGuide} ענה בעברית ברורה ונוחה להקראה קולית (ללא סימוני מארקדאון מסורבלים). בסוף התשובה, החזר JSON תקין בלבד במבנה {"reply":"...","suggestions":["הצעה 1","הצעה 2","הצעה 3"]}.`
    : `${personaGuide} Respond in clear, natural conversational language suitable for voice read-aloud. Return strictly valid JSON with shape {"reply":"<concise helpful answer>","suggestions":["<short follow-up suggestion 1>","<short follow-up suggestion 2>","<short follow-up suggestion 3>"]}.`;

  const contents = [
    recentTurns ? `Recent conversation:\n${recentTurns}` : '',
    `Corpus references:\n${corpusContext || 'No direct indexed hits; use general scientific principles carefully and note uncertainty.'}`,
    artifactBlock,
    `User question: ${payload.message}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const modelName = 'gemini-4-hydrogen';
  let reply = '';
  let suggestions: string[] = isHebrew
    ? [
        'סכם את הממצאים המרכזיים בקול רם',
        'מהן מגבלות המחקר ונקודות הביקורת?',
        'הצע סימולציה הבאה לבדיקת ההשערה',
      ]
    : [
        'Summarize key findings and read aloud',
        'What study controls or limitations should we check?',
        'Suggest the next virtual simulation experiment',
      ];

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as {
          reply?: string;
          suggestions?: string[];
        };
        if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
          reply = parsed.reply.trim();
        }
        if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
          suggestions = parsed.suggestions
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .slice(0, 4);
        }
      } catch {
        reply = rawText;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini chat request failed.';
    logger.error('research-chat', 'Gemini research chat error', { error: message });
    throw new Error(`Research chatbot synthesis failed: ${message}`);
  }

  const provenance = recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: `research:chat:${payload.persona}`,
    rawInput: payload.message,
    modelOrEngine: modelName,
    licenses: corpusSources.map((s) => s.license),
    sourceUrls: corpusSources.map((s) => s.sourceUrl),
    metadata: {
      persona: payload.persona,
      hasArtifactContext: Boolean(payload.artifactContext?.filename),
      durationMs: Date.now() - startedAt,
    },
  });

  return {
    provenanceId: provenance.id,
    persona: payload.persona,
    language: isHebrew ? 'he' : 'en',
    model: modelName,
    reply: reply || 'No conversational response generated.',
    suggestions,
    sources: corpusSources,
    durationMs: Date.now() - startedAt,
    createdAt: new Date().toISOString(),
  };
}
