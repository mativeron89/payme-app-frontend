import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { traducir } from '../i18n/idioma';
import { TarjetaInvitarConLink, TarjetaInvitarVista, linkVisible, mensajeDeInvitacion, type CargaDelLink } from './InvitarConLink';

/**
 * AF-LINK-DE-INVITACION · D252 · la tarjeta de Amigos. Mati: «ahora solo es el
 * link que necesito que se genere y se pueda compartir para que se empiece a
 * masificar». Los puntos por referido quedan para cuando haya pagos.
 */
const nada = () => undefined;
const LINK = { url: 'https://app.paymemx.com/invitacion/abc123def456', codigo: 'abc123def456' };
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const vista = (carga: CargaDelLink) =>
  renderToStaticMarkup(<TarjetaInvitarVista carga={carga} onCompartir={nada} onCambiar={nada} onReintentar={nada} />);

describe('D252 · la tarjeta «Invita a alguien a PayMe»', () => {
  it('con el link: el título, qué pasa, el link a la vista, compartir y cambiar', () => {
    expect(texto(vista({ tipo: 'listo', link: LINK }))).toBe(
      'Invita a alguien a PayMe Comparte tu link. Quien se registre con él queda como tu amigo. '
      + 'app.paymemx.com/invitacion/abc123def456 Compartir mi link Cambiar mi link');
  });

  it('mientras carga, sin botones; si falla, lo dice y deja reintentar', () => {
    expect(texto(vista({ tipo: 'cargando' }))).not.toContain('Compartir mi link');
    expect(texto(vista({ tipo: 'error' }))).toContain('No pudimos cargar tu link. Reintentar');
  });

  it('🔴 sin la capacidad no hay tarjeta', () => {
    expect(renderToStaticMarkup(<TarjetaInvitarConLink />)).toBe('');
  });

  it('el mensaje que acompaña al link, en los dos idiomas', () => {
    expect(mensajeDeInvitacion(LINK, (s, ...a) => traducir(s, 'es', ...a))).toBe(
      'Te invito a PayMe para dividir la cuenta en el restaurante. Regístrate con mi link: https://app.paymemx.com/invitacion/abc123def456');
    expect(mensajeDeInvitacion(LINK, (s, ...a) => traducir(s, 'en', ...a))).toMatch(/^Join me on PayMe .* https:\/\/app\.paymemx\.com\/invitacion\/abc123def456$/);
  });

  it('el link a la vista va sin el esquema', () => {
    expect(linkVisible('https://app.paymemx.com/invitacion/x')).toBe('app.paymemx.com/invitacion/x');
    expect(linkVisible('http://localhost:5176/invitacion/x')).toBe('localhost:5176/invitacion/x');
  });

  it('🔴 D252 · nada de puntos, premios, saldos ni descuentos en lo que se ve', () => {
    const fuente = readFileSync(new URL('./InvitarConLink.tsx', import.meta.url), 'utf8');
    const textos = [...fuente.matchAll(/t\('([^']+)'/g)].map((m) => m[1]!).join(' | ');
    expect(textos.length).toBeGreaterThan(100);
    expect(textos).not.toMatch(/punto|premio|saldo|descuento|recompensa|gana/i);
  });
});
