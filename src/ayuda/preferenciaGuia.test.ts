import { describe, expect, it } from 'vitest';
import { PreferenciaGuia } from './preferenciaGuia';

function memoria() {
  const datos = new Map<string, string>();
  return { datos, getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); } };
}

describe('D326 · preferencia voluntaria por cuenta y dispositivo', () => {
  it('persiste sólo un indicador opaco y no contamina otra cuenta ni otro dispositivo', async () => {
    const a = memoria();
    const p = new PreferenciaGuia();
    expect(await p.vista('cuenta-A', a)).toBe(false);
    await p.marcar('cuenta-A', a);
    expect([...a.datos.entries()]).toEqual([[expect.stringMatching(/^payme\.app\.guia\.v1\.(mock|real)\.[a-f0-9]{64}$/), '1']]);
    expect(JSON.stringify([...a.datos])).not.toContain('cuenta-A');
    expect(await new PreferenciaGuia().vista('cuenta-A', a)).toBe(true);
    expect(await p.vista('cuenta-B', a)).toBe(false);
    expect(await new PreferenciaGuia().vista('cuenta-A', memoria())).toBe(false);
  });
  it('storage inaccesible conserva la elección sólo en memoria para esa cuenta', async () => {
    const p = new PreferenciaGuia();
    const roto = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('quota'); } };
    expect(await p.vista('A', roto)).toBe(false);
    await expect(p.marcar('A', roto)).resolves.toBeUndefined();
    expect(await p.vista('A', roto)).toBe(true);
    expect(await p.vista('B', roto)).toBe(false);
    expect(await new PreferenciaGuia().vista('A', roto)).toBe(false);
  });
  it('sin crypto o storage, la guía sigue disponible y las cuentas separadas', async () => {
    const p = new PreferenciaGuia(async () => { throw Error('no crypto'); });
    await p.marcar('A', memoria());
    expect(await p.vista('A', null)).toBe(true);
    expect(await p.vista('B', null)).toBe(false);
  });
  it('una lectura demorada anterior al descarte no revive la oferta', async () => {
    let resolver!: (s: string) => void;
    const p = new PreferenciaGuia(() => new Promise<string>((r) => { resolver = r; }));
    const lectura = p.vista('A', memoria());
    await p.marcar('A', null);
    resolver('digest');
    expect(await lectura).toBe(true);
  });
  it('una escritura tardía guarda la cuenta capturada, nunca la cuenta siguiente', async () => {
    let resolver!: (s: string) => void;
    const p = new PreferenciaGuia((s) => s === 'auth:A' ? new Promise<string>((r) => { resolver = r; }) : Promise.resolve('hashB'));
    const a = memoria();
    const escritura = p.marcar('A', a);
    expect(await p.vista('B', a)).toBe(false);
    resolver('hashA');
    await escritura;
    expect([...a.datos.entries()]).toEqual([[expect.stringContaining('.hashA'), '1']]);
    expect(await p.vista('B', a)).toBe(false);
  });
  it('sin identidad no lee ni escribe y un valor desconocido no descarta la guía', async () => {
    const p = new PreferenciaGuia(async () => 'hash');
    const a = memoria();
    await p.marcar('', a);
    expect(await p.vista('', a)).toBe(false);
    expect(a.datos.size).toBe(0);
    a.setItem('payme.app.guia.v1.real.hash', 'otro');
    expect(await p.vista('A', a)).toBe(false);
  });
});
