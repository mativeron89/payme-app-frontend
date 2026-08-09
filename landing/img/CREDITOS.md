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

## Por qué NO está en `landing/public/`

**Todavía no la referencia nadie.** `public/` se emite entero, así que ponerla
ahí hoy publicaría 246 KB que nadie descarga a propósito y nadie ve — que es
exactamente el modo de falla que `landing.test.ts` persigue con *"las capturas
se USAN"*.

Vive acá, lista. **Cuando la maqueta de Diseño la referencie desde el CSS o el
HTML, Vite la procesa y la emite con hash** — igual que la tipografía de
`landing/fonts/`. Es un cambio de una línea.
