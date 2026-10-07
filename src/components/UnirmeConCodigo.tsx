import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import {
  CIFRAS_DEL_CODIGO,
  codigoDeLasCeldas,
  guardarSolicitud,
  leerSolicitud,
  olvidarSolicitud,
  PREFIJO_DEL_CODIGO,
  venceEn,
  vencio,
  type SolicitudPropia,
} from '../api/joinRequests';
import { loadSession } from '../api/storage';
import { useIdioma } from '../i18n/idioma';
import { navigate } from '../router';
import { Icon } from './Icon';
import { useToast } from './ui';

/**
 * D219 · D223 · «Unirme con código», para quien quiere sumarse a una mesa sin
 * tener el link. Sólo en Mesas (D223-3), arriba del historial, como una fila
 * que se abre EN EL LUGAR (turno 2 · 2.1–2.8). Todos los estados viven adentro:
 * el campo, enviando, código equivocado, demasiados intentos, la espera y «no
 * se pudo». Aceptado entra directo a la mesa (turno 1 · 7).
 *
 * - **El código:** «PA-» fijo y cinco números (X01). Las cinco celdas son UN
 *   solo `<input inputmode="numeric">` dibujado en celdas: se puede pegar el
 *   código entero, el cero inicial se conserva (PA-01234) y el campo tiene su
 *   nombre accesible.
 * - **Quien pide no ve nada de la mesa** hasta que lo aceptan (D219): de la
 *   espera sólo el código que escribió (X04), el estado y el vencimiento, que
 *   sale de `expires_at` (X03). Los decoders rechazan cualquier clave de más.
 * - **La respuesta:** se consulta `GET /api/join-requests/:id` cada 10 s
 *   mientras la espera está a la vista, al volver a la app y cuando el contador
 *   llega a cero (C, aprobado). Nunca en segundo plano. El contador es
 *   orientativo: en cero consulta, no decide.
 * - **Sin optimismo:** cancelar no afirma nada antes del 200; con 409 decide un
 *   GET (A19). Una respuesta de otra cuenta u otro pedido no se aplica (P09).
 * - **En el teléfono** sólo `{cuenta, id, código}` (X06), para retomar la espera
 *   si se recarga la app. No hay endpoint de «mis solicitudes».
 */

/** Cada cuánto se consulta la espera, a la vista (C · el mismo de la mesa). */
export const CONSULTA_DE_LA_ESPERA_MS = 10_000;

type ErrorDelCampo = 'codigo' | 'limite' | 'reintento';

type Estado =
  | { readonly paso: 'campo'; readonly error: ErrorDelCampo | null }
  | { readonly paso: 'enviando' }
  | {
    readonly paso: 'esperando';
    readonly id: string;
    readonly codigo: string;
    readonly expiresAt: string | null;
    readonly cancelando: boolean;
    readonly reintento: boolean;
  }
  | { readonly paso: 'no_se_pudo' };

const CAMPO_VACIO: Estado = { paso: 'campo', error: null };

export function UnirmeConCodigo() {
  const { t } = useIdioma();
  const toast = useToast();
  const regionId = useId();
  const campoId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [cifras, setCifras] = useState('');
  const [estado, setEstado] = useState<Estado>(CAMPO_VACIO);
  const [enfocado, setEnfocado] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const enVueloRef = useRef(false);
  const consultandoRef = useRef(false);
  /**
   * La generación vigente: cambia al cancelar, al empezar otro pedido y al
   * volver al campo. Una respuesta de una generación vieja, o que llega con la
   * pantalla ya desmontada, no toca nada. (Desmontar no cambia la generación:
   * StrictMode desmonta y vuelve a montar, y la consulta en vuelo tiene que
   * valer para el segundo montaje.)
   */
  const generacionRef = useRef(0);
  const montadoRef = useRef(false);
  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);
  const vigente = (generacion: number) => montadoRef.current && generacion === generacionRef.current;

  /** La cuenta con sesión ahora. Sin sesión, nada se guarda ni se retoma. */
  const cuentaActual = () => loadSession()?.principal_id ?? null;

  const volverAlCampo = useCallback((error: ErrorDelCampo | null) => {
    generacionRef.current += 1;
    setCifras('');
    setEstado({ paso: 'campo', error });
  }, []);

  const terminarEspera = useCallback((s: SolicitudPropia, cuenta: string | null) => {
    if (s.status === 'pending') {
      setEstado((e) => (e.paso === 'esperando' && e.id === s.id ? { ...e, expiresAt: s.expiresAt, reintento: false } : e));
      return;
    }
    olvidarSolicitud();
    if (s.status === 'accepted') {
      // P09 · la aceptación es de la cuenta que pidió: con otra, no se entra.
      if (cuenta === null || cuenta !== cuentaActual()) return;
      toast(t('Te aceptaron. Ya estás en la mesa.'), { sobreLaBarra: true });
      navigate('mesa', s.mesaCode);
      return;
    }
    generacionRef.current += 1;
    if (s.status === 'cancelled') {
      setCifras('');
      setEstado(CAMPO_VACIO);
      return;
    }
    // rejected o expired: el mismo «no se pudo», sin motivo (P10).
    setEstado({ paso: 'no_se_pudo' });
  }, [t, toast]);

  /** Una consulta del estado. Una a la vez; la de otra generación se descarta. */
  const consultar = useCallback(async (id: string) => {
    if (consultandoRef.current) return;
    consultandoRef.current = true;
    const generacion = generacionRef.current;
    const cuenta = cuentaActual();
    try {
      const s = await api.getJoinRequest(id);
      if (!vigente(generacion)) return;
      terminarEspera(s, cuenta);
    } catch (err) {
      if (!vigente(generacion)) return;
      const { status } = extractApiError(err);
      if (status === 404 || status === 400) {
        // El pedido no existe para esta cuenta (P07): no se infiere ningún final.
        olvidarSolicitud();
        volverAlCampo('reintento');
        return;
      }
      // Sin red, error del servidor o respuesta mal formada (P08): la espera
      // sigue y se avisa; la próxima consulta lo vuelve a intentar.
      setEstado((e) => (e.paso === 'esperando' && e.id === id ? { ...e, reintento: true } : e));
    } finally {
      consultandoRef.current = false;
    }
  }, [terminarEspera, volverAlCampo]);

  // X06 · al abrir Mesas, la espera guardada de ESTA cuenta se retoma (una vez).
  const retomadaRef = useRef(false);
  useEffect(() => {
    if (retomadaRef.current) return;
    retomadaRef.current = true;
    const cuenta = cuentaActual();
    if (!cuenta) return;
    const guardada = leerSolicitud(cuenta);
    if (!guardada) return;
    setAbierto(true);
    setEstado({ paso: 'esperando', id: guardada.id, codigo: guardada.codigo, expiresAt: null, cancelando: false, reintento: false });
    void consultar(guardada.id);
  }, [consultar]);

  const esperandoId = estado.paso === 'esperando' ? estado.id : null;
  const expiresAt = estado.paso === 'esperando' ? estado.expiresAt : null;

  // C · cada 10 s a la vista, al volver a la app, y el contador cada segundo.
  useEffect(() => {
    if (!esperandoId) return undefined;
    const aLaVista = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const cadaTanto = setInterval(() => { if (aLaVista()) void consultar(esperandoId); }, CONSULTA_DE_LA_ESPERA_MS);
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    const alVolver = () => { if (aLaVista()) void consultar(esperandoId); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(cadaTanto);
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [esperandoId, consultar]);

  // En cero, una consulta: el contador no decide nada.
  const vencida = expiresAt !== null && vencio(expiresAt, ahora);
  useEffect(() => {
    if (esperandoId && vencida) void consultar(esperandoId);
  }, [esperandoId, vencida, consultar]);

  async function solicitar() {
    const codigo = codigoDeLasCeldas(cifras);
    if (!codigo || enVueloRef.current) return;
    enVueloRef.current = true;
    generacionRef.current += 1;
    const generacion = generacionRef.current;
    const cuenta = cuentaActual();
    setEstado({ paso: 'enviando' });
    input.current?.blur();
    try {
      const r = await api.requestJoin(codigo);
      if (!vigente(generacion)) return;
      if (r.kind === 'ya_adentro') {
        // Ya está en la mesa: entra directo, sin pedido ni aviso (A12).
        setEstado(CAMPO_VACIO);
        setCifras('');
        navigate('mesa', r.mesaCode);
        return;
      }
      if (cuenta) guardarSolicitud({ cuenta, id: r.id, codigo });
      setEstado({ paso: 'esperando', id: r.id, codigo, expiresAt: r.expiresAt, cancelando: false, reintento: false });
      setAhora(Date.now());
    } catch (err) {
      if (!vigente(generacion)) return;
      const { status, code } = extractApiError(err);
      if (status === 404 || code === 'join_code_invalid') setEstado({ paso: 'campo', error: 'codigo' });
      else if (status === 429) setEstado({ paso: 'campo', error: 'limite' });
      else if (code === 'join_request_not_allowed' || code === 'join_requests_full') setEstado({ paso: 'no_se_pudo' });
      // Sin red, cuenta suspendida, error o respuesta mal formada: ningún
      // resultado inventado (A23, A24).
      else setEstado({ paso: 'campo', error: 'reintento' });
    } finally {
      enVueloRef.current = false;
    }
  }

  async function cancelar() {
    if (estado.paso !== 'esperando' || estado.cancelando) return;
    const { id } = estado;
    const generacion = generacionRef.current;
    setEstado({ ...estado, cancelando: true });
    try {
      await api.cancelJoinRequest(id);
      if (!vigente(generacion)) return;
      olvidarSolicitud();
      volverAlCampo(null);
    } catch (err) {
      if (!vigente(generacion)) return;
      const { status } = extractApiError(err);
      setEstado((e) => (e.paso === 'esperando' && e.id === id ? { ...e, cancelando: false } : e));
      if (status === 409) {
        // Ganó la otra decisión (A19): manda lo que diga el estado.
        void consultar(id);
      } else if (status === 410) {
        olvidarSolicitud();
        generacionRef.current += 1;
        setEstado({ paso: 'no_se_pudo' });
      } else if (status === 404 || status === 400) {
        olvidarSolicitud();
        volverAlCampo('reintento');
      } else {
        setEstado((e) => (e.paso === 'esperando' && e.id === id ? { ...e, reintento: true } : e));
      }
    }
  }

  const bloqueado = estado.paso === 'campo' && estado.error === 'limite';
  const conError = estado.paso === 'campo' && estado.error === 'codigo';
  const completo = cifras.length === CIFRAS_DEL_CODIGO;

  return (
    <section className={`card unirse${abierto ? ' unirse--abierto' : ''}`}>
      <button
        type="button"
        className="unirse-cabecera"
        aria-expanded={abierto}
        aria-controls={regionId}
        onClick={() => setAbierto((a) => !a)}
      >
        <span className="unirse-numeral" aria-hidden="true">#</span>
        <span className="unirse-titulo">{t('Unirme con código')}</span>
        <Icon name="chevron-down" size={20} className={`unirse-flecha${abierto ? ' open' : ''}`} />
      </button>
      <div id={regionId} className="unirse-cuerpo" hidden={!abierto}>
        {(estado.paso === 'campo' || estado.paso === 'enviando') && (
          <>
            <label className="unirse-guia" htmlFor={campoId}>{t('Escribe el código de la mesa')}</label>
            <div className={`unirse-campo${conError ? ' unirse-campo--error' : ''}${bloqueado ? ' unirse-campo--bloqueado' : ''}`}>
              <span className="unirse-prefijo" aria-hidden="true">{PREFIJO_DEL_CODIGO}</span>
              <div className="unirse-celdas">
                {Array.from({ length: CIFRAS_DEL_CODIGO }, (_, i) => (
                  <span
                    key={i}
                    className={`unirse-celda${enfocado && estado.paso === 'campo' && !bloqueado && i === Math.min(cifras.length, CIFRAS_DEL_CODIGO - 1) ? ' unirse-celda--activa' : ''}`}
                    aria-hidden="true"
                  >
                    {cifras[i] ?? ''}
                  </span>
                ))}
                <input
                  ref={input}
                  id={campoId}
                  className="unirse-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={12}
                  value={cifras}
                  disabled={bloqueado || estado.paso === 'enviando'}
                  aria-invalid={conError || undefined}
                  aria-describedby={estado.paso === 'campo' && estado.error ? errorId : undefined}
                  onFocus={() => setEnfocado(true)}
                  onBlur={() => setEnfocado(false)}
                  onChange={(e) => {
                    const solo = e.target.value.replace(/\D/g, '').slice(0, CIFRAS_DEL_CODIGO);
                    setCifras(solo);
                    // El error del código se borra al editar (2.5); el límite, no.
                    if (estado.paso === 'campo' && estado.error && estado.error !== 'limite') {
                      setEstado(CAMPO_VACIO);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && completo && !conError) void solicitar();
                  }}
                />
              </div>
            </div>
            {estado.paso === 'campo' && estado.error === 'codigo' && (
              <p id={errorId} className="unirse-error" role="alert">
                <Icon name="x-circle" size={16} />
                <span>{t('No encontramos una mesa abierta con ese código. Revísalo.')}</span>
              </p>
            )}
            {estado.paso === 'campo' && estado.error === 'limite' && (
              <p id={errorId} className="unirse-aviso" role="alert">
                <Icon name="warning" size={16} />
                <span>{t('Hiciste muchos intentos. Prueba de nuevo en un rato.')}</span>
              </p>
            )}
            {estado.paso === 'campo' && estado.error === 'reintento' && (
              <p id={errorId} className="unirse-aviso" role="alert">
                <Icon name="info" size={16} />
                <span>{t('No pudimos confirmar el resultado. Intenta de nuevo.')}</span>
              </p>
            )}
            <button
              type="button"
              className="unirse-solicitar"
              disabled={!completo || conError || bloqueado || estado.paso === 'enviando'}
              onClick={() => { void solicitar(); }}
            >
              {estado.paso === 'enviando'
                ? (<><span className="spinner unirse-spinner" aria-hidden="true" />{t('Enviando…')}</>)
                : t('Solicitar unirme')}
            </button>
          </>
        )}
        {estado.paso === 'esperando' && (
          <div className="unirse-espera" aria-live="polite">
            <div className="unirse-espera-codigo">
              <span className="unirse-espera-rotulo">{t('Código')}</span>
              <strong>{estado.codigo}</strong>
            </div>
            <span className="unirse-pildora">{t('Esperando respuesta')}</span>
            {estado.expiresAt !== null && (
              <p className="unirse-vence">{t('Vence en {0}', venceEn(estado.expiresAt, ahora))}</p>
            )}
            <p className="unirse-texto">{t('Listo, le avisamos a quien abrió la mesa. Cuando te acepte, entras directo.')}</p>
            {estado.reintento && (
              <p className="unirse-aviso" role="status">
                <Icon name="info" size={16} />
                <span>{t('No pudimos confirmar el resultado. Intenta de nuevo.')}</span>
              </p>
            )}
            <button
              type="button"
              className="unirse-cancelar"
              disabled={estado.cancelando}
              onClick={() => { void cancelar(); }}
            >
              {t('Cancelar')}
            </button>
          </div>
        )}
        {estado.paso === 'no_se_pudo' && (
          <div className="unirse-no-se-pudo" role="status">
            <p className="unirse-texto">{t('No pudimos unirte a esa mesa. Pídele a quien la abrió que te comparta el link.')}</p>
            <button type="button" className="unirse-otro" onClick={() => volverAlCampo(null)}>
              {t('Escribir otro código')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
