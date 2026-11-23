import { CODIGO_EJEMPLO } from '../../src/ayuda/ejemplo/fixtureEjemplo';
import type { MesaDetail } from '../../src/api/types';

export const CODIGO = 'PA-3121';
export interface Escenario {
  rol?: MesaDetail['my_role'];
  estado?: MesaDetail['status'];
  sinCapacidadFoto?: boolean;
  igual?: boolean;
  otroCodigo?: boolean;
  ejemplo?: boolean;
  invitado?: boolean;
  pagos?: boolean;
  pendiente?: boolean;
}

export function detalle(e: Escenario) {
  const code = e.ejemplo ? CODIGO_EJEMPLO : e.otroCodigo ? 'PA-4312' : CODIGO;
  const status = e.estado ?? 'open';
  return {
    id: 'mesa-ficticia', code, full_name: 'Mesa de prueba',
    restaurant: { id: 'local-ficticio', name: 'Restaurante inventado', category: 'other', address: null },
    my_role: e.rol === undefined ? 'participant' : e.rol,
    status,
    closure_reason: status === 'expired' ? 'closed_by_organizer' : null,
    division_mode: e.igual ? 'igual' : 'consumo', guarantee_mode: false,
    expected_participants: 2, original_participants: 2,
    informative_selection_capability: { contract: 'payme.app.informative-selections/v2', supported: !!e.igual, mutable: status === 'open' || status === 'partially_paid' },
    total_cents: 10000, total_display: '$100', paid_amount_cents: 0, tip_amount_cents: 0, tip_base_cents: 5000,
    expires_at: '2099-01-01T00:00:00Z', active_staff: [], ticket_image: { thumb: true, full: true },
    items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Plato de prueba', category: 'other',
      quantity: 1, price_cents: 10000, status: 'available', remaining_bps: 10000, my_bps: 0,
      my_releasable_bps: 0, informative_remaining_bps: 10000, locked_by_me: false, lock_expires_at: null }],
  } satisfies MesaDetail;
}
