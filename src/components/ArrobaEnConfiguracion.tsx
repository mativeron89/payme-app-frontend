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
  useUsernameCapability,
  type EstadoUsername,
} from '../api/username';
import { CampoArroba, mensajeAlGuardar } from './PuertaArroba';
import { Icon } from './Icon';

/**
 * AF-USUARIO-ARROBA · decisión 93 (punto 4: «Sí, una vez cada 30 días») · el @
 * propio en Configuración: se ve, y se cambia si el dueño lo permite. El límite
 * lo decide el dueño (`next_change_at`, wire §4); la app sólo lo muestra.
 *
 * 🔴 Con `features.username` apagado no renderiza nada ni pide nada.
 */
export function ArrobaEnConfiguracion({ session }: { readonly session: StoredSession }) {
  const { enabled } = useUsernameCapability();
  if (!enabled) return null;
  return <FilaArroba session={session} />;
}

function FilaArroba({ session }: { readonly session: StoredSession }) {
  const { t, idioma } = useIdioma();
  const [estado, setEstado] = useState<EstadoUsername | null>(null);
  const [fallo, setFallo] = useState(false);
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // AF-USERNAME-D104 · el mismo @ que se ve acá va debajo del nombre, en la
  // cabecera de Configuración (`ProfileIdentityEditor`): una lectura, dos lugares.
  const principal = session.principal_id;
  const leido = estado?.username;
  useEffect(() => {
    if (leido !== undefined) publicarArrobaPropia(principal, leido);
  }, [principal, leido]);

  useEffect(() => {
    let vivo = true;
    setFallo(false);
    api.getUsername(session)
      .then((e) => { if (vivo && isCurrentSession(session)) setEstado(e); })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [session]);

  const proximo = estado?.next_change_at ?? null;
  const puedeCambiar = estado !== null && estado.username !== null && proximo === null;
  const valido = problemaDeFormato(normalizarUsername(valor)) === 'ok';

  async function guardar() {
    if (busy || !estado) return;
    setBusy(true);
    setError(null);
    try {
      const nuevo = await api.putUsername(normalizarUsername(valor), session);
      setEstado(nuevo);
      setEditando(false);
      setAviso(nuevo.username ? t('Listo, tu @ ahora es @{0}.', nuevo.username) : null);
    } catch (err) {
      const { status, code, extra } = extractApiError(err);
      if (status === 409 && code === 'username_change_too_soon' && typeof extra.next_change_at === 'string'
          && !Number.isNaN(Date.parse(extra.next_change_at))) {
        // El dueño manda desde cuándo: se muestra ESA fecha, no una calculada
        // acá, en la nota de siempre (una sola vez, no además como error).
        setEstado({ ...estado, next_change_at: extra.next_change_at });
        setEditando(false);
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

  return (
    <div className="card config-card arroba-config" style={{ marginBottom: 12 }}>
      <div className="list-row" style={{ cursor: 'default' }}>
        <span><Icon name="users" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>{t('Tu @usuario')}</div>
          <div className="caption arroba-propio">
            {estado?.username
              ? `@${estado.username}`
              : fallo ? t('No pudimos cargar tu @.') : estado ? t('Todavía no elegiste tu @.') : t('Cargando…')}
          </div>
        </div>
        {puedeCambiar && !editando && (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-fit"
            onClick={() => { setValor(estado?.username ?? ''); setError(null); setAviso(null); setEditando(true); }}
          >
            {t('Cambiar')}
          </button>
        )}
      </div>
      {aviso && !editando && <div className="arroba-nota" role="status">{aviso}</div>}
      {proximo !== null && !editando && (
        <div className="arroba-nota" role="status">
          {t('Puedes volver a cambiar tu @ desde el {0}.', fechaDeCambio(proximo, idioma))}
        </div>
      )}
      {editando && (
        <form
          className="arroba-edicion"
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
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setEditando(false); setError(null); }}>
              {t('Cancelar')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !valido}>
              {busy ? t('Un segundo…') : t('Guardar')}
            </button>
          </div>
        </form>
      )}
      {error && <div className="ingreso-error arroba-error-guardar" role="alert">{error}</div>}
    </div>
  );
}
