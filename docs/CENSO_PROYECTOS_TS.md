# Censo de proyectos TypeScript

## 🔴 `tsc -b` NO ES EL TYPECHECK DE ESTE REPO · 2026-08-11

```
npx tsc -b --force   →   69 archivos     ← UN proyecto
npm run typecheck    →  229 archivos     ← los CUATRO, y es lo que corre CI
```

**`tsconfig.json` no declara `references`, así que el modo build compila el
proyecto raíz y nada más.** Los otros tres —tests de `src`, node y `e2e`— quedan
sin mirar.

**Acreditado rompiendo:** con un error de tipos plantado en `e2e/_app.ts`,
`npx tsc -b --force` sale **0 con cero errores** y `npm run typecheck` sale **2
con dos**.

⚠️ **Costó un CI rojo con Mati esperando.** Corrí `tsc -b` como gate local
durante todo el 2026-08-10 y reporté *«typecheck 4 proyectos = 0»* en varios
mensajes. **Era un proyecto.** El defecto que se coló —una ruta absoluta en
`e2e/idioma.spec.ts` que sólo resuelve Vite— vivía justamente en el proyecto que
`tsc -b` no mira.

**Regla: el gate local usa los comandos TEXTUALES del `ci.yml`.** No uno
equivalente, no uno más rápido: **el mismo**. Un instrumento que mide *casi* lo
mismo deja pasar exactamente lo que el gate mira.

**Por qué no se «arregla» agregando `references`:** haría falta `composite: true`
en los cuatro y emitiría `.tsbuildinfo` por proyecto — un cambio de
configuración con efectos propios para volver cómodo un atajo que no hace falta.
`npm run typecheck` ya existe, ya es correcto y ya es el que manda.


**Qué archivo typechequea cuál de los cuatro proyectos, y por qué son cuatro.**

🔴 **La autoridad NO es este documento: es `scripts/tsProjectIsolation.test.ts`.**
Ese test deriva la cobertura con `tsc --listFilesOnly` —que resuelve `include`,
`exclude` y el grafo de imports— y la compara contra `git ls-files`. Si un
archivo queda fuera de todos los proyectos, se pone rojo. Acá se explica el
reparto para quien lea; **los números y la verdad salen del test.**

Antes esto vivía en una tabla dentro de un mensaje entre sesiones, que es como
no tenerlo: los mensajes se pierden, y una tabla escrita a mano nace vieja el
día que alguien agrega un archivo.

## El reparto

| Proyecto | Qué cubre | `types` | Por qué existe |
|---|---|---|---|
| `tsconfig.json` | `src/`, **sin** los `*.test.*` | `vite/client` | El código que se despacha al teléfono. Es el único que importa que esté limpio de globals de Node. |
| `tsconfig.test.json` | `src/**/*.test.ts(x)` | `vite/client` | Los tests de `src/` corren en jsdom pero importan `vitest`, que arrastra `@types/node` por el grafo de módulos. Separados para que esa contaminación no llegue al de arriba. |
| `tsconfig.node.json` | `scripts/**/*.test.ts`, `landing/**/*.test.ts` | `node`, `vite/client` | Tests que usan `node:fs`, `node:child_process`, `node:os`. Necesitan los globals de Node de verdad. |
| `tsconfig.e2e.json` | `e2e/` | Playwright | Otro runner, otro entorno. Su `page.evaluate` corre en el navegador y el spec corre en Node: dos mundos en un archivo. |

## 🔴 Por qué separados y no un `include` más

Si los tests de Node vivieran en el proyecto del navegador habría que agregar
`"node"` a sus `types`, y entonces **`src/` vería globals que en el teléfono NO
EXISTEN**. Un `process.env` o un `Buffer` escrito por descuido compilaría sin
queja y reventaría en runtime, en producción.

Eso no es una hipótesis: la primera versión de esta separación se justificó con
un argumento sobre `types` que era **verdadero y contestaba otra pregunta**, y
una sonda `process.env` en `src/` compiló limpio igual. El test de aislamiento
existe por eso, y compila el programa REAL con una sonda en vez de leer la
configuración.

## Solapamiento, que es esperado

Un archivo puede estar en varios proyectos y está bien: un módulo de `src/` que
un test importa aparece en `tsconfig.json` **y** en `tsconfig.test.json`. Lo que
el test prohíbe es lo contrario — que un archivo no esté en **ninguno**.

## Qué hacer si el test se pone rojo

Dice qué archivos quedaron sin cobertura. Las salidas, en orden de preferencia:

1. **El archivo pertenece a un proyecto existente** → ajustar su `include`.
2. **Es una unidad nueva de verdad** (otro runner, otro entorno de ejecución) →
   proyecto propio, agregarlo al script `typecheck` de `package.json`, y
   agregarlo a la tabla de arriba. El test verifica que los tres pasos
   coincidan.
3. **El archivo no debería existir** → borrarlo.

**Lo que NO es una salida: sacarlo del censo.** Un archivo sin typecheck compila
y corre igual —vitest y Vite transpilan sin verificar tipos— y se pudre en
silencio hasta que rompe en runtime. Ya pasó: `scripts/` y `landing/` estuvieron
sin cobertura hasta la ORDEN 2A, y el hueco no lo encontró nadie leyendo.
