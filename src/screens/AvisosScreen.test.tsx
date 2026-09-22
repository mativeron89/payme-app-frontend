import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reconciledReadDestination } from './AvisosScreen';
import type { AppNotification } from '../api/types';

const SOURCE = readFileSync(new URL('./AvisosScreen.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

describe('M04 · Avisos', () => {
  it('confirma la lectura individual antes de navegar y conserva error visible', () => {
    const handler = SOURCE.match(/async function openNotification[\s\S]*?\n  }\n\n  const hasUnread/)?.[0] ?? '';
    const patch = handler.indexOf('await api.markNotificationRead(notification.id)');
    const update = handler.indexOf('setNotifs');
    const navigation = handler.lastIndexOf("navigate('mesa', destino)");

    expect(patch).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(patch);
    expect(navigation).toBeGreaterThan(update);
    expect(handler).not.toContain('markAllNotificationsRead');
    expect(handler).toContain('const refreshed = await api.getNotifications()');
    expect(handler).toContain('reconciledReadDestination(');
    expect(handler).toContain("toast(t('No se pudo marcar como leído'))");
  });

  it('una carrera 404 sólo continúa si el GET confirma misma fila leída y mismo destino', () => {
    const row: AppNotification = {
      id: 'n-1',
      type: 'mesa_expired',
      title: null,
      body: 'Mesa cerrada',
      payload: { mesa_code: 'PA-1099' },
      related_entity_type: 'mesa',
      related_entity_id: null,
      read_at: '2026-09-21T12:00:00.000Z',
      created_at: '2026-09-21T11:00:00.000Z',
    };

    expect(reconciledReadDestination([row], 'n-1', 'PA-1099')).toBe('PA-1099');
    expect(reconciledReadDestination([{ ...row, read_at: null }], 'n-1', 'PA-1099')).toBeNull();
    expect(reconciledReadDestination([row], 'n-ajena', 'PA-1099')).toBeNull();
    expect(reconciledReadDestination([row], 'n-1', 'PA-0000')).toBeNull();
  });

  it('muestra restaurante / ID sólo con ambos datos y separa título de contenido', () => {
    expect(SOURCE).toContain('<span className="inv-mesa-code"> / {inv.mesaCode}</span>');
    expect(SOURCE).toContain('className="scroll flow-scroll avisos-scroll"');
    expect(CSS).toMatch(/\.avisos-scroll\s*\{[\s\S]*?padding-top:\s*var\(--sp-6\);/);
  });
});
