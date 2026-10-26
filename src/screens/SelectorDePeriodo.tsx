import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useIdioma } from '../i18n/idioma';
import { Icon } from '../components/Icon';
import { PERIODOS, elegirPeriodo, type ClavePeriodo } from '../api/periodoEstadisticas';
import { anioDeMexico, estadoDelPeriodo, etiquetaDePeriodo, ultimosTresMeses } from '../utils/textosDeEstadisticas';
import { mesesDeMexico, nombreDelPeriodo } from '../utils/meses';

/**
 * AF-31 · el período de «Mis estadísticas», «Tus restaurantes» y «Qué comes».
 *
 * D479/D482 · AF-1 · Claude Design 0.261 (1a, 1d): un botón «Octubre ⌄» que abre
 * un DESPLEGABLE anclado debajo —lista con radio, filas de 48, la elegida con
 * tilde—, en lugar de la hoja inferior. Las cuatro opciones del dueño con su
 * segundo texto: «Este mes · Octubre», «Mes pasado · Septiembre», «Últimos 3
 * meses · Agosto a octubre», «Este año · 2026».
 *
 * Teclado: al abrir, el foco entra en la opción elegida; las flechas recorren las
 * opciones (con vuelta), Inicio y Fin van a los extremos, Escape cierra y el foco
 * vuelve al botón. Un toque afuera o salir con Tab también cierra.
 *
 * `disponible` = el dueño CONFIRMÓ el período pedido (`confirmaPeriodo`). Sin eso
 * (error o un backend anterior a v2.106.0) no hay botón: el nombre del período,
 * quieto. `cargando`: mientras llega la respuesta el botón sigue (con el período
 * elegido), así el foco no se pierde al cambiar de período. K1 (D482): con el
 * período confirmado, «En curso» o «Mes completo» en letra chica al lado.
 *
 * AF-36 · el botón dice el NOMBRE del período («Septiembre», «2026»), leído de
 * `inicio` (`period.start` confirmado) en hora de México.
 */
export function SelectorDePeriodo({
  clave,
  disponible,
  cargando = false,
  inicio,
}: {
  clave: ClavePeriodo;
  disponible: boolean;
  /** La respuesta todavía no llegó: el botón queda, con el período elegido. */
  cargando?: boolean;
  /** `period.start` del dueño, sólo si confirmó `clave`; si no, `null`. */
  inicio: string | null;
}) {
  const { t, idioma } = useIdioma();
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);
  const ahora = new Date();
  const rotulo = nombreDelPeriodo(clave, inicio, idioma, ahora) ?? etiquetaDePeriodo(clave, t);

  // Un toque afuera cierra, sin mover el foco (el toque ya lo lleva a donde tocó).
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (caja.current && e.target instanceof Node && !caja.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('pointerdown', afuera);
    return () => document.removeEventListener('pointerdown', afuera);
  }, [abierto]);

  if (!disponible && !cargando) {
    return (
      <div className="est-periodo">
        <span className="est-periodo-quieto">{rotulo}</span>
      </div>
    );
  }

  const cerrar = () => {
    setAbierto(false);
    // El foco vuelve al botón del período (un clic en Safari no lo enfoca).
    requestAnimationFrame(() => boton.current?.focus());
  };
  const meses = mesesDeMexico(ahora, idioma);
  const segundo = (p: ClavePeriodo): string => p === 'this_month' ? meses.actual
    : p === 'last_month' ? meses.anterior
      : p === 'last_3_months' ? ultimosTresMeses(ahora, idioma)
        : anioDeMexico(ahora);

  return (
    <div className="est-periodo" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="est-periodo-boton"
        aria-haspopup="true"
        aria-expanded={abierto}
        aria-controls={abierto ? 'est-periodo-lista' : undefined}
        aria-label={t('Período: {0}. Cambiar', rotulo)}
        onClick={() => setAbierto((v) => !v)}
      >
        {rotulo}
        <Icon name="chevron-down" size={18} className={abierto ? 'rest-chev abierto' : 'rest-chev'} />
      </button>
      {disponible && <span className="est-periodo-estado">{estadoDelPeriodo(clave, t)}</span>}
      {abierto && (
        <ListaDePeriodos
          clave={clave}
          segundo={segundo}
          alElegir={(p) => { elegirPeriodo(p); cerrar(); }}
          alCerrar={cerrar}
          alSalir={() => setAbierto(false)}
        />
      )}
    </div>
  );
}

/** Las opciones, aparte para enfocar la elegida al montarse. */
function ListaDePeriodos({
  clave,
  segundo,
  alElegir,
  alCerrar,
  alSalir,
}: {
  clave: ClavePeriodo;
  segundo: (p: ClavePeriodo) => string;
  alElegir: (p: ClavePeriodo) => void;
  /** Escape: cierra y devuelve el foco al botón. */
  alCerrar: () => void;
  /** Tab afuera: cierra sin mover el foco. */
  alSalir: () => void;
}) {
  const { t } = useIdioma();
  const lista = useRef<HTMLDivElement | null>(null);
  const opciones = () => [...(lista.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];

  useEffect(() => {
    opciones().find((o) => o.getAttribute('aria-checked') === 'true')?.focus();
  }, []);

  function alTeclado(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      alCerrar();
      return;
    }
    const todas = opciones();
    const i = todas.findIndex((o) => o === document.activeElement);
    let siguiente: number | null = null;
    if (e.key === 'ArrowDown') siguiente = (i + 1) % todas.length;
    else if (e.key === 'ArrowUp') siguiente = (i - 1 + todas.length) % todas.length;
    else if (e.key === 'Home') siguiente = 0;
    else if (e.key === 'End') siguiente = todas.length - 1;
    if (siguiente !== null) {
      e.preventDefault();
      todas[siguiente]?.focus();
    }
  }

  return (
    <div
      ref={lista}
      id="est-periodo-lista"
      className="est-periodo-lista"
      role="radiogroup"
      aria-label={t('Elige el período')}
      onKeyDown={alTeclado}
      onBlur={(e) => {
        // Al botón del período no: su propio toque abre y cierra.
        const destino = e.relatedTarget as Node | null;
        if (!e.currentTarget.parentElement?.contains(destino)) alSalir();
      }}
    >
      {PERIODOS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={p === clave}
          tabIndex={p === clave ? 0 : -1}
          className={p === clave ? 'est-periodo-opcion on' : 'est-periodo-opcion'}
          onClick={() => alElegir(p)}
        >
          <span className="est-periodo-radio" aria-hidden="true" />
          <span className="est-periodo-nombre">
            {etiquetaDePeriodo(p, t)}
            <span className="est-periodo-segundo">{segundo(p)}</span>
          </span>
          {p === clave && <Icon name="check" size={18} />}
        </button>
      ))}
    </div>
  );
}
