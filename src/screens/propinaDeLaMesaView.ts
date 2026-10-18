import type { ShareTotals, TipSetting } from '../api/miParte';
import { formatMXN } from '../utils/format';
import { stringToCents } from '../utils/money';

/**
 * D344 · la propina de la MESA, que fija sólo el organizador (P1). Lógica pura
 * del selector de «Compartir la mesa» y de «Tu mesa»; lo que vale es lo que
 * guarda y publica el dueño (`contract/mesa-mi-parte-v1.json`).
 *
 * 🔴 No es la propina del pago. `tipSelectorView.ts` arma la clave de
 * idempotencia de `POST /pay` (B-06) y no se toca ni se reusa acá: su `'unset'`
 * viaja como `{tip_bps: 0}` y un «Otro» inválido como 0, y en esta propina eso
 * sería fijar un 0 % que nadie eligió. Acá «sin fijar» es `null` y un monto
 * inválido no se manda.
 */

/** Los presets aprobados, en %. El 0 % es una opción de primera clase. */
export const PRESETS_DE_LA_MESA = [0, 5, 10, 15, 20] as const;
export type PresetDeLaMesa = (typeof PRESETS_DE_LA_MESA)[number];

/** El preset que corresponde a un `tip_bps`, o `null` si el organizador fijó otro valor (el PUT acepta 0..10000). */
export function presetDe(setting: TipSetting | null): PresetDeLaMesa | null {
  if (setting === null || !('tip_bps' in setting)) return null;
  return PRESETS_DE_LA_MESA.find((p) => p * 100 === setting.tip_bps) ?? null;
}

/** El cuerpo de un preset: 0/5/10/15/20 % son 0/500/1000/1500/2000 bps. */
export function settingDePreset(pct: PresetDeLaMesa): TipSetting {
  return { tip_bps: pct * 100 };
}

/**
 * «Otro» como se tipea: un monto fijo en pesos (`tip_cents`), nunca un % libre.
 * `null` si lo tipeado no es un monto (vacío, letras, más de dos decimales,
 * negativo): eso no se manda. La coma sola se lee como decimal, igual que en el
 * pago, para no convertir «12,50» en $1,250.
 */
export function settingDeOtro(texto: string): TipSetting | null {
  const limpio = texto.trim().replace(/,/g, '.');
  if (limpio === '') return null;
  let cents: number;
  try {
    cents = stringToCents(limpio);
  } catch {
    return null;
  }
  return Number.isSafeInteger(cents) && cents >= 0 ? { tip_cents: cents } : null;
}

/** Lo que se deja tipear en el campo de «Otro»: dígitos y un separador. */
export function sanearOtro(crudo: string): string {
  return crudo.replace(/,/g, '.').replace(/[^0-9.]/g, '');
}

/**
 * Un % para leer: 1000 → «10», 1250 → «12.5», 1234 → «12.34». Sólo para un
 * `tip_bps` que el dueño guardó; nunca se usa para inventar un % de un monto.
 */
export function porcentajeVisible(bps: number): string {
  const entero = Math.floor(bps / 100);
  const resto = bps % 100;
  if (resto === 0) return String(entero);
  return `${entero}.${String(resto).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * La propina de la mesa como la lee quien no la fija (R5): el % si es un % y el
 * monto si es «Otro», sin convertirlo. Sin fijar no se muestra ningún % (§1.5 bis).
 */
export function textoDeLaPropinaDeLaMesa(
  setting: TipSetting | null,
  t: (s: string, ...args: unknown[]) => string,
): string {
  if (setting === null) return t('Sin propina fijada');
  if ('tip_bps' in setting) return t('Propina de la mesa: {0} %', porcentajeVisible(setting.tip_bps));
  return t('Propina de la mesa: {0}', formatMXN(setting.tip_cents));
}

/**
 * «Otro» por encima de 3 veces los platos de la mesa (3 × `items_cents`, R1)
 * pide confirmación; una vez confirmado, se acepta (§1.5 bis, sin tope duro).
 * `>` estricto, como en el pago: 3 × exacto es el borde permitido. Sin
 * `share_totals` no hay con qué comparar y no se pregunta.
 */
export function pideConfirmarOtro(cents: number, totales: ShareTotals | null | undefined): boolean {
  return !!totales && totales.items_cents > 0 && cents > 3 * totales.items_cents;
}

/** El cargo por servicio impreso, para avisarle al organizador antes de que ponga otra propina. `null` si no hay. */
export function servicioImpreso(totales: ShareTotals | null | undefined): number | null {
  return totales && totales.service_cents > 0 ? totales.service_cents : null;
}

/** ¿Es la misma propina? Para no reenviar lo que ya quedó guardado. */
export function mismaPropina(a: TipSetting | null, b: TipSetting | null): boolean {
  if (a === null || b === null) return a === b;
  if ('tip_bps' in a) return 'tip_bps' in b && a.tip_bps === b.tip_bps;
  return 'tip_cents' in b && a.tip_cents === b.tip_cents;
}

/**
 * Cuándo el organizador ve el selector: mesa sin garantía, abierta y con los
 * pagos apagados, y la propina publicada por el dueño (la clave negociada vino
 * bien formada). Con la garantía las tres claves salen en null: sin este
 * filtro, una mesa con garantía ofrecería una propina que el dueño rechaza.
 */
export function puedeFijarPropina(input: {
  readonly esTitular: boolean;
  readonly pagosCortados: boolean;
  readonly guaranteeMode: boolean | undefined;
  readonly status: string;
  readonly tipSetting: TipSetting | null | undefined;
}): boolean {
  return input.esTitular
    && input.pagosCortados
    && input.guaranteeMode === false
    && input.status === 'open'
    && input.tipSetting !== undefined;
}

/**
 * Qué dice la pantalla cuando el dueño contesta una respuesta fija (no se
 * reintenta). Lo que se ve en el selector después es lo que quedó guardado.
 */
export function mensajeDeRechazo(
  rechazo: { readonly status: number | null; readonly codigo: string | null },
  t: (s: string, ...args: unknown[]) => string,
): string {
  switch (rechazo.codigo) {
    case 'not_mesa_organizer':
      return t('Sólo quien abrió la mesa puede cambiar la propina.');
    case 'tip_setting_not_applicable':
      return t('Esta mesa no admite fijar la propina.');
    case 'mesa_not_active':
      return t('La mesa ya cerró. Queda la propina que estaba guardada.');
    case 'mesa_not_found':
      return t('Esta mesa ya no está disponible.');
    case 'validation_error':
      return t('No pudimos guardar ese monto. Revisa la propina.');
    default:
      return rechazo.status === 404 ? t('Esta mesa ya no está disponible.') : t('No pudimos guardar la propina.');
  }
}

/**
 * Un rechazo que deja la mesa sin selector: no es del organizador o la mesa no
 * admite la propina. Los demás (cerrada, monto inválido, no encontrada) se
 * informan y el selector sigue o se vuelve a leer la mesa.
 */
export function rechazoOcultaElSelector(codigo: string | null): boolean {
  return codigo === 'not_mesa_organizer' || codigo === 'tip_setting_not_applicable';
}
