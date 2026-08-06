import type { HistoryEntry } from '../api/types';

/**
 * Agrupado por mes del historial de pagos propio — `SPEC_APP.md` §1.11,
 * pestaña Cuenta, bloque **Pagos**: *"Agrupado por mes, con encabezado de mes
 * pegajoso"*.
 *
 * Vive en su propio archivo y no adentro de la pantalla por la misma razón que
 * `mesaItemsView` y `friendRequestsView`: sin librería de render, lo que está
 * dentro de un componente **no se puede matar en la suite**. Acá el agrupado se
 * prueba entero —incluido el borde de fin de mes— sin abrir un navegador.
 *
 * ## El mes es el LOCAL, no el UTC, y es una decisión
 *
 * `GET /account/stats` computa "este mes" con `date_trunc('month', NOW())` en
 * un server UTC, y la torta de la Cuenta vieja lo espeja a propósito para que
 * los números cierren contra el agregado.
 *
 * Esta lista es otra cosa: no es un agregado, es la memoria de la persona. En
 * México (UTC−6) una cena del 31 de julio a las 20:00 se guarda como 1 de
 * agosto en UTC, y agruparla bajo "agosto" le discutiría al comensal una fecha
 * que él vivió. Se agrupa por mes local.
 *
 * **Consecuencia asumida:** en el borde exacto de fin de mes esta lista y el
 * "Este mes" de Estadísticas pueden no coincidir en un pago. Preferimos que la
 * lista diga la verdad de quien la mira; el agregado dice la del emisor, y
 * cada uno declara cuál es.
 */
export interface GrupoDeMes {
  /** `YYYY-MM` local, o `sin-fecha`. Estable: sirve de `key` de React. */
  key: string;
  /** "agosto de 2026". La MAYÚSCULA la pone el CSS, no este archivo. */
  label: string;
  entries: HistoryEntry[];
}

const SIN_FECHA = 'sin-fecha';

export function agruparPorMes(history: readonly HistoryEntry[], locale = 'es-MX'): GrupoDeMes[] {
  const grupos = new Map<string, GrupoDeMes>();

  for (const h of history) {
    const d = new Date(h.date);
    const valida = !Number.isNaN(d.getTime());
    const key = valida
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : SIN_FECHA;
    /**
     * Un pago con fecha ilegible **no se descarta**: se agrupa aparte. Es plata
     * que salió de la cuenta de alguien; esconderlo porque no pudimos parsear
     * un string sería exactamente el tipo de "vacío" que el sistema prohíbe.
     */
    const label = valida
      ? d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      : 'Sin fecha';

    const existente = grupos.get(key);
    if (existente) existente.entries.push(h);
    else grupos.set(key, { key, label, entries: [h] });
  }

  // El emisor ya devuelve `ORDER BY pa.created_at DESC`; el orden de inserción
  // del Map lo conserva. Sólo "Sin fecha" se manda al final: no tiene lugar en
  // una línea de tiempo, y arriba de todo parecería lo más reciente.
  const salida = [...grupos.values()];
  const i = salida.findIndex((g) => g.key === SIN_FECHA);
  if (i >= 0) salida.push(...salida.splice(i, 1));
  return salida;
}
