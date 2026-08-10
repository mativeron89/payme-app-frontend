# Por qué `vercel.json` apaga el despliegue automático

**No lo enciendas de vuelta sin leer esto.** El archivo dice
`"deploymentEnabled": { "main": false }` y no lleva explicación adentro porque
`vercel.json` es JSON estricto: una clave que Vercel no reconozca puede
invalidar la configuración de despliegue entera. **El porqué vive acá, y hay una
guarda que se pone roja si alguien lo flipea** —`scripts/despliegue.test.ts`—,
que es más fuerte que un comentario: un comentario no se pone rojo.

## El defecto que lo motivó · medido el 2026-08-10

Vercel publicaba en cada push, en paralelo con el CI. Los tiempos reales del
commit `a79c6a3`:

```
push                              06:01:05Z
deploy-demo.yml (Pages) termina   06:02:53Z
ÁPICE PUBLICADO por Vercel        06:03:01Z   ← producción viva
CI (vitest + typecheck + e2e)     06:05:56Z   ← 2 m 55 s DESPUÉS
```

**Producción estuvo viva casi tres minutos antes de que terminara la
verificación.** Y el gate que existía estaba puesto del lado equivocado:
`deploy-demo.yml` declara que *«Pages no publica un artefacto cuyo
comportamiento no pasó la suite»*. Es cierto — **y protegía la copia que nadie
visita**. Si la suite se ponía roja, Pages se plantaba en el commit anterior y
**Vercel publicaba igual**.

O sea: el dominio de Mati no tenía ninguna compuerta de calidad.

## Cómo queda

```
1 · vercel.json apaga el despliegue automático de `main`
2 · ci.yml, al final y sólo si TODO pasó, llama al Deploy Hook de cada proyecto
```

**Se eligió esta forma sobre apagarlo desde la interfaz de Vercel porque queda
en git**: se ve quién lo cambió y cuándo. Antes no se podía saber qué versión
estaba publicada sin abrir el panel de Vercel.

## 🔴 Dos proyectos, un solo archivo

`payme-app` y `payme-landing` leen **este mismo repo**. Un único `vercel.json`
en la raíz los apaga a los dos **si los dos tienen la raíz del repo como Root
Directory** — que es lo esperable, porque los dos corren `npm run build …` desde
acá.

⚠️ **Eso NO está verificado desde el repo y no se puede verificar desde acá.**
Si algún proyecto tuviera otro Root Directory, buscaría su `vercel.json` en esa
subcarpeta, no encontraría éste, y **seguiría publicando solo**.

**Se verifica observando el primer push con el gate puesto:** ninguno de los dos
proyectos debe desplegar por su cuenta, y los dos deben desplegar recién cuando
el CI llama a los hooks. Hasta que eso se observe, el gate está **implementado,
no acreditado**.

## Las cuatro condiciones del paso de publicación

1. **Si cualquier test, typecheck o build falla, el hook no se llama.** En
   Actions un paso con `if:` conserva el `success()` implícito, pero acá está
   escrito explícito: la regla no debería depender de que quien lo lea conozca
   esa sutileza.
2. **Sólo en `push` a `main`.** Nunca en pull request.
3. 🔴 **Si el `curl` falla, el job falla.** Un `curl` que devuelve error y no
   corta deja creyendo que se publicó. Es la misma clase que el
   `${PIPESTATUS[0]}` vacío en zsh que dejó cuatro `exit=` en blanco: **el gate
   informó y no bloqueó.**
4. **La URL del hook no se imprime.** GitHub la enmascara por ser secreto, pero
   no se escribe igual.

## Lo que este gate NO cubre

**`deploy-demo.yml` sigue publicando GitHub Pages en cada push, sin gate.** No
se toca todavía: está en su ventana de gracia de siete días, y cuando cierre se
retira por orden propia.

⚠️ **Mientras tanto hay DOS caminos de publicación y sólo uno está gateado.** La
copia de Pages puede quedar publicada desde un commit cuya suite falló. No es
producción —nadie la visita— pero está viva y es pública.
