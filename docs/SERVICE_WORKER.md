# Service worker de la app del comensal

Orden `APP-PWA-B2-SERVICE-WORKER-AF-15-20260918`. Decisión de Mati, 2026-09-18:
**«Sí, sólo para archivos estáticos (Recomendada)»**, y el nombre bajo el ícono,
**«PayMe (Recomendada)»**.

## Qué hace, en una línea

Guarda en el teléfono los archivos que no cambian nunca —el JS, el CSS y las
fuentes con hash en el nombre, y los íconos de instalación— para que la app cargue
más rápido. **Todo lo demás va siempre por la red**, como si el service worker no
existiera.

## Qué NO hace

- **No guarda `index.html`**, ni ninguna navegación. Es el único archivo que nombra
  a los demás: si quedara guardado, alguien podría seguir usando el JS de una
  versión vieja contra un backend que ya cambió. Con `index.html` siempre por red,
  cada deploy trae nombres nuevos y el caché no puede interferir.
- **No toca la API** de PayMe, ni Stripe, ni Google, ni nada de otro origen. Nunca
  intercepta un `POST`.
- **No da modo sin conexión.** Sin red, la app no funciona, igual que antes.
- No hace precache, no usa Workbox ni ninguna dependencia, no usa `importScripts`.

## Dónde vive

| Archivo | Qué es |
|---|---|
| `src/sw/serviceWorker.js` | El service worker. Es una **plantilla**: tiene un marcador de versión. |
| `src/sw/artefacto.ts` | Reemplaza el marcador por la versión del `package.json`. Única transformación. |
| `vite.config.ts` · `emitirServiceWorker` | Emite `/sw.js` en el build **real**. El mock no lo emite. |
| `src/sw/registrar.ts` | Decide si registrar: sólo build real de producción, después de `load`. |
| `src/main.tsx` · `arrancarPrivada` | El único lugar que lo registra. Las páginas públicas (`/privacy`, eliminación de datos) nunca. |
| `src/sw/serviceWorker.test.ts` | Prueba el **artefacto emitido** en un contexto aislado. |
| `scripts/pwaInstallability.test.ts` | Fija dónde puede vivir el mecanismo y dónde no. |

**No está en `public/` a propósito:** `public/` se copia tal cual, y la versión del
caché tendría que escribirse a mano en un segundo lugar.

## Cómo se actualiza

El nombre del caché lleva la versión del paquete (`payme-estaticos-0.166.0`). Cada
versión nueva:

1. El navegador revisa `/sw.js` **sin pasar por su caché HTTP**
   (`updateViaCache: 'none'` en el registro), así que la ve en la próxima visita.
2. `install` → `skipWaiting()`: no espera a que se cierren las pestañas. Es seguro
   porque sólo guarda nombres inmutables: no puede mezclar dos versiones de un
   mismo archivo.
3. `activate` → borra las cachés de PayMe de **otras** versiones y toma el control
   (`clients.claim()`). Las cachés que no son de PayMe no se tocan.

## 🔴 Cómo retirarlo de todos los dispositivos (kill-switch)

Si el service worker causara un problema y hubiera que sacarlo:

1. En `src/sw/serviceWorker.js`, cambiar
   `const RETIRAR = false;` → `const RETIRAR = true;`.
2. Actualizar el test que fija el kill-switch apagado en
   `src/sw/serviceWorker.test.ts` («la plantilla se publica con el kill-switch
   APAGADO»): retirar es un acto deliberado y ese test existe para que no pase por
   accidente.
3. Commit, gates y **deploy normal**, con la autorización de siempre.

En la próxima visita de cada persona, el navegador baja el `/sw.js` nuevo, que:
borra **todas** las cachés de PayMe —incluida la de la versión actual—, se
**desregistra**, y deja de interceptar cualquier request desde ese momento.

**Por qué es un commit y no una variable de entorno:** así el retiro queda en la
historia, pasa por la suite y por la misma autorización que cualquier otro cambio.
Una variable de entorno cambia el comportamiento de producción sin dejar rastro.

⚠️ **Lo que el kill-switch NO puede hacer:** llegar a un teléfono que no vuelve a
abrir la app. Ese teléfono conserva el service worker viejo hasta la próxima
visita. Como sólo sirve archivos inmutables y nunca `index.html`, un service
worker viejo no puede servir una versión vieja de la app.

## Lo que no se pudo acreditar sin un dispositivo físico

Esto se probó en Node con un contexto aislado y con los builds reales. **No se
probó en ningún navegador ni teléfono.** Quedan sin acreditar, y no se declaran
hechos por inferencia:

- Que Chrome/Android y Safari/iOS **registren** el service worker en
  `app.paymemx.com`.
- Que la segunda carga de la app **use** efectivamente la caché.
- Que una versión nueva **reemplace** a la vieja y borre su caché en un dispositivo
  real.
- Que el **kill-switch** desregistre el service worker en un dispositivo real.
- Las **cabeceras** con que Vercel sirve `/sw.js` (se registró con
  `updateViaCache: 'none'` para no depender de ellas, pero no se midieron).
- El comportamiento de la **PWA instalada** en iOS, que sigue siendo una caja negra
  sin iPhone, igual que Apple Pay y Google Pay.
