import { useRef } from 'react';
import type { TuMesa } from '../api/misMesas';
import type { EstadoDeFoto } from '../api/fotosDeTickets';
import { useIdioma } from '../i18n/idioma';
import { AppHeaderBack } from '../components/AppHeader';
import { FilaDeTitulo } from '../components/TarjetaDeTitulo';
import { Icon } from '../components/Icon';
import { FilaDeLaFotoDelTicket } from '../components/VisorDelTicket';
import { formatMXN } from '../utils/format';
import { nombreDePlato } from '../utils/nombreDePlato';
import { personalDateLabel } from '../utils/personalDates';
import { estadoDeTuMesa, type EstadoTuMesa } from '../utils/labels';
import { agruparPropios } from './agruparIguales';
import { bpsLabel } from './mesaItemsView';

type T = (s: string, ...a: unknown[]) => string;

/**
 * D481 · 3b · la pantalla del ticket de una mesa cerrada, en Mesas (paquete de
 * Claude Design de la foto del ticket; Mati aceptó las ocho recomendaciones).
 * Reemplaza a la fila desplegable de D360-P09: tocar una fila de Mesas abre
 * esta pantalla; Volver regresa a la lista en la misma posición.
 *
 * Todo sale del `TuMesa` ya cargado: sin pedidos nuevos.
 * - Tarjeta de título con el nombre, «fecha · estado» y, con foto, la fila de
 *   la foto (abre el visor con ese solo ticket, «Foto del ticket»).
 * - «Lo que elegiste» con las filas de sólo lectura: la cantidad («2 ×») y la
 *   porción («½») antes del nombre, sin píldora. En «partes iguales», sin nada
 *   elegido o sin conteo, el texto de siempre y sin filas.
 * - Pie fijo: «Elegiste» y el monto (sin el total del ticket) y «Ver detalle
 *   digital» (D481 · 1), que abre el detalle digital con retorno de foco.
 * - Sin «Quién eligió» (D481 · 6): el detalle de la mesa no trae a las personas.
 */

/** AF-24 · el texto de cómo terminó cada mesa, con un `t('…')` literal por caso. */
export function textoEstadoTuMesa(e: EstadoTuMesa, t: T): string {
  switch (e) {
    case 'sin_cobro': return t('Cerró sin cobro');
    case 'pagada': return t('Pagada');
    case 'vencio': return t('Venció');
    case 'cancelada': return t('Cancelada');
    case 'cerrada': return t('Cerrada');
  }
}

/**
 * AF-24 · «Elegiste N ítems · $X». Es lo que eligió ESTA cuenta, no lo que se
 * cobró. En `igual` se eligen PARTES, y así se dice.
 */
export function textoEleccion(m: TuMesa, t: T): string | null {
  if (m.itemsCount === null) return null;
  if (m.itemsCount === 0) return t('No elegiste ítems');
  // En «igual» se eligen PARTES; con la selección informativa (F-3), PLATOS.
  const partes = m.divisionMode === 'igual' && !m.eleccionInformativa;
  const que = m.itemsCount === 1
    ? (partes ? t('Elegiste 1 parte') : t('Elegiste 1 ítem'))
    : (partes ? t('Elegiste {0} partes', m.itemsCount) : t('Elegiste {0} ítems', m.itemsCount));
  return m.amountCents === null ? que : `${que} · ${formatMXN(m.amountCents)}`;
}

/**
 * D481 · 2 · el monto de la fila y del pie: lo que eligió esta cuenta. Sin
 * consumos elegidos (o sin un monto del dueño), `null`: se muestra «—» en gris,
 * nunca un «$0» que no se sabe.
 */
export function montoDeTuMesa(m: TuMesa): string | null {
  if (m.itemsCount === 0 || m.itemsCount === null || m.amountCents === null) return null;
  return formatMXN(m.amountCents);
}

/** «11 oct · Cerró sin cobro»: el subtítulo de la pantalla y la primera línea del visor. */
export function subtituloDeTuMesa(m: TuMesa, locale: string, t: T, zona: string | null): string {
  return [
    m.createdAt ? personalDateLabel(m.createdAt, locale, zona, t) : null,
    textoEstadoTuMesa(estadoDeTuMesa(m), t),
  ].filter((x): x is string => x !== null).join(' · ');
}

export interface FilaElegida {
  readonly clave: string;
  /** «2 ×», o `null` si es uno. */
  readonly cantidad: string | null;
  /** «½», o `null` si es entero (entero no se dice). */
  readonly porcion: string | null;
  readonly nombre: string;
  readonly montoCents: number;
}

/**
 * D481 · 3b · las filas de «Lo que elegiste», o `null` si no van filas (partes
 * iguales, nada elegido, o el dueño no mandó el detalle): entonces va el texto
 * de siempre. Los iguales, juntos (D240 punto 16).
 */
export function filasDeLoQueElegiste(m: TuMesa): FilaElegida[] | null {
  if (m.divisionMode !== 'consumo' || m.items === null || m.items.length === 0) return null;
  return agruparPropios(m.items).map((g) => ({
    clave: g.key,
    cantidad: g.cantidad > 1 ? `${g.cantidad} ×` : null,
    porcion: g.primero.fractionBps < 10000 ? bpsLabel(g.primero.fractionBps) : null,
    nombre: nombreDePlato(g.primero.name),
    montoCents: g.montoCents ?? g.primero.amountCents,
  }));
}

/** Sin filas: lo que se dice en lugar de ellas («No elegiste ítems» o «Elegiste 2 partes · $X»). */
export function textoSinFilas(m: TuMesa, t: T): string | null {
  return m.itemsCount === 0 ? t('No elegiste ítems') : textoEleccion(m, t);
}

export function PantallaDelTicketDeMesa({ mesa, zona, userName, unread, onBell, onVolver, foto, onVerFoto, onVerDetalle }: {
  mesa: TuMesa;
  /** La zona de presentación de las fechas (`useRegion`). */
  zona: string | null;
  userName?: string;
  unread: number;
  onBell: () => void;
  onVolver: () => void;
  /** La miniatura de la foto, si hay (con la capacidad encendida); `null`: la pantalla sin la fila de la foto. */
  foto: { readonly url: string | null; readonly estado: EstadoDeFoto } | null;
  onVerFoto: (boton: HTMLButtonElement) => void;
  onVerDetalle: (boton: HTMLButtonElement) => void;
}) {
  const { t, locale } = useIdioma();
  const nombre = mesa.restaurante ?? t('Mesa {0}', mesa.code);
  const filas = filasDeLoQueElegiste(mesa);
  const sinFilas = filas ? null : textoSinFilas(mesa, t);
  const monto = montoDeTuMesa(mesa);
  const botonFoto = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="screen pantalla-ticket">
      <AppHeaderBack userName={userName} onBack={onVolver} unread={unread} onBell={onBell} />
      <div className="title-card">
        <FilaDeTitulo icono="recibo">
          <h1 className="title-card-title">{nombre}</h1>
          <div className="title-card-sub">{subtituloDeTuMesa(mesa, locale, t, zona)}</div>
        </FilaDeTitulo>
        {foto && (
          <div className="pantalla-ticket-foto">
            <FilaDeLaFotoDelTicket
              url={foto.url}
              estado={foto.estado}
              botonRef={botonFoto}
              onAbrir={() => { if (botonFoto.current) onVerFoto(botonFoto.current); }}
            />
          </div>
        )}
      </div>

      <div className="scroll pantalla-ticket-scroll">
        <section className="pantalla-ticket-eleccion" aria-labelledby="pantalla-ticket-eleccion-titulo">
          <h2 id="pantalla-ticket-eleccion-titulo" className="pantalla-ticket-eleccion-titulo">{t('Lo que elegiste')}</h2>
          {filas ? (
            <ul className={filas.some((f) => f.porcion) ? 'pantalla-ticket-filas pantalla-ticket-filas--con-porcion' : 'pantalla-ticket-filas'}>
              {filas.map((f) => (
                <li key={f.clave} className="eleccion-fila">
                  <span className="eleccion-fila-casilla" aria-hidden="true"><Icon name="check" size={18} /></span>
                  {/* D100 · la porción en su columna, antes del nombre (que se alinea), sólo si alguna línea la tiene. */}
                  <span className="eleccion-fila-frac">{f.porcion ?? ''}</span>
                  <span className="eleccion-fila-nombre">
                    {f.cantidad && <span className="eleccion-fila-cant">{f.cantidad} </span>}
                    {f.nombre}
                  </span>
                  <span className="eleccion-fila-monto">{formatMXN(f.montoCents)}</span>
                </li>
              ))}
            </ul>
          ) : sinFilas ? (
            <p className="pantalla-ticket-texto">{sinFilas}</p>
          ) : null}
        </section>
      </div>

      <div className="pantalla-ticket-pie">
        <div className="pantalla-ticket-pie-fila">
          <span className="pantalla-ticket-pie-rotulo">{t('Elegiste')}</span>
          {monto !== null ? (
            <span className="pantalla-ticket-pie-monto">{monto}</span>
          ) : (
            <>
              <span className="pantalla-ticket-pie-monto pantalla-ticket-pie-monto--sin" aria-hidden="true">—</span>
              <span className="visor-ticket-oculto">{t('Sin consumos elegidos')}</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="btn btn-navy"
          aria-haspopup="dialog"
          onClick={(e) => onVerDetalle(e.currentTarget)}
        >
          {t('Ver detalle digital')}
        </button>
      </div>
    </div>
  );
}
