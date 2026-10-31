import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { textoDelCuadre, type EstadoDelCuadre } from '../screens/cuadreDelTicket';

/**
 * D622 · AF-2 · mejora 4 (§5 de la especificación): la franja al pie de la hoja
 * del ticket. Va FUERA del scroll de la hoja, así que se sigue viendo mientras
 * se edita una fila. Ámbar con el aviso si no cuadra; verde con el tilde si
 * cuadra. El significado va en palabras, no sólo en el color.
 *
 * El anuncio para lectores de pantalla es otra pieza, oculta: cambia sólo
 * cuando cambia el ESTADO (cuadra ↔ sobran ↔ faltan). Con la franja como región
 * viva, cada tecla del precio repetiría la frase entera.
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
