# landing — la raíz de `paymemx.com`

Artefacto **separado** de la webapp, en el mismo repo. Fuente única de diseño:
`../../diseno/SPEC_LANDING.md`. **`SPEC_WEB.md` es histórico y no gobierna esto.**

```
paymemx.com          ← esta página
  ├── Comensal    →  https://app.paymemx.com
  └── Restaurante →  https://panel.paymemx.com
```

**Cero publicación.** Desarrollo local únicamente: `npm run build:landing`
emite a `dist-landing/`, fuera del `dist/` de la webapp.

---

## 🔴 Por qué el porqué vive acá y no en el HTML

Los comentarios del HTML **viajan al navegador**. Este archivo no: Vite sólo
emite lo que `index.html` referencia, así que un `.md` suelto en la raíz del
entry no se copia a `dist-landing/`.

Y hay una razón más fuerte, que descubrí escribiendo el test: las guardas
barren el artefacto ENTERO **sin excepción para comentarios**. Mi primera
versión del HTML explicaba las prohibiciones *nombrándolas*, y los tests se
pusieron rojos con razón: la regla es que esas cadenas **no están en el
artefacto**, y "es sólo un comentario" es exactamente la excepción por la que
después vuelve la cosa real.

🔴 **Y quedó un resto que Codex encontró:** el comentario que sobrevivía
nombraba `SPEC_LANDING` y este README **en la misma página cuyo README explica
que los comentarios se publican**. Eliminado, y ahora hay guarda: **cero
comentarios HTML en el artefacto**. Una página pública no le cuenta su
arquitectura a quien mire el fuente.

## Las guardas prueban TRES propiedades distintas, no una

Estaban mezcladas y por eso probaban menos de lo que declaraban:

1. **Navegación** — exactamente dos `<a>`, con sus `href` exactos y absolutos.
2. **Recursos** — cero cross-origin: todo lo que el navegador carga solo tiene
   que ser relativo al propio origen. Incluye `@import` y `url(...)` del CSS.
3. **Ejecución** — un único `<script>` inline y acotado (ver abajo); cero
   `javascript:`, handlers `on*=`, `meta refresh`, `iframe`, `object`, `embed`
   y formularios.

🔴 **El agujero que la separación cierra:** los dos subdominios estaban siendo
usados como **permiso global de URL**, así que una hoja de estilos servida
desde `app.paymemx.com` pasaba. No debería: esos orígenes están autorizados
como **destinos de navegación** —adonde va la persona cuando toca— **no como
proveedores de recursos** que el navegador carga antes de que nadie toque nada.
Dos permisos con nombre parecido y consecuencias muy distintas.

## 🔴 El JavaScript: la invariante se MOVIÓ el 2026-08-09

⚠️ **CORRECCIÓN.** Hasta esta fecha esta sección decía *«cero JavaScript, y es
la forma más fuerte de cumplir §2»*, y traía una receta —`grep -c '<script'
dist-landing/index.html # → 0`— que **hoy devuelve 1**.

**Era cierto y dejó de serlo cuando se portó el boceto de Diseño**, que trae un
`<script>` inline. El documento se quedó afirmando la propiedad vieja: un
artefacto que ya no la cumple y un README que jura que sí. Lo encontró el
Auditor de Codex, no nosotros. **Un documento que afirma una propiedad que el
artefacto perdió es peor que no tener documento, porque desactiva al que lee.**

### Qué hace el script, y por qué se aceptó

Tres cosas, ninguna con red: el nav se achica al scrollear, una barra de
progreso de lectura, y el desplegable de «Iniciar sesión».

El motivo original de la invariante era concreto: *sin grafo de módulos no hay
dónde colar el contexto de sesión, la capa de API ni Stripe.* **Un script
inline sin una sola importación no crea grafo de módulos y no puede arrastrar
nada de eso. El PROPÓSITO se conserva; la LETRA no.**

### Lo que la guarda exige HOY

`landing.test.ts` no se borró: se movió a lo que ahora protege.

- **cero archivos `.js` emitidos** — no hay entry de módulo;
- **exactamente UN `<script>`**, para que un segundo no entre callado;
- **sin `src` y sin `type="module"`** — un script externo sería un tercero;
- **sin `import`, `require`, `fetch`, `XMLHttpRequest`, `eval`, storage ni
  cookies** — verificado sobre el contenido del script emitido;
- ⭐ **y el acceso vivo funciona SIN JavaScript.** Es la condición que importa:
  si el único camino al link fuera el desplegable, un script roto dejaría la
  landing sin salida. El CTA del hero es un `<a href>` puro, y se verifica con
  el navegador y JS deshabilitado antes de publicar.

### Verificación honesta

```bash
npm run build:landing
grep -c '<script' dist-landing/index.html      # → 1, inline y acotado
find dist-landing -name '*.js' | wc -l          # → 0, no hay entry de módulo
```

⚠️ **En desarrollo hay OTRO script:** `vite dev` inyecta su cliente de HMR. No
es de esta página y no viaja al artefacto. Está escrito acá porque **las
capturas sobreviven a los reportes**: una captura de dev, sin esta nota, se lee
como que la guarda falla.

## Cero terceros, incluidas las tipografías

Ni la landing ni la webapp le piden la tipografía a nadie. Una request a un CDN
de fuentes ocurre **antes de que la persona toque nada** y le manda su IP en la
primera impresión de PayMe, cuando todavía no tiene cuenta.

🔴 **ACTUALIZADO el 2026-08-09 · esta sección decía lo contrario y quedó vieja.**
Decía que la landing *"se ve con la sans del sistema"* y que auto-hospedar era
una decisión pendiente. **Ya está hecho** (`D-FUENTES-1`, v0.61.0): la landing
sirve **su propia copia** de Plus Jakarta Sans desde `./fonts/`, byte-idéntica a
la de la webapp y con un test que compara los dos SHA-256.

Su propia copia y no la de la webapp: `D-WEB-1-BIS` manda que sea otro ORIGEN, y
un artefacto que toma la tipografía del origen vecino no está separado.

**Y la licencia viaja con ella**, en `fonts/OFL-PlusJakartaSans.txt` dentro del
artefacto emitido — la cláusula 2 de la OFL lo exige, y que esté en el repo no
alcanza. Lo verifica `landing.test.ts` sobre el build, no sobre el fuente.

**Formato TTF y no WOFF2**, con el motivo completo en
`../src/assets/fonts/README.md`: el upstream autorizado no publica WOFF2 y la
ganancia real de convertir está sin medir.

## Los tokens se copian, y hay un gate que lo sostiene

`landing.css` no importa `src/styles/global.css`: son 113 KB de shell
autenticado —cabecera, pestañas, barra inferior— y §1 bis del spec dice que ese
shell **no es de la landing**.

Los valores están **copiados**, y `landing.test.ts` parsea los dos archivos y
exige que coincidan token por token. Mismo patrón que el `contract-mirror`:
replicar y poner una guarda encima, en vez de confiar en que alguien se acuerde.

## Los dos accesos van navy

Cuál puerta es la **principal** es una decisión de producto que **no está
tomada** (§5, séptima pregunta abierta). Pintar una de naranja sería tomarla:
*"el naranja es UNA acción"*, singular. Mientras la pregunta esté abierta,
ninguna puerta se empuja sobre la otra.

Si Mati decide que sí hay una principal, esa va `--brand` y **su texto va navy,
nunca blanco** — blanco sobre naranja da 2.84:1 y no pasa.

## Config propia, no una segunda entry

`vite.landing.config.ts` existe en vez de agregarle `rollupOptions.input` a
`vite.config.ts` por dos razones:

1. **El build de la webapp no se toca.** `deploy-demo.yml` lo invoca dos veces
   con `--base` y `--outDir` distintos; meterle una entry más cambia lo que
   produce ese pipeline sin que nadie lo haya pedido.
2. **Grafos disjuntos por construcción.** Dos invocaciones de Rollup que no se
   conocen no pueden compartir un chunk. Con una sola entrada habría que
   confiar en que el code-splitting no los junte.

🔴 Esto **no** significa que un workflow futuro no pueda coordinar los dos
despliegues. Puede. **La independencia es de artefacto y de origen, no de
tubería.**

## El seam

Los dos accesos son **URLs absolutas a subdominios**, no rutas relativas. Eso
es lo que permite retirar esta página de la raíz —el día que `payme-web` tome
`paymemx.com`— **sin mover `app.` ni `panel.`**. Con rutas relativas el seam
sería una intención escrita; así es un hecho verificable, y hay un test.
