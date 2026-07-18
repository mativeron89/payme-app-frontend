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
