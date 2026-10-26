import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * D212 · la cámara nativa se abre DENTRO del toque.
 *
 * iOS sólo abre la cámara si el `click()` sobre la entrada ocurre durante el
 * gesto de la persona. Chromium es más permisivo (da unos segundos de margen),
 * así que la suite e2e no puede distinguir «en el toque» de «un rato después»:
 * un `click()` desde un efecto al montar la pantalla pasaría ahí y fallaría en
 * el iPhone. Esta guarda fija la forma: cada `abrirCamaraNativa()` es la primera
 * línea de un manejador de toque, sincrónica, y nunca vive en un efecto.
 */
const barra = readFileSync(new URL('../components/AppBottomBar.tsx', import.meta.url), 'utf8');
const flujo = readFileSync(new URL('../screens/CreateMesaFlow.tsx', import.meta.url), 'utf8');
const circulo = readFileSync(new URL('../screens/viajes/circuloDelViaje.ts', import.meta.url), 'utf8');
const hoja = readFileSync(new URL('../screens/viajes/HojaParaQueViaje.tsx', import.meta.url), 'utf8');
const ticketNuevo = readFileSync(new URL('../screens/viajes/TicketNuevoScreen.tsx', import.meta.url), 'utf8');

const llamadas = (fuente: string) => fuente.match(/abrirCamaraNativa\(\)/g)?.length ?? 0;
/** D368 · el menú del teléfono (el `accept` vigente lo lee la cámara en el mismo toque). */
const menus = (fuente: string) => fuente.match(/abrirMenuDeFotos\(\)/g)?.length ?? 0;

describe('D212 · la cámara nativa se abre dentro del toque', () => {
  it('🔴 «Nueva» abre el menú del teléfono (D368) en su propio onClick, antes de navegar y sin esperar nada', () => {
    expect(llamadas(barra)).toBe(0);
    expect(menus(barra)).toBe(1);
    // Entre la apertura y `navigate` sólo puede haber comentarios.
    const sinComentarios = barra.replace(/\/\/[^\n]*/g, '');
    expect(sinComentarios).toMatch(/onClick: \(\) => \{\s*abrirMenuDeFotos\(\);\s*navigate\('scan'\);\s*\}/);
    // Y la barra registra de dónde lee el `accept` el menú: el vigente del dueño.
    expect(sinComentarios).toContain('registrarAcceptDelMenu(acceptVigente);');
  });

  it('🔴 D368 · en un viaje, el «Escanear» de la barra y «¿Para qué viaje?» también abren el menú en el toque', () => {
    const sin = (f: string) => f.replace(/\/\/[^\n]*/g, '');
    expect(llamadas(circulo)).toBe(0);
    expect(menus(circulo)).toBe(1);
    expect(sin(circulo)).toMatch(/onClick: \(\) => \{\s*abrirMenuDeFotos\(\);\s*navigate\('scan', id\);\s*\}/);
    expect(llamadas(hoja)).toBe(0);
    expect(menus(hoja)).toBe(1);
    expect(sin(hoja)).toMatch(/onClick=\{\(\) => \{\s*abrirMenuDeFotos\(\);\s*alElegir\(\);/);
  });

  it('🔴 D368 · «Escanear otro ticket» del ticket del viaje sigue abriendo la cámara directo (con capture), no el menú', () => {
    // Control positivo: es la pantalla del botón, y el botón llama al manejador.
    expect(ticketNuevo).toContain("t('Escanear otro ticket')");
    expect(ticketNuevo).toContain('onClick={onEscanearOtro}');
    // Las dos pantallas que lo ofrecen (el duplicado y el aviso de escaneo) reciben ESE manejador, no otro: un
    // `navigate` sin cámara en cualquiera de las dos dejaba el test en verde.
    const sinComentarios = ticketNuevo.replace(/\/\/[^\n]*/g, '');
    expect(sinComentarios).toContain('onEscanearOtro={escanearOtro}');
    expect(sinComentarios).toContain('onEscanear={escanearOtro}');
    expect(sinComentarios).toMatch(/onClick=\{onEscanear\}>\s*\{aviso === 'sin_escaneo' \? t\('Escanear ticket'\) : t\('Escanear otro ticket'\)\}/);
    expect(llamadas(ticketNuevo)).toBe(1);
    expect(menus(ticketNuevo)).toBe(0);
    expect(ticketNuevo.replace(/\/\/[^\n]*/g, '')).toMatch(/const escanearOtro = \(\) => \{\s*abrirCamaraNativa\(\);\s*navigate\('scan', viajeId\);\s*\};/);
  });

  it('🔴 en el flujo, sólo `doScan` la abre, y `doScan` sólo se usa en un toque', () => {
    expect(llamadas(flujo)).toBe(1);
    expect(flujo).toMatch(/function doScan\(\) \{\s*abrirCamaraNativa\(\);\s*\}/);
    const usos = flujo.match(/\bdoScan\b/g)?.length ?? 0;
    const comoToque = flujo.match(/onClick=\{doScan\}/g)?.length ?? 0;
    // D484 · D486 · los manejadores de las partes de un ticket largo también la abren, con `doScan()` sincrónico: cada
    // uno es un manejador de toque (sólo se usa en un `onClick`), sin `await` antes de `doScan()`.
    const manejadores = ['agregarParte', 'repetirParte', 'reintentarLectura', 'volverASacar'];
    let enManejadores = 0;
    for (const m of manejadores) {
      const cuerpo = flujo.match(new RegExp(`\\n  function ${m}\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}\\n`))?.[1];
      expect(cuerpo, m).toBeDefined();
      const antes = cuerpo!.slice(0, cuerpo!.indexOf('doScan()'));
      expect(cuerpo!.includes('doScan()'), m).toBe(true);
      expect(antes, m).not.toMatch(/\bawait\b/);
      enManejadores += cuerpo!.match(/\bdoScan\(\)/g)?.length ?? 0;
      // Fuera de su definición, el manejador sólo aparece en un `onClick`.
      const total = flujo.match(new RegExp(`\\b${m}\\b`, 'g'))?.length ?? 0;
      const enToques = flujo.match(new RegExp(`onClick=\\{(?:${m}|\\(\\) => ${m}\\([^)]*\\))\\}`, 'g'))?.length ?? 0;
      expect(enToques, m).toBeGreaterThan(0);
      expect(total, m).toBe(enToques + 1);
    }
    // Uno es la definición; todos los demás, manejadores de toque.
    expect(comoToque).toBeGreaterThan(0);
    expect(usos).toBe(comoToque + enManejadores + 1);
  });

  it('ninguna se llama desde un efecto ni después de un await', () => {
    const efectos = [barra, flujo, circulo, hoja].flatMap((fuente) =>
      [...fuente.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map((m) => m[1]!));
    // Control: el barrido ve los efectos del flujo, incluido el que RECIBE la foto.
    expect(efectos.length).toBeGreaterThanOrEqual(8);
    expect(efectos.some((cuerpo) => cuerpo.includes('alRecibirFotoDeLaCamara'))).toBe(true);
    for (const cuerpo of efectos) {
      expect(cuerpo).not.toContain('abrirCamaraNativa');
      expect(cuerpo).not.toContain('abrirMenuDeFotos');
      expect(cuerpo).not.toContain('doScan');
    }
    for (const fuente of [barra, flujo, circulo, hoja]) {
      expect(fuente).not.toMatch(/await[^;]*\n?[^;]*abrirCamaraNativa/);
      expect(fuente).not.toMatch(/await[^;]*\n?[^;]*abrirMenuDeFotos/);
    }
  });
});
