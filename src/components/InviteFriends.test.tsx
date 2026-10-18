import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CreateInvitationResponse } from '../api/types';

// `../api` toca `window` al cargarse: acá sólo hace falta la key nueva, y se cuenta.
let claves = 0;
vi.mock('../api', () => ({ api: {}, newIdempotencyKey: () => `clave-${++claves}` }));

const { crearMemoriaDeInvitaciones, invitacionEnCurso, invitarConMemoria } = await import('./InviteFriends');
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
describe('D379 · la memoria de las invitaciones sobrevive a cerrar y reabrir la hoja', () => {
  it('🔴 un error ambiguo y el reintento después de reabrir usan la MISMA Idempotency-Key', async () => {
    const memoria = crearMemoriaDeInvitaciones('PA-2847');
    const { enviar, usadas } = envio(ambiguo, () => Promise.resolve(respuesta()));
    const primera = await invitarConMemoria(memoria, 'payme_mx_sofi', enviar);
    expect(primera).toMatchObject({ tipo: 'error', definitivo: false });
    // El botón se libera (se puede reintentar), la clave no.
    expect(memoria.reservados.has('payme_mx_sofi')).toBe(false);
    // Se cierra la hoja (el panel se desmonta) y se reabre: la memoria es la misma.
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

  it('🔴 el cableado: MesaScreen crea una memoria por mesa e identidad y la pasa al panel de la hoja; «Compartir la mesa» sigue con la suya', () => {
    const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');
    const mesaScreen = leer('src/screens/MesaScreen.tsx');
    expect(mesaScreen).toContain('() => crearMemoriaDeInvitaciones(code),');
    expect(mesaScreen).toContain('[code, guestToken, session?.principal_id],');
    expect(mesaScreen).toContain('memoriaDeInvitaciones={memoriaDeInvitaciones}');
    expect(leer('src/screens/MesaDetailView.tsx')).toContain('<InviteFriends code={code} memoria={memoriaDeInvitaciones} />');
    expect(leer('src/screens/CreateMesaFlow.tsx')).toContain('<InviteFriends code={code} />');
  });
});
