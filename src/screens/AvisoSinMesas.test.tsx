import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { traducir, type Idioma } from '../i18n/idioma';
import { AppBottomBar, useAccionDelCentro, type AppBottomBarProps } from '../components/AppBottomBar';
import { AvisoSinMesas } from './AvisoSinMesas';

const estado = vi.hoisted(() => ({ idioma: 'es' as Idioma, viajes: [] as { id: string; nombre: string; estado: 'abierto'; fecha_desde: string; fecha_hasta: string }[], camara: vi.fn(), ir: vi.fn(), hoja: vi.fn() }));
vi.mock('../i18n/idioma', async (original) => ({ ...await original<typeof import('../i18n/idioma')>(), useIdioma: () => ({ t: (s: string, ...a: unknown[]) => traducir(s, estado.idioma, ...a) }) }));
vi.mock('./viajes/useViajesDeHoy', () => ({ useViajesDeHoy: () => estado.viajes }));
vi.mock('../amigos/solicitudesPendientes', () => ({ useSolicitudesPendientes: () => 0 }));
vi.mock('../camara/camaraNativa', () => ({ abrirCamaraNativa: estado.camara }));
vi.mock('../router', () => ({ navigate: estado.ir }));
vi.mock('./viajes/hojaParaQueViajeEstado', () => ({ abrirHojaParaQueViaje: estado.hoja }));

type Nodo = ReactElement<{ children?: Nodo | Nodo[]; className?: string; onClick?: () => void; disabled?: boolean }>;
function buscar(nodo: Nodo, clase: string): Nodo | undefined {
  if (nodo.props.className === clase) return nodo;
  const hijos = [nodo.props.children].flat(Infinity).filter(Boolean) as Nodo[];
  return hijos.map((hijo) => typeof hijo === 'object' && buscar(hijo, clase)).find(Boolean) || undefined;
}
const viaje = (id: string) => ({ id, nombre: `Viaje ${id}`, estado: 'abierto' as const, fecha_desde: '2026-11-17', fecha_hasta: '2026-11-18' });
beforeEach(() => { estado.idioma = 'es'; estado.viajes = []; vi.clearAllMocks(); });

describe('K1 y K2 · aviso y centro comparten la acción del momento', () => {
  it('K1 · aviso recibe y ejecuta la acción del centro', () => {
    const accion = { label: 'Escanear', icon: 'camera' as const, onClick: vi.fn() };
    const aviso = AvisoSinMesas({ accion });
    expect(aviso.props.onClick).toBe(accion.onClick);
    aviso.props.onClick();
    expect(accion.onClick).toHaveBeenCalledTimes(1);
  });
  for (const cantidad of [0, 1, 2]) {
    it(`${cantidad} viajes: el aviso ejecuta la misma función que el centro`, () => {
      estado.viajes = Array.from({ length: cantidad }, (_, i) => viaje(String(i)));
      const accion = useAccionDelCentro();
      const aviso = AvisoSinMesas({ accion });
      const centro = buscar(AppBottomBar({ center: accion }) as Nodo, 'appbar-center')!;
      expect(aviso.props.onClick).toBe(centro.props.onClick);
      aviso.props.onClick();
      // Aserciones inmediatas: un await antes de abrir la cámara las pone rojas.
      if (cantidad < 2) {
        expect(estado.camara).toHaveBeenCalledTimes(1);
        expect(estado.ir.mock.calls).toEqual(cantidad === 0 ? [['scan']] : [['scan', '0']]);
        expect(estado.camara.mock.invocationCallOrder[0]).toBeLessThan(estado.ir.mock.invocationCallOrder[0]!);
        expect(estado.hoja).not.toHaveBeenCalled();
      } else {
        expect(estado.hoja).toHaveBeenCalledTimes(1);
        expect(estado.camara).not.toHaveBeenCalled();
        expect(estado.ir).not.toHaveBeenCalled();
      }
    });
  }
  for (const cantidad of [1, 2]) {
    it(`K5 · la barra sin centro propio respeta ${cantidad} viajes de hoy`, () => {
      estado.viajes = Array.from({ length: cantidad }, (_, i) => viaje(String(i)));
      const centro = buscar(AppBottomBar({}) as Nodo, 'appbar-center')!;
      centro.props.onClick!();
      if (cantidad === 1) {
        expect(estado.ir.mock.calls).toEqual([['scan', '0']]);
        expect(estado.camara).toHaveBeenCalledTimes(1);
      } else {
        expect(estado.hoja).toHaveBeenCalledTimes(1);
        expect(estado.camara).not.toHaveBeenCalled();
      }
    });
  }
  it('el centro propio tiene prioridad sobre los viajes, conservando la identidad', () => {
    estado.viajes = [viaje('0'), viaje('1')];
    const propio = { label: 'Continuar', icon: 'arrow-right' as const, onClick: vi.fn() };
    expect(useAccionDelCentro(propio)).toBe(propio);
  });
});

describe('K3 · estados del centro', () => {
  for (const flag of ['disabled', 'busy'] as const) {
    it(`${flag}: el aviso está disabled`, () => {
      const accion: NonNullable<AppBottomBarProps['center']> = { label: 'Escanear', icon: 'camera', onClick: vi.fn(), [flag]: true };
      const html = renderToStaticMarkup(<AvisoSinMesas accion={accion} />);
      expect(html).toMatch(/^<button[^>]*disabled=""/);
      expect(buscar(AppBottomBar({ center: accion }) as Nodo, 'appbar-center')!.props.disabled).toBe(true);
    });
  }
});

describe('K4 · nombre accesible literal y semántica nativa', () => {
  for (const [idioma, nombre] of [['es', 'No tienes mesas abiertas. Escanear un ticket'], ['en', 'You have no open tables. Scan a receipt']] as const) {
    it(idioma, () => {
      estado.idioma = idioma;
      const accion = useAccionDelCentro();
      const html = renderToStaticMarkup(<AvisoSinMesas accion={accion} />);
      expect(html).toMatch(/^<button type="button"/);
      expect(html).toContain(`aria-label="${nombre}"`);
    });
  }
});
