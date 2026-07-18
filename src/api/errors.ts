import { HttpError } from './http';
import { MockApiError } from './mock/mockApi';

/** Normaliza errores del adaptador (mock o real) al shape del backend. */
export function extractApiError(err: unknown): { code: string; extra: Record<string, unknown> } {
  if (err instanceof MockApiError) return { code: err.message, extra: err.extra };
  if (err instanceof HttpError) return { code: err.message, extra: err.body ?? {} };
  return { code: 'unknown', extra: {} };
}
