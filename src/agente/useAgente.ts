import { useCallback, useRef } from 'react';
import { api } from '../api';
import { useEstadoDelAgente, type EstadoDelAgente } from '../api/agente';
import type { StoredSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';

/**
 * D554 · el estado del agente de la sesión de ahora: `null` mientras no se sabe o sin sesión. La lectura es una por
 * sesión (`asegurarEstadoDelAgente`, que se borra al cambiar la cuenta); con el dueño apagado, caído o anterior, todo
 * queda apagado y nada se dibuja.
 */
export function useAgente(): { readonly estado: EstadoDelAgente | null; readonly session: StoredSession | null } {
  return useAgenteDeSesion(useAuth().session);
}

/** Lo mismo, con la sesión que ya tiene la pantalla (Configuración › Privacidad la recibe por props). */
export function useAgenteDeSesion(session: StoredSession | null): {
  readonly estado: EstadoDelAgente | null; readonly session: StoredSession | null;
} {
  const sesionRef = useRef(session);
  sesionRef.current = session;
  // Estable: la memoria del estado ya es por cuenta, así que un refresh del token no vuelve a preguntar.
  const leer = useCallback(() => {
    const s = sesionRef.current;
    return s ? api.getEstadoDelAgente(s) : Promise.reject(new Error('sin_sesion'));
  }, []);
  const estado = useEstadoDelAgente(session ? leer : null);
  return { estado, session };
}
