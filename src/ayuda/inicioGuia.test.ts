import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViajeConFechas } from '../api/viajesDeHoy';
import {
  enFechasDeViaje, escucharElRegreso, estadoDeLaAyuda, reintentarSaberSiHayViaje, tarjetaVisible, type EntradaDeLaTarjeta,
} from './inicioGuia';

const pedidos = vi.hoisted(() => ({ getConfig: [] as number[], precargar: [] as number[], falla: false }));
vi.mock('../api', () => ({
  api: { getConfig: () => { pedidos.getConfig.push(1); return pedidos.falla ? Promise.reject(new Error('red')) : Promise.resolve({}); } },
}));
vi.mock('../screens/viajes/useViajesDeHoy', () => ({ precargarViajesAbiertos: () => { pedidos.precargar.push(1); } }));
beforeEach(() => { pedidos.getConfig = []; pedidos.precargar = []; pedidos.falla = false; });

const SABIDO: EntradaDeLaTarjeta = {
  noVolverAMostrar: false, tarjetaOculta: false, enFechasDeViaje: false, aperturaPendiente: false, mesaDeEjemploEnInicio: false,
  avisoDeFotos: 'resuelto',
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
      // Enmienda 10 · el aviso «Tu foto entre amigos» pendiente, o todavía sin consultar en Inicio.
      { avisoDeFotos: 'pendiente' }, { avisoDeFotos: 'sin-saber' },
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
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: false, avisoDeFotos: 'resuelto' })).toBe('disponible');
    expect(estadoDeLaAyuda({ enFechasDeViaje: true, aperturaPendiente: false, avisoDeFotos: 'resuelto' })).toBe('en-viaje');
    expect(estadoDeLaAyuda({ enFechasDeViaje: true, aperturaPendiente: null, avisoDeFotos: 'resuelto' })).toBe('en-viaje');
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: true, avisoDeFotos: 'resuelto' })).toBe('apertura-pendiente');
  });

  it('mientras algo no se sabe, espera', () => {
    // Sin saber si hoy cae en un viaje, espera con su línea; si sólo falta la lectura local de la apertura, sin línea.
    expect(estadoDeLaAyuda({ enFechasDeViaje: null, aperturaPendiente: false, avisoDeFotos: 'resuelto' })).toBe('sin-saber-viaje');
    expect(estadoDeLaAyuda({ enFechasDeViaje: null, aperturaPendiente: null, avisoDeFotos: 'resuelto' })).toBe('sin-saber-viaje');
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: null, avisoDeFotos: 'resuelto' })).toBe('sin-saber');
  });

  it('enmienda 10 · con el aviso «Tu foto entre amigos» pendiente, espera con su línea; sin saber del aviso, no se traba', () => {
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: false, avisoDeFotos: 'pendiente' })).toBe('aviso-de-fotos');
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: true, avisoDeFotos: 'pendiente' })).toBe('aviso-de-fotos');
    // Control: sin saber del aviso (recargar en Más sin pasar por Inicio), disponible.
    expect(estadoDeLaAyuda({ enFechasDeViaje: false, aperturaPendiente: false, avisoDeFotos: 'sin-saber' })).toBe('disponible');
    // Las fechas de un viaje explican primero.
    expect(estadoDeLaAyuda({ enFechasDeViaje: true, aperturaPendiente: false, avisoDeFotos: 'pendiente' })).toBe('en-viaje');
  });

  it('la fila no se habilita sin saber ni en fechas de viaje, y con una apertura pendiente no abre la guía', () => {
    const fuente = readFileSync(new URL('./AccesoGuia.tsx', import.meta.url), 'utf8');
    expect(fuente).toContain("disabled={estado === 'en-viaje' || estado === 'aviso-de-fotos' || estado === 'sin-saber-viaje' || estado === 'sin-saber'}");
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
    // Control: lo que la abre ahora existe (la apertura; el ejemplo arranca con la primera burbuja, controlDeLaGuia.ts).
    expect(provider).toContain('abrirLaGuia(aperturaRef.current, rutaRef.current.pagina)');
  });
});

describe('revisión de V sobre ff5dec7, punto 3 · lo que no se supo se vuelve a pedir al volver', () => {
  it('con la capacidad sin saber, la config; con Viajes encendido, la lista; con Viajes apagado, nada', async () => {
    const esperar = () => new Promise((r) => setTimeout(r, 0));
    reintentarSaberSiHayViaje('pendiente');
    expect(pedidos).toMatchObject({ getConfig: [1], precargar: [] });
    reintentarSaberSiHayViaje('encendida');
    expect(pedidos).toMatchObject({ getConfig: [1], precargar: [1] });
    reintentarSaberSiHayViaje('apagada');
    expect(pedidos).toMatchObject({ getConfig: [1], precargar: [1] });
    await esperar();
    // Una config que falla no rompe nada: queda para el próximo regreso.
    pedidos.falla = true;
    expect(() => reintentarSaberSiHayViaje('pendiente')).not.toThrow();
    await esperar();
    expect(pedidos.getConfig).toHaveLength(2);
    reintentarSaberSiHayViaje('pendiente');
    expect(pedidos.getConfig).toHaveLength(3);
    await esperar();
  });

  it('dos regresos seguidos (el foco y la pestaña visible llegan juntos) piden una sola config', async () => {
    reintentarSaberSiHayViaje('pendiente');
    reintentarSaberSiHayViaje('pendiente');
    expect(pedidos.getConfig).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    // Terminada, el próximo regreso vuelve a pedir.
    reintentarSaberSiHayViaje('pendiente');
    expect(pedidos.getConfig).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('escucha el foco de la ventana y la pestaña que vuelve a verse; oculta, no; al montar no pide; y deja de escuchar', () => {
    const ventana = new EventTarget();
    const documento: EventTarget & { visibilityState: string } = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    let veces = 0;
    const dejar = escucharElRegreso(ventana, documento, () => { veces += 1; });
    expect(veces).toBe(0);
    ventana.dispatchEvent(new Event('focus'));
    expect(veces).toBe(1);
    documento.dispatchEvent(new Event('visibilitychange'));
    expect(veces).toBe(2);
    documento.visibilityState = 'hidden';
    documento.dispatchEvent(new Event('visibilitychange'));
    expect(veces).toBe(2);
    dejar();
    documento.visibilityState = 'visible';
    ventana.dispatchEvent(new Event('focus'));
    documento.dispatchEvent(new Event('visibilitychange'));
    expect(veces).toBe(2);
  });

  it('el hook lo cablea mientras no se sabe, con la capacidad de ese momento (la fuente)', () => {
    const fuente = readFileSync(new URL('./inicioGuia.ts', import.meta.url), 'utf8');
    expect(fuente).toMatch(/const sabido = enFechasDeViaje\(capacidad, abiertos, hoyLocal\(\)\);\s*useEffect\(\(\) => \{\s*if \(sabido !== null\) return undefined;\s*return escucharElRegreso\(window, document, \(\) => reintentarSaberSiHayViaje\(capacidad\)\);\s*\}, \[sabido, capacidad\]\);\s*return sabido;/);
  });
});
