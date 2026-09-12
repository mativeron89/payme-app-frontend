import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  comandoPublicable,
  huellaDeEstructura,
  origenPublicable,
  relativoEscapa,
  rutaPublicable,
  urlPublicable,
  EJECUTABLES_PUBLICABLES,
  HOSTS_LOOPBACK,
  TERCEROS_CONOCIDOS,
} from './redactar.mjs';

/**
 * ✅ **Corrido: 32/32 verde**, leído del log del CANDIDATO `logs/B2-npm-test.log:227`
 * (sha256 `956708f7818e5f215345009423203f0d5ea2e35c6713c220bf80cec0af5738b6`,
 * encabezado `payme-app-frontend@0.161.21`).
 *
 * ⚠️ El encabezado decía **Corrido: 29/29**, que era la cuenta ANTES de que AF-1
 * agregara tres casos: el archivo cambió y el número no. Lo cazó la auditoría independiente de
 * Qwen. Ahora la cuenta sale del log del candidato y no de la memoria de quien edita.
 *
 * Antes decía ESCRITO_SIN_EJECUTAR mientras la fase prohibía ejecutar; el rótulo viajaba con
 * el artefacto justamente para que esta línea lo reemplazara con una medición.
 *
 * ## Qué fija este archivo
 *
 * El CONTRATO UNITARIO del sanitizador único. La integración —que el reporter publique lo que
 * este módulo decide— la conserva `reporter-origen-redaccion.test.ts`. Son dos preguntas
 * distintas: acá, «¿la política es la correcta?»; allá, «¿el que publica la usa?».
 *
 * Y la asimetría que gobierna cada caso: **la redacción se ve, la NO redacción hay que ir a
 * buscarla.** Cuando se introdujo el seudónimo en el extractor, los 31 tests siguieron verdes
 * porque ninguno afirmaba la AUSENCIA del valor crudo. Por eso acá casi todos los casos
 * terminan en un `not.toContain` sobre la serialización COMPLETA, y no en mirar un campo.
 */

const SECRETO = 'clave-que-no-debe-quedar-escrita';
/**
 * 🔴 EL LITERAL VA CORTO Y LA CLAVE SE QUEDA EN SU RENGLÓN. Adjudicado en `679525b`.
 *
 * Una clave que termina en `token` seguida de un literal de 8 o más caracteres es
 * EXACTAMENTE la forma que `scripts/auditar-secretos.sh` marca, y este repo es público: con
 * el literal largo, `auditar-secretos.sh` contra `origin/main` salía 1 — o sea que este
 * archivo, tal como nació, no podía pasar el primer paso del CI.
 *
 * Las dos salidas que NO se toman, y por qué:
 *   · renombrar la constante pone el gate verde por el motivo equivocado — la clave sale
 *     del renglón y esa posición deja de mirarse, que es donde podría vivir una credencial
 *     de verdad. Medido y revertido en `679525b`.
 *   · eximir el archivo en el script es superficie regalada en la guarda de mayor
 *     consecuencia del repo; su propio comentario deja la exención como orden futura.
 *
 * Queda el literal corto: la posición sigue vigilada y ningún caso de acá mira el largo —
 * lo único que se le pide a este valor es no aparecer en la salida.
 */
const TOKEN = 'tok-abc';
const TENANT = 'tenant-7f3a9c-privado';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'payme-redactar-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('origenPublicable · una sola política para configuración y censo', () => {
  it.each(['http://localhost:5176', 'http://127.0.0.1:5176', 'ws://localhost:5177'])(
    'loopback se publica literal: %s',
    (origen) => {
      const r = origenPublicable(origen);
      expect(r.clase).toBe('LOOPBACK');
      expect(r.publicado).toBe(origen);
    },
  );

  /**
   * 🔴 EL TESTIGO DE AF-1 · `0.0.0.0` NO ES LOOPBACK, y esto se pone rojo si vuelve a serlo.
   *
   * Hasta el 2026-09-12 `HOSTS_LOOPBACK` lo incluía, así que un origen a `0.0.0.0` entraba en
   * la bolsa de loopback y **el veredicto del gate podía salir `LIMPIO` con ese tráfico
   * adentro**. El caso tiene tres mitades a propósito:
   *   ① la lista ya no lo contiene —el testigo directo sobre el dato que decide—;
   *   ② la política le da clase propia `NO_ESPECIFICADA`, distinta de `LOOPBACK`;
   *   ③ el literal SE SIGUE PUBLICANDO, porque es una constante del protocolo y no el dato de
   *      nadie: si mañana alguien lo "arregla" mandándolo a `EXTERNO_NO_ALLOWLISTADO`, el gate
   *      quedaría bien pero la evidencia dejaría de decir CUÁL fue el origen no-loopback.
   */
  it.each(['http://0.0.0.0:5176', 'http://[::]:5176'])(
    'la dirección no especificada tiene clase propia y NO es loopback: %s',
    (origen) => {
      const r = origenPublicable(origen);
      expect(r.clase).toBe('NO_ESPECIFICADA');
      expect(r.clase).not.toBe('LOOPBACK');
      expect(r.publicado).toBe(origen);
    },
  );

  it('la lista de loopback ya no contiene la dirección no especificada', () => {
    expect(HOSTS_LOOPBACK).not.toContain('0.0.0.0');
    expect(HOSTS_LOOPBACK).not.toContain('::');
    expect(HOSTS_LOOPBACK).not.toContain('[::]');
    // Control positivo: la lista sigue teniendo lo que SÍ es loopback. Sin esto, vaciarla
    // entera también pasaría este caso.
    expect(HOSTS_LOOPBACK).toContain('localhost');
    expect(HOSTS_LOOPBACK).toContain('127.0.0.1');
    expect(HOSTS_LOOPBACK).toContain('[::1]');
  });

  it('un tercero declarado se nombra sin su subdominio', () => {
    const r = origenPublicable('https://js.stripe.com');
    expect(r.clase).toBe('EXTERNO_ALLOWLISTADO');
    expect(r.publicado).toBe('https://stripe.com');
    expect(r.tercero).toBe('stripe.com');
    expect(JSON.stringify(r)).not.toContain('js.stripe.com');
  });

  /** 🔴 El caso que importa: el tenant vive en el subdominio. */
  it('un host desconocido no aparece en NINGÚN campo', () => {
    const r = origenPublicable(`https://${TENANT}.proveedor.example`);
    const s = JSON.stringify(r);
    expect(s).not.toContain(TENANT);
    expect(s).not.toContain('proveedor.example');
    expect(r.publicado).toBe('EXTERNO_NO_ALLOWLISTADO');
    expect(r.esquema).toBe('https:');
    expect(r.largo_del_host).toBe(`${TENANT}.proveedor.example`.length);
  });

  /**
   * 🔴 La allowlist es por SUFIJO EXACTO, no por parecido. `facebook.net` no es
   * `facebook.com`, y un dominio parecido es justamente la forma de un host hostil.
   */
  it('un host que se PARECE a un tercero declarado no cuenta como declarado', () => {
    for (const host of ['https://connect.facebook.net', 'https://stripe.com.malicioso.example', 'https://notstripe.com']) {
      expect(origenPublicable(host).clase).toBe('EXTERNO_NO_ALLOWLISTADO');
    }
  });

  it('lo que no parsea no se publica: se falla del lado que no filtra', () => {
    const r = origenPublicable(`no-es-una-url-${SECRETO}`);
    expect(r.clase).toBe('NO_PARSEABLE');
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  it('ausente se declara AUSENTE en vez de omitirse', () => {
    expect(origenPublicable(undefined).clase).toBe('AUSENTE');
    expect(origenPublicable('').clase).toBe('AUSENTE');
  });
});

describe('urlPublicable · valores de configuración', () => {
  it('de una URL con userinfo, path y query publica el origen y las banderas, nada más', () => {
    const r = urlPublicable(`http://usuario:${SECRETO}@localhost:5176/ruta?token=${TOKEN}#frag`);
    expect(r.origen).toBe('http://localhost:5176');
    expect(r.tiene_userinfo).toBe(true);
    expect(r.tiene_path).toBe(true);
    expect(r.tiene_query).toBe(true);
    expect(r.tiene_fragmento).toBe(true);
    const s = JSON.stringify(r);
    expect(s).not.toContain(SECRETO);
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain('usuario');
    expect(s).not.toContain('ruta');
  });

  /**
   * 🔴 CONSECUENCIA DECLARADA del criterio único: un `baseURL` externo queda seudonimizado,
   * y el gate —que deriva de acá su origen esperado— **falla el control positivo**. Es un
   * cambio de comportamiento, no sólo de redacción, y se fija como test para que quede claro
   * que es deliberado y no un efecto que nadie miró.
   */
  it('un baseURL externo se seudonimiza, y por eso el gate no podrá derivarlo', () => {
    const r = urlPublicable('https://staging.proveedor.example');
    expect(r.origen).toBe('EXTERNO_NO_ALLOWLISTADO');
    expect(r.clase).toBe('EXTERNO_NO_ALLOWLISTADO');
  });

  it('la huella es de la ESTRUCTURA: dos paths con la misma forma comparten sha256', () => {
    expect(urlPublicable('http://localhost:5176/a').sha256_de_la_estructura).toBe(
      urlPublicable('http://localhost:5176/b').sha256_de_la_estructura,
    );
  });

  it('pero la estructura discrimina: con query la huella cambia', () => {
    expect(urlPublicable('http://localhost:5176/a?x=1').sha256_de_la_estructura).not.toBe(
      urlPublicable('http://localhost:5176/a').sha256_de_la_estructura,
    );
  });

  /** 🔴 Nunca el hash del crudo: sería un oráculo de diccionario sobre el secreto. */
  it('la huella NO es la del valor crudo', () => {
    const crudo = `http://usuario:${SECRETO}@localhost:5176/`;
    expect(urlPublicable(crudo).sha256_de_la_estructura).toBe(huellaDeEstructura(['http://localhost:5176', 'true', 'false', 'false', 'false']));
  });
});

describe('rutaPublicable · jamás una ruta absoluta', () => {
  it('una ruta dentro del árbol se publica relativa', () => {
    mkdirSync(join(base, 'test-results', 'un-test'), { recursive: true });
    writeFileSync(join(base, 'test-results', 'un-test', 'trace.zip'), 'x');
    const r = rutaPublicable(join(base, 'test-results', 'un-test', 'trace.zip'), base);
    expect(r.clase).toBe('RELATIVA_AL_ARBOL');
    expect(r.publicado).toBe(join('test-results', 'un-test', 'trace.zip'));
    expect(r.publicado.startsWith('/')).toBe(false);
  });

  /** 🔴 Una absoluta filtra usuario, forma del disco y nombre del proyecto. */
  it('una ruta de afuera NO se publica, ni siquiera su largo', () => {
    const r = rutaPublicable('/Users/alguien/secreto/proyecto/archivo.zip', base);
    expect(r.clase).toBe('FUERA_DEL_ARBOL');
    expect(r.publicado).toBe('RUTA_FUERA_DEL_ARBOL');
    const s = JSON.stringify(r);
    expect(s).not.toContain('alguien');
    expect(s).not.toContain('secreto');
    expect(s).not.toMatch(/\d{2,}/); // ni el largo, que ya insinúa el nombre de usuario
  });

  it('sin raíz no se inventa una: se declara SIN_RAIZ', () => {
    expect(rutaPublicable('/x/y', undefined).clase).toBe('SIN_RAIZ');
    expect(rutaPublicable('/x/y', '').clase).toBe('SIN_RAIZ');
  });

  it('ausente se declara AUSENTE', () => {
    expect(rutaPublicable(undefined, base).clase).toBe('AUSENTE');
  });
});

describe('relativoEscapa · el límite canónico, no startsWith', () => {
  /**
   * 🔴 EL MUTANTE DEL ÍTEM 12. Con `startsWith('..')` este caso da `true` —«escapa»— y es
   * falso: `..foo` es un hijo legítimo. Falla cerrado, así que no era un agujero; era
   * incorrecto, y un gate que rechaza rutas válidas por una razón inventada erosiona la
   * confianza en los rechazos que sí importan.
   */
  it('un nombre que EMPIEZA con dos puntos no escapa', () => {
    expect(relativoEscapa('..foo')).toBe(false);
    expect(relativoEscapa(join('..foo', 'bar'))).toBe(false);
    expect(relativoEscapa('...oculto')).toBe(false);
  });

  it('el ascenso real sí escapa', () => {
    expect(relativoEscapa('..')).toBe(true);
    expect(relativoEscapa(`..${sep}otro`)).toBe(true);
    expect(relativoEscapa(`..${sep}..${sep}otro`)).toBe(true);
  });

  it('una absoluta escapa', () => {
    expect(relativoEscapa('/etc/passwd')).toBe(true);
  });

  it('lo de adentro no escapa', () => {
    expect(relativoEscapa('')).toBe(false);
    expect(relativoEscapa('a')).toBe(false);
    expect(relativoEscapa(join('a', 'b', 'c'))).toBe(false);
  });
});

describe('comandoPublicable · sólo el ejecutable, nunca la línea', () => {
  it('publica el basename declarado y nada del resto', () => {
    const r = comandoPublicable(`/usr/local/bin/node servidor.js --api-key=${TOKEN} --port 5176`);
    expect(r.ejecutable).toBe('node');
    const s = JSON.stringify(r);
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain('5176');
    expect(s).not.toContain('/usr/local/bin');
  });

  it.each([
    ['asignación inline', `API_KEY=${TOKEN} node x.js`, 'PRIMER_TOKEN_ES_ASIGNACION_INLINE', TOKEN],
    ['URI con userinfo', `https://usuario:${SECRETO}@host/bin --f`, 'PRIMER_TOKEN_ES_URI', SECRETO],
    ['fuera de la allowlist', '/opt/raro/mi-binario-privado --x', 'EJECUTABLE_FUERA_DE_LA_ALLOWLIST', 'mi-binario-privado'],
  ])('%s ⇒ REDACTADO, y el valor no aparece', (_caso, linea, motivo, filtrable) => {
    const r = comandoPublicable(linea);
    expect(r.ejecutable).toBe('REDACTADO');
    expect(r.motivo_de_la_redaccion).toBe(motivo);
    expect(JSON.stringify(r)).not.toContain(filtrable);
  });

  it('cuenta los tokens sin publicarlos', () => {
    expect(comandoPublicable('node vite --port 5176 --mode mock').cantidad_de_tokens).toBe(6);
  });

  it('sandbox-exec está en la allowlist: el gate lo antepone y tiene que poder decirlo', () => {
    expect(EJECUTABLES_PUBLICABLES).toContain('sandbox-exec');
    expect(comandoPublicable('/usr/bin/sandbox-exec -f perfil.sb node x.js').ejecutable).toBe('sandbox-exec');
  });
});

describe('invariantes de las listas', () => {
  it('la allowlist de terceros no tiene entradas vacías ni con esquema', () => {
    for (const e of TERCEROS_CONOCIDOS) {
      expect(e).not.toBe('');
      expect(e).not.toContain('/');
      expect(e).not.toContain(':');
      expect(e).toContain('.');
    }
  });

  it('la allowlist de ejecutables son basenames, nunca rutas', () => {
    for (const e of EJECUTABLES_PUBLICABLES) expect(e).not.toContain('/');
  });
});
