import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import type { StoredSession } from '../api/storage';
import {
  leerUnaVez, recordarPermisoDeSugerencias, useCapacidadesOpcionales, type CapacidadOpcional,
  type ConsentimientosOpcionales, type EstadoDeConsentimiento, type FinalidadOpcional,
} from '../api/sugerencias';
import { useIdioma } from '../i18n/idioma';
import { PATH_PRIVACIDAD } from '../public/publicRoute';
import { ERROR_CAMBIO, ERROR_LECTURA, fotoHabilitada, useControlFoto, type EstadoPrivacidadFoto } from './PrivacidadFotoPanel';

/**
 * Configuración › Privacidad.
 *
 * D499 b5 · arriba, la fila simple «Mostrar mi foto a personas que no son mis amigos» (D457), con la lógica que D468
 * conservó (`useControlFoto`) y sin el bloque grande que Mati quitó. Cumple el Aviso 3.1.0: se revoca «desde la
 * configuración de privacidad». Revocar no depende del Aviso vigente (D463); activar exige la capacidad y el Aviso
 * 3.1.0 verificado. Sin la finalidad en el servidor (404), no hay fila.
 *
 * n420 · las dos filas de los permisos opcionales, con los textos que aprobó Mati, literales:
 * - D415 · «Sugerencias para dividir»;
 * - D426 · «Análisis interno de PayMe», debajo de la anterior.
 * Cada una aparece con su capacidad encendida (D403/D417). Activar no es optimista (el interruptor se enciende recién
 * con el 201) y revocar nunca se bloquea.
 *
 * O1 (auditoría de PR102) · con la capacidad anunciada pero apagada (`{supported: true, enabled: false}`, lo que sirve
 * producción hoy), la fila aparece SÓLO para revocar si la persona tiene el permiso otorgado, como la foto (D463): el
 * contrato deja leer el estado con `enabled: false` para revocar grants previos. Sin el permiso, no se ve, como antes.
 * Para saberlo se lee la lista `GET /api/account/consents` UNA vez por sección (auditoría de PR103, punto 4 b): trae
 * sólo lo que hoy se puede otorgar o lo que está otorgado. Sin la capacidad anunciada, ningún pedido.
 */
/** Key por cuenta: ninguna respuesta ni elección de otra sesión se reutiliza (como `PrivacidadFotoPanel`). */
export function SeccionPrivacidad({ session }: { readonly session: StoredSession }) {
  return <Seccion key={`${session.family_id}:${session.principal_id}`} session={session} />;
}

function Seccion({ session }: { readonly session: StoredSession }) {
  const foto = useControlFoto(session, false);
  const capacidades = useCapacidadesOpcionales();
  const lista = useListaDeConsentimientos(session, capacidades.sugerencias !== null || capacidades.analisis_interno !== null);
  const sugerencias = useFilaOpcional('sugerencias', session, capacidades.sugerencias, lista);
  const analisis = useFilaOpcional('analisis_interno', session, capacidades.analisis_interno, lista);
  // La fila aparece con el estado ya leído: si no, se pintaría mientras consulta y desaparecería con un 404 (un
  // servidor sin la finalidad), y la pantalla saltaría.
  const leyendo = foto.estado.ocupado && foto.estado.permiso === null && foto.estado.error === null;
  return (
    <SeccionPrivacidadView
      foto={foto.noSoportado || leyendo ? null : { estado: foto.estado, onCambiar: foto.cambiar, onConsultar: foto.consultar }}
      sugerencias={sugerencias}
      analisis={analisis}
    />
  );
}

export function SeccionPrivacidadView({ foto, sugerencias, analisis }: {
  readonly foto: { readonly estado: EstadoPrivacidadFoto; readonly onCambiar: () => void; readonly onConsultar: () => void } | null;
  readonly sugerencias: JSX.Element | null;
  readonly analisis: JSX.Element | null;
}) {
  const { t } = useIdioma();
  if (!foto && !sugerencias && !analisis) return null;
  return (
    <section className="card config-card privacidad-seccion" aria-labelledby="privacidad-titulo">
      <h2 id="privacidad-titulo" className="privacidad-titulo">{t('Privacidad')}</h2>
      {foto && <FilaFotoView estado={foto.estado} onCambiar={foto.onCambiar} onConsultar={foto.onConsultar} />}
      {sugerencias}
      {analisis}
    </section>
  );
}

/** D499 b5 · la fila simple de la foto: título, una línea, el enlace al Aviso y el interruptor. */
export function FilaFotoView({ estado, onCambiar, onConsultar }: {
  readonly estado: EstadoPrivacidadFoto;
  readonly onCambiar: () => void;
  readonly onConsultar: () => void;
}) {
  const { t } = useIdioma();
  const { permiso, ocupado, error } = estado;
  const habilitado = fotoHabilitada(estado, false);
  const nota = error === ERROR_LECTURA ? t('No pudimos confirmar el estado del permiso. Puedes consultar de nuevo.')
    : error === ERROR_CAMBIO ? t('No se confirmó el cambio. Consulta el estado antes de volver a intentarlo.')
      : error ? t('No recibimos la confirmación del cambio. El estado mostrado corresponde a una nueva consulta.')
        : !ocupado && permiso && !permiso.granted && !habilitado ? t('Este permiso no está disponible para activarlo en este momento.')
          : null;
  return (
    <div className="list-row privacidad-fila" style={{ cursor: 'default' }} aria-busy={ocupado}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div id="privacidad-foto-titulo" style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>
          {t('Mostrar mi foto a personas que no son mis amigos')}
        </div>
        <div id="privacidad-foto-texto" className="caption">
          {t('Permite que otros usuarios vean tu foto en búsquedas, invitaciones y cuando compartas mesas o viajes. Tus amigos podrán seguir viéndola si lo desactivas.')}
        </div>
        <a className="caption privacidad-enlace" href={PATH_PRIVACIDAD} target="_blank" rel="noreferrer">
          {t('Más en el Aviso de Privacidad.')}
        </a>
        {nota && <div className="caption privacidad-mensaje" role={error ? 'alert' : 'status'}>{nota}</div>}
        {error && (
          <button type="button" className="btn btn-ghost btn-sm privacidad-consultar" disabled={ocupado} onClick={onConsultar}>
            {t('Consultar estado')}
          </button>
        )}
      </div>
      <input
        type="checkbox"
        role="switch"
        className="notif-switch"
        aria-labelledby="privacidad-foto-titulo"
        aria-describedby="privacidad-foto-texto"
        checked={permiso?.granted === true}
        disabled={!habilitado}
        onChange={onCambiar}
      />
    </div>
  );
}

/** Los estados de la fila de D415 (propuesta 9ffd3bdb…), que D426 reusa. */
export type MensajeDeFila = 'no_elegible' | 'por_ahora' | 'no_se_guardo';

/** El mensaje de un rechazo del dueño (`account-consents-v1`): nunca dice «menor» ni «edad». */
export function mensajeDeRechazo(err: unknown): MensajeDeFila {
  // La capacidad se apagó entre la lectura y el gesto (revalidación local de la fachada).
  if (err instanceof Error && err.message === 'consent_grant_unavailable') return 'por_ahora';
  const { status } = extractApiError(err);
  if (status === 403) return 'no_elegible';
  if (status === 409) return 'por_ahora';
  return 'no_se_guardo';
}

export function FilaPermisoOpcionalView({ finalidad, estado, ocupado, mensaje, onCambiar, soloRevocar = false }: {
  readonly finalidad: FinalidadOpcional;
  /** O1 · con la capacidad apagada: el interruptor sólo apaga; nunca otorga. */
  readonly soloRevocar?: boolean;
  readonly estado: EstadoDeConsentimiento | null;
  readonly ocupado: boolean;
  readonly mensaje: MensajeDeFila | null;
  readonly onCambiar: (activar: boolean) => void;
}) {
  const { t } = useIdioma();
  // Los textos aprobados, literales: D415 y D426.
  const titulo = finalidad === 'sugerencias' ? t('Sugerencias para dividir') : t('Análisis interno de PayMe');
  const texto = finalidad === 'sugerencias'
    ? t('PayMe te sugiere cómo dividir según las mesas que abriste. Sólo lo ves tú.')
    : t('Opcional. PayMe analiza, sin tu nombre, cómo se consume en las mesas. No llega a restaurantes ni a otros usuarios. Puedes apagarlo.');
  const aviso = mensaje === 'no_elegible' ? t('Esta opción no está disponible para tu cuenta.')
    : mensaje === 'por_ahora' ? t('Por ahora no está disponible. Prueba de nuevo más tarde.')
      : mensaje === 'no_se_guardo' ? t('No se pudo guardar') : null;
  const id = `privacidad-${finalidad}`;
  return (
    <div className="list-row privacidad-fila" style={{ cursor: 'default' }} aria-busy={ocupado}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div id={`${id}-titulo`} style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>{titulo}</div>
        <div id={`${id}-texto`} className="caption">{texto}</div>
        <a className="caption privacidad-enlace" href={PATH_PRIVACIDAD} target="_blank" rel="noreferrer">
          {t('Más en el Aviso de Privacidad.')}
        </a>
        {aviso && <div className="caption privacidad-mensaje" role="status">{aviso}</div>}
      </div>
      <input
        type="checkbox"
        role="switch"
        className="notif-switch"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-texto`}
        checked={estado?.granted === true}
        disabled={ocupado || estado === null || (soloRevocar && !estado.granted)}
        onChange={(e) => { if (!soloRevocar || !e.target.checked) onCambiar(e.target.checked); }}
      />
    </div>
  );
}

export type ModoDeFilaOpcional = 'oculta' | 'normal' | 'solo_revocar';

/**
 * O1 · cómo se muestra una fila opcional:
 * - sin la capacidad anunciada: oculta (y no se lee nada);
 * - encendida: normal;
 * - apagada: oculta hasta leer el estado; con el permiso otorgado, sólo para revocar; sin él, oculta. Una fila que ya
 *   se mostró en esta pantalla sigue (apagada y sin poder activarse) después de revocar, para que no desaparezca bajo
 *   el dedo.
 */
export function modoDeFilaOpcional(capacidad: CapacidadOpcional | null, estado: EstadoDeConsentimiento | null,
  leido: boolean, yaVisible: boolean): ModoDeFilaOpcional {
  if (capacidad === null) return 'oculta';
  if (capacidad.enabled) return 'normal';
  if (!leido) return 'oculta';
  return estado?.granted === true || yaVisible ? 'solo_revocar' : 'oculta';
}

interface ListaLeida {
  readonly leida: boolean;
  readonly error: boolean;
  readonly estados: ConsentimientosOpcionales;
}
const SIN_LEER: ListaLeida = { leida: false, error: false, estados: {} };

/** O1 · la lista de la sección: un pedido, con single-flight por cuenta (`leerUnaVez`). Sin capacidad anunciada, nada. */
function useListaDeConsentimientos(session: StoredSession, anunciadas: boolean): ListaLeida {
  const [lista, setLista] = useState<ListaLeida>(SIN_LEER);
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const cuenta = `${session.family_id}:${session.principal_id}`;
  useEffect(() => {
    let vigente = true;
    setLista(SIN_LEER);
    if (!anunciadas) return () => { vigente = false; };
    leerUnaVez(cuenta, () => api.getConsentimientosOpcionales(sesionRef.current)).then(
      (estados) => {
        if (!vigente) return;
        setLista({ leida: true, error: false, estados });
        const s = estados.sugerencias;
        if (s) recordarPermisoDeSugerencias(s.granted);
      },
      () => { if (vigente) setLista({ leida: true, error: true, estados: {} }); },
    );
    return () => { vigente = false; };
  }, [cuenta, anunciadas]);
  return lista;
}

function useFilaOpcional(finalidad: FinalidadOpcional, session: StoredSession, capacidad: CapacidadOpcional | null,
  lista: ListaLeida): JSX.Element | null {
  // Lo que cambió en esta pantalla (activar o revocar) manda sobre lo leído.
  const [cambiado, setCambiado] = useState<EstadoDeConsentimiento | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensajeDelCambio, setMensajeDelCambio] = useState<MensajeDeFila | null>(null);
  const epoca = useRef(0);
  const yaVisible = useRef(false);
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const cuenta = `${session.family_id}:${session.principal_id}`;

  useEffect(() => {
    epoca.current += 1;
    setCambiado(null);
    setOcupado(false);
    setMensajeDelCambio(null);
    yaVisible.current = false;
  }, [finalidad, cuenta]);

  // Ausente de una lista bien leída: nunca otorgado (la lista sólo trae lo otorgable o lo otorgado).
  const leido: EstadoDeConsentimiento | null = !lista.leida || lista.error ? null
    : lista.estados[finalidad] ?? { purpose_key: finalidad, granted: false, state: 'never' };
  const estado = cambiado ?? leido;
  const modo = modoDeFilaOpcional(capacidad, estado, lista.leida, yaVisible.current);
  if (modo !== 'oculta') yaVisible.current = true;
  const soloRevocar = modo === 'solo_revocar';
  // Ante la duda, apagado y deshabilitado: nunca «activado».
  const mensaje = mensajeDelCambio ?? (lista.error ? 'por_ahora' : null);

  async function cambiar(activar: boolean) {
    if (ocupado || !lista.leida || estado === null || (activar && soloRevocar)) return;
    const marca = ++epoca.current;
    setOcupado(true);
    setMensajeDelCambio(null);
    try {
      const s = sesionRef.current;
      const nuevo = activar
        ? await api.grantConsentimiento(finalidad, (await api.getPrivacyNotice()).legal_text, s)
        : await api.revokeConsentimiento(finalidad, s);
      if (marca !== epoca.current) return;
      setCambiado(nuevo);
      if (finalidad === 'sugerencias') recordarPermisoDeSugerencias(nuevo.granted);
    } catch (err) {
      if (marca === epoca.current) setMensajeDelCambio(mensajeDeRechazo(err));
    } finally {
      if (marca === epoca.current) setOcupado(false);
    }
  }

  // Con la capacidad apagada, un error de lectura no muestra una fila: no hay nada que revocar que se sepa.
  if (modo === 'oculta' || (soloRevocar && estado === null)) return null;
  return <FilaPermisoOpcionalView finalidad={finalidad} estado={estado} ocupado={ocupado || !lista.leida} mensaje={mensaje}
    soloRevocar={soloRevocar} onCambiar={(activar) => { void cambiar(activar); }} />;
}
