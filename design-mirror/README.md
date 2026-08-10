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

**El motivo es que es OTRO repo, no que no haya repo.** Un runner de CI hace
checkout de *este* repo y punto: `diseno/SISTEMA_DISENO.md` no existe ahí. Una
guarda que lo lea directo anda en la Mac y falla en CI — o peor, lo saltea y
pasa en verde, que es la clase que este repo viene persiguiendo.

### 🔴 Corrección · acá decía «`diseno/` no está versionado» y era falso

```
        08:09:08   202ae1b escribe acá «diseno/ no está versionado»   ← cierto
        08:11:03   c35570e «El sistema de diseño entra bajo control
                            de versiones»                             ← deja de serlo
        ─────────
        115 segundos de vigencia · ~15 h publicado como si siguiera valiendo
```

Hoy `git -C diseno rev-parse --git-dir` contesta `.git`, hay 41 archivos
trackeados y **`SISTEMA_DISENO.md` es uno de ellos**. La frase no fue inventada:
fue **medida, correcta, y nunca vuelta a medir**. Es exactamente la forma que el
Bibliotecario nombró ese mismo día en otros dos repos —un número correcto en su
momento, propagado como si siguiera vigente— y la cometió el archivo que
existía para evitar que un dato viejo pasara por ratificado.

**Regla que deja:** una afirmación sobre el estado de algo que vive fuera de
este repo se escribe **con la fecha en que se midió**, o no se escribe. Sin
fecha, nadie sabe si hay que volver a mirarla.

### Qué cambia y qué no

| | |
|---|---|
| **No cambia** | VIGENCIA se sigue salteando en CI: el archivo no está en *este* checkout. El espejo sigue siendo necesario. |
| **Sí cambia** | Ya **no es imposible** anclar a la fuente: con la fuente versionada se le puede fijar un commit, como hace `contract-mirror/` con el backend. Deja de ser «nunca» y pasa a ser trabajo con orden propia — **no implementado acá**. |
| **Se resolvió** | El ⚠️ que decía «sin historia, sin diff y sin forma de volver atrás», elevado a Mati: **ya tiene las tres**. Se resolvió dos minutos después de escribirlo y este archivo lo siguió reportando abierto. |

## Las tres verificaciones, y por qué no se funden en una

`scripts/tokensRatificados.test.ts`:

| | Qué mide | ¿Corre en CI? |
|---|---|---|
| **INTEGRIDAD** | los dos artefactos coinciden con el espejo | **sí, siempre** |
| **POBLACIÓN** | el espejo no perdió tokens en silencio | sí |
| **SIN ANCLA** | los tokens que el sistema nombra pero no valúa (`--r-*`) no se separan entre artefactos | sí |
| **VIGENCIA** | el espejo sigue igual a la fuente | **no — se SALTEA** |

🔴 **VIGENCIA necesita la fuente, y en el checkout de CI no está** —vive en el
repo `diseno`, que es otro—. Cuando falta, el test se **saltea con su motivo**,
no se aprueba:

```
Tests  N passed | 1 skipped
  ↓ VIGENCIA … [NO CERTIFICADO: … no existe en este checkout …]
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
