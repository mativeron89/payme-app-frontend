/**
 * APP-PWA-B2 · registro del service worker.
 *
 * Sólo en el build REAL de producción: ni en el mock —el riel de desarrollo no
 * tiene `/sw.js`— ni en `npm run dev`. La landing es otro artefacto y no pasa
 * por acá; las páginas públicas de cumplimiento tampoco, porque `main.tsx` lo
 * llama sólo desde la app privada.
 *
 * Devuelve su DECISIÓN en vez de nada, para poder probarla sin navegador: la
 * suite no tiene jsdom, por ratificación de Mati.
 */

export type DecisionRegistro =
  | 'omitido_mock'
  | 'omitido_desarrollo'
  | 'sin_soporte'
  | 'registrado'
  | 'esperando_load';

interface ContenedorSW {
  register(url: string, opciones: RegistrationOptions): Promise<unknown>;
}

export interface EntornoRegistro {
  readonly mock: boolean;
  readonly produccion: boolean;
  readonly serviceWorker: ContenedorSW | undefined;
  readonly readyState: DocumentReadyState;
  readonly alCargar: (hacer: () => void) => void;
}

/**
 * `updateViaCache: 'none'` hace que el navegador revise `/sw.js` SIN pasar por
 * su caché HTTP, así un retiro o una versión nueva llegan en la próxima visita
 * aunque el hosting mande cabeceras de caché largas. Es lo que permite no tocar
 * `vercel.ts`, que está fuera del alcance de esta orden.
 */
export const OPCIONES_REGISTRO: RegistrationOptions = { scope: '/', updateViaCache: 'none' };

export function registrarServiceWorker(entorno: EntornoRegistro): DecisionRegistro {
  if (entorno.mock) return 'omitido_mock';
  if (!entorno.produccion) return 'omitido_desarrollo';
  const contenedor = entorno.serviceWorker;
  if (!contenedor) return 'sin_soporte';
  const registrar = () => {
    // Un service worker que no se registra NUNCA rompe la app: sin él todo
    // funciona igual, sólo sin caché de estáticos. Por eso el error se traga.
    contenedor.register('/sw.js', OPCIONES_REGISTRO).catch(() => undefined);
  };
  // Después de `load`, para no competir con la carga inicial. Si `load` ya
  // pasó —los `import()` de la app pueden resolver después—, esperar un evento
  // que no va a volver a dispararse dejaría el service worker sin registrar.
  if (entorno.readyState === 'complete') {
    registrar();
    return 'registrado';
  }
  entorno.alCargar(registrar);
  return 'esperando_load';
}
