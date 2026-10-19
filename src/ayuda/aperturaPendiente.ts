import { useEffect, useState } from 'react';
import { readUnconfirmed, scopeForActor, useMoneyActor } from '../api/idempotency';

/**
 * ¿Hay una apertura de mesa sin confirmar? (el journal de dinero de
 * `create_mesa`, que es independiente del restaurante: «una sola intención viva
 * por principal», `idempotency.ts`). Sólo LEE: no reenvía, no libera, no abre.
 *
 * La usan Inicio (el aviso «Dejaste una autorización sin confirmar») y la guía
 * (con una pendiente, el ejemplo no arranca). `null` mientras no se leyó, para
 * que la tarjeta Tutorial no aparezca y se vaya. Un journal ilegible NO se
 * anuncia como pendiente: afirmarlo sin poder leerlo sería inventar una deuda.
 */
export function useAperturaPendiente(): boolean | null {
  const { actor } = useMoneyActor();
  const [pendiente, setPendiente] = useState<boolean | null>(null);
  useEffect(() => {
    if (!actor) { setPendiente(null); return undefined; }
    let alive = true;
    void readUnconfirmed(scopeForActor(actor, 'mesa:pendiente'), 'create_mesa')
      .then((attempt) => { if (alive) setPendiente(!!attempt); })
      .catch(() => { if (alive) setPendiente(false); });
    return () => { alive = false; };
  }, [actor]);
  return pendiente;
}
