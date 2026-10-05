import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MockApiError } from '../api/mock/mockApi';
import {
  aceptarInvitacion,
  etiquetaMasInvitaciones,
  invitacionParaInicio,
  VistaInvitacionEnInicio,
  type DependenciasDeAceptar,
} from './InvitacionEnInicio';
import type { AdmisionEstado, InvitacionMostrable } from './invitacionAdmision';

/**
 * AF-INVITACION-INICIO · decisión 109 · la burbuja de la invitación en Inicio.
 * Lo que se decide (cuál va, cuántas más, qué hace «Sumarme») es puro y se
 * prueba acá; el recorrido entero, en `e2e/invitacion-inicio.spec.ts`.
 */

const t = (s: string, ...a: unknown[]) => s.replace(/\{0\}/g, String(a[0]));

function inv(id: string, admision: AdmisionEstado, extra: Partial<InvitacionMostrable> = {}): InvitacionMostrable {
  return {
    id,
    mesaCode: 'PA-4520',
    restaurante: 'Hanzo Sushi',
    invitador: 'Sofía',
    invitadorCompleto: 'Sofía Fernández',
    fotoDelInvitador: false,
    creada: null,
    admision,
    categoria: null,
    ...extra,
  };
}

describe('invitacionParaInicio · cuál va en la burbuja', () => {
  it('sin invitaciones: ninguna', () => {
    expect(invitacionParaInicio([])).toBeNull();
  });

  it('sólo las que admiten entrar: una de mesa cerrada o sin verificar no aparece', () => {
    expect(invitacionParaInicio([inv('a', 'cerrada'), inv('b', 'desconocida')])).toBeNull();
  });

  it('la primera que admite, en el orden del dueño (la más nueva), y cuántas más admiten', () => {
    const r = invitacionParaInicio([inv('cerrada', 'cerrada'), inv('nueva', 'admite'), inv('vieja', 'admite')]);
    expect(r?.principal.id).toBe('nueva');
    expect(r?.mas).toBe(1);
  });

  it('«+N» no cuenta las que no admiten entrar', () => {
    const r = invitacionParaInicio([inv('a', 'admite'), inv('b', 'cerrada'), inv('c', 'desconocida')]);
    expect(r?.mas).toBe(0);
  });
});

describe('etiquetaMasInvitaciones', () => {
  it('singular con una, plural con más', () => {
    expect(etiquetaMasInvitaciones(1)).toBe('+1 invitación más');
    expect(etiquetaMasInvitaciones(3)).toBe('+3 invitaciones más');
  });
});

describe('aceptarInvitacion · lo mismo desde Avisos que desde Inicio', () => {
  function deps(aceptar: DependenciasDeAceptar['aceptar']) {
    const registro: string[] = [];
    const d: DependenciasDeAceptar = {
      aceptar,
      avisar: (x) => registro.push(`avisar:${x}`),
      t,
      entrarALaMesa: (code) => registro.push(`mesa:${code}`),
      recargar: () => registro.push('recargar'),
    };
    return { d, registro };
  }

  it('acepta ESA invitación, avisa y entra a su mesa', async () => {
    const pedidas: string[] = [];
    const { d, registro } = deps(async (id) => { pedidas.push(id); });
    await aceptarInvitacion(inv('x', 'admite'), d);
    expect(pedidas).toEqual(['x']);
    expect(registro).toEqual(['avisar:Te sumaste a la mesa ✓', 'mesa:PA-4520']);
  });

  it('sin código no navega a ciegas: recarga', async () => {
    const { d, registro } = deps(async () => undefined);
    await aceptarInvitacion(inv('x', 'admite', { mesaCode: null }), d);
    expect(registro).toEqual(['avisar:Te sumaste a la mesa ✓', 'recargar']);
  });

  it('410: «Esta mesa ya cerró.» y recarga, sin entrar', async () => {
    const { d, registro } = deps(async () => { throw new MockApiError(410, 'mesa_not_joinable'); });
    await aceptarInvitacion(inv('x', 'admite'), d);
    expect(registro).toEqual(['avisar:Esta mesa ya cerró.', 'recargar']);
  });

  it('otro error: el aviso genérico y recarga, sin entrar', async () => {
    const { d, registro } = deps(async () => { throw new MockApiError(500, 'boom'); });
    await aceptarInvitacion(inv('x', 'admite'), d);
    expect(registro).toEqual(['avisar:No pudimos aceptar la invitación', 'recargar']);
  });
});

describe('VistaInvitacionEnInicio · la burbuja', () => {
  const vista = (props: Partial<Parameters<typeof VistaInvitacionEnInicio>[0]> = {}) => renderToStaticMarkup(
    <VistaInvitacionEnInicio
      principal={inv('x', 'admite')}
      mas={0}
      ocupada={false}
      onSumarme={() => undefined}
      onVerMas={() => undefined}
      t={t}
      {...props}
    />,
  );

  it('quién invita, a dónde y «Sumarme», con el estilo de la burbuja de la mesa', () => {
    const html = vista();
    expect(html).toContain('class="mesa-card"');
    expect(html).toContain('Sofía te invitó a');
    expect(html).toContain('<div class="mesa-name">Hanzo Sushi</div>');
    expect(html).toContain('>Sumarme</button>');
    // Una sola: sin la fila de «+N».
    expect(html).not.toContain('mesa-more');
    expect(html).not.toContain('mesa-card-group');
  });

  it('🔴 E174-3B · con la foto (slot), va a la izquierda de «X te invitó a»; sin ella, como siempre', () => {
    const con = vista({ foto: <span className="foto-de-prueba" /> });
    expect(con).toContain('<span class="mesa-top-quien"><span class="foto-de-prueba"></span><span class="mesa-kicker">Sofía te invitó a</span></span>');
    const sin = vista();
    expect(sin).not.toContain('mesa-top-quien');
    expect(sin).toContain('<div class="mesa-top"><span class="mesa-kicker">Sofía te invitó a</span></div>');
  });

  it('sin quién invita, el genérico; sin restaurante, sin la línea', () => {
    const html = vista({ principal: inv('x', 'admite', { invitador: null, restaurante: null }) });
    expect(html).toContain('Te invitaron a una mesa');
    expect(html).not.toContain('mesa-name');
  });

  it('con más: el grupo y «+N invitaciones más»', () => {
    expect(vista({ mas: 1 })).toContain('+1 invitación más');
    const html = vista({ mas: 2 });
    expect(html).toContain('class="mesa-card-group"');
    expect(html).toContain('class="mesa-more"');
    expect(html).toContain('+2 invitaciones más');
  });

  it('mientras acepta: «Sumándote…» y el botón deshabilitado', () => {
    const html = vista({ ocupada: true });
    expect(html).toContain('Sumándote…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sumándote…<\/button>/);
  });
});
