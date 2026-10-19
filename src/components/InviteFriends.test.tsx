import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CreateInvitationResponse } from '../api/types';

// `../api` toca `window` al cargarse: acá sólo hace falta la key nueva, y se cuenta.
let claves = 0;
vi.mock('../api', () => ({ api: {}, newIdempotencyKey: () => `clave-${++claves}` }));

const { crearMemoriaDeInvitaciones, invitacionEnCurso, invitarConMemoria, memoriaParaIdentidad } = await import('./InviteFriends');
const { HttpError } = await import('../api/http');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function respuesta(status: 'pending' | 'expired' = 'pending'): CreateInvitationResponse {
  return {
    invitation: { id: 'f1', invitation_type: 'in_app', status, expires_at: '2026-10-19T00:00:00.000Z', created_at: '2026-10-18T00:00:00.000Z' },
  } as CreateInvitationResponse;
}

/** Un envío que registra la key con la que se llamó y contesta lo que se le pida. */
function envio(...resultados: Array<() => Promise<CreateInvitationResponse>>) {
  const usadas: string[] = [];
  let i = 0;
  const enviar = (key: string) => {
    usadas.push(key);
    const r = resultados[Math.min(i, resultados.length - 1)]!;
    i += 1;
    return r();
  };
  return { enviar, usadas };
}

const ambiguo = () => Promise.reject(new Error('red caída'));

/**
 * D379 · el panel de invitar vive en la hoja del engranaje y se desmonta al cerrarla. La memoria de la mesa
 * (claves, reservas y «Invitado ✓») vive afuera: cerrar y reabrir la hoja es volver a usar LA MISMA memoria.
 */
describe('D379 · una memoria por mesa e identidad (memoriaParaIdentidad)', () => {
  it('🔴 con la misma mesa, token y cuenta devuelve LA MISMA memoria: un render más no la renueva', () => {
    const a = memoriaParaIdentidad(null, 'PA-2847', null, 'cuenta-1');
    a.memoria.claves.set('PA-2847::payme_mx_sofi', 'clave-ambigua');
    const b = memoriaParaIdentidad(a, 'PA-2847', null, 'cuenta-1');
    expect(b).toBe(a);
    expect(b.memoria.claves.get('PA-2847::payme_mx_sofi')).toBe('clave-ambigua');
  });

  it('control positivo: otra mesa, otro token o otra cuenta dan otra memoria, vacía', () => {
    const a = memoriaParaIdentidad(null, 'PA-2847', null, 'cuenta-1');
    a.memoria.invitados.add('payme_mx_sofi');
    a.memoria.claves.set('PA-2847::payme_mx_luis', 'clave');
    const cambios: Array<[string, string | null, string | null]> = [
      ['PA-1111', null, 'cuenta-1'],
      ['PA-2847', 'token-de-invitado', 'cuenta-1'],
      ['PA-2847', null, 'cuenta-2'],
      ['PA-2847', null, null],
    ];
    for (const [code, token, cuenta] of cambios) {
      const b = memoriaParaIdentidad(a, code, token, cuenta);
      expect(b.memoria).not.toBe(a.memoria);
      expect(b.memoria.mesa).toBe(code);
      expect(b.memoria.invitados.size).toBe(0);
      expect(b.memoria.claves.size).toBe(0);
    }
  });
});

describe('D379 · la memoria de las invitaciones sobrevive a cerrar y reabrir la hoja', () => {
  it('🔴 un error ambiguo y el reintento sobre la misma memoria (la que recibe el panel al reabrir) usan la MISMA Idempotency-Key', async () => {
    const memoria = crearMemoriaDeInvitaciones('PA-2847');
    const { enviar, usadas } = envio(ambiguo, () => Promise.resolve(respuesta()));
    const primera = await invitarConMemoria(memoria, 'payme_mx_sofi', enviar);
    expect(primera).toMatchObject({ tipo: 'error', definitivo: false });
    // El botón se libera (se puede reintentar), la clave no.
    expect(memoria.reservados.has('payme_mx_sofi')).toBe(false);
    // Al reabrir la hoja, el panel nuevo recibe LA MISMA memoria (la de MesaScreen: ver el cableado y
    // `memoriaParaIdentidad`, abajo). Acá se invita otra vez sobre ella; el remonte de verdad, con React, lo prueba el
    // e2e D379 de `d360-cambios` (en node no hay DOM para montar el panel).
    const segunda = await invitarConMemoria(memoria, 'payme_mx_sofi', enviar);
    expect(segunda).toEqual({ tipo: 'enviada' });
    expect(usadas).toHaveLength(2);
    expect(usadas[1]).toBe(usadas[0]);
    expect(memoria.invitados.has('payme_mx_sofi')).toBe(true);
  });

  it('control positivo: con la memoria perdida (lo que pasaba si vivía en el panel), la key cambia', async () => {
    const { enviar, usadas } = envio(ambiguo, () => Promise.resolve(respuesta()));
    await invitarConMemoria(crearMemoriaDeInvitaciones('PA-2847'), 'payme_mx_sofi', enviar);
    await invitarConMemoria(crearMemoriaDeInvitaciones('PA-2847'), 'payme_mx_sofi', enviar);
    expect(usadas).toHaveLength(2);
    expect(usadas[1]).not.toBe(usadas[0]);
  });

  it('🔴 un toque desde la hoja reabierta mientras la invitación sigue en curso no manda otra', async () => {
    const memoria = crearMemoriaDeInvitaciones('PA-2847');
    let resolver!: (r: CreateInvitationResponse) => void;
    const pendiente = new Promise<CreateInvitationResponse>((r) => { resolver = r; });
    const { enviar, usadas } = envio(() => pendiente);
    const enCurso = invitarConMemoria(memoria, 'payme_mx_sofi', enviar);
    expect(invitacionEnCurso(memoria, 'payme_mx_sofi')).toBe(true);
    // Reabierta, el panel lee «Enviando…» de la memoria y el toque no manda nada.
    expect(await invitarConMemoria(memoria, 'payme_mx_sofi', enviar)).toEqual({ tipo: 'reservado' });
    expect(usadas).toHaveLength(1);
    resolver(respuesta());
    expect(await enCurso).toEqual({ tipo: 'enviada' });
    expect(invitacionEnCurso(memoria, 'payme_mx_sofi')).toBe(false);
    // Invitado ✓: un toque más tampoco reenvía.
    expect(await invitarConMemoria(memoria, 'payme_mx_sofi', enviar)).toEqual({ tipo: 'reservado' });
    expect(usadas).toHaveLength(1);
  });

  it('avisa a quien escucha cuando cambia, aunque el panel que la mandó ya no esté', async () => {
    const memoria = crearMemoriaDeInvitaciones('PA-2847');
    const avisos: string[] = [];
    memoria.oyentes.add(() => avisos.push(invitacionEnCurso(memoria, 'payme_mx_sofi') ? 'enviando' : 'quieta'));
    await invitarConMemoria(memoria, 'payme_mx_sofi', () => Promise.resolve(respuesta()));
    expect(avisos).toEqual(['enviando', 'quieta']);
  });

  it('una respuesta definitiva descarta la key; un vencimiento descarta key y reserva', async () => {
    const memoria = crearMemoriaDeInvitaciones('PA-2847');
    const definitivo = () => Promise.reject(new HttpError(400, { error: 'validation_error' } as never));
    const a = envio(definitivo, () => Promise.resolve(respuesta()));
    expect(await invitarConMemoria(memoria, 'payme_mx_sofi', a.enviar)).toMatchObject({ tipo: 'error', definitivo: true });
    await invitarConMemoria(memoria, 'payme_mx_sofi', a.enviar);
    expect(a.usadas[1]).not.toBe(a.usadas[0]);

    const otra = crearMemoriaDeInvitaciones('PA-2847');
    const b = envio(() => Promise.resolve(respuesta('expired')));
    expect(await invitarConMemoria(otra, 'payme_mx_luis', b.enviar)).toEqual({ tipo: 'vencida' });
    expect(otra.reservados.has('payme_mx_luis')).toBe(false);
    expect(otra.claves.size).toBe(0);
  });

  it('la key es por mesa y destinatario: otra mesa u otra persona no la heredan', async () => {
    const memoria = crearMemoriaDeInvitaciones('PA-2847');
    const { enviar, usadas } = envio(ambiguo);
    await invitarConMemoria(memoria, 'payme_mx_sofi', enviar);
    await invitarConMemoria(memoria, 'payme_mx_luis', enviar);
    await invitarConMemoria(crearMemoriaDeInvitaciones('PA-1111'), 'payme_mx_sofi', enviar);
    expect(new Set(usadas).size).toBe(3);
  });

  it('🔴 el cableado: MesaScreen guarda una memoria por mesa e identidad como ESTADO y la pasa al panel de la hoja, que la usa; «Compartir la mesa» sigue con la suya', () => {
    const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');
    const mesaScreen = leer('src/screens/MesaScreen.tsx');
    expect(mesaScreen).toContain('useState(() =>\n    memoriaParaIdentidad(null, code, guestToken ?? null, session?.principal_id ?? null));');
    expect(mesaScreen).toContain('memoriaParaIdentidad(invitaciones, code, guestToken ?? null, session?.principal_id ?? null);');
    expect(mesaScreen).toContain('if (invitacionesVigentes !== invitaciones) setInvitaciones(invitacionesVigentes);');
    expect(mesaScreen).toContain('memoriaDeInvitaciones={memoriaDeInvitaciones}');
    // No vuelve a un `useMemo`, que React puede descartar.
    expect(mesaScreen).not.toMatch(/useMemo\(\s*\(\) =>\s*(crearMemoriaDeInvitaciones|memoriaParaIdentidad)/);
    const detalle = leer('src/screens/MesaDetailView.tsx');
    expect(detalle).toContain('<InviteFriends code={code} memoria={memoriaDeInvitaciones} />');
    // El cierre sola de la hoja también pliega el panel, como el cierre a mano.
    expect(detalle).toMatch(/if \(hojaDeLaMesa && !hayConfiguracion\) \{\s*setHojaDeLaMesa\(false\);\s*onCloseInvite\?\.\(\);/);
    expect(detalle).toMatch(/const cerrarHojaDeLaMesa = \(\): void => \{\s*setHojaDeLaMesa\(false\);[\s\S]{0,240}onCloseInvite\?\.\(\);/);
    // El panel usa la memoria que recibe y sólo sin ella una propia; y se suscribe para repintarse.
    const panel = leer('src/components/InviteFriends.tsx');
    expect(panel).toMatch(/if \(memoriaDeAfuera\) \{\s*memoria = memoriaDeAfuera;/);
    expect(panel).toContain('memoria.oyentes.add(repintar);');
    expect(leer('src/screens/CreateMesaFlow.tsx')).toContain('<InviteFriends code={code} />');
  });

  /**
   * P-01 (revisión de V sobre 0.254.0) · `toggleGroup` espera la red: si en ese rato se cerró la hoja y el panel se
   * desmontó, la respuesta no toca su estado. En node no hay DOM para desmontarlo de verdad, así que se fija por fuente:
   * la guarda está después del `await` y en el `catch` y el `finally`, y la limpieza del efecto la apaga.
   */
  it('P-01 · la guarda `montado` de toggleGroup: después de esperar el grupo, nada toca el estado de un panel desmontado', () => {
    const panel = readFileSync(join(RAIZ, 'src/components/InviteFriends.tsx'), 'utf8');
    expect(panel).toMatch(/const montado = useRef\(true\);\s*useEffect\(\(\) => \{\s*montado\.current = true;\s*return \(\) => \{ montado\.current = false; \};\s*\}, \[\]\);/);
    const inicio = panel.indexOf('async function toggleGroup(');
    const cuerpo = panel.slice(inicio, panel.indexOf('\n  }\n', inicio));
    const trasEsperar = cuerpo.slice(cuerpo.indexOf('await api.getGroup(g.id);'));
    expect(trasEsperar).toMatch(/^await api\.getGroup\(g\.id\);\s*if \(!montado\.current\) return;/);
    expect(trasEsperar).toMatch(/\} catch \{\s*if \(montado\.current\) setGroupError\(g\.id\);/);
    expect(trasEsperar).toMatch(/\} finally \{\s*if \(montado\.current\) setLoadingGroup\(null\);/);
    // Ningún set de estado después de la espera sin la guarda en su línea, salvo los que van dentro del camino feliz,
    // que ya pasó por `if (!montado.current) return;`.
    const caminoFeliz = trasEsperar.slice(0, trasEsperar.indexOf('} catch {'));
    const resto = trasEsperar.slice(trasEsperar.indexOf('} catch {'));
    expect(caminoFeliz).toContain('if (!montado.current) return;');
    for (const linea of resto.split('\n').filter((l) => /\bset[A-Z]\w*\(/.test(l))) {
      expect(linea, linea).toMatch(/if \(montado\.current\) set[A-Z]\w*\(/);
    }
  });
});
