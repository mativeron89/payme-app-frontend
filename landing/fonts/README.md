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

## Por qué sólo Plus Jakarta Sans

La landing usa **una** familia. Su cadena es
`'Plus Jakarta Sans', 'DM Sans', sans-serif`: si PJS carga, DM Sans no se dibuja
nunca. Traer los 240 KB de DM Sans para un fallback que no se va a usar sería
engordar el artefacto por simetría con la webapp, no por necesidad.

**Pesos que la landing usa de verdad: 400 (cuerpo), 700 (los dos accesos) y 800
(la marca).** Los cubre el eje `wght 200…800` del mismo archivo variable.
