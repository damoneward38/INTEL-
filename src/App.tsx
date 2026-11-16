import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AuthModal from './components/AuthModal';
import ControlTower from './components/ControlTower';
import CorpusView from './components/CorpusView';
import Header, { type AppView } from './components/Header';
import HologramCanvas from './components/HologramCanvas';
import InsightPanel from './components/InsightPanel';
import ProvenanceView from './components/ProvenanceView';
import AiMentorView from './components/modules/AiMentorView';
import AllUploadView from './components/modules/AllUploadView';
import AutoOptimizeView from './components/modules/AutoOptimizeView';
import AutonomousControllerView from './components/modules/AutonomousControllerView';
import EcoAuditorView from './components/modules/EcoAuditorView';
import EnterpriseSuiteView from './components/modules/EnterpriseSuiteView';
import GestureControlView, {
  type GestureCommandId,
} from './components/modules/GestureControlView';
import GrantDraftView from './components/modules/GrantDraftView';
import LiveFluxView from './components/modules/LiveFluxView';
import Narrative3DView from './components/modules/Narrative3DView';
import OpenDataMarketView from './components/modules/OpenDataMarketView';
import OrchestratorView from './components/modules/OrchestratorView';
import PgxVaultView from './components/modules/PgxVaultView';
import ResearchConsoleView from './components/modules/ResearchConsoleView';
import SandboxView from './components/modules/SandboxView';
import ThoughtPrototypesView from './components/modules/ThoughtPrototypesView';
import PipelineWorkspaceHub, {
  PIPELINE_SUB_ROUTES,
  type PipelineSubRoute,
} from './components/pipeline/PipelineWorkspaceHub';
import { useAuth } from './hooks/useAuth';
import { useCorpus } from './hooks/useCorpus';
import { useResearch } from './hooks/useResearch';
import { useSimulation } from './hooks/useSimulation';
import { fetchEnterpriseOverviewApi } from './services/api';
import type { WhiteLabelConfig } from './types';

function resolveInitialPipelineRoute(): PipelineSubRoute | null {
  if (typeof window === 'undefined') return null;
  const p = window.location.pathname as PipelineSubRoute;
  return PIPELINE_SUB_ROUTES.some((r) => r.path === p) ? p : null;
}

type KnowledgeTab = 'corpus' | 'flux' | 'narrative' | 'market';
type LabTab =
  | 'sandbox'
  | 'prototypes'
  | 'grants'
  | 'pgx'
  | 'optimize'
  | 'autonomous'
  | 'orchestrator';
type GovernanceTab = 'provenance' | 'eco' | 'mentor' | 'gestures';

export default function App() {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState<'en' | 'he'>('en');
  const initialPipelineRoute = resolveInitialPipelineRoute();
  const [activeView, setActiveView] = useState<AppView>(
    initialPipelineRoute ? 'pipeline' : 'workspace'
  );
  const [pipelineRoute, setPipelineRoute] = useState<PipelineSubRoute>(
    initialPipelineRoute ?? '/command-center'
  );
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>('corpus');
  const [labTab, setLabTab] = useState<LabTab>('sandbox');
  const [governanceTab, setGovernanceTab] = useState<GovernanceTab>('provenance');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [whiteLabel, setWhiteLabel] = useState<WhiteLabelConfig | null>(null);

  const auth = useAuth();
  const research = useResearch();
  const simulation = useSimulation();
  const corpus = useCorpus();

  useEffect(() => {
    fetchEnterpriseOverviewApi()
      .then((res) => setWhiteLabel(res.whiteLabel))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const matched = resolveInitialPipelineRoute();
      if (matched) {
        setActiveView('pipeline');
        setPipelineRoute(matched);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigatePipelineRoute(nextRoute: PipelineSubRoute) {
    setPipelineRoute(nextRoute);
    setActiveView('pipeline');
    if (typeof window !== 'undefined' && window.location.pathname !== nextRoute) {
      window.history.pushState({}, '', nextRoute);
    }
  }

  function handleViewChange(view: AppView) {
    setActiveView(view);
    if (view === 'pipeline') {
      if (typeof window !== 'undefined' && window.location.pathname !== pipelineRoute) {
        window.history.pushState({}, '', pipelineRoute);
      }
    } else if (typeof window !== 'undefined' && resolveInitialPipelineRoute()) {
      window.history.pushState({}, '', '/');
    }
  }

  useEffect(() => {
    i18n.changeLanguage(language);
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [i18n, language]);

  function handleGestureCommand(cmd: GestureCommandId) {
    if (cmd === 'nav:workspace') setActiveView('workspace');
    else if (cmd === 'nav:knowledge') setActiveView('knowledge');
    else if (cmd === 'nav:lab') setActiveView('lab');
    else if (cmd === 'nav:governance') setActiveView('governance');
    else if (cmd === 'action:toggle_language') {
      setLanguage((prev) => (prev === 'en' ? 'he' : 'en'));
    } else if (cmd === 'action:run_simulation') {
      setActiveView('workspace');
      simulation.run();
    }
  }

  function handleNavigateForAudit(view: AppView, subtab?: string) {
    setActiveView(view);
    if (view === 'knowledge' && subtab) {
      setKnowledgeTab(subtab as KnowledgeTab);
    } else if (view === 'lab' && subtab) {
      setLabTab(subtab as LabTab);
    } else if (view === 'governance' && subtab) {
      setGovernanceTab(subtab as GovernanceTab);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col"
      dir={language === 'he' ? 'rtl' : 'ltr'}
    >
      <Header
        language={language}
        onLanguageChange={setLanguage}
        activeView={activeView}
        onViewChange={handleViewChange}
        session={auth.session}
        onOpenAuth={() => setAuthModalOpen(true)}
        onLogout={auth.logout}
        whiteLabel={whiteLabel}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-8 py-6">
        {activeView === 'workspace' && (
          <div className="flex flex-col gap-6">
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <div className="lg:col-span-8">
                <HologramCanvas
                  active={research.loading || simulation.running}
                  simulationProgress={simulation.progress}
                  simulationState={simulation.state}
                  parameters={simulation.parameters}
                  particles={simulation.particles}
                />
              </div>

              <div className="lg:col-span-4">
                <ControlTower
                  language={language}
                  researchLoading={research.loading}
                  researchError={research.error}
                  onRunResearch={(query, depth, inputMode) =>
                    research.ask(query, { language, depth, inputMode })
                  }
                  simParameters={simulation.parameters}
                  onSimParametersChange={simulation.setParameters}
                  simRunning={simulation.running}
                  simProgress={simulation.progress}
                  simError={simulation.error}
                  onRunSimulation={simulation.run}
                  onCancelSimulation={simulation.cancel}
                  onOpenConsole={() => setActiveView('console')}
                />
              </div>
            </section>

            <InsightPanel
              researchResult={research.result}
              sources={research.sources}
              researchLoading={research.loading}
              simulationJob={simulation.job}
              simulationFrames={simulation.frames}
              simulationSummary={simulation.summary}
            />
          </div>
        )}

        {activeView === 'console' && <ResearchConsoleView language={language} />}

        {activeView === 'pipeline' && (
          <PipelineWorkspaceHub
            language={language}
            userRole={auth.session.role}
            route={pipelineRoute}
            onRouteChange={navigatePipelineRoute}
          />
        )}

        {activeView === 'knowledge' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
              {(['corpus', 'flux', 'narrative', 'market'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid="safe-ui-test"
                  onClick={() => setKnowledgeTab(tab)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    knowledgeTab === tab
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t(`nav.subtabs.${tab}`)}
                </button>
              ))}
            </div>

            {knowledgeTab === 'corpus' && (
              <CorpusView
                chunks={corpus.chunks}
                domains={corpus.domains}
                selectedDomain={corpus.selectedDomain}
                onSelectDomain={corpus.setSelectedDomain}
                userRole={auth.session.role}
                onIngest={corpus.ingest}
                onRefreshCorpus={() => corpus.reload()}
              />
            )}
            {knowledgeTab === 'flux' && <LiveFluxView />}
            {knowledgeTab === 'narrative' && <Narrative3DView />}
            {knowledgeTab === 'market' && (
              <OpenDataMarketView
                userRole={auth.session.role}
                onCorpusUpdated={() => corpus.reload()}
              />
            )}
          </div>
        )}

        {activeView === 'lab' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
              {(
                [
                  'sandbox',
                  'prototypes',
                  'grants',
                  'pgx',
                  'optimize',
                  'autonomous',
                  'orchestrator',
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid="safe-ui-test"
                  onClick={() => setLabTab(tab)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    labTab === tab
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t(`nav.subtabs.${tab}`)}
                </button>
              ))}
            </div>

            {labTab === 'sandbox' && <SandboxView session={auth.session} />}
            {labTab === 'prototypes' && <ThoughtPrototypesView language={language} />}
            {labTab === 'grants' && (
              <GrantDraftView language={language} userRole={auth.session.role} />
            )}
            {labTab === 'pgx' && <PgxVaultView session={auth.session} />}
            {labTab === 'optimize' && (
              <AutoOptimizeView language={language} userRole={auth.session.role} />
            )}
            {labTab === 'autonomous' && (
              <AutonomousControllerView
                language={language}
                userRole={auth.session.role}
              />
            )}
            {labTab === 'orchestrator' && (
              <OrchestratorView
                language={language}
                userRole={auth.session.role}
                onNavigateForAudit={handleNavigateForAudit}
              />
            )}
          </div>
        )}

        {activeView === 'governance' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
              {(['provenance', 'eco', 'mentor', 'gestures'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid="safe-ui-test"
                  onClick={() => setGovernanceTab(tab)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    governanceTab === tab
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t(`nav.subtabs.${tab}`)}
                </button>
              ))}
            </div>

            {governanceTab === 'provenance' && (
              <ProvenanceView userRole={auth.session.role} />
            )}
            {governanceTab === 'eco' && <EcoAuditorView />}
            {governanceTab === 'mentor' && <AiMentorView />}
            {governanceTab === 'gestures' && (
              <GestureControlView onExecuteCommand={handleGestureCommand} />
            )}
          </div>
        )}

        {activeView === 'upload' && (
          <AllUploadView
            language={language}
            userRole={auth.session.role}
            onCorpusUpdated={() => corpus.reload()}
            onLaunchSimulation={(engine) => {
              simulation.setParameters((prev) => ({ ...prev, engine }));
              setActiveView('workspace');
            }}
          />
        )}

        {activeView === 'enterprise' && (
          <EnterpriseSuiteView
            language={language}
            userRole={auth.session.role}
            session={auth.session}
            onBrandUpdated={setWhiteLabel}
          />
        )}
      </main>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        session={auth.session}
        accounts={auth.accounts}
        loading={auth.loading}
        error={auth.error}
        onLogin={auth.login}
        onSignup={auth.signup}
      />
    </div>
  );
}
