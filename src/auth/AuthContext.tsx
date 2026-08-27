import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api';
import {
  completeFacebookCallbackOnce,
  facebookCallbackSnapshot,
} from '../api/facebookAuthFlow';
import { clearSignupInvitation } from '../api/signupInvitation';
import { loadSession, replaceCurrentSession, subscribeSession, type StoredSession } from '../api/storage';
import type { GoogleRegisterRequest, RegisterRequest, User } from '../api/types';

export type FacebookCallbackPhase = 'idle' | 'processing' | 'error';

function initialFacebookCallbackPhase(): FacebookCallbackPhase {
  const capture = facebookCallbackSnapshot();
  if (capture.status === 'ready') return 'processing';
  if (capture.status === 'invalid' || capture.status === 'expired' || capture.status === 'mismatch') {
    return 'error';
  }
  return 'idle';
}

interface AuthState {
  session: StoredSession | null;
  login(email: string, password: string): Promise<void>;
  register(data: RegisterRequest): Promise<void>;
  googleLogin(idToken: string): Promise<void>;
  googleRegister(data: GoogleRegisterRequest): Promise<void>;
  facebookCallbackPhase: FacebookCallbackPhase;
  completeFacebookCallback(): Promise<void>;
  clearFacebookCallbackError(): void;
  logout(): Promise<void>;
  /** Adopta una respuesta propia sólo si familia, principal y tokens siguen iguales. */
  adoptUser(expectedSession: StoredSession, user: User): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => api.restoreSession());
  const [facebookCallbackPhase, setFacebookCallbackPhase] = useState<FacebookCallbackPhase>(
    initialFacebookCallbackPhase,
  );

  useEffect(() => {
    api.onSessionExpired(() => setSession(loadSession()));
    return () => api.onSessionExpired(null);
  }, []);

  useEffect(() => subscribeSession(() => setSession(loadSession())), []);

  // G-02 (v2.20): una sesión persistida ANTES de que login devolviera `user`
  // no tiene identidad — se hidrata una sola vez con GET /account/me. Si
  // falla (p. ej. offline), se sigue sin nombre; el próximo login la completa.
  useEffect(() => {
    if (!session || session.user) return;
    const origin = session;
    let alive = true;
    api
      .getMe()
      .then((r) => {
        if (!alive) return;
        // La respuesta de hidratación puede llegar después de un cambio de
        // pestaña/relogin. CAS evita reanimar su familia vieja en storage/UI.
        const current = loadSession();
        if (!current || current.user) return;
        replaceCurrentSession(origin, { ...current, user: r.user });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      // El estado visible solo puede adoptar lo que quedó confirmado en storage.
      // Esto cubre tanto el adaptador real (que devuelve la sesión) como mock.
      await api.login(email, password);
      setFacebookCallbackPhase('idle');
    } finally {
      setSession(loadSession());
    }
  }, []);

  const register = useCallback(async (data: RegisterRequest) => {
    try {
      await api.register(data);
      setFacebookCallbackPhase('idle');
    } finally {
      setSession(loadSession());
    }
  }, []);

  const googleLogin = useCallback(async (idToken: string) => {
    try {
      await api.googleLogin(idToken);
      setFacebookCallbackPhase('idle');
    } finally {
      setSession(loadSession());
    }
  }, []);

  const googleRegister = useCallback(async (data: GoogleRegisterRequest) => {
    try {
      await api.googleRegister(data);
      setFacebookCallbackPhase('idle');
    } finally {
      setSession(loadSession());
    }
  }, []);

  const completeFacebookCallback = useCallback(async () => {
    setFacebookCallbackPhase('processing');
    try {
      const completed = await completeFacebookCallbackOnce(async (
        purpose,
        request,
        expectedStateWitness,
      ) => {
        const session = purpose === 'login'
          ? await api.facebookLoginComplete(request, expectedStateWitness)
          : await api.facebookRegisterComplete(request, expectedStateWitness);
        if (purpose === 'register') clearSignupInvitation();
        return session;
      });
      if (!completed) throw new Error('facebook_callback_invalid');
      setSession(loadSession());
      setFacebookCallbackPhase('idle');
    } catch {
      const current = loadSession();
      setSession(current);
      // Una sesión B adjudicada en paralelo manda sobre el callback viejo: no
      // se vuelve a mostrar su error al cerrar sesión más tarde.
      setFacebookCallbackPhase(current ? 'idle' : 'error');
      throw new Error('social_auth_failed');
    }
  }, []);

  useEffect(() => {
    if (facebookCallbackSnapshot().status !== 'ready') return;
    // StrictMode ejecuta el effect dos veces; la frontera comparte la misma
    // promise y garantiza un solo canje.
    void completeFacebookCallback().catch(() => undefined);
  }, [completeFacebookCallback]);

  const clearFacebookCallbackError = useCallback(() => {
    setFacebookCallbackPhase((current) => current === 'error' ? 'idle' : current);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(loadSession());
      setFacebookCallbackPhase('idle');
    }
  }, []);

  const adoptUser = useCallback((expectedSession: StoredSession, user: User): boolean => {
    if (user.id !== expectedSession.principal_id) return false;
    return replaceCurrentSession(expectedSession, { ...expectedSession, user });
  }, []);

  const value = useMemo(
    () => ({
      session,
      login,
      register,
      googleLogin,
      googleRegister,
      facebookCallbackPhase,
      completeFacebookCallback,
      clearFacebookCallbackError,
      logout,
      adoptUser,
    }),
    [
      session,
      login,
      register,
      googleLogin,
      googleRegister,
      facebookCallbackPhase,
      completeFacebookCallback,
      clearFacebookCallbackError,
      logout,
      adoptUser,
    ],
  );
  // Una familia nueva, incluso del mismo principal, invalida estados derivados
  // de la UI anterior antes de que puedan firmar requests con credenciales viejas.
  return (
    <AuthContext.Provider value={value}>
      <Fragment key={session?.family_id ?? 'signed-out'}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requiere AuthProvider');
  return ctx;
}
