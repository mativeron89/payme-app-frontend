import { Fragment } from 'react';

// D456 · lista cerrada de ENLACES.json. Sin HTML ni destinos tomados de la red.
const DESTINOS: Readonly<Record<string, string>> = {
  'https://app.paymemx.com/privacy': 'https://app.paymemx.com/privacy',
  'https://app.paymemx.com/terminos': 'https://app.paymemx.com/terminos',
  'soporte@paymemx.com': 'mailto:soporte@paymemx.com',
};
const REFERENCIA = /https:\/\/[^\s<>"'()\[\]{}]+|[\w.+-]+@[\w.-]+\.[A-Za-z]+/g;

/** Fragmento que conserva textContent, espacios y LF. El contenedor aplica pre-wrap. */
export function TextoLegal({ texto }: { readonly texto: string }) {
  const partes: Array<{ texto: string; href?: string }> = [];
  let desde = 0;
  for (const match of texto.matchAll(REFERENCIA)) {
    const inicio = match.index!;
    if (inicio > desde) partes.push({ texto: texto.slice(desde, inicio) });
    const literal = match[0];
    const etiqueta = literal.replace(/[.,;:!?]+$/, '');
    const href = DESTINOS[etiqueta];
    partes.push(href ? { texto: etiqueta, href } : { texto: literal });
    if (href && etiqueta.length < literal.length) partes.push({ texto: literal.slice(etiqueta.length) });
    desde = inicio + literal.length;
  }
  if (desde < texto.length) partes.push({ texto: texto.slice(desde) });
  return <>{partes.map((p, i) => p.href
    ? <a key={i} href={p.href} target={p.href.startsWith('https:') ? '_blank' : undefined} rel="noreferrer">{p.texto}</a>
    : <Fragment key={i}>{p.texto}</Fragment>)}</>;
}
