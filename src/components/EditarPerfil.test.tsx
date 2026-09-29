import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  guardarPerfil,
  partesQueCambiaron,
  VistaEditarPerfil,
  type BorradorPerfil,
  type GuardadoresDePerfil,
  type PerfilActual,
  type ResultadoParte,
} from './EditarPerfil';

/**
 * AF-LAPIZ-UNICO · decisión 110 · «Editar perfil»: un solo lápiz para foto,
 * nombre y @. Lo que se decide (qué cambió, en qué orden se guarda, que una
 * falla no frene a las demás) es puro y se prueba acá; el recorrido con el mock,
 * en `e2e/editar-perfil.spec.ts`.
 */

const t = (s: string, ...a: unknown[]) => s.replace(/\{0\}/g, String(a[0]));
const ACTUAL: PerfilActual = { nombre: 'Mati', apellido: 'Verón', arroba: 'mativeron' };
const SIN_CAMBIOS: BorradorPerfil = { nombre: 'Mati', apellido: 'Verón', arroba: 'mativeron', foto: { tipo: 'igual' } };
const foto = new File([new Uint8Array([1, 2, 3])], 'yo.png', { type: 'image/png' });

describe('partesQueCambiaron · se guarda sólo lo que cambió', () => {
  it('sin cambios: nada', () => {
    expect(partesQueCambiaron(SIN_CAMBIOS, ACTUAL)).toEqual([]);
  });

  it('el nombre con espacios de más es el mismo nombre', () => {
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, nombre: '  Mati ', apellido: 'Verón  ' }, ACTUAL)).toEqual([]);
  });

  it('un nombre vacío cuenta como cambio (lo rechaza su guardado, no se ignora)', () => {
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, nombre: '' }, ACTUAL)).toEqual(['nombre']);
  });

  it('el @ se compara normalizado: «@MatiVeron» es el mismo', () => {
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, arroba: '@MatiVeron' }, ACTUAL)).toEqual([]);
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, arroba: 'mati.v' }, ACTUAL)).toEqual(['arroba']);
  });

  it('un @ que no se puede cambiar (en espera o sin @) nunca cuenta', () => {
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, arroba: null }, { ...ACTUAL, arroba: null })).toEqual([]);
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, arroba: 'otro' }, { ...ACTUAL, arroba: null })).toEqual([]);
  });

  it('foto nueva o quitada cuenta; los tres juntos, en orden nombre, @, foto', () => {
    expect(partesQueCambiaron({ ...SIN_CAMBIOS, foto: { tipo: 'quitar' } }, ACTUAL)).toEqual(['foto']);
    expect(partesQueCambiaron(
      { nombre: 'Matías', apellido: 'Verón', arroba: 'mati.v', foto: { tipo: 'nueva', archivo: foto } },
      ACTUAL,
    )).toEqual(['nombre', 'arroba', 'foto']);
  });
});

describe('guardarPerfil · una parte que falla no frena a las demás', () => {
  function guardadores(respuestas: Partial<Record<'nombre' | 'arroba' | 'subirFoto' | 'quitarFoto', ResultadoParte>> = {}) {
    const llamadas: string[] = [];
    const ok: ResultadoParte = { ok: true };
    const g: GuardadoresDePerfil = {
      nombre: async (n, a) => { llamadas.push(`nombre:${n} ${a}`); return respuestas.nombre ?? ok; },
      arroba: async (v) => { llamadas.push(`arroba:${v}`); return respuestas.arroba ?? ok; },
      subirFoto: async (f) => { llamadas.push(`subirFoto:${f.name}`); return respuestas.subirFoto ?? ok; },
      quitarFoto: async () => { llamadas.push('quitarFoto'); return respuestas.quitarFoto ?? ok; },
    };
    return { g, llamadas };
  }

  it('sin cambios no llama a nadie', async () => {
    const { g, llamadas } = guardadores();
    expect(await guardarPerfil(SIN_CAMBIOS, ACTUAL, g)).toEqual({});
    expect(llamadas).toEqual([]);
  });

  it('sólo el nombre: sólo el nombre', async () => {
    const { g, llamadas } = guardadores();
    const r = await guardarPerfil({ ...SIN_CAMBIOS, nombre: 'Matías' }, ACTUAL, g);
    expect(llamadas).toEqual(['nombre:Matías Verón']);
    expect(r).toEqual({ nombre: { ok: true } });
  });

  it('los tres, en orden; el @ ocupado falla y el nombre y la foto se guardan igual', async () => {
    const { g, llamadas } = guardadores({ arroba: { ok: false, error: 'Ese @ no está disponible.' } });
    const r = await guardarPerfil(
      { nombre: 'Matías', apellido: 'Verón', arroba: 'sofi.fernandez', foto: { tipo: 'nueva', archivo: foto } },
      ACTUAL,
      g,
    );
    expect(llamadas).toEqual(['nombre:Matías Verón', 'arroba:sofi.fernandez', 'subirFoto:yo.png']);
    expect(r).toEqual({
      nombre: { ok: true },
      arroba: { ok: false, error: 'Ese @ no está disponible.' },
      foto: { ok: true },
    });
  });

  it('quitar la foto llama a quitarla, no a subir', async () => {
    const { g, llamadas } = guardadores();
    await guardarPerfil({ ...SIN_CAMBIOS, foto: { tipo: 'quitar' } }, ACTUAL, g);
    expect(llamadas).toEqual(['quitarFoto']);
  });
});

describe('VistaEditarPerfil · el formulario', () => {
  const vista = (props: Partial<Parameters<typeof VistaEditarPerfil>[0]> = {}) => renderToStaticMarkup(
    <VistaEditarPerfil
      borrador={SIN_CAMBIOS}
      actual={ACTUAL}
      editaNombreYFoto
      notaDeEspera={null}
      arrobaEnEspera={null}
      fotoUrl={null}
      tieneFoto={false}
      nombreParaAvatar="Mati Verón"
      errores={{}}
      guardando={false}
      onNombre={() => undefined}
      onApellido={() => undefined}
      onArroba={() => undefined}
      onElegirFoto={() => undefined}
      onQuitarFoto={() => undefined}
      onCancelar={() => undefined}
      onGuardar={() => undefined}
      t={t}
      {...props}
    />,
  );

  it('los tres campos juntos: foto, nombre y @, con Cancelar y Guardar', () => {
    const html = vista();
    expect(html).toContain('aria-label="Editar perfil"');
    expect(html).toContain('Cambiar foto de perfil');
    expect(html).toContain('value="Mati"');
    expect(html).toContain('value="Verón"');
    expect(html).toContain('Tu @usuario');
    expect(html).toContain('value="mativeron"');
    expect(html).toContain('>Cancelar</button>');
    expect(html).toContain('>Guardar</button>');
    // Sin foto hoy, no hay nada que eliminar.
    expect(html).not.toContain('Eliminar foto');
  });

  it('con foto: «Eliminar foto»', () => {
    expect(vista({ tieneFoto: true })).toContain('Eliminar foto');
  });

  it('cada error en SU campo', () => {
    const html = vista({ errores: { nombre: 'No pudimos actualizar tu nombre.', arroba: 'Ese @ no está disponible.', foto: 'No pudimos actualizar tu foto.' } });
    expect(html.match(/role="alert"/g)).toHaveLength(3);
    const iNombre = html.indexOf('No pudimos actualizar tu nombre.');
    const iArroba = html.indexOf('Ese @ no está disponible.');
    const iFoto = html.indexOf('No pudimos actualizar tu foto.');
    // La foto va primero, después el nombre, después el @: cada error debajo de lo suyo.
    expect(iFoto).toBeLessThan(html.indexOf('value="Mati"'));
    expect(iNombre).toBeGreaterThan(html.indexOf('value="Verón"'));
    expect(iNombre).toBeLessThan(html.indexOf('Tu @usuario'));
    expect(iArroba).toBeGreaterThan(html.indexOf('value="mativeron"'));
  });

  it('mientras guarda: «Guardando…» y todo deshabilitado', () => {
    const html = vista({ guardando: true });
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Guardando…<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Cancelar<\/button>/);
    expect(html).toMatch(/<input[^>]*value="Mati"[^>]*disabled=""|<input[^>]*disabled=""[^>]*value="Mati"/);
  });

  it('un @ nuevo con formato inválido no deja guardar (como hoy)', () => {
    const html = vista({ borrador: { ...SIN_CAMBIOS, arroba: 'a' } });
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Guardar<\/button>/);
  });

  it('el @ en período de espera: se ve, no se edita, y dice desde cuándo', () => {
    const html = vista({
      borrador: { ...SIN_CAMBIOS, arroba: null },
      actual: { ...ACTUAL, arroba: null },
      arrobaEnEspera: '@mativeron',
      notaDeEspera: 'Puedes volver a cambiar tu @ desde el 28 de octubre.',
    });
    expect(html).toContain('@mativeron');
    expect(html).toContain('Puedes volver a cambiar tu @ desde el 28 de octubre.');
    expect(html).not.toContain('value="mativeron"');
    // La misma frase como error no se repite.
    const conError = vista({
      borrador: { ...SIN_CAMBIOS, arroba: null },
      actual: { ...ACTUAL, arroba: null },
      arrobaEnEspera: '@mativeron',
      notaDeEspera: 'Puedes volver a cambiar tu @ desde el 28 de octubre.',
      errores: { arroba: 'Puedes volver a cambiar tu @ desde el 28 de octubre.' },
    });
    expect(conError.match(/Puedes volver a cambiar tu @/g)).toHaveLength(1);
    expect(conError).toContain('role="alert"');
  });

  it('sin nombre y foto editables (capability apagada): sólo el @', () => {
    const html = vista({ editaNombreYFoto: false });
    expect(html).not.toContain('Cambiar foto de perfil');
    expect(html).not.toContain('value="Mati"');
    expect(html).toContain('value="mativeron"');
  });
});
