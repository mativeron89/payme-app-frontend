import { useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { isCurrentSession, type StoredSession } from '../api/storage';
import {
  fechaDeCambio,
  normalizarUsername,
  problemaDeFormato,
  publicarArrobaPropia,
  useArrobaPropia,
  useUsernameCapability,
  type EstadoUsername,
} from '../api/username';
import { CampoArroba, mensajeAlGuardar } from './PuertaArroba';
import { Icon } from './Icon';
import { useToast } from './ui';

/**
 * AF-USUARIO-ARROBA · decisión 93 (punto 4: «Sí, una vez cada 30 días») · el @
 * propio en Configuración: se ve, y se cambia si el dueño lo permite. El límite
 * lo decide el dueño (`next_change_at`, wire §4); la app sólo lo muestra.
 *
 * AF-ALTA-POPUP-D106 · decisión 106 de Mati: se saca la tarjeta «Tu @usuario»
 * con su «Puedes volver a cambiar…». Es la línea del @ debajo del nombre
 * (decisión 104) con un lápiz, como el del nombre. El lápiz abre el
 * cambio o, si todavía no se puede, dice desde cuándo; la fecha ya no queda
 * escrita a la vista.
 *
 * 🔴 Con `features.username` apagado no renderiza nada ni pide nada.
 */
export function ArrobaEnConfiguracion({ session }: { readonly session: StoredSession }) {
  const { enabled } = useUsernameCapability();
  if (!enabled) return null;
  return <LineaArroba session={session} />;
}

function LineaArroba({ session }: { readonly session: StoredSession }) {
  const { t, idioma } = useIdioma();
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoUsername | null>(null);
  const [editando, setEditando] = useState(false);
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AF-USERNAME-D104 · una lectura del @, y el store la publica para quien más
  // la quiera. Lo que se ve sale de ahí: atado a la cuenta y sin los reservados.
  const principal = session.principal_id;
  const leido = estado?.username;
  useEffect(() => {
    if (leido !== undefined) publicarArrobaPropia(principal, leido);
  }, [principal, leido]);
  const arroba = useArrobaPropia(principal);

  useEffect(() => {
    let vivo = true;
    api.getUsername(session)
      .then((e) => { if (vivo && isCurrentSession(session)) setEstado(e); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [session]);

  const proximo = estado?.next_change_at ?? null;
  const valido = problemaDeFormato(normalizarUsername(valor)) === 'ok';

  function alTocarLapiz() {
    if (!estado?.username) return;
    setError(null);
    if (proximo !== null) {
      setMostrarFecha(true);
      return;
    }
    setValor(estado.username);
    setMostrarFecha(false);
    setEditando(true);
  }

  async function guardar() {
    if (busy || !estado) return;
    setBusy(true);
    setError(null);
    try {
      const nuevo = await api.putUsername(normalizarUsername(valor), session);
      setEstado(nuevo);
      setEditando(false);
      if (nuevo.username) toast(t('Listo, tu @ ahora es @{0}.', nuevo.username));
    } catch (err) {
      const { status, code, extra } = extractApiError(err);
      if (status === 409 && code === 'username_change_too_soon' && typeof extra.next_change_at === 'string'
          && !Number.isNaN(Date.parse(extra.next_change_at))) {
        // El dueño manda desde cuándo: se dice ESA fecha, no una calculada acá.
        setEstado({ ...estado, next_change_at: extra.next_change_at });
        setEditando(false);
        setMostrarFecha(true);
        // El cambio que lo impide pudo hacerse en otro lado: se relee el @ real.
        void api.getUsername(session)
          .then((real) => { if (isCurrentSession(session)) setEstado(real); })
          .catch(() => undefined);
      } else {
        setError(mensajeAlGuardar(err, t));
      }
    } finally {
      setBusy(false);
    }
  }

  // Apagado, sin elegir, reservado o todavía sin leer: nada (decisión 104).
  if (!arroba) return null;

  return (
    <div className="profile-arroba-bloque">
      <div className="profile-arroba-linea">
        <div className="profile-arroba">{arroba}</div>
        {estado?.username && !editando && (
          <button
            type="button"
            className="profile-name-edit profile-arroba-edit"
            onClick={alTocarLapiz}
            aria-label={t('Cambiar tu @')}
          >
            <Icon name="pencil" size={15} />
          </button>
        )}
      </div>
      {mostrarFecha && proximo !== null && !editando && (
        <div className="arroba-nota" role="status">
          {t('Puedes volver a cambiar tu @ desde el {0}.', fechaDeCambio(proximo, idioma))}
        </div>
      )}
      {editando && (
        <form
          className="arroba-edicion profile-arroba-editor"
          onSubmit={(e) => { e.preventDefault(); if (valido && !busy) void guardar(); }}
        >
          <CampoArroba
            id="config-arroba-campo"
            etiqueta={t('Nuevo @usuario')}
            valor={valor}
            disabled={busy}
            onCambio={(v) => { setError(null); setValor(v); }}
          />
          <div className="arroba-nota">{t('Después vas a tener que esperar 30 días para volver a cambiarlo.')}</div>
          <div className="arroba-acciones">
            <button type="button" className="btn btn-ghost btn-fit" disabled={busy} onClick={() => { setEditando(false); setError(null); }}>
              {t('Cancelar')}
            </button>
            <button type="submit" className="btn btn-navy btn-fit" disabled={busy || !valido}>
              {busy ? t('Un segundo…') : t('Guardar')}
            </button>
          </div>
        </form>
      )}
      {error && <div className="ingreso-error arroba-error-guardar" role="alert">{error}</div>}
    </div>
  );
}
