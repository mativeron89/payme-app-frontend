import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { textoDelCuadre, type EstadoDelCuadre } from '../screens/cuadreDelTicket';

/** Cuánto queda el anuncio en la región viva antes de vaciarse (m2 de E06, AF-3). */
const ANUNCIO_MS = 1500;

/**
 * D622 · AF-2 · mejora 4 (§5 de la especificación): la franja al pie de la hoja
 * del ticket. Va FUERA del scroll de la hoja, así que se sigue viendo mientras
 * se edita una fila. Ámbar con el aviso si no cuadra; verde con el tilde si
 * cuadra. El significado va en palabras, no sólo en el color.
 *
 * El anuncio para lectores de pantalla es otra pieza, oculta: cambia sólo
 * cuando cambia el ESTADO (cuadra ↔ sobran ↔ faltan). Con la franja como región
 * viva, cada tecla del precio repetiría la frase entera.
 *
 * AF-3 (m2 de E06): después de anunciarse, el texto se vacía. Si quedaba, quien
 * recorre la pantalla con el lector oía un monto viejo al lado del nuevo («sobran
 * $45» en la región oculta, «sobran $55» en la franja). Vaciar no se anuncia.
 */
export function FranjaDelCuadre({ estado, t }: {
  estado: EstadoDelCuadre;
  t: (s: string, ...a: unknown[]) => string;
}) {
  const texto = textoDelCuadre(estado, t);
  const [anuncio, setAnuncio] = useState('');
  const ultimoTipo = useRef<EstadoDelCuadre['tipo'] | null>(null);
  useEffect(() => {
    if (ultimoTipo.current === estado.tipo) return;
    ultimoTipo.current = estado.tipo;
    setAnuncio(texto);
  }, [estado.tipo, texto]);
  useEffect(() => {
    if (!anuncio) return;
    const id = setTimeout(() => setAnuncio(''), ANUNCIO_MS);
    return () => clearTimeout(id);
  }, [anuncio]);
  const cuadra = estado.tipo === 'cuadra';
  return (
    <>
      <div className={`cuadre-ticket ${cuadra ? 'cuadre-ticket--cuadra' : 'cuadre-ticket--no-cuadra'}`}>
        <Icon name={cuadra ? 'check' : 'warning'} size={18} />
        <span>{texto}</span>
      </div>
      <span className="cuadre-ticket-anuncio" aria-live="polite">{anuncio}</span>
    </>
  );
}
