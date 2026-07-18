import type { OpenMesa, User } from '../types';

/**
 * Datos de demo del adaptador mock. Shapes idénticos al contrato
 * (contract-mirror/routes/*.js). Los uuids de restaurantes son fijos y
 * conocidos (G-01: el backend no tiene endpoint de restaurantes ni seed;
 * cuando se conecte el backend real habrá que alinear estos ids).
 */

export const MOCK_USER: User = {
  id: 'a0000000-0000-4000-8000-000000000001',
  payme_id: 'payme_mx_mati',
  email: 'demo@payme.mx',
  first_name: 'Mati',
  last_name: 'Verón',
};

export const MOCK_RESTAURANTS = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'La Parolaccia',
    category: 'italian',
    address: 'Roma Norte, CDMX',
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Hanzo Sushi',
    category: 'japanese',
    address: 'Condesa, CDMX',
  },
] as const;

/** Saldo inicial de demo: $1,250.00 (mismo número que la maqueta). */
export const MOCK_BALANCE_CENTS = 125000;

/** Dos mesas abiertas, como la maqueta s-open (montos de la maqueta). */
export function mockOpenMesas(now: Date): OpenMesa[] {
  const in29m = new Date(now.getTime() + 29 * 60_000 + 14_000).toISOString();
  const in12m = new Date(now.getTime() + 12 * 60_000 + 3_000).toISOString();
  return [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      code: 'PA-2847',
      full_name: 'Mesa PA-2847 - La Parolaccia',
      restaurant: { name: 'La Parolaccia', category: 'italian' },
      total_cents: 84000,
      paid_amount_cents: 63000,
      pct_paid: 75,
      status: 'partially_paid',
      expires_at: in29m,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000002',
      code: 'PA-3121',
      full_name: 'Mesa PA-3121 - Hanzo Sushi',
      restaurant: { name: 'Hanzo Sushi', category: 'japanese' },
      total_cents: 62000,
      paid_amount_cents: 31000,
      pct_paid: 50,
      status: 'open',
      expires_at: in12m,
    },
  ];
}
