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
3. **Ejecución** — cero `<script>`, `javascript:`, handlers `on*=`, `meta
   refresh`, `iframe`, `object`, `embed` y formularios.

🔴 **El agujero que la separación cierra:** los dos subdominios estaban siendo
usados como **permiso global de URL**, así que una hoja de estilos servida
desde `app.paymemx.com` pasaba. No debería: esos orígenes están autorizados
como **destinos de navegación** —adonde va la persona cuando toca— **no como
proveedores de recursos** que el navegador carga antes de que nadie toque nada.
Dos permisos con nombre parecido y consecuencias muy distintas.

## Cero JavaScript, y es la forma más fuerte de cumplir §2

La página son dos enlaces. **No tiene una sola línea de JS**, así que no existe
grafo de módulos donde el contexto de sesión, la capa de API o Stripe puedan
entrar. La prohibición no se vigila: se vuelve imposible sin cambiar la
naturaleza del artefacto — y ese cambio es lo que detecta el primer test.

**El mutante:** para importar el contexto de sesión hace falta un módulo, y
para cargarlo hace falta un `<script>`. Ese script lo mata *«el artefacto no
tiene una sola línea de JavaScript»*.

## ⚠️ En DESARROLLO la página tiene un script. En el artefacto, cero.

`vite dev` inyecta su cliente de HMR (`@vite/client`), así que si mirás el
inspector en `localhost:5176` vas a ver **un** `<script>` y dos recursos que no
están en el build. **No es de esta página y no viaja al artefacto**: el test
corre sobre `vite build`, donde `document.scripts.length` es cero.

🔴 Está escrito acá y no sólo en un reporte porque **las capturas sobreviven a
los reportes**: una captura de dev, sin esta nota, se lee como que la guarda de
"cero JavaScript" está fallando.

Verificación honesta de esa afirmación:

```bash
npm run build:landing
grep -c '<script' dist-landing/index.html   # → 0
```

## Cero terceros, incluidas las tipografías

`index.html` de la webapp trae Plus Jakarta Sans y DM Sans desde el CDN de
fuentes de Google. **Acá no.** Es una request a un tercero que ocurre **antes
de que la persona toque nada** — le manda su IP en la primera impresión de
PayMe, cuando todavía no tiene cuenta.

🔴 **La consecuencia se declara, no se disimula:** la landing usa la misma
cadena `--font-display` del sistema con su fallback, así que en un equipo sin
esas familias instaladas **se ve con la sans del sistema**. Es una diferencia
visual con la app.

**Resolverlo bien es auto-hospedar los archivos de fuente** — decisión de
licencia y de peso que no le corresponde a esta sesión. Queda **abierto y
escalado**, no resuelto por descarte.

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
