import { ICONOS_DE_TARJETA } from '../components/TarjetaDeTitulo';

/**
 * D479/D482 · AF-1 · los íconos chicos del rediseño de Estadísticas que el set
 * general no tiene: las flechas de las diferencias de Meses completos, el
 * calendario de Evolución y los de la lista de accesos (los mismos trazos de las
 * tarjetas de título, sin el cuadro). Trazo, sin relleno, 24 × 24; siempre
 * decorativos: el texto de al lado dice lo mismo.
 */
const TRAZOS = {
  'flecha-arriba': 'M12 19V5M6 11l6-6 6 6',
  'flecha-abajo': 'M12 5v14M6 13l6 6 6-6',
  calendario: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 3v4M16 3v4',
  tienda: ICONOS_DE_TARJETA.tienda,
  cubiertos: ICONOS_DE_TARJETA.cubiertos,
  tendencia: ICONOS_DE_TARJETA.tendencia,
} as const;

export type IconoDeEstadisticas = keyof typeof TRAZOS;

export function IconoDeEstadisticas({ nombre, tamano = 18 }: { nombre: IconoDeEstadisticas; tamano?: number }) {
  return (
    <svg
      className="est-icono"
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}
