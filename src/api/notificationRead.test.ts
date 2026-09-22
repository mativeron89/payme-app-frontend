import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { mockMarkNotificationRead } from './mock/mockApi';
import { state } from './mock/store';
import type { AppNotification } from './types';

const API_SOURCE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const OWNER_ROUTE = readFileSync(new URL('../../contract-mirror/routes/notifications.js', import.meta.url), 'utf8');

const original = state.notifications.map((notification) => ({ ...notification }));

afterEach(() => {
  state.notifications = original.map((notification) => ({ ...notification }));
});

const notification = (id: string): AppNotification => ({
  id,
  type: 'mesa_expired',
  title: 'Mesa cerrada',
  body: 'Una mesa se cerró.',
  payload: { mesa_code: 'PA-1099' },
  related_entity_type: 'mesa',
  related_entity_id: null,
  read_at: null,
  created_at: '2026-09-21T12:00:00.000Z',
});

describe('M04 · lectura individual de notificaciones', () => {
  it('la fachada usa el PATCH individual existente y conserva read-all separado', () => {
    expect(OWNER_ROUTE).toMatch(/router\.patch\('\/:id\/read'/);
    expect(OWNER_ROUTE).toContain('notification_not_found_or_already_read');
    expect(API_SOURCE).toContain("httpRequest<unknown>('PATCH', `/notifications/${encodeURIComponent(id)}/read`)");
    expect(API_SOURCE).toContain("throw new Error('notification_read_response_malformed')");
    expect(API_SOURCE).toContain("httpRequest('PATCH', '/notifications/read-all')");
  });

  it('el mock marca exactamente una fila y rechaza repetirla con el mismo 404', async () => {
    state.notifications = [notification('n-1'), notification('n-2')];

    await mockMarkNotificationRead('n-1');
    expect(state.notifications[0]?.read_at).not.toBeNull();
    expect(state.notifications[1]?.read_at).toBeNull();
    await expect(mockMarkNotificationRead('n-1')).rejects.toMatchObject({
      status: 404,
      message: 'notification_not_found_or_already_read',
    });
  });

  it('no permite marcar una fila ajena al inbox actual', async () => {
    state.notifications = [notification('n-propia')];
    await expect(mockMarkNotificationRead('n-ajena')).rejects.toMatchObject({ status: 404 });
    expect(state.notifications[0]?.read_at).toBeNull();
  });
});
