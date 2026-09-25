import { describe, expect, it } from 'vitest';
import { decodeNotificationPreferences } from './notificationPreferences';

const editable = { mode: 'editable', value: true, default: true } as const;
const catalogo = {
  notice_version: '2.5.5',
  channels: ['email'],
  items: [
    { type: 'account_recovery', group: 'seguridad', email: { mode: 'fixed_on' } },
    { type: 'invitation_received', group: 'mesas', email: editable },
    { type: 'friend_added', group: 'amigos', email: { mode: 'unavailable', reason: 'notice_pending' } },
    { type: 'tip_received', group: 'pagos', email: { mode: 'unavailable', reason: 'payments_disabled' } },
  ],
};

describe('AF2 · decodificador de /notifications/preferences (E1 v1)', () => {
  it('acepta el catálogo con los tres modos y lo proyecta tal cual', () => {
    expect(decodeNotificationPreferences(catalogo)).toEqual(catalogo);
  });

  it('un tipo que este front no conoce se descarta sin romper (lección dish_count)', () => {
    const conNuevo = { ...catalogo, items: [...catalogo.items, { type: 'algo_nuevo', group: 'mesas', email: editable }] };
    expect(decodeNotificationPreferences(conNuevo)).toEqual(catalogo);
  });

  it.each([
    [null, 'sin cuerpo'],
    [{ ...catalogo, extra: 1 }, 'clave de más arriba'],
    [{ notice_version: '2.5.5', items: [] }, 'sin channels'],
    [{ ...catalogo, channels: ['email', 'whatsapp'] }, 'un canal que no es sólo correo'],
    [{ ...catalogo, channels: [] }, 'sin canal'],
    [{ ...catalogo, notice_version: '' }, 'versión vacía'],
    [{ ...catalogo, items: [{ type: 'tip_received', group: 'pagos' }] }, 'ítem sin email'],
    [{ ...catalogo, items: [{ type: 'tip_received', group: 'otro', email: editable }] }, 'grupo desconocido'],
    [{ ...catalogo, items: [{ type: 'tip_received', group: 'pagos', email: { mode: 'editable', value: true } }] }, 'editable sin default'],
    [{ ...catalogo, items: [{ type: 'tip_received', group: 'pagos', email: { mode: 'fixed_on', value: true } }] }, 'fixed_on con clave de más'],
    [{ ...catalogo, items: [{ type: 'tip_received', group: 'pagos', email: { mode: 'unavailable', reason: 'otra' } }] }, 'motivo desconocido'],
    [{ ...catalogo, items: [{ type: 'tip_received', group: 'pagos', email: { mode: 'sms' } }] }, 'modo desconocido'],
    [{ ...catalogo, items: [catalogo.items[1], catalogo.items[1]] }, 'tipo repetido'],
  ])('falla cerrado ante %j (%s)', (value, _label) => {
    expect(() => decodeNotificationPreferences(value)).toThrow('notification_preferences_response_malformed');
  });
});
