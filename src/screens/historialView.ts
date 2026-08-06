import type { HistoryEntry, MesaStatus } from '../api/types';

/**
 * Vista pura de Historial — `SPEC_APP.md` §1.10: la entrada "Mesas" de la barra
 * ES el historial de mesas cerradas. Vive fuera de la pantalla por lo mismo que
 * `pagosView` y `mesaItemsView`: sin librería de render, lo que queda adentro
 * de un componente no se puede matar en la suite.
 *
 * ## Qué es "cerrada" no lo decide este archivo
 *
 * El spec manda *"la mesa abierta no se repite acá: ya está en Inicio"*, y qué
 * mesa está en Inicio lo define el CONTRATO: `GET /mesas/open` filtra
 * `m.status IN ('open','partially_paid')` (`contract-mirror/routes/mesas.js`).
 * Este set espeja esa lista — si el emisor la cambia, se cambia acá, no se
 * inventa un criterio propio. Antes de `mesa_status` (aditivo v2.42.0) esta
 * pantalla no podía distinguir y pintaba mesas vivas bajo un encabezado de mes:
 * el organizador que pagaba su parte veía su mesa DOS veces.
 */
const ABIERTAS_SEGUN_CONTRATO: ReadonlySet<MesaStatus> = new Set(['open', 'partially_paid']);

export function esMesaAbierta(status: MesaStatus): boolean {
  return ABIERTAS_SEGUN_CONTRATO.has(status);
}

/** Una mesa del historial: MIS pagos agrupados por `mesa_code`. */
export interface HistorialMesa {
  mesa_code: string;
  restaurant: string;
  category: string;
  /** Suma de MIS pagos en esa mesa (centavos enteros). */
  amount_cents: number;
  /** Fecha del último pago propio (ordena la lista y agrupa el mes). */
  date: string;
  /** Estado VIVO de la mesa (el emisor lo proyecta con JOIN, no es foto). */
  mesa_status: MesaStatus;
}

/**
 * `GET /account/history` trae UN RENGLÓN POR PAGO —granularidad fijada por el
 * emisor con test, porque la misma respuesta alimenta `PagosScreen`— y *pagar
 * varias partes* está ratificado: dos pagos a la misma mesa son dos renglones.
 * Agrupar es trabajo del front, y el estado se toma del renglón MÁS NUEVO:
 * como el emisor proyecta el estado vivo todos deberían coincidir, pero si un
 * backend viejo mandara fotos, la más reciente es la menos mentirosa.
 */
export function agruparPorMesa(entries: readonly HistoryEntry[]): HistorialMesa[] {
  const byCode = new Map<string, HistorialMesa>();
  for (const e of entries) {
    const prev = byCode.get(e.mesa_code);
    if (prev) {
      prev.amount_cents += e.amount_cents;
      if (e.date > prev.date) {
        prev.date = e.date;
        prev.mesa_status = e.mesa_status;
      }
    } else {
      byCode.set(e.mesa_code, {
        mesa_code: e.mesa_code,
        restaurant: e.restaurant,
        category: e.category,
        amount_cents: e.amount_cents,
        date: e.date,
        mesa_status: e.mesa_status,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Sólo las cerradas: se filtra la MESA agrupada, no el pago suelto. */
export function mesasCerradas(entries: readonly HistoryEntry[]): HistorialMesa[] {
  return agruparPorMesa(entries).filter((m) => !esMesaAbierta(m.mesa_status));
}

// ─── Franja horaria (§1.10) ────────────────────────────────

/**
 * Cuatro franjas, cada una con su ícono. El spec verificó que `date` es
 * timestamp completo (`payment_attempts.created_at`) y manda calcularla en el
 * front: cero gap de contrato.
 *
 * Los cortes son DECISIÓN DE ESTE FRONT, no contrato, y usan la hora LOCAL del
 * dispositivo — misma decisión que el mes de `pagosView`: esta lista es la
 * memoria de la persona, no un agregado del emisor. Cortes pensados para
 * horarios de restaurante en México (la comida fuerte es 14–16 h):
 * Mañana 6–12 · Mediodía 12–16 · Tarde 16–20 · Noche 20–6.
 */
export type Franja = 'manana' | 'mediodia' | 'tarde' | 'noche';

export const FRANJA_LABEL: Record<Franja, string> = {
  manana: 'Mañana',
  mediodia: 'Mediodía',
  tarde: 'Tarde',
  noche: 'Noche',
};

/** `null` si la fecha no parsea: la fila muestra la fecha cruda y cero franja. */
export function franjaDe(iso: string): Franja | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  if (h >= 6 && h < 12) return 'manana';
  if (h >= 12 && h < 16) return 'mediodia';
  if (h >= 16 && h < 20) return 'tarde';
  return 'noche';
}

// ─── Agrupado por mes ──────────────────────────────────────

export interface MesDeHistorial {
  /** `YYYY-MM` local, o `sin-fecha`. Estable: sirve de `key` de React. */
  key: string;
  /** "agosto de 2026". La MAYÚSCULA la pone el CSS, no este archivo. */
  label: string;
  mesas: HistorialMesa[];
}

const SIN_FECHA = 'sin-fecha';

/**
 * Mes LOCAL, no UTC — la decisión está argumentada entera en `pagosView.ts` y
 * acá se hereda: una cena del 31 de julio a las 20:00 en México se guarda como
 * 1 de agosto en UTC, y agruparla bajo "agosto" le discutiría al comensal una
 * fecha que él vivió. Una mesa con fecha ilegible no se descarta: va al grupo
 * "Sin fecha" — es plata que salió de la cuenta de alguien.
 */
export function agruparPorMes(mesas: readonly HistorialMesa[], locale = 'es-MX'): MesDeHistorial[] {
  const grupos = new Map<string, MesDeHistorial>();
  for (const m of mesas) {
    const d = new Date(m.date);
    const valida = !Number.isNaN(d.getTime());
    const key = valida
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : SIN_FECHA;
    const label = valida
      ? d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      : 'Sin fecha';
    const existente = grupos.get(key);
    if (existente) existente.mesas.push(m);
    else grupos.set(key, { key, label, mesas: [m] });
  }
  return [...grupos.values()];
}
