# design-mirror — los tokens ratificados, espejados

**SOLO LECTURA.** `tokens.json` es una copia de los tokens que
`diseno/SISTEMA_DISENO.md` ratifica. **No se edita para que un test pase: se
re-espeja desde la fuente.** Misma disciplina que `contract-mirror/`.

## Por qué existe

Diseño pidió —y tiene razón— que la guarda de tokens ancle contra el sistema de
diseño y no contra ninguno de los dos artefactos:

> «la landing con `#0F1F3D` está desactualizada, no es una segunda decisión
> válida — quedó vieja porque nadie la tocó, no porque alguien la haya elegido
> distinta»

Comparar app contra landing sólo dice **que** difieren. No dice cuál tiene
razón, y sin un tercero el desempate lo gana el que alguien tocó último:
antigüedad en vez de ratificación.

## 🔴 Por qué una COPIA y no leer la fuente directo

```
git -C diseno rev-parse --git-dir   →  fatal: not a git repository
```

**`diseno/` no está versionado.** Ni él ni la raíz del workspace. Un runner de
CI hace checkout de *este* repo y punto: ese archivo no existe ahí. Una guarda
que lo lea directo anda en la Mac y falla en CI — o peor, lo saltea y pasa en
verde, que es la clase que este repo viene persiguiendo.

⚠️ **El espejo mitiga esto para los tokens. No lo resuelve para el resto:** el
sistema de diseño ratificado sigue sin historia, sin diff y sin forma de volver
atrás si alguien lo edita mal. Está elevado a Mati como problema propio.

## Las tres verificaciones, y por qué no se funden en una

`scripts/tokensRatificados.test.ts`:

| | Qué mide | ¿Corre en CI? |
|---|---|---|
| **INTEGRIDAD** | los dos artefactos coinciden con el espejo | **sí, siempre** |
| **POBLACIÓN** | el espejo no perdió tokens en silencio | sí |
| **SIN ANCLA** | los tokens que el sistema nombra pero no valúa (`--r-*`) no se separan entre artefactos | sí |
| **VIGENCIA** | el espejo sigue igual a la fuente | **no — se SALTEA** |

🔴 **VIGENCIA necesita la fuente, y en CI nunca va a estar.** Cuando falta, el
test se **saltea con su motivo**, no se aprueba:

```
Tests  N passed | 1 skipped
  ↓ VIGENCIA … [NO CERTIFICADO: … `diseno/` no está versionado …]
```

**«No pude verificar» y «verifiqué y coincide» tienen que salir distintos.** Por
eso el step de CI se llama por lo que mide —integridad—, jamás «vigencia»: un
nombre que promete más de lo que mide es la misma mentira con otra letra.

## 🔴 El espejo no puede bendecirse a sí mismo

La primera versión de VIGENCIA tenía un atajo: `if (sha === espejado) return`.
Un mutante lo mató — edité el espejo **y** los dos artefactos para que
coincidieran entre sí, no toqué la fuente, y **los 7 tests pasaron en verde**.

El sha prueba que la **fuente** no cambió. No dice nada sobre si alguien editó
el **espejo**, que es la forma más fácil de «arreglar» un rojo. Ahora los tokens
se comparan **siempre** que la fuente esté disponible, y el mensaje de error
distingue los dos casos:

```
🔴 la fuente NO cambió (sha idéntico), así que lo que se editó fue EL ESPEJO
```

## Cómo re-espejar

Cuando Diseño ratifique un cambio: correr el mismo parser que usa la
verificación de vigencia sobre `diseno/SISTEMA_DISENO.md`, regenerar
`tokens.json` con su `sha256_fuente_al_espejar` y su `fecha_espejado`, y correr
la suite. **Si INTEGRIDAD se pone roja, el que está mal es el artefacto** — se
corrige el CSS, no el espejo.

## Qué NO espeja

Los 20 tokens que el sistema **nombra sin valuar** (`--sp-*`, `--r-*`, `--fs-*`,
`--mo-*`). No se inventan valores. Están listados en `POBLACION` para que la
ausencia sea **declarada y no silenciosa**: el día que la fuente les dé valor,
el conteo cambia y la vigencia se pone roja.
