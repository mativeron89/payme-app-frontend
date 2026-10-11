import { useCallback, useEffect, useRef } from 'react';
import { RequestEpoch } from '../utils/requestEpoch';

/**
 * F-02 · V-05 (auditorías de Codex) · en Estadísticas, cambiar de período pide de nuevo, y una respuesta lenta del
 * período anterior podía llegar DESPUÉS y escribir sus datos debajo del período nuevo.
 *
 * `nuevaTanda()` se llama al empezar a pedir y devuelve `vigente()`: dice si esa tanda sigue siendo la última. Una
 * respuesta de una tanda anterior (otro período, un «Reintentar» posterior) o con la pantalla ya ida no se escribe.
 * Es la misma época de pedido que usan las listas de Viajes (`RequestEpoch`).
 */
export function useTandaVigente(): () => () => boolean {
  const epoca = useRef(new RequestEpoch());
  useEffect(() => {
    const e = epoca.current;
    // Al irse la pantalla, nada de lo que esté en vuelo se escribe.
    return () => { e.next(); };
  }, []);
  return useCallback(() => {
    const mia = epoca.current.next();
    return () => epoca.current.isCurrent(mia);
  }, []);
}
