import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idsConFotoDeInvitacion, invitacionesMostrables } from './invitacionAdmision';
import { claveInvitador, claveInvitadorDeInvitacion, PREFIJO_INVITADOR } from '../api/fotosEnMemoria';
import { mockInvitationInviterAvatar, mockPendingInvitations } from '../api/mock/mockApi';
import { state } from '../api/mock/store';
import { saveSession, type StoredSession } from '../api/storage';

/**
 * E174-3B · decisión 174 · la foto de quien invita en la tarjeta «Te invitaron»
 * y en la burbuja de Inicio, contra el contrato del dueño v2.149.0 (§4b,
 * espejado en `06fa648`).
 */
const API_SOURCE = readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');
const OWNER_INVITATIONS = readFileSync(new URL('../../contract-mirror/routes/invitations.js', import.meta.url), 'utf8');

const base = {
  id: 'inv-1', mesa_code: 'PA-1', restaurant_name: 'La Parolaccia',
  inviter_first_name: 'Sofía', inviter_last_name: 'Fernández',
  created_at: '2026-10-05T01:00:00.000Z', mesa_joinable: true, mesa_status: 'open',
};

describe('E174-3B · la pista en GET /invitations', () => {
  it('🔴 se pide la foto sólo con has_inviter_avatar exactamente true', () => {
    const [con] = invitacionesMostrables([{ ...base, has_inviter_avatar: true }]);
    expect(con!.fotoDelInvitador).toBe(true);
    for (const raro of [false, 'true', 1, null, undefined]) {
      const [fila] = invitacionesMostrables([{ ...base, has_inviter_avatar: raro }]);
      expect(fila!.fotoDelInvitador, String(raro)).toBe(false);
    }
    // Dueño anterior a v2.149.0: sin la clave, sin foto.
    const [vieja] = invitacionesMostrables([base]);
    expect(vieja!.fotoDelInvitador).toBe(false);
  });

  it('las iniciales salen de nombre y apellido; con uno solo, ése; sin ninguno, null', () => {
    expect(invitacionesMostrables([base])[0]!.invitadorCompleto).toBe('Sofía Fernández');
    expect(invitacionesMostrables([{ ...base, inviter_last_name: null }])[0]!.invitadorCompleto).toBe('Sofía');
    expect(invitacionesMostrables([{ ...base, inviter_first_name: 7, inviter_last_name: '' }])[0]!.invitadorCompleto).toBeNull();
  });

  it('idsConFotoDeInvitacion: sólo las que traen la pista', () => {
    const lista = invitacionesMostrables([
      { ...base, id: 'a', has_inviter_avatar: true },
      { ...base, id: 'b', has_inviter_avatar: false },
      { ...base, id: 'c' },
    ]);
    expect([...idsConFotoDeInvitacion(lista)]).toEqual(['a']);
  });

  it('la clave por invitación no se confunde con la de la notificación (ni la poda)', () => {
    expect(claveInvitadorDeInvitacion('x')).not.toBe(claveInvitador('x'));
    expect(claveInvitadorDeInvitacion('x').startsWith(PREFIJO_INVITADOR)).toBe(false);
  });
});

describe('E174-3B · contra el código del dueño', () => {
  it('🔴 el dueño publica la pista y la ruta de la foto, con su 404 no oracular', () => {
    expect(OWNER_INVITATIONS).toContain('has_inviter_avatar: conFoto[i],');
    expect(OWNER_INVITATIONS).toContain("router.get('/:id/inviter-avatar', async");
    expect(OWNER_INVITATIONS).toContain("res.setHeader('Cache-Control', 'private, no-store');");
    expect(OWNER_INVITATIONS).toContain("res.vary('Authorization');");
    expect(OWNER_INVITATIONS).toContain("JSON.stringify({ error: 'avatar_not_found' })");
  });

  it('la fachada pide esa ruta con la misma política que la foto de un amigo', () => {
    expect(API_SOURCE).toMatch(
      /getInvitationInviterAvatar: \(invitationId, expectedSession\) => httpPrivateAvatarRequest\(\s*`\/invitations\/\$\{encodeURIComponent\(invitationId\)\}\/inviter-avatar`, expectedSession, 15_000,\s*\{ requireAuthorizationVary: true, forbidEtag: true \},/,
    );
  });
});

describe('E174-3B · el mock decide por sí mismo', () => {
  const SESION: StoredSession = { access_token: 'a', refresh_token: 'r', family_id: 'f', principal_id: 'p' };
  const original = state.pendingInvitations.map((i) => ({ ...i }));
  beforeEach(() => {
    const almacen = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => almacen.get(k) ?? null,
      setItem: (k: string, v: string) => { almacen.set(k, v); },
      removeItem: (k: string) => { almacen.delete(k); },
    });
    saveSession(SESION);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    state.pendingInvitations = original.map((i) => ({ ...i }));
  });

  it('la lista trae la pista con el mismo predicado que la ruta', async () => {
    const pendiente = state.pendingInvitations[0]!;
    state.pendingInvitations = [
      { ...pendiente, id: 'con-foto', inviter_payme_id: 'payme_mx_sofi', expires_at: '2999-01-01T00:00:00.000Z' },
      { ...pendiente, id: 'sin-foto', inviter_payme_id: 'payme_mx_maru', expires_at: '2999-01-01T00:00:00.000Z' },
    ];
    const { invitations } = await mockPendingInvitations();
    const pista = Object.fromEntries(invitations.map((i) => [i.id, i.has_inviter_avatar]));
    expect(pista).toEqual({ 'con-foto': true, 'sin-foto': false });
    const { blob } = await mockInvitationInviterAvatar('con-foto', SESION);
    expect(blob.type).toBe('image/jpeg');
    await expect(mockInvitationInviterAvatar('sin-foto', SESION)).rejects.toMatchObject({ status: 404, message: 'avatar_not_found' });
    await expect(mockInvitationInviterAvatar('no-existe', SESION)).rejects.toMatchObject({ status: 404, message: 'avatar_not_found' });
  });
});
