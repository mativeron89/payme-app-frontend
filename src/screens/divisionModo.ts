/**
 * Las TRES formas de dividir de la UI y las DOS del contrato — la traducción
 * vive acá y en ningún otro lado.
 *
 * §1.3-bis (`diseno/SPEC_APP.md`, ratificada por Mati el 2026-08-20, etiqueta
 * literal «Sí, ratificar y armar el lote») agrega «Pagar el total» como tercera
 * forma. 🔴 **El contrato de App Backend NO tiene una tercera:**
 * `contract-mirror/schemas/index.js:199` declara
 * `division_mode: z.enum(['consumo','igual'])`, y no hace falta que la tenga:
 *
 *   «Pagar el total» = repartir el total entre N que cubren
 *   'igual'          = `splitEqual(total_cents, expected_participants)`
 *                      (`contract-mirror/routes/mesas.js:504`)
 *
 * Es la MISMA operación. Lo que cambia es qué significa N para la persona
 * —cuántos hay en la mesa vs. cuántos pagan—, y eso es copy, no contrato.
 * La confirmación no es el razonamiento: **el contrato ya exige
 * `expected_participants >= 2` para `igual`** (`schemas/index.js:218`), que es
 * exactamente el piso que §1.3-bis le asigna a «pagar el total» *«porque divide
 * lo mismo»*.
 *
 * ⚠️ **Consecuencia declarada y encolada como decisión de producto:** al viajar
 * las dos como `'igual'`, **el backend no puede distinguirlas**. Hoy ninguna
 * conducta depende de eso; si mañana el panel o la analítica quieren saber CÓMO
 * se dividió una mesa, recuperarlo sería cambio de contrato y los datos
 * históricos ya serían indistinguibles. No se resuelve acá.
 *
 * Todo lo de este archivo es PURO: se prueba sin navegador (jsdom está vetado).
 */

/** Lo que la persona elige en pantalla. */
export type ModoUI = 'consumo' | 'igual' | 'total';

/** Lo que viaja en `POST /mesas`. Es el enum del dueño, no uno nuestro. */
export type ModoContrato = 'consumo' | 'igual';

/**
 * 🔴 EL ÚNICO punto de traducción. Si esto se copia a un segundo lugar, las dos
 * copias se desincronizan calladas — la clase que ya mordió en esta app con un
 * default escrito dos veces.
 */
export function modoContrato(m: ModoUI): ModoContrato {
  return m === 'consumo' ? 'consumo' : 'igual';
}

/**
 * Piso del stepper. Sale del CONTRATO (`igual` exige >= 2), no de criterio:
 * las dos formas que reparten el total heredan 2; «cada uno lo suyo» va con 1
 * porque el número ahí sólo fija la base de propina.
 */
export function pisoDe(m: ModoUI): number {
  return modoContrato(m) === 'igual' ? 2 : 1;
}

/**
 * DOS títulos para TRES formas, no tres (§1.3-bis). «Pagar el total» comparte
 * título con «partes iguales» porque comparte semántica: reparte el mismo monto
 * entre los que se eligió. Devuelve la CLAVE en español, que es como funciona
 * el i18n de este repo.
 */
export function tituloStepper(m: ModoUI): string {
  return modoContrato(m) === 'igual' ? '¿Cuántos pagan?' : '¿Cuántos son en la mesa?';
}

/**
 * Qué significa el importe que se muestra bajo el stepper. En las dos formas
 * que reparten el total es lo que paga cada uno; en consumo es sólo la base de
 * propina — decir «c/u» ahí sería afirmar un importe que nadie va a pagar.
 */
export function reparteElTotal(m: ModoUI): boolean {
  return modoContrato(m) === 'igual';
}

/**
 * Al cambiar de forma, un N ya elegido puede dejar de ser válido (elegí 1 en
 * consumo y paso a una que exige 2). **Se vuelve a preguntar en vez de
 * corregirlo solo:** un número que la app ajusta sin avisar es un número que
 * nadie eligió, que es justo lo que el stepper de §1.4 existe para evitar.
 * `null` = sin elegir.
 */
export function participantesTrasCambio(n: number | null, destino: ModoUI): number | null {
  if (n === null) return null;
  return n < pisoDe(destino) ? null : n;
}
