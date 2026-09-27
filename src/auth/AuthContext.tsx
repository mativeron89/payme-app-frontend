import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import type {
  GoogleContinueLinkRequest,
  GoogleContinueRequest,
  GoogleRedirectSignupRequest,
} from '../api/socialAuth';
import { volverAlIngreso } from '../router';
import {
  canjearVueltaGoogleRedirectUnaVez,
  olvidarVueltaGoogleRedirect,
  vueltaGoogleRedirectSnapshot,
} from '../api/googleRedirect';
import { extractApiError } from '../api/errors';
import { useInicioTrasIngreso } from './useInicioTrasIngreso';

export type FacebookCallbackPhase = 'idle' | 'processing' | 'error';

/**
 * AF-GOOGLE-REDIRECT · la vuelta de «Entrar» con Google en la misma pestaña.
 * El motivo del error decide el texto (siempre uno que ya existe):
 * - `sin_vinculo`: `#google_redirect_error=social_auth_failed` (opaco, como
 *   `google/login`): lleva a «Crea tu cuenta» si hay alta, como el popup;
 * - `codigo_invalido`: el canje contestó `401` (reusado, vencido, inexistente);
 * - `demasiados`: el canje contestó `429`;
 * - `csrf`: `#google_redirect_error=csrf_failed`;
 * - `no_disponible`: `#google_redirect_error=temporarily_unavailable`;
 * - `fallo`: cualquier otra cosa (red, `404` con la capability apagada, forma).
 */
export type MotivoVueltaGoogle =
  | 'sin_vinculo' | 'codigo_invalido' | 'demasiados' | 'csrf' | 'no_disponible' | 'fallo';

export type VueltaGoogle =
  | { readonly fase: 'idle' }
  | { readonly fase: 'processing' }
  | { readonly fase: 'error'; readonly motivo: MotivoVueltaGoogle };

function vueltaGoogleInicial(): VueltaGoogle {
  const v = vueltaGoogleRedirectSnapshot();
  if (v.estado === 'codigo') return { fase: 'processing' };
  if (v.estado === 'invalida') return { fase: 'error', motivo: 'fallo' };
  if (v.estado === 'error') {
    return {
      fase: 'error',
      motivo: v.error === 'social_auth_failed' ? 'sin_vinculo'
        : v.error === 'csrf_failed' ? 'csrf' : 'no_disponible',
    };
  }
  return { fase: 'idle' };
}

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
  /** AF-17 · entra o crea en un toque; `created` dice si la cuenta nació ahora. */
  googleContinue(data: GoogleContinueRequest): Promise<{ readonly created: boolean }>;
  /** AF-GOOGLE-ALTA-REDIRECT · canje del alta con Google en la misma pestaña. */
  googleRedirectSignup(data: GoogleRedirectSignupRequest): Promise<{ readonly created: boolean }>;
  /** AF-17 · completa un `409 link_required` con la contraseña de la cuenta. */
  googleContinueLink(data: GoogleContinueLinkRequest): Promise<void>;
  /**
   * AF-17 · un aviso breve que SOBREVIVE a la sesión nueva. El toast de la app
   * vive dentro del `Fragment` que se remonta con cada familia de sesión —a
   * propósito: invalida el estado de la UI anterior—, así que un «creamos tu
   * cuenta» disparado desde el ingreso moría con él. Éste se dibuja afuera.
   * Recibe el texto ya traducido.
   */
  anunciar(mensaje: string): void;
  facebookCallbackPhase: FacebookCallbackPhase;
  /** AF-GOOGLE-REDIRECT · la vuelta de «Entrar» con Google en la misma pestaña. */
  vueltaGoogle: VueltaGoogle;
  /** La pantalla ya mostró el error de la vuelta. */
  descartarVueltaGoogle(): void;
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
  // AF-INICIO-TRAS-INGRESO · acá y no en el shell: los hijos se remontan con
  // cada familia de sesión y no ven el ingreso (ver el hook).
  useInicioTrasIngreso(session);

  /**
   * AF-GOOGLE-REDIRECT · la vuelta ya salió de la URL en `main.tsx`. Acá se
   * canjea UNA vez —`StrictMode` monta dos, y las dos comparten la misma
   * promesa— y se entra como con el popup: la sesión nueva, la puerta legal y
   * Inicio (AF-INICIO-TRAS-INGRESO) siguen su curso de siempre.
   */
  const [vueltaGoogle, setVueltaGoogle] = useState<VueltaGoogle>(vueltaGoogleInicial);
  useEffect(() => {
    if (vueltaGoogleRedirectSnapshot().estado !== 'codigo') return;
    let vivo = true;
    canjearVueltaGoogleRedirectUnaVez((codigo) => api.googleRedirectRedeem(codigo))
      .then(() => {
        olvidarVueltaGoogleRedirect();
        setSession(loadSession());
        if (vivo) setVueltaGoogle({ fase: 'idle' });
      })
      .catch((error: unknown) => {
        olvidarVueltaGoogleRedirect();
        setSession(loadSession());
        const { status } = extractApiError(error);
        const motivo: MotivoVueltaGoogle = status === 401 ? 'codigo_invalido'
          : status === 429 ? 'demasiados' : 'fallo';
        if (vivo) setVueltaGoogle({ fase: 'error', motivo });
      });
    return () => { vivo = false; };
  }, []);
  const descartarVueltaGoogle = useCallback(() => {
    olvidarVueltaGoogleRedirect();
    setVueltaGoogle((actual) => (actual.fase === 'error' ? { fase: 'idle' } : actual));
  }, []);

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

  const [anuncio, setAnuncio] = useState<string | null>(null);
  const anuncioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anunciar = useCallback((mensaje: string) => {
    setAnuncio(mensaje);
    if (anuncioTimer.current) clearTimeout(anuncioTimer.current);
    anuncioTimer.current = setTimeout(() => setAnuncio(null), 2400);
  }, []);
  useEffect(() => () => {
    if (anuncioTimer.current) clearTimeout(anuncioTimer.current);
  }, []);

  const googleContinue = useCallback(async (data: GoogleContinueRequest) => {
    try {
      const result = await api.googleContinue(data);
      setFacebookCallbackPhase('idle');
      return result;
    } finally {
      setSession(loadSession());
    }
  }, []);

  const googleRedirectSignup = useCallback(async (data: GoogleRedirectSignupRequest) => {
    try {
      const result = await api.googleRedirectSignup(data);
      setFacebookCallbackPhase('idle');
      return result;
    } finally {
      setSession(loadSession());
    }
  }, []);

  const googleContinueLink = useCallback(async (data: GoogleContinueLinkRequest) => {
    try {
      await api.googleContinueLink(data);
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
      // AF-INICIO-TRAS-INGRESO · la URL vuelve a la pantalla de ingreso: la ruta
      // de la sesión que se cierra (p. ej. `/mas`) no se arrastra a la próxima.
      volverAlIngreso();
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
      googleContinue,
      googleRedirectSignup,
      googleContinueLink,
      anunciar,
      facebookCallbackPhase,
      vueltaGoogle,
      descartarVueltaGoogle,
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
      googleContinue,
      googleRedirectSignup,
      googleContinueLink,
      anunciar,
      facebookCallbackPhase,
      vueltaGoogle,
      descartarVueltaGoogle,
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
      {/* Fuera del Fragment: no se remonta con la sesión. Siempre montado, igual
          que el toast de la app, para que la región live se anuncie. Vacío lleva
          SÓLO `toast-hidden` (oculto y sin la caja flotante): así no es un
          segundo `.toast` en la página mientras no anuncia nada. */}
      <div className={anuncio ? 'toast' : 'toast-hidden'} role="status" aria-live="polite">
        {anuncio}
      </div>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requiere AuthProvider');
  return ctx;
}
