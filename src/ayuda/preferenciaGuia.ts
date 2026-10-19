/**
 * D328 · D364 · Q1 de V · dos marcas de la guía por cuenta y dispositivo: hash + 1,
 * sin perfil, fechas ni red, mock y real separados, y respaldo en memoria.
 *
 * - `optout.v2` es el «No volver a mostrar» de D328. **D364 la deja de sólo
 *   lectura:** quien la marcó no ve la tarjeta Tutorial (le queda Más → Ayuda,
 *   Q8) y nada la vuelve a escribir. El indicador `vista` v1 no se lee ni migra.
 * - `tarjeta.v1` es la tarjeta Tutorial oculta (Q1). La escriben la ✕ roja de la
 *   tarjeta y el final de la guía; abrir la guía la borra, así que si la persona
 *   la deja a medias la tarjeta vuelve, como dice la ficha.
 */
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
export class MarcaDeGuia {
  private readonly valores = new Map<string, boolean>();
  private readonly cambios = new Map<string, number>();
  constructor(private readonly prefijo: string, private readonly resumir: Digest = digest) {}
  private async clave(principal: string): Promise<string> {
    return `${this.prefijo}.${modo}.${await this.resumir(`auth:${principal}`)}`;
  }
  async leer(principal: string, almacen: Almacen | null): Promise<boolean> {
    if (!principal) return false;
    if (this.valores.has(principal)) return this.valores.get(principal)!;
    const cambio = this.cambios.get(principal);
    try {
      const valor = almacen?.getItem(await this.clave(principal));
      if (cambio === this.cambios.get(principal)) this.valores.set(principal, valor === '1');
    } catch { /* La ayuda nunca bloquea el uso de la app. */ }
    return this.valores.get(principal) ?? false;
  }
  async fijar(principal: string, valor: boolean, almacen: Almacen | null): Promise<void> {
    if (!principal) return;
    this.valores.set(principal, valor);
    const cambio = (this.cambios.get(principal) ?? 0) + 1;
    this.cambios.set(principal, cambio);
    try {
      const clave = await this.clave(principal);
      if (cambio !== this.cambios.get(principal)) return;
      if (valor) almacen?.setItem(clave, '1');
      else almacen?.removeItem(clave);
    } catch { /* Sólo memoria para esta cuenta si crypto/storage no están disponibles. */ }
  }
}
/** D328 · sólo se LEE (D364). */
export const noVolverAMostrar = new MarcaDeGuia('payme.app.guia.optout.v2');
/** Q1 · la tarjeta Tutorial oculta. */
export const tarjetaTutorialOculta = new MarcaDeGuia('payme.app.guia.tarjeta.v1');
