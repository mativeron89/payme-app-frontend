import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * D363 · enmienda 10 de `d363_front` (V, 19/10): «Un aviso de privacidad no puede quedar tapado nunca». El aviso
 * «Tu foto entre amigos» (`FriendAvatarNotice`) informa acá su estado, y la guía lo respeta:
 * - la tarjeta Tutorial de Inicio se ve sólo con el aviso resuelto (mientras se consulta, tampoco: el lado seguro);
 * - la fila de Más → Ayuda espera, con su línea, mientras el aviso está pendiente (si no se sabe, por ejemplo al
 *   recargar en Más sin pasar por Inicio, no se traba);
 * - y el motor trata el aviso a la vista (`data-guia-espera`) como una ventana: la burbuja espera.
 *
 * Por cuenta y familia: el estado de otra sesión no vale para ésta.
 */
export type EstadoDelAvisoDeFotos = 'sin-saber' | 'pendiente' | 'resuelto';

let actual: { readonly dueno: string | null; readonly estado: EstadoDelAvisoDeFotos } = { dueno: null, estado: 'sin-saber' };
const oyentes = new Set<() => void>();

export function informarAvisoDeFotos(dueno: string, estado: EstadoDelAvisoDeFotos): void {
  if (actual.dueno === dueno && actual.estado === estado) return;
  actual = { dueno, estado };
  for (const oyente of [...oyentes]) oyente();
}

export function avisoDeFotos(dueno: string | null): EstadoDelAvisoDeFotos {
  return dueno !== null && actual.dueno === dueno ? actual.estado : 'sin-saber';
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** La clave de la sesión: cuenta y familia. */
export function duenoDelAviso(session: { readonly family_id: string; readonly principal_id: string } | null): string | null {
  return session ? `${session.family_id}:${session.principal_id}` : null;
}

/** Lo que informa `FriendAvatarNotice` en cada render. */
export function useInformarAvisoDeFotos(dueno: string | null, estado: EstadoDelAvisoDeFotos): void {
  useEffect(() => { if (dueno !== null) informarAvisoDeFotos(dueno, estado); }, [dueno, estado]);
}

/** Lo que leen la tarjeta y la fila de Ayuda, para la sesión actual. */
export function useAvisoDeFotos(): EstadoDelAvisoDeFotos {
  const { session } = useAuth();
  const dueno = duenoDelAviso(session);
  return useSyncExternalStore(suscribir, () => avisoDeFotos(dueno), () => 'sin-saber');
}

export function reiniciarAvisoDeFotosParaTests(): void {
  actual = { dueno: null, estado: 'sin-saber' };
  for (const oyente of [...oyentes]) oyente();
}
