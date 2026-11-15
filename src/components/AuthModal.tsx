import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, UserPlus, X } from 'lucide-react';
import type { AuthSession, DirectoryAccount } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  session: AuthSession;
  accounts: DirectoryAccount[];
  loading: boolean;
  error: string | null;
  onLogin: (roleOrEmail: string, accessCode?: string) => Promise<boolean>;
  onSignup: (payload: {
    name: string;
    email: string;
    organization?: string;
    role: 'researcher' | 'principal_investigator';
    accessCode: string;
  }) => Promise<boolean>;
}

export default function AuthModal({
  open,
  onClose,
  session,
  accounts,
  loading,
  error,
  onLogin,
  onSignup,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [roleOrEmail, setRoleOrEmail] = useState('researcher');
  const [accessCode, setAccessCode] = useState('RESEARCH-2026');

  // Sign-up fields
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupOrg, setSignupOrg] = useState('');
  const [signupRole, setSignupRole] = useState<'researcher' | 'principal_investigator'>(
    'researcher'
  );
  const [signupCode, setSignupCode] = useState('');

  if (!open) return null;

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onLogin(roleOrEmail, accessCode);
    if (ok) onClose();
  }

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onSignup({
      name: signupName,
      email: signupEmail,
      organization: signupOrg,
      role: signupRole,
      accessCode: signupCode,
    });
    if (ok) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#0D121D] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            {mode === 'signin' ? (
              <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0" />
            ) : (
              <UserPlus className="w-5 h-5 text-cyan-400 shrink-0" />
            )}
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {t('auth.modalTitle')}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('auth.roleLabel')}: {session.name} ({t(`auth.roles.${session.role}`)})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md border border-slate-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#07090E] border border-slate-800 mb-4">
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mode === 'signin'
                ? 'bg-cyan-500 text-slate-950'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('auth.signInTab')}
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mode === 'signup'
                ? 'bg-cyan-500 text-slate-950'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('auth.signUpTab')}
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-300 mb-4">
          {t('auth.modalSubtitle')}
        </p>

        {mode === 'signin' ? (
          <>
            {accounts.length > 0 && (
              <div className="mb-5">
                <div className="text-xs font-medium text-slate-400 mb-2">
                  {t('auth.quickFill')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {accounts.map((acc) => (
                    <button
                      key={acc.userId}
                      type="button"
                      onClick={() => {
                        setRoleOrEmail(acc.email);
                        setAccessCode(acc.accessCodeHint);
                      }}
                      className="text-left p-2.5 rounded-lg border border-slate-800 bg-[#07090E] hover:border-cyan-500/50 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-200 truncate">
                        {t(`auth.roles.${acc.role}`)}
                      </div>
                      <div className="text-[11px] font-mono-tabular text-slate-400 truncate mt-0.5">
                        {acc.accessCodeHint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('auth.emailOrRole')}
                </label>
                <input
                  type="text"
                  value={roleOrEmail}
                  onChange={(e) => setRoleOrEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('auth.accessCode')}
                </label>
                <input
                  type="password"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100 font-mono-tabular"
                  required
                />
              </div>

              {error && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-300 border border-slate-700 rounded-lg hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-50"
                >
                  {t('auth.submit')}
                </button>
              </div>
            </form>
          </>
        ) : (
          <form onSubmit={handleSignupSubmit} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('auth.fullName')}
                </label>
                <input
                  type="text"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder="Dr. Jordan Rivera"
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100"
                  minLength={2}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('auth.emailAddress')}
                </label>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="jordan@biolab.org"
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('auth.organization')}
                </label>
                <input
                  type="text"
                  value={signupOrg}
                  onChange={(e) => setSignupOrg(e.target.value)}
                  placeholder="BioSystems Consortium"
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('auth.accountRole')}
                </label>
                <select
                  value={signupRole}
                  onChange={(e) =>
                    setSignupRole(e.target.value as 'researcher' | 'principal_investigator')
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100"
                >
                  <option value="researcher">{t('auth.roles.researcher')}</option>
                  <option value="principal_investigator">
                    {t('auth.roles.principal_investigator')}
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('auth.newAccessCode')}
              </label>
              <input
                type="password"
                value={signupCode}
                onChange={(e) => setSignupCode(e.target.value)}
                placeholder="At least 6 characters"
                minLength={6}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-sm text-slate-100 font-mono-tabular"
                required
              />
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 border border-slate-700 rounded-lg hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg disabled:opacity-50"
              >
                {t('auth.createAccount')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
