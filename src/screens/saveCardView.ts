/**
 * El default del checkbox "Guardar esta tarjeta para la próxima" — UNA sola
 * fuente para las dos superficies (garantía en `CreateMesaFlow`, pago en
 * `MesaScreen`) y para el reset por mesa de `MesaScreen`.
 *
 * **DESMARCADO, ratificado por Mati el 2026-08-06 (vía Bibliotecario) — y la
 * decisión SOBREVIVE al cierre de G-11 (backend v2.46.0, 2026-08-06):** un
 * casillero marcado por defecto hace la promesa sin que la persona la pida,
 * y eso era cierto cuando el riel la incumplía y sigue siendo cierto ahora
 * que la cumple. Lo que cambió es lo otro: **quien lo marca, guarda DE
 * VERDAD, también bajo direct charge** — attach del pm_ fuente al Customer
 * de PayMe tras el éxito del cobro (sync o post-3DS vía webhook), misma
 * semántica que el vault. La promesa sólo existe si alguien la elige; desde
 * v2.46.0, elegirla se cumple.
 *
 * Antes eran TRES literales `true` sueltos —dos `useState` y un reset por
 * mesa— y la lección de "un default en dos lugares" dice cómo termina eso:
 * se corrige uno y el comportamiento sobrevive en los otros. Una constante,
 * tres consumidores, un solo lugar que mutar.
 */
export const GUARDAR_TARJETA_DEFAULT = false;
