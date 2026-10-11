import { stringToCents } from './money';

/**
 * F-03 · V-04 (auditorías de Codex) · lo que alguien escribe como monto, en centavos enteros. Antes, Carga manual y
 * «¿Quién pagó?» borraban TODAS las comas antes de leer: «12,50» se volvía $1,250. Ahora las dos leen con esto.
 *
 * - **Sin separadores:** pesos enteros («1200»).
 * - **Un separador seguido de una o dos cifras es decimal**, con coma o con punto: «12,50», «12.5».
 * - **Comas de miles en grupos de tres**, con punto decimal opcional, como se escribe en México: «1,250»,
 *   «1,000,000», «1,250.00».
 * - **Puntos de miles en grupos de tres con coma decimal**, o varios puntos de miles: «1.250,00», «1.250.000».
 * - **Ambiguo, y se rechaza sin adivinar:** un solo punto seguido de exactamente tres cifras («1.250»): puede ser mil
 *   doscientos cincuenta (punto de miles) o uno con veinticinco y un cero de más (punto decimal).
 * - **Todo lo demás es inválido:** agrupación mal hecha («1,25,0»), más de dos decimales, separadores mezclados en otro
 *   orden («1.250.00»), cero o más de siete cifras de pesos.
 */
export type MontoLeido =
  | { readonly tipo: 'ok'; readonly cents: number }
  | { readonly tipo: 'vacio' }
  | { readonly tipo: 'ambiguo' }
  | { readonly tipo: 'invalido' };

const SOLO_CIFRAS = /^\d+$/;
const DECIMAL = /^(\d+)[.,](\d{1,2})$/;
const COMAS_DE_MILES = /^[1-9]\d{0,2}(,\d{3})+(\.\d{1,2})?$/;
const PUNTOS_DE_MILES_COMA_DECIMAL = /^[1-9]\d{0,2}(\.\d{3})+,\d{1,2}$/;
const VARIOS_PUNTOS_DE_MILES = /^[1-9]\d{0,2}(\.\d{3}){2,}$/;
const UN_PUNTO_TRES_CIFRAS = /^[1-9]\d{0,2}\.\d{3}$/;
/** Lo que se lee, ya sin separadores de miles y con punto decimal: hasta siete cifras de pesos. */
const CANONICO = /^\d{1,7}(\.\d{1,2})?$/;

function canonico(limpio: string): string | 'ambiguo' | null {
  if (SOLO_CIFRAS.test(limpio)) return limpio;
  const d = DECIMAL.exec(limpio);
  if (d) return `${d[1]}.${d[2]}`;
  if (COMAS_DE_MILES.test(limpio)) return limpio.replace(/,/g, '');
  if (PUNTOS_DE_MILES_COMA_DECIMAL.test(limpio)) return limpio.replace(/\./g, '').replace(',', '.');
  if (VARIOS_PUNTOS_DE_MILES.test(limpio)) return limpio.replace(/\./g, '');
  if (UN_PUNTO_TRES_CIFRAS.test(limpio)) return 'ambiguo';
  return null;
}

export function leerMonto(texto: string): MontoLeido {
  const limpio = texto.trim().replace(/[$\s]/g, '');
  if (limpio === '') return { tipo: 'vacio' };
  const c = canonico(limpio);
  if (c === 'ambiguo') return { tipo: 'ambiguo' };
  if (c === null || !CANONICO.test(c)) return { tipo: 'invalido' };
  try {
    const cents = stringToCents(c);
    return Number.isSafeInteger(cents) && cents > 0 ? { tipo: 'ok', cents } : { tipo: 'invalido' };
  } catch {
    return { tipo: 'invalido' };
  }
}
