import { describe, expect, it } from 'vitest';
import {
  evaluarPoliticaScriptLanding,
  leerObjetoLiteralConstante,
} from './landingScriptPolicy';

const artefacto = 'dist-landing/index.html#script[0]';

function fallas(codigo: string): string[] {
  return evaluarPoliticaScriptLanding({ artefacto, codigo })
    .map((falla) => `${falla.regla}: ${falla.mensaje}`);
}

function pasa(codigo: string): void {
  expect(fallas(codigo)).toEqual([]);
}

describe('política AST del JavaScript emitido por la landing', () => {
  it('⭐ artefacto nominal mínimo · sólo capacidades adjudicadas', () => {
    pasa(`
      var nav = document.getElementById('nav');
      nav.textContent = 'ok';
      window.addEventListener('scroll', function () {
        nav.classList.toggle('activo', window.scrollY > 0);
      }, { passive: true });
    `);
  });

  it('🔴 parse error falla cerrado y nombra el artefacto', () => {
    const resultado = evaluarPoliticaScriptLanding({ artefacto, codigo: 'function {' });
    expect(resultado.length).toBeGreaterThan(0);
    expect(resultado.map((f) => `${f.artefacto} ${f.regla}`).join(' · '))
      .toMatch(/dist-landing\/index\.html#script\[0\].*parseo/);
  });

  describe('familia DOM HTML', () => {
    const MUTANTES = [
      "var node = document.getElementById('x'); node.innerHTML = '<b>x</b>';",
      "var node = document.getElementById('x'); node.outerHTML = '<b>x</b>';",
      "var node = document.getElementById('x'); node.insertAdjacentHTML('beforeend', '<b>x</b>');",
      "document.write('<b>x</b>');",
      "document.writeln('<b>x</b>');",
    ];

    it.each(MUTANTES)('🔴 MUTANTE muere: %s', (codigo) => {
      expect(fallas(codigo).join(' · ')).toMatch(/dom-html|capacidad/);
    });

    it('⭐ control negativo cercano: `textContent` sí pasa', () => {
      pasa("var node = document.getElementById('x'); node.textContent = 'texto';");
    });
  });

  describe('familia red y runtime', () => {
    const MUTANTES = [
      "navigator.sendBeacon('/telemetria', 'x');",
      "new EventSource('/eventos');",
      "new Worker('/worker.js');",
      "new SharedWorker('/worker.js');",
      "navigator.serviceWorker.register('/sw.js');",
      "importScripts('/otro.js');",
      "fetch('/api');",
      "new XMLHttpRequest();",
      "new WebSocket('wss://example.test');",
    ];

    it.each(MUTANTES)('🔴 MUTANTE muere: %s', (codigo) => {
      expect(fallas(codigo).length).toBeGreaterThan(0);
    });

    it('⭐ control negativo cercano: listener local sí pasa', () => {
      pasa("function onScroll() {} window.addEventListener('scroll', onScroll, { passive: true });");
    });
  });

  describe('familia navegación y recursos dinámicos', () => {
    const MUTANTES = [
      "location = '/otra';",
      "location.assign('/otra');",
      "window.location.replace('/otra');",
      "window.open('/otra');",
      "var node = document.getElementById('x'); node.src = '/otro.js';",
      "var node = document.getElementById('x'); node.href = '/otra';",
      "var node = document.getElementById('x'); node.action = '/enviar';",
      "var node = document.getElementById('x'); node.setAttribute('src', '/otro.js');",
    ];

    it.each(MUTANTES)('🔴 MUTANTE muere: %s', (codigo) => {
      expect(fallas(codigo).length).toBeGreaterThan(0);
    });

    it('⭐ control negativo cercano: ARIA y texto sí pasan', () => {
      pasa(`
        var langToggle = document.getElementById('x');
        langToggle.setAttribute('aria-label', 'Abrir');
        langToggle.textContent = 'Abrir';
      `);
    });
  });

  it('🔴 llamada o escritura computada no adjudicada falla cerrado', () => {
    expect(fallas("var key = 'open'; window[key]('/otra');").length).toBeGreaterThan(0);
    expect(fallas("var node = document.getElementById('x'); var key = 'href'; node[key] = '/otra';").length)
      .toBeGreaterThan(0);
  });

  it('🔴 una lectura computada del host no puede convertirse en alias ejecutable', () => {
    expect(fallas(`
      var key = 'fetch';
      var onScroll = window[key];
      onScroll('/api');
    `).length).toBeGreaterThan(0);
  });

  it('🔴 el nombre `dict` no lava una lectura computada de `window`', () => {
    expect(fallas(`
      var key = 'fetch';
      var dict = window;
      var onScroll = dict[key];
      onScroll('/api');
    `).join(' · ')).toMatch(/origen-no-acreditado|capacidad-no-adjudicada/);
  });

  it('🔴 destructuring no convierte `window.open` ni `document.write` en callback local', () => {
    expect(fallas("var { open: onScroll } = window; onScroll('/otra');").join(' · '))
      .toMatch(/binding-no-adjudicado|origen-no-acreditado/);
    expect(fallas(`
      var { write: onScroll } = document;
      ['<b>x</b>'].forEach(onScroll, document);
    `).join(' · ')).toMatch(/binding-no-adjudicado|origen-no-acreditado/);
  });

  it('🔴 un parámetro en otro scope no acredita al `sessionStorage` global', () => {
    expect(fallas(`
      function closeMenu(sessionStorage) {}
      sessionStorage.setItem('payme-landing-lang', 'en');
    `).join(' · ')).toMatch(/storage/);
  });

  it('🔴 las funciones locales no se pueden reemplazar después de declararlas', () => {
    expect(fallas(`
      function onScroll() {}
      onScroll = window;
      onScroll();
    `).join(' · ')).toMatch(/origen-no-acreditado/);
  });

  it('🔴 un método permitido no puede lavarse como callback con otros argumentos', () => {
    expect(fallas(`
      var node = document.getElementById('x');
      ['src'].forEach(node.setAttribute, node);
    `).join(' · ')).toMatch(/origen-no-acreditado/);
    expect(fallas(`
      ['otra-clave'].forEach(localStorage.setItem, localStorage);
    `).join(' · ')).toMatch(/origen-no-acreditado/);
  });

  it('🔴 `for…of` no puede reasignar el diccionario ni una función acreditada', () => {
    expect(fallas(`
      var I18N = {};
      function onScroll() {}
      var key = 'fetch';
      for (I18N of [window]) {}
      for (onScroll of [I18N[key]]) {}
      onScroll('/api');
    `).join(' · ')).toMatch(/origen-no-acreditado/);
  });

  it('🔴 destructuring en bucle tampoco puede reasignar una autoridad', () => {
    expect(fallas(`
      var I18N = {};
      function onScroll() {}
      for ([I18N, onScroll] of [[window, window.fetch]]) {}
      onScroll('/api');
    `).join(' · ')).toMatch(/origen-no-acreditado/);
    expect(fallas(`
      var I18N = {};
      function onScroll() {}
      var key = 'fetch';
      for ({ I18N } of [{ I18N: window }]) {}
      for ({ onScroll } of [{ onScroll: I18N[key] }]) {}
      onScroll('/api');
    `).join(' · ')).toMatch(/control-flow-no-adjudicado|origen-no-acreditado/);
  });

  it('🔴 un catch no puede sombrear diccionario ni función acreditada', () => {
    expect(fallas(`
      var I18N = {};
      function onScroll() {}
      try { throw window; } catch (I18N) {
        var key = 'fetch';
        try { throw I18N[key]; } catch (onScroll) {
          onScroll('/api');
        }
      }
    `).join(' · ')).toMatch(/origen-no-acreditado/);
  });

  it('🔴 `I18N` sólo acredita un árbol literal pasivo, nunca un alias del host', () => {
    expect(fallas(`
      var I18N = { en: window };
      function applyLang(lang) {
        var dict = I18N[lang];
        var key = 'fetch';
        ['/api'].forEach(dict[key], dict);
      }
    `).join(' · ')).toMatch(/origen-no-acreditado|capacidad-no-adjudicada/);
  });

  it('🔴 el árbol de datos acreditado no se puede mutar después del parseo', () => {
    expect(fallas(`
      var I18N = { en: { fetch: 'texto' } };
      I18N.textContent = window;
      function applyLang(lang) {
        lang = 'textContent';
        var dict = I18N[lang];
        var key = 'fetch';
        ['/api'].forEach(dict[key], dict);
      }
    `).join(' · ')).toMatch(/árbol de datos inmutable|origen-no-acreditado/);
  });

  it('🔴 propiedades heredadas no pueden convertirse en `Function` y luego red', () => {
    expect(fallas(`
      var I18N = {};
      function applyLang(lang) {
        var dict = I18N[lang];
        var key = 'constructor';
        var holder = { min: dict[key] };
        window.addEventListener('click', holder.min('fetch("/api")'));
      }
      applyLang('constructor');
    `).join(' · ')).toMatch(/origen-no-acreditado|capacidad-no-adjudicada/);
  });

  it('⭐ el lookup nominal exige una clave propia del diccionario', () => {
    pasa(`
      var I18N = { es: { saludo: 'hola' } };
      function applyLang(requestedLang) {
        var lang = requestedLang === 'en' ? 'en' : 'es';
        var dict = I18N[lang];
        var i18nNodes = document.querySelectorAll('[data-i18n]');
        i18nNodes.forEach(function (el) {
          var key = el.getAttribute('data-i18n');
          if (Object.hasOwn(dict, key)) el.textContent = dict[key];
        });
      }
    `);
  });

  it('🔴 `.min` y `.hasOwn` no aceptan receivers fabricados', () => {
    expect(fallas("var holder = { min: function () {} }; holder.min(1, 2);").join(' · '))
      .toMatch(/origen-no-acreditado/);
    expect(fallas("var holder = { hasOwn: function () {} }; holder.hasOwn({}, 'x');").join(' · '))
      .toMatch(/origen-no-acreditado/);
  });

  it('🔴 ningún método permitido acepta un receiver inventado', () => {
    expect(fallas(`
      var holder = { addEventListener: function () {} };
      holder.addEventListener('click', function () {});
    `).join(' · ')).toMatch(/origen-no-acreditado/);
    expect(fallas(`
      var holder = { setAttribute: function () {} };
      holder.setAttribute('aria-label', 'x');
    `).join(' · ')).toMatch(/origen-no-acreditado/);
  });

  it('🔴 dict[key] fuera de la rama `Object.hasOwn` no puede lavar Function heredado', () => {
    expect(fallas(`
      var I18N = { en: {} };
      var i18nNodes = document.querySelectorAll('[data-i18n]');
      function applyLang(requestedLang) {
        var lang = requestedLang === 'en' ? 'en' : 'es';
        var dict = I18N[lang];
        i18nNodes.forEach(function (el) {
          var key = el.getAttribute('data-i18n');
          var holder = { addEventListener: dict[key] };
          window.addEventListener('click', holder.addEventListener('click', 'fetch("/api")'));
        });
      }
      applyLang('en');
    `).join(' · ')).toMatch(/Object\.hasOwn|origen-no-acreditado/);
  });

  it('🔴 declarar un nombre peligroso en otro scope no acredita al global', () => {
    expect(fallas(`
      function closeMenu(fetch) { return fetch; }
      fetch('/api');
    `).join(' · ')).toMatch(/red-runtime/);
  });

  it('🔴 sólo las tres funciones locales del artefacto nominal pueden invocarse', () => {
    expect(fallas('function ejecutar() {} ejecutar();').length).toBeGreaterThan(0);
    pasa('function closeMenu() {} closeMenu();');
  });

  it('⭐ una lectura computada local no se confunde con navegación', () => {
    pasa(`
      var I18N = { es: { saludo: 'hola' } };
      function applyLang(requestedLang) {
        var lang = requestedLang === 'en' ? 'en' : 'es';
        var dict = I18N[lang];
        var el = document.getElementById('x');
        var key = el.getAttribute('data-i18n');
        if (Object.hasOwn(dict, key)) var value = dict[key];
      }
    `);
  });
});

describe('lector AST de literales · nunca ejecuta el snippet', () => {
  it('extrae un objeto de strings anidado', () => {
    expect(leerObjetoLiteralConstante(
      "var I18N = { es: { saludo: 'Hola' }, en: { saludo: 'Hello' } };",
      'I18N',
      artefacto,
    )).toEqual({ es: { saludo: 'Hola' }, en: { saludo: 'Hello' } });
  });

  it('🔴 rechaza expresiones ejecutables aunque produzcan un objeto', () => {
    expect(() => leerObjetoLiteralConstante(
      "var I18N = (function () { return { es: {} }; })();",
      'I18N',
      artefacto,
    )).toThrow(/literal|ejecutar/);
  });

  it('🔴 rechaza claves que puedan alterar el prototipo del objeto leído', () => {
    expect(() => leerObjetoLiteralConstante(
      "var I18N = { '__proto__': { contaminado: 'sí' } };",
      'I18N',
      artefacto,
    )).toThrow(/clave literal inválida/);
  });
});
