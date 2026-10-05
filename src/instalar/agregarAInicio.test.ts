/**
 * AF-E173-4-E176 · D176 · dónde se ofrece «Agregar a inicio», el
 * `beforeinstallprompt` de Chrome y la marca del aviso de primera vez.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAVE_VISTO,
  avisoYaVisto,
  capturarInstalacion,
  entornoActual,
  esIPad,
  marcarAvisoVisto,
  pedirInstalacion,
  plataformaDeInstalacion,
  reiniciarParaTests,
  suscribir,
  type EntornoInstalacion,
} from './agregarAInicio';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iphoneGoogle:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/300.0.598994205 Mobile/15E148 Safari/604.1',
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.109;] Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.32.106 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

function entorno(cambios: Partial<EntornoInstalacion> = {}): EntornoInstalacion {
  return {
    userAgent: UA.iphoneSafari,
    platform: 'iPhone',
    maxTouchPoints: 5,
    standalone: false,
    displayStandalone: false,
    hayPrompt: false,
    ...cambios,
  };
}

beforeEach(() => {
  reiniciarParaTests();
});

describe('D176 · dónde se ofrece «Agregar a inicio»', () => {
  it('el iPhone en Safari: la guía', () => {
    expect(plataformaDeInstalacion(entorno())).toBe('ios_safari');
  });

  it('el iPad en Safari, con su user agent o el que se presenta como Mac con pantalla táctil: la guía', () => {
    expect(plataformaDeInstalacion(entorno({ userAgent: UA.ipadSafari, platform: 'iPad' }))).toBe('ios_safari');
    const ipadComoMac = entorno({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(plataformaDeInstalacion(ipadComoMac)).toBe('ios_safari');
    expect(esIPad(ipadComoMac)).toBe(true);
  });

  it('el iPhone no es iPad: la flecha va abajo', () => {
    expect(esIPad(entorno())).toBe(false);
  });

  it('una Mac sin pantalla táctil: nada', () => {
    expect(plataformaDeInstalacion(entorno({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 }))).toBeNull();
  });

  it.each([
    ['Chrome', UA.iphoneChrome],
    ['Firefox', UA.iphoneFirefox],
    ['la app de Google', UA.iphoneGoogle],
    ['Facebook', UA.iphoneFacebook],
    ['Instagram', UA.iphoneInstagram],
  ])('el iPhone en %s: nada (ahí no está «Agregar a inicio» de Safari)', (_nombre, userAgent) => {
    expect(plataformaDeInstalacion(entorno({ userAgent }))).toBeNull();
  });

  it('ya agregada (navigator.standalone o display-mode standalone): nada', () => {
    expect(plataformaDeInstalacion(entorno({ standalone: true }))).toBeNull();
    expect(plataformaDeInstalacion(entorno({ displayStandalone: true }))).toBeNull();
    expect(plataformaDeInstalacion(entorno({ userAgent: UA.android, platform: 'Linux armv8l', hayPrompt: true, displayStandalone: true }))).toBeNull();
  });

  it('sólo `standalone === true` cuenta como agregada', () => {
    expect(plataformaDeInstalacion(entorno({ standalone: 'true' }))).toBe('ios_safari');
    expect(plataformaDeInstalacion(entorno({ standalone: 1 }))).toBe('ios_safari');
  });

  it('Android con el `beforeinstallprompt` guardado: el diálogo de Chrome; sin él, nada', () => {
    const android = { userAgent: UA.android, platform: 'Linux armv8l' };
    expect(plataformaDeInstalacion(entorno({ ...android, hayPrompt: true }))).toBe('android_prompt');
    expect(plataformaDeInstalacion(entorno({ ...android, hayPrompt: false }))).toBeNull();
  });
});

/** Un `window` mínimo: escucha eventos y tiene navigator y matchMedia. */
function ventana(navegador: Record<string, unknown> = {}, standaloneMedia = false) {
  const destino = new EventTarget();
  return Object.assign(destino, {
    navigator: { userAgent: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5, ...navegador },
    matchMedia: (consulta: string) => ({ matches: standaloneMedia && consulta === '(display-mode: standalone)' }),
  }) as unknown as Window;
}

function eventoDeInstalacion(outcome: 'accepted' | 'dismissed') {
  const evento = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(evento, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { evento, prompt };
}

describe('D176 · el `beforeinstallprompt` de Chrome', () => {
  it('se guarda, se frena la barra propia de Chrome y avisa a los suscriptos', () => {
    const win = ventana();
    const oyente = vi.fn();
    suscribir(oyente);
    capturarInstalacion(win);
    const { evento } = eventoDeInstalacion('accepted');
    win.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(entornoActual(win).hayPrompt).toBe(true);
  });

  it('pedirInstalacion muestra el diálogo una sola vez y devuelve lo que eligió', async () => {
    const win = ventana();
    capturarInstalacion(win);
    const { evento, prompt } = eventoDeInstalacion('accepted');
    win.dispatchEvent(evento);
    await expect(pedirInstalacion()).resolves.toBe('aceptada');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(entornoActual(win).hayPrompt).toBe(false);
    await expect(pedirInstalacion()).resolves.toBe('no_disponible');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('si lo rechaza: «rechazada», y el evento también se descarta', async () => {
    const win = ventana();
    capturarInstalacion(win);
    win.dispatchEvent(eventoDeInstalacion('dismissed').evento);
    await expect(pedirInstalacion()).resolves.toBe('rechazada');
    expect(entornoActual(win).hayPrompt).toBe(false);
  });

  it('sin evento guardado: «no_disponible»', async () => {
    await expect(pedirInstalacion()).resolves.toBe('no_disponible');
  });

  it('`appinstalled` descarta el evento guardado y avisa', () => {
    const win = ventana();
    capturarInstalacion(win);
    win.dispatchEvent(eventoDeInstalacion('accepted').evento);
    const oyente = vi.fn();
    suscribir(oyente);
    win.dispatchEvent(new Event('appinstalled'));
    expect(entornoActual(win).hayPrompt).toBe(false);
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it('al desenganchar ya no se captura; al desuscribirse ya no avisa', () => {
    const win = ventana();
    const oyente = vi.fn();
    const desuscribir = suscribir(oyente);
    const desenganchar = capturarInstalacion(win);
    desenganchar();
    win.dispatchEvent(eventoDeInstalacion('accepted').evento);
    expect(entornoActual(win).hayPrompt).toBe(false);
    capturarInstalacion(win);
    desuscribir();
    win.dispatchEvent(eventoDeInstalacion('accepted').evento);
    expect(oyente).not.toHaveBeenCalled();
  });
});

describe('D176 · el entorno sale del navegador', () => {
  it('lee user agent, plataforma, toques, standalone y display-mode', () => {
    const win = ventana({ userAgent: UA.iphoneSafari, platform: 'iPhone', standalone: true }, true);
    expect(entornoActual(win)).toEqual({
      userAgent: UA.iphoneSafari,
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: true,
      displayStandalone: true,
      hayPrompt: false,
    });
  });

  it('sin matchMedia ni maxTouchPoints: no agregada y cero toques', () => {
    const win = { navigator: { userAgent: UA.mac, platform: 'MacIntel' } } as unknown as Window;
    const e = entornoActual(win);
    expect(e.displayStandalone).toBe(false);
    expect(e.maxTouchPoints).toBe(0);
    expect(plataformaDeInstalacion(e)).toBeNull();
  });
});

function almacen() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
  };
}

const roto = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

describe('D176 · el aviso de primera vez se muestra una vez', () => {
  it('sin marca: no visto; al cerrarlo queda la marca en el almacenamiento', () => {
    const a = almacen();
    expect(avisoYaVisto(a)).toBe(false);
    marcarAvisoVisto(a);
    expect(a.datos.get(CLAVE_VISTO)).toBe('1');
    reiniciarParaTests();
    // Otra carga de la página: la marca la trae el almacenamiento, no la memoria.
    expect(avisoYaVisto(a)).toBe(true);
  });

  it('una marca con otro valor no cuenta', () => {
    const a = almacen();
    a.datos.set(CLAVE_VISTO, 'si');
    expect(avisoYaVisto(a)).toBe(false);
  });

  it('con el almacenamiento roto se muestra, y después de cerrarlo no vuelve en esta sesión', () => {
    expect(avisoYaVisto(roto)).toBe(false);
    expect(() => marcarAvisoVisto(roto)).not.toThrow();
    expect(avisoYaVisto(roto)).toBe(true);
  });

  it('sin almacenamiento (null): lo mismo, en memoria', () => {
    expect(avisoYaVisto(null)).toBe(false);
    marcarAvisoVisto(null);
    expect(avisoYaVisto(null)).toBe(true);
  });
});
