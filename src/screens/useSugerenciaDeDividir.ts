import { useEffect, useState } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import type { StoredSession } from '../api/storage';
import { permisoDeSugerencias, useCapacidadesOpcionales, type SugerenciaDeDividir } from '../api/sugerencias';

/**
 * n420 · la sugerencia de «¿Cómo dividen?» (D411–D413), con las dos puertas de `src/api/sugerencias.ts`:
 * 1. `features.sugerencias.enabled` del `/config` que ya llegó. Apagada (hoy): este hook no pide NADA;
 * 2. el permiso de la cuenta, leído una vez por sesión. Sin él, ningún pedido de sugerencia.
 *
 * Un pedido por ticket, cuando se asentó el restaurante (o se dio por fallido), sólo en mesa de restaurante: ni en
 * Viajes ni en el ejemplo del tutorial (lo decide el llamador con `activo`). Cualquier error, una forma rara o una
 * respuesta que llega con otro ticket o restaurante: sin marca, y la pantalla es la de siempre (D405). No se persiste
 * nada ni se cuenta nada.
 */
export function useSugerenciaDeDividir({ activo, listo, restaurantId, session }: {
  readonly activo: boolean;
  readonly listo: boolean;
  readonly restaurantId: string | null;
  readonly session: StoredSession | null;
}): SugerenciaDeDividir {
  const capacidades = useCapacidadesOpcionales();
  const encendida = capacidades.sugerencias?.enabled === true;
  const [sugerencia, setSugerencia] = useState<{ readonly clave: string; readonly valor: SugerenciaDeDividir } | null>(null);
  const cuenta = session ? `${session.family_id}:${session.principal_id}` : null;
  const clave = `${cuenta ?? '-'}|${restaurantId ?? '-'}`;

  useEffect(() => {
    setSugerencia(null);
    if (!activo || !listo || !session || !encendida) return;
    let vigente = true;
    void (async () => {
      try {
        let permiso = permisoDeSugerencias.leer();
        if (permiso === null) {
          const estado = await api.getConsentimiento('sugerencias', session);
          if (!vigente) return;
          permiso = estado.granted;
          permisoDeSugerencias.guardar(permiso);
        }
        if (!permiso) return;
        const valor = await api.getSugerenciaDividir(restaurantId, session);
        if (vigente) setSugerencia({ clave, valor });
      } catch (err) {
        // El permiso se revocó en otro dispositivo: hasta la próxima sesión, sin pedidos.
        if (extractApiError(err).code === 'permiso_requerido') permisoDeSugerencias.guardar(false);
      }
    })();
    return () => { vigente = false; };
    // `session` entra por `cuenta`: la rotación de tokens no repite el pedido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, listo, encendida, clave]);

  return activo && encendida && sugerencia?.clave === clave ? sugerencia.valor : null;
}
