import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  abrirLaGuia, cargarElMotor, cierraPorLaRuta, debeEmpezar, guiaEspera, GUIA_CERRADA, salirVuelveAInicio, type Apertura,
} from './controlDeLaGuia';

const ABIERTA_EN_INICIO: Apertura = { abierta: true, pagina: 'home', empezado: false };
const EMPEZADA: Apertura = { abierta: true, pagina: 'home', empezado: true };
const APAGADO = { activo: false, fase: 'foto' } as const;
const en = (pagina: Parameters<typeof cierraPorLaRuta>[2]['pagina'], param: string | null = null) => ({ pagina, param });

describe('revisión de V sobre ff5dec7 · el ejemplo arranca con la primera burbuja, no al abrir', () => {
  it('abrir deja la guía abierta, antes de empezar, en la página donde se tocó', () => {
    expect(abrirLaGuia(GUIA_CERRADA, 'home')).toEqual(ABIERTA_EN_INICIO);
    expect(abrirLaGuia(GUIA_CERRADA, 'mas')).toEqual({ abierta: true, pagina: 'mas', empezado: false });
  });

  it('abrir con la guía abierta no hace nada (un segundo toque en Tutorial no reinicia)', () => {
    expect(abrirLaGuia(EMPEZADA, 'home')).toBe(EMPEZADA);
    expect(abrirLaGuia(ABIERTA_EN_INICIO, 'mas')).toBe(ABIERTA_EN_INICIO);
  });

  it('sólo la 2a, la primera vez, en la página donde se abrió y con el ejemplo apagado, prende el ejemplo', () => {
    expect(debeEmpezar(ABIERTA_EN_INICIO, 'apertura', 'home', false)).toBe(true);
    // Un segundo aviso se ignora.
    expect(debeEmpezar(EMPEZADA, 'apertura', 'home', false)).toBe(false);
    // Otra burbuja, otra página, la guía cerrada o un ejemplo ya activo, no.
    expect(debeEmpezar(ABIERTA_EN_INICIO, 'camara', 'home', false)).toBe(false);
    expect(debeEmpezar(ABIERTA_EN_INICIO, 'apertura', 'scan', false)).toBe(false);
    expect(debeEmpezar(ABIERTA_EN_INICIO, 'apertura', 'mas', false)).toBe(false);
    expect(debeEmpezar(GUIA_CERRADA, 'apertura', 'home', false)).toBe(false);
    expect(debeEmpezar(ABIERTA_EN_INICIO, 'apertura', 'home', true)).toBe(false);
  });

  it('con el import del motor rechazado: se avisa y nunca se carga; con el import bueno, se carga y no se avisa', async () => {
    const eventos: string[] = [];
    await cargarElMotor(() => Promise.reject(new Error('chunk')), {
      vigente: () => true, alCargar: () => eventos.push('cargó'), alFallar: () => eventos.push('falló'),
    });
    expect(eventos).toEqual(['falló']);
    eventos.length = 0;
    await cargarElMotor(() => Promise.resolve('motor'), {
      vigente: () => true, alCargar: (m) => eventos.push(`cargó ${m}`), alFallar: () => eventos.push('falló'),
    });
    expect(eventos).toEqual(['cargó motor']);
  });

  it('con el provider desmontado, ni carga ni avisa', async () => {
    const eventos: string[] = [];
    for (const importar of [() => Promise.reject(new Error('chunk')), () => Promise.resolve('motor')]) {
      await cargarElMotor(importar, { vigente: () => false, alCargar: () => eventos.push('cargó'), alFallar: () => eventos.push('falló') });
    }
    expect(eventos).toEqual([]);
  });
});

describe('revisión de V sobre ff5dec7 · la ruta cierra la guía sin navegar', () => {
  it('antes de empezar: quedarse donde se abrió la deja; irse (Escanear, Más, otra pestaña) la cierra', () => {
    expect(cierraPorLaRuta(ABIERTA_EN_INICIO, APAGADO, en('home'), false)).toBe(false);
    for (const pagina of ['scan', 'mas', 'mesas', 'estadisticas'] as const) {
      expect(cierraPorLaRuta(ABIERTA_EN_INICIO, APAGADO, en(pagina), false), pagina).toBe(true);
    }
    // Abierta desde Más espera en Más.
    expect(cierraPorLaRuta({ ...ABIERTA_EN_INICIO, pagina: 'mas' }, APAGADO, en('mas'), false)).toBe(false);
  });

  it('D365 · si hoy pasa a caer en un viaje, antes de empezar o en la fase de la foto, se cierra; sin saber, no', () => {
    expect(cierraPorLaRuta(ABIERTA_EN_INICIO, APAGADO, en('home'), true)).toBe(true);
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'foto' }, en('home'), true)).toBe(true);
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'foto' }, en('home'), null)).toBe(false);
    // Con el ticket de ejemplo ya en pantalla, la cámara no importa: el recorrido sigue.
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'dividir' }, en('scan'), true)).toBe(false);
  });

  it('empezada: si alguien descartó el ejemplo se cierra; en el recorrido sigue; fuera del recorrido, se cierra', () => {
    expect(cierraPorLaRuta(EMPEZADA, APAGADO, en('home'), false)).toBe(true);
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'foto' }, en('scan'), false)).toBe(false);
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'mesa' }, en('mesa', 'PA-1224'), false)).toBe(false);
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'listo' }, en('scan'), false)).toBe(true);
    expect(cierraPorLaRuta(EMPEZADA, { activo: true, fase: 'foto' }, en('scan', 'v-0001'), false)).toBe(true);
  });

  it('cerrada, la ruta no hace nada', () => {
    expect(cierraPorLaRuta(GUIA_CERRADA, APAGADO, en('scan'), true)).toBe(false);
  });
});

describe('revisión de V sobre ff5dec7 · salir vuelve a Inicio sólo con el ejemplo empezado, desde el recorrido', () => {
  it('empezada, desde la cámara o la mesa de ejemplo, sí; desde Inicio o Más, no', () => {
    expect(salirVuelveAInicio(EMPEZADA, en('scan'))).toBe(true);
    expect(salirVuelveAInicio(EMPEZADA, en('mesa', 'PA-1224'))).toBe(true);
    expect(salirVuelveAInicio(EMPEZADA, en('home'))).toBe(false);
    expect(salirVuelveAInicio(EMPEZADA, en('mas'))).toBe(false);
  });

  it('antes de empezar (el aviso de carga o de error) no navega desde ningún lado', () => {
    expect(salirVuelveAInicio(ABIERTA_EN_INICIO, en('scan'))).toBe(false);
    expect(salirVuelveAInicio(GUIA_CERRADA, en('scan'))).toBe(false);
  });
});

describe('V, 2026-10-19 · la guía espera sólo a las puertas; el toque explícito les gana a las invitaciones', () => {
  it('con la puerta legal o la del @ espera; abiertas, no (control)', () => {
    expect(guiaEspera(false)).toBe(true);
    expect(guiaEspera(true)).toBe(false);
  });
});

describe('el cableado: el provider usa estas funciones y nada más prende el ejemplo', () => {
  const provider = readFileSync(new URL('./GuiaProvider.tsx', import.meta.url), 'utf8');
  const motor = readFileSync(new URL('./GuiaContenido.tsx', import.meta.url), 'utf8');

  it('abrir no prende el ejemplo: el único empezar() del provider depende de debeEmpezar', () => {
    const abrir = provider.slice(provider.indexOf('const abrir = useCallback('), provider.indexOf('const cerrarPorLaRuta'));
    expect(abrir).not.toContain('empezar');
    expect(abrir).toContain('abrirLaGuia(');
    expect(abrir).toContain('cargarElMotor(');
    expect(provider.match(/ejemploLocal\.empezar\(\)/g)).toHaveLength(1);
    expect(provider).toMatch(/if \(!debeEmpezar\(aperturaRef\.current, id, rutaRef\.current\.pagina, ejemploLocal\.leer\(\)\.activo\)\) return;\s*ejemploLocal\.empezar\(\);/);
  });

  it('la regla de la ruta corre en un useLayoutEffect con el estado vivo, y el motor ya no cierra por su cuenta', () => {
    expect(provider).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(cierraPorLaRuta\(aperturaRef\.current, ejemploLocal\.leer\(\), rutaRef\.current, enFechasDeViajeRef\.current\)\) cerrarPorLaRuta\(\);/);
    expect(motor).not.toContain('enElRecorrido');
    expect(motor).not.toContain('navigate(');
  });

  it('en todo src/, el único que prende el ejemplo es el provider, una sola vez (control: el método existe)', () => {
    const raiz = new URL('../', import.meta.url).pathname;
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && !/\.testutil\./.test(e.name)) archivos.push(p);
      }
    };
    recorrer(raiz);
    const conEmpezar = archivos
      .map((p) => ({ p: p.slice(raiz.length), n: (readFileSync(p, 'utf8').match(/\.empezar\(/g) ?? []).length }))
      .filter((a) => a.n > 0);
    expect(conEmpezar).toEqual([{ p: 'ayuda/GuiaProvider.tsx', n: 1 }]);
    expect(readFileSync(join(raiz, 'ayuda/ejemplo/estadoEjemplo.ts'), 'utf8')).toContain('  empezar(): void {');
  });

  it('el descarte del ejemplo al desmontar (cambio de cuenta o de familia) es de layout, no pasivo', () => {
    expect(provider).toContain('useLayoutEffect(() => () => ejemploLocal.descartar(), []);');
  });
});

describe('el cableado del seguro de CreateMesaFlow (la fuente)', () => {
  // 🔴 Las tres guardas son defensa en profundidad: la transición vuelve al principio antes de que se pueda tocar
  // «Continuar», así que ningún test de comportamiento las alcanza (el e2e del seguro acredita la transición). Esto
  // fija que existen y dónde están.
  const flujo = readFileSync(new URL('../screens/CreateMesaFlow.tsx', import.meta.url), 'utf8');
  const cuerpo = (desde: string, hasta: string) => flujo.slice(flujo.indexOf(desde), flujo.indexOf(hasta, flujo.indexOf(desde)));

  it('los platos del ejemplo prenden la ref, y la transición vuelve al principio si el ejemplo se apaga con ellos', () => {
    expect(cuerpo('function cargarTicketDeEjemplo() {', 'soltarRecorte();')).toContain('ticketDeEjemploRef.current = true;');
    expect(flujo).toMatch(/useLayoutEffect\(\(\) => \{\s*const antes = ejemploAntesRef\.current;\s*ejemploAntesRef\.current = ejemplo;\s*if \(antes && !ejemplo && ticketDeEjemploRef\.current\) volverAlPrincipioDelEjemplo\(\);/);
  });

  it('las tres guardas: resolveRestaurant corta, continuar y createMesa vuelven al principio', () => {
    expect(cuerpo('async function resolveTicketRestaurant(', 'if (restaurantIdRef.current) {')).toContain('if (ticketDeEjemploRef.current) return null;');
    expect(cuerpo('async function createMesa() {', 'if (!ticketValid) {')).toMatch(/if \(ticketDeEjemploRef\.current\) \{\s*volverAlPrincipioDelEjemplo\(\);\s*finishTicketContinuation\(\);\s*return;\s*\}/);
    expect(cuerpo('async function continueFromTicket() {', 'let resolved = restaurant;')).toMatch(/if \(ticketDeEjemploRef\.current\) \{\s*volverAlPrincipioDelEjemplo\(\);\s*return;\s*\}/);
  });

  it('sólo un ticket real apaga la ref (la carga manual y la lectura del OCR) y la vuelta al principio', () => {
    expect(flujo.match(/ticketDeEjemploRef\.current = false;/g)).toHaveLength(3);
    expect(cuerpo('function volverAlPrincipioDelEjemplo() {', 'setStep(\'scan\');')).toContain('ticketDeEjemploRef.current = false;');
  });
});
