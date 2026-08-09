# CHANGELOG — payme-app-frontend

## 0.67.0 — la landing es la que Diseño validó con Mati (2026-08-09)

MINOR: la landing cambia entera.

**Se portó el ARCHIVO de Diseño**, no una descripción de él —
`diseno/referencias/landing-boceto-ESTRUCTURA-para-bibliotecario.html`.
Reconstruir desde una descripción es lo que produjo el desvío anterior, cuando
se publicó una provisional que nadie había elegido.

Nav con anclas y desplegable · hero · banda de foto · cuatro pasos · dos bloques
de audiencia con sus capturas.

### Lo que se cambió del boceto, y nada más

**Tipografías** → archivos locales TTF. El boceto pide WOFF2; `F-1` ratificó
TTF. **Cero descargas nuevas:** DM Sans ya vivía en la webapp, mismo binario,
con su OFL adentro del artefacto.

**Imágenes** → copias propias, procesadas por Vite en vez de servidas crudas:
las hashea y **falla el build si una ruta no resuelve**.

**Los cuatro enlaces a dominios que no existen** → Comensal al build vivo;
Restaurante **apagado** (`<span>` sin href, «Muy pronto») en el hero y en el
desplegable. Ese tratamiento no viene del boceto.

### 🔴 La invariante de JavaScript se movió, no se borró

Decía *«el artefacto no tiene una sola línea de JavaScript»*. El boceto trae un
`<script>` inline de ~25 líneas. **Un script inline sin una sola importación no
crea grafo de módulos**, así que no puede arrastrar `AuthProvider`, la capa de
API ni Stripe: **el propósito se conserva, la letra no.**

La guarda se reescribió a lo que ahora protege —cero `.js` emitidos, un solo
script inline, sin `src`/`module`/`import`/`fetch`— y sobre todo: **⭐ el acceso
vivo funciona sin JavaScript**, verificado con JS deshabilitado. Si el único
camino al link fuera el desplegable, un script roto dejaría la landing sin
salida.

### Una sonda que encontró un defecto en la propia guarda

El parser de atributos leía `bar.style.transform`, `isOpen` y `pct` **como si
fueran atributos HTML** — cualquier asignación de JS tiene la forma
`nombre = valor`. Ahora se parsea sobre el HTML sin el script.

🔴 Y la primera versión de esa sonda buscaba `isOpen` en el HTML **construido**,
donde Vite ya minificó y renombró: **medía algo que no puede pasar.** Se prueba
directo sobre el parser.

### ⚠️ El boceto es de escritorio

Su CSS lo dice: `body { min-width: 1040px }` y cero media queries — coincide con
las palabras de Mati, *«versión computadora»*. **Medido en un iPhone 13:** 1040
px de layout sobre 390 pt de pantalla, factor 0.38×, **el cuerpo de 18 px se ve
a 6.8 pt**. No se inventó una versión móvil: es trabajo de Diseño y queda
reportado.

## 0.66.0 — la captura del panel dice que sus datos son de ejemplo (2026-08-09)

MINOR: cambia lo que se lee en la landing publicada.

Decisión de Mati. La captura del panel muestra $2.560 de propinas, 8.21 % sobre
ventas y **dos personas con su rendimiento individual**. Sin marca, eso se lee
como el desempeño real de un restaurante real. **Es el seed.**

🔴 **Y la ironía, que no vio nadie:** la leyenda «Demo» se sacó de las capturas
en 0.65.1 porque Mati las quería limpias — y al sacarla, la del panel perdió lo
único que decía que no era real. **La instrucción era correcta; el efecto
lateral se nos pasó a todos.**

Se compone **en la página**, no sobre la imagen: 12 px, gris, debajo del panel.
La captura no se vuelve a ensuciar.

**La de la app no lleva pie, y es decisión declarada:** lleva su leyenda dentro
del producto y quien toque «Comensal» la ve en dos segundos. El panel no tiene
esa salida porque su link no existe. **El test lo dice, para que se sepa que fue
elegido y no olvidado.**

### La foto de banda, preparada — sin maquetar nada

Dan Gold · Unsplash · uso comercial libre. **2000×1500 (421 KB) → 1400×1050
(246 KB)**, con su atribución al lado, misma disciplina que la OFL.

🔴 **El número de la orden no servía:** se pidió «calidad ~75», pero la escala de
`sips` no es la de ImageMagick y su `75` pesa **más que el original**. Se eligió
`normal` midiendo las siete opciones y mirándolas.

**No va en `public/`**: todavía no la referencia nadie, y `public/` se emite
entero — serían 246 KB que nadie ve. Es el modo de falla que la propia guarda
persigue. Vive lista en `landing/img/`; cuando la maqueta de Diseño la
referencie, Vite la emite con hash.

⚠️ **La landing completa se rehace desde la spec de Diseño**, que llega como
HTML/CSS. Lo publicado hoy es la provisional.

## 0.65.1 — la captura de la landing sale limpia (2026-08-09)

PATCH: cambia una imagen del artefacto, nada del comportamiento.

Instrucción literal de Mati: *«Las imagenes que le compartas al chat de diseño de
app/dashboard, que no tengan la leyenda "Demo.." por favor, tienen que estar
clean.»* Lo dijo para las imágenes de Diseño, y **una imagen en la landing
pública está más expuesta, no menos**.

🔴 **Se saca de la FOTO, no de la app.** La leyenda «Demo · datos de ejemplo, no
se cobra dinero real» **sigue en el producto**: en un link público que va a
desconocidos, es lo que evita que alguien crea que le cobraron. Cero archivos de
`src/` tocados.

**Se oculta por TEXTO, no por clase** — una clase cambia con cualquier refactor y
el script queda apuntando a nada, en silencio, produciendo capturas con la
leyenda otra vez.

## 0.65.0 — la landing dice qué es PayMe y lo muestra (2026-08-09)

MINOR: cambia lo que ve quien entra al link.

⚠️ **Estructura PROVISIONAL**, decidida por el Bibliotecario-Auditor porque
Diseño no contestó y hacía falta un link hoy. **No es la landing definitiva:**
se reemplaza sin discusión cuando Diseño mande la suya.

```
PayMe
«Divide la cuenta del restaurante y paga tu parte desde tu teléfono.»
[captura de la app]  ·  [captura del panel]
Comensal (vivo)  ·  Restaurante «Muy pronto»
```

🔴 **Hasta hoy la landing no decía en ningún lado qué es PayMe.** Tenía la marca
y dos botones: quien llegara sin saber, se iba sin saber.

**Las imágenes viven DENTRO del artefacto** (`landing/public/img/`). La guarda
exige que todo recurso sea relativo y propio, y eso no se afloja para meter dos
capturas: los `.png` se clasifican como binario —verificado por hash, igual que
el TTF— y se exige que el HTML **los use**.

🔴 **La captura de la app se regeneró:** la anterior mostraba `payme_mx_mati`,
el defecto que acabábamos de arreglar. La nueva entra con un usuario neutro y
muestra `payme_mx_demo` — el arreglo visible y sin nombre propio en una imagen
pública.

**Y un defecto que encontró la guarda de licencias al sumarse las imágenes:**
derivaba las familias tipográficas de *todos* los binarios y empezó a exigir
`OFL-app-dividir-cuenta.png.txt`. **La derivación estaba bien; el conjunto del
que derivaba, no.**

Verificado a 375 px: las dos cargan, `alt` de verdad, **cero desborde
horizontal**. El artefacto pasa de 178 KB a **734 KB** — 550 KB son las capturas.

## 0.64.0 — la landing se publica, y sus botones llevan a algún lado (2026-08-09)

MINOR: aparece una superficie nueva publicada.

Mati autorizó el push para poder compartir links y recibir feedback. Esta
versión es lo que hacía falta para que esos links no defraudaran.

### 🔴 Los dos botones de la landing eran links muertos

```html
<a href="https://app.paymemx.com">Comensal</a>
<a href="https://panel.paymemx.com">Restaurante</a>
```

**Esos dominios no existen** —no hay DNS ni hosting—. Publicar así habría
entregado una página linda donde hacés clic y no pasa nada: **peor que no tener
landing**.

⚠️ **Y el archivo no estaba mal escrito: estaba escrito para el futuro
ratificado.** `D-WEB-1-BIS` manda esos tres orígenes y algún día van a ser
correctos. **El defecto no era el destino: era la fecha.**

- **Comensal** → el build mock de Pages, verificado 200.
- **Restaurante** → **deja de ser un enlace.** Sin `href`, con su leyenda «Muy
  pronto», hueco con borde en vez de navy sólido: la diferencia se nota **antes**
  del clic. Honesto, no roto. El repo del dashboard es privado y esa decisión es
  de Mati.

**La guarda que faltaba:** *ningún enlace apunta a un dominio que todavía no
existe*. La anterior verificaba que los destinos fueran los **autorizados** — y
lo eran, por gobierno. 🔴 **Estar ratificado y estar vivo son dos cosas
distintas, y un enlace sólo sirve si la segunda es cierta.**

### La landing entra al deploy · como PREVIEW

`deploy-demo.yml` publicaba dos builds y la landing no estaba en ninguno: hasta
hoy **no se publicaba en ningún lado**. Entra como tercero, con verificación
post-copia —HTML, assets relativos, tipografía y licencia— que falla el job
antes de subir un artefacto a medio construir.

⚠️ **Es una preview bajo un prefijo, no la arquitectura ratificada.** Cuando
exista el dominio, la landing se muda a su origen y esta entrada se retira.

### `base: './'` en vez de una bandera

Vite emitía `/assets/…` absoluto: bajo un prefijo eso apunta a la raíz del
dominio y **la página carga sin un solo estilo**. La salida obvia era pasar
`--base` en el workflow; depende de que alguien se acuerde. `base: './'` anda en
la raíz **y** bajo cualquier prefijo: **elimina el modo de falla en vez de
esquivarlo.**

### El `payme_id` mostraba el nombre de otro

`mockLogin` derivaba el nombre del email pero **heredaba el `payme_id` del
usuario sembrado**: entrabas como `juan@ejemplo.mx` y veías `payme_mx_mati` en
Más y en el encabezado de Avisos.

No es cosmético — **el `payme_id` es la identidad con la que te encuentran tus
amigos**, y en un link público cada desconocido veía el nombre del dueño de la
demo como si fuera el suyo. 🔴 **Y el comentario de `paymeIdFromName` ya
prometía la conducta correcta: un comentario correcto al lado de un código que
hace otra cosa es peor que no tener comentario.**

## 0.63.0 — el producto habla español mexicano (2026-08-09)

MINOR: cambia lo que ve el usuario en casi todas las pantallas.

Decisión de Mati por el canal de Diseño, literal: *«Cambiar el mockup para que
el lenguaje sea español mexicano por favor»*. La pregunta era sobre una captura,
pero **los strings viven en los componentes y son los mismos en mock y en real**:
no existe forma de cambiar el idioma del demo sin cambiar el del producto.

### 🔴 El alcance es una decisión, no un descuido: se traduce el PRODUCTO

Se convierte **el texto que ve el usuario**. **No se tocan los comentarios de
código ni los títulos de `describe()`/`it()`.** Tres motivos:

1. **El gobierno de este repo manda rioplatense para el trabajo** (`CLAUDE.md`:
   *"Idioma: español rioplatense"*). **El equipo habla rioplatense; el producto
   habla mexicano.** Es una división limpia, no una excepción.
2. Un comentario no le llega a nadie que use la app — misma doctrina que ya se
   aplica al egress: en `src/` los comentarios se ignoran porque se compilan.
3. Reescribir cientos de comentarios sería un diff enorme donde el cambio real
   se pierde, y **traducir prosa técnica a granel es donde el sentido se
   desvía** — que es justo lo que la orden prohíbe.

### 🔴 Por qué NO fue un `sed`, con los casos que lo prueban

```
mostrá      sed→ mostra    ✗   correcto→ muestra     (o → ue)
Transferí   sed→ Transferi ✗   correcto→ Transfiere  (e → ie)
Pedí        sed→ Pedi      ✗   correcto→ Pide        (e → i)
continuás   sed→ continuas ✗   correcto→ continúas   (lleva tilde en la ú)
consumís    sed→ consumis  ✗   correcto→ consumes    (−ir pasa a −es)
Registrate  sed→ Registrate✗   correcto→ Regístrate  (sólo cambia el acento)
```

Y los pronombres, que ninguna sustitución de palabra resuelve:

```
«¿Cuánto tomás vos?»       → «¿Cuánto tomas tú?»
«reservado para vos»       → «reservado para ti»
«Lo que pagaste vos»       → «Lo que pagaste tú»
```

### 🔴 Mi censo estaba corto, dos veces

```
primer barrido    65 ocurrencias   ← sin las formas capitalizadas
censo completo   139 ocurrencias   ← Probá ×17, Elegí ×12, Revisá ×11, Tenés ×8
barrido ancho    +90 más           ← Reintentá ×15, Garantizá ×9, Escaneá ×5…
```

**El instrumento más angosto que la conclusión, otra vez.** La lista de diez
formas de la orden, y mi lista de cuarenta, dejaban afuera treinta verbos que
nadie había nombrado. **Lo que los encontró no fue una lista mejor: fue un
PATRÓN** —la morfología del voseo— aplicado al árbol entero.

### La guarda deriva, no enumera

`src/api/registroMexicano.test.ts` detecta por patrón (imperativo en `á`/`é`/`í`
tónica, presente en `ás`/`és`/`ís`) con una **allowlist de español legítimo**
—`está`, `además`, `sección`—. Una lista de prohibidos no se puede auditar
porque no se sabe qué le falta; **una allowlist sí, y crece por evidencia**: la
primera corrida encontró que faltaba `qué` en ocho lugares.

Tres mutantes: una frase nueva en rioplatense → ROJO · un presente voseo que
ninguna lista nombraba → ROJO · **voseo en un COMENTARIO → VERDE**, que es la
decisión de alcance vuelta test.

### Los diez archivos de test se actualizaron

Cinco en `src/**/*.test.ts` y cinco en `e2e/`. **Un test verde con el texto
viejo habría sido peor que el rojo**, y los rojos sirvieron de censo: marcaron
exactamente qué strings se habían movido.

### Corrección al despacho

La orden decía **6 archivos de test/e2e**; son **diez**. Y su conteo de ~100
ocurrencias no se pudo reproducir: mi medición da 64 sin capitalizadas y 139 con
ellas. **Se declara la discrepancia en vez de adoptar el número ajeno.**

## 0.62.1 — la licencia viaja, y el egress se prohíbe por defecto (2026-08-09)

PATCH: no cambia lo que la app hace. Cierra ocho hallazgos de la reauditoría de
Codex, y **el más caro estaba en un test que yo había escrito el día anterior**.

### 🔴 1 · La licencia no viajaba con el artefacto

`dist/`, `dist-mock/` y `dist-landing/` contenían los `.ttf` y **ningún `OFL`**.
La cláusula 2 de la OFL pide el aviso *y esta licencia* en cada copia
distribuida. Los tests miraban `src/`, así que todos pasaban y el
incumplimiento seguía ahí.

**Mi defensa anterior era cierta y aun así insuficiente:** el aviso viaja en la
tabla `name` del binario (IDs 0/13/14) — verificado —, pero el `nameID 13` es un
**puntero de una línea**, no la licencia. Un argumento verdadero sirvió para no
hacer el trabajo, que es peor que un dato equivocado: **un argumento verdadero
no se vuelve a revisar.**

Las licencias se **mueven** —no se copian— a `public/fonts/` y
`landing/public/fonts/`: una por artefacto distribuible. Copiarlas habría dejado
cuatro copias de la misma licencia.

### 🔴 2 · El test que inspeccionaba el artefacto equivocado

`scripts/artefactos.test.ts` construye la webapp para mirar los bytes emitidos.
**vitest exporta `NODE_ENV=test`, y un `vite build` lanzado desde adentro lo
hereda:** construía el bundle de DESARROLLO de React y lo llamaba "el artefacto
distribuible".

```
NODE_ENV=production   js 362.737 B   github.com ×0
NODE_ENV=test         js 709.149 B   github.com ×2
```

**Casi el doble, con avisos y enlaces de debug adentro.** Un test que mide el
artefacto equivocado no falla: **aprueba**, y por eso es peor que no tenerlo.

### 3 · La lista negra de cuatro proveedores → allowlist

Prohibir `googleapis`, `gstatic`, `typekit` y `bunny` deja pasar **el quinto**, y
el quinto es el que importa: el que se cuela es siempre el que nadie anticipó.
Se invierte. Prohibir Google Fonts deja de ser una regla propia y pasa a ser una
consecuencia de no estar en la lista.

🔴 **Y hacen falta las DOS guardas, medido:** un CDN desconocido en una constante
todavía sin usar deja el artefacto limpio —el bundler la borra— y pone rojo el
barrido del fuente. Cubren poblaciones distintas.

### 4 · Las seis evasiones del parser: prohibidas, no parseadas

Codex enumeró seis formas de esquivar el parser de atributos de la landing.
**Escribir un parser HTML correcto es la respuesta equivocada:** código nuevo,
sin dependencia que lo respalde, custodiando una página de diecinueve líneas.

Se rechazan por no-necesarias. Una **allowlist de ocho atributos** mata cinco de
un tiro —incluido el que aparezca mañana con un nombre que nadie anticipó— más
tres prohibiciones puntuales: entities, `>` dentro de un valor citado, y escapes
CSS. Un mutante por clase, los seis en rojo.

### 5 · La clase INERTE

La licencia contiene `scripts.sil.org` en su aviso de copyright: texto que la
OFL **obliga** a incluir. El barrido de hosts lo marcaba, o sea pedía algo
imposible — y una guarda imposible se afloja el día que estorba. Ya había pasado
dos veces acá, con el TTF y con `url(...)`.

Cada archivo emitido se clasifica: **BINARIO** y **INERTE** se verifican por
hash, **PARSEADO** entra al barrido. No es una excepción: es el mismo rigor con
el instrumento que corresponde. Y es fail-closed — una extensión sin clasificar
pone el test en rojo.

### 6 · Reserved Font Names, sobre el texto entero

El test leía **la primera línea**. La OFL define el RFN como los nombres
declarados *"after the copyright statement(s)"*, en plural: puede haber varios
avisos en cualquier parte del archivo. Ahora recorre todos, y lleva **caso
positivo** — se fabrica una licencia con el RFN en un aviso posterior y se exige
detectarlo. Sin eso, un detector que devolviera `false` siempre pasaría el test
para siempre.

### 7 · Procedencia leída del binario

El SHA-256 acredita que el archivo no cambió; **no acredita que el README lo
describa bien**. Se parsea el TTF —`name`, `fvar`— y se comparan familia,
versión, ejes y tamaño contra el documento.

### 8 · El arnés fuera de la raíz, y el censo derivado

`.tsprobe.json` vivía en la raíz con nombre fijo: dos corridas simultáneas se
pisaban, y **`.gitignore` tapaba el residuo**, así que ni aparecía en
`git status`. Ahora `node_modules/.cache/payme-tsprobe-XXXX/` con `mkdtemp`.

El censo TS/TSX→proyecto vivía en un mensaje entre sesiones. Ahora se deriva con
`tsc --listFilesOnly` y se compara contra `git ls-files`: **154 archivos, cero
huérfanos**. `docs/CENSO_PROYECTOS_TS.md` explica el reparto.

### Cinco correcciones de documentación

🔴 **La peor la había escrito yo el día anterior:** que el `aria-label`
compensaba el contraste bajo. **No compensa nada.** Sirve a quien usa lector de
pantalla; no hace nada por quien MIRA y no distingue el glifo, que es la persona
afectada por 2.84:1. **Escribir un riesgo como si estuviera mitigado es peor que
el riesgo, porque cierra la discusión.**

Además: 2.84:1 se nombra **riesgo aceptado**, nunca "AA" ni "conforme" · los usos
de `--brand` como fondo son **cinco** y quedaron ratificados el 2026-08-09 · la
landing **ya tiene** fuente local · **CardField es un fallback temporal**, no un
cierre: esa superficie sigue abierta para el Carril 7.

### Decisiones de Mati incorporadas

`F-1` TTF ratificado como excepción expresa · `L-1` la landing vigente es la
mínima, y `D-LAND-1` queda **ratificado y NO implementado**: los dos accesos
siguen navy.

## 0.62.0 — el texto sobre el naranja pasa a blanco (2026-08-08)

**Enmienda del sistema de diseño ratificada por Mati**, relayada por el chat de
Diseño y ya bajada a `diseno/SISTEMA_DISENO.md` §1. Su respuesta, literal:
*"Quiero los propuestos en la app por favor."* MINOR: cambia lo que se ve.

`--brand-fg`: `#0f1f3d` → `#ffffff`.

### 🔴 Reprueba AA, y es a propósito

Blanco sobre `#FF6B35` da **2.84:1** — por debajo del mínimo AA de 4.5:1 y
también del 3:1 que pide un ícono de control. **Es el mismo número que el
sistema de diseño citaba como el problema a resolver.** Mati vio los cuatro usos
del naranja lado a lado, con el contraste medido al lado de cada uno, y eligió
éste igual. Si aparece en una auditoría de contraste **es la regla vigente, no
un hallazgo**.

### La orden decía tres lugares. Son cinco.

La enmienda cambia el **token** —"glifo e íconos sobre `--brand`"—, no tres
componentes, así que aterriza en todo lo que ponga texto sobre un fondo
`--brand`:

| | Ratificado |
|---|---|
| `.appbar-fab` · glifo del botón circular central | ✅ |
| `.hdr-badge` · número del badge de avisos | ✅ |
| `.link-btn-brand` · CTA de primer contacto | ✅ |
| `.btab-badge` · badge de conteo dentro de una pestaña | ❌ arrastrado |
| `.link-round` · círculo de salida de 56px | ❌ arrastrado |

> 🔴 **Resuelto en 0.62.1:** los dos "arrastrados" se elevaron a Mati y **quedaron
> RATIFICADOS el 2026-08-09**. Los usos permitidos de `--brand` como fondo pasan
> a ser **cinco**, no tres. Esta tabla describe lo que se sabía al publicar
> 0.62.0 y se conserva por eso.

🔴 **Los dos últimos no están en la tabla de usos permitidos de `--brand`**, que
lista TRES fondos naranjas. Cambian de color por arrastre correcto del token,
pero **lo que nadie ratificó nunca es que tengan fondo naranja**. Es deriva
**preexistente** —no la introduce esta versión— y queda anotada en el CSS de
cada uno.

**No se toca el ítem activo de la barra:** usa `--brand-ink` `#C2410C`, sigue en
5.18:1. Ahí el naranja **es** el color del texto; no hay fondo naranja debajo al
que ponerle blanco encima.

### La guarda no se afloja: se convierte en registro

Había un test llamado *"blanco sobre `--brand` reprueba: por eso el glifo va en
navy"*. **Borrarlo habría sido lo cómodo y lo peor:** una guarda desactivada sin
explicación es indistinguible de un descuido, y la próxima persona no puede
saber cuál fue.

En su lugar hay un **`EXCEPCIONES_AA`** con el par, el ratio, el mínimo que no
alcanza, la fecha, quién decidió, la frase textual y el documento fuente. Y tres
tests encima: el ratio sigue **medido y fijado** en 2.84 —la excepción es al
mínimo, no a la medición—; 🔴 **corta para los dos lados** (si una excepción
empieza a PASAR AA, deja de ser excepción y sale del registro); y **la excepción
no se derramó**: los otros seis pares siguen exigiendo 4.5.

Cinco mutantes en rojo, sonda inocente en verde.

### Predicción fallada, y por qué

Declaré **62 archivos / 834 tests** y son **63 / 838**. **La aritmética estaba
bien; la base estaba vieja:** anclé en el 832/62 que había reportado antes, sin
arrastrar la guarda de puertos que yo mismo agregué después (+1 archivo, +4
tests). 832 + 4 = 836, + 2 de `designTokens` = 838. **Una predicción se re-deriva
del estado actual, no se copia del último número propio.**

## 0.61.0 — las tipografías son propias (2026-08-08)

🔴 **`D-FUENTES-1` cierra sus tres superficies, y una cierra DEGRADADA.** PayMe
ya no le pide una tipografía a nadie: cero requests a `fonts.googleapis.com` y
`fonts.gstatic.com` en la carga completa de la app, verificado en el navegador.
MINOR: cambia lo que la app carga en runtime.

**Mati autorizó la descarga en el chat.** El gate `D-GATE-1` ya existía desde el
día anterior y no alcanzaba: un gobierno que aprueba el alcance no es la persona
autorizando la ejecución, y para una descarga eso le toca a ella.

### 🔴 El upstream autorizado NO tiene WOFF2. Se sirve TTF, y se declara.

`D-GATE-1` acota la descarga a `github.com/google/fonts`, "WOFF2 + OFL, ningún
otro origen, ninguna otra descarga". **Ese repo publica TTF variable**; los
`.woff2` que sirve Google se generan en el borde y no están versionados ahí. La
combinación que pide el gate no existe.

Convertir exige un conversor —`fontTools`+`brotli` o `woff2_compress`—, no hay
ninguno en la máquina, y bajarlo es *otra descarga de otro origen*: exactamente
lo que el gate prohíbe. **No se bajó.**

Lo que **sí** está medido:

```
                    crudo      gzip     brotli
PlusJakartaSans   176.288    79.781     65.729
DMSans            240.164   110.278     92.043
TOTAL             416.452   190.059    157.772
```

🔴 **Y el número que decidiría NO está medido: nadie tiene el peso de un WOFF2
del encoder de referencia.** Un WOFF2 es brotli **más** una transformación de las
tablas `glyf`/`loca`, y esa parte es la única que no se deduce del brotli.
Circularon dos cifras y **ninguna es ésa**: el `≈145.000` que decía la primera
versión de este documento era una **estimación**, y los `157.333` que midió
`payme-dashboard-frontend` son un WOFF2 **fabricado con null transform** —TTF +
brotli en otro envase—, que mide el contenedor y no la ganancia.

**Por eso se difiere, y por este motivo y no por el tamaño: optimizar hacia un
formato cuya ganancia real está sin medir, contra un host que todavía no existe,
es adivinar dos veces.** WOFF2 entra en Carril 7 junto con la compresión, para
medir la cadena entera de una vez.

**Requisito de hosting que viaja con los archivos:** el host **debe comprimir
`.ttf` en tránsito** (`br` preferido, `gzip` aceptable), verificable con la
cabecera `content-encoding`. Está en `ops/INVENTARIO_CARRIL_7_PENDIENTE` y
también en `src/assets/fonts/README.md`, a propósito: el que lo va a necesitar
toca este repo, no lee `ops/`.

### Un archivo por familia, no nueve

Son fuentes **variables**: `font-weight` declara un RANGO —`200 800` y
`100 1000`, los ejes reales medidos en la tabla `fvar`— y un solo binario cubre
todos los pesos. Desaparece la lista manual de nueve estáticas que alguien
tendría que mantener sincronizada con los ~150 lugares donde el CSS pide un peso;
cuando esa lista se desincroniza, el navegador sintetiza en silencio.

**Y contesta por construcción la pregunta del `900`:** el eje de Plus Jakarta Sans
termina en 800, así que era inalcanzable aun pidiéndolo.

### Las tres superficies

**1 · Webapp — CERRADA.** Se retiran las tres etiquetas de `index.html` (dos
`preconnect` y la hoja de estilos) y `global.css` declara su propio `@font-face`.

**2 · Landing — CERRADA, y con su propia copia.** `D-WEB-1-BIS` manda que sea otro
ORIGEN: una landing que trae la tipografía del origen de la webapp no está
separada. El binario se duplica a propósito y un test compara los dos SHA-256.
**El artefacto pasa de 2.344 B a 178.803 B** — 76×, para un título y dos botones.
Se dice en vez de esconderse; con brotli la tipografía baja a 65.729 B, y
`font-display: swap` hace que nadie espere.

**3 · Stripe Elements — el egress ya estaba cerrado en 0.60.0; la restauración
SIGUE BLOQUEADA.** El contrato lo soporta (`CustomFontSource`), pero exige URL
absoluta a un host propio **y CORS** para `js.stripe.com`: configuración no
ratificada. El texto DENTRO del campo de tarjeta se sigue viendo con el sans del
sistema. Requisito con nombre en Carril 7.

### Licencia

Texto **completo** de las dos OFL, con su aviso de copyright, y el aviso viaja
además dentro de cada binario (tabla `name`, IDs 0/13/14), así que sobrevive al
hash de Vite y a cualquier copia futura.

🔴 **Ninguna de las dos familias declara Reserved Font Name** — verificado contra
la definición de la propia licencia. Importa porque OFL 1.1 define *Modified
Version* incluyendo textualmente **"by changing formats"**: convertir a WOFF2, o
subsetear, **es derivar**. Un TTF byte-idéntico al upstream no lo es, que es la
posición más simple de sostener. Un test se pone rojo si un upstream futuro
agrega un RFN.

### Verificado en el navegador, no por lectura

Un `@font-face` mal escrito **falla en silencio**: cae al fallback y la pantalla
se ve casi igual. Así que se midió el ancho de un texto a 40 px:

```
PJS   200→395.92   400→400.37   600→407.24   800→414.13
DMS   100→319.16   400→356.28   700→385.03  1000→405.32
fallback del sistema: 402.45
```

Los anchos crecen de forma monótona: el eje variable funciona. Si el navegador
hubiera cargado una instancia estática, los cuatro medirían igual.

🔴 **Y la sonda inocente corrigió evidencia que se había citado:**
`document.fonts.check()` devuelve `true` para una familia **inexistente**. No
acredita nada — es un gate que informa sin verificar. Lo que acredita es la
medición. De paso descarta la otra lectura posible: `'DM Sans'` sin `@font-face`
mide igual que el fallback, o sea que no está instalada en la máquina, o sea que
lo medido era la fuente descargada.

### Las guardas

`index.html` **entra al barrido de egress**, cumpliendo el compromiso que 0.60.0
dejó escrito. Ahí los comentarios **cuentan** (el HTML se publica) y en `src/` se
ignoran (se compila): mismo fundamento, dos casos — y porque la forma más
probable de que esto vuelva es un `<link>` comentado "por si acaso".

La tabla de SHA-256 del README **deja de ser documentación**: un test la parsea y
la compara contra el disco. Era el dato que ningún gate miraba.

La guarda de la landing **deja de leer binarios como texto**, y verifica los
binarios por hash contra una lista explícita.

**Seis mutantes en rojo y la sonda inocente en verde.** Y cada guarda nueva
afirma también que **lo legítimo PASA** — seis mutantes en rojo son compatibles
con una guarda que rechaza todo, que es lo que casi pasa en 0.60.0.

### Además · un defecto de puertos encontrado corriendo el gate

`.claude/launch.json` le daba a la preview de la landing **el mismo puerto** que
`playwright.config.ts` usa para su `webServer`. Con `reuseExistingServer`,
playwright no levanta el mock: se conecta a lo que haya, y los veinte specs de
la app terminan apuntando a una página con un título y dos botones.

🔴 **Lo caro no es el error, es el diagnóstico:** no hay ningún mensaje que diga
"puerto equivocado", hay veinte tests que fallan por timeout — exactamente lo
que parece una suite lenta o una máquina cargada. La landing se mueve a 5177 y
`scripts/puertosDev.test.ts` lo gatea, porque esto no se ve leyendo ninguno de
los dos archivos: hay que tener los dos abiertos a la vez.

## 0.60.0 — el egress de tipografías que no se veía leyendo el HTML (2026-08-08)

🔴 **`D-FUENTES-1` NO queda cerrada, y se dice acá y no sólo en un reporte.**
De las tres superficies, **una se cierra, dos siguen abiertas**, y el motivo de
cada una está abajo. MINOR y no patch: cambia lo que la app carga en runtime.

**El barrido corrigió el alcance de la orden.** Se hablaba de tres puntos de
egress; son **cuatro líneas en dos hosts distintos**: los dos `preconnect`
—`fonts.googleapis.com` sirve el CSS, `fonts.gstatic.com` sirve los `.woff2`—
son egress por sí mismos, abren TLS antes de que exista una request. Quien
saque sólo el `<link rel=stylesheet>` deja dos conexiones vivas.

**Superficie 3 · Stripe Elements — el egress se CIERRA, con su costo declarado.**
`CardField.tsx` le pasaba a Elements un `cssSrc` de Google, y era el que **no se
ve leyendo el `index.html`**: vivía en TypeScript, dentro de la config de un
SDK, y disparaba **al montar el campo**, sin que la persona tocara nada.
Retirado. **Consecuencia acotada y medida: el texto que se tipea en el campo
—número, vencimiento, CVC y placeholder— pasa a verse con el sans del sistema.
El resto de la pantalla no cambia**, porque esa tipografía la sirve nuestra
página.

**No se reemplaza todavía y el bloqueo es de infraestructura, no de API.** El
contrato de Stripe sí lo soporta (`CustomFontSource = {family, src, weight}`,
verificado en los tipos instalados 9.10.0), pero exige una **URL absoluta a un
host propio** —el iframe corre en `js.stripe.com` y `app.paymemx.com` no tiene
DNS ni TLS— **y CORS** en ese host para `js.stripe.com`, que es configuración
**no ratificada**. Queda como requisito con nombre en el Carril 7. La tercera
vía —embeber la fuente como `data:` URI— se **midió y se descartó**: ~30–55 KB
en base64 por peso para un campo de formulario, decisión de arquitectura que
nadie ratificó, y sin verificar que la CSP de Stripe la acepte.

**Superficies 1 y 2 — webapp y landing — siguen ABIERTAS**: necesitan los
`.woff2` propios, y bajarlos requiere una autorización que al cerrar esta
versión no estaba dada. Sacar los `<link>` sin tener las fuentes degradaría la
tipografía de toda la app, que es peor que el egress.

**Los pesos, medidos en el navegador y no en el CSS.** No se puede resolver
estáticamente —75 reglas usan `--font-body`, otras tantas `--font-display`, y
el resto hereda—, así que se recorrieron **12 pantallas** enumerando el
`(familia, peso)` computado: **Plus Jakarta Sans 400/500/600/700/800** y
**DM Sans 400/500/600/700**. Nueve archivos. Coinciden en número con los nueve
que se piden hoy **y no son los mismos nueve**: entra `PJS 500` —que hoy el
navegador **sintetiza**, porque se usa y no se pide— y sale `DM Sans 300`, que
se pide y no se usa en ninguna pantalla. El `font-weight: 900` del CSS **no es
de ninguna de las dos familias**: es el chip de marca de tarjeta, que declara
Arial a propósito para imitar el logotipo.

**La guarda de la landing distingue en vez de prohibir.** Rechazaba `url(...)`
entero, lo cual habría bloqueado las tipografías propias el día que lleguen.
Ahora **lo que se prohíbe es el ORIGEN, no la forma**: sólo relativo al propio
artefacto. Siguen rojos el esquema externo, el `//host`, **los subdominios de
PayMe como origen de recurso** —son destinos de navegación, no proveedores—,
el `@import` y el `data:`. Cinco mutantes **y el caso legítimo**, que es el que
verifica que la guarda **distingue** y no que niega todo.

Y una guarda nueva en `releaseGates`: ningún host de tipografías de terceros en
`src/`. Su alcance se declara — barre `src/`, no el HTML, que todavía los tiene
a propósito.

## 0.59.1 — las guardas parseaban un solo formato, y 24 archivos no los miraba nadie (2026-08-08)

Bugfix del cierre de 1B, tras una reauditoría de Codex. PATCH y no minor: no
agrega funcionalidad — arregla verificaciones que probaban menos de lo que
declaraban, que es la misma clase que 0.50.1.

🔴 **Las guardas de la landing reconocían `attr="valor"` y nada más.** HTML
acepta tres formas, y las otras dos pasaban por abajo de todo. Los dos casos
**sin comillas** son los peores porque son HTML perfectamente válido y el
navegador los ejecuta igual: `<link rel=stylesheet href=https://…>` y
`<body onload=alert(1)>`. Un parser que cubre un formato no es una guarda
parcial: es una guarda que se esquiva sin esfuerzo y sin mala fe.

🔴 **Y 24 archivos `.ts` no estaban en ningún proyecto de TypeScript:** los 21
de `e2e/`, `playwright.config.ts`, `vite.config.ts` y `vite.landing.config.ts`
—este último creado en el propio Carril 1A, así que el hueco no era sólo
heredado—. Hizo falta un cuarto proyecto y no meterlos en el de Node: los specs
usan `window` dentro de `page.evaluate(...)`, que corre en la página. Un spec de
Playwright necesita DOM **y** Node a la vez.

**Cerrar ese hueco destapó un defecto real:** `vite.config.ts` importaba
`defineConfig` de `vite`, que no conoce el bloque `test`, así que **la
configuración de la suite estaba sin tipar** — un `include` mal escrito pasaba
en silencio. Corregido a `vitest/config`.

🔴 **Y un comentario propio afirmaba un test que no existía.** Decía que
`types: ["vite/client"]` bastaba —lo que la orden anterior ya había refutado— y
que «hay un test que lo fija». La verificación había sido manual y de una sola
vez. Ahora existe: `scripts/tsProjectIsolation.test.ts` **compila el programa de
producción real con una sonda `process`/`Buffer` y exige que `tsc` la rechace**.
No lee la configuración: leer la configuración es exactamente lo que falló antes.

⭐ **La sonda inversa se ganó el sueldo en el primer intento**: el arnés
original ponía el tsconfig en `/tmp`, donde no hay `node_modules`, y `tsc` moría
por no encontrar `vite/client` — la sonda «fallaba» por el arnés y el test
habría pasado en verde por la razón equivocada.

**Correcciones documentales.** El artefacto **no pesa 8 KB**: eso era ocupación
por bloques de disco (dos archivos × 4 KB). El tamaño lógico es **2344 bytes**
—678 el HTML, 1666 el CSS, 1022 comprimido—, medible con
`find dist-landing -type f -exec cat {} + | wc -c`. Y las fechas de la
ratificación de `@types/node` y del release 0.59.0 son **2026-08-08**.

## 0.59.0 — la landing de `paymemx.com`, y las guardas que probaban menos de lo que decían (2026-08-08)

🔴 **Esta entrada cubre DOS órdenes: el CARRIL 1A —la landing, que quedó SIN
VERSIONAR por una omisión mía— y su cierre 1B.** Se dice explícito para que
dentro de un mes nadie busque «la entrada de 1A» y no la encuentre: no existe
por separado, es ésta.

1B nació de una auditoría independiente de Codex: *GREEN funcional, AMBER de
cierre*. Lo que se había declarado cerrado estaba sobredeclarado.

**La landing** vive en `landing/`, es un **artefacto separado** con su propia
config de build (`npm run build:landing` → `dist-landing/`), pesa **2344 bytes
lógicos** —678 el HTML y 1666 el CSS, 1022 comprimido— y **no tiene una sola
línea de JavaScript**. El texto es el literal autorizado —`PayMe`
y dos accesos— porque el copy es decisión de Mati y todavía no existe. **No
carga terceros, ni siquiera las tipografías:** el CDN de fuentes recibiría la IP
de quien entra antes de que toque nada. La contrapartida se declara — sin esas
familias instaladas se ve con la sans del sistema — y auto-hospedarlas es orden
aparte.

🔴 **Las guardas probaban menos de lo que declaraban, y eran el trabajo del que
más orgullosos estábamos.** Cuatro agujeros, todos de la misma confusión: los
dos subdominios se usaban como **permiso global de URL**, cuando están
autorizados como **destinos de navegación** y no como **orígenes de recursos**
— una hoja de estilos servida desde `app.paymemx.com` pasaba. Más: el barrido
de hosts no veía `//host`; los handlers inline sólo buscaban `onclick`; y "cero
JavaScript" no rechazaba `javascript:`.

Ahora son **tres propiedades separadas** —navegación, recursos, ejecución—, se
barre también `@import` y `url(...)` del CSS emitido, y hay **guarda de cero
comentarios HTML**: el comentario que sobrevivía nombraba el spec y el README
en la misma página cuyo README explica que los comentarios se publican.

🔴 **Y el aislamiento de tipos no se cumplía, medido con una sonda.**
`@types/node` entró como devDependency (ratificado por Mati) y la primera
lectura fue *"`types: ["vite/client"]` ya protege a `src/`"* — cierto, y
contestaba otra pregunta: una sonda `process.env` en `src/` **compilaba
limpio**, porque los tests importan `vitest` y sus tipos arrastran `@types/node`
por dependencia transitiva. `types` gobierna los globals automáticos, no lo que
entra por un `import`. Se separó en **tres proyectos** —código de navegador,
tests de navegador, tests de Node— y ahora la sonda falla, que es la prueba de
que el aislamiento existe.

También: el test de la landing **limpia su temporal** aunque falle, y `npm run
typecheck` cubre los tres proyectos.

⚠️ **1A no está cerrado.** Falta el OK visual de Mati, y llega después de que
él y diseño cierren el copy. Lo que vio es el mínimo literal: tenía que verse
sin terminar.

## 0.58.0 — la garantía no se le atribuye a una tarjeta que nadie eligió (2026-08-07)

Cierra la **ORDEN 1-B**, que nació de un caso que yo había descartado **por
argumento estructural**. El argumento era verdadero y contestaba otra pregunta:
*"`is_default` no viaja en el request"* es cierto **sobre la identidad
económica**, y el caso era **sobre qué tarjeta se le muestra a la persona**.

🔴 **Y el defecto no era sólo visual.** `loadCards()` autoselecciona la tarjeta
DEFAULT; tras recargar sobre una apertura congelada hecha con una guardada
NO-default, la pantalla la atribuía a la default, con los botones
deshabilitados. En `requires_action` eso es una mentira visual —el backend
recupera la fuente durable— **pero en `not_found` el reenvío CREA por primera
vez y esa tarjeta ES la que respalda la garantía**: la persona quedaba
garantizando con una tarjeta que no eligió, en el cobro.

**El contrato no permite restaurarla:** el backend guarda
`auth_source_payment_method_id` y **no lo publica en ninguna respuesta** — y su
propio comentario dice que esa fila *"nunca debe filtrarse por un spread"*. Así
que no se inventó el campo: `cardChoice` gana un tercer valor —**no elegida**,
porque los dos que había eran los dos una afirmación—, la pantalla **dice que
no sabe**, y el reenvío exige elección explícita. **G-38** pide el dato con la
forma mínima que alcanza: marca y últimos cuatro.

El radio de **saldo** no se aflojó: `guarantee_method` sí está en
`PAYLOAD_KEYS`, así que cambiar de riel es otra intención económica.

🔴 **Un defecto de UI que apareció al correr, no al leer.** Playwright reportó
`<button disabled class="cta-float"> intercepts pointer events` sobre la opción
"Usar otra tarjeta": el `.scroll` de Garantía llevaba un `padding` shorthand
inline que **pisa** el `padding-bottom` que despeja la píldora flotante. **En un
teléfono esa opción no se puede tocar** — y con el estado nuevo, que exige
elegir, la persona quedaba trabada. El aviso ya estaba escrito en el CSS; esta
pantalla quedó afuera del barrido que arregló Ticket y División. Se arregla en
la UI, no en el test.

**Y dos correcciones propias declaradas:** el e2e de 2-A **no recorría la
tarjeta tipeada** aunque lo declaré así —`loadCards()` autoselecciona antes de
llegar— y el test saved-only mezclaba dos fuentes en un payload que el schema
del backend rechaza. Los dos reemplazados por el flujo real, y el mutante
re-medido contra el spec corregido.

## 0.57.0 — la identidad económica se alinea con el dueño (2026-08-07)

Cierra la **ORDEN 2-A** sobre backend **v2.48.0** (`2966aab`): espejo a 72
archivos y consumo de la matriz exhaustiva, los vectores canónicos y el
contrato reconciliado.

🔴 **Nuestro journal era más estricto que el contrato, y eso trababa gente.**
Sellaba el intento con `sha256(JSON.stringify(request))` —el request ENTERO—
mientras el dueño hashea un subconjunto declarado que **deja la fuente de pago
afuera A PROPÓSITO**: *"incluirla haría que un reload con tarjeta tipeada
rotara la clave y abriera una SEGUNDA mesa con un SEGUNDO hold — el bug
B-06"*. Consecuencia medida: el organizador que perdía la pestaña durante el
3DS con tarjeta tipeada **no podía reenviar**, porque Stripe.js materializa
otro `pm_` por invocación. Fallaba cerrado —cortaba, no duplicaba— pero
trababa por una diferencia que no es económica.

Ahora `create_mesa` sella con el `payloadHash` del contrato, y el sello viaja
como `payload_hash` en la consulta de reconciliación. **La réplica se acredita
ejecutando el JS espejado del dueño**, no citándolo, y la partición se acredita
contra sus 14 vectores. Los journals de la versión anterior no se rompen: la
entrada lleva `fpv` y se compara con el algoritmo con el que se selló,
migrando a v2 recién cuando un match acredita que el request es idéntico.

**El riel de PAGO queda afuera a propósito** (G-37): el mismo defecto existe,
pero el dueño mantiene dos tablas —`mesa_pay` y `mesa_pay_legacy`— y desde el
front no se puede saber cuál aplica. Elegir mal daría un hash incorrecto, y un
hash incorrecto **traba a la persona**: el mismo síntoma que se viene a
eliminar, sobre el riel que mueve plata en cada pago.

**El decoder rechaza cuerpos que se contradicen a sí mismos**: `found` contra
`outcome`, `retry` fuera de los dos casos declarados, un `status` que no mapea
al `outcome` afirmado, y un 200 que diga que el hash no coincide. Donde la
réplica no conoce el estado manda el emisor: es la autoridad sobre su propia
máquina. Y **`unknown` nunca libera el journal** — si el emisor no clasifica
un estado, nosotros tampoco sabemos en qué quedó la creación.

🔴 **`dispersed` FALTABA en `MesaStatus`, y faltaba desde siempre.** La FSM del
dueño tiene doce estados y este front declaraba once. No lo notó nadie porque
**ninguna verificación comparaba las dos listas**. No era inofensivo:
`mesaStatusLabel` es un `Record` exhaustivo, así que `dispersed` caía en el
fallback y **una mesa terminada se leía "En curso"**. Ahora hay gate
(`mesaStatus.mirror.test.ts`), en las dos direcciones.

🔴 **El mock era MÁS DURO que el real, y eso también es mentir.** El 3DS del
mock se gateaba con una variable de módulo (`pending3ds`) que muere con
cualquier recarga: volvía **imposible de completar** el escenario de la
respuesta perdida, que en producción funciona. El gate pasa a ser el estado de
la mesa, que sobrevive al reload. Sin ese arreglo, el e2e del reenvío real no
existía.

Y el `package-lock` volvió a estar sincronizado: la desincronización era mía,
de `c430d88`.

## 0.56.0 — la apertura ambigua se pregunta por su clave (2026-08-06)

Cierra la **ORDEN 2A**: espejo a `03fb3b9` y consumo del contrato que el dueño
publicó para el P0 de la reconciliación.

🔴 **Antes se infería; ahora se pregunta.** La reconciliación de una apertura
congelada acreditaba comparando **nombres de restaurante** contra
`GET /mesas/open`, y la orden 1A.1 encontró la mitad simétrica: **la ausencia
en ese listado tampoco probaba nada**, porque filtra `open | partially_paid` y
una mesa en `pending_auth` —justo el caso que se reconcilia— no se lista. El
botón "Entiendo, desbloquear" se había retirado declarando su costo. Con
`GET /mesas/creations/:idempotency_key` (v2.47.0) la autoridad pasa a ser
`(opener_user_id, idempotency_key)`, la misma unicidad que gobierna la
creación.

**Consultar es de solo lectura.** El dueño no reusó `mesaReplayResponse`
porque ésa reconduce holds contra Stripe: *"consultar no puede mover un
centavo"*. Diagnóstico y acción, separados.

**El journal se libera SÓLO ante prueba positiva exacta.** `open`,
`partially_paid` y `replayable` liberan y navegan a ESA mesa; `terminal` libera
sin navegar porque la creación murió; `requires_action`, `not_found`,
`payload_hash_conflict`, la red caída y cualquier cuerpo ilegible **conservan
el freeze**. Y `not_found` no libera aunque el contrato habilite reintentar: el
404 dice que ESA CLAVE no creó nada, no dice nada de una generación anterior.
Lo que se habilita es reenviar **con la misma clave**, que por B-06 no puede
duplicar.

🔴 **Un callejón sin salida con cartel, encontrado recorriendo el flujo.**
Tras una recarga la app vuelve al paso 1 —los ítems viven en memoria— y ahí
sólo aparecía el aviso de que la apertura estaba bloqueada: **el botón que la
reconcilia estaba tres pasos más adelante**. Ahora el panel y su salida viajan
juntos por los cuatro pasos, y el `alert` duplicado se retiró (seguía diciendo
"no vamos a reenviarla" después de que el contrato autorizara el reenvío).

**Dos precisiones leídas en el código y no en el anuncio:**
`retry_with_same_idempotency_key` es `true` sólo en `requires_action` *entre
las respuestas `found: true`* — el 404 también lo manda en `true` —, y
`total_cents` viaja como **string** (bigint del driver), que el mock espeja
tal cual para no tapar la forma real.

**`payload_hash` no se manda, y se declara por qué:** exigiría reimplementar el
`payloadHash` del dueño, y un hash mal replicado da 409 → freeze conservado, o
sea el mismo costo que este endpoint viene a sacar. La protección ya existe
localmente: el journal se niega a reusar una clave con otro payload.

**Límite declarado:** con tarjeta tipeada y tras un reload, el `pm_` cambia y
el fingerprint LOCAL —que cubre el request entero, a diferencia del hash del
backend— corta el reenvío con `monetary_payload_ambiguous`. Es fail-closed, y
alinear el journal con `PAYLOAD_KEYS` merece su propia orden.

Los mutantes de 1A.1 se mudaron a un test de fuente: sin listado que pedir no
queda parámetro que mutar, y lo imposible por construcción es justo lo que hay
que fijar porque no deja rastro cuando se rompe.

## 0.55.0 — la población del espejo la declara el dueño, y G-11 cierra de verdad (2026-08-06)

Cierra la ORDEN R3-A y el hallazgo #2 de 1-C.

🔴 **El inventariado se inventariaba a sí mismo.** La lista de archivos del
`contract-mirror` salía de un manifiesto que ESTE repo generaba desde el
propio espejo: una omisión coordinada —borrar un archivo y regenerar— pasaba
en verde. Ahora la población la declara **el artefacto del dueño**
(`contract/mirror-inventory.json` de App Backend, copiado verbatim), con su
mapeo **`origen → destino` explícito**: siete de los 71 archivos se espejan
renombrados, y compararlos por convención daría "ausente" a archivos que sí
están. Se usa el mapeo tal cual viene.

**El verificador se reescribió en Node**, y la razón es la clase de defecto,
no el gusto: su chequeo de intruso usaba un `grep` anclado sólo por la
izquierda, así que un path que era PREFIJO de otro pasaba como inventariado.
Con JSON real y pertenencia por conjunto, esa clase **no existe** en vez de
estar tapada — y el marcador `test.fails` que la documentaba se retiró, que
era exactamente para lo que se puso.

**Tres preguntas separadas**, con la lección que el dueño pagó primero (su
gate gritaba con cada commit posterior aunque el contrato no se moviera, *"y
un gate que grita por lo que no es un desvío se termina ignorando"*):
`--integridad` (¿el espejo es fiel al inventario? lo único verificable sin la
fuente), `--paridad` (¿la fuente respalda al inventario en su commit
declarado? sin fuente → **NO CERTIFICADO**, jamás verde) y `--vigencia` (¿el
contenido sigue igual en HEAD?). Y `--generar-manifiesto` murió: bendecía el
espejo tal como estuviera. Su reemplazo verifica **antes** de escribir. En CI
el step se llama ahora **"Integridad local del contract-mirror (NO es
paridad)"** — antes decía paridad y medía otra cosa.

✅ **G-11 cierra de verdad.** El cierre anterior fue refutado —la wallet
nativa se adjuntaba a Stripe **antes** de validarla: *"rechazar después de
mutar no es rechazar"*—. Reauditado leyendo el código espejado y no el
anuncio: `aa28e84` verifica la elegibilidad **antes de cualquier mutación
remota** y la promesa **converge** (si el guardado falla por timeout, la
tarjeta aparece en el tick siguiente en vez de perderse). Cero campos nuevos:
lo que este front consumió era correcto y ahora está respaldado. Queda
declarado el límite del mock, que guarda siempre sincrónico — diferencia de
momento, no de forma.

**Y la puerta in-app se puso a la altura de su hermana:** `accept-link`
exigía `joined === true` desde hace versiones, y el accept in-app tenía
`accepted` tipado y **jamás leído** — cualquier 2xx decía "Te sumaste ✓" y
navegaba. No era una defensa faltante, era una asimetría; se copió la que ya
funcionaba, en las dos fachadas.

Cierre: **635 vitest (52 archivos) · 81/81 Playwright · integridad + paridad
+ vigencia del espejo · builds real y mock**, por exit code.

## 0.54.0 — fallar cerrado de verdad, rescatar los teléfonos rotos, y un cierre que no era (2026-08-06)

Cierra la ORDEN 1-C y la 2-A.4, que se quedó sin entrada propia. El hilo que
une todo: **un gate que sólo bloquea el caso que alguien pensó no es un
gate**, y **un documento que declara cerrado lo que está abierto es una orden
latente**.

🟡 **G-11 vuelve a estar ABIERTA y el consumo queda PROVISIONAL.** El dueño
publicó `7e45db0` (v2.46.0) declarando el P0 cerrado y este front lo consumió
en v0.53.0; horas después una auditoría externa refutó ese cierre — **cinco
huecos, el peor que la wallet nativa se adjuntaba a Stripe ANTES de
validarla**. No se revierte nada: el espejo copió bien y el front consumió
bien lo publicado, y revertir borraría trabajo correcto en vez de corregir la
base. Lo que sí se corrigió son **las afirmaciones**: el README del espejo y
las dos entradas de `GAPS.md` dicen ahora PROVISIONAL, con qué se refutó y
qué falta. El espejo queda congelado hasta el hash bueno.

**C-01 · sólo `mesa_joinable === true` habilita entrar.** La tarjeta de
invitación bloqueaba con `=== false`, o sea sólo el "no" explícito del
emisor: campo **ausente** (un backend anterior a v2.45.0 — el caso normal de
un deploy desincronizado), `null`, string `"false"` (verdadero en JS) o forma
inesperada ofrecían "Sumarme" hacia una mesa que podía estar muerta. **Un
campo que falta no es un campo en `false`.** El decoder nuevo sigue el patrón
de `walletRail`: puro sobre `unknown`, tipo exigido, tres estados.
🔴 Y la mitad que lo hace honesto: **no saber no es saber que cerró**.
"Cerrada" afirma el cierre porque el emisor lo dijo; "desconocida" usa el
estado DESCONOCIDO de §5 —"No pudimos verificar esta invitación"— porque
inventar el rechazo es el error inverso al que se está corrigiendo. De paso,
la lista dejó de renderizarse cruda: un elemento `null` reventaba el `.map` y
dejaba **la pantalla de Avisos en blanco**, fail-open en su peor forma.

**G-36 · el rescate llega a los teléfonos que YA estaban rotos.** v0.53.0
relanzaba el seed vencido sólo si llevaba la marca nueva; un `localStorage`
anterior no la tiene, y ése es justo el estado podrido que hay en los
dispositivos existentes. Ahora se migra —**sólo lo que se puede acreditar**:
lista blanca de códigos (PA-1099 EXCLUIDA: su historia es estar cerrada),
código único en el estado (los códigos nuevos salen del mismo rango y pueden
colisionar), firma inmutable, `paid_amount_cents` intacto, `guarantee_method`
de hoy (un legacy con `wallet` **debitaría saldo cada sesión** si se
relanzara: se conserva), nadie la tocó —con **'guest' contando como tocada**,
que es la misma persona—, y la invitación sembrada todavía presente. La
plantilla sale de una tabla explícita y **nunca del estado persistido**, que
está sucio por definición: una marca mal calculada se persiste y dejaría el
teléfono podrido *y* marcado. **Lo que no se acredita se conserva**, y
entonces Inicio ofrece la salida honesta ("Los datos de ejemplo de esta demo
ya vencieron" + Reiniciar), sólo en mock.

🔴 **Un test destapó un bug preexistente que nadie conocía**: la migración
0.21 del store itera `mesa.items` a ciegas, y como todo el cargador vive en
un `try/catch` que descarta el estado ENTERO, **una sola fila podrida le
borraba al usuario mesas, tarjetas, amigos, historial y ledger de
idempotencia — en silencio**. Arreglado, y la migración nueva corre además en
su propio `try/catch`: conservar gana a arriesgar.

**El gate del espejo, probado como caja negra.** Se lo copia a un árbol
temporal (copiar no es modificar) y se ejercitan sus clases: intacto → 0,
cambiado → 1, borrado → 1, intruso → 1, sin manifiesto → 2, README editable
sin romper paridad. Corre en la CI con todo lo demás.
🔴 **Y queda un defecto documentado, no tapado**: el chequeo de intruso usa
`grep` de subcadena sin anclar, así que un path que es PREFIJO de otro pasa
como inventariado. La orden pidió los tests y **no** tocar el verificador; el
caso lleva `test.fails`, que documenta el defecto **y se pone rojo cuando se
arregle** —verificado aplicando el fix hipotético— obligando a retirar el
marcador. Un `skip` se olvida; un test que afirma la conducta buggy la
bendice.

**Corrección documental:** la entrada 0.53.0 y el commit `5fc1f71` dicen
"78/78 Playwright" y eran **80** — el número se escribió antes de leer el
log, el mismo defecto de instrumento que esa versión documenta. Los commits
no se reescriben; queda dicho acá.

Cierre: **624 vitest (52 archivos) · 81/81 Playwright · gate del espejo ·
typecheck · builds real y mock**, por exit code.

## 0.53.0 — el gate de admisión: la mesa muerta lo dice, y fully_paid admite (2026-08-06)

La ventana que la auditoría descubrió arreglando el mock —invitación viva,
mesa muerta, "Te sumaste ✓" hacia la nada— quedó cerrada de punta a punta.
Mati ratificó las tres decisiones (A: el accept valida el estado de la mesa;
B: pagada-entera-pero-viva ADMITE; C: el link usa el mismo gate), App Backend
publicó el contrato en v2.45.0, y esta versión lo espeja y lo pone en
pantalla. Dueño primero, consumidor después.

- **Espejo a v2.45.0** (70/70 idénticos): `mesaViva()` — UN predicado, viva =
  `open | partially_paid | fully_paid` —, `410 mesa_not_joinable` en las dos
  puertas de entrar, y `GET /invitations` que MARCA (`mesa_joinable`,
  `mesa_status`) en vez de filtrar: la señal se computa desde el mismo
  predicado del gate, no desde una segunda expresión que se desincroniza.
- **El mock modela las tres puertas con el mismo predicado** — con el warning
  escrito de no confundirlo con el filtro de `/mesas/open` (fully_paid admite
  gente pero no se lista como abierta: dos conjuntos, por contrato). El 410
  del accept deja la invitación PENDIENTE: la mesa no revive, y consumirla
  sería inventar semántica que el dueño no cedió. Y PA-4520 dejó de violar el
  `.min(1)` de POST /mesas (mismo defecto de seed que tenía PA-3121).
- **Pantalla D** (link a mesa muerta, §1.2, copy de Diseño textual): "Esta
  mesa ya cerró / Hablá con quien te invitó si creés que es un error" —
  hermana de A/B/C, terminal sin Reintentar, honesta sólo con quien probó un
  token genuino (el 403 opaco sigue cubriendo al desconocido). Y la línea que
  cierra el círculo del recién registrado — "Tu cuenta ya está lista — podés
  abrir tu propia mesa cuando quieras" — ANTES de soltarlo a un Inicio vacío:
  la explicación vive en la pantalla que sabe qué pasó; Inicio no adivina.
- **Avisos**: la invitación a mesa muerta viene APAGADA de nacimiento ("Esta
  mesa ya cerró", sin Sumarme), leyendo `mesa_joinable` directo — ni
  desaparece (parecería un bug) ni invita al camino muerto. Más el toast
  homónimo para la carrera entre el listado y el toque.
- **fully_paid ADMITE, acreditado en POSITIVO**: unit en las dos puertas del
  mock y e2e que entra DE VERDAD por Avisos a una mesa pagada entera. Es la
  mesa que un espejo apurado apaga por parecerse a "ya no hay nada que hacer
  acá" — probar una regla no es probar su complemento, y un espejo que sólo
  testea rechazos pasa en verde apagando todo.

🔴 **Y el e2e de la pantalla D destapó un bug REAL, preexistente, de toda la
familia de rechazos**: el Shell recalculaba `tokenForMesa` EN CADA RENDER.
Cuando un terminal soltaba la custodia del token (comportamiento correcto),
cualquier re-render posterior —la sesión recién seteada tras el alta, por
ejemplo— volvía `null` el token y REEMPLAZABA la pantalla de rechazo montada
por `MesaScreen`: la persona veía "Mesa liquidada" en vez de "Esta mesa ya
cerró". **Afectaba también a los terminales viejos (403/400)** — ninguna
pantalla de rechazo estaba a salvo; sólo que ningún flujo de test
re-renderizaba el Shell a tiempo. **Salía verde en serie y caía en paralelo:
un test que sólo corre en serie acredita una coreografía, no un
comportamiento.** Fix: la decisión se toma UNA vez por navegación (`useMemo`
sobre `route`, que sólo cambia con hashchange), no por render. Tres corridas
paralelas seguidas del spec: 3/3.

De instrumento: dos carreras del harness pagadas y documentadas en el helper
del e2e (mutar localStorage con el mock vivo en memoria; hash+reload en el
mismo evaluate), y la cadena de exit codes cazó un hash corto en el README
del espejo antes del commit — el gate arreglado en v0.52.0 ya cobró.

Cierre: **580 vitest · 80 Playwright · typecheck · builds real y mock**,
_(decía 78/78: número escrito antes de leer el log. Corregido el 2026-08-06.)_
todo por exit code.

## 0.52.0 — las tres decisiones de Mati sobre lo que la auditoría dejó a la vista (2026-08-06)

La auditoría de v0.51.0 escaló tres cosas con dueño; Mati decidió las tres el
mismo día y esta versión las implementa. Son **features post-auditoría**, no
parte de la entrada anterior — por eso versión propia.

- **G-11 · el checkbox "Guardar esta tarjeta" nace DESMARCADO** (garantía y
  pago). Un casillero marcado por defecto hace la promesa sin que la persona
  la pida, y el backend hoy no cumple `save_payment_method` en direct charges:
  desmarcado, la promesa sólo existe si alguien la elige. No se escondió nada
  y quien lo marca, guarda. Eran TRES literales `true` —dos `useState` y un
  reset por mesa, el "segundo 15" otra vez—, unificados en una sola fuente
  (`GUARDAR_TARJETA_DEFAULT`, `saveCardView.ts`) con el fundamento escrito.
- **§1.4 · el stepper de comensales se pregunta SIEMPRE — murió el 4
  inventado.** En "cada uno lo suyo" nadie preguntaba cuántos son: viajaba el
  default invisible de un `useState(4)`, único separador del borde ÷1 (base
  de propina = la cuenta entera). Ahora el mismo stepper vive en los dos
  modos —"¿Cuántos pagan?" / "¿Cuántos son en la mesa?"—, nace SIN ELEGIR con
  el patrón de la propina (marco pendiente, CTA nunca apagado, toast+scroll),
  muestra en vivo la misma cuenta ÷ N de §1.5 bis con la fórmula del emisor,
  y el piso es del contrato (2 en iguales, 1 en consumo). Acreditado con la
  condición de la orden: el e2e lee el estado del mock y afirma que el N que
  viajó es EXACTAMENTE el elegido — buscando la mesa por código, porque el
  mock unshiftea y "la última del array" era una del seed con 4: el test
  ingenuo habría pasado en verde afirmando el defecto.
- **§1.5 bis · la propina desmedida se reconfirma, nunca se bloquea.** Umbral
  relativo (> 3× la base del emisor, estricto), diálogo con el monto exacto y
  la comparación —nunca un "¿estás seguro?" genérico—, dos salidas: "Volver a
  editar" (valor tipeado intacto) y "Sí, pagar" — la salida hacia adelante
  que el acta exige. Secuencial tras el gate de "sin elegir". Y la
  confirmación EXPIRA si la propina cambia: un "sí" dado sobre $700 no cubre
  un monto distinto del que el diálogo mostró — sin eso, la reconfirmación
  era un cheque en blanco con cara de protección.

De instrumento, para el que audite después: la cadena de gates ahora corta
por **exit code** — `playwright | grep` devolvía el exit del grep, que
aprueba por *encontrar* la palabra, incluida "failed". El grep quedó para
informar conteos desde los logs, nunca para decidir.

Cierre: **568 vitest · 75/75 Playwright · typecheck · builds real y mock**,
gateado por la cadena nueva (exit=0).

## 0.51.0 — auditoría pre-dominio: se buscó lo roto, y esto es lo que había (2026-08-06)

Mati compra el dominio y quiere subir con cero bugs, así que esta versión no
agrega: **audita**. Recorrido completo del comensal y del invitado a 375px
contra el mock, caminos adversos (doble tap, recarga a mitad de flujo, links
vencidos, expiración presenciada EN VIVO), coherencia contra el spec y barrido
de código por las familias de defectos conocidas. **13 hallazgos reportados,
9 corregidos acá bajo despacho del Bibliotecario, 4 falsas alarmas documentadas
para que nadie las vuelva a cavar.** Consola: cero errores en toda la sesión.

Lo que estaba roto y ya no:

- 🔴 **La coma cobraba ×100.** El saneo del monto de propina a mano BORRABA la
  coma: "12,34" eran $1,234.00, sin señal. La regla nueva vive en
  `sanearMontoPropio`: la coma sola ES el decimal y se normaliza ("12,34" →
  1234 centavos); lo ambiguo ("1,234.56") se rechaza al camino inválido, nunca
  se adivina. Medido antes/después en pantalla: CTA $1,429.00 → $207.34.
- **Inicio escondía mesas abiertas.** La premisa "nunca hay más de una" (cierta
  en 2026-08-03) murió con G-28, y `mesas[0]` truncaba sin rastro — con §1.10,
  la mesa truncada no existía en NINGUNA superficie. Entró la variante B del
  spec: protagonista por `expires_at` más próximo (el reloj de garantía, no el
  orden del payload — con el seed CAMBIA qué mesa se ve), fila "+N mesas
  abiertas más" y hoja inferior. Con una sola mesa, cero cambio, testeado.
- **El badge acusaba al que ya pagó.** `partially_paid` decía "Falta pagar";
  ahora "Pago en curso" — describe a la mesa, no a quien mira. Personalizar de
  verdad espera un campo por-participante: **G-34**, con la condición escrita.
- **En partes iguales, marcar era un gate disfrazado.** La pantalla dice
  "no cambia lo que pagás" y el gate exigía marcar igual — en DOS lugares
  (el disabled y un guard en `goToPay`). En igual ya no se exige; en consumo
  no se tocó: ahí la selección ES el monto. Dos mitades acreditadas por e2e.
- **La demo no podía contar el pitch.** La pantalla A-2 rica ("Tu garantía
  cubrió $X · el restaurante cobró el total") era INALCANZABLE: el atajo
  apuntaba a un seed en `settled` y la expiración viva también paraba ahí.
  Seed a `completed` y `settleIfExpired` del mock a `completed` — en la demo
  el cierre por vencimiento ES el cierre completo, porque no hay dispersión
  que esperar. El riel real y su pantalla prudente quedan intactos.
- **El mock mentía como G-28, en tres rieles más.** La cuenta recién creada
  heredaba las tarjetas y el `payme_id` del seed (el pagador primerizo era
  inejercitable — ahora nace limpia y ese camino está recorrido y sano);
  la invitación vencida se servía para siempre y se aceptaba con "Te sumaste ✓"
  (ahora GET filtra y accept contesta 410, como el emisor); y aceptar una
  invitación no escribía participación — la mesa aceptada jamás aparecía en
  `/mesas/open` (ahora escribe, con mutante). Y el seed de la mesa igual tenía
  `items: []`, un estado que `POST /mesas` prohíbe: modelaba un imposible.

Lo que quedó a la vista y NO se tocó acá, cada cosa con su dueño:

- 🔴 **G-11 quedó FUNCIONANDO a la vista**: con el pagador primerizo alcanzable,
  el checkbox "Guardar esta tarjeta" aparece MARCADO por defecto y el mock
  cumple la promesa que el backend real no cumple en direct charges. Decisión
  contractual, en el archivo de Mati.
- **La base de propina ÷N** (D7): en consumo nadie pregunta cuántos son y viaja
  un 4 inventado — y se midió el borde: con N=1 la base es LA CUENTA ENTERA.
  El número correcto no existe; la regla es decisión de producto, con Mati.
- **Propina sin techo** ($999,999 sin fricción; el contrato tampoco acota) —
  producto, con Mati. · **G-35**: hash sucio en rutas desconocidas (deuda de
  router). · **G-36**: el seed se pudre en sesión larga; "Reiniciar la demo"
  cura y nada lo sugiere.

Falsas alarmas documentadas (los retiros valen tanto como los hallazgos): el
"sin estado de carga" de Pagos era el skeleton que mi volcado de texto no ve;
PA-4520 no era una invitación a mesa propia; el token multi-canje ES el diseño
(link de grupo de WhatsApp — "una sola vez" refiere a mostrarse, no a
canjearse); y `stringToCents` nunca tuvo la culpa de la coma: era el saneo.

Cierre: **564 vitest · 71 Playwright · typecheck · builds real y mock**, todo
corrido como única escritora del árbol. Y una lección de instrumento pagada
dos veces esta noche: un `tail -2` sobre la salida de Playwright me escondió
un "1 failed" (declarado en `77a1ab7`), y un `var(--sp-5)` inexistente
invalidó un shorthand ENTERO de CSS — las salidas se leen completas, y los
tokens se verifican contra `:root` antes de usarse.

## 0.50.1 — el borde de página subcontaba una mesa; carga completa antes de agrupar (2026-08-05)

Corrección sobre 0.50.0, por límite marcado por el Bibliotecario-Auditor: la
"paginación honesta" heredada de `PagosScreen` **acá no era honesta**. `Pagos`
lista renglones y una página parcial sólo muestra menos renglones; Historial
**SUMA por mesa**, así que una mesa cuyos renglones quedaron partidos entre
dos páginas mostraba un total propio **subcontado como si fuera el real** —
plata pagada que la pantalla no contaba. Y con orden por fecha DESC no alcanza
con descartar la última mesa del borde: cualquier mesa cercana puede tener
renglones en la página siguiente.

- `traerHistorialCompleto` (`historialView.ts`) pagina con `limit` 100 hasta
  la página corta **antes** de agrupar. Muere "Cargar más".
- **O está todo, o es error**: una falla a mitad de carga propaga al estado de
  error con Reintentar — totales parciales serían el mismo defecto con otra
  cara. Backstop anti-loop (50 páginas llenas → error explícito, no cuelgue).
- Cinco tests nuevos, incluido el de la mesa partida entre dos páginas que
  suma completa.

**548 vitest · 67 e2e** · typecheck · builds real y mock · re-verificado en
navegador contra el mock a 375px.

## 0.50.0 — §1.10 · Mesas ES el historial, y la mesa viva deja de repetirse (2026-08-05)

Última pantalla del rediseño. La entrada "Mesas" de la barra deja de mezclar
"Abiertas ahora" con una lista de pagadas: **es el historial de mesas
cerradas**, con el título "Historial" en píldora `--teal-l` angosta (la barra
sigue diciendo "Mesas" por espacio). Primer nivel de verdad: cabecera navy con
logo, barra de cinco con "Mesas" activa, y muere el `.fab` flotante de la
pantalla vieja.

- **La mesa abierta no se repite acá — y era un defecto vivo, no cosmética.**
  El organizador que pagaba su parte veía su mesa DOS veces: en Inicio como
  abierta y acá abajo de un encabezado de mes, como si hubiera terminado.
  Recién se pudo arreglar con `mesa_status` (v2.42.0); qué cuenta como
  "abierta" **lo dice el contrato, no un criterio propio**: `open |
  partially_paid`, la misma lista que filtra `GET /mesas/open`
  (`historialView.ts` la espeja con test que lo declara). Con G-28 cerrado el
  invitado ya ve su mesa viva en Inicio, así que excluirla de acá no deja a
  nadie sin nada — la secuencia que ordenó el Bibliotecario.
- **Lista agrupada por mes local** (encabezado pegajoso, misma decisión
  argumentada en `pagosView.ts`), fila con restaurante · fecha + **franja
  horaria** · lo que pagaste vos en tabular · chevron. La franja se calcula en
  el front del timestamp completo —cero gap de contrato— con cortes decididos
  acá: 6–12 · 12–16 · 16–20 · 20–6. Cuatro glifos nuevos en el set propio
  (`sun-rise`, `sun-high`, `sun-low`, `moon`), verificados renderizados a
  14px: lo que importa es que se distingan ENTRE SÍ, y el ícono acompaña
  siempre a la palabra.
- **El acordeón NO muestra ítems, a propósito.** G-33 sigue abierta —el
  contrato no tiene detalle de mesa cerrada; el que hoy funciona lo hace por
  coincidencia— así que la fila despliega el estado **desconocido** de
  `SISTEMA_DISENO.md` §5 (interrogación, punteado, copy honesta), nunca un
  mock que aparente funcionar. Cuando el dueño del contrato conteste, ese
  acordeón es el único lugar a tocar.
- **El mock volvía foto lo que el emisor proyecta vivo.** `mockHistory` servía
  el `mesa_status` del momento del pago; el emisor lo saca de un `JOIN mesas`
  al momento de la consulta. Con la foto, la mesa donde pagaste tu parte
  quedaba `partially_paid` para siempre y el historial la excluía aunque ya
  hubiera cerrado. Se re-lee la mesa al servir; acreditado con mutante — misma
  clase de defecto que el `openedByUser` de G-28.
- Paginación honesta heredada de `PagosScreen`: sin `has_more` en el contrato,
  "Cargar más" aparece cuando la página vino llena. Error de red con
  Reintentar (no un vacío que miente), skeleton con silueta, vacío real sin
  borde: *"Todavía no cerraste ninguna mesa."*
- El marcador e2e de `#/mesas` pasó del heading "Mesas" (murió con la TopBar)
  a la píldora "Historial", y `e2e/historial.spec.ts` estrena tres recorridos:
  el seed por mes sin "Abiertas ahora", el acordeón desconocido, y **la mesa
  viva con la parte pagada que NO aparece** — este último acreditado matando
  el filtro.

**543 vitest · 67 e2e** · typecheck · builds real y mock · verificado en
navegador contra el mock (seed v1) a 375px.

## 0.49.0 — el espejo va a v2.42.0, y G-28 se muere también en el mock (2026-08-05)

Refresh del `contract-mirror` contra el backend **v2.42.0** (`22b84a2`): cinco
archivos, **70 espejados · 70 idénticos · 0 diferencias**. Los dos cambios de
contrato son **aditivos**; nada de lo que este front ya consume cambió de forma.

- **G-28 cerrado por el emisor.** `GET /mesas/open` incluye las mesas donde el
  usuario es **participante activo**, no sólo las que abrió. Mismo shape, más
  filas: quien se sumaba por un link no tenía forma de reencontrar su mesa y su
  Inicio decía "No tenés mesas abiertas" **mientras debía plata**, sin error que
  lo delatara. **El front no necesitó cambiar nada… salvo el mock**, que
  reproducía el mismo filtro y por lo tanto el mismo defecto. Un mock que miente
  es peor que no tenerlo. Acreditado con su mutante.
- **`GET /account/history` trae `mesa_status`**, que entra en `HistoryEntry` con
  su procedencia. El compilador encontró los cuatro sitios que faltaba tocar.
  🔴 Queda anotado en el tipo que la granularidad es **un renglón por pago** y
  que no se pide que el contrato agrupe: esa misma respuesta alimenta
  `PagosScreen`, superficie card-only ratificada. **Ningún campo se consume en
  pantalla todavía** — §1.10 y la burbuja de Inicio son trabajo aparte.
- **El riel wallet del backend se endureció, no se aflojó**: `wallet_rail.
  enabled` dejó de ser un literal y sale del servicio autoritativo, que eliminó
  la env var `LEGACY_WALLET_ENABLED`. Ya no existe variable de entorno que
  reabra la creación de obligaciones nuevas. `account_activity: true` no se
  movió.

⭐ **El test de paridad del riel encontró que la autoridad se había mudado.**
Raspaba literales del bloque `WALLET_RAIL` de `config.js`; con `enabled` fuera
de ahí, habría quedado comparando **un solo campo y pasando en vacío sobre el
que importa**. Ahora lee las dos fuentes del espejo y además exige que `enabled`
no haya vuelto a ser literal.

**529 vitest · 64 e2e** · typecheck · builds real y mock.

## 0.48.0 — §1.5 bis · la propina se elige, y el sistema deja de elegirla (2026-08-05)

**El defecto no era que la elección se pudiera saltear: era que ya estaba
hecha.** La pantalla de pago arrancaba en `useState(15)` con modo `'pct'` y
volvía a 15 en cada mesa nueva, así que quien nunca tocaba el selector pagaba
**$31.50 sobre una parte de $210.00** y el payload salía con `tip_bps: 1500`,
indistinguible de una decisión propia. Es la orden de propina obligatoria del
acta del 2026-08-05, especificada por Diseño en `SPEC_APP.md` §1.5 bis.

- **La propina nace sin elegir.** `TipChoice` —módulo puro `tipSelectorView`—
  no puede representar un porcentaje que nadie tocó: el `pct` vive adentro de la
  variante elegida. El default de 15 ya no se puede reescribir sin inventar un
  caso nuevo del tipo; **el compilador es parte del arreglo, no sólo el test.**
- **Antes de elegir se muestra la base sola**, con *"+ propina (elegí abajo)"*.
  Nunca más un total con un porcentaje adivinado en pantalla.
- 🔴 **La señal de "falta elegir" vive en el MARCO, no en la píldora**, y ésa es
  la decisión fina del spec: si viviera en la píldora, el 0 % necesitaría un
  estado visual propio y quedaría de segunda clase. Elegido, el 0 % se rellena
  con el **mismo `--action-2`** que 10/15/20. Sin tratamiento especial para
  "elegí no dejar propina" — es lo que lo hace de primera clase de verdad.
- **El botón de pagar queda activo, nunca gris.** Un botón muerto se lee como
  error del sistema, no como "te falta un paso". Tocarlo sin elegir no envía
  nada: avisa, desliza hasta el selector y el borde pulsa una vez.
- **Entra el preset de 5 %**, en el mismo commit que saca el default. Antes
  habría dejado cinco píldoras con una pre-elegida: más superficie para el
  mismo defecto.
- **Riel monetario sin mover nada**: el token de la clave de idempotencia sale
  del mismo payload que viaja (`b<bps>` / `c<centavos>` intactos), el
  obligatorio no se dispara sobre un pago congelado por B-06 —la propina ya
  está comprometida en esa clave— y el gate del mesero a `tipCents > 0` se
  conserva: sin propina no hay a quién atribuirla.

⭐ **Tres cosas que salieron de medirlas, no de deducirlas:**

- **Matar el `useState(15)` solo no reproduce el defecto.** Mutado únicamente el
  estado inicial, los cinco recorridos siguen verdes: el `useEffect` de
  identidad corre al montar y lo pisa. **El que manda en el camino de pago es el
  reset por mesa.** Con los dos mutados mueren dos recorridos, en las
  afirmaciones correctas.
- **El fallback del acta no funcionaba con el selector inline.** Un error ahí
  explota mientras la pantalla arma sus hijos —fuera del subárbol que ve el
  error boundary— y se lleva el pago entero. Por eso el selector es un
  componente propio: **acreditado rompiéndolo**, el cobro continúa, sale la nota
  informativa en `--text-muted` y el comprobante dice propina **$0.00**. Nunca
  15, que sería el mismo bug disfrazado.
- **El quinto preset no entraba a 375px**: "Otro" se salía por la derecha. El
  spec ya lo dibuja en su propia fila.

**528 vitest · 64 e2e** · typecheck · builds real y mock. Verificado en el
navegador a 375px contra el mock, en los tres estados: sin elegir, 0 % elegido y
selector caído.

## 0.47.0 — §1.9 · la sección social, y el pedazo del spec que no se puede construir (2026-08-05)

**§1.9 queda cerrada.** Amigos, Grupos y Solicitudes dejaron de ser dos rutas
con pestañas de pastilla gris: son **tres pestañas en burbuja de una sola
pantalla** (§5 bis · B, el mismo componente que Inicio).

- **Una pantalla y no tres rutas, por una razón medible:** el badge de
  Solicitudes tiene que verse desde Amigos y desde Grupos. Con una ruta por
  pestaña, las tres pantallas tendrían que pedir las solicitudes sólo para
  pintar un número en una pestaña ajena.
- **La ruta `grupos` se retira limpia, sin alias**, y se midió antes de
  decidirlo: su único call site eran las pestañas viejas y **cero
  `navigate('grupos')` durmientes**. Es el caso de `perfil` (0.46.0), no el de
  `cuenta`. **El compilador encontró los dos puntos que rompía** —`SocialTabs` y
  la lista de rutas legítimas del guard—: tercer cobro de derivar la unión de
  `PAGES` (0.43.0), y ningún `grep`.
- 🔴 **Solicitudes sale con UNA lista, y la ausencia es deliberada.** El spec
  pide adentro un selector de pastilla Amigos/Grupos y filas *"Te invitó a
  {grupo}"*. **No existe en el contrato, y no es un endpoint que falte: es otro
  modelo de producto.** `friend_groups` tiene `user_id` y `UNIQUE (user_id,
  name)`; `GET /groups` filtra por `g.user_id`, así que **a quien agregás nunca
  se le avisa y el grupo no le aparece**; `POST /groups/:id/members` inserta
  directo con `201 {added:true}`. **Un grupo es una carpeta de contactos tuya.**
  Un control cuyo segundo lado no puede tener nada nunca es la misma promesa
  vacía que el spec ya le negó al QR (§1.7), a Cuentas Asociadas (§1.11) y a
  "Configuración" en `Más`. Va como **G-32**, y es **decisión de producto antes
  que pedido de contrato**: no lo cierra ningún campo aditivo.
- **El alta de grupo estrena selección de ícono**, que es lo que §1.9 pide con
  *"ícono propio, no uno repetido"*. El contrato ya aceptaba `icon` opcional y
  la fachada ya lo pasaba: **faltaba sólo la superficie**, así que todo grupo
  nacía con el default del backend y la lista entera se veía igual. El "gap"
  era de UI, no de contrato — y se parecía tanto a uno que valía verificarlo.
- **Listado alfabético** con `localeCompare('es')`, que ordena bien los acentos.
- ⭐ **El bug del CTA tapado cambió de forma, así que cambió de assert.** El
  `.action-bar` que medía el test viejo **ya no existe** —lo reemplazó el tile,
  que vive arriba de todo—, y adaptarlo habría sido afirmar sobre un elemento
  retirado: verde y vacío. El modo de falla se mudó a **la última fila del
  listado**, así que ahora se afirma el **mecanismo**: el `padding-bottom` real
  contra el alto real de la barra. **Acreditado con su mutante** —un
  `style={{ padding: 12 }}` inline, shorthand que pisa el longhand—, que lo tira
  y sólo a él.
- **El identificador sube de 11px a `--fs-sm`** (14px), en commit propio: era
  información por debajo del piso del sistema, y `.fr-name .id` lo usan también
  `InviteFriends` y `TransferScreen`. Mezclarlo habría escondido su alcance
  real adentro de un commit de otra cosa.
- El conteo del badge **entra al nombre accesible** de la pestaña a propósito:
  quien no ve el círculo naranja igual necesita enterarse. Queda anotado en el
  componente, porque vuelve inservible buscar esa pestaña con `exact: true`.

**517 vitest · 63 e2e** · typecheck · builds real y mock. Uno menos de vitest: el
guard de rutas itera la lista y perdió `grupos`. Verificado en mock a 375px —las
tres pestañas y el detalle de grupo—, consola limpia.

## 0.46.0 — §1.9 · `Más` es una pantalla de verdad (2026-08-05)

La quinta posición de la barra dejó de apuntar a Perfil "provisoriamente".

- **`Más` ES Perfil, no la contiene** (Diseño, 2026-08-05, sobre tres preguntas
  que este repo dejó abiertas). Un menú con una sola fila útil agrega fricción
  sin agregar nada, y **"configuración" no entra**: cero spec, cero pantalla,
  cero contrato detrás — el mismo tratamiento que el QR de Compartir y Cuentas
  Asociadas. **No hubo pantalla nueva que inventar.**
- **La ruta se renombra limpia, sin alias**, y eso se verificó antes: `perfil`
  **no tenía un solo `navigate('perfil')` durmiente**. Es lo contrario de
  `cuenta`, que conserva su `case` porque sí los tiene — **dos rutas retiradas
  en el mismo turno, dos tratamientos, y la diferencia es medible.**
- **Amigos y Grupos salen de la pantalla.** No es recorte: las dos son
  **posiciones de la barra**, así que esas filas eran **un segundo camino al
  mismo lugar** — navegación que hay que mantener coherente en dos lados y que
  se desincroniza sola. **"Mis tarjetas" se queda**: es el único acceso a
  gestión de tarjetas, card-only ratificado, y la barra no tiene posición para
  ella.
- El destino de la posición y la ruta de la pantalla van en el **mismo commit**:
  mientras el destino decía `perfil`, tocar Más llegaba igual a algo, así que un
  test de "llega a una pantalla" no distinguiría el antes del después.
- ⚠️ **El test de ausencia falló en su primera versión por la razón que
  justifica el cambio**: buscaba cero botones "Amigos" y encontró el de la
  barra. Que la fila y la posición choquen en el mismo selector **es** el
  duplicado que se sacó, visto dos veces.
- El renombre dejó que **el compilador** encontrara los cinco call sites en vez
  de buscarlos con `grep` — segundo cobro de derivar la unión del array (0.43.0).

**518 vitest · 63 e2e** · typecheck · builds real y mock.

## 0.45.0 — §1.9 · paso 6 · se retira la Cuenta vieja (2026-08-05)

**La pantalla se va; la ruta se queda.** Es la parte de §1.9 que quedó separable
del bloque social, y la única que toca superficie del riel de saldo.

- **`CuentaScreen` sale del árbol.** Su mitad card-only ya vivía en las dos
  pantallas de primer nivel que estrenó §1.11 —`#/tarjetas` y `#/pagos`—, y su
  otra mitad era riel saldo apagado.
- 🔴 **`case 'cuenta'` SOBREVIVE** apuntando a `TarjetasScreen`. Verificado
  contra el árbol: quedan **ocho `navigate('cuenta')` durmientes** —riel saldo,
  preservados por ratificación— y **sin `case` cualquiera dejaría la app en
  blanco**. Se descartó sacar `'cuenta'` de la unión de páginas —haría fallar el
  compilador, que sería mejor— porque su precio es editar ocho call sites
  durmientes: **la ratificación pesa más que la elegancia del compilador.**
- **Los dos gates no se reubican: se acredita que la superficie ya no existe.**
  `accountRailView` **conserva sus cinco campos** —un campo durmiente no se borra
  porque su consumidor se haya ido— y lo que se prueba es que **ningún archivo
  vivo lee `showWalletMovements`**, con barrido de fuente y control positivo.
- ⭐ **El recorrido que impide repetir `07f0ba2` no se aflojó: se mudó.** Vivía
  sobre `#/cuenta`, donde las dos superficies convivían en pestañas. Ahora se
  afirman **donde viven**, una ruta cada una, con el barrido de vocabulario
  wallet corriendo sobre las dos por separado. **Queda más fuerte que antes.**
- **Tres mutantes, tres capas distintas:** sacar el `case` lo mata **el
  compilador** —el `never` de 0.43.0 cobrando—; apuntarlo a otra pantalla deja
  **typecheck verde y e2e rojo**; agregar un consumidor vivo del gate lo tira.
- El recorrido de Cuenta en la barra **se retira en vez de adaptarse**: afirmar
  sobre una pantalla que ya no existe es verde y vacío.
- `rutas-montan-pantalla` estrena el tipo **`alias`**: dos páginas
  indistinguibles por su render **se declaran**, no se tapan con un marcador
  débil. Afirma que se ve la pantalla aliasada **y que la URL no cambió** —un
  redirect pasaría la primera, y dejaría la ruta vieja fuera del `case`.

**Queda de §1.9** el bloque social: Amigos + Grupos + Solicitudes en una pantalla
con tres pestañas. **`Más` está bloqueada**: el spec la nombra tres veces y no la
diseña ninguna, y "configuración" no existe. **518 vitest · 61 e2e** · typecheck
· builds real y mock. JS real 350.30 → 342.88 kB.

## 0.44.0 — §1.9 · pasos 2 y 3 · una sola barra en toda la app (2026-08-05)

La sección social **no** se rehizo todavía: eso es el bloque irreducible de §1.9
y va con su propia orden. Esto es el corte que lo vuelve seguro.

- **La fila de tarjetas de Perfil iba a la Cuenta vieja.** Era el **único
  `navigate('cuenta')` vivo** del repo; los otros ocho son declaraciones o riel
  saldo durmiente y **no se tocan**. Ahora va a `#/tarjetas`. **Ninguna prueba
  tocaba Perfil**, así que estrena `e2e/perfil-accesos.spec.ts`.
- **Las cuatro pantallas que quedaban —Perfil, Amigos, Grupos y Cuenta— montan
  `AppBottomBar`**, y con la última **`showNav` y `BottomNav` desaparecen**.
  `App` vuelve a montar sólo la pantalla: qué barra lleva cada una es decisión de
  la pantalla, porque el círculo central cambia según dónde estás.
- **Cada conversión es atómica**: montar la barra nueva **y** salir de `showNav`
  en el mismo commit. La mitad de eso deja **las dos barras conviviendo**, y esa
  falla no da error — da una pantalla que se ve mal.
- **Las posiciones dicen la verdad**: Amigos en Amigos **y en Grupos** —viven en
  la misma sección, criterio que ya usaba `BottomNav`—, Más en Perfil, y
  **ninguna en Cuenta**, que §1.11 fusionó adentro de las pestañas de Inicio.
  Encender una "para que no quede vacía" lo dice el recorrido.
- 🔴 **Volvía el bug del CTA tapado.** `.action-bar` no es fijo y la barra sí:
  sin aire por debajo, la barra se le monta encima a "+ Agregar amigo" — el
  reporte del hermano de Mati del 2026-07-24, en el mismo botón. Entra
  `.has-appbar .action-bar`, gemelo del que ya existía. **Se mide con cajas y no
  con `toBeVisible()`**: un elemento tapado por otro sigue siendo "visible" para
  Playwright.
- **Las dos barras llevaban el mismo landmark**, así que contarlo dice
  directamente si hay dos. Es mejor que cualquier proxy: no depende de qué
  posición tenga cada una ni de una clase de CSS.
- Un detalle que no se ve en el diff y sí en el teléfono: el
  `style={{ padding: N }}` inline del `.scroll` **pisa** el `padding-bottom` de
  `.has-appbar .scroll` —shorthand inline contra longhand de clase— y deja la
  última fila debajo de la barra. Va en longhands en las cuatro.
- **`BottomNav.tsx` y sus estilos salen del árbol**, acreditado en el bundle
  construido: `bottom-nav`, `nav-item` y `has-nav` dan **cero** en el CSS de
  salida, con `appbar-block` de control positivo. **`.fab` y `.cta-float` NO se
  van** —el comentario del sistema los daba por condenados junto con
  `.bottom-nav` y era cierto para uno solo—: siguen vivos en Mesas y en los dos
  flujos de mesa.

**Queda de §1.9** el bloque grande: la sección social unificada con sus tres
pestañas, `Más`, y la demolición de `CuentaScreen`. **517 vitest · 61 e2e**
(venían 52) · typecheck · builds real y mock.

## 0.43.0 — El ruteo deja de fallar en silencio, y §1.7 deja de mentir (2026-08-05)

Los dos preparativos de §1.9, antes de tocar la sección social. Ninguno de los
dos cambia lo que la app hace; los dos cambian lo que la app puede romper.

- **El switch de `src/App.tsx` no tenía `default`**, así que una ruta declarada
  sin `case` **no montaba nada: pantalla en blanco, sin error y sin test rojo**.
  Ahora el `default` asigna la ruta a un `never`, y olvidarse de un `case`
  **rompe el build** — no es un test que haya que acordarse de correr.
- **`PageId` se DERIVA de `PAGES`.** Eran dos listas —la unión de tipos y el
  `Set` que valida el hash— que decían lo mismo sin que nada las obligara a
  coincidir. Y el `page as PageId` de `parseHash` es un cast **sin chequeo**
  (`ReadonlySet<string>.has()` no narrowea), así que una página en el `Set` y no
  en la unión llegaba al switch sin `case` **invisible para el compilador**.
  Derivar vuelve esa deriva **imposible de escribir**, no detectable.
- **`e2e/rutas-montan-pantalla.spec.ts`** itera el array del router y afirma que
  cada ruta monta **la suya**. Iterar el array —y no una lista propia— significa
  que una página nueva entra sola al recorrido. **Cada ruta afirma dos cosas: que
  se ve su marcador y que NO se ve el de Inicio**, porque con el `default`
  devolviendo Inicio un test de "renderiza algo no vacío" pasaría con el `case`
  borrado.
- Tres mediciones que corrigen supuestos: el `default` de runtime **es
  inalcanzable hoy, y lo es *porque* existen los dos cambios de arriba** — antes
  estaba vivo; **`noUnusedLocals` ya mataba** el mutante "el `case` monta otra
  pantalla", así que el mutante que acredita el e2e es el del `param`
  (typecheck verde, e2e rojo); y **`tsconfig` sólo incluye `src`**, así que un
  tipo dentro de `e2e/` no es un guard sino ayuda de editor.
- **§1.7 · "Volver" pasa a "Ver mesa"** y se retira "Paso 5 de 5" (corrección de
  Diseño). El destino ya era el correcto —volver a División abriría una segunda
  mesa con un segundo hold, B-06— y lo que mentía era el nombre: *un control que
  dice "Volver" y no retrocede es una etiqueta que miente*. De paso recupera el
  CTA explícito "todavía te falta elegir lo tuyo", **sin agregar un segundo
  botón**: es el mismo control.
- **El ícono hubo que dibujarlo.** El spec pide `ti-tools-kitchen-2` y aclara que
  es "el mismo que usa la categoría de restaurante"; en este repo ése es
  `dining`, dos círculos concéntricos, y **a 20px se lee como una diana**.
  Segunda vez que el set falla a tamaño chico —§1.8 ya lo había medido a 26px—,
  así que se dibujó el glifo que el spec nombra, en el set propio y sin
  dependencias. **Pendiente de confirmación de Diseño.**
- Una ausencia nueva afirmada: el contador de paso de §1.7, acreditada
  devolviéndolo. Y el que clickeaba "Volver" ahí no era `compartir.spec.ts` sino
  **`pago-completo.spec.ts`**, el camino de pago entero.

**517 vitest · 52 e2e** (venían 36) · typecheck · builds real y mock.

## 0.42.0 — ORDEN VISUAL · Compartir, la última de prioridad alta (2026-08-05)

**`SPEC_APP.md` §1.7 aplicada**, con el spec ya reescrito por Diseño: los dos
bloqueos que la habían frenado se resolvieron **achicando**, no inventando.

- **La pantalla existe como tal por primera vez**: cabecera de flujo con "Paso 5
  de 5", tarjeta de título `--teal-l` —*"¡Mesa garantizada!"*— y el **código como
  protagonista**, en mono y grande, que se toca para copiar. Era una `TopBar`
  genérica con el link suelto en un recuadro punteado.
- **"Compartir por WhatsApp" con el color correcto: `#075E54`.** El `#25D366`
  que tenía da **1.98:1** con texto blanco y reprueba AA de punta a punta; sobre
  este teal el blanco da 7.67:1.
- **Lo que la pantalla NO tiene, y no por olvido.** El **QR** queda afuera —no
  deshabilitado, no "próximamente"—: no hay generador en el repo y Stripe.js es
  la única dependencia pre-autorizada. La pestaña **"Ya se sumaron"** se cae
  (G-30), y con ella el componente de pestañas en burbuja: una sola sección no
  es un selector. Y **"Invitar a todos" desaparece** — el spec manda acordeón
  con un botón por integrante, porque es un atajo para encontrar gente y no un
  envío masivo.
- **Las ausencias se afirman**: `e2e/compartir.spec.ts` cubre las tres más el
  link de WhatsApp. Una ausencia no la rompe nadie por accidente — la rompe
  alguien que "completa" la pantalla de buena fe. Acreditadas mutando: devolver
  "Invitar a todos", agregar un "Código QR" y sacarle el link al mensaje tiran
  tres, y sólo esas tres.
- **"Volver" no lleva a División**, y es lo único del spec que no se aplica
  literal: la mesa YA existe y la garantía YA está autorizada, así que volver a
  dividir cambiaría la clave y abriría una segunda mesa con un segundo hold
  (B-06). Lleva a la mesa.
- **`--fs-lg` no existe** — la escala declara seis tamaños y dice que no hay un
  séptimo. El código va en `--fs-h1`, el más cercano hacia arriba.
- Dos cosas de mirar a 375px: el **círculo de la barra reducida quedaba hundido**
  (el `min-height` de la posición sobra donde no hay etiqueta), y **"O invitá a
  un grupo" quedaba pegado** al card de contactos porque el reset de margen del
  `<h2>` de §1.8 estaba declarado después y ganaba por orden.

**Con esto, las diez pantallas de prioridad 1 y 2 del spec están aplicadas.**
Quedan §1.9 —que retira `CuentaScreen` y `BottomNav`— y §1.10 Historial.

## 0.41.0 — ORDEN VISUAL · Avisos pasa a primer nivel (2026-08-05)

**`SPEC_APP.md` §1.8 aplicada.** El cambio de fondo **no es cosmético: es
navegación** — la pantalla pierde la flecha de volver.

- **Cabecera de primer nivel**: logo + `payme_id` + campana en `--brand` sin
  badge. La regla de §5 bis · A es dura —*"si una pantalla tiene el logo arriba,
  es de primer nivel; no puede tener flecha de volver"*— y su precio es que la
  **única salida deliberada pasa a ser la barra inferior**, que §1.8 nombra
  explícitamente como la forma de salir.
- **La campana no es un botón.** No hace nada: ya estás adentro. Va como
  `role="img"` con nombre accesible, y —sin tarjeta de título— ese nombre es lo
  único que dice de qué pantalla se trata. Naranja porque el badge cuenta lo que
  no viste y acá lo estás viendo. **No es una quinta excepción de la lista
  cerrada**: es la misma ranura sobre la banda navy a la que el sistema ya le
  concede `--brand` para el badge, y que ya convive con el círculo de la barra
  en toda pantalla de primer nivel. Mide 5.82:1 sobre navy.
- **Cuatro recorridos nuevos de Playwright, y existen por esto**: ningún test
  tocaba Avisos, así que sacar el `AppHeaderBack` no rompía nada que la suite
  pudiera ver, y si la salida por la barra falla la persona queda encerrada.
  Cubren entrada por la campana, ausencia de "Volver", salida por la barra,
  Atrás del navegador y el canje. Acreditados mutando: sacar `bellHere` y
  devolver el copy a "Aceptar" tiran dos, y sólo esos dos.
- **"Marcar leídos" baja del encabezado** a su propia fila, que existe aunque no
  haya nada sin leer: si apareciera y desapareciera, la lista saltaría justo
  cuando la persona termina de marcar.
- **La tarjeta de invitación** deja de ser `card` blanca — `--teal-l` con borde
  `--action-2`, que es lo que le da jerarquía y no el color del botón—, va en
  **dos líneas** y su botón dice **"Sumarme"**, el mismo verbo de §1.2. El punto
  de no leído pasa a `--action` navy. Los rótulos de sección pasan a `<h2>`:
  sin tarjeta de título la pantalla no tenía ningún encabezado.
- **El ícono por categoría del restaurante no se puede: G-31.**
  `GET /invitations` manda el nombre y ni `category` ni el id. Queda `store`,
  genérico. Lo que había era un **`sushi` hardcodeado** — no un genérico, sino
  decir que el restaurante es japonés sin que nadie lo dijera.
- **Un defecto que estaba en siete pantallas**, encontrado forzando el vacío de
  Avisos: el ícono del estado vacío quedaba pegado a la izquierda con la frase
  centrada debajo. `.empty` centra con `text-align`, que sólo alcanza al
  contenido en línea, y adentro va un `<svg>` desde hace rato.

## 0.40.0 — ORDEN VISUAL · Escanear, y §1.7 frenada con dos motivos (2026-08-05)

**`SPEC_APP.md` §1.6 aplicada entera y verificada.** §1.7 Compartir **no entra**:
está frenada por dos cosas que no se deciden desde este repo, detalladas abajo.

- **Escanear deja de ser una pantalla navy entera.** Se probó así —la idea era
  reforzar la metáfora de cámara— y Mati la rechazó: esqueleto estándar,
  cabecera navy curva de dos filas, tarjeta de título `--teal-l` y fondo claro,
  igual que Ticket y División. El marco oscuro pasa de ser **el fondo** a ser
  **una tarjeta flotante** con la sombra de la tarjeta montada. Estrena
  `Paso 1 de 5`: era el único paso del flujo sin contador.
- **La barra de cinco posiciones, con cámara y "Capturar" en el círculo.** El
  texto del nav item no es fijo en toda la app; lo fijo es el componente y su
  posición.
- **Los cuatro estados quedan separados y cada uno con su salida.** `scanFailed`
  era un booleano: la foto de más de 8 MB (`--warning`) y el OCR que no pudo
  leer (`--danger`) son estados distintos, y meterlos en el mismo cartel obligaba
  a elegir un copy que no era cierto para uno de los dos. **Siempre existe la
  salida manual**: "Cargarlo a mano" entra al Ticket en edición con una fila
  vacía, así que un OCR que falla no puede terminar el flujo.
- **El techo de 8 MB se mira antes de subir**, no después: con mala señal,
  mandar 12 MB para que el backend conteste 413 es un minuto perdido en la mesa.
  Sale de `MAX_TICKET_IMAGE_BYTES`, y un test nuevo lo **lee del espejo** de
  `routes/ocr.js` en vez de confiar en un número escrito de memoria — acreditado
  bajándolo a 4 MiB y viendo caer el test.
- **El barrido respeta `prefers-reduced-motion`**, que §1.6 pide explícito y
  hasta hoy no se cumplía. Los keyframes pasan a porcentajes: los 30px/270px
  estaban atados a la altura del marco viejo. Acreditado forzando la media
  query — `animation-name` pasa de `scan` a `none` y la línea queda en 150px,
  la mitad exacta del marco.
- **El "progreso real" del spec no se puede implementar y NO se simula.**
  `scanTicket` manda `FormData` por `httpRequest`, que es `fetch`, y `fetch` no
  expone progreso de subida; la única API que lo tiene es `XMLHttpRequest`, y
  cambiar el riel de red toca el mismo `httpRequest` de las rutas de dinero.
  Queda **G-29**, anotado **fuera** de la tabla de GAPS a propósito: es deuda de
  este repo, no algo que se le pida a App Backend. Mientras tanto la pantalla
  dice "Subiendo la foto…", sin porcentaje, con `aria-busy` y `aria-live`.
- **Un defecto encontrado mirando la pantalla a 375px**, no el diff: el cartel de
  "foto muy grande" y la nota amarilla del modo demo se leían como un solo
  bloque —mismo tinte, mismo borde, dos cosas distintas—. La nota pasa a teal
  para que en Escanear el amarillo signifique exactamente una cosa. De paso sube
  a 14px: era información a 12.5px, debajo del piso del sistema.

**Por qué §1.7 Compartir no entra.** Las dos son decisiones de otro, no
dificultades de implementación:

1. **El QR.** El spec pide un botón que despliegue el código QR del link. **No
   hay ningún generador de QR en el repo** y la única dependencia autorizada de
   este front es Stripe.js; escribir un codificador QR a mano —Reed-Solomon
   incluido— no es un renglón de una orden visual. Un QR decorativo que no
   decodifica al link sería peor que no tenerlo.
2. **La pestaña "Ya se sumaron"** no tiene dato: **G-30**. El contrato no expone
   quiénes están en una mesa, y en casi todo el resto eso es a propósito.

Sin esas dos, la pantalla se queda sin una de sus dos pestañas en burbuja y sin
uno de sus tres botones de compartir. Media pantalla no es la pantalla.

## 0.39.1 — las tres pantallas de §1.11 pasan a primer nivel (2026-08-05)

Autorizado tras el aviso previo sobre `src/App.tsx`. Deshace el rodeo con el que
las tres pantallas habían entrado en 0.39.0.

- **`#/tarjetas`, `#/pagos` y `#/estadisticas`** son ahora rutas propias, con su
  `PageId` y su `case`. Colgaban de `#/cuenta/<algo>` para no tocar `App.tsx`, y
  **evitar un archivo no es una razón de diseño**.
- **`home` sale de `showNav`**, que es el cambio real: Inicio monta su propia
  barra igual que `scan`, `mesa` y `avisos`. `BottomNav` deja de decidir cuándo
  no dibujarse y `CuentaScreen` deja de ser un sub-router.
- **Spec nuevo `inicio-accesos` (4 recorridos).** El switch de `App.tsx` no tiene
  `default`: borrar un `case` no rompía nada — la pantalla no se montaba y la app
  quedaba en blanco sin que ningún test se enterara. Acreditado mutando: borrar
  `case 'pagos'` mata el recorrido. Cubre también que Asociadas siga sin ningún
  acceso.
- **`RUTAS_LEGITIMAS` suma las tres.** `allowsWalletRoute` es una lista de
  **prohibidos**, así que toda ruta nueva nace permitida sin que nadie la mire;
  nombrarlas es la única forma de acreditar su permiso.
- Suite de rutas wallet verde tras tocar `App.tsx`: 126 tests. En navegador,
  `#/cargar` y `#/transferir` siguen terminando en `#/home`, sin una palabra del
  vocabulario del riel.
- La máquina de alta de tarjeta no se tocó: `addCard`, los helpers de
  `cardSetupAttempt` y `setDefault`/`removePm` son **byte a byte** los del
  checkpoint `1984710`.

## 0.39.0 — ORDEN VISUAL · Inicio y sus tres pestañas (2026-08-05)

**`SPEC_APP.md` §1.1 + §1.11 — son la misma pantalla**, así que van juntas: las
tres pestañas SON Inicio. Es la casa de la app y la que Mati más quiere ver.

- **La estructura pasa a la de §5 bis**: banda navy de borde curvo con el
  **nombre completo** —trunca con elipsis y nunca empuja la campana, verificado
  con un nombre largo—, las tres pestañas en burbuja **enganchadas** a la
  tarjeta montada, y la barra de cinco posiciones en lugar del flotante. La
  tarjeta va con la esquina cuadrada sólo cuando la pestaña activa es la
  primera; con la del medio o la última, el enganche se da por contacto.
- **La mesa va DEBAJO de los accesos**, no encabezando (decisión de Mati). Sus
  cuatro estados se forzaron uno por uno a 375px: mesa, vacío real sin borde,
  error de red con **Reintentar** y esqueleto con la silueta. El error antes se
  tragaba con un `.catch(() => undefined)` y la pantalla decía "No tenés mesas
  abiertas" cuando lo cierto era que no habíamos podido preguntar.
- **La pestaña LANZA, no muestra.** Cuenta abre `Ver tarjetas` y `Ver pagos`;
  Estadísticas, la frase de Mati y un solo acceso. Sin fondo propio y separados
  por una línea de `--border`. **Asociadas existe y no tiene interior**: hijos
  es Cuentas Junior y pareja es un instrumento de pago compartido — las dos son
  stop conditions del gobierno, y una pantalla que ya existe es mucho más
  difícil de discutir que una que todavía no.
- **Se cae el carrusel "(N)" y todo plural**: nunca hay más de UNA mesa abierta
  por usuario. Y se cae el banner de invitación, que ahora vive en Avisos.
- **Los DOS gates del riel de saldo viajan enteros y gateados.** Son dos, no
  uno, y al reescribir es fácil conservar el primero y llevarse el segundo por
  delante.
- **Las tres pantallas destino**, cada una en su commit: **Tarjetas** —con la
  máquina de alta MOVIDA a `CardsPanel`, no copiada: dos copias de eso es cómo
  nace una tarjeta duplicada—, **Pagos** —agrupado por mes con encabezado
  pegajoso, y `offset` que el emisor validaba y este front nunca mandaba, así
  que "Cargar más" no existía— y **Estadísticas**, que declara al pie lo que el
  contrato no tiene en vez de omitirlo.
- **El botón de abrir mesa pasó de "Nueva Mesa" a "Nueva"** y los e2e se
  actualizaron en el mismo commit, a propósito: era el renombre esperado, no una
  regresión. Estaba en tres puntos, no sólo en el helper compartido.
- **Acreditado mutando**: sacar la barra de la pantalla nueva mata 21 de los 24
  recorridos; sacarle el año a la clave del agrupado mata 2 de los 6 tests de
  `pagosView`. El verde no era de arrastre.
- **G-27 y G-28** en `GAPS.md`. El segundo es el grave: `GET /mesas/open` filtra
  por `opener_user_id`, así que quien se sumó por un link no tiene forma de
  volver a encontrar su mesa. Ninguno se cierra desde este repo.
- Deuda: `--fs-legacy-*` sin cambios netos · la Cuenta vieja queda como ruteo y
  como superficie de las pantallas que §1.9 todavía no convirtió.

## 0.38.1 — la salida de §1.2-C estaba muerta (2026-08-05)

Arreglo del defecto que 0.38.0 registró como encontrado y sin arreglar. **Aquella
entrada queda superseded en ese punto**, no equivocada: describía el estado al
cerrar la ORDEN 5, y el arreglo llegó con una orden propia inmediatamente
después.

- **Después de un canje exitoso, "Ver mis ítems" no hacía nada.** La persona
  quedaba encerrada en la pantalla de felicitación. Al cerrar el canje la
  custodia retira el token, así que la URL queda en `#/mesa/PA-XXXX` — que es
  **exactamente el destino del botón**, porque el link de invitación ES la ruta
  de la mesa. `navigate` asignaba ese mismo hash, y asignar el hash que ya está
  **no dispara `hashchange`**: el router no se enteraba, `Shell` no volvía a
  renderizar y `JoinMesaScreen` seguía montada.
- **No era un caso raro.** Es el camino normal de cualquiera que llega por
  WhatsApp. Y §1.2-C no muestra la barra inferior, así que ese círculo era el
  **único** control de la pantalla: la única salida era el Atrás del navegador o
  recargar.
- **`navigate` se conserva**, porque el destino no siempre coincide con la URL:
  `accept-link` devuelve `mesa_code` y **el emisor es la autoridad** sobre a qué
  mesa entraste, no el `:code` del link. Cuando no difieren, se le avisa al
  router que relea la URL — el mismo remedio que `replaceRoute` ya aplica en
  `router.ts`, no un mecanismo nuevo — y **sólo** si el hash no cambió, porque si
  cambió el navegador dispara el suyo.
- **Deliberadamente NO se tocó `navigate`.** Tiene la misma limitación para
  cualquier navegación a la ruta en la que ya estás, pero cambiarla afecta a
  todas las pantallas de la app: es otra orden. **La custodia del token tampoco
  se tocó** — está cerrada y con sus mutantes muertos.
- Sale el `test.fixme` del recorrido 3 y ese test lo acredita: llega a Mis ítems
  y la felicitación se desmonta. **Dos mutantes, los dos muertos**: revertir el
  aviso al router, y volver a llamar `navigate` directo.

## 0.38.0 — ORDEN 5 · Playwright, y las dos anclas cerradas (2026-08-05)

Entra un runner de navegador, **autorizado por Mati en orden propia**. No
reemplaza nada: los 479 tests de vitest siguen donde estaban. Playwright se suma
arriba, con carpeta propia (`e2e/`) y `test.include` en vitest para que cada
runner mire lo suyo.

- **Cuatro recorridos, y no más.** Los tests de navegador son lentos y frágiles:
  se usan para los caminos donde una falla significa que alguien con la tarjeta
  en la mano no puede terminar. Lo que se puede probar sin navegador se sigue
  probando sin navegador.
  1. **Atrás no revive el token** de un link terminal — cierra el ancla de 4B.
  2. **`#/cargar` y `#/transferir` no son alcanzables** — cierra el ancla de 4C.
  3. **El camino de pago completo**, que nunca se había recorrido entero.
  4. **El 403 de un link no delata si la mesa existe.**
- **Un solo proyecto, y es un teléfono** (390×844 con touch). Esta app se usa en
  la mesa de un restaurante. Queda anotado que **Safari es el navegador de más
  riesgo** —el link llega por WhatsApp y se abre en un WebView de iOS— y que esto
  **no lo cubre**: sólo se descargó Chromium.
- **Puerto 5176 con `strictPort`**, propio. El 5174 es `npm run dev` y el 5175 el
  riel de mock de otra sesión: no se le pisa la configuración corriendo a nadie,
  y si el puerto está ocupado **falla** en vez de correr contra otra cosa.

### 🔴 Un defecto encontrado, NO arreglado, esperando orden

**Después de un canje exitoso, "Ver mis ítems" no hace nada y la persona queda
encerrada en la pantalla de felicitación.** La custodia retira el token, la URL
queda en `#/mesa/PA-XXXX`, y el botón asigna **ese mismo hash**: asignarlo no
dispara `hashchange`, el router no se entera, no hay re-render y
`JoinMesaScreen` sigue montada. No es artefacto del test —es el camino normal
del link de WhatsApp— y §1.2-C no tiene barra inferior, así que la única salida
es el Atrás del navegador o recargar.

Queda como `test.fixme`: registrado en código, no en una nota. Es un cambio de
navegación sobre una pantalla del flujo de dinero y esta orden era escribir
recorridos, no cambiar comportamiento.

### Dos tests míos que los mutantes encontraron flojos

Lo registro porque el hallazgo no es el arreglo, es **cómo apareció**: los dos
recorridos estaban verdes y **acreditaban algo que no ejercitaban**.

- **El recorrido de 4B no probaba el arreglo de 4B.** Revertido el
  `stripTokenFromUrl()` del terminal, los cuatro tests seguían verdes. En un
  navegador de verdad `sessionStorage` **funciona**, así que la URL se limpia en
  la apertura y la línea que 4B agregó nunca corre. El defecto vive **sólo** en
  el estado degradado —storage que acepta la escritura y no persiste, que es
  justo el WebView donde se abre un link de WhatsApp—. Se agregaron dos casos que
  **rompen el storage dentro de Chromium**: el terminal limpiando la URL, y su
  complemento —que hasta el canje **no** la toque, porque perder el token deja a
  la persona registrada y afuera de la mesa—.
- **El recorrido del 403 no atrapaba una copy que filtra el motivo.** Dos causas
  que se tapaban: `getByText` coincide por **subcadena**, así que agregarle *"Este
  link venció."* adelante seguía matcheando; y la lista de motivos decía `vencid`
  y no atrapó `venció`. Ahora la copy se exige **exacta** —está ratificada palabra
  por palabra en §1.2-B justamente porque no puede variar según el motivo— y la
  lista pasó a **raíces**. El test de comparación entre una mesa que existe y una
  que no **no alcanzaba solo**: las dos pantallas cambian juntas.
- **Cinco mutantes finales, los cinco muertos**: revertir 4B (1 test), neutralizar
  `replaceRoute('home')` (5), filtrar el motivo en el body (3) y en el título (3),
  y volver reintentable el link incompleto (1).

### Método

Cero `waitForTimeout` — se espera a que algo **sea visible**, nunca a que pase el
tiempo. Selectores por rol y texto visible, nunca CSS: un `.tk-row` se renombra
en el próximo commit de diseño. Tests independientes, sin orden ni estado
compartido: cada uno abre su contexto y su mesa.

## 0.37.0 — ORDEN 4 · custodia del token y rutas del riel saldo (2026-08-05)

Dos defectos que tenían la misma forma: **una defensa declarada que nadie
comprobaba ejecutada**. En los dos casos el predicado era correcto, tenía sus
tests en verde, y no protegía nada porque el llamador no lo obedecía.

- **4B · el token terminal se soltaba de UNA de las DOS custodias.** El parte
  decía "la URL conserva el `?t=`"; el defecto era más grande. El token vive en
  `sessionStorage` **y** en la URL, y **no siempre en los dos**: cuando el
  round-trip del storage falla —modo privado, cuota, un WebView con storage
  particionado— `openInvitationCustody` deja el `?t=` en el hash **a propósito**,
  porque preferimos un token visible a un token perdido. En ese estado, un 400 o
  un 403 limpiaban un storage que nunca tuvo nada y no tocaban la URL: la
  credencial que el emisor **acaba de declarar inservible** seguía en la barra de
  direcciones y en el historial de un teléfono que se pasa alrededor de la mesa.
  - `stripTokenFromUrl` funcionaba perfecto y tenía **todos sus tests verdes con
    el defecto adentro**, porque el defecto nunca estuvo ahí: estaba en quién lo
    llama y cuándo.
  - La secuencia sale del `useEffect` a **`invitationCustody.ts`**. Sin librería
    de render un efecto no se ejecuta en la suite, así que mientras el "cuándo"
    viviera adentro era justo lo que no se podía testear.
  - La decisión terminal y su ejecución quedan en **la misma función**: no se
    puede agregar un estado terminal nuevo sin pasar por el mismo `if`.
  - 39 tests: las siete filas de la matriz × storage funcional, storage que
    **lanza** y storage que acepta la escritura y **no persiste**.
- **4C · la redirección de `#/cargar` y `#/transferir`.** El único test decía
  `allowsWalletRoute(false,'cargar') === false` —"la ruta está prohibida"—, y eso
  sigue siendo cierto aunque nadie redirija. **Borrar `replaceRoute('home')`
  dejaba la suite entera en verde.**
  - La llamada sale a **`walletRouteGuard.ts`**, por la misma razón que 4B. Su
    firma es `(walletRailEnabled, page)` y nada más: **no hay por dónde inyectar
    un permiso** por cuenta, rol o restaurante.
  - 58 tests sobre la cadena completa: payload real de `GET /api/config` →
    `readWalletRail` → decisión → `replaceRoute` → historial → hash, para las
    **siete** formas del riel apagado (falsa, ausente, cuatro malformadas y
    permiso por principal) × las dos rutas, más `pending`.
  - Se monta el **árbol real** con `renderToStaticMarkup` —ya es dependencia, no
    agrega ninguna—: `TopupScreen` y `TransferScreen` no se montan y `fetch` no
    se llama nunca. Con **dos controles positivos**, porque la ausencia de una
    palabra no distingue "el gate funciona" de "acá no se renderiza nada".
  - Las siete formas conservan tarjetas e historial propio: nada card-only queda
    gateado por wallet. Es el error de `07f0ba2` escrito como test.
- **Catorce mutantes sobre el estado commiteado, en worktree aparte. Los catorce
  mueren.** Incluidos los dos que la orden nombró: el defecto original de 4B (9
  tests) y neutralizar `replaceRoute('home')` (23 tests).
- **Anclas declaradas, no dadas por probadas.**
  - El botón **Atrás real** y la **recarga real** necesitan navegador. Su test no
    simula nada: verifica que no hay runner de navegador en `package.json`, así
    que **se pone rojo solo** cuando entre Playwright y obliga a volver.
  - `VITE_MOCK=1 npx vitest run` **está roja desde antes de esta orden** (34
    tests en 8 archivos sobre `4b490ca`, sin cambios míos): la suite está escrita
    contra el adaptador real. Así que "corrida en los dos modos" **no es
    evidencia disponible** y no se invoca. Lo que sí está verde en mock es el
    build. La independencia del modo se acredita distinto: `IS_MOCK`, `VITE_MOCK`
    e `import.meta.env` no aparecen en el **código** de ninguno de los tres
    módulos que deciden esto.
- Wallet sigue **durmiente y sin borrar**: `TopupScreen`, `TransferScreen`, los
  métodos de la fachada y los decoders siguen en el árbol. Lo único que se probó
  es **quién decide** si se pueden alcanzar, y sigue siendo el backend.

## 0.36.0 — ORDEN VISUAL · Ticket (2026-08-05)

- **`SPEC_APP.md` §1.3 · Ticket.** El pendiente que 0.35.0 dejó elevado —si el
  celeste de la tarjeta de título era el estándar o una excepción de División—
  **ya estaba resuelto en el spec** cuando se escribió esa entrada: el archivo
  se editó a las 20:28, diez minutos después del commit de División, y dice que
  `--teal-l` es el estándar de toda tarjeta de título y que *"Ticket se corrige
  para pasar a `--teal-l`"*. La entrada anterior quedó vencida, no equivocada.
  - Cabecera de flujo y tarjeta de título `--teal-l`. Acá la tarjeta **sí lleva
    contenido debajo del título** —total y observación— separado por la misma
    línea que separa la lista. Es una sola tarjeta.
  - **La lista deja de ser una grilla de inputs**: cantidad · nombre · precio
    tabular, texto limpio, sin un recuadro a la vista. Los controles aparecen
    recién en modo edición. Se va el copy con el conteo de consumos.
  - **"Modificar ítems" en dos estados**, con lápiz por fila y Eliminar en
    `--danger`. La fila expandida edita nombre, precio y cantidad, no sólo el
    monto como dice el spec: un consumo agregado nace vacío y sin nombre no se
    completa nunca. **Desvío consultado con Mati.**
  - **El chequeo del total dejó de ser vacuo.** El spec pide avisar cuando la
    suma de las filas no coincide con el total del ticket, pero el total en
    pantalla **era** la suma —`runScan` descartaba `total_cents`—, así que no
    podía discrepar de sí mismo. Ahora se conserva el total impreso y se
    contrasta. **No viaja al backend**: lo que se manda sigue siendo la suma de
    lo que la persona vio y editó, porque la garantía retiene ese monto.
  - Barra de cinco posiciones con "Continuar", sin ítem activo, y el motivo de
    invalidez en su fila propia en vez de flotando a `bottom: 78px`.
  - Área táctil del stepper de 22×22 a 44×44: estaba en la mitad del mínimo.
- **Tres defectos que aparecieron al verificar y no eran de esta pantalla:**
  - `.has-appbar .scroll` **no tenía efecto** — un `style={{ padding }}` inline
    le ganaba al `padding-bottom` de la clase y la separación con la barra era
    cero. **División arrastraba lo mismo** y no se veía porque su contenido es
    corto. Las dos pasan a `.flow-scroll`, en longhands.
  - `scrollIntoView` daba por visible una fila tapada por la barra fija:
    corregido con `scroll-margin-bottom`.
  - `.tk-name.empty` chocaba con `.empty`, el estado vacío global, y heredaba
    sus `padding: 36px 24px` — 121px de fila en vez de 53. Renombrada.
- **Contraste nuevo medido**: `--warning` sobre `--teal-l` da **4.77:1** — pasa
  AA, pero con menos margen que el par que el sistema tenía medido (5.10 sobre
  `--warning-tint`). Fijado en `designTokens.test.ts` y comprobado por mutación.
- **No se implementa "ítem no reconocido"**: el spec lo deja pendiente de ver en
  pantalla y `OcrResponse` no trae ningún campo por ítem del que pudiera salir.
- Verificado a 375px en mock. La discrepancia de totales **no es alcanzable en
  mock por sí sola** —el adaptador calcula `total_cents` con un reduce sobre los
  mismos ítems—, así que se forzó editando un precio, en las dos direcciones, y
  se restauró comprobando el regreso al estado informativo.
- Deuda, medida con `git grep -o` sobre `src/` (el método que reconcilia con las
  entradas anteriores): bloques `style={{…}}` 368 → **347** · `--fs-legacy-*`
  99 → **86**. Ojo con el segundo: la entrada de 0.35.0 cerró en 111, y la caída
  de 111 a 99 es del commit `cf235df` de la ORDEN 4B, no de acá.

## 0.35.0 — ORDEN VISUAL · División (2026-08-05)

- **`SPEC_APP.md` §1.4 · División**, la primera pantalla del flujo de armar
  mesa que adopta el sistema.
  - **Cabecera de flujo, la tercera variante** (§1.3): dos filas en la banda
    navy — logo + `payme_id`, y debajo "Volver" con el contador de paso. Entra
    como `AppHeaderFlow` en el componente compartido porque §1.3–§1.6 la usan
    todas, no como markup suelto de esta pantalla.
  - Tarjeta de título `--teal-l` montada sobre la banda.
  - **La selección deja el naranja y pasa a teal**: dentro de una tarjeta el
    naranja ya no marca estado. Y no es sólo el borde — el radio se llena.
  - **El importe por persona sube a `--fs-h1` y se recalcula en vivo** con el
    stepper, anunciado con `aria-live`. Antes era una píldora de 13px al
    costado: es el dato que la persona está buscando y estaba en letra chica.
  - Barra de cinco posiciones con "Continuar" en el centro, sin ítem activo.
    Deja salir del flujo a mitad de camino, a propósito; verificado que en este
    paso no hay nada congelado todavía, así que irse no deja ninguna operación
    monetaria a medias.
  - Área táctil del stepper a 44×44 y el subtexto de las tarjetas de 12px a
    `--fs-sm` — era información por debajo del mínimo del sistema.
- **Ticket sigue sin tocarse**: §1.4 tiene un pendiente explícito —si el
  celeste de la tarjeta de título es el estándar o es específico de División—
  que termina en *"No tocar Ticket hasta confirmar"*. Elevado, sin respuesta
  todavía.
- **Inicio (§1.1) sigue frenado** por la pregunta abierta de §5: dónde va la
  invitación pendiente. El esqueleto nuevo no tiene lugar donde el banner de
  hoy entre sin romper el enganche entre la pestaña activa y la tarjeta, así
  que preservarlo obligaría a elegir por la puerta de atrás. Queda para la
  decisión de Mati.
- Deuda: `--fs-legacy-*` 112 → 111 · bloques `style={{…}}` 370 → 368.

## 0.34.0 — ORDEN VISUAL · entrada por link y Avisos (2026-08-05)

Paso 3 de la orden visual: las primeras pantallas que adoptan el sistema. Los
tokens y el esqueleto ya estaban (0.33.0); acá empiezan a usarse.

- **`SPEC_APP.md` §1.2 · entrada por link, las tres pantallas.** Es la primera
  que ve casi todo el mundo que llega por un link de WhatsApp, y la de mayor
  riesgo del spec. Esqueleto propio: banda compacta, burbuja angosta flotando
  en el medio exacto, bloque de acción abajo, sin barra inferior.
  - **401** con burbuja genérica *"Te invitaron a una mesa"*: no nombra el
    restaurante, porque para saber que el token es válido habría que
    preguntárselo al backend y el endpoint que lo diría sin sesión es el
    preview público que el cierre del pago sin cuenta prohíbe. Un link
    reenviado, además, le confirmaría a cualquiera dónde está comiendo otro.
    *"Crear cuenta gratis"* es el **cuarto uso permitido del naranja**, con el
    texto en navy (5.77:1).
  - **403** con un solo cartel para los cuatro motivos y salida por el círculo
    naranja. Copy textual del spec.
  - **"Sumate a la mesa"**, nueva: antes el canje navegaba derecho a la mesa.
    Tilde de 72px en `--success`, el nombre del restaurante sin el código, y un
    solo destino a un toque. Es el único momento con permiso de nombrar la
    mesa: el canje ya cerró y quien mira es un participante inscripto.
  - **La custodia del token no cambió.** Se sigue comprobando el round-trip
    antes de soltar la URL y la credencial se libera en el mismo punto que
    antes. Verificado en el navegador: tras el canje el hash queda sin `?t=`,
    el `sessionStorage` vacío, y Atrás no revive el token.
- **`SPEC_APP.md` §1.8 · Avisos.** El punto de "sin leer" pasa a `--action-2` y
  a la izquierda, acompañado del peso 700 — dos señales, no una. El leído deja
  de atenuarse con `opacity` sobre la fila entera, que arrastraba el texto por
  debajo del mínimo de contraste. Vacío real con la copy del spec y sin borde.
  Cabecera de subpantalla y barra de cinco posiciones sin ítem activo.
- **Contraste corregido de paso** (§3 lo habilita en cualquier pantalla, no es
  rediseño): el botón de aceptar invitación era naranja con texto blanco —
  2.84:1 y un uso del naranja fuera de los cuatro permitidos.
- **Tests**: `joinLinkStage` extrae a función pura qué pantalla se muestra, y
  fija la regla de privacidad —sin sesión no se ve **nada** de la mesa,
  cualquiera sea el resultado del canje— y que ninguna pantalla quede sin
  salida. `designTokens.test.ts` fija el cuarto uso del naranja contra el modo
  en que se rompería en silencio: un `color: #fff` "para que se vea más".
  381 tests (eran 370).
- **Deuda**: los usos de `--fs-legacy-*` bajan de 113 a 112 y los bloques
  `style={{…}}` de 378 a 370. Baja pantalla por pantalla, como manda el
  sistema.

## 0.33.0 — ORDEN VISUAL · tokens y esqueleto del sistema de diseño (2026-08-05)

Pasos 1 y 2 de la orden visual. **Ninguna pantalla cambió todavía**: entra el
vocabulario y entra el esqueleto, y las pantallas los adoptan de a una.

- **Los tokens de `SISTEMA_DISENO.md` §1–§3 viven en `global.css`**: color
  (marca, acción, superficie, texto, semánticos con su tinte propio), la escala
  tipográfica de seis tamaños con line-heights, la mono, espaciado base 4, tres
  radios, tres elevaciones y el área táctil mínima.
- **Hubo que liberar el namespace antes.** La escala del sistema reusa
  `--fs-sm` y `--fs-xs` con **otros** valores (12.5→14 y 11.5→12). Definirla sin
  más habría movido 44 usos de tamaño en silencio, que es justo lo que el paso 1
  prohíbe. La escala vieja pasó a `--fs-legacy-*` en un rename mecánico: mismo
  valor, otro nombre, cero pixel movido. Quedan **100 usos** de deuda contada.
- **`designTokens.test.ts` re-mide los contrastes**, que es lo que el sistema
  exige cada vez que se toca un hex — aritmética WCAG pura sobre el CSS leído
  como texto, sin jsdom ni librería de render. Fija también las prohibiciones:
  blanco sobre `--brand` (2.84), `--brand` como texto (2.6) y el teal como texto
  (2.19) siguen reprobando, que es por qué existen `--brand-fg`, `--brand-ink`
  y `--link`.
- **Discrepancia encontrada al automatizar la medición:** `--text` sobre `--bg`
  da **15.21:1**, no 15.4 como declara `SISTEMA_DISENO.md` en dos lugares.
  Tampoco corresponde a las otras dos superficies (16.36 y 15.64), así que no es
  un fondo confundido. Sin consecuencia de accesibilidad —el mínimo AA es 4.5—
  pero el documento dice que todo ratio está medido. Se fija el valor real; el
  documento es de la conversación de Diseño y no se edita desde este repo.
- **Los tres componentes de estructura de §5 bis**, sin call sites: cabecera
  navy de borde curvo (primer nivel, subpantalla y la compacta de la entrada por
  link), pestañas en burbuja fusionadas a la tarjeta, y la barra inferior de
  cinco posiciones con centro configurable — `+` Nueva, `→` Continuar o cámara
  y "Capturar" según la pantalla, porque lo fijo es el componente y su posición,
  no el texto.
- `test.css` habilitado en `vite.config.ts`: vitest reemplaza todo módulo CSS
  por un stub vacío por default y el import `?raw` llegaba como `""`. Se usó
  `?raw` y no `node:fs` para no incorporar `@types/node` — dependencia nueva,
  prohibida sin OK previo de Mati.

## 0.32.0 — ORDEN 3A · custodia del token, rutas del riel y espejo (2026-08-04)

- **El espejo estaba mal contado, y el número era lo de menos.** El comando de
  enumeración usaba `grep -v README.md` **sin anclar**, así que descartaba en
  silencio `legal/README.md` — un archivo espejado con fuente real que **nunca
  se verificó**. Inventario correcto: **70 archivos**. Ahora lo fija un test.
- **Back revivía el token de invitación.** `navigate` asigna el hash y crea una
  entrada, dejando viva la anterior con el `?t=`. Se retira con `replaceState`,
  preservando el resto de los parámetros (`r` del QR).
- **Orden de custodia:** guardar → comprobar round-trip → recién ahí soltar la
  URL. Si el round-trip falla, la URL no se toca: preferimos un token visible a
  un token perdido.
- **Un shape inválido devolvía `null` y dejaba la fila.** Ahora toda salida sin
  dato borra la credencial físicamente.
- **El 400 dejó de ser "problema de conexión".** Es terminal, con copy
  accionable, y no invita a reintentos engañosos.
- **`#/cargar` y `#/transferir` ya no muestran copy:** redirigen a superficie
  neutra sin dejar entrada en el historial, en los cuatro estados apagados de la
  capability y en real y mock.
- **Tres afirmaciones vencidas corregidas**, una mía y grave: leer la capability
  **no** apagaba el riel — publicar hace autoritativa la declaración, no la
  ejecución. El gate de dinero lo puso el backend en v2.33.0.

## 0.31.0 — Cierre del pago sin cuenta, espejado (2026-08-04)

Espejo del backend v2.32.0. El token de `?t=` deja de ser **autorización** y
pasa a ser **credencial**.

- **El link ya no lleva a la mesa: lleva al canje.** `App` montaba `MesaScreen`
  en modo invitado con el token de la URL, y con eso se veía la mesa, se tomaban
  ítems y se **pagaba sin cuenta**. Ahora lleva a `JoinMesaScreen`.
- **Quien no tiene cuenta no ve nada de la mesa** — ni restaurante, ni total, ni
  cuánta gente hay. Ve el alta, con un banner que explica por qué.
- **El token sobrevive al alta.** Se guarda en `sessionStorage` con el código de
  su mesa; la URL sigue siendo la fuente primaria y esto cubre el tramo del
  registro. Perderlo dejaría a la persona registrada y **afuera** de la mesa a
  la que la invitaron, que es peor que el defecto que se cierra.
- **Se suelta al canjear y también ante un 403** — un token muerto que
  sobreviviera capturaría esa mesa en cada visita.
- **Un solo mensaje para los cuatro motivos de rechazo.** El emisor no
  distingue inválido de vencido de cancelado de supersedido, a propósito: sería
  decirle a un desconocido si una mesa existe. Un test barre todos los mensajes
  contra un conjunto de palabras delatoras.
- **El 503 no es un rechazo.** Es "no pudimos verificar", y es reintentable.
  Fundirlo con el 403 diría que una invitación está muerta cuando el backend
  sólo está a media configuración.
- **Nada se borra:** `httpGuestRequest`, los parámetros `guestToken` de la
  fachada y las ramas `isGuest` de `MesaScreen` quedan durmientes e intactos,
  igual que `guestOrAuth` del otro lado.
- El mock replica la **ceguera** del emisor y modela los tokens emitidos, así
  que el 403 es verificable a mano y no acepta cualquier string.
- `contract-mirror` refrescado a v2.32.0 (68 archivos; `utils/tokens.js` nuevo).

## 0.30.1 — Barrido adversarial sobre 0.30.0 (2026-08-04)

- **El caso de control estaba roto y lo rompí yo en 0.30.0.** `HomeScreen` y
  `CuentaScreen` pedían saldo y movimientos dentro de un `useEffect(..., [])`.
  Eso servía cuando el riel era una constante; ahora la capability llega
  DESPUÉS del primer render, cuando vale `false` por fail-closed, y el efecto no
  se vuelve a ejecutar. Con el backend declarando `enabled: true`, la tarjeta de
  saldo se renderizaba con el monto en "…" **para siempre** y "Últimos
  movimientos" no aparecía nunca. Arreglado con un efecto por capability, cada
  uno con su dependencia y separados entre sí.
- **Mi verificación en navegador de 0.30.0 no podía verlo:** di el control por
  bueno viendo APARECER la tarjeta, y la tarjeta aparecía vacía — el monto está
  enmascarado por diseño y se ve igual cargado que sin cargar. Hizo falta el
  ojito.
- **Barrido estructural nuevo:** falla nombrando archivo y capability si un
  `useEffect` lee una y no la declara en sus dependencias. Con guardarraíl
  contra pasar en vacío y con su límite declarado dentro del test.
- **El barrido de (d) tenía un agujero, y lo tenía el barrido:** detectaba una
  supresión sólo si el archivo nombraba los tipos, así que una escrita
  importando `WALLET_NOTIFICATION_TYPES` —la forma más natural— pasaba limpia.
  Ahora también se marca esa vía.
- No es defecto de dinero: son GET de lectura, y con el riel apagado —el estado
  vigente— nada de esto se ejecuta.

## 0.30.0 — El apagado del wallet deja de ser decisión del front (2026-08-04)

- **OLA 5D · el riel saldo lo declara apagado el BACKEND, y este front lo lee.**
  Hasta acá `WALLET_RAIL_ENABLED` era una constante propia: wallet estaba
  apagado porque el front decidió apagarlo, no porque el sistema lo declarara
  apagado, y un deploy de este front con otro valor lo reencendía sin que el
  backend se enterara. Desde App Backend v2.31.0 `GET /api/config` publica
  `features.wallet_rail`, y `src/api/walletRail.ts` la consume.
- **La constante se eliminó, no se conservó apuntando al nuevo estado.**
  Mientras existiera, alguien podía leerla en vez de leer la capability. El
  typecheck marcó los ocho consumidores uno por uno.
- **Fail-closed, en direcciones distintas para cada campo.** `enabled` falla a
  `false`: capability ausente, mal formada o red caída → riel APAGADO, y el
  estado inicial ya es apagado, así que no hay ventana en la que la UI de saldo
  aparezca mientras la respuesta viaja. `account_activity` falla a `true`:
  historial y estadísticas propias leen `payment_attempts`, son card-only
  ratificado, y esconderlas por un fallo de red repetiría `07f0ba2`. Son dos
  parámetros distintos de `accountRailView`, no uno derivado del otro.
- **Conjunto CERRADO de claves del lado del consumidor.** Un backend distinto
  del espejado no es una hipótesis: es el caso normal de un deploy
  desincronizado. Una clave de más apaga el riel; si tiene forma de permiso por
  principal (`enabled_for_user`, `per_branch`, `sucursal_override`) además se
  denuncia, porque la ratificación prohíbe ese permiso.
- **El mock respeta la capability, no la ignora**: `mockGetConfig` publica el
  mismo shape y recorre el mismo lector. Un test lee el espejo como texto y
  falla si los valores del mock se separan de los del emisor.
- **Nada se borró.** `TopupScreen`, `TransferScreen`, los ocho métodos del riel
  y `payment_type: 'wallet'` siguen durmientes: verificado en el navegador
  poniendo `enabled: true` en el mock, con la UI de saldo y `#/cargar` volviendo
  completas.
- **La pestaña de Cuenta se DERIVA en vez de recordarse.** Se inicializaba desde
  un valor que ahora llega después del primer render; con
  `account_activity: false` quedaba en 'historial' con los dos paneles apagados.
- **(d) · los avisos del riel saldo se fueron POR EL EMISOR** (`5e210fd`), y este
  repo lo ACREDITA en vez de taparlo: la lista del mock se compara contra el
  espejo —tenía cuatro tipos y el emisor suprime cinco; faltaba `topup_failed`—
  y un barrido estructural falla si alguien agrega un filtro de red por esos
  tipos. `AvisosScreen` sigue sin gate: el backend dejó de crear filas nuevas,
  no borró las viejas, y esconderlas ocultaría un hecho real. `tip_received` no
  se suprime, ni allá ni acá.
- `contract-mirror/` refrescado por copia a
  `db48cf69422fb0edbeb633e883c14405174a549b` (v2.31.0): 67/67 byte-idénticos,
  con sólo dos archivos cambiados respecto del refresh anterior. Esto no
  acredita publicación externa.
- **Límite declarado:** desde este repo no se puede acreditar el emisor
  corriendo. El end-to-end real contra el backend vivo sigue faltando.

## 0.29.5 — Cierre local de auditoría y espejo v2.28.8 (2026-08-03)

- Las mutaciones distinguen rechazos definitivos de resultados ambiguos: sólo
  conflictos idempotentes/concurrentes, 408/425/429 y 5xx conservan el intento
  para replay; un 400 de validación no queda congelado como si fuera red.
- El alta de tarjeta conserva en `sessionStorage` únicamente key, etapa y
  referencia `pm_`, ligadas al principal y con limpieza CAS. Nunca persiste el
  `client_secret`; un registro corrupto o storage no durable falla cerrado.
- SetupIntent, attach de tarjeta e invitaciones validan su shape en runtime:
  un 2xx malformado no se convierte en éxito. El mock replica la autoridad e
  idempotencia relevantes y el portapapeles sólo informa éxito comprobado.
- Un replay de invitación vencida se modela como terminal: no se copia ni se
  marca al amigo como invitado, y la key anterior se libera para un intento
  fresco. Link, código de mesa y token también quedan ligados en runtime.
- El alta de tarjeta captura principal+familia: una respuesta tardía de la
  sesión A no puede persistir, adjuntar ni limpiar referencias bajo la sesión B.
  La transición setup→attach también usa CAS por key: K1 no resucita sobre K2.
- La creación de mesa bloquea un nuevo intento si existe evidencia local
  ambigua anterior, antes de tokenizar otra tarjeta.
- El límite previo de OCR se alineó con el receptor auditado: más de 8 MiB se
  rechaza antes de red, en lugar de ofrecer 10 MiB que el backend nunca acepta.
- El lock actualiza PostCSS de 8.5.19 a 8.5.25 mediante el fix compatible del
  audit; no se fuerza el salto mayor Vite 5→8 requerido por los dos hallazgos
  restantes de toolchain de desarrollo.
- `contract-mirror/` fue refrescado por copia: 67/67 archivos byte-idénticos
  contra App Backend
  `e8a3faf2f520b249cbe6001f14ef70230a405695` (v2.28.8), con procedencia y
  bloqueos vigentes documentados. Esto no acredita publicación externa.
- Baseline ratificado: wallet durmiente post-auditoría (no borrado) y
  Apple/Google Pay como MUST de primer pago mediante hoja nativa, sin prerequisito
  de tarjeta guardada. El candidato permanece **NO-GO de release/piloto** por
  los seis bloqueos de backend y los gates de wallet, hojas nativas, PQ-2 y
  G-24 listados al inicio de `GAPS.md`.

## 0.29.4 — Familia de sesión y refresh fail-closed (2026-08-02)

- Login/registro crean una familia y principal opacos; refresh conserva ambos y
  usa compare-and-swap antes de guardar o limpiar una sesión.
- Los retries autenticados abortan si la familia cambia. La rotación exige Web
  Locks y falla cerrada cuando no existe exclusión acreditable.

## 0.29.3 — Clasificación B-06 y checks locales (2026-08-02)

- Los rechazos definitivos del contrato rotan aunque lleguen como 409; solo
  `idempotency_conflict` y 429 conservan el intento. `refunded` no rota.
- Se incorporó Vitest 3.2.7, checks de clasificación B-06/hash seguro y CI
  ejecuta tests antes de typecheck/build.

## 0.29.2 — Link de invitado aislado de la sesión (2026-08-02)

- Un link `#/mesa/:code?t=…` ahora conserva siempre la identidad invitada,
  incluso si el navegador tiene una sesión PayMe activa. El token se envía por
  el canal guest del contrato y no se mezcla con Authorization.

## 0.29.1 — Recuperación segura de reintentos y runtime (2026-08-02)

- B-06: un `409 idempotency_key_terminal` ahora rota y descongela el intento
  muerto; `idempotency_conflict` conserva su tratamiento seguro.
- La identidad idempotente y el payload pendiente cuentan con fallback en
  memoria cuando `sessionStorage` está bloqueado, sin convertir la evidencia
  `claimed_by_me` en un guard de casillero único.
- Refresh rotativo single-flight, OCR multipart a través del cliente
  autenticado con timeout/refresh, y hash mal codificado que degrada a home en
  lugar de tumbar la aplicación.

## 0.29.0 — Apple/Google Pay solo donde funcionan (2026-07-25)

Decisión de Mati (2026-07-25): **se ocultan en la app real**, se mantienen en el
build demo. Los botones existían desde el principio pero contra el backend real
devuelven **400**: no hay integración con la Payment Request API de Stripe y el
schema de pago exige un `stripe_payment_method_id` que esos botones no producen.
En la demo funcionan porque el front manda un `pm_` de utilería.

- **`WALLET_PAY_ENABLED`** en `src/api/index.ts`, junto a `IS_MOCK`/`IS_DEMO`:
  `IS_MOCK || VITE_WALLET_PAY === '1'`. El **default es el estado verdadero** —
  encendido en la demo, apagado en cualquier build real — así el build `/live/`
  los oculta solo, sin depender de que alguien setee una variable en un job
  nuevo. **No hubo que tocar el workflow de despliegue.**
- **Nada borrado**: el `PaymentType`, la etiqueta del comprobante (`Ⓖ Google
  Pay`) y el bloque `pm_mock_walletpay` quedan intactos. Verificado en el
  bundle: en el build real Vite **elimina los dos botones** por rama muerta y
  la etiqueta del comprobante sobrevive; en el de demo están los dos.
  Reactivarlos el día que se implementen es cambiar un default.
- **El copy del invitado cuelga del mismo flag**: decía "Sin iniciar sesión
  pagás con tarjeta **o Apple Pay**" — con los botones ocultos habría afirmado
  un método que no está en pantalla.
- **G-12 anotado**: `features.apple_pay`/`google_pay` de `GET /api/config`
  están **hardcodeados en `true`** (a diferencia de `stp_dispersal`/`ocr_real`,
  que leen entorno), o sea que el backend afirma una capacidad que no cumple.
  Se pide que pasen a leer entorno, pero **como seguimiento post-27/07**: no es
  un flip de variable, es release + deploy del backend que mueve dinero, y el
  ocultamiento ya está resuelto sin ellos. Por eso el front NO gatea por ese
  campo: sería depender de un dato muerto (ese route se auto-declara `2.5.2`
  con el backend en v2.26.0) y además llegaría tarde, haciendo parpadear los
  botones.
- **Runbook T7**: fila nueva para Apple/Google Pay, con la nota de que probarlos
  de verdad exige iPhone/Safari y Android/Chrome.

Revisión adversaria de 33 agentes sobre el plan: tumbó el diseño original
—gatear por `features` de `/api/config` y pedirle al backend bajar el flag— con
la evidencia de que esos flags son literales en el código, no variables de
entorno.

## 0.28.0 — B-06: el reintento ya no cobra dos veces (contrato v2.25.0) (2026-07-25)

Cierra **B-06** del lado del front. El backend tenía la idempotencia bien
hecha; nosotros generábamos una `idempotency_key` NUEVA dentro de cada llamada,
así que nunca se ejercía: si se perdía la RESPUESTA de un pago ya cobrado, el
reintento cobraba de nuevo (en división igual se llevaba el casillero de otro
comensal; en consumo cobraba otra vez la misma fracción).

- **`src/api/idempotency.ts` (nuevo)**: la clave vive en `sessionStorage` —no
  en memoria: recargar la página entre el fallo y el reintento traía el bug
  entero de vuelta— y el `pm_` tokenizado viaja con ella, porque Stripe.js
  devuelve uno distinto por invocación y el backend lo hashea.
- **El scope se DERIVA DEL CONTENIDO** del pago, con los mismos campos que
  hashea `PAYLOAD_KEYS` del backend. Mismo pago = misma clave (aunque el
  usuario recargue o salga de la mesa y vuelva) → replay. Pago distinto = clave
  distinta, sin rotar nada. **No se rota "por efecto"**: un `useEffect` con
  deps corre también en el MONTAJE y borraba la clave justo cuando el usuario
  vuelve a mirar la mesa — que es lo que el propio mensaje de error le pide.
- **Intento CONGELADO ante error ambiguo** (5xx, red, timeout): se guarda el
  CUERPO exacto que salió y la pantalla bloquea propina, método y consumos. El
  único botón es "Reintentar el pago sin confirmar", que reenvía ese mismo
  cuerpo. Congelar solo la clave no alcanzaba: tras una recarga el estado
  arranca vacío y reconstruir el pedido daba 409 en bucle.
- **Definitivo vs ambiguo por STATUS, no por lista de códigos**: un 4xx es una
  decisión del backend (ya liberó lo tomado) → clave nueva; 5xx/red/timeout no
  dicen nada → se conserva. Excepciones: 409 `idempotency_conflict` (hay un
  intento vivo: rotar ahí ES el doble cobro) y 429.
- **`refunded` nunca rota solo**: el backend devuelve 200 con ese estado a
  propósito, y rotar sería re-cobrar un reembolso. Se avisa y volver a pagar
  queda como decisión explícita del usuario.
- **`claimed_by_me` (v2.25 §4.3) consumido**: en partes iguales la mesa ahora
  dice "Ya pagaste tu parte ✓" y el CTA pasa a "Pagar otra parte". No se
  bloquea —pagar más de una parte es legítimo (acta 2026-07-25)— pero deja de
  ser un accidente. También descongela solo el intento cuando aparece un
  casillero mío MÁS de los que había al congelar.
- **Abrir mesa (`POST /mesas`)**: el mismo tratamiento. Era el caso más caro —
  un reintento creaba una segunda mesa con una segunda garantía por el TOTAL.
  La clave se rota al quedar la garantía autorizada, no antes: durante el 3DS
  se conserva para poder reintentar sobre la MISMA mesa. Un rechazo del banco
  sí rota (no hay endpoint para re-garantizar, y si no quedaba en bucle).
- **Transferencias y carga de saldo**: misma política. La transferencia es
  irreversible y en OXXO un reintento emitía un SEGUNDO voucher válido (dos
  referencias vivas; si se pagaban las dos, se acreditaba el doble). Además el
  topup con tarjeta ahora mira `status` y `requires_action` antes de cantar
  "se acreditaron": el replay de un cobro fallido se anunciaba como éxito.
- **Timeout de 30s en `http.ts`** (incluido el pago del INVITADO): sin él, "se
  perdió la respuesta" era una pantalla colgada durante minutos — justo lo que
  empuja a reintentar a ciegas.
- **Mock fiel**: replica la idempotencia comparando el HASH del payload (misma
  clave + otro contenido = 409, como el backend) y la garantía WALLET, que
  volvía antes de guardarla y retenía el total otra vez en la demo.

Revisión adversaria de 34 agentes sobre el diff: 23 hallazgos confirmados,
todos aplicados. Los tres más graves los encontró ella, no yo — el efecto de
rotación que corría en el montaje, la clave de mesa que nunca se rotaba tras
el éxito, y el 3DS rechazado sin salida.

## 0.27.0 — Connect: 3DS sobre la cuenta conectada (contrato v2.24.0) (2026-07-25)

Consume el contrato de **direct charges** publicado (acta
`[PAYME]_ACTA_2026-07-24_PIVOTE_STRIPE_CONNECT_TARJETA.md`; verificado en el
repo hermano y en vivo). **El front queda listo para que el backend encienda
el pivote.**

- **`connected_account_id` (aditivo)**: cuando el PaymentIntent —o el hold de
  la garantía— vive en la cuenta del restaurante, Stripe.js se inicializa con
  `{ stripeAccount }` para poder confirmar el 3DS. Sin el campo, es cargo de
  plataforma y todo funciona como siempre; **las dos formas conviven**
  restaurante por restaurante, que es justo lo que el pivote necesita.
- **`stripe.ts`**: una instancia de Stripe.js **por cuenta** (Map cacheado;
  antes era una sola) + la config de `/api/config` cacheada aparte, con
  invalidación si falla la red. `createCardPaymentMethod` y `confirmCardSetup`
  siguen SIEMPRE en plataforma: el backend clona el `pm_` a la cuenta
  (`clonePaymentMethodToAccount`) y las tarjetas guardadas son bóveda de
  PayMe. Verificado leyendo el backend, no asumido.
- **Los dos caminos de 3DS lo pasan**: pago (`MesaScreen`) y garantía
  (`CreateMesaFlow` → `confirmGuarantee3ds`).
- **`save_payment_method` en riel directo**: el backend lo ignora a propósito.
  Como el front solo conoce el riel al recibir la respuesta, ahora **lo dice**
  ("esta vez la tarjeta no quedó guardada") en vez de dejar creer que se
  guardó. **G-11 anotado**: pedido de una señal PRE-pago para poder ocultar el
  checkbox.
- **Mock fiel a la semántica**: `MOCK_CONNECTED_ACCOUNTS` con **Hanzo Sushi
  conectado y La Parolaccia NO** — así el riel directo se prueba con el QR de
  Hanzo (`?r=…0002`) y la demo del video (La Parolaccia) queda idéntica. En el
  riel directo el mock tampoco guarda la tarjeta.
- Verificado en browser (mock), los dos rieles: **Hanzo** → comprobante
  "Cobrado por: Hanzo Sushi", aviso de tarjeta no guardada, la lista de
  tarjetas NO crece; **La Parolaccia** → sin aviso, sin "Cobrado por", y la
  tarjeta nueva SÍ queda guardada. Espejo refrescado a v2.24.0
  (+ `services/connect.js`).

**Fixes de la revisión adversaria del diff** (13 hallazgos confirmados; el
riel toca dinero, así que se revisó con 3 lentes + refutación):

- **El comprobante mentía en el riel de plataforma** (bug introducido en
  0.26.0): decía "Cobrado por: <restaurante>" en TODO pago con tarjeta.
  Ahora se afirma solo con `connected_account_id` presente — que es
  exactamente cuando es cierto. El caption pre-pago pasa a ser verdadero en
  ambos rieles ("Estás pagando tu parte en X — PayMe divide la cuenta"),
  porque antes de pagar el front no sabe el riel (G-11).
- **El REPLAY idempotente saltaba el 3DS**: ahí el backend devuelve la fila
  cruda (`stripe_client_secret`, sin `requires_action`). Se tolera ese shape
  y se deriva del `status`; sin esto, un replay en 3DS pintaba "pagado" con
  el cobro sin confirmar. **B-06 anotado** (la otra mitad: reusar la
  `idempotency_key` en el reintento — cambia el comportamiento de reintento
  de un pago, va a ratificación de Mati).
- **El aviso de garantía se disparaba ANTES del 3DS** ("Mesa garantizada ✓"
  con la mesa aún en `pending_auth`): ahora es una línea en la pantalla de
  compartir, que solo se alcanza con la retención autorizada. Mismo criterio
  en el pago: línea en el comprobante en vez de toast efímero (se pisaba con
  la animación de "Cobrando…").
- **Copy de la garantía neutral**: "Para abrir la mesa **se retiene** el
  total" — con Connect la retención puede vivir en la cuenta del restaurante,
  así que ya no se nombra a PayMe como quien retiene. Verdadero en ambos
  rieles y sin esperar decisión de producto.
- **Apple/Google Pay**: el `pm_` de utilería queda atado a `IS_MOCK`. Contra
  el backend real habría hecho fallar el clonado a la cuenta conectada
  (alarma `connect_pm_clone_failed`) degradando el pivote en silencio.

## 0.26.0 — Pivote a Stripe Connect: quién cobra (campo visible) (2026-07-24)

Ratificado por Mati. Con el pivote, en un pago de mesa con **tarjeta**
(incl. Apple/Google Pay) el merchant of record es el **RESTAURANTE**, no
PayMe. Cambio ACOTADO a lo que el usuario ve; el riel de saldo (wallet,
cargas, transferencias) sigue siendo de PayMe y no se tocó.

- **Comprobante en pantalla**: fila **"Cobrado por: <restaurante>"**, solo
  en pagos con tarjeta. Debajo, cuando el backend exponga el descriptor:
  "En tu resumen de tarjeta vas a ver <DESCRIPTOR>".
- **Comprobante enviar/descargar** (`receiptText`): mismas líneas, misma
  condición.
- **Antes de pagar**: caption bajo "Método" — "Te cobra <restaurante> —
  PayMe divide la cuenta" — para que se sepa ANTES, no solo en el recibo.
- **G-10 en GAPS.md**: el contrato (v2.21.0, verificado repo + vivo) NO
  expone `statement_descriptor`. Forma acordada:
  `attempt.statement_descriptor: string | null`. **Mock-first**: el mock lo
  deriva del nombre (mayúsculas, 22 chars); en real llega `undefined` y la
  UI degrada sin el sub-texto — el "Cobrado por" sale igual de
  `restaurant.name`, que sí es contrato.
- Verificado en mock: con tarjeta aparecen fila + descriptor; con **saldo**
  no aparece ni el caption ni la fila (ese riel no cambió).
- Anotado en G-10 como pendiente del pivote: si la **garantía** con tarjeta
  también pasa a ser del restaurante (hoy el copy dice "PayMe retiene el
  total") — y que el pivote todavía no tiene acta en `ops/actas/`.

## 0.25.0 — T-F1: primer feedback del hermano de Mati (2026-07-24)

Tier ratificado por Mati sobre la auditoría de diseño de su hermano.

- **Nav nueva**: Inicio · **Cuenta** · Amigos · Perfil. Cuenta pasa a ser
  pestaña (sin flecha atrás); Amigos y Grupos son UNA sección con tabs
  internas (`SocialTabs`) — la pestaña queda activa en ambas páginas y los
  deep links/backs se conservan (cada tab sigue siendo ruta).
- **Banner de invitación con botón "Aceptar"** a la derecha (antes el banner
  entero aceptaba al tocarlo); el contenedor ya no se "hunde" al tacto.
- **Invitar amigos de PayMe** (`InviteFriends`): buscador con typeahead
  (insensible a acentos — `fold` nuevo en utils, aplicado también al
  buscador de Amigos) + desplegable de grupos con "Invitar a todos". Usa el
  contrato EXISTENTE de invitaciones in-app (`POST /mesas/:code/invitations`
  type `in_app` por `payme_id`). Montado en el paso compartir Y en la mesa
  (desplegable, solo organizador con mesa invitable — el compartir es
  one-shot). Guard sincrónico anti doble-envío (el backend no dedupea),
  toasts que dicen la verdad (todo ok / parcial / todo falló / mesa ya no
  invitable, cortando el resto), y carga fallida con "Reintentar".
- **Torta de gastos por categoría** en Cuenta → Este mes: donut SVG propio
  (cero dependencias) desde `GET /account/history` pidiendo el MES COMPLETO
  (`from` + `limit=100` — sin eso el backend da solo la primera página de 20
  y los montos no cerrarían contra stats; el mock ahora replica la
  paginación real). Mes en UTC, espejando el `date_trunc` del server. G-09
  anotado como nice-to-have (agregado server-side para >100 pagos/mes).
- Fixes de la revisión adversaria (16 confirmados): además de lo anterior,
  `.btn-fit` reemplaza overrides inline sobre `.btn-sm`, `aria-current` en
  SocialTabs, seed del mock `payme_mx_leop` (el viejo `_leo` violaba el
  formato del contrato; con migración del estado persistido) y `has-cta`
  en el paso compartir (el CTA flotante tapaba la lista de amigos).
- 0.24.1 (hotfix previo, sin entrada propia): la bottom nav tapaba los CTA
  de Amigos y Grupos (feedback del hermano) — `.has-nav .action-bar` +
  clase `has-nav` que faltaba en la lista de Grupos.
- Anotado para juicio de Mati (sin codear): las filas "Saldo y tarjetas" y
  "Amigos" de Perfil ahora duplican pestañas visibles de la nav.

## 0.24.0 — G-01 + G-03: restaurante por QR y saldo disponible/retenido (contrato v2.21.0) (2026-07-24)

Consume los DOS últimos contratos pendientes (verificados en repo hermano y
en vivo). **GAPS.md queda EN CERO por primera vez desde T0.**

- **G-01 · Restaurante por QR**: el flujo de abrir mesa resuelve el
  restaurante contra `GET /restaurants/:id` — el id llega por el QR de la
  mesa (`?r=<uuid>`, query o hash) con `VITE_RESTAURANT_ID` como fallback de
  la demo. QR roto/suspendido → aviso naranja en el escaneo ANTES de armar
  nada. `VITE_RESTAURANT_NAME` retirado del deploy (el nombre ya no se
  hardcodea). Tipos `Restaurant`/`RestaurantResponse` (`address` nullable —
  verificado en vivo), `httpPublicRequest` (primera ruta pública),
  `QR_RESTAURANT_ID`, mock sobre `MOCK_RESTAURANTS` (el QR de Hanzo Sushi
  cambia el restaurante de la demo).
- **G-03 · Disponible/retenido**: `BalanceResponse` suma
  `held_balance_cents/_display` + `available_cents/_display`. La card de
  Cuenta pasa a **"Disponible $X"** con línea "🔒 Retenido en garantías: $Y"
  cuando hay hold; el ojito del Home y el "Disponible:" de Transferir usan
  `available_cents`. Mock replica la resta sobre su hold wallet.
- Verificado en mock (QR Hanzo en header · QR inválido avisa · garantía
  wallet $60 → Disponible $235 + Retenido $60) y en vivo (200/404/404-
  malformado/búsqueda `?q=` · balance con los 6 campos). Espejo a v2.21.0
  (`routes/restaurants.js` NUEVO, `routes/account.js`, `schemas/index.js`).

## 0.23.0 — G-02: perfil propio (contrato v2.20.0) (2026-07-24)

Consume el contrato de identidad publicado (verificado en repo hermano y en
vivo). Cierra G-02: tras un login real, el nombre es el REAL.

- **`GET /account/me`** en el facade (`getMe`), tipos `MeResponse` +
  `User.phone/created_at` (solo /me), y `TokenPair` separado de
  `LoginResponse` (el refresh devuelve solo tokens — decisión del plan G-02).
- **Login guarda `user`** (v2.20 lo devuelve, mismo shape que register) y las
  **sesiones persistidas pre-v2.20 se hidratan** una vez con `GET /account/me`
  al restaurar (AuthContext); si falla, se saluda sin nombre y el próximo
  login completa.
- **Borrado el paliativo del email**: `identity.ts` ya no deriva el nombre del
  local-part tipeado y `StoredSession` pierde el campo `email`.
- Mock: `mockGetMe` sobre el user vigente de la demo. Espejo refrescado a
  v2.20.0 (`routes/auth.js`, `routes/account.js`).
- Verificado: mock (sesión vieja sin `user` plantada a mano → hidrata y
  saluda "Hola, Mati!") y vivo (login con `user`, `/account/me` con
  `phone: null` + `created_at`, 401 sin token).

## 0.22.0 — T-D3: set de íconos SVG propio + escala tipográfica (2026-07-23)

Cierra el tier de diseño T-D3 ratificado por Mati: chau emojis como
iconografía de interfaz, escala de tamaños única.

- **`src/components/Icon.tsx` nuevo**: 40 glifos SVG dibujados a mano
  (grilla 24×24, trazo 1.75, `currentColor`, cero dependencias — regla dura
  del repo). Tipado estricto: un nombre inexistente no compila.
- **~110 emojis de UI migrados a `<Icon>`** en las 12 pantallas +
  BottomNav: navegación, saldo/ojito, métodos de pago, estados vacíos,
  categorías de restaurante (pasta/sushi/taco/café), avisos, comprobante,
  scan (el recibo del encuadre ahora es visible: el emoji traía su color,
  el SVG hereda), countdowns, candados y compartir.
- **Movimientos de wallet con glifo semántico** (`walletTxIcon` reemplaza a
  `walletTxEmoji` en utils/labels.ts): flechas entrante/saliente para
  transferencias, tiendita OXXO, banco SPEI, plato para pagos de mesa,
  billete para propinas, +/− para ajustes.
- **Escala tipográfica en tokens** `--fs-2xs`…`--fs-hero` (10 tamaños):
  ~85 `fontSize` inline sueltos convertidos; quedan solo los derivados
  (avatar) y el 16px del CardField (regla anti-zoom de iOS, intocable).
- **Se conservan a propósito**: ✓ ✕ − ＋ → ÷ tipográficos, los íconos de
  grupo elegidos por el usuario (contenido, no interfaz), el chip
  VISA/Mastercard y la G de Google Pay.
- Verificación visual completa en mock (home, flujo mesa entero hasta
  comprobante, cuenta, perfil, avisos); typecheck y build verdes.

## 0.21.0 — Fracciones de platos compartidos (contrato v2.18.1) (2026-07-23)

Consume el contrato fraccional publicado (verificado en repo hermano y vivo;
acta de fracciones del 2026-07-23). Cierra G-08 y G-07.

- **Selector de fracción EN LA MISMA LÍNEA del ítem** (UX ratificada): al
  marcar un consumo aparecen las pills `1 · ½ · ⅓ · ¼` (solo las que entran
  en lo que queda), el precio de la fila muestra TU fracción y los ítems
  parcialmente tomados dicen "queda ½". Bloqueado solo cuando no queda nada.
- **Lock y pago fraccionales**: `items: [{item_id, fraction_bps}]` en
  lock/pay (consumo); en partes iguales siguen los `item_ids` informativos
  (que v2.18.1 ahora SÍ persiste — G-07 resuelto). Manejo del
  `409 fraction_not_available` con el `remaining_bps` en el aviso.
- **Preview con la réplica exacta** (`fractionAmount` en utils/money.ts,
  procedencia utils/money.js del backend); la fracción COMPLETADORA la ajusta
  el server y el comprobante usa los montos del attempt (recibo
  `attempt.items`).
- **Mock espejando services/itemClaims.js**: claims por ítem, effectiveBps
  (tolerancia <100 bps absorbe), priceFraction (la completadora cierra
  exacto), re-reclamo reemplaza, `paid` solo al 100%, migración del estado
  persistido. Verificado: ½+½ de $195 = 97.50+97.50 y "ya pagado" recién al
  cierre.
- **E2E real contra v2.18.1**: ⅓+⅓+⅓ de $70.00 = 23.33+23.33+**23.34**
  (absorción exacta), ítem `paid`. **B-05 nuevo en GAPS.md**: el re-lock
  inmediato del mismo dueño libera claims de un pago exitoso con webhook
  pendiente (corrompe `remaining_bps`) — reportar al backend; no bloquea el
  flujo real.
- **contract-mirror a v2.18.1**: schemas, mesas, webhooks, stateMachine,
  money y el servicio nuevo `services/itemClaims.js`.

## 0.20.0 — Batch 2 de Mati: unidades seleccionables + ticket en una línea (2026-07-23)

- **Cantidades EXPANDIDAS en unidades al crear la mesa**: "Tiramisú ×2" viaja
  como dos ítems de $70 (quantity 1) → cada unidad se elige/reserva por
  separado en los DOS modos de división. Resuelve "dejame seleccionar 1 o 2"
  sin cambio de contrato (el total no cambia; el backend ya acepta filas
  unitarias). El stepper de cantidad sigue en el ticket editable; la
  expansión ocurre al confirmar.
- **Ticket editable en UNA línea por consumo** (nombre · $precio · −n＋ · ✕):
  un listado de 10+ personas ya no se hace eterno.
- **Partes iguales**: fuera la sección "Partes de la mesa" (sin sentido para
  el comensal); queda la nota "N partes iguales de $X · quedan Y". La lista
  "¿Qué consumiste?" ahora muestra el PRECIO de cada producto.
- **G-08 nuevo en GAPS.md**: platos compartidos por fracciones (1/2, 1/3…)
  entre varios comensales — decisión de producto + contrato pendiente de
  acta con el backend (opciones presentadas a Mati con recomendación).

## 0.19.0 — Batch de feedback de Mati: 10 ajustes de UX (2026-07-23)

Directivas explícitas de Mati sobre capturas (2026-07-23):

- **Fuera "Cargar el ticket a mano"**: en el escaneo queda solo "Capturar"
  (revierte el camino manual de 0.18.0; el ticket editable se conserva).
- **Filas del ticket compactas**: menos aire entre consumos.
- **CTAs primarios de los flujos como píldora flotante naranja** (estilo del
  mock del hermano): ticket, división, garantía, compartir, "Pagar mi parte"
  y "Pagar $X" — siempre visibles, sin bajar hasta el fondo (`.cta-float`).
- **El cabezal SIEMPRE lleva el logo PayMe**: `TopBar` compartida (logo +
  título gris) y variante `inv` para los headers navy (scan, ticket, mesa).
- **Garantía sin la opción "Tarjeta" padre** (redundante): las tarjetas
  guardadas SON las opciones, + "Usar otra tarjeta" + Saldo PayMe.
- **Chip Mastercard real** (dos círculos en CSS puro, `CardBrandChip`
  compartido) en garantía, pago, Cuenta y Topup.
- **IMPORTANTÍSIMO — partes iguales con selección de consumo**: aunque el
  monto sea la parte fija, marcar QUÉ consumiste es obligatorio ("Marcá lo
  que consumiste", info para el restaurante). `item_ids` viaja SIEMPRE en el
  pay. **G-07 nuevo**: el backend hoy descarta esos ítems en la rama igual
  (`payment_attempt_items` solo se escribe en consumo) — llevar al dueño del
  contrato para que la info del modelo de negocio se persista.
- **Métodos de pago reordenados**: Saldo PayMe → Tarjeta con las guardadas en
  un DESGLOSABLE (resumen + ▾, no sueltas en la lista) → Apple Pay →
  **Google Pay (nuevo)**.
- **Comprobante con "Enviar" y "Descargar"** (Web Share / archivo de texto)
  para la contabilidad del comensal.

## 0.18.0 — D5 (front): revisá y corregí el ticket antes de dividir (2026-07-23)

Cierra la última decisión del roadmap D4–D7 del lado del front. Guardarraíl
del acta: si el total está mal, la división está mal. Sin cambios de contrato:
`POST /mesas` ya acepta los ítems que mande el cliente (validado: suma ==
total; probado en vivo con payloads arbitrarios en los e2e de D4/D7).

- **El paso "Ticket" es EDITABLE**: cada consumo tiene nombre, precio (pesos,
  teclado numérico), cantidad con stepper − n ＋ y botón quitar. "➕ Agregar
  consumo" suma filas (lo que el OCR se comió). El total del header se
  recalcula en vivo (centavos enteros, `stringToCents`) y ES el que viaja al
  backend.
- **"Continuar → dividir" se bloquea** con motivo visible si no hay consumos
  o si alguna fila está incompleta (sin nombre / precio en cero).
- **Camino manual**: link discreto "✍️ Cargar el ticket a mano" en la
  pantalla de escaneo (misma pantalla editable, vacía) + nota con la opción
  cuando la foto falla.
- Escanear sigue siendo el camino feliz de un toque; `?demo=1` intacto (el
  ticket de ejemplo llega editable pero "Continuar" sigue siendo un tap).
- Verificado en mock: editar precio (total $840→$895), borrar ítem y agregar
  "Postre ×2" ($875), fila inválida bloquea, manual → división parte del
  total corregido ($400 ÷ 4 = $100).

## 0.17.0 — D7: propina por comensal, base partes-iguales (2026-07-23)

Consume el contrato v2.17.0 publicado (verificado en repo hermano y en el
vivo). La propina deja de ser % de TUS consumos y pasa a ser % de tu parte
igualitaria (total ÷ N declarados al abrir); cada comensal deja SOLO la suya.

- **Picker nuevo en "Pagar mi parte"**: "Tu base: $X (la cuenta ÷ N)"
  (`tip_base_cents` del GET), pills 0/10/15/20 % + **"Otro"** con monto a
  mano. El % viaja como `tip_bps` (la cuenta la hace el SERVER); "Otro"
  manda `tip_cents`. Nunca ambos (excluyentes en el contrato). Invitados:
  mismo picker.
- **Preview con la fórmula EXACTA del server**: `tipFromBps` replicada
  literal en `src/utils/money.ts` (procedencia utils/money.js:107-112 del
  backend; paridad verificada ejecutando ambas sobre 441 vectores, 0
  diferencias). El comprobante usa el `tip_cents` que DEVUELVE el attempt
  (fuente de verdad) con fallback a la preview.
- "¿Para quién?" ahora se gatea con el tip efectivo (también aparece con
  monto a mano, no solo con %).
- **Mock espejando v2.17**: `tip_base_cents` en el detalle, `tip_bps`
  computado con la misma réplica, exclusividad 400, `tip_cents` en el
  attempt.
- **E2E real contra Railway v2.17**: base=7375 en GET ✓, ambos campos → 400
  ✓, `tip_bps=1500` → attempt.tip_cents=1106 exacto ✓, `tip_cents=2500`
  manual ✓ (ambos `succeeded`).

## 0.16.0 — T-D3a: el home del mock (FAB + barra inferior + saldo con ojito) (2026-07-23)

Adopción del mock de diseño del hermano de Mati (auditoría externa), con la
decisión de privacidad de Mati integrada (opción b ratificada):

- **"+ Nueva Mesa" flotante** (píldora naranja) en el home y en Mesas: LA
  acción de la app, siempre a un pulgar. Reemplaza al cuadrado del home.
- **Barra inferior fija** Inicio · Amigos · Grupos · Perfil (componente
  `BottomNav`, solo en las cuatro pantallas hub; los flujos siguen a pantalla
  completa). Las pantallas tab pierden la flecha "atrás" y ganan aire
  inferior (`.has-nav`). Resuelve la alcanzabilidad que marcó el inventario
  (Perfil e íconos sociales ya no dependen del home).
- **Home v3 por secciones**: header claro (logo + "Hola, X!" + campana),
  banner de invitación, **tarjeta de saldo con monto OCULTO** (`$ ••••`) y
  ojito 👁 para revelar de un tap (privacidad primero; Cargar/Transferir
  vuelven adentro de la tarjeta, flecha → Cuenta), "Mesas abiertas (N)" en
  carrusel horizontal con Ver más → Mesas, y "Últimos movimientos" (top 4)
  con Ver más → Cuenta. **Los montos de los movimientos respetan el mismo
  ojito** — sin revelar, el home no muestra ni un peso.
- La grilla de cuadrados de 0.14 desaparece (nav + FAB + secciones la
  reemplazan). En `?demo=1` la tarjeta de saldo sigue oculta (video YC).

## 0.15.0 — T-D2: volver con memoria + el banner cumple su promesa (2026-07-23)

Cierre de las podas de navegación del inventario de diseño (R-04, R-08, R-11):

- **`goBack(fallback)` en el router**: los "volver" de Transferir, Cargar y
  Mesa ahora respetan DE DÓNDE viniste (historial real del navegador; si la
  pantalla se abrió directa —deep link/refresh— cae a su contenedora
  natural). Antes: entrabas a Cargar desde Cuenta y "volver" te tiraba al
  home (R-08).
- **El detalle de mesa vuelve SIEMPRE a Mesas** (viva o cerrada), su
  contenedora natural ahora que tiene historial; los botones "🏠 Inicio"
  quedan como salto directo post-pago (R-11). El invitado sin cuenta sigue
  sin back del header.
- **El banner de invitación del home acepta DIRECTO**: decía "tocá para
  aceptar" pero mandaba a Avisos, donde había que tocar otra vez. Ahora
  acepta y te deja adentro de la mesa ("Sumándote a la mesa…" mientras
  procesa; si falla, avisa y no navega) (R-04). La campana de Avisos sigue
  como acceso a la lista completa.

## 0.14.0 — Home v2 + pantalla Mesas con historial (2026-07-22)

Decisiones de producto de Mati (ratificadas 2026-07-22):

- **El home es una grilla de cuadrados grandes centrados** (2 columnas:
  Nueva Mesa, Mesas, Cuenta, Amigos, Grupos, Perfil) en vez de tarjetas
  rectangulares apiladas; la invitación sigue full-width arriba. La tarjeta
  Mesas se resalta en teal cuando hay una abierta.
- **Cargar y Transferir salen del home**: viven solo dentro de Cuenta (donde
  ya estaban, junto al saldo). El home queda enfocado en la mesa.
- **La tarjeta Cuenta ya no muestra el saldo** (privacidad: nadie ve tu plata
  por mirar la pantalla). El monto se ve recién adentro de Cuenta. El home
  deja de pedir `GET /account/balance`.
- **"Mesas Abiertas" → "Mesas"**: como las abiertas son transitorias (la
  garantía captura el faltante al vencer), la pantalla vive del HISTORIAL.
  Si hay una abierta va arriba, destacada en teal; debajo, la lista
  minimalista de mesas pagadas (restaurante, fecha, lo que pagaste vos —
  una línea por mesa). Fuente: `GET /account/history` del contrato real
  (nuevo en el facade: `getHistory`), agrupado por mesa en el cliente.
  En el home, la tarjeta dice "1 abierta ahora" en color o "Tu historial".
- **Mock espejando el shape**: seed con 3 mesas pagadas; cada pago propio
  suma su entrada al historial (los invitados no: el historial es del
  usuario autenticado, como en el backend).
- La invitación y la fila Amigos/Grupos/Perfil quedan en el home (decisión
  de Mati; revierte la idea previa de mover Amigos/Grupos a Perfil).

## 0.13.0 — T-D1: tipografía nueva + texto de apoyo unificado (2026-07-22)

Primer tier del carril de diseño (ratificado 2026-07-22; Mati eligió la
opción C del comparador de fuentes).

- **Plus Jakarta Sans reemplaza a Syne** como fuente display (títulos, montos,
  botones); el cuerpo sigue en DM Sans. Cambio en `index.html` (Google Fonts)
  y `--font-display` (`global.css`) — se propaga solo a toda la app.
- **El campo de tarjeta de Stripe ahora carga DM Sans de verdad**: el iframe
  no hereda las fuentes de la página y `stripe.elements()` no recibía la
  opción `fonts`, así que caía al sans del sistema desde T7.
- **Texto de apoyo unificado**: 16 captions armados a mano con
  `fontSize 10.5–12 + var(--gray-d)` en 7 pantallas pasan a la clase
  `.caption` existente (11.5px, `--gray-txt`); los 2 de monospace (CLABE,
  dígitos de tarjeta) conservan su familia pero adoptan el mismo gris. Se
  acaba la convivencia de dos grises para el mismo rol.

## 0.12.0 — D4: tarjeta guardada, conectado al contrato v2.16 publicado (2026-07-22)

Primera decisión del roadmap ratificado (acta 2026-07-22). Durante la
implementación mock-first el backend PUBLICÓ D4 (v2.16.0, verificado en el
repo hermano y en `/health` del vivo), con una forma más rica que el texto del
acta — y el contrato publicado manda: `GET /payment-methods` conserva `id`
(uuid) + `last_four`/`bank_name`/`type`/`display` y AGREGA
`stripe_payment_method_id` (pm_…); la garantía acepta **`payment_method_id`
(uuid) para tarjeta guardada**; `save_payment_method` (default false) guarda
la tarjeta tipeada. Cierra G-04/G-05 y disuelve G-06.

- **Selector de tarjetas guardadas en la garantía** (`CreateMesaFlow`): banco +
  ····últimos 4 + vencimiento + badge "Principal" (la principal viene
  preseleccionada). Elegir una guardada saltea Stripe Elements (sin re-tipeo,
  viaja su uuid como `payment_method_id`) y mantiene el 3DS
  (`requires_action`); "➕ Usar otra tarjeta" abre Elements con el checkbox
  **"Guardar esta tarjeta para la próxima"** (ratificado: prendido por
  defecto → `save_payment_method: true`).
- **El mismo selector en el pago** (`MesaScreen`). El invitado sin cuenta
  sigue igual que hoy (Elements, sin checkbox). Modo demo `?demo=1` intocado.
- **Cuenta → Tarjetas y Topup**: sin cambios visibles (el contrato conservó
  banco/tipo); el alta de Cuenta sigue vía setup-intent. En la garantía se
  quitó el bootstrap de setup-intent de v2.14: desde v2.16 el cliente Stripe
  se crea solo (confirmado por el aviso de publicación y verificado en vivo).
- **Mock** espejando v2.16: seed con dos tarjetas (uuid + pm_), reuso por
  `payment_method_id`, `save_payment_method` honrado — en la garantía la
  tarjeta se guarda RECIÉN al confirmar el 3DS (como el backend, que guarda en
  el webhook del hold): cancelar el 3DS no deja tarjetas fantasma.
- **Robustez del Card Element** (hallazgos de la review adversaria del diff):
  al desmontar, `CardField` resetea el estado del padre (antes un
  `complete: true` colgado dejaba el botón habilitado con el iframe nuevo
  vacío) y expone `empty`, con lo que la carga tardía de tarjetas ya no pisa
  la selección si el usuario está tipeando una nueva. Fix también del alta
  mock repetida en Cuenta (id fijo → no-op silencioso con éxito falso).
- **contract-mirror refrescado a v2.16.0**: `schemas/index.js`,
  `routes/mesas.js`, `routes/payment-methods.js`, `routes/webhooks.js`,
  `docs/settlement.js.ref`. (En v2.15.0/D6 el espejo quedó byte-idéntico: el
  calendario de México vive en el outbox app→dashboard, fuera del contrato del
  comensal.)
- **GAPS.md**: G-04, G-05 y G-06 → RESUELTOS por la publicación v2.16.0.

## 0.11.1 — Modo demo: simular tarjeta (sin iframe de Stripe) (2026-07-22)

Extiende el modo demo (`?demo=1`) para que la grabación en navegador
automatizado no dependa de tipear en el iframe cross-origin de Stripe Elements
(el paso más frágil de automatizar). **Todo detrás del mismo flag; sin `?demo=1`
el pago sigue creando el `pm_` desde Elements como hoy.**

- **`DEMO_PM_ID = 'pm_card_visa'`** (`src/api/index.ts`): PaymentMethod de test
  de Stripe (Visa 4242, aprueba sin 3DS). Token público de test; nunca se usa
  sin el flag.
- **Garantía** (`CreateMesaFlow`): en demo se saltea `createCardPaymentMethod`
  y se manda `stripe_payment_method_id: pm_card_visa` (se mantiene el
  `setup-intent` que crea el cliente Stripe lazy). El campo de tarjeta se
  reemplaza por una nota "💳 Tarjeta de prueba ···· 4242 (demo)" y el botón deja
  de exigir `cardState.complete`.
- **Pago** (`MesaScreen`): idéntico — en demo el pago de la parte manda
  `pm_card_visa` en vez de crear el `pm_` desde el iframe.
- Verificado por curl contra el backend vivo: garantía y cobro con
  `pm_card_visa` = `succeeded`, sin 3DS.

## 0.11.0 — Modo demo sin cámara para grabar el video (2026-07-22)

Bypass de cámara para grabar el video-demo del comensal (aplicación YC) en un
navegador automatizado, que se traba en el escaneo: `getUserMedia`/el diálogo
de archivo nunca produce un frame. **Todo detrás de `?demo=1`; sin el flag la
app se comporta EXACTAMENTE igual que hoy. No toca el contrato ni el
happy-path.**

- **Flag `IS_DEMO`** (`src/api/index.ts`): se activa con `?demo=1` en la URL
  (`.../live/?demo=1`; también se lee dentro del hash). Se evalúa una vez al
  cargar.
- **Escaneo sin cámara** (`CreateMesaFlow`): en modo demo el botón pasa a ser
  **"🧾 Usar ticket de ejemplo"**, que genera una imagen mínima válida (JPEG
  8×8) y la manda al MISMO `POST /api/ocr` — el backend responde el ticket de
  ejemplo de siempre (La Parolaccia, $840, 6 ítems) y avanza a dividir. No hay
  ticket hardcodeado nuevo: mismo endpoint, mismo resultado, sin `getUserMedia`.
- **Cartel del mock oculto** en modo demo: se esconde el aviso amber
  "…todavía no leemos la foto de verdad…" que delataría la maqueta en cámara.
- **Bloque "Cuenta · saldo y movimientos" oculto** en el home en modo demo
  (sugiere wallet/prepago; fuera del encuadre).
- El pago sigue siendo Stripe real (no se tocó): la tarjeta de test se ingresa
  con Stripe Elements como siempre.

## 0.10.0 — Deploy real público + pago con tarjeta nueva (2026-07-22)

Para el video-demo del comensal (aplicación YC): dejar el front navegable en
una URL pública contra el backend vivo de Railway (v2.14.3).

- **Deploy dual en GitHub Pages** (`.github/workflows/deploy-demo.yml`):
  `/` sigue siendo la demo mock (feedback de diseño); `/live/` es el build real
  (`VITE_MOCK=0`) contra `payme-app-backend-production.up.railway.app`. La
  publishable key de Stripe la sirve el backend (`GET /api/config`), no va como
  variable. `VITE_RESTAURANT_ID` sale de la variable de repo homónima (G-01).
- **Pago con tarjeta nueva en la pantalla de pago** (`MesaScreen`): en modo
  real, un usuario sin tarjeta guardada ahora ingresa la tarjeta con Stripe
  Elements inline; se crea el `pm_` y se manda como `stripe_payment_method_id`
  (campo que el contrato de `POST /:code/pay` ya aceptaba). Antes la opción
  "Tarjeta" no recolectaba nada y el pago fallaba con `no_payment_source`.
  Cubre el paso "pagar con 4242" del video. 3DS ya estaba manejado.
- Registro confirmado **sin OTP/SMS**: `POST /auth/register` toma
  `{email, phone?, password, first_name, last_name}` y devuelve tokens.

## 0.9.0 — T7 (parte 1): Stripe.js integrado (2026-07-19)

Primera mitad de T7: todo el lado del front listo para hablar con el backend
real. Falta levantar el backend (requiere PostgreSQL) para verificar de punta
a punta.

- **Nueva dependencia: `@stripe/stripe-js` 9.10.0** — única del proyecto
  además de React, alcance ratificado por Mati. Sin wrapper de React: los
  Elements se montan a mano (`src/components/CardField.tsx`) para no sumar una
  segunda librería.
- Carga **diferida**: Stripe queda en un chunk aparte de 2,7 kB que la demo
  (`VITE_MOCK=1`) no descarga nunca. La clave publicable se pide a
  `GET /api/config`; la secreta jamás sale del backend.
- `confirmGuarantee3ds` real: confirma el 3DS y **sondea la mesa** hasta que
  deja `pending_auth` — el cambio lo hace el webhook, no la respuesta de
  Stripe, así que sin el sondeo se compartía el link con la mesa sin abrir.
- 3DS también en el **pago** (`requires_action` en `POST /:code/pay`), que
  antes se daba por cobrado sin confirmar.
- Alta de tarjeta real: SetupIntent → Elements → `POST /payment-methods`.
- **G-02** (login no devuelve `user`): se guarda el email tipeado y
  `utils/identity.ts` deriva el nombre para saludar, con la deuda documentada.
- **G-01** (no hay endpoint de restaurantes): el `restaurant_id` sale de
  `VITE_RESTAURANT_ID` con mensaje de error explícito si falta.
- `scripts/t7-setup-db.sh` + `scripts/T7_RUNBOOK.md`: preparan la base local,
  corren las 4 migraciones y siembran el restaurante. **No tocan ni un archivo
  del backend** (repo de solo lectura).
- Fix: la banda de demo se perdía al hacer scroll (la altura de viewport
  estaba duplicada entre `.app` y `.screen`).

### Gaps nuevos encontrados al integrar
- **G-04 (bloqueante para la garantía con tarjeta)**: `POST /mesas` exige un
  `stripe_payment_method_id` (`pm_…`) que `GET /payment-methods` **no
  devuelve**. No se puede garantizar una mesa con una tarjeta ya guardada: hay
  que tipearla cada vez. `POST /:code/pay` sí acepta el id interno, así que la
  asimetría parece un descuido del contrato.
- **G-05**: consecuencia del anterior para las tarjetas guardadas.

## 0.8.0 — Revisión previa al feedback de diseño (2026-07-19)

Aplicación de los 47 hallazgos confirmados por una revisión multi-agente
(83 crudos → 47 tras verificación adversarial). Todo lo que no es decisión
estética quedó resuelto.

**Nada del contrato se filtra ya a la pantalla** (`src/utils/labels.ts`):
- Estados de mesa en español ("Falta pagar" en vez de `partially_paid`), con
  el color del badge acorde a la tarjeta.
- Movimientos del wallet con etiqueta humana en vez de `payment_mesa`.
- Pantalla de cobro sin `pending`/`succeeded`/`processed`: "Confirmando el
  cobro → Acreditando en la mesa → Listo".
- Fuera "Tier 7", "backend", "OCR", "3-D Secure", "modo mock" de los textos.

**Sin callejones sin salida**:
- El invitado ya no puede quedar atrapado: `navigate('home')` reescribía el
  hash sin el token `?t=` y lo expulsaba al login perdiendo el link. Ahora
  las pantallas de invitado no ofrecen salidas que rompan su acceso, y la
  mesa cerrada siempre muestra barra de acción.
- El paso 3DS tiene botón de volver y de cancelar (antes la única salida era
  autorizar, con la mesa ya creada sin garantía).
- Si no queda nada por tomar, el botón lo dice en vez de pedir lo imposible.

**Demo creíble de punta a punta**:
- El estado persiste en `localStorage` (`payme_mock_state_v1`): recargar ya
  no borra mesas, pagos ni saldo. Botón "Reiniciar la demo" en Perfil.
- Un link de invitación abierto en OTRO dispositivo funciona: la mesa se
  materializa con el ticket de ejemplo en vez de dar "no encontrada".
- La vista de invitado se puede ver estando logueado (antes era inalcanzable
  para quien evalúa), con aviso "Así lo ve quien recibe tu link".
- Banda persistente "Demo · datos de ejemplo, no se cobra dinero real" y
  aviso explícito en la pantalla de pago.
- Números coherentes: la garantía de PA-1099 es por saldo (su débito estaba
  contradicho), la transferencia de Juan tiene su movimiento y la cadena de
  saldos cierra en $1,250; los slots usan `splitEqual` como el backend.
- El saludo toma el nombre de quien entra, no el del usuario de ejemplo.
- "Saldo disponible" → "Tu saldo PayMe" (G-03: el contrato no expone el
  saldo retenido, así que no se puede afirmar que esté disponible).

**Accesibilidad**: contraste AA en countdown, badges, placeholders y textos
sobre navy (`--orange-txt`, `--teal-txt`, `--gray-txt`); `role="radiogroup"`
en métodos de pago y propina; `role="alert"` en errores; `role="status"` en
cobro y toasts (siempre montados); `aria-label` en botones de ícono;
`aria-hidden` en emojis decorativos; `<h1>` real en cada pantalla;
checkboxes decorativos ocultos al lector; barras de progreso con ARIA.

**Consistencia**: clases `.btn-sm` y `.caption` en vez de nueve overrides
inline distintos; terminología unificada en "consumos".

## 0.7.0 — Funcionalidades restantes del contrato + demo compartible (2026-07-18)

- **Avisos** (`GET /notifications` + `unread-count` + `read-all`): inbox con
  no-leídos, campanita con badge en el home.
- **Invitaciones in-app** (`GET /invitations` + `accept`): tarjeta en el home
  y en Avisos; aceptar te lleva a la mesa del que te invitó (mesa seed PA-4520
  de Sofía, partes iguales).
- **Estadísticas del mes** (`GET /account/stats`): gastado / salidas /
  promedio + restaurante favorito en Cuenta → Historial.
- **Tarjetas**: hacer principal (`PATCH /:id/default`) y quitar (`DELETE`).
- **Amigos**: quitar amigo con confirmación. **Grupos**: quitar miembro y
  eliminar grupo.
- Workflow de deploy del demo mock a GitHub Pages (`deploy-demo.yml`).

## 0.6.0 — T6 (2026-07-18)

- Estados vacíos en mesas/movimientos/amigos/grupos; mensajes de error en
  español mapeados desde los códigos reales del contrato (`insufficient_funds`
  con disponible/requerido, `wallet_requires_auth`, `item_already_locked`,
  `guarantee_failed`, `mesa_not_payable`, `no_slots_available`).
- Accesibilidad: aria-labels en botones de ícono, `role=status` en toasts,
  inputs ≥16px (sin zoom iOS), safe-areas notch, targets táctiles grandes.

## 0.5.0 — T5 (2026-07-18)

- Cuenta (`s-account`): saldo, tabs Historial (wallet-transactions con los 11
  tipos reales) y Tarjetas (payment-methods).
- Cargar (`s-topup` + **A-3**): OXXO con voucher y vencimiento, tarjeta con
  acreditación inline, y **SPEI** con CLABE virtual (`GET /api/wallet/clabe`),
  límites reales $50–$10,000.
- Transferir (`s-transfer`): amigo + monto + concepto, idempotencia, manejo de
  `402 insufficient_funds`.
- Amigos (`s-friends`): lista, búsqueda, alta por email/payme_id.
- Grupos (`s-groups`): lista, detalle con miembros, crear, sumar amigos.
- Perfil (`s-profile`): identidad, accesos, cerrar sesión, nota G-02.

## 0.4.0 — T4 (2026-07-18)

- Pago (`s-payment`): propina 0/10/15/20% al mozo elegido (staff real de la
  mesa), métodos saldo/tarjeta/Apple Pay, `idempotency_key` por intento.
- Procesando (`s-processing`): estados reales `pending → succeeded → processed`.
- Comprobante (`s-confirm`) con desglose ítems/propina/total.
- **Expirada A-2** (`s-expired`): "Cubrió tu garantía $X · Recibió el
  restaurante $TOTAL" — semántica nueva, la maqueta decía lo contrario.
  Demo: botón "ver qué pasa si expira" → mesa PA-1099.

## 0.3.0 — T3 (2026-07-18)

- **Invitado por link (momento mágico)**: `#/mesa/:code?t=token` entra SIN
  cuenta ni login; banner "Te invitaron a", selección con lock, pago solo con
  tarjeta/Apple Pay (saldo pide cuenta — `wallet_requires_auth`), comprobante
  con invitación a crear cuenta.

## 0.2.0 — T2 (2026-07-18)

- Mesas Abiertas (`s-open`) con progreso, countdown vivo y estados reales.
- Wizard del organizador: scan-mock (`s-scan`) → ticket (`s-ticket`) →
  división consumo/igual con stepper de comensales (`s-division`) →
  **"Garantizá la mesa" (A-1, pantalla nueva)**: card con `requires_action`/3DS
  simulado o wallet (congela saldo; `402` con disponible/requerido si no
  alcanza) → compartir link/WhatsApp (`s-share`, link una sola vez).
- Detalle de mesa: mis ítems con lock (`s-myitems`), ítems pagados/tomados por
  otros, slots de división igualitaria, invitar desde la mesa.
- Mock con reglas del contrato: store en memoria con garantía, saldo retenido,
  locks, slots FIFO, expiración con captura de faltante (A-2).

## 0.1.0 — T1 (2026-07-18)

- T0: `contract-mirror/` construido desde `../payme-app-backend` v2.13 (schemas,
  16 rutas, auth middleware, money/stateMachine, schema.sql, docs) con README de
  procedencia y resumen del contrato verificado. Gaps G-01/G-02/G-03 anotados en
  `GAPS.md`.
- Esqueleto Vite + React 18 + TypeScript estricto, espejo del stack del
  dashboard frontend (mismas versiones, cero librerías de UI).
- Router propio por hash (`src/router.ts`) con soporte de `?t=` dentro del hash
  (preparado para el link de invitado de T3).
- Fachada de datos `src/api/` con adaptador mock (`VITE_MOCK=1`) que replica
  los shapes reales del contrato; cliente HTTP real con refresh token rotativo
  según `README_v2.5.2` (el refresh viejo se reemplaza SIEMPRE).
- `src/utils/money.ts`: réplica exacta y tipada de `utils/money.js` del backend
  (procedencia documentada). `format.ts` solo para presentación.
- Auth según contrato: login / registro / logout / restauración de sesión.
  G-02 respetado: el login real no trae `user` (saludo genérico en ese caso).
- Shell de navegación completo + Home (maqueta `s-home`) con saldo real
  (`GET /account/balance`) y contador de mesas abiertas (`GET /mesas/open`).
  Pantallas de tiers futuros como stubs navegables.
- CI: GitHub Actions con typecheck + build.
