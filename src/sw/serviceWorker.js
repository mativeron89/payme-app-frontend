/*
 * PayMe · service worker (APP-PWA-B2-SERVICE-WORKER-AF-15-20260918).
 *
 * Decisión de Mati, 2026-09-18: «Sí, sólo para archivos estáticos (Recomendada)».
 *
 * ESTE ARCHIVO ES UNA PLANTILLA. `vite.config.ts` lo emite como `/sw.js` en el
 * build REAL —nunca en el mock ni en la landing— reemplazando la versión por la
 * del paquete. No se importa desde la app: corre en su propio contexto.
 *
 * ── Qué hace, y sobre todo qué NO hace ─────────────────────────────────────
 *
 * Cache-first ÚNICAMENTE para tres cosas del mismo origen, todas GET:
 *   · `/assets/<nombre>-<hash8>.<js|css|ttf|woff|woff2>` — los que Vite emite
 *     con hash en el nombre. Un nombre con hash apunta a un contenido fijo:
 *     servirlo desde caché nunca puede servir una versión vieja.
 *   · `/pwa/<nombre>.png` — los íconos de instalación.
 *
 * TODO lo demás pasa sin tocar —sin `respondWith`, así que el navegador hace su
 * request normal—: `index.html`, cualquier navegación, `/privacy`,
 * `/facebook-data-deletion/*`, el manifest, este mismo archivo, y TODO request a
 * otro origen: la API de PayMe, Stripe, Google. Nada de la API se cachea jamás.
 *
 * 🔴 Por qué `index.html` nunca entra: es el único archivo que nombra a los
 * demás. Si quedara cacheado, una persona podría seguir cargando el JS de una
 * versión vieja contra un backend que ya cambió de contrato. Con `index.html`
 * siempre por red, cada deploy trae nombres nuevos y el caché no puede
 * interferir. Es el riesgo 1 del inventario PWA, cerrado por construcción.
 *
 * Sin modo offline, sin precache, sin `importScripts`.
 */
'use strict';

/** La versión del paquete. La inyecta el build; en la plantilla es un marcador. */
const VERSION = '__PAYME_SW_VERSION__';

/**
 * KILL-SWITCH. Retirar el service worker de todos los dispositivos es un commit
 * que cambia esto a `true` y un deploy normal: la próxima vez que el navegador
 * revise este archivo, borra las cachés de PayMe, se desregistra y deja de
 * interceptar. Procedimiento completo en `docs/SERVICE_WORKER.md`.
 */
const RETIRAR = false;

const PREFIJO = 'payme-estaticos-';
const CACHE = PREFIJO + VERSION;

const ASSET_HASHEADO = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css|ttf|woff|woff2)$/;
const ICONO = /^\/pwa\/[a-z0-9-]+\.png$/;

/**
 * ¿Esta request puede servirse desde caché? Todo lo que no cumpla las cuatro
 * condiciones sale por red, sin que este archivo lo toque.
 */
function esCacheable(request) {
  if (request.method !== 'GET') return false;
  // Una navegación es siempre un documento: jamás desde caché, aunque la ruta
  // coincidiera con un patrón.
  if (request.mode === 'navigate') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  // Con query o fragmento ya no es el nombre inmutable que Vite emitió.
  if (url.search || url.hash) return false;
  return ASSET_HASHEADO.test(url.pathname) || ICONO.test(url.pathname);
}

/**
 * Una respuesta sólo entra al caché si es exactamente lo que se pidió: 200 del
 * mismo origen, y NUNCA un documento HTML. Lo último cubre el caso de un
 * servidor que responde a un asset inexistente con la página de la app: sin
 * este chequeo, `index.html` entraría al caché con el nombre de un JS.
 */
function esGuardable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  const tipo = (response.headers.get('content-type') || '').toLowerCase();
  return !tipo.includes('text/html');
}

async function desdeCacheOLaRed(evento) {
  const request = evento.request;
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (esGuardable(respuesta)) evento.waitUntil(cache.put(request, respuesta.clone()));
  return respuesta;
}

/** Las cachés de PayMe que no son la de esta versión. Las ajenas no se tocan. */
function cachesViejas(nombres, actual) {
  return nombres.filter((nombre) => nombre.startsWith(PREFIJO) && nombre !== actual);
}

self.addEventListener('install', () => {
  // La versión nueva no espera a que se cierren todas las pestañas: como sólo
  // cachea nombres inmutables, tomar el control enseguida no puede mezclar
  // versiones de un mismo archivo.
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    if (RETIRAR) {
      await Promise.all(nombres.filter((n) => n.startsWith(PREFIJO)).map((n) => caches.delete(n)));
      await self.registration.unregister();
      return;
    }
    await Promise.all(cachesViejas(nombres, CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  if (RETIRAR || !esCacheable(evento.request)) return;
  evento.respondWith(desdeCacheOLaRed(evento));
});
