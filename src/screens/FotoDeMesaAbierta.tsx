import { useRef, useState } from 'react';
import { decodeFotoDelTicket, negociacionDeFoto, tieneFoto, useCapacidadFotoDelTicket } from '../api/fotoDelTicket';
import { useFotoDelTicket, type OrigenDeFoto } from '../api/fotosDeTickets';
import type { StoredSession } from '../api/storage';
import type { MesaDetail } from '../api/types';
import { FilaDeLaFotoDelTicket, VisorDelTicket } from '../components/VisorDelTicket';
import { useIdioma } from '../i18n/idioma';

export function FotoDeMesaAbierta({ session, mesa }: { session: StoredSession; mesa: MesaDetail }) {
  const { t } = useIdioma();
  const capacidad = useCapacidadFotoDelTicket();
  const foto = capacidad && decodeFotoDelTicket(mesa.ticket_image, negociacionDeFoto() === 2 ? 2 : 1);
  const origen: OrigenDeFoto = { tipo: 'mesa', code: mesa.code };
  const miniatura = useFotoDelTicket(session, tieneFoto(foto) ? origen : null, 'thumb');
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  if (!tieneFoto(foto) || miniatura.estado === 'sin_foto') return null;
  return <>
    <FilaDeLaFotoDelTicket url={miniatura.url} estado={miniatura.estado} botonRef={boton} onAbrir={() => setAbierto(true)} />
    {abierto && <VisorDelTicket session={session} tickets={[{
      clave: mesa.code, origen, foto, titulo: mesa.restaurant.name, monto: null, detalle: [],
    }]} indiceInicial={0} titulo={() => t('Foto del ticket')} onCerrar={() => setAbierto(false)}
      onVerConsumos={() => setAbierto(false)} returnFocusRef={boton} />}
  </>;
}
