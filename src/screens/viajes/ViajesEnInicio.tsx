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
            <button
              type="button"
              className="viaje-burbuja"
              aria-label={etiquetaDeLaBurbuja(v.nombre, cents, t)}
              onClick={() => navigate('viaje', v.id)}
            >
              <InsigniaDelViaje nombre={v.nombre} color={v.color} foto={v.has_photo ? fotoDe(v.id) : null} burbuja />
              <span className="viaje-burbuja-texto">
                <span className="viaje-burbuja-nombre">{v.nombre}</span>
                <span className={`viaje-burbuja-monto viaje-burbuja-monto--${monto.tono}`}>{monto.texto}</span>
              </span>
            </button>
            {/* D280 · «+ Gasto» (Claude Design, opción 3b): 8 px debajo de la burbuja, a la derecha y afuera de ella;
                abre la Carga manual de ese viaje. Sólo con el viaje abierto: esperando pagos ya no se carga nada. */}
            {v.estado === 'abierto' && (
              <button
                type="button"
                className="viaje-gasto"
                aria-label={t('Cargar gasto en {0}', v.nombre)}
                onClick={() => navigate('viaje-gasto', v.id)}
              >
                <Icon name="plus" size={18} />
                <span>{t('Gasto')}</span>
              </button>
            )}
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
