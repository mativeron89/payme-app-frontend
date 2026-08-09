# Tipografías auto-hospedadas · procedencia y licencia

**`D-FUENTES-1`. Estos archivos NO se editan.** Si alguna vez hay que cambiarlos,
se vuelven a bajar del upstream y se re-verifican los SHA-256 de abajo. Un TTF
retocado a mano es indistinguible de uno sano hasta que rompe en un teléfono.

## Upstream, fijado por commit

```
github.com/google/fonts @ 2d85e20401920891efb7cd6272d6339685df2820
```

**Se fija el commit y no `main`** por la misma razón que el `contract-mirror`
fija el suyo: *"la última versión"* no es una procedencia, es una promesa que
cambia sola.

### Mapeo origen → destino

Los nombres upstream llevan corchetes (`[wght]`), que es la convención de Google
para archivos variables. Se renombran acá porque un corchete en una ruta rompe
el globbing de la shell y obliga a escapar dentro de `url(...)` del CSS. **Es el
mismo patrón que el espejo del contrato: se renombra y se declara el mapeo, no se
renombra en silencio.**

| Origen (`ofl/…`) | Destino | SHA-256 |
|---|---|---|
| `plusjakartasans/PlusJakartaSans[wght].ttf` | `PlusJakartaSans-variable.ttf` | `89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8` |
| `dmsans/DMSans[opsz,wght].ttf` | `DMSans-variable.ttf` | `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d` |
| `plusjakartasans/OFL.txt` | `OFL-PlusJakartaSans.txt` | `995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99` |
| `dmsans/OFL.txt` | `OFL-DMSans.txt` | `9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1` |

**Renombrar el ARCHIVO no renombra la FUENTE.** La OFL restringe el nombre de la
familia declarado dentro del binario —que sigue siendo `Plus Jakarta Sans` y
`DM Sans`—, no cómo se llama el archivo en disco.

**Las cursivas existen upstream y NO se bajaron:** el sistema de diseño no usa
ninguna, y traerlas sería 468 KB para nada.

## Qué contiene cada archivo

| | Versión | Ejes | Code points |
|---|---|---|---|
| Plus Jakarta Sans | `2.071` (`gftools 0.9.30`) | `wght 200 … 800` | 721 |
| DM Sans | `4.004` (`gftools 0.9.30`) | `opsz 9 … 40` · `wght 100 … 1000` | 403 |

**Cobertura Unicode** (medida parseando la `cmap` de cada binario, no leída de la
documentación de Google):

| Bloque | PJS | DM Sans |
|---|---|---|
| Latín básico + suplemento + extendido A/B `U+0000–U+024F` | 379 | 313 |
| Vietnamita `U+1E00–U+1EFF` | 164 | 13 |
| Puntuación general `U+2000–U+206F` | 28 | 16 |
| Símbolos de moneda `U+20A0–U+20CF` | 24 | 5 |
| Otros (flechas, matemáticos, ligaduras) | 114 | 36 |

**El `@font-face` NO declara `unicode-range`, a propósito.** Sin el descriptor el
navegador usa la cobertura real del archivo; con un descriptor mal escrito
dejaría de dibujar glifos que la fuente sí tiene. Se documenta el rango, no se
declara.

## 🔴 Por qué TTF y no WOFF2

**El gate de descarga (`D-GATE-1`) autoriza `github.com/google/fonts`, WOFF2 +
OFL, "ningún otro origen, ninguna otra descarga". Ese repo NO publica WOFF2** —
sólo TTF variable; los `.woff2` que sirve Google se generan en el borde y no
están versionados. La combinación que pide el gate no existe.

Convertir exige un conversor (`fontTools`+`brotli` o `woff2_compress`), no hay
ninguno en la máquina, y bajarlo es *otra descarga de otro origen*: justamente lo
que el gate prohíbe. **Así que se sirve el TTF tal como está upstream.**

Lo que **sí** está medido:

```
                    crudo      gzip     brotli
PlusJakartaSans   176.288    79.781     65.729
DMSans            240.164   110.278     92.043
TOTAL             416.452   190.059    157.772
```

### 🔴 Y lo que NO está medido, que es justo el número que decidiría

**Nadie tiene el peso de un WOFF2 producido por el encoder de referencia.** Un
WOFF2 es brotli **más** una transformación de las tablas `glyf`/`loca`, y esa
transformación es la única parte que no se puede estimar mirando el brotli.

Dos números circularon y **ninguno de los dos es ése**:

| Número | Qué es realmente |
|---|---|
| `≈145.000` | **Estimación**, escrita acá en la primera versión de este documento. No se midió nada. |
| `157.333` | Medición de `payme-dashboard-frontend`, pero de un WOFF2 **fabricado con null transform** — o sea TTF + brotli metido en otro contenedor. Mide el sobrecosto del envase, **no la ganancia de la transformación**. |

Que los dos difieran no es el hallazgo; el hallazgo es que **el número que
importa no lo produjo nadie**, porque el encoder de referencia no existe en esta
máquina.

🔴 **Por eso la decisión se difiere, y por este motivo y no por el tamaño:
optimizar hacia un formato cuya ganancia real está SIN MEDIR, contra un host que
todavía no existe, es adivinar dos veces.** WOFF2 entra en Carril 7 junto con la
compresión, donde se puede medir la cadena entera de una vez.

### 🔴 Requisito de hosting que viaja con estos archivos

**El host DEBE comprimir `.ttf` en tránsito** — `br` preferido, `gzip`
aceptable—, y se verifica con la cabecera `content-encoding` de la respuesta.
Sin eso son 416 KB en vez de 158 KB.

Está en `ops/INVENTARIO_CARRIL_7_PENDIENTE`, y se repite acá a propósito: **el
que lo va a necesitar toca este repo, no lee `ops/`.**

**Mientras tanto `font-display: swap` acota el daño:** el texto se lee desde el
primer frame con el sans del sistema y la tipografía propia entra cuando llega.
Nunca hay pantalla en blanco.

## Licencia · SIL Open Font License 1.1

`OFL-PlusJakartaSans.txt` y `OFL-DMSans.txt` son **el texto completo**, sin
recortar, junto al aviso de copyright de cada proyecto.

🔴 **Ninguna de las dos familias declara Reserved Font Name.** Verificado contra
la definición de la propia licencia, no de memoria:

```
OFL §definiciones   "Reserved Font Name" refers to any names specified as such
                    after the copyright statement(s).
PJS                 Copyright 2020 The Plus Jakarta Sans Project Authors (…)   ← nada después
DM Sans             Copyright 2014 The DM Sans Project Authors (…)             ← nada después
```

**Importa por lo siguiente:** OFL 1.1 define *Modified Version* incluyendo
textualmente **"by changing formats"**. Convertir a WOFF2 —o subsetear— **es
derivar**. Sin Reserved Font Name la cláusula 3 no tiene objeto y el nombre de
familia se podría conservar igual; pero **un TTF byte-idéntico al upstream no es
Modified Version en absoluto**, que es la posición más simple de sostener.

**Si algún día se convierte o se subsetea, esa nota deja de ser teórica** y hay
que releer las cláusulas 1 y 3 antes de tocar nada.

### Y el aviso viaja DENTRO del binario

La cláusula 1 pide que el aviso de copyright y el de licencia estén *"en todas
las copias"*. **Están: los propios autores los pusieron en la tabla `name`**, y
por eso sobreviven al hash de Vite, al deploy y a cualquier copia futura.
Verificado leyendo la tabla:

```
nameID  0  Copyright 2020 The Plus Jakarta Sans Project Authors (…)
nameID 13  This Font Software is licensed under the SIL Open Font License, Version 1.1…
nameID 14  https://scripts.sil.org/OFL
```

**Por eso NO se agregó un `public/` sólo para publicar los `.txt`**: el texto
completo vive en el repo —que es lo que pide la orden— y el aviso viaja dentro
de cada binario servido. Si algún día se quiere publicarlos en la raíz del
sitio, es una decisión de hosting, no un requisito pendiente.

## Por qué la landing tiene su propia copia

`landing/fonts/` repite `PlusJakartaSans-variable.ttf` byte por byte. **No es
descuido: `D-WEB-1-BIS` manda que la landing sea otro ORIGEN**, y un artefacto
que toma su tipografía del origen de la webapp no está separado, está acoplado.

La duplicación se protege igual que los tokens de color: **un test compara los
SHA-256 de las dos copias y se pone rojo si divergen.** Replicar y poner un gate
encima, como el `contract-mirror` — no confiar en que alguien se acuerde.
