import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OLA 5C(b) · CORRECCIÓN · el inbox quedó fuera del apagado que el propio
 * commit se autoimpuso.
 *
 * `27b82ac` limpió saldo, movimientos y garantía wallet del mock con el
 * argumento de que la demo es un artefacto de enseñanza. Pero el seed de avisos
 * seguía sembrando "Se acreditaron $500.00 a tu saldo PayMe" y "Juan López te
 * envió $80.00", y `AvisosScreen` los renderiza sin ningún gate: el mismo
 * defecto que ese commit corrigió, en la superficie de al lado.
 *
 * ⚠️ NO confundir con la ola (d), que sigue FRENADA. Allá el problema es que el
 *    BACKEND REAL emite `topup_succeeded` y `transfer_received`; filtrar sólo
 *    del lado del front dejaría el hecho viajando por la red igual. Esto de acá
 *    es el SEED DEL MOCK, que es nuestro y se arregla ahora.
 */

const STORAGE_KEY = 'payme_mock_state_v1';

/**
 * Los CINCO tipos que el emisor dejó de mandar (`5e210fd`). Antes acá había
 * cuatro: faltaba `topup_failed`, y una lista paralela se queda corta sin que
 * nadie se entere. Un test de abajo la compara contra el juego del store, que a
 * su vez se compara contra el espejo en `walletRailNotifications.mirror.test.ts`.
 */
const TIPOS_WALLET = [
  'topup_succeeded', 'topup_failed', 'topup_pending',
  'transfer_received', 'transfer_sent',
];

function setupStorage(persisted?: unknown) {
  const m = new Map<string, string>();
  if (persisted !== undefined) m.set(STORAGE_KEY, JSON.stringify(persisted));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear(),
  });
  return m;
}

describe('avisos del riel saldo · apagados en el mock', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('esta lista es la misma que la del store, sin copias que se desincronicen', async () => {
    setupStorage();
    const { WALLET_NOTIFICATION_TYPES } = await import('./store');
    expect([...TIPOS_WALLET].sort()).toEqual([...WALLET_NOTIFICATION_TYPES].sort());
  });

  it('el inbox sembrado no trae ningún aviso de saldo', async () => {
    setupStorage();
    const { state } = await import('./store');

    expect(state.notifications.filter((n) => TIPOS_WALLET.includes(n.type))).toEqual([]);
  });

  it('conserva el faltante card-only y no duplica la invitación pendiente', async () => {
    setupStorage();
    const { state } = await import('./store');

    // El faltante cobrado a la GARANTÍA es card-only y se queda: apagar wallet
    // no puede llevarse puesto el aviso de que se te cobró algo de verdad.
    expect(state.notifications.some((n) => n.type === 'mesa_shortfall_charged')).toBe(true);
    expect(state.notifications.some((n) => n.type === 'invitation_received')).toBe(false);
    expect(state.pendingInvitations.some((i) => i.mesa_code === 'PA-4520')).toBe(true);
  });

  it('retira la fila duplicada también de una demo ya persistida', async () => {
    setupStorage();
    const { state: vigente } = await import('./store');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...vigente,
      notifications: [
        {
          id: 'duplicada',
          type: 'invitation_received',
          title: null,
          body: 'Sofía Fernández te invitó a una mesa',
          payload: { mesa_code: 'PA-4520', inviter_name: 'Sofía Fernández' },
          related_entity_type: 'invitation',
          related_entity_id: null,
          read_at: null,
          created_at: '2026-08-25T00:00:00.000Z',
        },
        {
          id: 'otra-invitacion',
          type: 'invitation_received',
          title: null,
          body: 'Luis te invitó a una mesa',
          payload: { mesa_code: 'PA-7777', inviter_name: 'Luis' },
          related_entity_type: 'invitation',
          related_entity_id: null,
          read_at: null,
          created_at: '2026-08-25T00:00:00.000Z',
        },
      ],
    }));
    vi.resetModules();
    const { state } = await import('./store');

    expect(state.notifications.map((n) => n.id)).toEqual(['otra-invitacion']);
  });

  /**
   * La mitad que de verdad importa: los avisos de una demo ya abierta viven en
   * SU localStorage, no en el seed. Sin migración, el apagado no alcanzaba a
   * ninguna persona que hubiera usado la demo antes — que son todas.
   */
  it('los limpia también de un estado YA PERSISTIDO', async () => {
    setupStorage({
      mesas: [],
      balance_cents: 0,
      notifications: [
        { id: 'n1', type: 'topup_succeeded', title: null, body: 'Se acreditaron $500.00 a tu saldo PayMe', payload: {}, related_entity_type: 'topup', related_entity_id: null, read_at: null, created_at: '2026-08-01T00:00:00.000Z' },
        { id: 'n2', type: 'transfer_received', title: null, body: 'Juan López te envió $80.00', payload: {}, related_entity_type: 'transfer', related_entity_id: null, read_at: null, created_at: '2026-08-01T00:00:00.000Z' },
        { id: 'n3', type: 'mesa_shortfall_charged', title: null, body: 'Se cobró el faltante', payload: {}, related_entity_type: 'mesa', related_entity_id: null, read_at: null, created_at: '2026-08-01T00:00:00.000Z' },
      ],
    });
    const { state } = await import('./store');

    expect(state.notifications.map((n) => n.id)).toEqual(['n3']);
  });

  /**
   * "Nada se borra" no es gratis: el compilador marca como muerto todo lo que
   * se desconecta, y la única salida que ofrece es borrarlo. La política hay
   * que sostenerla a mano, contra la herramienta.
   */
  it('el seed de avisos wallet SIGUE EXISTIENDO, durmiente y sin llamador', async () => {
    setupStorage();
    const { seedWalletNotifications, state } = await import('./store');

    const durmientes = seedWalletNotifications();
    expect(durmientes.map((n) => n.type)).toEqual(['transfer_received', 'topup_succeeded']);
    // Existe, pero nadie lo llama: no aparece en el estado.
    expect(state.notifications.some((n) => n.type === 'topup_succeeded')).toBe(false);
  });
});
