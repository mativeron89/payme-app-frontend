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

## Inventario de headers · propuesta, no configuración servida

`vercel.json` es compartido por dos proyectos cuya separación remota no puede
probarse desde el repo. Por eso **no se agregan headers globales**.

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

## Deudas que requieren evidencia externa

- commits oficiales a los que pinnear `actions/checkout` y `actions/setup-node`;
- Root Directory, build/output y auto-deploy efectivos de ambos proyectos;
- causa de `M vercel.json` en el build servido;
- binding/deduplicación del hook respecto del commit;
- prevención, promoción y rollback de una publicación parcial;
- compatibilidad y medición de headers por origen.

La cita vencida de `AGENTS.md` raíz y el drift de `diseno/SPEC_LANDING.md` se
reportan al Bibliotecario. Este trabajo no edita raíz, `ops/` ni Diseño.
