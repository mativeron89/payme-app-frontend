# Fotografía de la landing · procedencia y licencia

**La atribución viaja con el archivo**, igual que la OFL de las tipografías.
Un asset con licencia y sin su procedencia al lado es un asset que nadie puede
auditar después.

## `mesa-comida.jpg`

| | |
|---|---|
| **Autor** | Dan Gold |
| **Fuente** | Unsplash |
| **Licencia** | Unsplash License — uso comercial libre, sin pedir permiso |
| **Estado** | verificada para uso comercial (workspace, `diseno/referencias/web/`) |
| **Original** | `diseno/referencias/web/web__foto-mesa-manos-hamburguesas__CONTENIDO__Dan-Gold-Unsplash__licencia-verificada-uso-comercial-libre.jpg` · 2000×1500 · 421.458 B |
| **Derivada** | 1400×1050 · 246.092 B · redimensionada y recomprimida, sin recortes ni retoques |

La Unsplash License no exige atribución, pero **sí la agradece y nosotros la
dejamos escrita**: el costo es un archivo de texto y el beneficio es que dentro
de un año se pueda responder de dónde salió la foto sin buscar en un chat.

## 🔴 Cómo se comprimió, y por qué el número de la orden no servía

Se pidió *"~1400 px de ancho, calidad ~75"*. **La escala numérica de `sips` NO
es la de ImageMagick**, y su `75` produce un archivo MÁS PESADO que el original.
Medido, todo a 1400 px:

```
formatOptions 60        322.263 B
formatOptions 70        425.407 B
formatOptions 75        466.832 B   ← más que el original de 2000×1500
formatOptions 80        500.770 B
formatOptions low       114.173 B
formatOptions normal    246.092 B   ← ELEGIDA
formatOptions high      466.832 B
```

Se eligió `normal` **por medición y mirándola**, no por el nombre: 246 KB, sin
artefactos visibles en las texturas ni bandeo en los degradados. `low` ahorra
132 KB y se nota.

```
sips -Z 1400 -s format jpeg -s formatOptions normal <original> --out mesa-comida.jpg
```

## Dónde vive, y por qué hay dos archivos

**`landing/img/mesa-comida.jpg`** es la fuente: la referencia el HTML, así que
Vite la procesa y la emite **con hash** —cache-busting gratis, y si la ruta
tuviera un typo el build falla en vez de servir un hueco—.

**`landing/public/img/CREDITOS.txt`** es la atribución, y va en `public/` porque
tiene que VIAJAR con el artefacto aunque nadie la referencie. Es exactamente el
mismo tratamiento que las OFL de las tipografías: `public/` es lo único que Vite
emite por el solo hecho de estar ahí.

🔴 **Este archivo `.md` NO se publica** —contiene rutas internas y explica la
arquitectura— y por eso existe el `.txt`: mismo contenido esencial, sin nada
que no deba salir. Si cambia uno, cambia el otro.

⚠️ Corrección del 2026-08-09: hasta el port del boceto, acá decía que la foto
NO debía ir a `public/` porque *"todavía no la referencia nadie"*. Era cierto
ese día y dejó de serlo cuando la maqueta la usó. **Quedó escrito para que no
se lea como una regla: era el estado de ese momento.**
