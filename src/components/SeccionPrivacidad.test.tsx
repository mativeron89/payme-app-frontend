import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { MockApiError } from '../api/mock/mockApi';
import { aplicarConfigSugerencias, reiniciarSugerenciasParaTests } from '../api/sugerencias';
import type { StoredSession } from '../api/storage';
import { traducir } from '../i18n/idioma';
import type { PermisoFoto } from '../api/fotoPerfilNoAmigos';
import type { EstadoPrivacidadFoto } from './PrivacidadFotoPanel';
import { FilaFotoView, FilaPermisoOpcionalView, SeccionPrivacidad, SeccionPrivacidadView, mensajeDeRechazo, modoDeFilaOpcional } from './SeccionPrivacidad';

const SESION = { family_id: 'f', principal_id: 'p' } as unknown as StoredSession;
const TEXTOS = {
  sugerencias: ['Sugerencias para dividir', 'PayMe te sugiere cómo dividir según las mesas que abriste. Sólo lo ves tú.'],
  analisis_interno: ['Análisis interno de PayMe',
    'Opcional. PayMe analiza, sin tu nombre, cómo se consume en las mesas. No llega a restaurantes ni a otros usuarios. Puedes apagarlo.'],
} as const;

afterEach(() => reiniciarSugerenciasParaTests());

describe('n420 · Configuración › Privacidad, las filas de los permisos opcionales', () => {
  const sinFila = <SeccionPrivacidadView foto={null} sugerencias={null} analisis={null} />;
  const filas = (sug: boolean, ana: boolean) => {
    // La sección real arma las filas según la capacidad; la foto (`useControlFoto`) se prueba aparte.
    aplicarConfigSugerencias({ features: {
      ...(sug ? { sugerencias: { supported: true, enabled: true } } : {}),
      ...(ana ? { analisis_interno: { supported: true, enabled: true } } : {}),
    } });
    return renderToStaticMarkup(<SeccionPrivacidad session={SESION} />);
  };

  it('🔴 sin la foto y con las dos apagadas (hoy, con un servidor sin la finalidad): la sección no se pinta', () => {
    expect(renderToStaticMarkup(sinFila)).toBe('');
    // Mientras consulta el estado de la foto, tampoco: si no, aparecería y se iría con un 404 (salto de pantalla).
    expect(renderToStaticMarkup(<SeccionPrivacidad session={SESION} />)).toBe('');
    const html = filas(false, false);
    expect(html).not.toContain('Sugerencias para dividir');
    expect(html).not.toContain('Análisis interno de PayMe');
  });

  it('🔴 encendidas: «Privacidad» y las dos filas, en ese orden (D426: el análisis debajo)', () => {
    const html = filas(true, true);
    expect(html).toContain('Privacidad');
    expect(html.indexOf('Sugerencias para dividir')).toBeGreaterThan(-1);
    expect(html.indexOf('Análisis interno de PayMe')).toBeGreaterThan(html.indexOf('Sugerencias para dividir'));
  });

  it('una encendida y la otra no: sólo esa fila', () => {
    const html = filas(true, false);
    expect(html).toContain('Sugerencias para dividir');
    expect(html).not.toContain('Análisis interno de PayMe');
  });

  it('🔴 D415 y D426 · los textos aprobados, literales, con el enlace al Aviso', () => {
    for (const [finalidad, [titulo, texto]] of Object.entries(TEXTOS)) {
      const html = renderToStaticMarkup(<FilaPermisoOpcionalView finalidad={finalidad as 'sugerencias'} estado={null} ocupado={false} mensaje={null} onCambiar={() => undefined} />);
      expect(html).toContain(titulo);
      expect(html).toContain(texto);
      expect(html).toContain('Más en el Aviso de Privacidad.');
      expect(html).toContain('href="/privacy"');
      // Sin estado leído, el interruptor queda apagado y deshabilitado: nunca «activado».
      expect(html).toMatch(/role="switch"[^>]*disabled/);
      expect(html).not.toContain('checked');
    }
  });

  it('las dos posiciones del interruptor', () => {
    const fila = (granted: boolean) => renderToStaticMarkup(<FilaPermisoOpcionalView finalidad="sugerencias"
      estado={{ purpose_key: 'sugerencias', granted, state: granted ? 'granted' : 'revoked' }} ocupado={false} mensaje={null} onCambiar={() => undefined} />);
    expect(fila(true)).toMatch(/checked=""/);
    expect(fila(false)).not.toMatch(/checked=""/);
    expect(fila(false)).not.toMatch(/disabled/);
  });

  it('los rechazos: 403 «no disponible para tu cuenta» (sin decir edad), 409 «por ahora», otro «No se pudo guardar»', () => {
    expect(mensajeDeRechazo(new MockApiError(403, 'age_verification_required'))).toBe('no_elegible');
    expect(mensajeDeRechazo(new MockApiError(409, 'notice_version_too_old'))).toBe('por_ahora');
    expect(mensajeDeRechazo(new MockApiError(500, 'internal_error'))).toBe('no_se_guardo');
    expect(mensajeDeRechazo(new Error('consent_grant_unavailable'))).toBe('por_ahora');
    expect(mensajeDeRechazo(new Error('red'))).toBe('no_se_guardo');
    const html = renderToStaticMarkup(<FilaPermisoOpcionalView finalidad="sugerencias" estado={null} ocupado={false} mensaje="no_elegible" onCambiar={() => undefined} />);
    expect(html).toContain('Esta opción no está disponible para tu cuenta.');
    expect(html).not.toMatch(/edad|menor|18/);
  });

  it('🔴 EN · las filas y sus mensajes traducidos', () => {
    const en = (s: string) => traducir(s, 'en');
    expect(en('Sugerencias para dividir')).toBe('Split suggestions');
    expect(en(TEXTOS.sugerencias[1])).toBe('PayMe suggests how to split based on the tables you opened. Only you see it.');
    expect(en('Análisis interno de PayMe')).toBe('PayMe internal analysis');
    expect(en(TEXTOS.analisis_interno[1])).toBe("Optional. PayMe analyzes, without your name, what gets ordered at tables. It isn't shown to restaurants or other users. You can turn it off.");
    expect(en('Más en el Aviso de Privacidad.')).toBe('More in the Privacy Notice.');
    expect(en('Esta opción no está disponible para tu cuenta.')).toBe("This option isn't available for your account.");
    expect(en('Por ahora no está disponible. Prueba de nuevo más tarde.')).toBe('Not available right now. Try again later.');
  });
});

const HASH = '51f9c46f6c5874a0b62dad06e1ead77051cce010ed587de4d720b6add6b002bc';
const permiso = (granted: boolean): PermisoFoto => ({
  purpose_key: 'foto_perfil_no_amigos', granted, state: granted ? 'granted' : 'revoked',
  since: '2026-10-23T00:00:00.000Z', notice_version: '3.1.0', notice_hash: HASH,
});
const AVISO = { kind: 'aviso_privacidad', version: '3.1.0', hash: HASH, effective_from: '2026-10-23T00:00:00.000Z', body: 'x' } as EstadoPrivacidadFoto['aviso'];
const estadoFoto = (o: Partial<EstadoPrivacidadFoto>): EstadoPrivacidadFoto =>
  ({ permiso: null, aviso: null, permiteGrant: false, ocupado: false, error: null, ...o });
const filaFoto = (e: EstadoPrivacidadFoto) => renderToStaticMarkup(<FilaFotoView estado={e} onCambiar={() => undefined} onConsultar={() => undefined} />);

describe('D499 b5 · la fila simple del permiso de foto', () => {
  it('🔴 una fila con su interruptor, el enlace al Aviso y sin el bloque grande de D468', () => {
    const html = filaFoto(estadoFoto({ permiso: permiso(false), aviso: AVISO, permiteGrant: true }));
    expect(html).toContain('Mostrar mi foto a personas que no son mis amigos');
    expect(html).toContain('Permite que otros usuarios vean tu foto en búsquedas, invitaciones y cuando compartas mesas o viajes.');
    expect(html).toContain('Más en el Aviso de Privacidad.');
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    expect(html).not.toMatch(/Aviso de Privacidad Integral|<details|Consultar estado|>Activar<|>Desactivar</);
  });

  it('🔴 activar: sólo con la capacidad y el Aviso 3.1.0 verificado', () => {
    expect(filaFoto(estadoFoto({ permiso: permiso(false), aviso: AVISO, permiteGrant: true }))).not.toMatch(/disabled/);
    const sinAviso = filaFoto(estadoFoto({ permiso: permiso(false), aviso: null, permiteGrant: true }));
    expect(sinAviso).toMatch(/role="switch"[^>]*disabled/);
    expect(sinAviso).toContain('Este permiso no está disponible para activarlo en este momento.');
    expect(filaFoto(estadoFoto({ permiso: permiso(false), aviso: AVISO, permiteGrant: false }))).toMatch(/disabled/);
  });

  it('🔴 D463 · revocar: otorgado, el interruptor queda habilitado aunque no haya capacidad ni Aviso', () => {
    const html = filaFoto(estadoFoto({ permiso: permiso(true), aviso: null, permiteGrant: false }));
    expect(html).toMatch(/checked=""/);
    expect(html).not.toMatch(/disabled/);
  });

  it('mientras consulta o sin estado confirmado, apagado y deshabilitado; un error ofrece consultar de nuevo', () => {
    expect(filaFoto(estadoFoto({ ocupado: true }))).toMatch(/role="switch"[^>]*disabled/);
    const error = filaFoto(estadoFoto({ error: 'No pudimos confirmar el estado del permiso. Puedes consultar de nuevo.' }));
    expect(error).toContain('No pudimos confirmar el estado del permiso. Puedes consultar de nuevo.');
    expect(error).toContain('Consultar estado');
    expect(error).not.toContain('checked');
  });

  it('va primera en la sección, antes de las filas opcionales', () => {
    const html = renderToStaticMarkup(<SeccionPrivacidadView
      foto={{ estado: estadoFoto({ permiso: permiso(false) }), onCambiar: () => undefined, onConsultar: () => undefined }}
      sugerencias={<p>Sugerencias para dividir</p>} analisis={null} />);
    expect(html.indexOf('Mostrar mi foto')).toBeLessThan(html.indexOf('Sugerencias para dividir'));
  });

  it('EN · la fila traducida', () => {
    const en = (s: string) => traducir(s, 'en');
    expect(en('Mostrar mi foto a personas que no son mis amigos')).toBe('Show my photo to people who are not my friends');
    expect(en('Permite que otros usuarios vean tu foto en búsquedas, invitaciones y cuando compartas mesas o viajes. Tus amigos podrán seguir viéndola si lo desactivas.'))
      .not.toBe('Permite que otros usuarios vean tu foto en búsquedas, invitaciones y cuando compartas mesas o viajes. Tus amigos podrán seguir viéndola si lo desactivas.');
    expect(en('Más en el Aviso de Privacidad.')).toBe('More in the Privacy Notice.');
  });
});

/** O1/O2 · auditoría de PR102. «Apagado» con la forma de producción de hoy: `{supported: true, enabled: false}`. */
describe('O1 · revocar sugerencias y análisis con la capacidad apagada (como la foto, D463)', () => {
  const APAGADA = { supported: true, enabled: false } as const;
  const ENCENDIDA = { supported: true, enabled: true } as const;
  const est = (granted: boolean) => ({ purpose_key: 'sugerencias' as const, granted, state: granted ? 'granted' as const : 'never' as const });

  it('🔴 las cuatro combinaciones: otorgado/no otorgado × encendida/apagada', () => {
    expect(modoDeFilaOpcional(ENCENDIDA, est(true), true, false)).toBe('normal');
    expect(modoDeFilaOpcional(ENCENDIDA, est(false), true, false)).toBe('normal');
    expect(modoDeFilaOpcional(APAGADA, est(true), true, false)).toBe('solo_revocar');
    expect(modoDeFilaOpcional(APAGADA, est(false), true, false)).toBe('oculta');
  });

  it('apagada: oculta mientras lee y si la lectura falla; sin la capacidad anunciada, oculta siempre', () => {
    expect(modoDeFilaOpcional(APAGADA, null, false, false)).toBe('oculta');
    expect(modoDeFilaOpcional(APAGADA, null, true, false)).toBe('oculta');
    expect(modoDeFilaOpcional(null, est(true), true, false)).toBe('oculta');
  });

  it('apagada y recién revocada en esta pantalla: sigue, sólo apagada (no desaparece bajo el dedo)', () => {
    expect(modoDeFilaOpcional(APAGADA, { purpose_key: 'sugerencias', granted: false, state: 'revoked' }, true, true)).toBe('solo_revocar');
  });

  it('🔴 sólo para revocar: otorgado, el interruptor está habilitado; no otorgado, deshabilitado (nunca otorga)', () => {
    const vista = (granted: boolean) => renderToStaticMarkup(<FilaPermisoOpcionalView finalidad="sugerencias" soloRevocar
      estado={{ purpose_key: 'sugerencias', granted, state: granted ? 'granted' : 'revoked' }} ocupado={false} mensaje={null} onCambiar={() => undefined} />);
    expect(vista(true)).toMatch(/checked=""/);
    expect(vista(true)).not.toMatch(/disabled/);
    expect(vista(false)).toMatch(/role="switch"[^>]*disabled/);
    // Encendida (no sólo revocar), no otorgado: se puede activar.
    expect(renderToStaticMarkup(<FilaPermisoOpcionalView finalidad="sugerencias"
      estado={{ purpose_key: 'sugerencias', granted: false, state: 'never' }} ocupado={false} mensaje={null} onCambiar={() => undefined} />)).not.toMatch(/disabled/);
  });

  it('🔴 O2 · con la forma de producción y sin leer todavía: la sección no pinta ninguna fila', () => {
    aplicarConfigSugerencias({ features: { sugerencias: APAGADA, analisis_interno: APAGADA } });
    const html = renderToStaticMarkup(<SeccionPrivacidad session={SESION} />);
    expect(html).not.toContain('Sugerencias para dividir');
    expect(html).not.toContain('Análisis interno de PayMe');
    expect(html).toBe('');
  });
});
