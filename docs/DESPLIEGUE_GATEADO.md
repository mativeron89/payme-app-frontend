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

## Mínimo privilegio local del workflow · 2026-08-23

El workflow declara `permissions: contents: read` y el checkout usa
`persist-credentials: false`: los gates necesitan leer el árbol, no conservar
una credencial Git ni escribir contenidos. Una guarda estructural censa además
que las dos referencias `secrets.*` vivan únicamente en el `env` del paso
publicador correspondiente.

⚠️ `actions/checkout@v4` y `actions/setup-node@v4` siguen siendo tags mutables.
No se inventó un pin offline: elegir el commit exige verificar la referencia
oficial en una fuente externa autorizada. Esa deuda queda abierta; el
hardening local no la disfraza de resuelta.

## 🔴 Lo que este gate NO cubre · corregido el 2026-08-10

Acá decía que `deploy-demo.yml` publica «sin gate» y que su copia «puede quedar
publicada desde un commit cuya suite falló». **Las dos cosas son falsas:** en
Actions un paso que falla aborta el job, así que `npm test` en rojo no llega al
`upload-pages-artifact`.

⚠️ **El problema real es otro, y es peor.** Los dos caminos corren pruebas, pero
corren pruebas **distintas**:

| Camino | Qué corre antes de publicar | Adónde |
|---|---|---|
| `ci.yml` | integridad del espejo · test · typecheck · build · **Playwright** | Vercel |
| `deploy-demo.yml` | test · typecheck · build | Pages |

**A Pages le faltan dos: los recorridos de navegador y el gate del contrato
espejado.** Un commit que pasa los unitarios y reprueba Playwright —o que rompe
la integridad del espejo— **se publica en Pages y no en Vercel**: las dos
superficies divergen, con la menos verificada arriba.

No se arregla agregándole pruebas a `deploy-demo.yml` sin decidirlo: se arregla
**retirando ese camino** cuando cierre su ventana de gracia, que es la orden que
ya existe.

### ✅ Y el 2026-08-10 pasó, con un commit real

`82a833e` cambió copy visible y dejó cuatro e2e afirmando el texto viejo:

```
22:17:35  Pages publica          ← no corre Playwright
22:21:15  CI FAILURE · paso 11 «Publicar en Vercel» SKIPPED
          producción retenida en el bundle anterior
22:44:17  con el arreglo: CI verde, paso 11 success, producción avanza
```

**Las dos mitades del candado quedaron medidas en el pipeline real**, sin
provocar ninguna. Antes estaba probado sólo contra un `curl` sustituido.

⚠️ **Dicho con precisión, porque descrito de más se desarma:** ese día **Pages
tenía el copy CORRECTO y producción el viejo**, y los tests fallaban por
afirmar el texto anterior. **No fue producto roto.** 🔴 **Lo que el episodio
acredita no es el daño de ese día: es que el camino de Pages publica sin
preguntarle a Playwright — y la próxima vez el contenido puede ser un fallo
real.**

## Y una verificación estática del candado, que sí se puede hacer

`success()` en Actions es **de alcance por job**. Este repo tiene **un solo job**
(`build`) en `ci.yml`, así que `success()` en el paso de publicar cubre todos
los pasos anteriores. 🔴 **Con dos jobs sin `needs:`, habría cubierto sólo el
suyo y el candado sería decorativo.** Queda acreditado por configuración, sin
tener que provocar un CI rojo.

El caso `82a833e` de arriba sí observó un CI rojo real y el paso publicador
omitido. Lo que esa observación **no** acredita es identidad del artefacto
servido: demuestra que el hook no se llamó desde ese run, no que un run verde
produzca bytes limpios ligados al commit.

## Identidad servida · evidencia nueva del 2026-08-23

El push autorizado de `b71776c81d90021aae58879ceb1669d8ef0949c5` tuvo CI run
`32662494432` verde, paso publicador verde y HTTP 200 en App/Landing. El bundle
servido declaró, sin embargo:

```
b71776c81d90021aae58879ceb1669d8ef0949c5+sucio(M vercel.json)
```

Eso acredita el HEAD nominal y, al mismo tiempo, refuta que el árbol servido
quede probado como limpio/exacto. La causa externa de la modificación no se
determinó en este carril y no se corrige excluyendo `vercel.json` del sentinel.

`scripts/releaseIdentity.ts` materializa sólo un prototipo local: markers
canónicos para App/Landing y verificación black-box con timeout, backoff y dos
rondas conjuntas byte-idénticas. **No está cableado al workflow.** Una comprobación
post-deploy detecta después del side effect; no previene, no vuelve atómicas
las dos publicaciones y no hace rollback. El modelo de prevención/promoción y
la respuesta ante release parcial siguen pendientes de evidencia y decisión
de plataforma.

---

## 🔴 El camino de Pages se RETIRÓ · 2026-08-21

`deploy-demo.yml` **ya no existe**. Publicaba tres artefactos en
`https://mativeron89.github.io/payme-app-frontend/` — demo mock en `/`, build
real contra Railway en `/live/`, landing en `/landing/` — en cada push a `main`.

### Por qué, medido y no supuesto

El 2026-08-21 se publicó por primera vez la web productiva con este workflow
todavía vivo. Los dos corrieron **en paralelo** sobre el mismo commit y los dos
salieron verdes. **Ese verde no dice nada sobre lo que habría pasado en rojo**, y
ahí estaba el problema, que no es el que se le atribuía:

| camino | verificaba | publicaba |
|---|---|---|
| `ci.yml` | espejo · test · typecheck · build · **Playwright** | Vercel → `paymemx.com`, `app.paymemx.com` |
| `deploy-demo.yml` | test · typecheck · build | Pages |

⚠️ **La acusación corriente era falsa y la propagué en el comentario de
`ci.yml`:** Pages **no** publicaba «sin gate» — un paso en rojo aborta el job, así
que había compuerta. Lo que tenía era una compuerta **más débil**, sin Playwright
ni integridad del espejo. **Eso es peor que no tener ninguna**, porque un commit
que reprueba los recorridos de navegador **se publicaba en Pages y no en
Vercel**: las dos superficies divergían con **la menos verificada arriba**.

### Dónde queda la demo — y esto es lo que hay que saber

🔴 **No desaparece: se congela.** Retirar el workflow deja de actualizar Pages;
**el último artefacto publicado sigue sirviéndose** en
`https://mativeron89.github.io/payme-app-frontend/` hasta que alguien **apague
Pages en la configuración del repositorio**. Eso es una acción de plataforma y
**está fuera del alcance de las sesiones**: la decide y la ejecuta Mati.

⚠️ **Lo que eso significa mientras tanto:** esa URL va a mostrar el estado del
front al 2026-08-21 **para siempre**, sin avisar que quedó vieja — incluida la
copia `/live/`, que apunta al backend real de Railway. Quien la use para mirar
«cómo está la app» va a estar mirando una foto. **El riesgo se declara acá porque
apagarlo no es una decisión de este repo.**

### Qué lo guarda ahora

`scripts/despliegue.test.ts` dejó de medir la divergencia entre dos caminos y
pasa a afirmar que hay **UNO SOLO**, derivándolo del árbol: un workflow «publica»
si despliega Pages o llama a `publicar-vercel.sh`, y el censo escanea
`.github/workflows/`. **Un camino nuevo aparece solo** en vez de necesitar que
alguien se acuerde de anotarlo — una lista de lo conocido falla abierta.
