import { createRoot } from 'react-dom/client';
import { AvisoSinMesas } from '../../src/screens/AvisoSinMesas';

export function montarAviso(panel: HTMLElement, estado: 'disabled' | 'busy') {
  const root = createRoot(panel);
  const accion = { label: 'Escanear', icon: 'camera' as const, onClick: () => {
    panel.dataset.llamadas = String(Number(panel.dataset.llamadas) + 1);
  } };
  root.render(<AvisoSinMesas accion={{ ...accion, [estado]: true }} />);
  return () => root.render(<AvisoSinMesas accion={accion} />);
}
