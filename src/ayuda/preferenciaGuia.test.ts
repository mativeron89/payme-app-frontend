import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarcaDeGuia, noVolverAMostrar, tarjetaTutorialOculta } from './preferenciaGuia';

function memoria() {
  const datos = new Map<string, string>();
  return { datos, getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); }, removeItem: (k: string) => { datos.delete(k); } };
}
const PREFIJO = 'payme.app.guia.tarjeta.v1';

describe('Q1 · D364 · las marcas de la guía, por cuenta y dispositivo', () => {
  it('las dos claves: el «No volver a mostrar» de D328 y la tarjeta Tutorial oculta', async () => {
    const a = memoria();
    await tarjetaTutorialOculta.fijar('cuenta-A', true, a);
    expect([...a.datos.keys()]).toEqual([expect.stringMatching(/^payme\.app\.guia\.tarjeta\.v1\.(mock|real)\.[a-f0-9]{64}$/)]);
    const clave = [...a.datos.keys()][0]!.replace('tarjeta.v1', 'optout.v2');
    a.setItem(clave, '1');
    expect(await new MarcaDeGuia('payme.app.guia.optout.v2').leer('cuenta-A', a)).toBe(true);
    expect(await noVolverAMostrar.leer('cuenta-B', a)).toBe(false);
  });

  it('nace en «no»; persiste sólo hash+1 y aísla otra cuenta y otro dispositivo', async () => {
    const a = memoria(), m = new MarcaDeGuia(PREFIJO);
    expect(await m.leer('cuenta-A', a)).toBe(false);
    await m.fijar('cuenta-A', true, a);
    expect([...a.datos.values()]).toEqual(['1']);
    expect(JSON.stringify([...a.datos])).not.toContain('cuenta-A');
    expect(await new MarcaDeGuia(PREFIJO).leer('cuenta-A', a)).toBe(true);
    expect(await m.leer('cuenta-B', a)).toBe(false);
    expect(await new MarcaDeGuia(PREFIJO).leer('cuenta-A', memoria())).toBe(false);
  });

  it('leer no escribe nada; fijar en «no» borra el único indicador', async () => {
    const a = memoria(), m = new MarcaDeGuia(PREFIJO);
    expect(await m.leer('A', a)).toBe(false);
    expect(a.datos.size).toBe(0);
    await m.fijar('A', true, a); await m.fijar('A', false, a);
    expect(a.datos.size).toBe(0);
    expect(await new MarcaDeGuia(PREFIJO).leer('A', a)).toBe(false);
  });

  it('storage roto conserva el valor sólo en memoria, reversible y por cuenta', async () => {
    const m = new MarcaDeGuia(PREFIJO);
    const roto = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('quota'); }, removeItem: () => { throw Error('denied'); } };
    expect(await m.leer('A', roto)).toBe(false);
    await expect(m.fijar('A', true, roto)).resolves.toBeUndefined();
    expect(await m.leer('A', roto)).toBe(true); expect(await m.leer('B', roto)).toBe(false);
    expect(await new MarcaDeGuia(PREFIJO).leer('A', roto)).toBe(false);
    await m.fijar('A', false, roto); expect(await m.leer('A', roto)).toBe(false);
  });

  it('sin crypto ni storage conserva el valor y el aislamiento en memoria', async () => {
    const m = new MarcaDeGuia(PREFIJO, async () => { throw Error('no crypto'); });
    await m.fijar('A', true, memoria());
    expect(await m.leer('A', null)).toBe(true); expect(await m.leer('B', null)).toBe(false);
  });

  it('una lectura demorada no pisa un cambio posterior', async () => {
    const resolver: ((s: string) => void)[] = [];
    const m = new MarcaDeGuia(PREFIJO, () => new Promise<string>((r) => { resolver.push(r); }));
    const a = memoria(), lectura = m.leer('A', a), cambio = m.fijar('A', true, a);
    resolver[0]!('hash'); expect(await lectura).toBe(true);
    resolver[1]!('hash'); await cambio;
  });

  it('dos cambios rápidos conservan el último aunque crypto resuelva en orden inverso', async () => {
    const resolver: ((s: string) => void)[] = [];
    const m = new MarcaDeGuia(PREFIJO, () => new Promise<string>((r) => { resolver.push(r); })), a = memoria();
    const primero = m.fijar('A', true, a), ultimo = m.fijar('A', false, a);
    resolver[1]!('hash'); await ultimo; resolver[0]!('hash'); await primero;
    expect(a.datos.size).toBe(0); expect(await m.leer('A', a)).toBe(false);
  });

  it('una escritura tardía usa la cuenta capturada y no contamina la siguiente', async () => {
    let resolver!: (s: string) => void;
    const m = new MarcaDeGuia(PREFIJO, (s) => s === 'auth:A' ? new Promise<string>((r) => { resolver = r; }) : Promise.resolve('hashB'));
    const a = memoria(), escritura = m.fijar('A', true, a);
    expect(await m.leer('B', a)).toBe(false); resolver('hashA'); await escritura;
    expect([...a.datos.entries()]).toEqual([[expect.stringContaining('.hashA'), '1']]);
    expect(await m.leer('B', a)).toBe(false);
  });

  it('sin identidad no lee ni escribe; un valor desconocido cuenta como «no»', async () => {
    const m = new MarcaDeGuia(PREFIJO, async () => 'hash'), a = memoria();
    await m.fijar('', true, a); expect(await m.leer('', a)).toBe(false); expect(a.datos.size).toBe(0);
    a.setItem(`${PREFIJO}.real.hash`, 'otro');
    a.setItem(`${PREFIJO}.mock.hash`, 'otro');
    expect(await m.leer('A', a)).toBe(false);
  });

  it('D364 · el «No volver a mostrar» sólo se lee: nada en src/ lo escribe', () => {
    const raiz = new URL('..', import.meta.url).pathname;
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) archivos.push(ruta);
      }
    };
    recorrer(raiz);
    expect(archivos.length).toBeGreaterThan(100);
    const escriben = archivos.filter((ruta) => /noVolverAMostrar\.fijar\(/.test(readFileSync(ruta, 'utf8')));
    expect(escriben).toEqual([]);
    // Control: la tarjeta sí se escribe (desde el provider).
    expect(archivos.some((ruta) => /tarjetaTutorialOculta\.fijar\(/.test(readFileSync(ruta, 'utf8')))).toBe(true);
  });
});
