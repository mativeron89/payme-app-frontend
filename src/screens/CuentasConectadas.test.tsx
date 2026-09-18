import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../api/http';
import { MockApiError } from '../api/mock/mockApi';
import type { StoredSession } from '../api/storage';
import {
  CuentasConectadas,
  CuentasConectadasVista,
  ESTADO_INICIAL,
  claseDeErrorDeVinculo,
  esEstadoDesconocido,
  reducirCuentas,
  type EstadoCuentas,
  type EventoCuentas,
} from './CuentasConectadas';

/**
 * AF-09 · «Cuentas conectadas». Sin jsdom (ratificación de Mati): la lógica vive
 * en una máquina de estados pura y la vista se prueba con `renderToStaticMarkup`,
 * que es el mismo camino que ya usa `ProfileIdentityEditor.test.tsx`.
 */

const SESSION: StoredSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  family_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  principal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  user: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    payme_id: 'payme_mx_a1b2',
    email: 'sintetico@payme.test',
    first_name: 'Sofía',
    last_name: 'Prueba',
    avatar: null,
  },
};

// Literal corto + `.repeat()`, clave en el mismo renglón: ver el auditor de secretos.
const TOKEN = 'z'.repeat(36);

function correr(eventos: EventoCuentas[], desde: EstadoCuentas = ESTADO_INICIAL): EstadoCuentas {
  return eventos.reduce(reducirCuentas, desde);
}

const AL_PASO_CONTRASENA: EventoCuentas[] = [
  { tipo: 'cargada', vinculada: false },
  { tipo: 'empezar' },
  { tipo: 'credencial', idToken: TOKEN },
];

describe('reducirCuentas · el estado sale del dueño', () => {
  it('lo que diga linked-providers es lo que se muestra', () => {
    expect(correr([{ tipo: 'cargada', vinculada: true }])).toEqual({ fase: 'vinculada', aviso: null });
    expect(correr([{ tipo: 'cargada', vinculada: false }])).toEqual({ fase: 'no_vinculada' });
  });

  it('🔴 404 o forma inválida ⇒ `oculto`, NUNCA «No vinculada»', () => {
    // Literal del contrato: «no puede afirmar ni negar una vinculación; no debe
    // mostrarla como desvinculada».
    expect(correr([{ tipo: 'carga_desconocida' }])).toEqual({ fase: 'oculto' });
  });

  it('una falla transitoria se puede reintentar y vuelve a pedir el estado', () => {
    const fallida = correr([{ tipo: 'carga_fallida' }]);
    expect(fallida).toEqual({ fase: 'error_carga' });
    expect(reducirCuentas(fallida, { tipo: 'reintentar' })).toEqual({ fase: 'cargando' });
  });

  it('sólo una cuenta NO vinculada ofrece vincular', () => {
    const vinculada = correr([{ tipo: 'cargada', vinculada: true }]);
    expect(reducirCuentas(vinculada, { tipo: 'empezar' })).toBe(vinculada);
  });
});

describe('reducirCuentas · el flujo de vincular', () => {
  it('credencial ⇒ pide la contraseña, con el id_token en memoria', () => {
    expect(correr(AL_PASO_CONTRASENA)).toEqual({ fase: 'contrasena', idToken: TOKEN, error: null });
  });

  it('vinculó ahora vs. ya estaba: los dos terminan en «Vinculada», con aviso distinto', () => {
    const ok = [...AL_PASO_CONTRASENA, { tipo: 'enviar' } as const];
    expect(correr([...ok, { tipo: 'vinculo_ok', yaEstaba: false }]))
      .toEqual({ fase: 'vinculada', aviso: 'recien' });
    expect(correr([...ok, { tipo: 'vinculo_ok', yaEstaba: true }]))
      .toEqual({ fase: 'vinculada', aviso: 'ya_estaba' });
  });

  it('🔴 contraseña incorrecta CONSERVA el id_token: el dueño la valida antes de consumirlo', () => {
    const estado = correr([
      ...AL_PASO_CONTRASENA,
      { tipo: 'enviar' },
      { tipo: 'vinculo_error', clase: 'contrasena' },
    ]);
    expect(estado).toEqual({ fase: 'contrasena', idToken: TOKEN, error: 'contrasena' });
  });

  it('🔴 un error del proveedor SUELTA el id_token y vuelve a elegir Google', () => {
    for (const clase of ['google', 'red'] as const) {
      const estado = correr([...AL_PASO_CONTRASENA, { tipo: 'enviar' }, { tipo: 'vinculo_error', clase }]);
      expect(estado).toEqual({ fase: 'eligiendo', error: clase });
      expect('idToken' in estado, `quedó un id_token colgado tras «${clase}»`).toBe(false);
    }
  });

  it('🔴 CANCELAR deja todo limpio: sin id_token y de vuelta a «No vinculada»', () => {
    for (const hasta of [AL_PASO_CONTRASENA.slice(0, 2), AL_PASO_CONTRASENA]) {
      const estado = reducirCuentas(correr(hasta), { tipo: 'cancelar' });
      expect(estado).toEqual({ fase: 'no_vinculada' });
      expect(JSON.stringify(estado)).not.toContain(TOKEN);
    }
  });

  it('🔴 mientras se envía NO se cancela: un envío en vuelo puede terminar vinculando', () => {
    const enviando = correr([...AL_PASO_CONTRASENA, { tipo: 'enviar' }]);
    expect(reducirCuentas(enviando, { tipo: 'cancelar' })).toBe(enviando);
  });

  it('🔴 una respuesta que llega tarde no pisa lo que la persona está viendo', () => {
    // Canceló y la respuesta del envío anterior llega después: se ignora.
    const cancelado = correr([...AL_PASO_CONTRASENA, { tipo: 'cancelar' }]);
    expect(reducirCuentas(cancelado, { tipo: 'vinculo_ok', yaEstaba: false })).toBe(cancelado);
    // Una carga vieja tampoco pisa un flujo en curso.
    const eligiendo = correr(AL_PASO_CONTRASENA.slice(0, 2));
    expect(reducirCuentas(eligiendo, { tipo: 'cargada', vinculada: true })).toBe(eligiendo);
  });
});

describe('claseDeErrorDeVinculo · no distingue más de lo que distingue el dueño', () => {
  it('cada respuesta del contrato cae en su clase', () => {
    expect(claseDeErrorDeVinculo(new HttpError(403, { error: 'reauthentication_failed' }))).toBe('contrasena');
    expect(claseDeErrorDeVinculo(new HttpError(429, { error: 'too_many_auth_attempts' }))).toBe('demasiados');
    expect(claseDeErrorDeVinculo(new HttpError(401, { error: 'social_auth_failed' }))).toBe('google');
    expect(claseDeErrorDeVinculo(new HttpError(400, { error: 'validation_error' }))).toBe('google');
    expect(claseDeErrorDeVinculo(new HttpError(503, { error: 'social_auth_failed' }))).toBe('red');
    expect(claseDeErrorDeVinculo(new TypeError('Failed to fetch'))).toBe('red');
    expect(claseDeErrorDeVinculo(new Error('google_link_response_malformed'))).toBe('red');
  });

  it('el mock produce las mismas clases que el real', () => {
    expect(claseDeErrorDeVinculo(new MockApiError(403, 'reauthentication_failed'))).toBe('contrasena');
    expect(claseDeErrorDeVinculo(new MockApiError(401, 'social_auth_failed'))).toBe('google');
  });

  it('🔴 un 403 que NO es reautenticación no se presenta como «contraseña incorrecta»', () => {
    expect(claseDeErrorDeVinculo(new HttpError(403, { error: 'otra_cosa' }))).toBe('red');
  });
});

describe('esEstadoDesconocido · qué lectura NO permite afirmar nada', () => {
  it('404 del backend anterior y forma inválida ⇒ desconocido; lo demás es transitorio', () => {
    expect(esEstadoDesconocido(new HttpError(404, { error: 'not_found' }))).toBe(true);
    expect(esEstadoDesconocido(new Error('linked_providers_response_malformed'))).toBe(true);
    expect(esEstadoDesconocido(new HttpError(503, { error: 'internal_error' }))).toBe(false);
    expect(esEstadoDesconocido(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('CuentasConectadasVista · lo que se ve en cada estado', () => {
  const render = (estado: EstadoCuentas, password = '') =>
    renderToStaticMarkup(<CuentasConectadasVista estado={estado} password={password} />);

  it('🔴 `oculto` no pinta NADA: ni la sección ni un «No vinculada»', () => {
    expect(render({ fase: 'oculto' })).toBe('');
  });

  it('el estado va en texto, no sólo en color', () => {
    expect(render({ fase: 'vinculada', aviso: null })).toContain('Vinculada');
    const no = render({ fase: 'no_vinculada' });
    expect(no).toContain('No vinculada');
    expect(no).toContain('Vincular Google');
  });

  it('una cuenta vinculada NO ofrece vincular (no hay desvincular en v1)', () => {
    const html = render({ fase: 'vinculada', aviso: null });
    expect(html).not.toContain('Vincular Google');
    expect(html).not.toContain('Desvincular');
  });

  it('los dos avisos de éxito son distintos', () => {
    expect(render({ fase: 'vinculada', aviso: 'recien' })).toContain('Listo: ya puedes entrar con Google.');
    expect(render({ fase: 'vinculada', aviso: 'ya_estaba' })).toContain('Esta cuenta de Google ya estaba vinculada.');
  });

  it('🔴 el campo de contraseña: autocomplete current-password, límites del dueño y sin prellenar', () => {
    const html = render({ fase: 'contrasena', idToken: TOKEN, error: null });
    expect(html).toContain('type="password"');
    // `renderToStaticMarkup` conserva el camelCase de React (medido, no supuesto);
    // el navegador lee los atributos sin distinguir mayúsculas.
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('maxLength="128"');
    expect(html).toContain('value=""');
    // El id_token vive en el estado, jamás en el marcado.
    expect(html).not.toContain(TOKEN);
  });

  it('🔴 contraseña incorrecta: mensaje opaco, y el campo queda marcado', () => {
    const html = render({ fase: 'contrasena', idToken: TOKEN, error: 'contrasena' });
    expect(html).toContain('La contraseña no es correcta.');
    expect(html).toContain('aria-invalid="true"');
  });

  it('🔴 el error del proveedor no dice POR QUÉ falló (otra cuenta, vencido, repetido)', () => {
    const html = render({ fase: 'eligiendo', error: 'google' });
    expect(html).toContain('No pudimos vincular esa cuenta de Google. Inténtalo de nuevo.');
    for (const delator of ['otra cuenta', 'ya está vinculada a', 'vencid', 'expir']) {
      expect(html.toLowerCase()).not.toContain(delator);
    }
  });

  it('🔴 enviando: todo bloqueado, incluido Cancelar', () => {
    const html = render({ fase: 'enviando', idToken: TOKEN });
    expect(html).toContain('Un segundo…');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3); // campo, Vincular, Cancelar
  });

  it('🔴 sin el naranja de marca: la acción de Configuración va en navy', () => {
    for (const estado of [
      { fase: 'no_vinculada' },
      { fase: 'contrasena', idToken: TOKEN, error: null },
    ] as EstadoCuentas[]) {
      const html = render(estado);
      expect(html).toContain('btn-navy');
      expect(html).not.toContain('ingreso-entrar');
      expect(html).not.toContain('btn-primary');
    }
  });
});

describe('CuentasConectadas · la capability del dueño decide si existe', () => {
  it('🔴 capability APAGADA ⇒ la sección no se renderiza', () => {
    const html = renderToStaticMarkup(
      <CuentasConectadas linking={false} webClientId="mock-google-client-id" session={SESSION} />,
    );
    expect(html).toBe('');
  });

  it('🔴 control positivo: con la capability ENCENDIDA sí se renderiza', () => {
    // Sin esto, el caso de arriba pasaría también si la sección no se
    // renderizara nunca, que es exactamente el falso verde que hay que evitar.
    const html = renderToStaticMarkup(
      <CuentasConectadas linking webClientId="mock-google-client-id" session={SESSION} />,
    );
    expect(html).toContain('Cuentas conectadas');
    expect(html).toContain('Cargando…');
  });

  it('sin client id de Google no hay botón que montar: no se renderiza', () => {
    const html = renderToStaticMarkup(
      <CuentasConectadas linking webClientId={null} session={SESSION} />,
    );
    expect(html).toBe('');
  });
});

describe('MasScreen · el cableado, no sólo la función', () => {
  const mas = readFileSync(new URL('./MasScreen.tsx', import.meta.url), 'utf8');

  it('🔴 monta la sección con la capability REAL del dueño y sólo con sesión', () => {
    expect(mas).toContain('useSocialAuthCapability()');
    expect(mas).toMatch(/\{session && \(\s*<CuentasConectadas/);
    expect(mas).toContain('linking={social.google.linking}');
    expect(mas).toContain('webClientId={social.google.webClientId}');
  });
});
