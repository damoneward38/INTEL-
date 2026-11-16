import { Globe, LogIn, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AuthSession, WhiteLabelConfig } from '../types';

export type AppView =
  | 'workspace'
  | 'console'
  | 'pipeline'
  | 'upload'
  | 'knowledge'
  | 'lab'
  | 'governance'
  | 'enterprise';

interface Props {
  language: 'en' | 'he';
  onLanguageChange: (lang: 'en' | 'he') => void;
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  session: AuthSession;
  onOpenAuth: () => void;
  onLogout: () => void;
  whiteLabel?: WhiteLabelConfig | null;
}

const HUB_KEYS: AppView[] = [
  'workspace',
  'console',
  'pipeline',
  'upload',
  'knowledge',
  'lab',
  'governance',
  'enterprise',
];

const ACCENT_BORDER: Record<WhiteLabelConfig['accentColor'], string> = {
  cyan: 'border-cyan-400',
  emerald: 'border-emerald-400',
  amber: 'border-amber-400',
  violet: 'border-violet-400',
};

export default function Header({
  language,
  onLanguageChange,
  activeView,
  onViewChange,
  session,
  onOpenAuth,
  onLogout,
  whiteLabel,
}: Props) {
  const { t } = useTranslation();

  const brandLabel = whiteLabel?.enabled
    ? language === 'he'
      ? whiteLabel.brandNameHe
      : whiteLabel.brandName
    : language === 'he'
      ? 'אינטל · INTEL'
      : 'INTEL · אינטל';

  const activeBorder =
    whiteLabel?.enabled && whiteLabel.accentColor
      ? ACCENT_BORDER[whiteLabel.accentColor]
      : 'border-cyan-400';

  return (
    <header className="border-b border-slate-800 bg-[#0A0E17] px-4 sm:px-8 py-3.5">
      <div className="mx-auto max-w-[1440px] flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onViewChange('workspace')}
          className="text-left hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
        >
          <span className="text-base lg:text-lg font-semibold tracking-tight text-slate-100 block leading-tight">
            {brandLabel}
          </span>
          {whiteLabel?.enabled && (
            <span className="text-[10px] font-mono text-slate-400 block leading-tight">
              {whiteLabel.customDomain}
            </span>
          )}
        </button>

        <nav className="hidden md:flex items-center gap-4 lg:gap-5 text-xs lg:text-sm font-medium">
          {HUB_KEYS.map((viewKey) => (
            <button
              key={viewKey}
              type="button"
              data-testid="safe-ui-test"
              onClick={() => onViewChange(viewKey)}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeView === viewKey
                  ? `${activeBorder} text-slate-100`
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t(`nav.${viewKey}`)}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => onLanguageChange(language === 'en' ? 'he' : 'en')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            title="Switch Language"
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>{language === 'en' ? 'עברית' : 'English'}</span>
          </button>

          {session.role === 'guest' ? (
            <button
              type="button"
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t('auth.signIn')}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-3 py-2 text-xs font-medium text-cyan-300 bg-slate-900 border border-slate-700 hover:border-cyan-500/50 rounded-lg whitespace-nowrap shrink-0"
              >
                {t(`auth.roles.${session.role}`)}
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="p-2 text-slate-400 hover:text-slate-100 border border-slate-800 rounded-lg shrink-0"
                title={t('auth.signOut')}
                aria-label={t('auth.signOut')}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="flex md:hidden items-center gap-4 mt-3 pt-2.5 border-t border-slate-800/80 text-xs font-medium overflow-x-auto">
        {HUB_KEYS.map((viewKey) => (
          <button
            key={viewKey}
            type="button"
            onClick={() => onViewChange(viewKey)}
            className={`py-1 border-b-2 whitespace-nowrap shrink-0 ${
              activeView === viewKey
                ? 'border-cyan-400 text-slate-100'
                : 'border-transparent text-slate-400'
            }`}
          >
            {t(`nav.${viewKey}`)}
          </button>
        ))}
      </nav>
    </header>
  );
}
