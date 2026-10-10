import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BurbujaInvitar, TarjetaInvitarConLink, type CargaDelLink } from './InvitarConLink';

/**
 * AF-LINK-DE-INVITACION · D252 · invitar con el link propio en Amigos. Mati:
 * «ahora solo es el link que necesito que se genere y se pueda compartir para
 * que se empiece a masificar». Los puntos por referido quedan para cuando haya
 * pagos.
 *
 * D255-4 · Mati (0.233.0): «dejar solo una burbuja de "Invita a alguien a
 * Payme" con el símbolo y que sea cliqueable, que al cliquearla se copie el link
 * directamente, quita todo el resto del texto».
 */
const nada = () => undefined;
const LINK = { url: 'https://app.paymemx.com/invitacion/abc123def456', codigo: 'abc123def456', creadoEn: '2026-10-09T22:00:00.000Z' };
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const vista = (carga: CargaDelLink) => renderToStaticMarkup(<BurbujaInvitar carga={carga} onTocar={nada} />);
const FUENTE = readFileSync(new URL('./InvitarConLink.tsx', import.meta.url), 'utf8');

describe('🔴 D255-4 · una sola burbuja «Invita a alguien a PayMe»', () => {
  it('con el link: toda la burbuja es UN botón, con su ícono y el título, y nada más', () => {
    const html = vista({ tipo: 'listo', link: LINK });
    expect(texto(html)).toBe('Invita a alguien a PayMe');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/^<button type="button" class="card invitar-link">/);
    // Ni el link a la vista ni lo que se quitó.
    for (const fuera of ['app.paymemx.com', 'Comparte tu link', 'Compartir mi link', 'Cambiar mi link']) {
      expect(html).not.toContain(fuera);
    }
  });

  it('mientras carga, la misma burbuja, ocupada; si falló, la misma burbuja', () => {
    expect(vista({ tipo: 'cargando' })).toContain('aria-busy="true"');
    expect(texto(vista({ tipo: 'error' }))).toBe('Invita a alguien a PayMe');
  });

  it('🔴 sin la capacidad no hay burbuja', () => {
    expect(renderToStaticMarkup(<TarjetaInvitarConLink />)).toBe('');
  });

  it('🔴 tocarla copia el LINK (sin mensaje) y avisa «Link copiado»; sin hoja de compartir ni «cambiar»', () => {
    expect(FUENTE).toMatch(/const copiado = await writeClipboardText\(carga\.link\.url\);/);
    expect(FUENTE).toMatch(/toast\(copiado \? t\('Link copiado'\) : t\('No se pudo copiar: tu navegador no habilitó el portapapeles'\)\);/);
    expect(FUENTE).not.toMatch(/navigator\.share|cambiarLinkDeInvitacion|HojaCambiarLink/);
  });

  it('si el link no cargó, tocar lo dice y lo vuelve a pedir; mientras carga, no hace nada', () => {
    expect(FUENTE).toMatch(/if \(carga\.tipo === 'cargando'\) return;/);
    expect(FUENTE).toMatch(/if \(carga\.tipo === 'error'\) \{\s*toast\(t\('No pudimos cargar tu link\. Prueba de nuevo\.'\)\);\s*cargar\(\);/);
  });

  it('🔴 D252 · nada de puntos, premios, saldos ni descuentos en lo que se ve', () => {
    const textos = [...FUENTE.matchAll(/t\('([^']+)'/g)].map((m) => m[1]!).join(' | ');
    expect(textos.length).toBeGreaterThan(100);
    expect(textos).not.toMatch(/punto|premio|saldo|descuento|recompensa|gana/i);
  });
});
