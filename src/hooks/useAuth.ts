import { useCallback, useEffect, useState } from 'react';
import {
  fetchDirectoryAccounts,
  fetchSession,
  loginWithCredentials,
  setStoredToken,
  signupAccountApi,
} from '../services/api';
import type { AuthSession, DirectoryAccount } from '../types';

const GUEST_SESSION: AuthSession = {
  userId: 'usr-guest',
  name: 'Guest Observer',
  email: 'guest@intel-lab.org',
  role: 'guest',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

export function useAuth() {
  const [session, setSession] = useState<AuthSession>(GUEST_SESSION);
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const data = await fetchSession();
      setSession(data.session);
    } catch {
      setSession(GUEST_SESSION);
    }
  }, []);

  useEffect(() => {
    refreshSession();
    fetchDirectoryAccounts()
      .then((res) => setAccounts(res.accounts))
      .catch(() => {});
  }, [refreshSession]);

  const login = useCallback(async (roleOrEmail: string, accessCode?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await loginWithCredentials(roleOrEmail, accessCode);
      setStoredToken(res.token);
      setSession(res.session);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const signup = useCallback(
    async (payload: {
      name: string;
      email: string;
      organization?: string;
      role: 'researcher' | 'principal_investigator';
      accessCode: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await signupAccountApi(payload);
        setStoredToken(res.token);
        setSession(res.session);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Account registration failed');
        return false;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(() => {
    setStoredToken(null);
    setSession({
      ...GUEST_SESSION,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  }, []);

  return {
    session,
    accounts,
    loading,
    error,
    login,
    signup,
    logout,
    refreshSession,
    isAuthenticated: session.role !== 'guest',
  };
}
