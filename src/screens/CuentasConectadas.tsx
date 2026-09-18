import { useEffect, useReducer, useRef, useState, type FormEvent, type RefObject } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { renderGoogleIdentityButton, type GoogleButtonHandle } from '../api/googleIdentity';
import type { StoredSession } from '../api/storage';
import { useIdioma } from '../i18n/idioma';

/**
 * APP-LINK-ACCOUNT-AF-09-20260918 · «Cuentas conectadas» en Configuración.
 *
 * D-LOGIN-1, en la forma que Mati eligió el 2026-09-18: **«Vincular desde la
 * cuenta»**. La persona ya entró con su contraseña; desde acá vincula Google y
 * escribe esa contraseña UNA vez. Cero auto-link, y ningún visitante puede
 * averiguar si un email tiene cuenta, porque todo esto pasa detrás de SU sesión.
 *
 * ## Lo que decide el dueño, y lo que este archivo NO decide
 *
 * - El ESTADO sale de `GET /api/account/me/linked-providers` (v2.91.0). Sin ese
 *   dato no se afirma nada: el contrato dice, literal, que ante un 404 el
 *   consumidor «no puede afirmar ni negar una vinculación; no debe mostrarla
 *   como desvinculada». Por eso existe la fase `oculto`: no es un error, es la
 *   única respuesta honesta cuando no se sabe.
 * - Vincular es `POST /api/auth/google/link` con la sesión, y es idempotente
 *   PARA LA MISMA CUENTA: repetirlo sobre una cuenta ya vinculada devuelve 200
 *   `already_linked: true`. Eso es lo que hace seguro reintentar después de un
 *   fallo de red: si la vinculación ya había entrado, el reintento lo confirma.
 *
 * ## Cuándo el `id_token` sirve para reintentar, y cuándo no
 *
 * El dueño valida la contraseña ANTES de consumir el `id_token`
 * (`contract-mirror/services/externalIdentities.js`, `linkExternalIdentity`).
 * Entonces:
 *   · contraseña incorrecta (403) → el token sigue vivo: se reintenta SÓLO la
 *     contraseña, sin volver a elegir Google;
 *   · cualquier 401 del proveedor → el token pudo haberse consumido: se vuelve a
 *     elegir Google, con un botón nuevo (el handle de GIS es de un solo uso).
 */

// ─── Máquina de estados · pura, sin React, probada sin navegador ───────────────

export type ErrorVinculo = 'contrasena' | 'google' | 'red' | 'demasiados';
export type AvisoVinculo = 'recien' | 'ya_estaba';

export type EstadoCuentas =
  | { readonly fase: 'cargando' }
  /** 404 de un backend anterior o una forma inválida: no se afirma NADA. */
  | { readonly fase: 'oculto' }
  /** Falla transitoria al leer el estado: se puede reintentar. */
  | { readonly fase: 'error_carga' }
  | { readonly fase: 'vinculada'; readonly aviso: AvisoVinculo | null }
  | { readonly fase: 'no_vinculada' }
  /** El botón de Google está a la vista. */
  | { readonly fase: 'eligiendo'; readonly error: ErrorVinculo | null }
  /** Google ya devolvió su credencial; falta la contraseña de PayMe. */
  | { readonly fase: 'contrasena'; readonly idToken: string; readonly error: ErrorVinculo | null }
  | { readonly fase: 'enviando'; readonly idToken: string };

export type EventoCuentas =
  | { readonly tipo: 'cargada'; readonly vinculada: boolean }
  | { readonly tipo: 'carga_desconocida' }
  | { readonly tipo: 'carga_fallida' }
  | { readonly tipo: 'reintentar' }
  | { readonly tipo: 'empezar' }
  | { readonly tipo: 'credencial'; readonly idToken: string }
  | { readonly tipo: 'enviar' }
  | { readonly tipo: 'vinculo_ok'; readonly yaEstaba: boolean }
  | { readonly tipo: 'vinculo_error'; readonly clase: ErrorVinculo }
  | { readonly tipo: 'cancelar' };

export const ESTADO_INICIAL: EstadoCuentas = { fase: 'cargando' };

/**
 * Un evento que no corresponde a la fase actual se IGNORA y devuelve el mismo
 * estado. No es tolerancia: es lo que impide que una respuesta que llega tarde
 * —de una carga anterior, de un envío ya cancelado— pise lo que la persona está
 * viendo ahora.
 */
export function reducirCuentas(estado: EstadoCuentas, evento: EventoCuentas): EstadoCuentas {
  switch (evento.tipo) {
    case 'cargada':
      if (estado.fase !== 'cargando') return estado;
      return evento.vinculada ? { fase: 'vinculada', aviso: null } : { fase: 'no_vinculada' };
    case 'carga_desconocida':
      return estado.fase === 'cargando' ? { fase: 'oculto' } : estado;
    case 'carga_fallida':
      return estado.fase === 'cargando' ? { fase: 'error_carga' } : estado;
    case 'reintentar':
      return estado.fase === 'error_carga' ? { fase: 'cargando' } : estado;
    case 'empezar':
      return estado.fase === 'no_vinculada' ? { fase: 'eligiendo', error: null } : estado;
    case 'credencial':
      return estado.fase === 'eligiendo'
        ? { fase: 'contrasena', idToken: evento.idToken, error: null }
        : estado;
    case 'enviar':
      return estado.fase === 'contrasena' ? { fase: 'enviando', idToken: estado.idToken } : estado;
    case 'vinculo_ok':
      return estado.fase === 'enviando'
        ? { fase: 'vinculada', aviso: evento.yaEstaba ? 'ya_estaba' : 'recien' }
        : estado;
    case 'vinculo_error':
      if (estado.fase !== 'enviando') return estado;
      // 403 y 429 ocurren ANTES de consumir el token: se conserva y se reintenta
      // sólo la contraseña. Todo lo demás vuelve a elegir Google.
      if (evento.clase === 'contrasena' || evento.clase === 'demasiados') {
        return { fase: 'contrasena', idToken: estado.idToken, error: evento.clase };
      }
      return { fase: 'eligiendo', error: evento.clase };
    case 'cancelar':
      // 🔴 Cancelar SUELTA el `id_token`: la fase de destino no lo tiene. Mientras
      // se envía no se cancela —el botón está deshabilitado—, porque un envío en
      // vuelo puede terminar vinculando y la pantalla diría lo contrario.
      return estado.fase === 'eligiendo' || estado.fase === 'contrasena'
        ? { fase: 'no_vinculada' }
        : estado;
  }
}

/**
 * Traduce el error de la fachada a una de cuatro clases, SIN distinguir más de
 * lo que el dueño distingue. `social_auth_failed` 401 cubre a propósito cosas
 * muy distintas —vinculada a otra cuenta, revocada, token vencido o repetido—
 * y el mensaje tampoco las separa: separarlas le diría a alguien que esa cuenta
 * de Google ya está en PayMe con otro dueño.
 */
export function claseDeErrorDeVinculo(err: unknown): ErrorVinculo {
  const { code, status } = extractApiError(err);
  if (status === 403 && code === 'reauthentication_failed') return 'contrasena';
  if (status === 429) return 'demasiados';
  if ((status === 401 && code === 'social_auth_failed') || status === 400) return 'google';
  return 'red';
}

/** ¿El 404 de la lectura significa «backend anterior a v2.91.0»? El contrato sólo declara 401. */
export function esEstadoDesconocido(err: unknown): boolean {
  if (err instanceof Error && err.message === 'linked_providers_response_malformed') return true;
  return extractApiError(err).status === 404;
}

// ─── Vista · pura: el mismo estado produce siempre el mismo marcado ─────────────

/**
 * 🔴 UN `t('…')` LITERAL POR CASO, y no `t(TABLA[error])`.
 *
 * El extractor de `traduccion.test.ts` sólo ve comilla simple pegada al
 * paréntesis. Una tabla de módulo traducida con `t(TABLA[k])` le pasa un
 * identificador: sus textos quedan fuera del inventario, nada avisa y la
 * pantalla en inglés sale en español. El repo lo tolera con un contador fijo
 * (`T_SIN_LITERAL`) y una cobertura por familia; acá no hace falta ninguna de
 * las dos cosas, porque la clase directamente no se crea.
 */
function textoDeError(error: ErrorVinculo, t: (texto: string) => string): string {
  switch (error) {
    case 'contrasena': return t('La contraseña no es correcta.');
    case 'google': return t('No pudimos vincular esa cuenta de Google. Inténtalo de nuevo.');
    case 'red': return t('No pudimos conectar. Prueba de nuevo.');
    case 'demasiados': return t('Demasiados intentos. Espera un minuto.');
  }
}

export interface CuentasConectadasVistaProps {
  readonly estado: EstadoCuentas;
  readonly password: string;
  readonly googleRef?: RefObject<HTMLDivElement>;
  readonly onPassword?: (value: string) => void;
  readonly onEmpezar?: () => void;
  readonly onEnviar?: (e: FormEvent) => void;
  readonly onCancelar?: () => void;
  readonly onReintentar?: () => void;
}

export function CuentasConectadasVista({
  estado,
  password,
  googleRef,
  onPassword,
  onEmpezar,
  onEnviar,
  onCancelar,
  onReintentar,
}: CuentasConectadasVistaProps) {
  const { t } = useIdioma();
  if (estado.fase === 'oculto') return null;

  const vinculada = estado.fase === 'vinculada';
  const enFlujo = estado.fase === 'eligiendo' || estado.fase === 'contrasena' || estado.fase === 'enviando';
  const enviando = estado.fase === 'enviando';
  const error = estado.fase === 'eligiendo' || estado.fase === 'contrasena' ? estado.error : null;

  return (
    <section className="card config-card cuentas-conectadas" aria-labelledby="cuentas-conectadas-titulo">
      <h2 id="cuentas-conectadas-titulo" className="cuentas-conectadas-titulo">
        {t('Cuentas conectadas')}
      </h2>

      {estado.fase === 'cargando' && (
        <div className="cuentas-conectadas-nota" role="status">{t('Cargando…')}</div>
      )}

      {estado.fase === 'error_carga' && (
        <div className="cuentas-conectadas-error" role="alert">
          <span>{t('No pudimos cargar tus cuentas conectadas.')}</span>
          <button type="button" className="login-toggle" onClick={onReintentar}>
            {t('Reintentar')}
          </button>
        </div>
      )}

      {(vinculada || estado.fase === 'no_vinculada' || enFlujo) && (
        <div className="cuentas-conectadas-fila">
          <span className="cuentas-conectadas-logo" aria-hidden="true" />
          <div className="cuentas-conectadas-proveedor">
            <div className="cuentas-conectadas-nombre">Google</div>
            {/* El estado va en TEXTO, no sólo en color: el sistema no deja que
                el color sea el único portador de significado. */}
            <div className={vinculada ? 'cuentas-conectadas-estado is-ok' : 'cuentas-conectadas-estado'}>
              {vinculada ? t('Vinculada') : t('No vinculada')}
            </div>
          </div>
          {estado.fase === 'no_vinculada' && (
            <button type="button" className="btn btn-navy cuentas-conectadas-accion" onClick={onEmpezar}>
              {t('Vincular Google')}
            </button>
          )}
        </div>
      )}

      {vinculada && estado.aviso && (
        <div className="cuentas-conectadas-ok" role="status">
          {estado.aviso === 'recien'
            ? t('Listo: ya puedes entrar con Google.')
            : t('Esta cuenta de Google ya estaba vinculada.')}
        </div>
      )}

      {estado.fase === 'eligiendo' && (
        <div className="cuentas-conectadas-paso">
          <p className="cuentas-conectadas-explica">
            {t('Elige tu cuenta de Google. Después te pedimos tu contraseña de PayMe una sola vez.')}
          </p>
          {error && <div className="ingreso-error" role="alert">{textoDeError(error, t)}</div>}
          {/* El botón lo dibuja Google Identity Services en el riel real, igual
              que en el ingreso: PayMe sólo pone el contenedor. */}
          <div
            ref={googleRef}
            className="social-google-container"
            role="group"
            aria-label={t('Continuar con Google')}
          />
          <button type="button" className="login-toggle cuentas-conectadas-cancelar" onClick={onCancelar}>
            {t('Cancelar')}
          </button>
        </div>
      )}

      {(estado.fase === 'contrasena' || enviando) && (
        <form className="cuentas-conectadas-paso" onSubmit={onEnviar}>
          <p className="cuentas-conectadas-explica">
            {t('Para vincularla, escribe tu contraseña de PayMe. Así confirmamos que las dos cuentas son tuyas.')}
          </p>
          {/* Misma anatomía que el ingreso rediseñado: etiqueta fija arriba,
              campo de 48 px, halo de foco. La contraseña vive sólo en memoria de
              este componente y se suelta al cancelar, al vincular y al salir. */}
          <label className="ingreso-campo">
            <span className="ingreso-etiqueta">{t('Contraseña')}</span>
            <input
              className="input ingreso-input"
              type="password"
              placeholder={t('Tu contraseña')}
              autoComplete="current-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => onPassword?.(e.target.value)}
              aria-invalid={error === 'contrasena'}
              aria-describedby={error ? 'cuentas-conectadas-error' : undefined}
              disabled={enviando}
              required
            />
          </label>
          {/* 🔴 NAVY y no el naranja del ingreso. `--brand` tiene cuatro usos
              reservados por el sistema —el «Entrar» del ingreso es el cuarto, el
              CTA de primer contacto— y un botón dentro de Configuración no es
              ninguno de los cuatro. */}
          <button type="submit" className="btn btn-navy cuentas-conectadas-enviar" disabled={enviando}>
            {enviando ? t('Un segundo…') : t('Vincular')}
          </button>
          {/* Debajo del botón, igual que en el ingreso (§5 del paquete del 10/09):
              una sola forma de pedir una contraseña en toda la app. */}
          {error && (
            <div id="cuentas-conectadas-error" className="ingreso-error" role="alert">
              {textoDeError(error, t)}
            </div>
          )}
          <button
            type="button"
            className="login-toggle cuentas-conectadas-cancelar"
            onClick={onCancelar}
            disabled={enviando}
          >
            {t('Cancelar')}
          </button>
        </form>
      )}
    </section>
  );
}

// ─── Contenedor · efectos, red y el botón de Google ──────────────────────────────

export interface CuentasConectadasProps {
  /** `social.google.linking` del dueño. Apagado ⇒ esta sección NO existe. */
  readonly linking: boolean;
  readonly webClientId: string | null;
  readonly session: StoredSession;
}

export function CuentasConectadas({ linking, webClientId, session }: CuentasConectadasProps) {
  // La capability se lee ANTES de cualquier hook con efecto: apagada, no se
  // monta nada, no se pide nada y no se carga GIS.
  if (!linking || webClientId === null) return null;
  return <CuentasConectadasActiva webClientId={webClientId} session={session} />;
}

function CuentasConectadasActiva({ webClientId, session }: { webClientId: string; session: StoredSession }) {
  const { t, idioma } = useIdioma();
  const [estado, despachar] = useReducer(reducirCuentas, ESTADO_INICIAL);
  const [password, setPassword] = useState('');
  const [generacionGoogle, setGeneracionGoogle] = useState(0);
  const googleRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GoogleButtonHandle | null>(null);

  // Lectura del estado real. Se repite al reintentar (fase → `cargando`).
  const cargando = estado.fase === 'cargando';
  useEffect(() => {
    if (!cargando) return;
    let vivo = true;
    api.getLinkedProviders(session)
      .then((lista) => { if (vivo) despachar({ tipo: 'cargada', vinculada: lista.includes('google') }); })
      .catch((err) => {
        if (!vivo) return;
        despachar(esEstadoDesconocido(err) ? { tipo: 'carga_desconocida' } : { tipo: 'carga_fallida' });
      });
    return () => { vivo = false; };
  }, [cargando, session]);

  // La contraseña no sobrevive a su paso: se suelta en cuanto la fase deja de
  // pedirla —vinculó, canceló o volvió a elegir Google—.
  const pideContrasena = estado.fase === 'contrasena' || estado.fase === 'enviando';
  useEffect(() => {
    if (!pideContrasena) setPassword('');
  }, [pideContrasena]);

  // El botón de GIS existe sólo en `eligiendo`. Cada error que vuelve acá monta
  // una generación nueva: el handle es de un solo uso.
  const eligiendo = estado.fase === 'eligiendo';
  useEffect(() => {
    handleRef.current?.dispose();
    handleRef.current = null;
    const contenedor = googleRef.current;
    if (!eligiendo || !contenedor) return;
    let handle: GoogleButtonHandle;
    try {
      handle = renderGoogleIdentityButton({
        container: contenedor,
        clientId: webClientId,
        locale: idioma === 'en' ? 'en' : 'es',
        mockLabel: t('Continuar con Google'),
        onCredential: (idToken) => despachar({ tipo: 'credencial', idToken }),
      });
    } catch {
      despachar({ tipo: 'cancelar' });
      return;
    }
    handleRef.current = handle;
    return () => {
      handle.dispose();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [eligiendo, generacionGoogle, webClientId, idioma, t]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (estado.fase !== 'contrasena') return;
    const idToken = estado.idToken;
    despachar({ tipo: 'enviar' });
    try {
      const { alreadyLinked } = await api.googleLink({ id_token: idToken, current_password: password }, session);
      despachar({ tipo: 'vinculo_ok', yaEstaba: alreadyLinked });
    } catch (err) {
      const clase = claseDeErrorDeVinculo(err);
      despachar({ tipo: 'vinculo_error', clase });
      if (clase !== 'contrasena' && clase !== 'demasiados') setGeneracionGoogle((g) => g + 1);
    }
  }

  return (
    <CuentasConectadasVista
      estado={estado}
      password={password}
      googleRef={googleRef}
      onPassword={setPassword}
      onEmpezar={() => despachar({ tipo: 'empezar' })}
      onEnviar={(e) => { void enviar(e); }}
      onCancelar={() => despachar({ tipo: 'cancelar' })}
      onReintentar={() => despachar({ tipo: 'reintentar' })}
    />
  );
}
