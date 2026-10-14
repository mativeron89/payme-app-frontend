/** D326: una sola decisión local por cuenta/dispositivo. Sin perfil, timestamps ni red.
 * El digest sigue el patrón local por principal del journal; nunca se persiste el ID crudo.
 * Si crypto/storage fallan, la decisión permanece en memoria, separada por cuenta. */
type Almacen = Pick<Storage, 'getItem' | 'setItem'>;
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
  private readonly vistas = new Set<string>();
  constructor(private readonly resumir: Digest = digest) {}

  private async clave(principal: string): Promise<string> {
    return `payme.app.guia.v1.${modo}.${await this.resumir(`auth:${principal}`)}`;
  }

  async vista(principal: string, almacen: Almacen | null): Promise<boolean> {
    if (!principal) return false;
    if (this.vistas.has(principal)) return true;
    try {
      const valor = almacen?.getItem(await this.clave(principal));
      if (valor === '1') this.vistas.add(principal);
    } catch { /* La ayuda nunca bloquea el uso de la app. */ }
    return this.vistas.has(principal);
  }

  async marcar(principal: string, almacen: Almacen | null): Promise<void> {
    if (!principal) return;
    this.vistas.add(principal);
    try { almacen?.setItem(await this.clave(principal), '1'); } catch { /* Sólo memoria para esta cuenta. */ }
  }
}

export const preferenciaGuia = new PreferenciaGuia();
