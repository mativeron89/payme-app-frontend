/**
 * El default del checkbox "Guardar esta tarjeta para la próxima" — UNA sola
 * fuente para las dos superficies (garantía en `CreateMesaFlow`, pago en
 * `MesaScreen`) y para el reset por mesa de `MesaScreen`.
 *
 * **DESMARCADO, ratificado por Mati el 2026-08-06 (vía Bibliotecario).**
 * Un casillero marcado por defecto hace la promesa sin que la persona la
 * pida, y mientras G-11 siga abierto —el backend NO cumple
 * `save_payment_method` en direct charges— la UI no puede prometer de oficio
 * algo que el riel incumple. Desmarcado, la promesa sólo existe si alguien
 * la elige. El checkbox NO se esconde: la función sigue mostrable, y quien
 * la marca la obtiene (en el mock; en real, G-11 sigue siendo el P0 de
 * release).
 *
 * Antes eran TRES literales `true` sueltos —dos `useState` y un reset por
 * mesa— y la lección de "un default en dos lugares" dice cómo termina eso:
 * se corrige uno y el comportamiento sobrevive en los otros. Una constante,
 * tres consumidores, un solo lugar que mutar.
 */
export const GUARDAR_TARJETA_DEFAULT = false;
