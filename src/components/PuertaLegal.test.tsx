import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { claveDelPar, parCambio, PuertaLegalView, puertaLista } from './PuertaLegal';
import type { StoredSession } from '../api/storage';

function render(aceptaMayor: boolean, aceptaTerminos: boolean, busy = false, error: string | null = null): string {
  return renderToStaticMarkup(
    <IdiomaProvider>
      <PuertaLegalView
        aceptaMayor={aceptaMayor}
        aceptaTerminos={aceptaTerminos}
        busy={busy}
        error={error}
        onAceptaMayor={() => undefined}
        onAceptaTerminos={() => undefined}
        onContinuar={() => undefined}
        onCerrarSesion={() => undefined}
      />
    </IdiomaProvider>,
  );
}

describe('AF2 · puerta de aceptación para quien ya tiene cuenta (decisiones 40, 44, 45)', () => {
  it('muestra los textos aprobados, los dos enlaces y las dos salidas', () => {
    const html = render(false, false);
    expect(html).toContain('Actualizamos nuestros documentos');
    expect(html).toContain('Para seguir usando PayMe, confirma lo siguiente:');
    expect(html).toContain('Declaro que tengo 18 años o más.');
    expect(html).toContain('He leído y acepto los');
    expect(html).toContain('href="/terminos"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('se mostrará a tus amigos y a quien organice una mesa');
    expect(html).toContain('PayMe es sólo para personas de 18 años o más.');
    expect(html).toContain('Continuar');
    expect(html).toContain('Cerrar sesión');
    // No hay forma de cerrarla: ni «Ahora no» ni una cruz.
    expect(html).not.toContain('Ahora no');
    expect(html).toContain('aria-modal="true"');
  });

  it('«Continuar» sólo se habilita con las DOS casillas marcadas', () => {
    const boton = (html: string) => /<button[^>]*class="ingreso-entrar"[^>]*>/.exec(html)![0];
    expect(boton(render(false, false))).toContain('disabled=""');
    expect(boton(render(true, false))).toContain('disabled=""');
    expect(boton(render(false, true))).toContain('disabled=""');
    expect(boton(render(true, true))).not.toContain('disabled=""');
    expect(boton(render(true, true, true))).toContain('disabled=""');
  });

  it('un error se dice sin cerrar la puerta', () => {
    const html = render(true, true, false, 'No pudimos guardar tu confirmación. Prueba de nuevo.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('No pudimos guardar tu confirmación');
    expect(html).toContain('Continuar');
  });
});

/**
 * AF-PUERTA-JOIN · `puertaLista` decide si `JoinMesaScreen` puede canjear. Se
 * prueba la función pura porque el orden de los efectos (hijo antes que padre)
 * es justo lo que el `useEffect` no deja ver en esta suite sin librería de render.
 */
describe('AF-PUERTA-JOIN · la puerta está lista sólo para la sesión que consultó', () => {
  const s1 = { principal_id: 'p1' } as unknown as StoredSession;
  const s2 = { principal_id: 'p2' } as unknown as StoredSession;
  const aceptacion = { required: true, aviso: { version: '3.0.0', hash: 'a'.repeat(64) }, terminos: { version: '1.0.0', hash: 'b'.repeat(64) } };

  it('abierta o cerrada para ESTA sesión: lista', () => {
    expect(puertaLista({ estado: { fase: 'abierta' }, sesion: s1 }, s1)).toBe(true);
    expect(puertaLista({ estado: { fase: 'cerrada', aceptacion }, sesion: s1 }, s1)).toBe(true);
  });

  it('en vuelo: no lista', () => {
    expect(puertaLista({ estado: { fase: 'consultando' }, sesion: s1 }, s1)).toBe(false);
  });

  it('🔴 el «abierta» de la sesión nula (o de otra) no vale para la que acaba de entrar', () => {
    // Es el render en el que la persona entra desde el link: el hijo canjearía
    // antes de que el hook consulte.
    expect(puertaLista({ estado: { fase: 'abierta' }, sesion: null }, s1)).toBe(false);
    expect(puertaLista({ estado: { fase: 'abierta' }, sesion: s2 }, s1)).toBe(false);
  });
});

/**
 * AF-CORRECCIONES-AUDITORIA · AF-01 (auditoría Codex). La puerta se monta una
 * por par (`key` en `App.tsx`) y avisa cuando la relectura trajo otro par. El
 * recorrido con 409, 503 y red está en `e2e/legal-cambio-de-par.spec.ts`.
 */
describe('AF-01 · el gesto queda atado al par versión+hash', () => {
  const s1 = { principal_id: 'p1' } as unknown as StoredSession;
  const s2 = { principal_id: 'p2' } as unknown as StoredSession;
  const parA = { required: true, aviso: { version: '3.0.0', hash: 'a'.repeat(64) }, terminos: { version: '1.0.0', hash: 'b'.repeat(64) } };
  const cerradaA = { estado: { fase: 'cerrada' as const, aceptacion: parA }, sesion: s1 };

  it('claveDelPar cambia con cualquiera de los cuatro campos y no con otra cosa', () => {
    expect(claveDelPar({ ...parA })).toBe(claveDelPar(parA));
    expect(claveDelPar({ ...parA, aviso: { ...parA.aviso, version: '3.0.1' } })).not.toBe(claveDelPar(parA));
    expect(claveDelPar({ ...parA, aviso: { ...parA.aviso, hash: 'c'.repeat(64) } })).not.toBe(claveDelPar(parA));
    expect(claveDelPar({ ...parA, terminos: { ...parA.terminos, version: '1.0.1' } })).not.toBe(claveDelPar(parA));
    expect(claveDelPar({ ...parA, terminos: { ...parA.terminos, hash: 'c'.repeat(64) } })).not.toBe(claveDelPar(parA));
  });

  it('parCambio: sólo con la puerta cerrada de ESTA sesión y un par distinto que sigue pendiente', () => {
    const parB = { ...parA, terminos: { version: '1.0.1', hash: 'c'.repeat(64) } };
    expect(parCambio(cerradaA, s1, parB)).toBe(true);
    // El mismo par (un 409 que relee lo mismo, o un 428): no cambió nada.
    expect(parCambio(cerradaA, s1, { ...parA })).toBe(false);
    // Otra sesión, o la puerta no estaba cerrada: no hay casillas que invalidar.
    expect(parCambio(cerradaA, s2, parB)).toBe(false);
    expect(parCambio({ estado: { fase: 'abierta' }, sesion: s1 }, s1, parB)).toBe(false);
    expect(parCambio({ estado: { fase: 'consultando' }, sesion: s1 }, s1, parB)).toBe(false);
    // Ya aceptado en otro lado: la puerta se abre, no hay aviso.
    expect(parCambio(cerradaA, s1, { required: false, aviso: null, terminos: null })).toBe(false);
  });
});
