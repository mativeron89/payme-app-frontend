import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResponderInvitacionAViaje, RevisarPagoDeViaje } from './avisosDeViajeVista';

const nada = () => undefined;
const AVISOS = readFileSync(new URL('../AvisosScreen.tsx', import.meta.url), 'utf8');

describe('AF-VIAJES · 1f · responder una invitación a un viaje desde Avisos', () => {
  it('ayuda + «Rechazar» (gris) y «Aceptar» (navy), atados al texto de la fila', () => {
    const html = renderToStaticMarkup(
      <ResponderInvitacionAViaje tituloId="aviso-titulo-n1" ocupada={false} onAceptar={nada} onRechazar={nada} />,
    );
    expect(html).toContain('Al aceptar, ves los tickets del viaje y eliges lo que consumiste.');
    const rechazar = html.indexOf('>Rechazar</button>');
    const aceptar = html.indexOf('>Aceptar</button>');
    expect(rechazar).toBeGreaterThan(0);
    expect(aceptar).toBeGreaterThan(rechazar);
    expect(html).toMatch(/class="btn btn-ghost btn-sm"[^>]*aria-describedby="aviso-titulo-n1"[^>]*>Rechazar/);
    expect(html).toMatch(/class="btn btn-navy btn-sm"[^>]*aria-describedby="aviso-titulo-n1"[^>]*>Aceptar/);
    expect(html).not.toContain('disabled');
    // Mínimo táctil: 44 px.
    expect(html.match(/min-height:var\(--tap-min\)/g)).toHaveLength(2);
  });

  it('mientras responde, los dos botones se apagan', () => {
    const html = renderToStaticMarkup(
      <ResponderInvitacionAViaje tituloId="t" ocupada onAceptar={nada} onRechazar={nada} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('1t · «Revisar» en «marcó que te pagó»', () => {
    const html = renderToStaticMarkup(<RevisarPagoDeViaje tituloId="t2" deshabilitado={false} onRevisar={nada} />);
    expect(html).toMatch(/class="btn btn-teal btn-sm btn-fit"[^>]*aria-describedby="t2"[^>]*>Revisar<\/button>/);
  });

  it('🔴 la pantalla sólo muestra los botones con la invitación pendiente y Viajes encendido', () => {
    expect(AVISOS).toContain("const deViaje = viajesHabilitado && esAvisoDeViaje(n.type);");
    expect(AVISOS).toContain("{invitacionAViaje?.tipo === 'pendiente' && viajeId !== null && (");
    expect(AVISOS).toContain('{deViaje && destino !== null && llevaRevisar(n.type, destino) && (');
    // «Revisar» hace lo mismo que tocar la fila: marca leído y navega.
    expect(AVISOS).toContain('onRevisar={() => openNotification(n, destino)}');
  });

  it('🔴 errores al responder: 404 ⇒ «ya no está disponible»; cualquier otro ⇒ «Prueba de nuevo»', () => {
    const responder = AVISOS.match(/async function responderInvitacionAViaje[\s\S]*?\n  }\n/)?.[0] ?? '';
    expect(responder).toContain("if (tipo === 'no_disponible') toast(t('Este viaje ya no está disponible.'));");
    expect(responder).toContain("else toast(t('No pudimos guardarlo. Prueba de nuevo.'));");
    expect(responder.indexOf('setRespuestasAViajes')).toBeGreaterThan(responder.indexOf('await api.aceptarViaje(viajeId)'));
    expect(responder).toContain('await api.rechazarViaje(viajeId)');
  });
});
