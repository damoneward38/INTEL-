import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { searchCorpus } from '../corpusIndex.ts';
import { logger } from '../logger.ts';
import { recordProvenance } from '../provenance.ts';
import type { AuthSession, ThoughtPrototype } from '../types.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';

const prototypeStore: ThoughtPrototype[] = [];

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

export async function probeOllamaGateway(): Promise<{
  reachable: boolean;
  url: string;
  models: string[];
}> {
  const baseUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) {
      return { reachable: false, url: baseUrl, models: [] };
    }
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return {
      reachable: true,
      url: baseUrl,
      models: (json.models ?? []).map((m) => m.name),
    };
  } catch {
    return { reachable: false, url: baseUrl, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateThoughtPrototype(
  input: {
    hypothesis: string;
    language: 'en' | 'he';
    preferOllama?: boolean;
  },
  session: AuthSession
): Promise<ThoughtPrototype> {
  const sources = searchCorpus(input.hypothesis, 4);
  const citations = sources.map((s) => ({
    id: s.id,
    title: s.title,
    sourceUrl: s.sourceUrl,
    license: s.license,
  }));

  const contextText = sources
    .map((s, i) => `[C${i + 1}] ${s.title}: ${s.text}`)
    .join('\n');

  let gatewayUsed: ThoughtPrototype['gatewayUsed'] = 'gemini-4-hydrogen';
  let parsed: {
    title: string;
    independentVariables: string[];
    dependentVariables: string[];
    controlConditions: string[];
    protocolSteps: string[];
    falsificationCriteria: string;
    mermaidDiagram: string;
  } | null = null;

  if (input.preferOllama) {
    const probe = await probeOllamaGateway();
    if (!probe.reachable || probe.models.length === 0) {
      throw new Error(
        `Local Ollama gateway at ${probe.url} is offline or has no loaded models.`
      );
    }
    const ollamaModel = process.env.OLLAMA_MODEL || probe.models[0];
    const prompt = `Convert this scientific hypothesis into JSON with keys title, independentVariables (array), dependentVariables (array), controlConditions (array), protocolSteps (array), falsificationCriteria (string), mermaidDiagram (valid flowchart TD string). Hypothesis: ${input.hypothesis}\nEvidence:\n${contextText}`;
    const res = await fetch(`${probe.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, prompt, format: 'json', stream: false }),
    });
    if (!res.ok) {
      throw new Error(`Ollama inference returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as { response?: string };
    parsed = JSON.parse(data.response ?? '{}');
    gatewayUsed = 'ollama-local';
  } else {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Scientific Hypothesis (${input.language}): ${input.hypothesis}\n\nGrounded Evidence:\n${contextText}\n\nConvert this hypothesis into a rigorous experimental prototype with a valid Mermaid flowchart TD diagram (using plain ASCII node IDs like A, B, C, D and no unescaped quotes inside node labels).`,
      config: {
        systemInstruction:
          input.language === 'he'
            ? 'אתה מתכנן ניסויים מדעי בכיר. הפק פרוטוקול ניסוי מובנה בעברית יחד עם תרשים Mermaid תקין (flowchart TD).'
            : 'You are a principal experimental architect. Produce a rigorous, falsifiable experimental protocol and a clean Mermaid flowchart TD diagram.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            independentVariables: { type: Type.ARRAY, items: { type: Type.STRING } },
            dependentVariables: { type: Type.ARRAY, items: { type: Type.STRING } },
            controlConditions: { type: Type.ARRAY, items: { type: Type.STRING } },
            protocolSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            falsificationCriteria: { type: Type.STRING },
            mermaidDiagram: { type: Type.STRING },
          },
          required: [
            'title',
            'independentVariables',
            'dependentVariables',
            'controlConditions',
            'protocolSteps',
            'falsificationCriteria',
            'mermaidDiagram',
          ],
        },
      },
    });
    parsed = JSON.parse((response.text ?? '{}').trim());
  }

  const safeMermaid =
    parsed?.mermaidDiagram && /flowchart|graph/i.test(parsed.mermaidDiagram)
      ? parsed.mermaidDiagram.replace(/```mermaid\s*/gi, '').replace(/```/g, '').trim()
      : `flowchart TD\n  A[Hypothesis Framing] --> B[Baseline Control Run]\n  B --> C[Perturbation Assay]\n  C --> D{Falsification Gate}\n  D -->|Pass| E[Peer Review & Index]`;

  const proto: ThoughtPrototype = {
    id: `proto-${crypto.randomUUID().slice(0, 8)}`,
    hypothesis: input.hypothesis,
    title: parsed?.title || `Experiment: ${input.hypothesis.slice(0, 60)}`,
    gatewayUsed,
    variables: {
      independent: parsed?.independentVariables ?? [],
      dependent: parsed?.dependentVariables ?? [],
      controls: parsed?.controlConditions ?? [],
    },
    protocolSteps: parsed?.protocolSteps ?? [],
    falsificationCriteria: parsed?.falsificationCriteria ?? '',
    mermaidDiagram: safeMermaid,
    citations,
    createdAt: new Date().toISOString(),
  };

  prototypeStore.unshift(proto);
  if (prototypeStore.length > 40) prototypeStore.length = 40;

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: 'prototype:generate',
    rawInput: input.hypothesis,
    modelOrEngine: gatewayUsed,
    licenses: citations.map((c) => c.license),
    sourceUrls: citations.map((c) => c.sourceUrl),
    metadata: { prototypeId: proto.id },
  });

  publishFluxEvent({
    topic: 'knowledge.indexed',
    key: proto.id,
    actorRole: session.role,
    summary: `Generated Thought-Prototype "${proto.title}" via ${gatewayUsed}`,
    payload: { prototypeId: proto.id, steps: proto.protocolSteps.length },
  });

  logger.info('thought-prototypes', 'Generated experimental prototype', {
    prototypeId: proto.id,
    gatewayUsed,
  });

  return proto;
}

export function listThoughtPrototypes(): ThoughtPrototype[] {
  return prototypeStore;
}
