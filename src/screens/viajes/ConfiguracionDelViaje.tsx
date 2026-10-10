import { useState } from 'react';
import { api } from '../../api';
import { MAX_MIEMBROS_VIAJE, errorDeViaje, type DetalleViaje } from '../../api/viajes';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { CampoDeBusqueda, FilaPersona, ResultadosDeBusqueda, useBuscadorDeMiembros } from './BuscadorDeMiembros';
import { filaDe, mensajeAlCrear, miembrosDelPedido, type Candidato, type FilaDePersona, type VistaDeBusqueda } from './crearViajeView';
import { InsigniaDelViaje } from './PestanaViajes';
import { iniciales, nombreCompleto, rangoDeFechas } from './viajesView';
import './viajes.css';
import './crear.css';
import './viaje.css';

/**
 * D255-8 · «Configuración» del viaje, desde el botón debajo de «Ver balance del
 * viaje». Cualquier miembro la usa (D255, aclaración 2).
 *
 * Tramo 1: «Agregar miembros» con el mismo buscador del alta del viaje (amigos y
 * @usuario) y la ruta que ya existe, `POST /api/viajes/:id/miembros`. Cada
 * «Agregar» manda la invitación en el acto; a quien ya es miembro o está
 * invitado el dueño lo ignora. Sin código de viaje (aclaración 3).
 *
 * Tramo 2 (con App Backend D255): nombre, fechas, color y foto. Hasta entonces
 * el lugar está armado, apagado.
 *
 * Es una vista dentro de la pantalla del viaje, no una ruta: «Volver» regresa al
 * viaje.
 */
export function ConfiguracionDelViaje({ viaje, userName, onVolver, onActualizado, onYaSeCerro }: {
  viaje: DetalleViaje;
  userName?: string;
  onVolver: () => void;
  onActualizado: (v: DetalleViaje) => void;
  onYaSeCerro: () => void;
}) {
  const { t } = useIdioma();
  const toast = useToast();
  const [invitadosAhora, setInvitadosAhora] = useState<readonly Candidato[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const enElViaje = new Set([...viaje.miembros, ...viaje.invitados]
    .flatMap((p) => (p.username && !p.eliminada ? [p.username] : [])));
  const buscador = useBuscadorDeMiembros(invitadosAhora, enElViaje);
  const lleno = viaje.miembros.length + viaje.invitados.length >= MAX_MIEMBROS_VIAJE;

  async function agregar(clave: string) {
    if (ocupado) return;
    const c = [...buscador.secciones.amigos, ...buscador.secciones.otros].find((x) => x.clave === clave);
    if (!c) return;
    setOcupado(clave);
    try {
      const v = await api.invitarAlViaje(viaje.id, miembrosDelPedido([c]));
      setInvitadosAhora((prev) => [...prev, c]);
      onActualizado(v);
      toast(t('Le mandamos la invitación a {0}.', filaDe(c, buscador.arrobaHabilitada).nombre));
    } catch (err) {
      const e = errorDeViaje(err);
      if (e.tipo === 'no_abierto' || e.tipo === 'no_disponible') onYaSeCerro();
      else toast(mensajeAlCrear(e, t));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <ConfiguracionVista
      viaje={viaje}
      userName={userName}
      texto={buscador.texto}
      busqueda={buscador.vista}
      invitados={viaje.invitados.map((p) => ({
        clave: p.id,
        nombre: nombreCompleto(p, t),
        iniciales: iniciales(p),
        arroba: p.username && !p.eliminada ? `@${p.username}` : null,
      }))}
      lleno={lleno}
      ocupado={ocupado}
      onVolver={onVolver}
      onTexto={buscador.setTexto}
      onAgregar={(clave) => void agregar(clave)}
    />
  );
}

export function ConfiguracionVista(p: {
  readonly viaje: DetalleViaje;
  readonly userName?: string;
  readonly texto: string;
  readonly busqueda: VistaDeBusqueda | null;
  /** Los invitados que todavía no aceptaron. */
  readonly invitados: readonly FilaDePersona[];
  readonly lleno: boolean;
  readonly ocupado: string | null;
  readonly onVolver: () => void;
  readonly onTexto: (v: string) => void;
  readonly onAgregar: (clave: string) => void;
}) {
  const { t, idioma } = useIdioma();
  const v = p.viaje;
  const fechas = rangoDeFechas(v.fecha_desde, v.fecha_hasta, idioma);
  return (
    <>
      <AppHeaderBack userName={p.userName} onBack={p.onVolver} />
      <div className="title-card">
        {/* Plan OK (01:16:34Z): un solo título, sin el nombre del viaje debajo. */}
        <h1 className="title-card-title">{t('Configuración')}</h1>
      </div>
      <div className="scroll vj-scroll">
        <section className="vj-card" aria-labelledby="vjcfg-agregar">
          <h2 className="vjc-etiqueta" id="vjcfg-agregar">{t('Agregar miembros')}</h2>
          <CampoDeBusqueda texto={p.texto} onTexto={p.onTexto} />
          {p.lleno && <p className="vjc-nota">{t('Un viaje admite hasta 20 personas.')}</p>}
          {p.busqueda ? (
            <ResultadosDeBusqueda b={p.busqueda} lleno={p.lleno} ocupado={p.ocupado} onAgregar={p.onAgregar} />
          ) : (
            <p className="vjc-ayuda">{t('Les llega una invitación. Entran al viaje cuando la aceptan.')}</p>
          )}
          {!p.busqueda && p.invitados.length > 0 && (
            <>
              <h3 className="vj-seccion">{t('Invitados')}</h3>
              <ul className="vjc-lista">
                {p.invitados.map((x) => (
                  <FilaPersona key={x.clave} persona={x}>
                    <span className="vjc-creas">{t('Falta que acepte')}</span>
                  </FilaPersona>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Tramo 2: se conectan con App Backend D255. */}
        <section className="vj-card vjcfg-viaje" aria-labelledby="vjcfg-viaje">
          <h2 className="vjc-etiqueta" id="vjcfg-viaje">{t('El viaje')}</h2>
          <ul className="vjcfg-filas">
            <li>
              <button type="button" className="vjcfg-fila" disabled>
                <span className="vjcfg-fila-rotulo">{t('Nombre y fechas')}</span>
                <span className="vjcfg-fila-valor">{fechas ? `${v.nombre} · ${fechas}` : v.nombre}</span>
                <Icon name="chevron-down" size={18} className="vjcfg-chev" />
              </button>
            </li>
            <li>
              <button type="button" className="vjcfg-fila" disabled>
                <span className="vjcfg-fila-rotulo">{t('Color')}</span>
                <span className="vjcfg-muestra" aria-hidden="true" />
                <Icon name="chevron-down" size={18} className="vjcfg-chev" />
              </button>
            </li>
            <li>
              <button type="button" className="vjcfg-fila" disabled>
                <span className="vjcfg-fila-rotulo">{t('Foto')}</span>
                <InsigniaDelViaje nombre={v.nombre} />
                <Icon name="chevron-down" size={18} className="vjcfg-chev" />
              </button>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
