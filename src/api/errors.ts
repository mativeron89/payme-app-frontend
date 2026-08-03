import { HttpError } from './http';
import { MonetarySafetyError } from './idempotency';
import { MockApiError } from './mock/mockApi';

/**
 * Normaliza errores del adaptador (mock o real) al shape del backend.
 *
 * `status` importa para B-06: un 4xx es un NO definitivo (el backend decidió y
 * liberó lo tomado), mientras que un 5xx, un timeout o la red caída no dicen
 * nada sobre si el cobro salió. Sin el status había que enumerar los códigos
 * uno por uno, y cualquier código nuevo del backend caía en "ambiguo" y
 * dejaba al usuario trabado sin poder pagar.
 */
export function extractApiError(err: unknown): {
  code: string;
  extra: Record<string, unknown>;
  status: number | null;
} {
  if (err instanceof MockApiError) return { code: err.message, extra: err.extra, status: err.status };
  if (err instanceof HttpError) return { code: err.message, extra: err.body ?? {}, status: err.status };
  if (err instanceof MonetarySafetyError) return { code: err.message, extra: {}, status: null };
  return { code: 'unknown', extra: {}, status: null };
}
