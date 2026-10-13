import type { ReactNode } from 'react';

/**
 * D285 · la tarjeta de título blanca con ícono (opción 4c de Claude Design,
 * `PANTALLA-tarjeta-de-titulo-blanca.md`, e25d98bb…): reemplaza la celeste
 * (`--teal-l`) en las pantallas que montan sobre la cabecera. Cada pantalla
 * conserva su contenedor `.title-card` (o `.ingreso-burbuja`) y su contenido
 * extra; acá viven el cuadro del ícono y la fila del título.
 *
 * Los íconos son los de la especificación, tal cual: trazo, sin relleno, 24 × 24
 * y un solo `<path>`. El cuadro es navy (`--action`); el de cierre («¡Listo!»)
 * es el único naranja (`--brand`), con el check de trazo 2.6.
 */
export const ICONOS_DE_TARJETA = {
  dividir: 'M16 3h5v5M8 3H3v5M21 3l-7.5 7.5M3 3l7.5 7.5M12 12v9',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  banco: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z',
  compartir: 'M18 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M18 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6M8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  tienda: 'M3 9l2-5h14l2 5M3 9h18v1a3 3 0 0 1-6 0a3 3 0 0 1-6 0a3 3 0 0 1-6 0zM5 13v8h14v-8M10 21v-5h4v5',
  cubiertos: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 0-3.5 2.5-3.5 6s1.5 4 3.5 4',
  tarjeta: 'M2 6.5A1.5 1.5 0 0 1 3.5 5h17A1.5 1.5 0 0 1 22 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5zM2 10h20M6 15h4',
  check: 'M20 6 9 17l-5-5',
  mesa: 'M3 9h18M5 9v11M19 9v11M8 9V5h8v4',
  maleta: 'M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18',
  archivo: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  'maleta-mas': 'M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M12 10.5v6M9 13.5h6',
  engranaje: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  recibo: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  escanear: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8',
  lapiz: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  barras: 'M3 21h18M6 17v-6M11 17V5M16 17v-9',
  tendencia: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  'recibo-de-pagos': 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  controles: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  campana: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  entrar: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  'persona-mas': 'M10 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M2 21c0-4 3.6-7 8-7 1.5 0 2.9.3 4 .9M19 14v6M16 17h6',
} as const;

export type IconoDeTarjeta = keyof typeof ICONOS_DE_TARJETA;

/** El cuadro de 48 × 48 con el ícono. `cierre`: el naranja de «¡Listo!», el único. */
export function CuadroDeTarjeta({ icono, cierre = false }: { icono: IconoDeTarjeta; cierre?: boolean }) {
  return (
    <span className={cierre ? 'title-card-cuadro title-card-cuadro--cierre' : 'title-card-cuadro'} data-icono={icono} aria-hidden="true">
      <svg className={cierre || icono === 'check' ? undefined : 'icon-scalable icon-scalable--title'} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={cierre ? 2.6 : 1.7}
        strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d={ICONOS_DE_TARJETA[icono]} />
      </svg>
    </span>
  );
}

/**
 * La fila del título: el cuadro a la izquierda y, al lado, el título y el subtítulo alineados a la izquierda. `cuadro`
 * reemplaza al ícono (la foto o la inicial de un viaje). `derecha` va al otro extremo (el total de Estadísticas). El
 * contenido extra de cada pantalla (total, nota, «Ver el ticket», la barra) va después de la fila, en la tarjeta.
 */
export function FilaDeTitulo({ icono, cierre = false, cuadro, derecha, children }: {
  icono?: IconoDeTarjeta;
  cierre?: boolean;
  cuadro?: ReactNode;
  derecha?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="title-card-fila">
      {cuadro ?? (icono && <CuadroDeTarjeta icono={icono} cierre={cierre} />)}
      <div className="title-card-textos">{children}</div>
      {derecha}
    </div>
  );
}
