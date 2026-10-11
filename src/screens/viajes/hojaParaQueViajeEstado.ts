/**
 * D276-1 · si la hoja «¿Para qué viaje?» está abierta. Es un módulo aparte y sin dependencias a propósito: lo importa
 * el círculo de la barra (`centroPorFechas`) para abrirla, y así ese círculo no arrastra la hoja ni la fachada.
 */
let abierta = false;
const oyentes = new Set<() => void>();
const avisar = () => { for (const o of [...oyentes]) o(); };

export function abrirHojaParaQueViaje(): void {
  if (abierta) return;
  abierta = true;
  avisar();
}

export function cerrarHojaParaQueViaje(): void {
  if (!abierta) return;
  abierta = false;
  avisar();
}

export function hojaParaQueViajeAbierta(): boolean {
  return abierta;
}

export function suscribirHojaParaQueViaje(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
