import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBorradoDeNotificaciones, pideFotoDelInvitador } from './borrarNotificaciones';
import {
  mockDeleteAllNotifications,
  mockDeleteNotification,
  mockInviterAvatar,
  mockNotifications,
  mockUnreadCount,
} from './mock/mockApi';
import { state } from './mock/store';
import type { AppNotification } from './types';
import { saveSession, type StoredSession } from './storage';

/**
 * E174-2 / E174-3 · decisión 174 · contra el contrato del dueño v2.148.0
 * (`docs/CONTRATO_E173_E174_FOTOS_Y_NOTIFICACIONES.md` @ 91aacdd).
 */
const API_SOURCE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
/** El código del dueño, espejado en 673156d (v2.148.0). */
const OWNER_NOTIFICATIONS = readFileSync(new URL('../../contract-mirror/routes/notifications.js', import.meta.url), 'utf8');
const OWNER_FRIENDS = readFileSync(new URL('../../contract-mirror/routes/friends.js', import.meta.url), 'utf8');
const OWNER_INVITATIONS = readFileSync(new URL('../../contract-mirror/services/invitationAuthority.js', import.meta.url), 'utf8');

const original = state.notifications.map((n) => ({ ...n }));
afterEach(() => {
  state.notifications = original.map((n) => ({ ...n }));
});

const aviso = (id: string, extra: Partial<AppNotification> = {}): AppNotification => ({
  id,
  type: 'mesa_expired',
  title: 'Mesa cerrada',
  body: 'Una mesa se cerró.',
  payload: null,
  related_entity_type: 'mesa',
  related_entity_id: null,
  read_at: null,
  created_at: '2026-10-04T12:00:00.000Z',
  ...extra,
});

const invitacion = (id: string, payload: Record<string, unknown>): AppNotification => aviso(id, {
  type: 'invitation_received',
  title: 'Te invitaron a una mesa',
  body: 'Sofía Fernández te invitó a una mesa',
  payload: { mesa_code: 'PA-4520', inviter_name: 'Sofía Fernández', ...payload },
  related_entity_type: 'invitation',
  related_entity_id: `inv-${id}`,
});

describe('E174-2 · DELETE /notifications → { deleted_count }', () => {
  it('acepta un entero ≥ 0, también 0', () => {
    expect(decodeBorradoDeNotificaciones({ deleted_count: 3 })).toEqual({ deleted_count: 3 });
    expect(decodeBorradoDeNotificaciones({ deleted_count: 0 })).toEqual({ deleted_count: 0 });
  });

  it.each([
    ['null', null],
    ['un array', []],
    ['sin la clave', {}],
    ['negativo', { deleted_count: -1 }],
    ['decimal', { deleted_count: 1.5 }],
    ['texto', { deleted_count: '3' }],
    ['una clave de más', { deleted_count: 1, deleted: true }],
  ])('🔴 %s no acredita el borrado', (_caso, raw) => {
    expect(() => decodeBorradoDeNotificaciones(raw)).toThrow('notification_delete_all_response_malformed');
  });

  it('🔴 el dueño tiene las dos rutas y las respuestas que la fachada espera', () => {
    expect(OWNER_NOTIFICATIONS).toContain("router.delete('/', async");
    expect(OWNER_NOTIFICATIONS).toContain('res.json({ deleted_count: count });');
    expect(OWNER_NOTIFICATIONS).toContain("router.delete('/:id', async");
    expect(OWNER_NOTIFICATIONS).toContain("res.json({ deleted: true });");
    expect(OWNER_NOTIFICATIONS).toContain("res.status(404).json({ error: 'notification_not_found' })");
  });

  it('la fachada usa las dos rutas del dueño, y valida el `{ deleted: true }` del borrado por id', () => {
    expect(API_SOURCE).toContain("httpRequest<unknown>('DELETE', `/notifications/${encodeURIComponent(id)}`)");
    expect(API_SOURCE).toContain("throw new Error('notification_delete_response_malformed')");
    expect(API_SOURCE).toContain("await httpRequest<unknown>('DELETE', '/notifications'),");
  });

  it('el mock borra sólo esa fila, la segunda vez da 404, y el contador de no leídas baja', async () => {
    state.notifications = [aviso('n-1'), aviso('n-2', { read_at: '2026-10-04T13:00:00.000Z' })];
    expect((await mockUnreadCount()).unread_count).toBe(1);
    await mockDeleteNotification('n-1');
    expect(state.notifications.map((n) => n.id)).toEqual(['n-2']);
    expect((await mockUnreadCount()).unread_count).toBe(0);
    await expect(mockDeleteNotification('n-1')).rejects.toMatchObject({ status: 404, message: 'notification_not_found' });
  });

  it('el mock borra todas y cuenta cuántas eran; sin ninguna, 0', async () => {
    state.notifications = [aviso('n-1'), aviso('n-2')];
    expect(decodeBorradoDeNotificaciones(await mockDeleteAllNotifications())).toEqual({ deleted_count: 2 });
    expect((await mockNotifications()).notifications).toEqual([]);
    expect(decodeBorradoDeNotificaciones(await mockDeleteAllNotifications())).toEqual({ deleted_count: 0 });
  });
});

describe('E174-3 · la foto de quien invita', () => {
  it('🔴 se pide sólo con una invitación recibida y la pista exactamente en true', () => {
    expect(pideFotoDelInvitador(invitacion('i-1', { has_inviter_avatar: true }))).toBe(true);
    // Notificaciones previas a v2.148.0: sin la clave ⇒ false.
    expect(pideFotoDelInvitador(invitacion('i-2', {}))).toBe(false);
    expect(pideFotoDelInvitador(invitacion('i-3', { has_inviter_avatar: false }))).toBe(false);
    expect(pideFotoDelInvitador(invitacion('i-4', { has_inviter_avatar: 'true' }))).toBe(false);
    expect(pideFotoDelInvitador(aviso('n-1', { payload: { has_inviter_avatar: true } }))).toBe(false);
    expect(pideFotoDelInvitador(aviso('n-2', { type: 'invitation_received', payload: null }))).toBe(false);
  });

  it('🔴 el dueño: la ruta de la foto, su 404 no oracular y la pista en el payload', () => {
    expect(OWNER_NOTIFICATIONS).toContain("router.get('/:id/inviter-avatar', async");
    expect(OWNER_NOTIFICATIONS).toContain("res.setHeader('Cache-Control', 'private, no-store');");
    expect(OWNER_NOTIFICATIONS).toContain("res.vary('Authorization');");
    expect(OWNER_NOTIFICATIONS).toContain("JSON.stringify({ error: 'avatar_not_found' })");
    expect(OWNER_INVITATIONS).toContain('has_inviter_avatar: hasInviterAvatar,');
    // `has_avatar` sólo en la lista de amigos, con el predicado de la ruta de la foto.
    expect(OWNER_FRIENDS).toContain('has_avatar: conFoto.has(f.id),');
  });

  it('la fachada pide la ruta del dueño con la misma política que la foto de un amigo', () => {
    expect(API_SOURCE).toMatch(
      /getInviterAvatar: \(notificationId, expectedSession\) => httpPrivateAvatarRequest\(\s*`\/notifications\/\$\{encodeURIComponent\(notificationId\)\}\/inviter-avatar`, expectedSession, 15_000,\s*\{ requireAuthorizationVary: true, forbidEtag: true \},/,
    );
  });

  describe('el mock decide por sí mismo (la pista no autoriza)', () => {
    // Sesión vigente de verdad: sin ella el mock responde 401, y un negativo
    // pasaría por la causa equivocada.
    const SESION: StoredSession = { access_token: 'a', refresh_token: 'r', family_id: 'f', principal_id: 'p' };
    beforeEach(() => {
      const almacen = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => almacen.get(k) ?? null,
        setItem: (k: string, v: string) => { almacen.set(k, v); },
        removeItem: (k: string) => { almacen.delete(k); },
      });
      saveSession(SESION);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('control positivo: quien invita tiene foto visible ⇒ bytes JPEG', async () => {
      state.notifications = [invitacion('i-1', { has_inviter_avatar: true, inviter_payme_id: 'payme_mx_sofi' })];
      const { blob } = await mockInviterAvatar('i-1', SESION);
      expect(blob.type).toBe('image/jpeg');
      expect(blob.size).toBeGreaterThan(0);
    });

    it.each([
      ['quien invita no tiene foto visible, aunque la pista diga true', 'i-1',
        [invitacion('i-1', { has_inviter_avatar: true, inviter_payme_id: 'payme_mx_maria' })]],
      ['la notificación no existe', 'i-x',
        [invitacion('i-1', { has_inviter_avatar: true, inviter_payme_id: 'payme_mx_sofi' })]],
      ['es de otro tipo', 'n-1',
        [aviso('n-1', { payload: { inviter_payme_id: 'payme_mx_sofi', has_inviter_avatar: true } })]],
    ])('🔴 404 avatar_not_found si %s', async (_caso, id, filas) => {
      state.notifications = filas;
      await expect(mockInviterAvatar(id, SESION)).rejects.toMatchObject({ status: 404, message: 'avatar_not_found' });
    });
  });
});
