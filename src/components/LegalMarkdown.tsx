import type { ReactNode } from 'react';

/** Dialecto acotado del aviso owner: no es un intérprete de HTML/CommonMark.
 * Sólo React crea elementos conocidos; sintaxis desconocida queda como texto.
 * Un bloque con HTML, enlaces, código o escapes se conserva literalmente.
 */
function inline(text: string): ReactNode {
  // Un ':' seguido sólo de cierre de énfasis y espacio no inicia una URI
  // (el owner publica «**Tu foto de perfil es privada:** sólo…»).
  if (/[<>\[\]`\\_~]|\b[a-z][a-z\d+.-]*:(?!\*+(?:\s|$))\S/i.test(text)) return text;
  const marks = [...text.matchAll(/\*+/g)];
  // La secuencia entera debe ser válida antes de consumir UNA marca. Así un
  // interior aparente no altera sintaxis anidada, desconocida o incompleta.
  if (marks.length % 2 !== 0) return text;
  for (let i = 0; i < marks.length; i += 2) {
    const open = marks[i]!;
    const close = marks[i + 1]!;
    const content = text.slice(open.index! + open[0].length, close.index!);
    if (open[0].length > 2 || close[0] !== open[0] || !content || content.trim() !== content) return text;
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < marks.length; i += 2) {
    const open = marks[i]!;
    const close = marks[i + 1]!;
    nodes.push(text.slice(cursor, open.index!));
    const content = text.slice(open.index! + open[0].length, close.index!);
    nodes.push(open[0] === '**' ? <strong key={i}>{content}</strong> : <em key={i}>{content}</em>);
    cursor = close.index! + close[0].length;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

/** Vista pura: no fetch, efectos, storage, autenticación ni metadatos legales.
 * El body original no se modifica: las copias de líneas sirven sólo al render.
 * H1/H2 del documento se subordinan al título de la página como h2/h3.
 */
export function LegalMarkdown({ body }: { readonly body: string }): JSX.Element {
  // HTML y fences no pertenecen al dialecto owner. No intentar adivinar dónde
  // cierran: preservar TODO el body literal antes de separar títulos/listas,
  // incluso si el contenedor tiene líneas vacías o está incompleto.
  if (/[<>]|(?:^|[\r\n])[ \t]*(?:`{3,}|~{3,})/.test(body)) {
    return <div className="legal-markdown" lang="es"><p>{body}</p></div>;
  }
  const lines = body.split(/\r\n|\n|\r/);
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }
    const key = index;
    const heading = /^(#{1,2})[ \t]+(.+)$/.exec(line);
    if (heading) {
      blocks.push(heading[1] === '#'
        ? <h2 key={key}>{inline(heading[2]!)}</h2>
        : <h3 key={key}>{inline(heading[2]!)}</h3>);
      index += 1;
      continue;
    }
    if (/^- +/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^- +/.test(lines[index]!)) {
        const itemKey = index;
        const item = [lines[index]!.replace(/^- +/, '')];
        index += 1;
        while (index < lines.length && lines[index]!.trim()
            && /^(?: {2}|\t)/.test(lines[index]!)) {
          item.push(lines[index]!.replace(/^(?: {2}|\t)/, ''));
          index += 1;
        }
        // Acumular antes de interpretar: **…** puede cruzar una continuación.
        items.push(<li key={itemKey}>{inline(item.join('\n'))}</li>);
      }
      blocks.push(<ul key={key}>{items}</ul>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim()
        && !/^(?:#{1,2}[ \t]+|- +)/.test(lines[index]!)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="legal-markdown" lang="es">{blocks}</div>;
}
