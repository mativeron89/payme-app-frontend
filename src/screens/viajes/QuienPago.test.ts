import { describe, expect, it } from 'vitest';
import type { MiembroViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import { conQuienPago, opcionesDeQuienPago, pagadorVigente } from './QuienPago';

/** D255-6 · «¿Quién pagó?»: yo por defecto, o uno de los demás miembros activos. */
const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const miembro = (id: string, first: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: 'X', username: null, eliminada: false, es_yo: false,
  balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra,
});
const MIEMBROS = [miembro('m-yo', 'Ana', { es_yo: true }), miembro('m-luis', 'Luis'), miembro('m-baja', 'Ex', { eliminada: true })];

describe('🔴 D255-6 · quién pagó', () => {
  it('las opciones: «Lo pagaste tú» primero y los demás, sin mí ni una cuenta eliminada', () => {
    expect(opcionesDeQuienPago(MIEMBROS, t)).toEqual([{ id: null, nombre: 'Lo pagaste tú' }, { id: 'm-luis', nombre: 'Luis X' }]);
  });

  it('lo elegido sigue si todavía es otro miembro activo; si salió (o soy yo), vuelve a mí', () => {
    expect(pagadorVigente('m-luis', MIEMBROS)).toBe('m-luis');
    expect(pagadorVigente('m-salio', MIEMBROS)).toBeNull();
    expect(pagadorVigente('m-baja', MIEMBROS)).toBeNull();
    expect(pagadorVigente('m-yo', MIEMBROS)).toBeNull();
    expect(pagadorVigente(null, MIEMBROS)).toBeNull();
  });

  it('`pagado_por` va sólo si pagó otro', () => {
    const pedido = { descripcion: 'Taxi', monto_cents: 5000 };
    expect(conQuienPago(pedido, null)).toEqual(pedido);
    expect(conQuienPago(pedido, null)).not.toHaveProperty('pagado_por');
    expect(conQuienPago(pedido, 'm-luis')).toEqual({ ...pedido, pagado_por: 'm-luis' });
  });
});
