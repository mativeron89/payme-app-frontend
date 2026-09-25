import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { NotificacionesView } from './NotificacionesScreen';
import type { NotificationPreferencesResponse } from '../api/types';

const prefs: NotificationPreferencesResponse = {
  notice_version: '2.5.5',
  channels: ['email'],
  items: [
    { type: 'account_recovery', group: 'seguridad', email: { mode: 'fixed_on' } },
    { type: 'invitation_received', group: 'mesas', email: { mode: 'editable', value: true, default: true } },
    { type: 'mesa_expired', group: 'mesas', email: { mode: 'editable', value: false, default: true } },
    { type: 'friend_added', group: 'amigos', email: { mode: 'unavailable', reason: 'notice_pending' } },
    { type: 'tip_received', group: 'pagos', email: { mode: 'unavailable', reason: 'payments_disabled' } },
  ],
};

function render(estado: 'cargando' | 'ok' | 'error', datos: NotificationPreferencesResponse | null = prefs): string {
  return renderToStaticMarkup(
    <IdiomaProvider>
      <NotificacionesView
        userName="Mati"
        email="mati@payme.mx"
        estado={estado}
        prefs={datos}
        busyType={null}
        onToggle={() => undefined}
        onExplicarFijo={() => undefined}
        onReintentar={() => undefined}
      />
    </IdiomaProvider>,
  );
}

describe('AF2 · Configuración › Notificaciones · los tres modos y los tres estados', () => {
  it('con datos: grupos, títulos traducidos por tipo y el control de cada modo', () => {
    const html = render('ok');
    expect(html).toContain('Notificaciones');
    expect(html).toContain('mati@payme.mx');
    expect(html).toContain('Seguridad');
    expect(html).toContain('Te invitan a una mesa');
    // editable → interruptor con su estado; fixed_on → texto; unavailable → motivo.
    expect(html).toMatch(/role="switch"[^>]*checked=""/);
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect(html).toContain('Siempre por correo');
    expect(html).toContain('Disponible cuando haya pagos');
    expect(html).toContain('Disponible con el próximo Aviso');
    // Sin WhatsApp ni SMS, ni como «próximamente» (decisión 33).
    expect(html).not.toMatch(/WhatsApp|SMS/);
  });

  it('cargando y error lo dicen sin inventar filas', () => {
    expect(render('cargando', null)).toContain('Cargando');
    const error = render('error', null);
    expect(error).toContain('No pudimos leer tus preferencias de avisos.');
    expect(error).toContain('Reintentar');
    expect(error).not.toContain('role="switch"');
  });
});
