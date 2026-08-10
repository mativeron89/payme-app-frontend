# La copia de la landing

`PlusJakartaSans-variable.ttf` acá es **byte-idéntico** al de
`src/assets/fonts/`. La procedencia completa —upstream, commit, versión, ejes,
cobertura Unicode y el análisis de la OFL— está en
[`../../src/assets/fonts/README.md`](../../src/assets/fonts/README.md) y no se
repite para que no haya dos versiones de la verdad.

## Por qué se duplica en vez de referenciar

**`D-WEB-1-BIS`: la landing es otro ORIGEN.** Un artefacto que toma su tipografía
del origen de la webapp no está separado — está acoplado, y la separación pasa a
ser una afirmación en vez de un hecho. Es la misma razón por la que
`landing.css` **copia** los tokens de color en lugar de importar
`src/styles/global.css`.

`landing/landing.test.ts` compara los SHA-256 de las dos copias y se pone rojo si
divergen. **Replicar y poner un gate encima**, igual que el `contract-mirror`.

## 🔴 «Por qué sólo Plus Jakarta Sans» · ya no es cierto (2026-08-10)

Esta sección argumentaba que DM Sans no hacía falta: *«si PJS carga, DM Sans no
se dibuja nunca. Traer los 240 KB… sería engordar el artefacto por simetría con
la webapp, no por necesidad»*.

**El argumento era correcto para la landing de entonces.** Dejó de aplicar
el 2026-08-09, cuando se portó el boceto de Diseño: la landing pasó a usar **dos
familias de verdad**, no una con fallback. `landing.css` declara dos
`@font-face`, y `DMSans-variable.ttf` (240.164 B) está en esta carpeta desde ese
día.

**El README quedó argumentando en contra de lo que el repo ya había hecho.**
Nadie lo notó porque la guarda que existe compara los SHA-256 de las copias
—y las dos copias coinciden—: **verifica que lo que hay sea idéntico, no que
sea lo que el texto dice que hay.** Un gate correcto puede convivir años con una
prosa falsa si miran cosas distintas.

**Las dos familias, y para qué:**

```
Plus Jakarta Sans   cuerpo y marca      176.288 B
DM Sans             la del boceto       240.164 B
```

**Pesos que la landing usa de verdad: 400 (cuerpo), 700 (los accesos) y 800 (la
marca).** Los cubre el eje `wght` de los archivos variables.
