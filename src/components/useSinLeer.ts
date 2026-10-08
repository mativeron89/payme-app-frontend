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
    api
      .getUnreadCount()
      .then((r) => {
        if (!vivo) return;
        setSinLeer(ultimoVisto.registrarSinLeer(r.unread_count));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);
  return sinLeer;
}
