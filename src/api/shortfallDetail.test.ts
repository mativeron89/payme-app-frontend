import { describe, expect, it, vi } from 'vitest';
import type { AppNotification } from './types';
import {
  LazyShortfallGate,
  decodeShortfallDetailResponse,
  loadShortfallDetailForSession,
  readShortfallNotificationDisclosure,
  shortfallIdentifiedCount,
} from './shortfallDetail';
import type { StoredSession } from './storage';

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION: StoredSession = {
  access_token: 'a1',
  refresh_token: 'r1',
  family_id: 'family-a',
  principal_id: UUID,
};
const notification = (payload: Record<string, unknown>, type = 'mesa_shortfall_charged'): AppNotification => ({
  id: 'n-1',
  type,
  title: null,
  body: 'Se cobró el faltante de la mesa ($210.00) a tu garantía.',
  payload,
  related_entity_type: 'mesa',
  related_entity_id: UUID,
  read_at: null,
  created_at: '2026-08-25T01:02:03.004Z',
});

const payload = (mesaCode = 'PA-12345', overrides: Record<string, unknown> = {}) => ({
  mesa_id: UUID,
  mesa_code: mesaCode,
  shortfall_cents: 21000,
  detail_available: true,
  ...overrides,
});

const available = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  detail_available: true,
  closed_at: '2026-08-25T01:02:03.004Z',
  shortfall_cents: 21000,
  unassigned_cents: 0,
  rows: [
    { display_name: 'Luis Cárdenas', due_cents: 13000 },
    { display_name: 'Valeria Ortiz', due_cents: 8000 },
  ],
  ...overrides,
});

const decode = (detail: unknown, expected = 21000) => (
  decodeShortfallDetailResponse({ shortfall_detail: detail }, expected)
);

describe('notificación de faltante · disclosure sólo post-cierre exacto', () => {
  it.each(['PA-123', 'PA-1234', 'PA-12345'])('acepta código owner de 3..5 dígitos: %s', (code) => {
    expect(readShortfallNotificationDisclosure(notification(payload(code))))
      .toEqual({ mesaCode: code, shortfallCents: 21000 });
  });

  it.each(['PA-12', 'PA-123456', 'pa-1234', 'PA_1234'])('rechaza código fuera del owner: %s', (code) => {
    expect(readShortfallNotificationDisclosure(notification(payload(code)))).toBeNull();
  });

  it.each([
    ['tipo temprano', notification(payload(), 'mesa_garantia_impagos')],
    ['payload histórico', notification({ shortfall_cents: 21000 })],
    ['detail false', notification(payload('PA-12345', { detail_available: false }))],
    ['monto cero', notification(payload('PA-12345', { shortfall_cents: 0 }))],
    ['monto unsafe', notification(payload('PA-12345', { shortfall_cents: Number.MAX_SAFE_INTEGER + 1 }))],
    ['mesa_id no UUID', notification(payload('PA-12345', { mesa_id: 'mesa' }))],
    ['entidad no mesa', { ...notification(payload()), related_entity_type: 'payment_attempt' }],
    ['entidad ausente', { ...notification(payload()), related_entity_id: null }],
    ['entidad distinta', {
      ...notification(payload()),
      related_entity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }],
    ['campo extra', notification(payload('PA-12345', { token: 'secret' }))],
  ])('%s nunca dispara fetch', (_label, value) => {
    expect(readShortfallNotificationDisclosure(value)).toBeNull();
  });
});

describe('detalle v1 · reconciliación exacta y sin identidades inventadas', () => {
  it('acepta rows+unassigned=shortfall y conserva nombres repetidos', () => {
    const detail = decode(available({
      rows: [
        { display_name: 'Alex', due_cents: 10000 },
        { display_name: 'Alex', due_cents: 9000 },
      ],
      unassigned_cents: 2000,
    }));
    expect(detail.detail_available).toBe(true);
    if (!detail.detail_available) throw new Error('control');
    expect(detail.rows.map((row) => row.display_name)).toEqual(['Alex', 'Alex']);
    expect(shortfallIdentifiedCount(detail)).toBe(2);
    expect(detail.unassigned_cents).toBe(2000);
  });

  it('conserva ZWJ/ZWNJ presentables en nombres sellados', () => {
    const detail = decode(available({
      rows: [{ display_name: 'नाम‍देव می‌خواهم', due_cents: 21000 }],
    }));
    expect(detail.detail_available).toBe(true);
    if (!detail.detail_available) throw new Error('control');
    expect(detail.rows[0]?.display_name).toBe('नाम‍देव می‌خواهم');
  });

  it.each([
    ['suma menor', available({ rows: [{ display_name: 'Luis', due_cents: 100 }] })],
    ['monto aviso distinto', available({ shortfall_cents: 20999 })],
    ['row cero', available({ rows: [{ display_name: 'Luis', due_cents: 0 }], unassigned_cents: 21000 })],
    ['nombre en blanco', available({ rows: [{ display_name: '   ', due_cents: 21000 }] })],
    ['control bidi', available({ rows: [{ display_name: 'Luis\u202Eadmin', due_cents: 21000 }] })],
    ['formato invisible', available({ rows: [{ display_name: 'Luis\u00ADadmin', due_cents: 21000 }] })],
    ['campo ID extra', available({ rows: [{ display_name: 'Luis', due_cents: 21000, user_id: UUID }] })],
    ['campo top extra', { ...available(), payer_count: 2 }],
    ['closed_at RFC', available({ closed_at: 'Tue, 25 Aug 2026 01:02:03 GMT' })],
    ['versión desconocida', available({ version: 2 })],
    ['overflow', available({
      shortfall_cents: Number.MAX_SAFE_INTEGER,
      unassigned_cents: Number.MAX_SAFE_INTEGER,
      rows: [{ display_name: 'Luis', due_cents: 1 }],
    })],
  ])('rechaza %s', (_label, detail) => {
    expect(() => decode(detail, 21000)).toThrow(/shortfall_detail_/);
  });

  it('unavailable admite null desconocido sin convertirlo en cero/asignación', () => {
    expect(decode({
      version: 1,
      detail_available: false,
      closed_at: '2026-08-25T01:02:03.004Z',
      shortfall_cents: null,
      unassigned_cents: null,
      rows: [],
    })).toEqual({
      version: 1,
      detail_available: false,
      closed_at: '2026-08-25T01:02:03.004Z',
      shortfall_cents: null,
      unassigned_cents: null,
      rows: [],
    });
  });

  it.each([
    ['monto distinto al aviso', 20000, null, []],
    ['unassigned fabricado', 21000, 21000, []],
    ['row en unavailable', 21000, null, [{ display_name: 'Luis', due_cents: 21000 }]],
  ])('unavailable rechaza %s', (_label, shortfall, unassigned, rows) => {
    expect(() => decode({
      version: 1,
      detail_available: false,
      closed_at: '2026-08-25T01:02:03.004Z',
      shortfall_cents: shortfall,
      unassigned_cents: unassigned,
      rows,
    })).toThrow('shortfall_detail_response_malformed');
  });

  it('rechaza wrappers/arrays malformados', () => {
    expect(() => decodeShortfallDetailResponse(available(), 21000)).toThrow('shortfall_detail_response_malformed');
    expect(() => decodeShortfallDetailResponse({ shortfall_detail: null }, 21000)).toThrow('shortfall_detail_response_malformed');
  });
});

describe('fetch lazy · una vez y con invalidación de lifecycle', () => {
  it('doble click/concurrencia entrega un solo ticket', () => {
    const gate = new LazyShortfallGate();
    const first = gate.start();
    expect(first).toBeTypeOf('number');
    expect(gate.start()).toBeNull();
    expect(gate.isCurrent(first!)).toBe(true);
  });

  it('reset por sesión/unmount invalida respuesta vieja y permite una nueva', () => {
    const gate = new LazyShortfallGate();
    const old = gate.start()!;
    gate.reset();
    expect(gate.isCurrent(old)).toBe(false);
    const current = gate.start()!;
    expect(current).not.toBe(old);
    expect(gate.isCurrent(current)).toBe(true);
  });

  it('doble click ejecuta una sola request y acepta refresh de la misma familia', async () => {
    const detail = decode(available());
    const rotated = {
      ...SESSION,
      access_token: 'a2',
      refresh_token: 'r2',
    };
    let release: ((value: typeof detail) => void) | undefined;
    const request = vi.fn(() => new Promise<typeof detail>((resolve) => { release = resolve; }));
    const gate = new LazyShortfallGate();
    const launch = () => {
      const generation = gate.start();
      if (generation === null) return Promise.resolve(null);
      return loadShortfallDetailForSession(SESSION, 'PA-12345', 21000, {
        request,
        loadCurrent: () => rotated,
        isCurrent: (candidate) => candidate.access_token === 'a2',
      });
    };

    const first = launch();
    const second = launch();
    expect(request).toHaveBeenCalledTimes(1);
    release?.(detail);
    await expect(first).resolves.toEqual({ kind: 'available', detail });
    await expect(second).resolves.toBeNull();
  });

  it('relogin/principal stale descarta respuesta y error sin cambiar el agregado', async () => {
    const detail = decode(available());
    const relogin = { ...SESSION, family_id: 'family-b', access_token: 'b1' };
    await expect(loadShortfallDetailForSession(SESSION, 'PA-12345', 21000, {
      request: async () => detail,
      loadCurrent: () => relogin,
      isCurrent: () => true,
    })).resolves.toEqual({ kind: 'stale' });
    await expect(loadShortfallDetailForSession(SESSION, 'PA-12345', 21000, {
      request: async () => { throw new Error('network'); },
      loadCurrent: () => relogin,
      isCurrent: () => true,
    })).resolves.toEqual({ kind: 'stale' });
  });

  it('404/red y snapshot unavailable caen al aviso agregado en la sesión vigente', async () => {
    const current = { ...SESSION };
    const dependencies = {
      loadCurrent: () => current,
      isCurrent: () => true,
    };
    await expect(loadShortfallDetailForSession(SESSION, 'PA-12345', 21000, {
      ...dependencies,
      request: async () => { throw new Error('not_found'); },
    })).resolves.toEqual({ kind: 'unavailable' });
    const unavailable = decode({
      version: 1,
      detail_available: false,
      closed_at: '2026-08-25T01:02:03.004Z',
      shortfall_cents: null,
      unassigned_cents: null,
      rows: [],
    });
    await expect(loadShortfallDetailForSession(SESSION, 'PA-12345', 21000, {
      ...dependencies,
      request: async () => unavailable,
    })).resolves.toEqual({ kind: 'unavailable' });
  });
});
