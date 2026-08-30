# Hardening local de Landing y publicación

Estado: **implementación y evidencia exclusivamente locales · no desplegado**
Fecha: 2026-08-23

## Límite del resultado

No se encontró una vulnerabilidad de código explotable en el artefacto local
auditado. Eso no equivale a ausencia universal de vulnerabilidades ni acredita
configuración remota, headers vivos o identidad limpia del artefacto servido.

El antecedente no se normaliza: el push `b71776c`, su CI y publicación fueron
verdes y ambos dominios respondieron 200, pero el sentinel servido declaró
`b71776c…+sucio(M vercel.json)`. La ref nominal estaba presente; el árbol limpio
y exacto no quedó acreditado.

## Prevención local

- El workflow limita el token a `contents: read`.
- Checkout no persiste credenciales Git.
- El publicador sólo es alcanzable bajo `success()`, `push` y `main`.
- Las dos referencias `secrets.*` sólo pueden existir en el `env` exacto del
  paso publicador.
- La política AST analiza el JavaScript **emitido**, falla ante parse error y
  admite únicamente las capacidades usadas por el script vigente.

La política AST no ejecuta snippets. Su allowlist cubre llamadas, globals,
miembros, escrituras y atributos adjudicados; rechaza calls/escrituras
computadas. No se declara análisis de data-flow exhaustivo: aliases construidos
por reflexión y nombres dinámicos que sólo se leen quedan fuera de una garantía
universal de JavaScript. Por eso se conserva también el análisis del artefacto
HTML/CSS y la regla de un único script inline.

## Marker y detección post-publicación

El prototipo `scripts/releaseIdentity.ts` define el mismo schema para App y
Landing:

```json
{
  "schema": 1,
  "artifact": "app | landing",
  "commit_sha": "40 hex",
  "tree_sha": "40 hex",
  "clean": true
}
```

Si Git está sucio, `clean` es `false` y se agrega sólo el primer
`dirty_path` de porcelain. Un fixture con `vercel.json` trackeado y modificado
reproduce `M vercel.json`: explica por qué el diseño del sentinel lo declara,
no quién modificó el archivo durante el build externo.

El verificador black-box exige por objetivo:

1. schema exacto y respuesta acotada;
2. artifact, commit y tree esperados;
3. `clean: true`;
4. dos rondas conjuntas consecutivas, con cuerpos byte-idénticos por objetivo;
5. timeout por lectura, intentos y backoff acotados;
6. logs con nombre opaco, nunca URL, query ni cuerpo.

No está conectado al workflow ni a hooks. Es **detección posterior**, no
prevención: para cuando compara, el side effect puede haber ocurrido.

## Release parcial y rollback

App se dispara antes que Landing. El segundo hook puede fallar después de que
el primero haya sido aceptado; dos markers permiten detectar esa divergencia,
pero no la vuelven atómica. No existe en este repo evidencia suficiente para
elegir promoción de artefacto, deduplicación de hooks ni rollback. Esos tres
puntos necesitan primero contrato y medición de la plataforma remota.

### Preparación local posterior · 2026-08-25

Ya existe una fase manual, sin promoción, para reemplazar la reconstrucción
remota por dos artefactos Build Output API v3 sellados. El manifiesto externo
cubre `config.json` y todos los estáticos; el verificador post-transporte
recalcula cada SHA-256 antes de invocar Vercel. El despliegue experimental usa
`--prebuilt --prod --skip-domain`, de modo que permite medir URLs inmutables sin
mover los dominios públicos.

El pipeline separa cuatro runners: `gate` construye sin secretos;
`verify_transport` ejecuta los verificadores transportados sin Environment;
`stage` es el único que puede recibir `VERCEL_TOKEN` y vuelve a tratar el BOSA
como datos con un verificador inline, retirando las herramientas antes de
inyectar el token; `verify_remote` comprueba las URLs desde otro runner sin
secretos. `stage` no hace checkout, `npm ci`, tests ni builds. Los bindings
públicos se contrastan por ID y nombre antes de cada deploy y después se
readjudica cada deployment por ID, proyecto, target y estado `READY`.

Esto reduce la deuda local, pero no cambia su clasificación externa: todavía
faltan ejecutar el stage autorizado, observar ambos proyectos, medir la
identidad servida y probar rollback antes de sustituir los Deploy Hooks. No se
declara una promoción atómica entre App y Landing porque Vercel no ofrece esa
transacción cross-project; la fase productiva deberá compensar explícitamente
una promoción parcial.

## Inventario de headers · propuesta, no configuración servida

La configuración de Vercel nace del módulo programático raíz `vercel.mjs`, pero
falla cerrada por identidad de proyecto. Por eso **no se agregan headers
globales** ni reglas compartidas entre artefactos.

| Header | Estado local | Evidencia pendiente |
|---|---|---|
| `X-Content-Type-Options: nosniff` | candidato, no aplicado | seam por proyecto y prueba de assets App/Landing |
| `Referrer-Policy: strict-origin-when-cross-origin` | candidato, no aplicado | compatibilidad de navegación y 3DS |
| CSP / `frame-ancestors` / X-Frame-Options | bloqueado | allowlist real de Stripe.js, Elements, API y 3DS |
| COOP / COEP / CORP | bloqueado | inventario cross-origin y prueba física |
| Permissions-Policy | bloqueado | política de producto/capacidades por origen |

La App usa API cross-origin, Stripe.js, iframes de Elements y confirmación 3DS.
Una política de Landing aplicada a `/(.*)` en el config compartido podría romper
el riel ratificado de tarjeta. Ningún test local autoriza afirmar que estos
headers estén servidos.

### Excepción aislada por proyecto · las dos rutas Meta (2026-08-29)

Orden `APP-FE-META-PUBLIC-ROUTING-ISOLATION-03-CODEX`. `vercel.mjs` exige
`PAYME_VERCEL_ARTIFACT` con valor exacto y sin default. `app` recibe las dos
rutas; `landing` recibe listas vacías. Una variable ausente, vacía o distinta
aborta la configuración antes de exportarla.

| Header | Estado local | Alcance |
|---|---|---|
| `Cache-Control: no-store` | aplicado, path-scoped | `/privacy` y `/facebook-data-deletion/:code`, y nada más |
| `Referrer-Policy: no-referrer` | aplicado, path-scoped | `/privacy` y `/facebook-data-deletion/:code`, y nada más |

**La excepción es exactamente esa y se verifica como censo cerrado**, no como
permiso. Los tests ejecutan el módulo en procesos aislados para `app`, `landing`
y valores adversariales; fijan rutas, headers y `deploymentEnabled.main=false`.
Ninguna regla alcanza `/`, assets, la App privada ni Landing.

Antes de preview o release, el proveedor debe acreditar bindings project-scoped
en Production y Preview: `payme-app=app` y `payme-landing=landing`. Hasta medir
ambos proyectos y sus rutas reales, el estado es
`NO_VERIFICABLE_BLOQUEANTE_DE_RELEASE`.

🔴 **Lo que estos tests acreditan es la CONFIGURACIÓN del repo, no las cabeceras
servidas.** Que Vercel las emita —y que las emita en el proyecto correcto, con
el Root Directory correcto— sigue siendo **gate externo previo a producción**,
igual que el resto de esta tabla. La distinción no es formal: el mismo archivo
gobierna dos proyectos cuya separación remota este repo no puede observar.

## Deudas que requieren evidencia externa

- primer run manual del pipeline prebuilt, con artifact ID/digest y hashes de
  ambos manifiestos;
- Root Directory, build/output y auto-deploy efectivos de ambos proyectos;
- causa histórica de `M vercel.json` en el build servido por el camino Hook;
- bindings `PAYME_VERCEL_ARTIFACT` Production+Preview y rutas/headers servidos;
- binding/deduplicación del hook respecto del commit;
- promoción y rollback compensatorio de una publicación parcial;
- compatibilidad y medición de headers por origen.

La cita vencida de `AGENTS.md` raíz y el drift de `diseno/SPEC_LANDING.md` se
reportan al Bibliotecario. Este trabajo no edita raíz, `ops/` ni Diseño.
