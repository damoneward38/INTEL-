import { useEffect, useState } from 'react';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';
import { CheckCircle2, FileDown, FileText, Sparkles } from 'lucide-react';
import { fetchGrantDraftsApi, generateGrantDraftApi } from '../../services/api';
import type { GrantDraft, UserRole } from '../../types';

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
}

export default function GrantDraftView({ language, userRole }: Props) {
  const [topic, setTopic] = useState(
    'Adaptive Hydrogen-Mass Repartitioned Langevin MD with Verifiable Pharmacogenomics Evidence Integration'
  );
  const [template, setTemplate] = useState<GrantDraft['template']>('NIH-R01');
  const [budgetCapUsd, setBudgetCapUsd] = useState(350000);
  const [durationMonths, setDurationMonths] = useState(36);
  const [drafts, setDrafts] = useState<GrantDraft[]>([]);
  const [selected, setSelected] = useState<GrantDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate =
    userRole === 'researcher' || userRole === 'principal_investigator';

  useEffect(() => {
    fetchGrantDraftsApi()
      .then((res) => {
        setDrafts(res.drafts);
        if (res.drafts[0]) setSelected(res.drafts[0]);
      })
      .catch(() => {});
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await generateGrantDraftApi({
        topic,
        template,
        budgetCapUsd,
        durationMonths,
        language,
      });
      setDrafts((prev) => [res.draft, ...prev]);
      setSelected(res.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grant draft failed.');
    } finally {
      setLoading(false);
    }
  }

  async function exportDocx(draft: GrantDraft) {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: `${draft.template}: ${draft.title}`, heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: 'Abstract', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: draft.abstract }),
            new Paragraph({ text: 'Specific Aims', heading: HeadingLevel.HEADING_2 }),
            ...draft.specificAims.map(
              (aim, idx) => new Paragraph({ text: `${idx + 1}. ${aim}` })
            ),
            new Paragraph({ text: 'Methodology', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: draft.methodology }),
            new Paragraph({ text: 'Budget Justification', heading: HeadingLevel.HEADING_2 }),
            ...draft.budgetItems.map(
              (b) =>
                new Paragraph({
                  children: [
                    new TextRun({ text: `${b.category} ($${b.amountUsd.toLocaleString()}): `, bold: true }),
                    new TextRun(b.justification),
                  ],
                })
            ),
            new Paragraph({ text: 'Milestones', heading: HeadingLevel.HEADING_2 }),
            ...draft.milestones.map(
              (m) => new Paragraph({ text: `${m.quarter}: ${m.deliverable} [${m.verificationMetric}]` })
            ),
            new Paragraph({ text: 'Figure Placeholders', heading: HeadingLevel.HEADING_2 }),
            ...draft.figurePlaceholders.map(
              (f) => new Paragraph({ text: `${f.figureNumber}: ${f.caption} (${f.linkedSource})` })
            ),
            new Paragraph({ text: 'Verified Sources', heading: HeadingLevel.HEADING_2 }),
            ...draft.verifiedSources.map(
              (s) => new Paragraph({ text: `- ${s.title} [${s.license}] ${s.sourceUrl}` })
            ),
          ],
        },
      ],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.template.toLowerCase()}-${draft.id}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf(draft: GrantDraft) {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 48;
    const lineHeight = 15;
    const maxWidth = 500;

    function addBlock(heading: string, body: string) {
      if (y > 760) {
        pdf.addPage();
        y = 48;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(heading, 46, y);
      y += 18;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const lines = pdf.splitTextToSize(body, maxWidth) as string[];
      for (const line of lines) {
        if (y > 780) {
          pdf.addPage();
          y = 48;
        }
        pdf.text(line, 46, y);
        y += lineHeight;
      }
      y += 10;
    }

    addBlock(`${draft.template} Proposal`, draft.title);
    addBlock('Abstract', draft.abstract);
    addBlock(
      'Specific Aims',
      draft.specificAims.map((a, i) => `${i + 1}. ${a}`).join('\n')
    );
    addBlock('Methodology', draft.methodology);
    addBlock(
      'Budget Summary',
      draft.budgetItems
        .map((b) => `${b.category}: $${b.amountUsd.toLocaleString()} — ${b.justification}`)
        .join('\n')
    );
    addBlock(
      'Milestones & Figures',
      [
        ...draft.milestones.map((m) => `${m.quarter}: ${m.deliverable} (${m.verificationMetric})`),
        ...draft.figurePlaceholders.map((f) => `${f.figureNumber}: ${f.caption}`),
      ].join('\n')
    );
    addBlock(
      'Verified Citations',
      draft.verifiedSources.map((s) => `${s.title} (${s.license}) - ${s.sourceUrl}`).join('\n')
    );

    pdf.save(`${draft.template.toLowerCase()}-${draft.id}.pdf`);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            Automated Grant Draft Engine
          </h2>
        </div>

        {!canGenerate && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            Grant proposal generation requires Researcher or Principal Investigator authentication.
          </p>
        )}

        <form onSubmit={handleGenerate} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Grant Template
            </label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as GrantDraft['template'])}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
            >
              <option value="NIH-R01">NIH R01 Research Project</option>
              <option value="NSF-CAREER">NSF Faculty / Research Track</option>
              <option value="HORIZON-EU">Horizon Europe Work Programme</option>
              <option value="ISF-IL">Israel Science Foundation (ISF)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Research Scope & Objectives
            </label>
            <textarea
              rows={4}
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Budget Cap (USD)
              </label>
              <input
                type="number"
                value={budgetCapUsd}
                onChange={(e) => setBudgetCapUsd(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Months
              </label>
              <input
                type="number"
                value={durationMonths}
                onChange={(e) => setDurationMonths(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canGenerate || loading}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-45"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{loading ? 'Drafting Proposal...' : 'Generate Verified Grant Draft'}</span>
          </button>
        </form>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        {drafts.length > 0 && (
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <h3 className="text-xs font-semibold text-slate-300">Saved Drafts</h3>
            {drafts.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-xs ${
                  selected?.id === d.id
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-slate-100'
                    : 'border-slate-800 bg-[#07090E] text-slate-400'
                }`}
              >
                {d.template} · {d.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: Grant Proposal Preview + DOCX & PDF Exporters */}
      <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        {!selected ? (
          <div className="h-[380px] flex items-center justify-center text-xs text-slate-500">
            Generate a grant proposal to preview sections and export to DOCX or PDF.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <span className="text-[11px] font-mono text-cyan-300">{selected.template}</span>
                <h3 className="text-base font-semibold text-slate-100">{selected.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportDocx(selected)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-700 rounded-lg text-slate-200 hover:bg-slate-800"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Export DOCX</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportPdf(selected)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 rounded-lg hover:bg-cyan-500/25"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Export PDF</span>
                </button>
              </div>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-slate-300">
              <div>
                <h4 className="font-semibold text-slate-100 mb-1">Abstract</h4>
                <p>{selected.abstract}</p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">Specific Aims</h4>
                <ol className="list-decimal list-inside space-y-1">
                  {selected.specificAims.map((aim, idx) => (
                    <li key={idx}>{aim}</li>
                  ))}
                </ol>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">Methodology</h4>
                <p>{selected.methodology}</p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1.5">Budget Line Items</h4>
                <div className="space-y-1.5">
                  {selected.budgetItems.map((b, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2 flex justify-between gap-3"
                    >
                      <div>
                        <span className="font-semibold text-slate-100">{b.category}: </span>
                        <span className="text-slate-400">{b.justification}</span>
                      </div>
                      <span className="font-mono text-cyan-300 shrink-0">
                        ${b.amountUsd.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1.5">
                  Milestones & Figure Placeholders
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    {selected.milestones.map((m, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-800 bg-[#07090E] p-2.5">
                        <div className="font-mono text-cyan-300">{m.quarter}</div>
                        <div className="text-slate-200">{m.deliverable}</div>
                        <div className="text-[11px] text-slate-400">{m.verificationMetric}</div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {selected.figurePlaceholders.map((f, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-dashed border-slate-700 bg-[#07090E] p-2.5"
                      >
                        <div className="font-mono text-amber-300">{f.figureNumber}</div>
                        <div className="text-slate-200">{f.caption}</div>
                        <div className="text-[11px] text-slate-500">Data: {f.linkedSource}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1.5">
                  Source Verification Audit
                </h4>
                <div className="space-y-1">
                  {selected.verifiedSources.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[11px] text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>
                        {s.title} · {s.license}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
