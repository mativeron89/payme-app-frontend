import { describe, expect, it } from 'vitest';
import { PreferenciaGuia } from './preferenciaGuia';
function memoria() {
  const datos = new Map<string, string>();
  return { datos, getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); }, removeItem: (k: string) => { datos.delete(k); } };
}
describe('D328 · exclusión explícita por cuenta y dispositivo', () => {
  it('nace desmarcada; persiste sólo hash+1 y aísla otra cuenta/dispositivo', async () => {
    const a = memoria(), p = new PreferenciaGuia();
    expect(await p.noMostrar('cuenta-A', a)).toBe(false);
    await p.elegir('cuenta-A', true, a);
    expect([...a.datos.entries()]).toEqual([[expect.stringMatching(/^payme\.app\.guia\.optout\.v2\.(mock|real)\.[a-f0-9]{64}$/), '1']]);
    expect(JSON.stringify([...a.datos])).not.toContain('cuenta-A');
    expect(await new PreferenciaGuia().noMostrar('cuenta-A', a)).toBe(true);
    expect(await p.noMostrar('cuenta-B', a)).toBe(false);
    expect(await new PreferenciaGuia().noMostrar('cuenta-A', memoria())).toBe(false);
  });
  it('vista/Ahora no de v1 no se interpreta ni migra como consentimiento', async () => {
    const a = memoria(), p = new PreferenciaGuia(async () => 'hash');
    a.setItem('payme.app.guia.v1.mock.hash', '1'); a.setItem('payme.app.guia.v1.real.hash', '1');
    expect(await p.noMostrar('A', a)).toBe(false); expect(a.datos.size).toBe(2);
    expect([...a.datos.keys()].some((k) => k.includes('optout'))).toBe(false);
  });
  it('leer, cerrar o terminar sin elección no persiste exclusión para otro inicio', async () => {
    const a = memoria();
    expect(await new PreferenciaGuia().noMostrar('A', a)).toBe(false);
    expect(await new PreferenciaGuia().noMostrar('A', a)).toBe(false);
    expect(a.datos.size).toBe(0);
  });
  it('desmarcar elimina el único indicador y permite próximos inicios', async () => {
    const a = memoria(), p = new PreferenciaGuia();
    await p.elegir('A', true, a); await p.elegir('A', false, a);
    expect(a.datos.size).toBe(0); expect(await p.noMostrar('A', a)).toBe(false);
    expect(await new PreferenciaGuia().noMostrar('A', a)).toBe(false);
  });
  it('storage roto conserva sólo la elección en memoria, reversible y por cuenta', async () => {
    const p = new PreferenciaGuia();
    const roto = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('quota'); }, removeItem: () => { throw Error('denied'); } };
    expect(await p.noMostrar('A', roto)).toBe(false);
    await expect(p.elegir('A', true, roto)).resolves.toBeUndefined();
    expect(await p.noMostrar('A', roto)).toBe(true); expect(await p.noMostrar('B', roto)).toBe(false);
    expect(await new PreferenciaGuia().noMostrar('A', roto)).toBe(false);
    await p.elegir('A', false, roto); expect(await p.noMostrar('A', roto)).toBe(false);
  });
  it('sin crypto o storage conserva la elección y el aislamiento en memoria', async () => {
    const p = new PreferenciaGuia(async () => { throw Error('no crypto'); });
    await p.elegir('A', true, memoria());
    expect(await p.noMostrar('A', null)).toBe(true); expect(await p.noMostrar('B', null)).toBe(false);
  });
  it('una lectura demorada no pisa una elección posterior', async () => {
    const resolver: ((s: string) => void)[] = [];
    const p = new PreferenciaGuia(() => new Promise<string>((r) => { resolver.push(r); }));
    const a = memoria(), lectura = p.noMostrar('A', a), eleccion = p.elegir('A', true, a);
    resolver[0]!('hash'); expect(await lectura).toBe(true);
    resolver[1]!('hash'); await eleccion;
  });
  it('marcar/desmarcar rápidamente conserva la última elección aunque crypto resuelva al revés', async () => {
    const resolver: ((s: string) => void)[] = [];
    const p = new PreferenciaGuia(() => new Promise<string>((r) => { resolver.push(r); })), a = memoria();
    const primera = p.elegir('A', true, a), ultima = p.elegir('A', false, a);
    resolver[1]!('hash'); await ultima; resolver[0]!('hash'); await primera;
    expect(a.datos.size).toBe(0); expect(await p.noMostrar('A', a)).toBe(false);
  });
  it('una escritura tardía usa la cuenta capturada y no contamina la siguiente', async () => {
    let resolver!: (s: string) => void;
    const p = new PreferenciaGuia((s) => s === 'auth:A' ? new Promise<string>((r) => { resolver = r; }) : Promise.resolve('hashB'));
    const a = memoria(), escritura = p.elegir('A', true, a);
    expect(await p.noMostrar('B', a)).toBe(false); resolver('hashA'); await escritura;
    expect([...a.datos.entries()]).toEqual([[expect.stringContaining('.hashA'), '1']]);
    expect(await p.noMostrar('B', a)).toBe(false);
  });
  it('sin identidad no lee/escribe; valores desconocidos no excluyen', async () => {
    const p = new PreferenciaGuia(async () => 'hash'), a = memoria();
    await p.elegir('', true, a); expect(await p.noMostrar('', a)).toBe(false); expect(a.datos.size).toBe(0);
    a.setItem('payme.app.guia.optout.v2.real.hash', 'otro');
    a.setItem('payme.app.guia.optout.v2.mock.hash', 'otro');
    expect(await p.noMostrar('A', a)).toBe(false);
  });
});
