import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { extractApiError } from '../api/errors';
import { MockApiError } from '../api/mock/mockApi';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import { traducir } from '../i18n/idioma';

// Ejecuta cada handler real (AST de TypeScript), con dobles sólo para su entorno.
// No reimplementa el catch ni la custodia de la clave. El navegador cubre la UI.
function handler(archivo: string, nombre: string, entorno: Record<string, unknown>): (...a: unknown[]) => Promise<void> {
  const texto = readFileSync(new URL(archivo, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const encontrados: ts.FunctionDeclaration[] = [];
  function visitar(n: ts.Node) { if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) encontrados.push(n); ts.forEachChild(n, visitar); }
  visitar(ast); expect(encontrados).toHaveLength(1);
  const codigo = ts.transpileModule(encontrados[0]!.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(entorno), `${codigo}; return ${nombre};`)(...Object.values(entorno)) as (...a: unknown[]) => Promise<void>;
}
const mensaje = 'Enviaste muchas invitaciones seguidas. Espera unos minutos y vuelve a intentarlo.';
describe('K5 · 429 de invitaciones: mensaje, sin reintento y misma clave', () => {
  for (const code of ['mesa_invitations_rate_limited', 'otro_rate_limited']) for (const nombre of ['copyInvitationLink', 'pedirLinkDelQr', 'makeLink']) for (const idioma of ['es', 'en'] as const) it(`${nombre} ${idioma} ${code}`, async () => {
    const avisos: string[] = []; const errors: Array<string | null> = []; const estados: string[] = [];
    const intentos = new Map<string, string>(); let qr: unknown = null;
    let ocupado = false;
    const cerrojo = () => ({ current: { tryEnter: () => { if (ocupado) return false; ocupado = true; return true; }, leave: () => { ocupado = false; } } });
    const createInvitation = vi.fn().mockRejectedValue(new MockApiError(429, code));
    const entorno = {
      code: 'MESA-EJEMPLO', api: { createInvitation }, extractApiError, isDefinitiveMutationError, isServiceUnavailable,
      t: (s: string, ...a: unknown[]) => traducir(s, idioma, ...a), toast: (s: string) => avisos.push(s),
      newIdempotencyKey: vi.fn(() => 'clave-ejemplo'),
      shareAttemptsRef: { current: intentos }, qrAttemptsRef: { current: intentos }, linkAttemptsRef: { current: intentos },
      shareLinksRef: { current: new Map() }, shareInFlightRef: cerrojo(), qrInFlightRef: cerrojo(), linkInFlightRef: cerrojo(),
      identityEpochRef: { current: { capture: () => 1, isCurrent: () => true } },
      linkDelQr: null, linkDelQrVigente: () => false, setLinkDelQr: (v: unknown) => { qr = v; },
      setStep: () => {}, setLinkState: (s: string) => estados.push(s), setLinkError: (s: string | null) => errors.push(s), setLink: () => {},
    };
    const ejecutar = handler(nombre === 'makeLink' ? './CreateMesaFlow.tsx' : './MesaScreen.tsx', nombre, entorno);
    await ejecutar('MESA-EJEMPLO');
    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(intentos.get('MESA-EJEMPLO')).toBe('clave-ejemplo');
    const esperado = code === 'mesa_invitations_rate_limited'
      ? traducir(mensaje, idioma)
      : traducir(nombre === 'makeLink' ? 'No pudimos confirmar el link. Reintenta la misma operación: vamos a reutilizarla para no crear otra invitación.' : 'No pudimos confirmar el link. Reintenta la misma operación: vamos a reutilizarla.', idioma);
    if (nombre === 'pedirLinkDelQr') { expect(avisos).toEqual([]); expect(qr).toBeNull(); }
    else if (nombre === 'copyInvitationLink') expect(avisos).toEqual([esperado]);
    else { expect(errors.at(-1)).toBe(esperado); expect(estados.at(-1)).toBe('error'); }
    await ejecutar('MESA-EJEMPLO');
    expect(createInvitation).toHaveBeenCalledTimes(2);
    expect(createInvitation.mock.calls.map((c) => c.slice(0, 2))).toEqual([['MESA-EJEMPLO', 'clave-ejemplo'], ['MESA-EJEMPLO', 'clave-ejemplo']]);
    expect(entorno.newIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});
