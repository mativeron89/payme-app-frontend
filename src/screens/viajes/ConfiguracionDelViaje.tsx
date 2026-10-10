import { useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { PROFILE_AVATAR_INPUT_MIMES } from '../../api/profileIdentity';
import {
  CLAVES_COLOR_VIAJE,
  COLORES_VIAJE,
  MAX_MIEMBROS_VIAJE,
  errorDeViaje,
  type ColorViaje,
  type DetalleViaje,
  type EditarViajePedido,
} from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { CampoDeBusqueda, FilaPersona, ResultadosDeBusqueda, useBuscadorDeMiembros } from './BuscadorDeMiembros';
import { fechasInvertidas, filaDe, mensajeAlCrear, miembrosDelPedido, type Candidato, type FilaDePersona, type VistaDeBusqueda } from './crearViajeView';
import { InsigniaDelViaje } from './InsigniaDelViaje';
import { iniciales, nombreCompleto, rangoDeFechas, type T } from './viajesView';
import './viajes.css';
import './crear.css';
import './viaje.css';

/**
 * D255-8 · «Configuración» del viaje, desde el botón debajo de «Ver balance del
 * viaje». Cualquier miembro la usa (D255, aclaración 2). Es una vista dentro de
 * la pantalla del viaje, no una ruta: «Volver» regresa al viaje.
 *
 * - «Agregar miembros» con el mismo buscador del alta del viaje y la ruta que
 *   ya existe, `POST /api/viajes/:id/miembros`. Cada «Agregar» invita en el acto.
 *   Sin código de viaje (aclaración 3).
 * - D255 tramo 2 (App Backend 2.174.0): nombre y fechas, el color de la paleta
 *   y la foto. Cada cambio se guarda con `PATCH /api/viajes/:id` o
 *   `PUT`/`DELETE …/foto`. El color y la foto se ven en la burbuja del viaje y en
 *   su tarjeta de Abiertos y Cerrados.
 */
export type EditorDelViaje = 'nombre' | 'color' | 'foto' | null;

/** El nombre del color, para el lector de pantalla y la etiqueta de la muestra. */
export function nombreDelColor(color: ColorViaje | null, t: T): string {
  switch (color) {
    case 'azul': return t('Azul');
    case 'verde': return t('Verde');
    case 'violeta': return t('Violeta');
    case 'rojo': return t('Rojo');
    case 'naranja': return t('Naranja');
    case 'turquesa': return t('Turquesa');
    default: return t('Sin color');
  }
}

/** Sólo lo que cambió del nombre y las fechas; `null` si no cambió nada. */
export function cambiosDeNombreYFechas(
  viaje: Pick<DetalleViaje, 'nombre' | 'fecha_desde' | 'fecha_hasta'>,
  nombre: string,
  desde: string,
  hasta: string,
): EditarViajePedido | null {
  const c: { nombre?: string; fecha_desde?: string | null; fecha_hasta?: string | null } = {};
  if (nombre.trim() !== viaje.nombre) c.nombre = nombre.trim();
  if ((desde || null) !== viaje.fecha_desde) c.fecha_desde = desde || null;
  if ((hasta || null) !== viaje.fecha_hasta) c.fecha_hasta = hasta || null;
  return Object.keys(c).length > 0 ? c : null;
}

export function ConfiguracionDelViaje({ viaje, userName, foto, onFotoCambiada, onVolver, onActualizado, onYaSeCerro }: {
  viaje: DetalleViaje;
  userName?: string;
  /** La URL de la foto del viaje en memoria, o `null`. */
  foto: string | null;
  /** Después de subir o quitar la foto: que se vuelva a pedir. */
  onFotoCambiada: () => void;
  onVolver: () => void;
  onActualizado: (v: DetalleViaje) => void;
  onYaSeCerro: () => void;
}) {
  const { t } = useIdioma();
  const toast = useToast();
  const { session } = useAuth();
  const [invitadosAhora, setInvitadosAhora] = useState<readonly Candidato[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorDelViaje>(null);
  const [guardando, setGuardando] = useState(false);
  const enElViaje = new Set([...viaje.miembros, ...viaje.invitados]
    .flatMap((p) => (p.username && !p.eliminada ? [p.username] : [])));
  const buscador = useBuscadorDeMiembros(invitadosAhora, enElViaje);
  const lleno = viaje.miembros.length + viaje.invitados.length >= MAX_MIEMBROS_VIAJE;

  function errorAlGuardar(err: unknown): void {
    const e = errorDeViaje(err);
    if (e.tipo === 'no_abierto' || e.tipo === 'no_disponible') onYaSeCerro();
    else if (e.tipo === 'foto_ocupada') toast(t('Muchas fotos seguidas. Prueba en unos minutos.'));
    else if (e.tipo === 'foto_invalida' || (err instanceof Error && err.message.startsWith('avatar_'))) {
      toast(t('Esa foto no sirve: usa una JPG, PNG o WEBP de hasta 5 MB.'));
    } else toast(t('No pudimos guardarlo. Prueba de nuevo.'));
  }

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

  async function editar(cambios: EditarViajePedido) {
    if (guardando) return;
    setGuardando(true);
    try {
      onActualizado(await api.editarViaje(viaje.id, cambios));
      setEditor(null);
      toast(t('Guardamos los cambios.'));
    } catch (err) {
      errorAlGuardar(err);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarFoto(archivo: File | null) {
    if (guardando || !session) return;
    setGuardando(true);
    try {
      if (archivo) await api.subirFotoDeViaje(viaje.id, archivo);
      else await api.quitarFotoDeViaje(viaje.id, session);
      onFotoCambiada();
      onActualizado(await api.getViaje(viaje.id));
      setEditor(null);
      toast(archivo ? t('Listo: el viaje tiene foto nueva.') : t('Quitamos la foto del viaje.'));
    } catch (err) {
      errorAlGuardar(err);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ConfiguracionVista
      viaje={viaje}
      userName={userName}
      foto={foto}
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
      editor={editor}
      guardando={guardando}
      onVolver={onVolver}
      onTexto={buscador.setTexto}
      onAgregar={(clave) => void agregar(clave)}
      onEditor={(e) => setEditor((actual) => (actual === e ? null : e))}
      onGuardarNombre={(cambios) => void editar(cambios)}
      onColor={(color) => void editar({ color })}
      onFoto={(archivo) => void cambiarFoto(archivo)}
    />
  );
}

export interface ConfiguracionVistaProps {
  readonly viaje: DetalleViaje;
  readonly userName?: string;
  readonly foto: string | null;
  readonly texto: string;
  readonly busqueda: VistaDeBusqueda | null;
  /** Los invitados que todavía no aceptaron. */
  readonly invitados: readonly FilaDePersona[];
  readonly lleno: boolean;
  readonly ocupado: string | null;
  /** Qué editor de «El viaje» está abierto. */
  readonly editor: EditorDelViaje;
  readonly guardando: boolean;
  readonly onVolver: () => void;
  readonly onTexto: (v: string) => void;
  readonly onAgregar: (clave: string) => void;
  readonly onEditor: (editor: Exclude<EditorDelViaje, null>) => void;
  readonly onGuardarNombre: (cambios: EditarViajePedido) => void;
  readonly onColor: (color: ColorViaje | null) => void;
  /** Un archivo para subir, o `null` para quitar la foto. */
  readonly onFoto: (archivo: File | null) => void;
}

export function ConfiguracionVista(p: ConfiguracionVistaProps) {
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
          {/* D259 · Mati: sin la ayuda «Les llega una invitación…» (sigue en Crear viaje). */}
          {p.busqueda && <ResultadosDeBusqueda b={p.busqueda} lleno={p.lleno} ocupado={p.ocupado} onAgregar={p.onAgregar} />}
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

        {/* D259 · Mati: sin el título «El viaje»; las tres filas, en su tarjeta. */}
        <section className="vj-card vjcfg-viaje">
          <ul className="vjcfg-filas">
            <li>
              <FilaDeEditor
                rotulo={t('Nombre y fechas')}
                abierto={p.editor === 'nombre'}
                onClick={() => p.onEditor('nombre')}
              >
                <span className="vjcfg-fila-valor">{fechas ? `${v.nombre} · ${fechas}` : v.nombre}</span>
              </FilaDeEditor>
              {p.editor === 'nombre' && <EditorDeNombre viaje={v} guardando={p.guardando} onGuardar={p.onGuardarNombre} onCancelar={() => p.onEditor('nombre')} />}
            </li>
            <li>
              <FilaDeEditor rotulo={t('Color')} abierto={p.editor === 'color'} onClick={() => p.onEditor('color')}>
                <span className="vjcfg-fila-valor">{nombreDelColor(v.color, t)}</span>
                <MuestraDeColor color={v.color} />
              </FilaDeEditor>
              {p.editor === 'color' && <EditorDeColor actual={v.color} guardando={p.guardando} onColor={p.onColor} />}
            </li>
            <li>
              <FilaDeEditor rotulo={t('Foto')} abierto={p.editor === 'foto'} onClick={() => p.onEditor('foto')}>
                <InsigniaDelViaje nombre={v.nombre} color={v.color} foto={p.foto} />
              </FilaDeEditor>
              {p.editor === 'foto' && <EditorDeFoto tieneFoto={v.has_photo} guardando={p.guardando} onFoto={p.onFoto} />}
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}

function FilaDeEditor({ rotulo, abierto, onClick, children }: {
  rotulo: string;
  abierto: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="vjcfg-fila" aria-expanded={abierto} onClick={onClick}>
      <span className="vjcfg-fila-rotulo">{rotulo}</span>
      {children}
      <Icon name="chevron-down" size={18} className={`vjcfg-chev ${abierto ? 'abierto' : ''}`} />
    </button>
  );
}

function MuestraDeColor({ color }: { color: ColorViaje | null }) {
  return (
    <span
      className={`vjcfg-muestra ${color ? '' : 'vjcfg-muestra--sin'}`}
      style={color ? { background: COLORES_VIAJE[color] } : undefined}
      aria-hidden="true"
    />
  );
}

function EditorDeNombre({ viaje, guardando, onGuardar, onCancelar }: {
  viaje: DetalleViaje;
  guardando: boolean;
  onGuardar: (cambios: EditarViajePedido) => void;
  onCancelar: () => void;
}) {
  const { t } = useIdioma();
  const [nombre, setNombre] = useState(viaje.nombre);
  const [desde, setDesde] = useState(viaje.fecha_desde ?? '');
  const [hasta, setHasta] = useState(viaje.fecha_hasta ?? '');
  const invertidas = fechasInvertidas(desde, hasta);
  const cambios = cambiosDeNombreYFechas(viaje, nombre, desde, hasta);
  const valido = nombre.trim().length > 0 && !invertidas;
  return (
    <div className="vjcfg-editor">
      <label className="vjc-etiqueta" htmlFor="vjcfg-nombre">{t('Nombre del viaje')}</label>
      <input
        id="vjcfg-nombre"
        className="input vjc-input"
        type="text"
        value={nombre}
        maxLength={80}
        autoComplete="off"
        onChange={(e) => setNombre(e.target.value)}
      />
      <div className="vjc-fechas" role="group" aria-label={t('Fechas')}>
        <div className="vjc-fecha">
          <label className="vjc-sub" htmlFor="vjcfg-del">{t('Del')}</label>
          <input id="vjcfg-del" className="input vjc-input" type="date" value={desde} max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="vjc-fecha">
          <label className="vjc-sub" htmlFor="vjcfg-al">{t('Al')}</label>
          <input id="vjcfg-al" className="input vjc-input" type="date" value={hasta} min={desde || undefined}
            aria-invalid={invertidas || undefined} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>
      {invertidas && <p className="vjc-error" role="alert">{t('La fecha «Al» no puede ser antes de «Del».')}</p>}
      <div className="vjcfg-botones">
        <button
          type="button"
          className="btn btn-navy"
          disabled={!valido || cambios === null || guardando}
          aria-busy={guardando || undefined}
          onClick={() => { if (cambios) onGuardar(cambios); }}
        >
          {guardando ? t('Guardando…') : t('Guardar')}
        </button>
        <button type="button" className="btn btn-ghost" disabled={guardando} onClick={onCancelar}>{t('Cancelar')}</button>
      </div>
    </div>
  );
}

function EditorDeColor({ actual, guardando, onColor }: {
  actual: ColorViaje | null;
  guardando: boolean;
  onColor: (color: ColorViaje | null) => void;
}) {
  const { t } = useIdioma();
  const opciones: ReadonlyArray<ColorViaje | null> = [null, ...CLAVES_COLOR_VIAJE];
  return (
    <div className="vjcfg-editor">
      <div className="vjcfg-paleta" role="radiogroup" aria-label={t('Color')}>
        {opciones.map((c) => (
          <button
            key={c ?? 'sin'}
            type="button"
            role="radio"
            aria-checked={c === actual}
            aria-label={nombreDelColor(c, t)}
            className="vjcfg-opcion-color"
            disabled={guardando}
            onClick={() => { if (c !== actual) onColor(c); }}
          >
            <MuestraDeColor color={c} />
            {c === actual && <Icon name="check" size={16} className="vjcfg-tilde" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorDeFoto({ tieneFoto, guardando, onFoto }: {
  tieneFoto: boolean;
  guardando: boolean;
  onFoto: (archivo: File | null) => void;
}) {
  const { t } = useIdioma();
  const entrada = useRef<HTMLInputElement | null>(null);
  return (
    <div className="vjcfg-editor">
      <p className="vjc-ayuda">{t('La ven sólo los miembros del viaje.')}</p>
      {/* La cámara o la galería: el teléfono las ofrece al elegir un archivo de imagen. */}
      <input
        ref={entrada}
        className="vj-oculto"
        type="file"
        accept={PROFILE_AVATAR_INPUT_MIMES.join(',')}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const archivo = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (archivo) onFoto(archivo);
        }}
      />
      <div className="vjcfg-botones">
        <button
          type="button"
          className="btn btn-navy"
          disabled={guardando}
          aria-busy={guardando || undefined}
          onClick={() => entrada.current?.click()}
        >
          <Icon name="camera" size={18} className="ico-inline" />
          {guardando ? t('Subiendo la foto…') : tieneFoto ? t('Cambiar la foto') : t('Elegir foto')}
        </button>
        {tieneFoto && (
          <button type="button" className="btn btn-ghost" disabled={guardando} onClick={() => onFoto(null)}>
            {t('Eliminar foto')}
          </button>
        )}
      </div>
    </div>
  );
}
