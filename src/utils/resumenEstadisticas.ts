import type { ConsumoDelMes, BaseDeConsumo } from '../api/consumoDelMes';
import type { Evolucion, MesDeEvolucion } from '../api/evolucion';

const natural = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** El dueño trunca centavos. Cero visitas no acredita un promedio por visita. */
export function promedioPorVisita(total: number, visitas: number): number | null {
  return natural(total) && natural(visitas) && visitas > 0 ? Math.floor(total / visitas) : null;
}

export function promedioDelResumen(consumo: ConsumoDelMes): number | null {
  const esperado = promedioPorVisita(consumo.totalCents, consumo.visits);
  return esperado !== null && consumo.avgPerVisitCents === esperado ? esperado : null;
}

/** No consultar Intl al importar: una zona no soportada no puede impedir el login. */
function fechaMexico(fecha: Date): Record<string, number> | null {
  if (!Number.isFinite(fecha.getTime())) return null;
  try {
    const calendario = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    });
    return Object.fromEntries(calendario.formatToParts(fecha)
      .filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  } catch {
    // Sin calendario mexicano acreditado no hay comparación; nunca sustituirlo por UTC.
    return null;
  }
}

export interface ComparacionCompleta {
  readonly anterior: MesDeEvolucion;
  readonly reciente: MesDeEvolucion;
  readonly promedioAnterior: number | null;
  readonly promedioReciente: number | null;
  readonly diferenciaCents: number;
  readonly diferenciaVisitas: number;
  readonly diferenciaPromedioCents: number | null;
  readonly porcentaje: number | null;
}

/**
 * Evolución acredita seis meses calendario, incluido el actual de México.
 * Sólo comparamos los dos anteriores: no usamos el mes parcial ni el período
 * agregado del selector. La misma base y MXN son condiciones del contrato.
 */
export function compararMesesCompletos(
  evolucion: Evolucion | null,
  base: BaseDeConsumo,
  ahora: Date,
): ComparacionCompleta | null {
  const hoy = fechaMexico(ahora);
  if (!evolucion || !hoy || evolucion.basis !== base || evolucion.months.length !== 6) return null;
  const actual = hoy.year * 12 + hoy.month - 1;
  for (const [i, mes] of evolucion.months.entries()) {
    const fecha = new Date(mes.monthStart);
    const partes = fechaMexico(fecha);
    if (!partes || fecha.toISOString().slice(0, 10) !== mes.monthStart.slice(0, 10) || partes.day !== 1 || partes.hour !== 0 || partes.minute !== 0 || partes.second !== 0
      || fecha.getUTCMilliseconds() !== 0 || partes.year * 12 + partes.month - 1 !== actual - 5 + i
      || !natural(mes.totalCents) || !natural(mes.visits)) return null;
  }
  const anterior = evolucion.months[3];
  const reciente = evolucion.months[4];
  const promedioAnterior = promedioPorVisita(anterior.totalCents, anterior.visits);
  const promedioReciente = promedioPorVisita(reciente.totalCents, reciente.visits);
  const diferenciaCents = reciente.totalCents - anterior.totalCents;
  // Porcentaje a una décima; multiplicar centavos como enteros evita overflow.
  const numerador = BigInt(Math.abs(diferenciaCents)) * 1000n;
  const denominador = BigInt(anterior.totalCents);
  const porcentaje = denominador > 0n
    ? Math.sign(diferenciaCents) * Number((numerador + denominador / 2n) / denominador) / 10
    : null;
  return {
    anterior, reciente, promedioAnterior, promedioReciente, diferenciaCents, porcentaje,
    diferenciaVisitas: reciente.visits - anterior.visits,
    diferenciaPromedioCents: promedioAnterior !== null && promedioReciente !== null
      ? promedioReciente - promedioAnterior : null,
  };
}
