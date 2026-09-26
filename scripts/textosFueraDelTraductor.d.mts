export interface HallazgoDeTexto {
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
  readonly via: string;
}
export const ATRIBUTOS_VISIBLES: ReadonlySet<string>;
export function censarFuente(rel: string, codigo: string): HallazgoDeTexto[];
export function censar(): HallazgoDeTexto[];
