import { describe, expect, it } from 'vitest';

import { _paraPruebas } from '../e2e/_reporter-origen.js';

const { urlSegura, proxySeguro, comandoSeguro } = _paraPruebas;

/**
 * ✅ **Corrido: 16/16 verde el 2026-09-11T17:17Z.** Este archivo es la prueba de INTEGRACIÓN
 * —que el reporter USE la política de `scripts/redactar.mjs`—, mientras `redactar.test.ts`
 * fija el contrato unitario. Son dos preguntas distintas: acá «¿el que publica usa la
 * política?», allá «¿la política es la correcta?».
 *
 * LA EVIDENCIA NO PUEDE ARRASTRAR SECRETOS.
 *
 * El reporter de origen escribe un JSON que después se adjunta, se comparte y se audita.
 * Cuatro de los valores que registra traen secretos con facilidad, y ninguno es hipotético:
 *
 *   · `baseURL` y `webServer.url` admiten `user:password@`, path, query y fragmento.
 *     Un `baseURL` con token de sesión en la query es una configuración perfectamente
 *     normal en un entorno de pruebas contra un backend real.
 *   · `use.proxy` es un objeto con `username` y `password`.
 *   · `webServer.command` es una línea entera, y el token puede estar en un flag **o en el
 *     primer token**: `TOKEN=secreto cmd` es una asignación inline válida del shell.
 *   · `CI` puede tener cualquier valor, así que sólo se publica su presencia.
 *
 * 🔴 **Y no se hashea ningún valor crudo.** Una versión anterior guardaba el sha256 del
 * crudo «para comparar sin republicar»: un sha256 no se revierte, pero un secreto de baja
 * entropía se recupera por diccionario contra el hash, así que eso era publicar un oráculo
 * del secreto. Se hashea la ESTRUCTURA sanitizada, y por eso dos URLs con la misma forma
 * comparten hash **a propósito** — hay un test que lo fija.
 *
 * 🔴 Cada caso comprueba DOS cosas distintas: que el campo seguro sea el correcto, y que
 * el secreto **no aparezca en la serialización completa**. Lo segundo es lo que importa:
 * un campo bien redactado no sirve si el valor crudo quedó en otro campo al lado.
 */

const SECRETO = 'clave-que-no-debe-quedar-escrita';
const TOKEN = 'tok-abc123-no-publicar';

describe('urlSegura', () => {
  /**
   * 🔴 El host del fixture pasó a ser `localhost` · ítem 6. Ya no hay dos políticas —una para
   * la configuración y otra para el censo—: hay UNA, y publica el loopback literal porque
   * `localhost` es una constante del protocolo, no el dato de nadie. Un host cualquiera como
   * `host.local` ahora se seudonimiza, y ése es el caso de abajo.
   */
  it('de una URL con userinfo, path y query publica sólo el origen y las banderas', () => {
    const r = urlSegura(`http://usuario:${SECRETO}@localhost:5176/ruta?token=${TOKEN}#frag`);
    expect(r.origen).toBe('http://localhost:5176');
    expect(r.estado).toBe('OK');
    expect(r.tiene_userinfo).toBe(true);
    expect(r.tiene_path).toBe(true);
    expect(r.tiene_query).toBe(true);
    expect(r.tiene_fragmento).toBe(true);
    expect(r.sha256_de_la_estructura).toMatch(/^[0-9a-f]{64}$/);
  });

  /** 🔴 El mutante que importa: el secreto no puede estar en NINGÚN campo de la salida. */
  it('no deja el secreto ni el token en la serialización completa', () => {
    const serializado = JSON.stringify(
      urlSegura(`http://usuario:${SECRETO}@localhost:5176/ruta?token=${TOKEN}`),
    );
    expect(serializado).not.toContain(SECRETO);
    expect(serializado).not.toContain(TOKEN);
    expect(serializado).not.toContain('usuario');
  });

  /**
   * 🔴 INTEGRACIÓN DEL ÍTEM 6: el reporter usa la MISMA política que el censo. Un `baseURL`
   * con un host desconocido ya no se publica, ni siquiera como «origen».
   *
   * ⚠️ Consecuencia declarada, no efecto colateral: `gate-origen.mjs` **deriva** de acá su
   * origen esperado, así que un `baseURL` externo haría fallar el control positivo. Me parece
   * la conducta correcta —un `baseURL` externo no debería pasar en silencio— pero es un cambio
   * de comportamiento, no sólo de redacción, y por eso está fijado como test.
   */
  it('un host desconocido en la configuración se seudonimiza, igual que en el censo', () => {
    const r = urlSegura('https://tenant-7f3a.proveedor.example:5176/x');
    expect(r.origen).toBe('EXTERNO_NO_ALLOWLISTADO');
    expect(JSON.stringify(r)).not.toContain('tenant-7f3a');
    expect(JSON.stringify(r)).not.toContain('proveedor.example');
  });

  it('un tercero declarado sí se nombra, sin su subdominio', () => {
    expect(urlSegura('https://js.stripe.com/v3/').origen).toBe('https://stripe.com');
  });

  it('una URL inválida con un secreto adentro queda NO_VERIFICABLE y hasheada, no en claro', () => {
    const rota = `no-es-una-url-${SECRETO}`;
    const r = urlSegura(rota);
    expect(r.estado).toBe('NO_VERIFICABLE');
    expect(r.origen).toBe('REDACTADO');
    expect(r.sha256_de_la_estructura).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  /**
   * 🔴 El hash es de la ESTRUCTURA, no del crudo. Dos URLs con el mismo origen y las mismas
   * banderas comparten hash a propósito: eso es lo que impide usarlo como oráculo para
   * adivinar el valor por diccionario, que es el motivo por el que se retiró el hash crudo.
   */
  it('el hash es de la estructura: dos paths distintos con la misma forma comparten sha256', () => {
    const a = urlSegura('http://host.local:5176/a');
    const b = urlSegura('http://host.local:5176/b');
    expect(a.origen).toBe(b.origen);
    expect(a.sha256_de_la_estructura).toBe(b.sha256_de_la_estructura);
  });

  it('pero la estructura sí discrimina: con query el hash cambia', () => {
    const sin = urlSegura('http://host.local:5176/a');
    const con = urlSegura('http://host.local:5176/a?x=1');
    expect(con.tiene_query).toBe(true);
    expect(con.sha256_de_la_estructura).not.toBe(sin.sha256_de_la_estructura);
  });

  it('un valor ausente se declara AUSENTE en vez de omitirse', () => {
    expect(urlSegura(undefined).estado).toBe('AUSENTE');
    expect(urlSegura('').estado).toBe('AUSENTE');
  });
});

describe('proxySeguro', () => {
  it('publica el origen del servidor y un booleano, nunca las credenciales', () => {
    const r = proxySeguro({ server: 'http://proxy.local:8080', username: 'u', password: SECRETO });
    expect(JSON.stringify(r)).not.toContain(SECRETO);
    expect(JSON.stringify(r)).not.toContain('"u"');
    expect(r).toMatchObject({ tiene_credenciales: true });
  });

  it('sin proxy declara AUSENTE', () => {
    expect(proxySeguro(undefined)).toBe('AUSENTE');
  });
});

describe('comandoSeguro', () => {
  it('publica el ejecutable si pasa la allowlist, y nunca la línea con el token', () => {
    const r = comandoSeguro(`node servidor.js --api-key=${TOKEN} --port 5176`);
    expect(r['ejecutable']).toBe('node');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(String(r['sha256_de_la_estructura'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cuenta los tokens sin publicarlos', () => {
    const r = comandoSeguro('npx vite --port 5176 --mode mock');
    // 6 tokens: npx · vite · --port · 5176 · --mode · mock. Mi expectativa decía 5 y el
    // código tenía razón: el campo viejo contaba tokens-1 y yo arrastré ese número.
    expect(r['cantidad_de_tokens']).toBe(6);
    expect(JSON.stringify(r)).not.toContain('5176');
  });

  /** 🔴 MUTANTE: `TOKEN=secreto cmd` es una asignación inline válida del shell. */
  it('una asignación inline como primer token NO se publica', () => {
    const r = comandoSeguro(`API_KEY=${TOKEN} node servidor.js`);
    expect(r['ejecutable']).toBe('REDACTADO');
    expect(r['motivo_de_la_redaccion']).toBe('PRIMER_TOKEN_ES_ASIGNACION_INLINE');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  /** 🔴 MUTANTE: una URI como primer token puede traer credenciales en el userinfo. */
  it('una URI como primer token NO se publica', () => {
    const r = comandoSeguro(`https://usuario:${SECRETO}@host/bin --flag`);
    expect(r['ejecutable']).toBe('REDACTADO');
    expect(r['motivo_de_la_redaccion']).toBe('PRIMER_TOKEN_ES_URI');
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  /** 🔴 MUTANTE: un ejecutable fuera de la allowlist tampoco se publica en claro. */
  it('un ejecutable desconocido queda redactado, aunque parezca inofensivo', () => {
    const r = comandoSeguro('/opt/raro/mi-binario-secreto --x');
    expect(r['ejecutable']).toBe('REDACTADO');
    expect(r['motivo_de_la_redaccion']).toBe('EJECUTABLE_FUERA_DE_LA_ALLOWLIST');
    expect(JSON.stringify(r)).not.toContain('mi-binario-secreto');
  });

  it('el basename gana sobre la ruta: /usr/local/bin/node publica «node» y nada más', () => {
    const r = comandoSeguro('/usr/local/bin/node algo.js');
    expect(r['ejecutable']).toBe('node');
    expect(JSON.stringify(r)).not.toContain('/usr/local/bin');
  });
});
