import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api';
import { saveSession, type StoredSession } from '../api/storage';
import type { RegisterRequest } from '../api/types';

interface AuthState {
  session: StoredSession | null;
  login(email: string, password: string): Promise<void>;
  register(data: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => api.restoreSession());

  useEffect(() => {
    api.onSessionExpired(() => setSession(null));
    return () => api.onSessionExpired(null);
  }, []);

  // G-02 (v2.20): una sesión persistida ANTES de que login devolviera `user`
  // no tiene identidad — se hidrata una sola vez con GET /account/me. Si
  // falla (p. ej. offline), se sigue sin nombre; el próximo login la completa.
  useEffect(() => {
    if (!session || session.user) return;
    let alive = true;
    api
      .getMe()
      .then((r) => {
        if (!alive) return;
        setSession((cur) => {
          if (!cur || cur.user) return cur;
          const next = { ...cur, user: r.user };
          saveSession(next);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session]);

  const login = useCallback(async (email: string, password: string) => {
    setSession(await api.login(email, password));
  }, []);

  const register = useCallback(async (data: RegisterRequest) => {
    setSession(await api.register(data));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, login, register, logout }),
    [session, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requiere AuthProvider');
  return ctx;
}
