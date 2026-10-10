import { useEffect, useState } from 'react';
import { api } from '../api';
import { ultimoVisto } from '../api/ultimoVisto';

/**
 * D237 · los avisos sin leer de la campana, con lo último visto: al volver a
 * Inicio o a Mesas el punto no aparece y desaparece. Si el número SUBIÓ, puede
 * haber llegado un aviso de una mesa (te aceptaron, te invitaron, se cerró), y
 * lo guardado de las mesas se borra para que la próxima vez no se vea viejo.
 */
export function useSinLeer(): number {
  const [sinLeer, setSinLeer] = useState(() => ultimoVisto.leer<number>('sinLeer') ?? 0);
  useEffect(() => {
    let vivo = true;
    // T-01 · la cuenta se toma al pedir: una respuesta de otra no se guarda ni se muestra.
    const turno = ultimoVisto.turno();
    api
      .getUnreadCount()
      .then((r) => {
        if (!vivo) return;
        const g = ultimoVisto.registrarSinLeer(turno, r.unread_count);
        if (g) setSinLeer(g.valor);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);
  return sinLeer;
}
