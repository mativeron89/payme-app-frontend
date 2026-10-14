/** D328: sólo la casilla explícita excluye futuros inicios. El indicador vista v1
 * no se lee ni migra. Hash + 1 por cuenta/dispositivo, sin perfil, fechas ni red. */
type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Digest = (texto: string) => Promise<string>;
const modo = import.meta.env.VITE_MOCK === '1' ? 'mock' : 'real';
async function digest(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function almacenDeGuia(): Almacen | null {
  try { return window.localStorage; } catch { return null; }
}
export class PreferenciaGuia {
  private readonly elecciones = new Map<string, boolean>();
  private readonly cambios = new Map<string, number>();
  constructor(private readonly resumir: Digest = digest) {}
  private async clave(principal: string): Promise<string> {
    return `payme.app.guia.optout.v2.${modo}.${await this.resumir(`auth:${principal}`)}`;
  }
  async noMostrar(principal: string, almacen: Almacen | null): Promise<boolean> {
    if (!principal) return false;
    if (this.elecciones.has(principal)) return this.elecciones.get(principal)!;
    const cambio = this.cambios.get(principal);
    try {
      const valor = almacen?.getItem(await this.clave(principal));
      if (cambio === this.cambios.get(principal)) this.elecciones.set(principal, valor === '1');
    } catch { /* La ayuda nunca bloquea el uso de la app. */ }
    return this.elecciones.get(principal) ?? false;
  }
  async elegir(principal: string, noMostrar: boolean, almacen: Almacen | null): Promise<void> {
    if (!principal) return;
    this.elecciones.set(principal, noMostrar);
    const cambio = (this.cambios.get(principal) ?? 0) + 1;
    this.cambios.set(principal, cambio);
    try {
      const clave = await this.clave(principal);
      if (cambio !== this.cambios.get(principal)) return;
      if (noMostrar) almacen?.setItem(clave, '1');
      else almacen?.removeItem(clave);
    } catch { /* Sólo memoria para esta cuenta si crypto/storage no están disponibles. */ }
  }
}
export const preferenciaGuia = new PreferenciaGuia();
