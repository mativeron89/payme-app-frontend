/**
 * D360-5b · «hay textos que son 100% mayuscula, [...] dejar únicamente la primera
 * letra en mayuscula y el resto en minúscula» (literal de Mati).
 *
 * El nombre de un plato que viene TODO en mayúsculas se MUESTRA con la primera
 * letra en mayúscula y el resto en minúscula. Es sólo al mostrar: no cambia la
 * «lectura de siempre» del OCR, ni lo que se manda al crear la mesa, ni el campo
 * que se edita, ni «En el ticket decía…», ni `data-plato`, ni ninguna clave.
 * Por eso arregla también las mesas ya guardadas (el dueño guarda el nombre tal
 * cual).
 *
 * Deja sin efecto, en lo visible, el «todo o nada» del punto D3 del plan
 * `AB-OCR-PAGOS-ORTOGRAFIA-20261009` (el dueño sólo corrige un nombre en
 * mayúsculas si conoce TODAS sus palabras): el dueño no cambia.
 *
 * - Sólo actúa si el nombre tiene alguna mayúscula y NINGUNA minúscula: un
 *   nombre mixto («Coca Cola 600ML», lo que ya corrigió el dueño o lo que tipeó
 *   la persona) se deja tal cual.
 * - La mayúscula va en la primera letra que EMPIEZA una palabra, no en la
 *   primera letra a secas: «355ML COCA» → «355ml Coca» (y no «355Ml coca»).
 *
 * D370 · Mati eligió «Sí, unidades y siglas»: las unidades («900 ML»), las
 * siglas («IPA») de una lista corta propia y lo pegado a una cifra («600ML»)
 * quedan como vinieron, igual que hace el dueño cuando corrige. Así en la misma
 * mesa no conviven «600 ML» y «900 ml». El nombre del restaurante no se toca.
 */

/**
 * D370 · las unidades y siglas de la lista de abajo y las palabras pegadas a una
 * cifra quedan como vinieron («Agua mineral 600 ML», «Cerveza IPA»).
 */
export const CONSERVAR_UNIDADES_Y_SIGLAS = true;

/**
 * Unidades y siglas que se conservan en mayúsculas (D370). Lista propia y corta
 * de la app: no es una copia del diccionario del dueño (D268), que no es
 * contrato.
 */
export const UNIDADES_Y_SIGLAS: ReadonlySet<string> = new Set([
  'ML', 'L', 'LT', 'LTS', 'CL', 'KG', 'G', 'GR', 'GRS', 'OZ', 'PZA', 'PZAS', 'PZ', 'ORD',
  'IPA', 'BBQ',
]);

const LOCALE = 'es-MX';

function soloMayusculas(nombre: string): boolean {
  return /\p{Lu}/u.test(nombre) && !/\p{Ll}/u.test(nombre);
}

function conservada(palabra: string): boolean {
  return UNIDADES_Y_SIGLAS.has(palabra) || /\p{N}/u.test(palabra);
}

/**
 * El nombre de un plato como se muestra. `conservar` es para las pruebas del
 * literal sin excepciones; la app usa el valor vigente (D370).
 */
export function nombreDePlato(nombre: string, conservar: boolean = CONSERVAR_UNIDADES_Y_SIGLAS): string {
  if (!soloMayusculas(nombre)) return nombre;
  // Se recorre por palabras conservando los espacios tal cual vinieron.
  const partes = nombre.split(/(\s+)/);
  let primeraHecha = false;
  return partes.map((parte) => {
    if (parte === '' || /^\s+$/.test(parte)) return parte;
    if (conservar && conservada(parte)) {
      // Una palabra conservada queda como vino. Si EMPIEZA con letra («IPA»),
      // ya es la primera palabra con mayúscula; pegada a una cifra («2X1»), no.
      if (/^\p{L}/u.test(parte)) primeraHecha = true;
      return parte;
    }
    const minuscula = parte.toLocaleLowerCase(LOCALE);
    if (primeraHecha) return minuscula;
    // La primera letra que empieza una palabra: al principio, o después de
    // algo que no es letra ni cifra («½ ORDEN» → «½ Orden»; «355ML» no).
    const conMayuscula = minuscula.replace(/(^|[^\p{L}\p{N}])(\p{L})/u, (_m, antes: string, letra: string) => {
      primeraHecha = true;
      return antes + letra.toLocaleUpperCase(LOCALE);
    });
    return conMayuscula;
  }).join('');
}
