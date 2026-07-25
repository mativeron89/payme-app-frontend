import type { User } from '../types';

/**
 * Semillas base del mock. Los uuids de restaurantes son fijos y conocidos
 * (G-01: el backend no tiene endpoint de restaurantes ni seed; cuando se
 * conecte el backend real habrá que alinear estos ids). El resto del estado
 * de demo vive en store.ts.
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

/**
 * Stripe Connect (v2.24): restaurantes con cuenta conectada ACTIVA — sus
 * cobros con tarjeta son direct charges (el restaurante es el merchant of
 * record y el 3DS se confirma sobre su cuenta). Los demás siguen por el riel
 * de plataforma; las dos formas conviven, restaurante por restaurante.
 *
 * Hanzo Sushi va conectado y La Parolaccia NO, a propósito: así la demo del
 * video (que usa La Parolaccia) queda idéntica y el riel directo se puede
 * probar entrando con el QR de Hanzo (`?r=b0000000-0000-4000-8000-000000000002`).
 * El `acct_…` es de mentira: en el mock no se carga Stripe.js.
 */
export const MOCK_CONNECTED_ACCOUNTS: Record<string, string> = {
  'b0000000-0000-4000-8000-000000000002': 'acct_mock_hanzo',
};
