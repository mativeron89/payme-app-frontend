import { useSyncExternalStore } from 'react';
import { fotosEnMemoria, type FotosEnMemoria } from '../api/fotosEnMemoria';
import type { StoredSession } from '../api/storage';

/**
 * E173-3 · la URL `blob:` guardada en memoria para esa clave, o `null`. Se
 * actualiza sola cuando el caché guarda, reemplaza o retira esa foto.
 */
export function useFotoEnMemoria(
  sesion: Pick<StoredSession, 'family_id' | 'principal_id'> | null,
  clave: string | null,
  cache: FotosEnMemoria = fotosEnMemoria,
): string | null {
  const leer = () => (sesion && clave ? cache.ver(sesion, clave) : null);
  // El mismo lector del lado del servidor: los tests renderizan a texto.
  return useSyncExternalStore(cache.suscribir, leer, leer);
}
