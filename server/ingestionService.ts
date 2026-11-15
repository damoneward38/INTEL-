import { ingestDocument } from './corpusIndex.ts';
import { logger } from './logger.ts';
import { publishFluxEvent } from './modules/knowledgeFlux.ts';
import { recordProvenance } from './provenance.ts';
import type { AuthSession, CorpusChunk } from './types.ts';

export type IngestionSource = 'pubmed' | 'arxiv' | 'wikidata' | 'gutenberg';

interface IngestedSummary {
  source: IngestionSource;
  query: string;
  documentsFetched: number;
  chunksIndexed: number;
  chunks: CorpusChunk[];
  provenanceId: string;
}

function stripXmlTags(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchArxiv(query: string, limit: number): Promise<CorpusChunk[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'INTEL-Research-Platform/1.0' },
  });
  if (!res.ok) {
    throw new Error(`arXiv API responded with ${res.status}`);
  }
  const xml = await res.text();
  const entries = xml.split('<entry>').slice(1);
  const allChunks: CorpusChunk[] = [];

  for (const entry of entries) {
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
    const authorMatches = Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/g)).map(
      (m) => stripXmlTags(m[1])
    );

    const title = titleMatch ? stripXmlTags(titleMatch[1]) : 'arXiv Preprint';
    const content = summaryMatch ? stripXmlTags(summaryMatch[1]) : '';
    const sourceUrl = idMatch ? stripXmlTags(idMatch[1]) : 'https://arxiv.org';
    const authors = authorMatches.slice(0, 4).join(', ') || 'arXiv Authors';

    if (content.length >= 20) {
      const created = ingestDocument({
        source: 'arxiv',
        title,
        authors,
        domain: 'arXiv Preprints',
        license: 'arXiv.org Non-Exclusive License (Verify CC-BY)',
        sourceUrl,
        content,
        verified: true,
        commercialUseAllowed: false,
        trainingAllowed: false,
      });
      allChunks.push(...created);
    }
  }
  return allChunks;
}

async function fetchPubmed(query: string, limit: number): Promise<CorpusChunk[]> {
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`PubMed ESearch responded with ${searchRes.status}`);
  }
  const searchJson = (await searchRes.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  const ids = searchJson.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryRes = await fetch(summaryUrl);
  if (!summaryRes.ok) {
    throw new Error(`PubMed ESummary responded with ${summaryRes.status}`);
  }
  const summaryJson = (await summaryRes.json()) as {
    result?: Record<
      string,
      {
        title?: string;
        source?: string;
        pubdate?: string;
        authors?: Array<{ name: string }>;
      }
    >;
  };

  const allChunks: CorpusChunk[] = [];
  for (const pmid of ids) {
    const rec = summaryJson.result?.[pmid];
    if (!rec?.title) continue;
    const authors =
      rec.authors?.slice(0, 4).map((a) => a.name).join(', ') || 'PubMed Authors';
    const content = `${rec.title}. Published in ${rec.source ?? 'Biomedical Journal'} (${rec.pubdate ?? 'n.d.'}). Indexed via NCBI PubMed E-Utilities (PMID: ${pmid}) for query "${query}".`;
    const created = ingestDocument({
      source: 'pubmed',
      title: stripXmlTags(rec.title),
      authors,
      domain: 'PubMed / Biomedical',
      license: 'NCBI Public Metadata (Verify Full-Text PMC License)',
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      content,
      verified: true,
      commercialUseAllowed: false,
      trainingAllowed: false,
    });
    allChunks.push(...created);
  }
  return allChunks;
}

async function fetchWikidata(query: string, limit: number): Promise<CorpusChunk[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=${limit}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'INTEL-Research-Platform/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Wikidata API responded with ${res.status}`);
  }
  const data = (await res.json()) as {
    search?: Array<{
      id: string;
      label?: string;
      description?: string;
      concepturi?: string;
    }>;
  };
  const allChunks: CorpusChunk[] = [];
  for (const item of data.search ?? []) {
    const label = item.label || item.id;
    const desc = item.description || 'Structured scientific entity in Wikidata knowledge graph.';
    const created = ingestDocument({
      source: 'wikidata',
      title: `${label} (${item.id})`,
      authors: 'Wikidata Contributors',
      domain: 'Wikidata Knowledge Graph',
      license: 'CC0-1.0',
      sourceUrl: item.concepturi || `https://www.wikidata.org/wiki/${item.id}`,
      content: `${label} (${item.id}): ${desc}. Structured ontology entity retrieved from Wikidata for "${query}".`,
      verified: true,
      commercialUseAllowed: true,
      trainingAllowed: true,
    });
    allChunks.push(...created);
  }
  return allChunks;
}

async function fetchGutenberg(query: string, limit: number): Promise<CorpusChunk[]> {
  const url = `https://gutendex.com/books/?search=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'INTEL-Research-Platform/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Project Gutenberg (Gutendex) responded with ${res.status}`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      id: number;
      title: string;
      authors?: Array<{ name: string }>;
      subjects?: string[];
      summaries?: string[];
    }>;
  };
  const allChunks: CorpusChunk[] = [];
  for (const book of (data.results ?? []).slice(0, limit)) {
    const authors = book.authors?.map((a) => a.name).join(', ') || 'Public Domain Author';
    const subjects = book.subjects?.slice(0, 4).join('; ') || 'Literature & Humanities';
    const summary = book.summaries?.[0] || `Classic scientific or literary work "${book.title}" (${subjects}).`;
    const created = ingestDocument({
      source: 'gutenberg',
      title: book.title,
      authors,
      domain: 'Project Gutenberg',
      license: 'CC0-1.0',
      sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
      content: `${book.title} by ${authors}. Subjects: ${subjects}. ${summary}`,
      verified: true,
      commercialUseAllowed: true,
      trainingAllowed: true,
    });
    allChunks.push(...created);
  }
  return allChunks;
}

export async function runExternalIngestion(
  source: IngestionSource,
  query: string,
  limit: number,
  session: AuthSession
): Promise<IngestedSummary> {
  const safeLimit = Math.max(1, Math.min(10, limit));
  let chunks: CorpusChunk[] = [];

  if (source === 'arxiv') {
    chunks = await fetchArxiv(query, safeLimit);
  } else if (source === 'pubmed') {
    chunks = await fetchPubmed(query, safeLimit);
  } else if (source === 'wikidata') {
    chunks = await fetchWikidata(query, safeLimit);
  } else if (source === 'gutenberg') {
    chunks = await fetchGutenberg(query, safeLimit);
  }

  const provenance = recordProvenance({
    kind: 'corpus_ingest',
    actorId: session.userId,
    actorRole: session.role,
    action: `ingestion:${source}`,
    rawInput: `${source}:${query}`,
    modelOrEngine: `${source}-live-connector`,
    licenses: chunks.map((c) => c.license),
    sourceUrls: chunks.map((c) => c.sourceUrl),
    metadata: {
      chunksIndexed: chunks.length,
      limit: safeLimit,
    },
  });

  publishFluxEvent({
    topic: 'knowledge.ingested',
    key: source,
    actorRole: session.role,
    summary: `Ingested ${chunks.length} chunks from ${source.toUpperCase()} for "${query}"`,
    payload: {
      source,
      query,
      chunksIndexed: chunks.length,
      provenanceId: provenance.id,
    },
  });

  logger.info('ingestion', `Completed external ingestion from ${source}`, {
    query,
    chunksIndexed: chunks.length,
    provenanceId: provenance.id,
  });

  return {
    source,
    query,
    documentsFetched: new Set(chunks.map((c) => c.docId)).size,
    chunksIndexed: chunks.length,
    chunks,
    provenanceId: provenance.id,
  };
}
