import { Icon } from './Icon';

/**
 * D372 · la barra reducida de D y E: blanca, de borde a borde, con un solo
 * control, el círculo naranja de siempre (`.link-round`) montado arriba. Sin
 * texto visible: el nombre accesible lo dice («Ver mis ítems», «Ir a PayMe»).
 *
 * Es propia de esta pantalla (Q4): `AppBottomBar` dibuja las cinco posiciones y
 * no se toca. Unificarlas es otra entrega.
 */
export function BarraDeLink({ etiqueta, alTocar }: { readonly etiqueta: string; readonly alTocar: () => void }) {
  return (
    <div className="link-barra">
      <button type="button" className="link-round" onClick={alTocar} aria-label={etiqueta}>
        <Icon name="arrow-right" size={24} />
      </button>
    </div>
  );
}
