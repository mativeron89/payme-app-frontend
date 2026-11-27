import { api } from '../api';
import { currentSamePrincipalSession } from '../api/profileIdentity';
import { loadSession, type StoredSession } from '../api/storage';
import type { LegalTextPair } from '../api/types';

export const finalidades = ['foto_perfil_no_amigos', 'analisis_interno'] as const;
export type Finalidad = typeof finalidades[number];
export type Estado = 'never' | 'revoked' | 'granted';
export type Eleccion = Partial<Record<Finalidad, boolean>>;
export interface EleccionDeAlta {
  elecciones: Eleccion;
  aviso: LegalTextPair;
}

export function avisoDeFallo(t: (texto: string) => string) {
  return t('Tus términos quedaron aceptados. Revisa los cambios en Mis permisos.');
}

export async function leerEstado(f: Finalidad, session: StoredSession): Promise<Estado> {
  const permiso = f === 'analisis_interno'
    ? await api.getConsentimiento(f, session)
    : await api.getFotoPerfilNoAmigos(session);
  return permiso.state;
}

/** Un estado ausente nunca se interpreta como un consentimiento nuevo. */
export async function aplicarEleccion(session: StoredSession, elecciones: Eleccion,
  anteriores: Partial<Record<Finalidad, Estado>>, par: LegalTextPair): Promise<boolean> {
  const resultados = await Promise.allSettled(finalidades.map(async (f) => {
    const previo = anteriores[f];
    const marcado = elecciones[f];
    if (previo === undefined || marcado === undefined || marcado === (previo === 'granted')) return;
    let vigente = currentSamePrincipalSession(session, loadSession());
    if (!vigente) throw new Error('session_expired');
    if (!marcado) {
      if (f === 'analisis_interno') await api.revokeConsentimiento(f, vigente);
      else await api.revokeFotoPerfilNoAmigos(vigente);
      return;
    }
    const aviso = (await api.getPrivacyNotice()).legal_text;
    if (aviso.version !== par.version || aviso.hash !== par.hash) throw new Error('legal_version_mismatch');
    vigente = currentSamePrincipalSession(session, loadSession());
    if (!vigente) throw new Error('session_expired');
    if (f === 'analisis_interno') await api.grantConsentimiento(f, aviso, vigente);
    else await api.grantFotoPerfilNoAmigos(aviso, vigente);
  }));
  return resultados.every(r => r.status === 'fulfilled');
}
