import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Plus, Search, Globe } from 'lucide-react';
import { searchRetrievalApi, startExternalIngestionApi } from '../services/api';
import type { CorpusChunk, RetrievedSource, UserRole } from '../types';

interface Props {
  chunks: CorpusChunk[];
  domains: string[];
  selectedDomain: string;
  onSelectDomain: (domain: string) => void;
  userRole: UserRole;
  onIngest: (doc: {
    title: string;
    authors: string;
    domain: string;
    license: string;
    sourceUrl: string;
    content: string;
  }) => Promise<unknown>;
  onRefreshCorpus: () => Promise<void>;
}

export default function CorpusView({
  chunks,
  domains,
  selectedDomain,
  onSelectDomain,
  userRole,
  onIngest,
  onRefreshCorpus,
}: Props) {
  const { t } = useTranslation();

  // Hybrid search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RetrievedSource[] | null>(null);
  const [searching, setSearching] = useState(false);

  // External connector state (PubMed / arXiv / Wikidata / Gutenberg)
  const [extSource, setExtSource] = useState<'arxiv' | 'pubmed' | 'wikidata' | 'gutenberg'>('arxiv');
  const [extQuery, setExtQuery] = useState('molecular dynamics');
  const [extLimit, setExtLimit] = useState(3);
  const [extLoading, setExtLoading] = useState(false);
  const [extFeedback, setExtFeedback] = useState<string | null>(null);

  // Manual ingestion state
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [domain, setDomain] = useState('Molecular Dynamics');
  const [license, setLicense] = useState('CC-BY-4.0');
  const [sourceUrl, setSourceUrl] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canIngest = userRole === 'researcher' || userRole === 'principal_investigator';

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await searchRetrievalApi(searchQuery.trim(), 8);
      setSearchResults(res.results);
    } finally {
      setSearching(false);
    }
  }

  async function handleExternalIngest(e: React.FormEvent) {
    e.preventDefault();
    setExtLoading(true);
    setExtFeedback(null);
    try {
      const res = await startExternalIngestionApi({
        source: extSource,
        query: extQuery,
        limit: extLimit,
      });
      await onRefreshCorpus();
      setExtFeedback(
        `Fetched ${res.documentsFetched} documents (${res.chunksIndexed} chunks) from ${res.source}. Provenance: ${res.provenanceId}`
      );
    } catch (err) {
      setExtFeedback(err instanceof Error ? err.message : 'External ingestion failed.');
    } finally {
      setExtLoading(false);
    }
  }

  async function handleManualIngest(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      await onIngest({ title, authors, domain, license, sourceUrl, content });
      setTitle('');
      setAuthors('');
      setSourceUrl('');
      setContent('');
      setFeedback('Document indexed into vector store with license verification record.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Ingestion failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Hybrid Search + Corpus Chunks List */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{t('corpus.title')}</h2>
          <p className="text-xs text-slate-400 mt-1">{t('corpus.subtitle')}</p>
        </div>

        {/* Hybrid Vector Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('corpus.searchPlaceholder')}
            className="flex-1 rounded-lg border border-slate-700 bg-[#0D121D] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={searching || searchQuery.trim().length < 2}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-45 whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{t('corpus.searchAction')}</span>
          </button>
          {searchResults !== null && (
            <button
              type="button"
              onClick={() => {
                setSearchResults(null);
                setSearchQuery('');
              }}
              className="px-3 py-2 text-xs text-slate-300 border border-slate-700 rounded-lg hover:bg-slate-800 whitespace-nowrap"
            >
              {t('corpus.clearSearch')}
            </button>
          )}
        </form>

        {/* Domain Filters */}
        {searchResults === null && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectDomain('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap transition-colors ${
                selectedDomain === 'all'
                  ? 'bg-slate-800 text-slate-100 border-slate-600'
                  : 'text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              {t('corpus.allDomains')}
            </button>
            {domains.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onSelectDomain(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap transition-colors ${
                  selectedDomain === d
                    ? 'bg-slate-800 text-slate-100 border-slate-600'
                    : 'text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {/* Display Either Search Hits or Filtered Corpus Chunks */}
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] divide-y divide-slate-800">
          {searchResults !== null
            ? searchResults.map((hit) => (
                <article key={hit.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular text-slate-400 mb-1">
                        <span className="text-cyan-400">{hit.id}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-400">
                          score {(hit.score * 100).toFixed(0)}%
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{hit.license}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {hit.trainingAllowed ? 'Training Allowed' : 'Retrieval Only'}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100">{hit.title}</h3>
                      <p className="text-xs leading-relaxed text-slate-300 mt-1.5">
                        {hit.text}
                      </p>
                    </div>
                    <a
                      href={hit.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </article>
              ))
            : chunks.map((chunk) => (
                <article key={chunk.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular text-slate-400 mb-1">
                        <span className="text-cyan-400">{chunk.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>v{chunk.version}</span>
                        <span aria-hidden="true">·</span>
                        <span>{chunk.domain}</span>
                        <span aria-hidden="true">·</span>
                        <span>{chunk.license}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            chunk.licenseRecord.verified
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }
                        >
                          {chunk.licenseRecord.verified ? 'Verified' : 'Unverified'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {chunk.licenseRecord.trainingAllowed
                            ? 'Training OK'
                            : 'No Training'}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100">
                        {chunk.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">{chunk.authors}</p>
                      <p className="text-xs leading-relaxed text-slate-300 mt-2">
                        {chunk.text}
                      </p>
                    </div>
                    <a
                      href={chunk.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 shrink-0"
                      title={chunk.sourceUrl}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </article>
              ))}
        </div>
      </div>

      {/* Right: Live External Ingestion + Manual Document Ingestion */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        {!canIngest && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3.5 py-2.5">
            {t('corpus.roleNotice')}
          </p>
        )}

        {/* Live PubMed / arXiv / Wikidata Connector */}
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              {t('corpus.externalTitle')}
            </h3>
          </div>

          <form onSubmit={handleExternalIngest} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {t('corpus.externalSource')}
                </label>
                <select
                  value={extSource}
                  onChange={(e) =>
                    setExtSource(
                      e.target.value as 'arxiv' | 'pubmed' | 'wikidata' | 'gutenberg'
                    )
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-2 text-xs text-slate-100"
                >
                  <option value="arxiv">arXiv Preprints</option>
                  <option value="pubmed">NCBI PubMed</option>
                  <option value="wikidata">Wikidata Graph</option>
                  <option value="gutenberg">Project Gutenberg</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {t('corpus.externalLimit')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={extLimit}
                  onChange={(e) => setExtLimit(Number(e.target.value) || 3)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs font-mono-tabular text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                {t('corpus.externalQuery')}
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={extQuery}
                onChange={(e) => setExtQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
              />
            </div>

            {extFeedback && (
              <p className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-md px-3 py-2">
                {extFeedback}
              </p>
            )}

            <button
              type="submit"
              disabled={extLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-white text-slate-950 rounded-lg disabled:opacity-50"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{extLoading ? 'Fetching...' : t('corpus.externalSubmit')}</span>
            </button>
          </form>
        </div>

        {/* Manual Document Ingestion */}
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
          <h3 className="text-sm font-semibold text-slate-100 mb-3">
            {t('corpus.ingestTitle')}
          </h3>

          <form onSubmit={handleManualIngest} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                {t('corpus.docTitle')}
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {t('corpus.authors')}
                </label>
                <input
                  type="text"
                  required
                  value={authors}
                  onChange={(e) => setAuthors(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {t('corpus.domain')}
                </label>
                <input
                  type="text"
                  required
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {t('corpus.license')}
                </label>
                <input
                  type="text"
                  required
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {t('corpus.sourceUrl')}
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                {t('corpus.content')}
              </label>
              <textarea
                rows={4}
                required
                minLength={20}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] p-3 text-xs text-slate-100"
              />
            </div>

            {feedback && (
              <p className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-md px-3 py-2">
                {feedback}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('corpus.ingestSubmit')}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
