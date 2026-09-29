import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { isCurrentSession, type StoredSession } from '../api/storage';
import {
  fechaDeCambio,
  normalizarUsername,
  publicarArrobaPropia,
  useArrobaPropia,
  useUsernameCapability,
  type EstadoUsername,
} from '../api/username';
import { mensajeAlGuardar } from './PuertaArroba';
import type { ResultadoParte } from './EditarPerfil';

/**
 * AF-USUARIO-ARROBA · decisión 93 (punto 4: «Sí, una vez cada 30 días») · el @
 * propio en Configuración: se ve, y se cambia si el dueño lo permite. El límite
 * lo decide el dueño (`next_change_at`, wire §4); la app sólo lo muestra.
 *
 * AF-ALTA-POPUP-D106 · decisión 106: sin la tarjeta «Tu @usuario»; el @ es la
 * línea debajo del nombre (decisión 104).
 *
 * AF-LAPIZ-UNICO · decisión 110 de Mati: «dejar solo un lápiz que conglomere la
 * foto, el nombre y el @». La línea del @ ya no tiene lápiz propio: el @ se
 * cambia en «Editar perfil» (`EditarPerfil.tsx`), con las mismas reglas de hoy
 * (formato, disponibilidad, «Puedes volver a cambiar tu @ desde …»). Acá queda
 * la lectura del @ y su guardado, UNA vez por pantalla (`useArrobaDeConfiguracion`),
 * y la línea que lo muestra.
 *
 * 🔴 Con `features.username` apagado no muestra nada ni pide nada.
 */

export interface ArrobaDeConfiguracion {
  /** Lo que va debajo del nombre; `null` si está apagado, sin elegir, reservado o sin leer. */
  readonly arroba: string | null;
  /** El @ actual si hoy se puede cambiar; `null` si no hay @ o está en período de espera. */
  readonly editable: string | null;
  /** «Puedes volver a cambiar tu @ desde el …» con la fecha del dueño, si está en espera. */
  readonly notaDeEspera: string | null;
  /** Guarda un @ nuevo. Nunca lanza: devuelve el resultado de esa parte. */
  readonly guardar: (valor: string) => Promise<ResultadoParte>;
}

export function useArrobaDeConfiguracion(session: StoredSession): ArrobaDeConfiguracion {
  const { enabled } = useUsernameCapability();
  const { t, idioma } = useIdioma();
  const [estado, setEstado] = useState<EstadoUsername | null>(null);

  // AF-USERNAME-D104 · una lectura del @, y el store la publica para quien más
  // la quiera. Lo que se ve sale de ahí: atado a la cuenta y sin los reservados.
  const principal = session.principal_id;
  const leido = estado?.username;
  useEffect(() => {
    if (enabled && leido !== undefined) publicarArrobaPropia(principal, leido);
  }, [enabled, principal, leido]);
  const arroba = useArrobaPropia(principal);

  useEffect(() => {
    if (!enabled) return;
    let vivo = true;
    api.getUsername(session)
      .then((e) => { if (vivo && isCurrentSession(session)) setEstado(e); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [enabled, session]);

  const guardar = useCallback(async (valor: string): Promise<ResultadoParte> => {
    try {
      const nuevo = await api.putUsername(normalizarUsername(valor), session);
      setEstado(nuevo);
      return { ok: true };
    } catch (err) {
      const { status, code, extra } = extractApiError(err);
      if (status === 409 && code === 'username_change_too_soon' && typeof extra.next_change_at === 'string'
          && !Number.isNaN(Date.parse(extra.next_change_at))) {
        // El dueño manda desde cuándo: se dice ESA fecha, no una calculada acá.
        const desde = extra.next_change_at;
        setEstado((previo) => (previo ? { ...previo, next_change_at: desde } : previo));
        // El cambio que lo impide pudo hacerse en otro lado: se relee el @ real.
        void api.getUsername(session)
          .then((real) => { if (isCurrentSession(session)) setEstado(real); })
          .catch(() => undefined);
        return { ok: false, error: t('Puedes volver a cambiar tu @ desde el {0}.', fechaDeCambio(desde, idioma)) };
      }
      return { ok: false, error: mensajeAlGuardar(err, t) };
    }
  }, [idioma, session, t]);

  if (!enabled) return { arroba: null, editable: null, notaDeEspera: null, guardar };
  const username = estado?.username ?? null;
  const proximo = estado?.next_change_at ?? null;
  return {
    arroba,
    editable: username !== null && proximo === null ? username : null,
    notaDeEspera: username !== null && proximo !== null
      ? t('Puedes volver a cambiar tu @ desde el {0}.', fechaDeCambio(proximo, idioma))
      : null,
    guardar,
  };
}

/** La línea del @ debajo del nombre (decisión 104). Sin lápiz: lo tiene «Editar perfil». */
export function ArrobaEnConfiguracion({ arroba }: { readonly arroba: string | null }) {
  // Apagado, sin elegir, reservado o todavía sin leer: nada (decisión 104).
  if (!arroba) return null;
  return (
    <div className="profile-arroba-bloque">
      <div className="profile-arroba-linea">
        <div className="profile-arroba">{arroba}</div>
      </div>
    </div>
  );
}
