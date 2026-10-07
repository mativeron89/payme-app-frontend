import { useId, type ReactNode } from 'react';
import { quienPide, type SolicitudParaElTitular } from '../api/joinRequests';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';

/**
 * D223 · «Tu mesa» (turno 2 · 2.9–2.11): las tarjetas desplegables de la mesa
 * del titular comparten el mismo encabezado —título, resumen y flecha—. Es un
 * `<button aria-expanded>` que abre y cierra su cuerpo; la tarjeta es una
 * región con el título como nombre.
 */
export function Desplegable({
  titulo,
  resumen,
  abierto,
  onToggle,
  className,
  children,
}: {
  titulo: string;
  resumen: string;
  abierto: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  const cuerpoId = useId();
  const tituloId = useId();
  return (
    <section className={`card desplegable${className ? ` ${className}` : ''}`} aria-labelledby={tituloId}>
      <button
        type="button"
        className="desplegable-cabecera"
        aria-expanded={abierto}
        aria-controls={cuerpoId}
        onClick={onToggle}
      >
        <span id={tituloId} className="desplegable-titulo">{titulo}</span>
        {/* Siempre presente, aunque esté vacío: el encabezado mide lo mismo
            mientras carga y cuando llega el número. */}
        <span className="desplegable-resumen">{resumen || '\u00a0'}</span>
        <Icon name="chevron-down" size={18} className={`desplegable-flecha${abierto ? ' open' : ''}`} />
      </button>
      <div id={cuerpoId} className="desplegable-cuerpo" hidden={!abierto}>
        {children}
      </div>
    </section>
  );
}

/**
 * «Ana López (@ana.lopez) quiere unirse», con el nombre en negrita. Sin @, sin
 * paréntesis (regla 2); sin nombre, el @; sin los dos, «Alguien quiere unirse».
 * Nunca un id, un correo ni «null» (P05).
 */
function TextoDeQuienPide({ requester }: { requester: SolicitudParaElTitular['requester'] }) {
  const { t } = useIdioma();
  const { nombre, arroba } = quienPide(requester);
  const quien = nombre ?? (arroba !== null ? `@${arroba}` : null);
  if (quien === null) return <>{t('Alguien quiere unirse')}</>;
  // El texto entero sale de UNA traducción; el nombre se marca en el lugar
  // donde la traducción lo pone, así la negrita no rompe el inglés.
  const MARCA = '\u0000';
  const texto = nombre !== null && arroba !== null
    ? t('{0} (@{1}) quiere unirse', MARCA, arroba)
    : t('{0} quiere unirse', MARCA);
  const [antes, despues] = texto.split(MARCA);
  return <>{antes}<strong>{quien}</strong>{despues}</>;
}

/**
 * D219 · las solicitudes para unirse de la mesa del titular: nombre y @, y
 * «Rechazar» / «Aceptar» de 44 px. Sin vencimiento, foto, correo ni teléfono.
 * Cada botón actúa sobre SU id; la fila queda ocupada hasta que el dueño
 * contesta, y la lista se vuelve a pedir: nada se mueve de forma optimista.
 */
export function SolicitudesParaUnirse({
  lista,
  decidiendo,
  onDecidir,
}: {
  lista: readonly SolicitudParaElTitular[];
  decidiendo: ReadonlySet<string>;
  onDecidir: (id: string, accion: 'aceptar' | 'rechazar') => void;
}) {
  return (
    <ul className="solicitudes-lista">
      {lista.map((s) => (
        <FilaDeSolicitud key={s.id} solicitud={s} ocupada={decidiendo.has(s.id)} onDecidir={onDecidir} />
      ))}
    </ul>
  );
}

function FilaDeSolicitud({
  solicitud,
  ocupada,
  onDecidir,
}: {
  solicitud: SolicitudParaElTitular;
  ocupada: boolean;
  onDecidir: (id: string, accion: 'aceptar' | 'rechazar') => void;
}) {
  const { t } = useIdioma();
  // Los dos botones se describen con el texto de SU fila: «Aceptar» dice a quién.
  const textoId = useId();
  return (
    <li className="solicitud" aria-busy={ocupada || undefined}>
      <p id={textoId} className="solicitud-texto">
        <TextoDeQuienPide requester={solicitud.requester} />
      </p>
      <div className="solicitud-acciones">
        <button
          type="button"
          className="solicitud-rechazar"
          aria-describedby={textoId}
          disabled={ocupada}
          onClick={() => onDecidir(solicitud.id, 'rechazar')}
        >
          {t('Rechazar')}
        </button>
        <button
          type="button"
          className="solicitud-aceptar"
          aria-describedby={textoId}
          disabled={ocupada}
          onClick={() => onDecidir(solicitud.id, 'aceptar')}
        >
          {t('Aceptar')}
        </button>
      </div>
    </li>
  );
}
