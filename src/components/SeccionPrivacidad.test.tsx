import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { MockApiError } from '../api/mock/mockApi';
import { aplicarConfigSugerencias, reiniciarSugerenciasParaTests } from '../api/sugerencias';
import type { StoredSession } from '../api/storage';
import { traducir } from '../i18n/idioma';
import { FilaPermisoOpcionalView, SeccionPrivacidad, mensajeDeRechazo } from './SeccionPrivacidad';

const SESION = { family_id: 'f', principal_id: 'p' } as unknown as StoredSession;
const TEXTOS = {
  sugerencias: ['Sugerencias para dividir', 'PayMe te sugiere cómo dividir según las mesas que abriste. Sólo lo ves tú.'],
  analisis_interno: ['Análisis interno de PayMe',
    'Opcional. PayMe analiza, sin tu nombre, cómo se consume en las mesas. No llega a restaurantes ni a otros usuarios. Puedes apagarlo.'],
} as const;

afterEach(() => reiniciarSugerenciasParaTests());

describe('n420 · Configuración › Privacidad, las filas de los permisos opcionales', () => {
  it('🔴 apagadas (hoy): la sección no se pinta', () => {
    expect(renderToStaticMarkup(<SeccionPrivacidad session={SESION} />)).toBe('');
    aplicarConfigSugerencias({ features: { sugerencias: { supported: true, enabled: false }, analisis_interno: { supported: true, enabled: false } } });
    expect(renderToStaticMarkup(<SeccionPrivacidad session={SESION} />)).toBe('');
  });

  it('🔴 encendidas: «Privacidad» y las dos filas, en ese orden (D426: el análisis debajo)', () => {
    aplicarConfigSugerencias({ features: { sugerencias: { supported: true, enabled: true }, analisis_interno: { supported: true, enabled: true } } });
    const html = renderToStaticMarkup(<SeccionPrivacidad session={SESION} />);
    expect(html).toContain('Privacidad');
    expect(html.indexOf('Sugerencias para dividir')).toBeGreaterThan(-1);
    expect(html.indexOf('Análisis interno de PayMe')).toBeGreaterThan(html.indexOf('Sugerencias para dividir'));
  });

  it('una encendida y la otra no: sólo esa fila', () => {
    aplicarConfigSugerencias({ features: { sugerencias: { supported: true, enabled: true } } });
    const html = renderToStaticMarkup(<SeccionPrivacidad session={SESION} />);
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
