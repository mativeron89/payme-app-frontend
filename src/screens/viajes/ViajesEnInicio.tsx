import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DetalleViaje, TipoLugar, ViajeEnLista } from '../../api/viajes';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { InsigniaDelViaje, useFotosDeViajes } from './InsigniaDelViaje';
import { etiquetaTipoLugar, parametroDeTicket, type T } from './viajesView';
import './viajes.css';
import './inicio.css';

/**
 * D265 · cada viaje abierto, en Inicio, como una burbuja propia. D275 · con el diseño de Claude Design
 * (`PANTALLA-burbuja-del-viaje.md`, §1): sólo la foto (o la inicial sobre el color del viaje), el nombre y el monto.
 *
 * - Salieron «Tu viaje abierto», «Te deben» y «Ver viaje →»: toda la burbuja es el botón y el color del monto dice la
 *   dirección (verde si te deben, el del texto en cero, rojo con «−» si debes). Supersede, para la burbuja, el texto de
 *   D267: el monto con su color es la posición.
 * - Un viaje que espera pagos se ve igual que uno abierto, con su monto (Mati eligió «Igual que abierto»). Nunca «saldo».
 */
export type TonoDelMonto = 'a-favor' | 'deuda' | 'cero';

/** El monto de la burbuja: `formatMXN` (centavos sólo si los hay) y, si debes, el signo menos tipográfico (U+2212). */
export function montoDeLaBurbuja(cents: number): { readonly tono: TonoDelMonto; readonly texto: string } {
  if (cents < 0) return { tono: 'deuda', texto: `\u2212${formatMXN(-cents)}` };
  return { tono: cents > 0 ? 'a-favor' : 'cero', texto: formatMXN(cents) };
}

/**
 * D291 · el monto, opción 3a: Plus Jakarta Sans 26/600. Con el cuadrado «+ Gasto» al lado, a 320 un monto grande no entra
 * en una línea a 26. Adenda del Bibliotecario (2026-10-12T03:09:12Z, opción a): el monto nunca se parte, nunca se corta y
 * nunca se mete en el padding; si a 26 no entra, baja sólo lo necesario, hasta 16 como mínimo. El cuadrado y la foto no
 * cambian.
 */
export const MONTO_PX = 26;
export const MONTO_MINIMO_PX = 16;

/** El tamaño con el que un texto que a 26 mide `necesario` entra en `disponible` (la medida escala con la letra). */
export function tamanoDelMonto(disponible: number, necesario: number): number {
  if (!(disponible > 0) || !(necesario > disponible)) return MONTO_PX;
  return Math.max(MONTO_MINIMO_PX, Math.floor(((MONTO_PX * disponible) / necesario) * 10) / 10);
}

// En el navegador se mide antes de pintar (sin un cuadro con el monto desbordado); en el servidor no hay nada que medir.
const useEfectoDeMedida = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * El monto en una sola línea (`white-space: nowrap`). Se mide al montar, al cambiar el ancho de su columna y cuando
 * terminan de cargar las fuentes (antes, el ancho es el de la letra de reemplazo).
 */
function MontoDeLaBurbuja({ tono, texto }: { readonly tono: TonoDelMonto; readonly texto: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEfectoDeMedida(() => {
    const el = ref.current;
    if (!el) return undefined;
    let vivo = true;
    let medido = -1;
    const medir = (siempre: boolean) => {
      if (!vivo) return;
      const disponible = el.clientWidth;
      // Cambiar la letra cambia el alto, no el ancho: el observador vuelve a avisar y acá se corta.
      if (!siempre && disponible === medido) return;
      medido = disponible;
      el.style.fontSize = '';
      let tam = tamanoDelMonto(disponible, el.scrollWidth);
      // La proporción es casi exacta; si por redondeo todavía no entra, se baja de a medio píxel.
      for (let vuelta = 0; vuelta < 20; vuelta += 1) {
        el.style.fontSize = tam === MONTO_PX ? '' : `${tam}px`;
        if (el.scrollWidth <= el.clientWidth || tam <= MONTO_MINIMO_PX) break;
        tam = Math.max(MONTO_MINIMO_PX, tam - 0.5);
      }
    };
    medir(true);
    void document.fonts?.ready.then(() => medir(true));
    if (typeof ResizeObserver === 'undefined') {
      const alCambiar = () => medir(false);
      window.addEventListener('resize', alCambiar);
      return () => { vivo = false; window.removeEventListener('resize', alCambiar); };
    }
    const ro = new ResizeObserver(() => medir(false));
    ro.observe(el);
    return () => { vivo = false; ro.disconnect(); };
  }, [texto]);
  return <span ref={ref} className={`viaje-burbuja-monto viaje-burbuja-monto--${tono}`}>{texto}</span>;
}

/** Lo que oye el lector de pantalla: «Holbox, te deben $10,565.68», «Holbox, debes $542», «Holbox, estás al día». */
export function etiquetaDeLaBurbuja(nombre: string, cents: number, t: T): string {
  if (cents < 0) return t('{0}, debes {1}', nombre, formatMXN(-cents));
  if (cents > 0) return t('{0}, te deben {1}', nombre, formatMXN(cents));
  return t('{0}, estás al día', nombre);
}

/**
 * D271 · un ticket del viaje con gente por elegir. Mati: «la burbuja del restaurante tiene que figurar en inicio también
 * para facilitar la carga», la ven «Todos, hasta que elijan todos», y va «debajo de la burbuja del viaje, pero separada».
 * Se guarda el dato del dueño, sin traducir: el caché no depende del idioma.
 */
export interface RestaurantePendiente {
  readonly ticket_id: string;
  readonly lugar: string | null;
  readonly tipo_lugar: TipoLugar;
  /** Cuántos del ticket no tocaron «Listo» (`falta_que_elija`). */
  readonly faltan: number;
}

/** Por viaje (su id), sus restaurantes pendientes. Un viaje que no se pudo preguntar no está. */
export type PendientesDeViajes = Readonly<Record<string, readonly RestaurantePendiente[]>>;

/**
 * Los tickets de un viaje ABIERTO en los que alguien todavía no eligió, en el orden del dueño (del más reciente al más
 * viejo). Sólo los escaneados que se eligen por lo que pidió cada uno (`forma: 'consumo'`): los gastos a mano se reparten
 * entre los presentes y nunca esperan a nadie. Se lee `falta_que_elija` y no `sin_repartir`: el dueño deja afuera de
 * `sin_repartir` un ticket con todos los platos asignados en el que alguien no tocó «Listo», y D271 dice «hasta que
 * elijan todos» (adenda del Bibliotecario, 2026-10-11).
 */
export function restaurantesPendientes(viaje: DetalleViaje): readonly RestaurantePendiente[] {
  if (viaje.estado !== 'abierto') return [];
  return viaje.tickets
    .filter((tk) => tk.forma === 'consumo' && tk.origen === 'escaneo' && tk.falta_que_elija > 0)
    .map((tk) => ({ ticket_id: tk.id, lugar: tk.lugar, tipo_lugar: tk.tipo_lugar, faltan: tk.falta_que_elija }));
}

/**
 * D275 §3 · ¿hay algún restaurante pendiente (D271) en los viajes abiertos de Inicio? Lo pide el aviso «No tienes mesas
 * abiertas»: «Con alguna mesa abierta, el aviso no aparece (ver 1g)». En el prototipo de Claude Design,
 * `noMesas = !trips.some(t => t.pending.length)`. Mati lo vio en su iPhone: Holbox con «LAS HAMACAS · Falta 1 por elegir»
 * y el aviso igual.
 *
 * - `true`: alguno de los que se leyeron tiene un pendiente. Alcanza aunque otro viaje no se haya podido leer.
 * - `false`: se leyeron todos y ninguno tiene. También sin viajes abiertos.
 * - `null`: todavía no se sabe. La lista o un detalle no llegó, o falló. Como con las mesas: no se afirma «no tienes» sin
 *   haber leído.
 */
export function hayRestaurantesPendientes(
  viajes: readonly Pick<ViajeEnLista, 'id' | 'estado'>[] | null,
  pendientes: PendientesDeViajes | null,
  fallaron: boolean,
): boolean | null {
  if (fallaron || viajes === null) return null;
  // Sólo los abiertos tienen pendientes (`restaurantesPendientes`): esperando pagos no espera a nadie.
  const abiertos = viajes.filter((v) => v.estado === 'abierto');
  // Sólo lo leído de ESE viaje: una clave propia (un id como «constructor» no lee el prototipo de los objetos).
  const leido = (id: string) => (pendientes !== null && Object.prototype.hasOwnProperty.call(pendientes, id) ? pendientes[id]! : null);
  if (abiertos.some((v) => (leido(v.id)?.length ?? 0) > 0)) return true;
  if (abiertos.length === 0) return false;
  if (abiertos.some((v) => leido(v.id) === null)) return null;
  return false;
}

/** «Faltan N por elegir»; con uno, «Falta 1 por elegir». */
export function textoDeFaltan(n: number, t: T): string {
  return n === 1 ? t('Falta 1 por elegir') : t('Faltan {0} por elegir', n);
}

/** Lo que oye el lector de pantalla: «La Parolaccia, faltan 2 por elegir». */
export function etiquetaDelPendiente(lugar: string, n: number, t: T): string {
  return n === 1 ? t('{0}, falta 1 por elegir', lugar) : t('{0}, faltan {1} por elegir', lugar, n);
}

/** Las burbujas, con las fotos de los viajes que tienen. */
export function ViajesAbiertosEnInicio({ viajes, pendientes, fallo, onReintentar }: {
  viajes: readonly ViajeEnLista[] | null;
  pendientes: PendientesDeViajes | null;
  fallo: boolean;
  onReintentar: () => void;
}) {
  const { fotoDe } = useFotosDeViajes(viajes);
  return <ViajesAbiertosVista viajes={viajes} pendientes={pendientes} fallo={fallo} onReintentar={onReintentar} fotoDe={fotoDe} />;
}

/** La vista pura. Cargando o sin viajes abiertos: nada. Sin poder preguntar: el error con «Reintentar». */
export function ViajesAbiertosVista({ viajes, pendientes = null, fallo, onReintentar, fotoDe = () => null }: {
  viajes: readonly ViajeEnLista[] | null;
  pendientes?: PendientesDeViajes | null;
  fallo: boolean;
  onReintentar: () => void;
  fotoDe?: (viajeId: string) => string | null;
}) {
  const { t } = useIdioma();
  if (fallo) {
    return (
      <section className="home-viajes" aria-label={t('Tus viajes abiertos')}>
        <div className="state-error">
          <div className="state-error-row">
            <Icon name="x-circle" size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="state-error-title">{t('No pudimos cargar tus viajes')}</div>
              <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
            {t('Reintentar')}
          </button>
        </div>
      </section>
    );
  }
  if (!viajes || viajes.length === 0) return null;
  return (
    <section className="home-viajes" aria-label={t('Tus viajes abiertos')}>
      {viajes.map((v) => {
        const cents = v.mi_balance_cents ?? 0;
        const monto = montoDeLaBurbuja(cents);
        return (
          <div key={v.id} className="viaje-grupo">
            {/* D291 · «+ Gasto», opción 2a (`PANTALLA-burbuja-del-viaje.md` §1 bis): unido a la burbuja, a la derecha, en
                la misma tarjeta y separado por un divisor. Son dos `<button>` hermanos, nunca uno dentro del otro: la
                zona del viaje entra al viaje y el cuadrado abre la Carga manual. Sólo con el viaje abierto; esperando
                pagos ya no se carga nada y la burbuja ocupa todo el ancho. */}
            <div className="viaje-tarjeta">
              <button
                type="button"
                className="viaje-burbuja"
                aria-label={etiquetaDeLaBurbuja(v.nombre, cents, t)}
                onClick={() => navigate('viaje', v.id)}
              >
                <InsigniaDelViaje nombre={v.nombre} color={v.color} foto={v.has_photo ? fotoDe(v.id) : null} burbuja />
                <span className="viaje-burbuja-texto">
                  <span className="viaje-burbuja-nombre">{v.nombre}</span>
                  <MontoDeLaBurbuja tono={monto.tono} texto={monto.texto} />
                </span>
              </button>
              {v.estado === 'abierto' && (
                <>
                  <span className="viaje-tarjeta-divisor" aria-hidden="true" />
                  <button
                    type="button"
                    className="viaje-gasto"
                    aria-label={t('Cargar un gasto a mano en {0}', v.nombre)}
                    onClick={() => navigate('viaje-gasto', v.id)}
                  >
                    <Icon name="plus" size={22} />
                    <span>{t('Gasto')}</span>
                  </button>
                </>
              )}
            </div>
            {(pendientes?.[v.id] ?? []).map((p) => {
              const lugar = p.lugar ?? etiquetaTipoLugar(p.tipo_lugar, t);
              return (
                <button
                  key={p.ticket_id}
                  type="button"
                  className="viaje-pendiente"
                  aria-label={etiquetaDelPendiente(lugar, p.faltan, t)}
                  onClick={() => navigate('viaje-ticket', parametroDeTicket(v.id, p.ticket_id))}
                >
                  <span className="viaje-pendiente-ico" aria-hidden="true">
                    <Icon name="cubiertos" size={20} />
                  </span>
                  <span className="viaje-pendiente-texto">
                    <span className="viaje-pendiente-nombre">{lugar}</span>
                    <span className="viaje-pendiente-faltan">{textoDeFaltan(p.faltan, t)}</span>
                  </span>
                  <span className="viaje-pendiente-ir" aria-hidden="true">
                    <Icon name="chevron-right" size={18} />
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
