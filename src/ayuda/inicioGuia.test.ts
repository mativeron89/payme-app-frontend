import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ViajeConFechas } from '../api/viajesDeHoy';
import { enFechasDeViaje, estadoDeLaAyuda, tarjetaVisible, type EntradaDeLaTarjeta } from './inicioGuia';

const SABIDO: EntradaDeLaTarjeta = {
  noVolverAMostrar: false, tarjetaOculta: false, enFechasDeViaje: false, aperturaPendiente: false, mesaDeEjemploEnInicio: false,
};
const viaje = (desde: string | null, hasta: string | null, estado: ViajeConFechas['estado'] = 'abierto'): ViajeConFechas =>
  ({ id: 'v', nombre: 'Viaje', estado, fecha_desde: desde, fecha_hasta: hasta });

describe('D364 · D365 · la tarjeta Tutorial', () => {
  it('se ve sólo con todo sabido y en «no» (control: la entrada sabida la muestra)', () => {
    expect(tarjetaVisible(SABIDO)).toBe(true);
  });

  it('cada razón la esconde, y cada «todavía no sé» también (no aparece para irse después)', () => {
    for (const cambio of [
      { noVolverAMostrar: true }, { noVolverAMostrar: null },
      { tarjetaOculta: true }, { tarjetaOculta: null },
      { enFechasDeViaje: true }, { enFechasDeViaje: null },
      { aperturaPendiente: true }, { aperturaPendiente: null },
      { mesaDeEjemploEnInicio: true },
    ] as const) {
      expect(tarjetaVisible({ ...SABIDO, ...cambio }), JSON.stringify(cambio)).toBe(false);
    }
  });
});

describe('D365 · dentro de las fechas de un viaje', () => {
  it('con Viajes apagado, no; mientras la capacidad o la lista no llegan, no se sabe', () => {
    expect(enFechasDeViaje('apagada', null, '2026-10-19')).toBe(false);
    expect(enFechasDeViaje('pendiente', [viaje('2026-10-01', '2026-10-31')], '2026-10-19')).toBeNull();
    expect(enFechasDeViaje('encendida', null, '2026-10-19')).toBeNull();
  });

  it('un viaje abierto que cubre hoy, en los dos bordes; uno cerrado, sin fechas o de otro día, no', () => {
    expect(enFechasDeViaje('encendida', [viaje('2026-10-19', '2026-10-25')], '2026-10-19')).toBe(true);
    expect(enFechasDeViaje('encendida', [viaje('2026-10-10', '2026-10-19')], '2026-10-19')).toBe(true);
    expect(enFechasDeViaje('encendida', [viaje('2026-10-10', '2026-10-19', 'cerrado')], '2026-10-19')).toBe(false);
    expect(enFechasDeViaje('encendida', [viaje(null, '2026-10-25')], '2026-10-19')).toBe(false);
    expect(enFechasDeViaje('encendida', [viaje('2026-10-20', '2026-10-25')], '2026-10-19')).toBe(false);
    expect(enFechasDeViaje('encendida', [], '2026-10-19')).toBe(false);
  });
});

describe('Q8 · Q9 · Más → Ayuda → «Cómo usar PayMe»', () => {
  it('disponible con todo sabido; en fechas de viaje, deshabilitada; con una apertura pendiente, avisa', () => {
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: false })).toBe('disponible');
    expect(estadoDeLaAyuda({ enFechasDeViaje: true, aperturaPendiente: false })).toBe('en-viaje');
    expect(estadoDeLaAyuda({ enFechasDeViaje: true, aperturaPendiente: null })).toBe('en-viaje');
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: true })).toBe('apertura-pendiente');
  });

  it('mientras algo no se sabe, espera', () => {
    expect(estadoDeLaAyuda({ enFechasDeViaje: null, aperturaPendiente: false })).toBe('sin-saber');
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: null })).toBe('sin-saber');
  });

  it('la fila no se habilita sin saber ni en fechas de viaje, y con una apertura pendiente no abre la guía', () => {
    const fuente = readFileSync(new URL('./AccesoGuia.tsx', import.meta.url), 'utf8');
    expect(fuente).toContain("disabled={estado === 'en-viaje' || estado === 'sin-saber'}");
    expect(fuente).toContain("if (estado === 'apertura-pendiente') { setAvisar(true); return; }");
  });
});

describe('D364 · la guía ya no arranca sola', () => {
  it('el provider no observa la pantalla para abrirse ni ofrece una casilla', () => {
    const provider = readFileSync(new URL('./GuiaProvider.tsx', import.meta.url), 'utf8');
    const motor = readFileSync(new URL('./GuiaContenido.tsx', import.meta.url), 'utf8');
    expect(provider).not.toContain('MutationObserver');
    expect(provider).not.toContain('abrir(null)');
    expect(motor).not.toContain("t('No volver a mostrar')");
    // Control: lo que la abre ahora existe.
    expect(provider).toContain('ejemploLocal.empezar();');
  });
});
