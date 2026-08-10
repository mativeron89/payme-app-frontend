# Inventario de copy de UI · App del comensal

**Para `D-IDIOMA-1`.** Todo el texto que una persona LEE en pantalla en
`payme-app-frontend`, para que Diseño traduzca con la frase a la vista y no
adivinando. Generado el 2026-08-10 sobre `6864e43`.

```
828 apariciones · 727 textos únicos · 36 archivos
```

✅ **RECONCILIADO el 2026-08-10.** Tres lentes ciegas barrieron el repo sin ver
esta lista y nombraron 242 candidatos únicos. **Faltantes reales: CERO.** Un
verificador abrió cada archivo antes de acusar — varios «faltantes» no existían
textualmente. Y un barrido independiente de todo `src/` encontró 53 literales
sin cubrir: **todos clases CSS, claves y formatos. Cero copy nuevo.**

## Cómo se midió, y por qué no con `grep`

**Por AST, con el compilador de TypeScript.** Un string que el formateador
partió en tres líneas es invisible para un `grep` de una línea; para un parser
el salto de línea no existe. No es teórico — el `console.error` de
`walletRail.ts:204` está partido con `+` y el AST lo encontró entero.

🔴 **Y el AST solo no alcanzó.** Cinco lentes independientes barrieron el repo
sin ver esta lista, y un reconciliador verificó cada hallazgo contra el archivo.
**Encontraron 100 textos únicos que se me habían escapado —un 12 %—**, todos por
el mismo punto débil: **el discriminador de UNA sola palabra.**

| El hueco | Qué perdía |
|---|---|
| Pedía un espacio o un acento para considerar algo «frase» | **toda etiqueta de una palabra sin acento**: `Inicio`, `Mesas`, `Volver`, `Cancelar`, `Entrar` |
| La regex de palabra suelta estaba anclada en `$`, sin puntuación | **la familia entera de botones en curso**: `Procesando…`, `Guardando…`, `Enviando…`, `Autorizando…`, `Confirmando…` |
| Descartaba la minúscula suelta para matar enums | **los plurales en ternario**: `miembro`/`miembros`, `visita`/`visitas`, `vez`/`veces`, y `ayer` |
| Sólo miraba `src/` | el `<title>` de la pestaña |

🔴 **El caso que mejor lo muestra**, y que ninguna lente nombró — lo derivó el
reconciliador: `CreateMesaFlow.tsx:1127` dice `hay $X de ${diff > 0 ? 'más' :
'menos'}`. **`más` estaba en el inventario y `menos` no.** Las dos mitades de la
misma frase, en la misma línea: una entró por su acento y la otra no tenía
ninguno.

**Todos corregidos, y la corrección no fue ampliar la heurística sino cambiar de
pregunta:** ya no se pregunta si el string *parece* una frase, sino **qué hace
el código con él**. Si está entre tags, se ve. Si la función lo *devuelve*, es
parte de lo que produce; si se lo *pasa* a otra función, es un token de esa
otra. Las clases CSS se descartan **leyendo el CSS real**, no adivinando por
forma.

Lo dejo escrito porque en un inventario el número que importa no es cuánto
encontró, sino cuánto se le escapó — y a éste se le escapó en tres pasadas.

## 🔴 Lo que NO entra, y por qué

**Textos legales: FUERA, sin excepción.** Verificado por tres caminos
independientes: `src/api/index.ts` no consume ningún endpoint legal, `PAGES` no
tiene ruta legal, y `grep dangerouslySetInnerHTML|innerHTML` sobre `src/` da
cero. **Este repo no muestra ni un documento legal.**

⚠️ **Pero está limpio por AUSENCIA, no por diseño.** `LoginScreen.tsx` crea
cuentas sin mostrar ni enlazar ningún aviso —cero menciones de privacidad,
términos o consentimiento— mientras el backend ya tiene `legal_texts`,
`consent_events` y `services/consent.js` esperando. **Cuando alguien tape ese
hueco va a agregar copy legal a una pantalla recién traducida.** Es gap de
producto, no de idioma, y no se resuelve acá — pero conviene avisar antes.

**Wallet dormido: 63 frases EXCLUIDAS a propósito.** `TopupScreen`,
`TransferScreen` y `TX_LABEL` son el riel saldo, apagado por capability del
backend y fuera del MVP por acta. Las rutas existen en el switch pero **nadie
navega a ellas** (cero `navigate` fuera de esas pantallas). Se excluyen y queda
escrito: una ausencia sin registro se lee como descuido y alguien la «completa».

**Fuera también:** datos del mock (91), mensajes de `console.*` y `new Error`
que no se muestran (30), clases y valores CSS, paths de SVG.

## 🔴 Los cinco límites del método · lo que este inventario NO cubre

Están declarados, no descubiertos: traducir sabiendo esto es trabajo válido.

1. **Frases COMPUESTAS en runtime.** Medido ejecutando las 12 funciones que
   producen copy sobre su dominio: **una sola** se arma de fragmentos
   independientes — `metaInvitacion()` → `Mesa PA-4520 · hace 8 min`. Esa línea
   no existe en ningún archivo. Las otras 13 salidas fuera del inventario son
   **instancias de plantillas que sí están** (`+{n} mesas abiertas más`), y
   traducir la plantilla las cubre a todas.
2. **25 frases de wallet dentro de archivos vivos.** Medidas una por una:
   **ninguna es alcanzable** con el riel apagado —por bandera, por flujo o por
   datos—. No se traducen. Dos de ellas (`CreateMesaFlow:793`,
   `MesaScreen:1106`) dicen «Saldo insuficiente» en la rama de riel APAGADO:
   deuda cosmética, sin riesgo, verificado en el backend.
3. **Texto de terceros**: el iframe de Stripe y el `window.confirm` nativo.
4. **Formatos dependientes de locale**: `Intl.NumberFormat('es-MX')`,
   `toLocaleDateString`, y un segundo camino de importes (`centsToDisplay`).
5. **~4,8 % de ruido en el bloque B**: 21 de 443 son tokens técnicos —nombres de
   ícono, valores ARIA, enums—. 🔴 **No se filtran por «parece identificador»:
   de los 32 tokens ASCII minúsculos, 11 SÍ son copy** (`integrante`, `vez`,
   `entero`, `ayer`, `menos`). Filtrar por forma tiraría esos once.

## 🔴 Cuatro cosas que hay que decidir ANTES de traducir

**1 · Hay voseo rioplatense vivo en un producto que habla mexicano.** Tres
frases, y la guarda que existe para esto **pasa en verde**:

```
joinLinkView.ts:138            «Pedile a quien te invitó…»
reconciliacionMesaView.ts:159  «escribinos para resolverlo.»
LoginScreen.tsx:15             «Tu cuenta está suspendida. Escribinos.»
```

El patrón de la guarda exige á/é/í tónica **final**, y al pegarse un pronombre
el acento deja de estar al final: `Pedí` + `le` → `Pedile`. **Se escapa la clase
entera del voseo con enclítico.** Es defecto del español base y hay que
resolverlo antes de congelar el original, no después.

Y en la misma familia, léxico y no morfología: **`MesaScreen.tsx:589` y `:1341`
dicen «mozo», que es rioplatense; en México es «mesero».** La guarda no lo mira
—detecta verbos, no vocabulario— y no es una falla suya: es su límite.

**2 · La misma promesa está escrita de tres formas.** «segura, vía Stripe» con
punto, sin punto, y «seguro, vía Stripe». Si se traduce así, el inglés hereda
tres variantes de algo que debería ser una.

**3 · Diecisiete frases que parecen copy y son compromisos.** Van señaladas en
el cuerpo con 🔴. Cuatro familias:

- **retención ≠ cobro** — todo el modelo de garantía vive en esa distinción. Un
  solo «charged» y el organizador cree que le cobraron el total al abrir.
- **no-doble-cobro** — «no te cobramos de nuevo», «No volvimos a cobrarte».
  Verificables contra un extracto bancario: la traducción tiene que conservar
  el mismo grado de certeza, ni más ni menos.
- **tratamiento de datos** — «PayMe nunca ve el número completo» es una
  afirmación de privacidad escrita a mano en un componente, que no revisó nadie
  del lado legal. No pido sacarla; pido que no se reescriba libremente.
- **consentimiento** — «Guardar esta tarjeta para la próxima» es el texto de una
  autorización, no una etiqueta. Nace desmarcado por decisión de Mati.

**4 · Hay texto en pantalla que este selector NO va a poder cambiar.** Decirlo
ahora evita prometer una app bilingüe que no lo es:

| Qué | Por qué |
|---|---|
| Placeholders y errores del campo de tarjeta | Los escribe **Stripe** dentro de su iframe. Se cambian pasándole `locale`, que hoy no se pasa: es integración, no traducción. |
| Botones del diálogo de borrar tarjeta | Es un `window.confirm`: los pone el **navegador** según el idioma del sistema. Habría que reemplazarlo por uno propio. |
| Formato de importes | `Intl.NumberFormat('es-MX', …)` en `format.ts:8`, con locale clavada. Y hay un segundo camino, `centsToDisplay`, que arma `$210.00` a mano: si el selector toca uno solo, la app muestra dos formatos distintos. |
| Nombres de mes | `toLocaleDateString` en `historialView.ts` y `pagosView.ts`. Ya reciben el locale por parámetro — pero hoy nadie se lo pasa. |
| Tiempos relativos y plurales | «recién», «ayer», «hace 5 min», y plurales escritos a mano: `+1 mesa abierta más` / `+N mesas abiertas más`, `integrante` / `integrantes`. Son reglas, no strings. |

---

---

---

### Abrir mesa y garantía

_157 apariciones · 155 textos únicos_


**`src/screens/CreateMesaFlow.tsx`**

| línea | texto |
|---:|---|
| 233 | No pudimos identificar el restaurante: entra desde el QR de la mesa. |
| 241 | Este QR no corresponde a un restaurante disponible. |
| 308 | Hay una apertura anterior que no podemos atribuir de forma segura. Espera la reconciliación antes de abrir otra. |
| 391 | Esa mesa ya existe: {resultado.navegarA} |
| 432 | Hay una apertura de una sesión anterior. |
| 432 | Puede que la garantía ya exista. |
| 434 |  Ya sabemos cómo quedó: puedes reenviarla tal cual desde el botón de abajo. |
| 435 |  Está bloqueada hasta reconciliarla; no vamos a reenviarla ni abrir otra mesa. |
| 452 | Consultando… |
| 452 | Revisar cómo quedó esa apertura |
| 457 | Tienes una apertura sin confirmar. |
| 457 | Puede que la mesa ya se haya creado con su garantía. Reinténtala tal cual: si ya existe, te devolvemos esa misma mesa en vez de retener el total otra vez. |
| 469 | Agrega al menos un consumo. |
| 470 | Completa nombre y precio (mayor a cero) de cada consumo. |
| 601 | Elige cuántos son |
| 607 | No pudimos verificar una identidad segura para esta garantía. |
| 607 | Preparando una identidad segura para esta garantía… |
| 613 | No pudimos descartar una apertura anterior. No vamos a tokenizar otra tarjeta ni abrir otra mesa. |
| 614 | Estamos verificando que no exista otra apertura. Espera un momento. |
| 632 | Esta apertura pertenece a una sesión anterior. Está bloqueada hasta reconciliar su resultado; no abrimos otra mesa. |
| 640 | Elige con qué tarjeta reenviar esta apertura. |
| 670 | Carga los datos de la tarjeta para continuar. |
| 699 | Identificando el restaurante… prueba de nuevo en un momento. |
| 760 | La garantía sigue en verificación. No abras otra mesa ni cambies el método todavía. |
| 782 | La apertura pertenece a una sesión anterior. No la reenviamos ni iniciamos otra hasta reconciliarla. |
| 792 | Saldo insuficiente para garantizar: tienes {formatMXN(available)} disponibles y la mesa necesita {formatMXN(total)}. Carga saldo o garantiza con tarjeta. |
| 793 | Saldo insuficiente para garantizar: tienes {formatMXN(available)} disponibles y la mesa necesita {formatMXN(total)}. Garantiza con tarjeta. |
| 794 | No pudimos autorizar la garantía. Prueba con otro método. |
| 802 | Ese intento ya no sirve. Prueba de nuevo para abrir la mesa. |
| 807 | Tienes una apertura sin confirmar. Reinténtala tal cual antes de cambiar el ticket. |
| 810 | No pudimos abrir la mesa. Revisa el ticket y prueba de nuevo. |
| 816 | No pudimos confirmar la apertura. Puede que la mesa ya se haya creado: reintenta esta misma apertura, no armes otra. |
| 828 | No pudimos atribuir esta garantía a una intención segura. Espera la reconciliación antes de continuar. |
| 836 | Estamos recuperando la confirmación de tu banco. Toca reintentar en unos segundos. |
| 852 | Tu banco pudo haber autorizado la retención; todavía la estamos verificando. |
| 859 | El banco no autorizó la retención. Prueba con otra tarjeta. |
| 869 | No pudimos verificar la garantía. Reintenta esta misma confirmación; no abras otra mesa. |
| 889 | La invitación anterior venció. Toca de nuevo para generar otra. |
| 894 | La invitación pudo haberse creado, pero no recibimos el link. Reintenta esta misma operación; no generes otra. |
| 907 | El servicio no pudo confirmar el link. Reintenta esta misma operación; no generes otra. |
| 909 | No pudimos generar el link. Prueba de nuevo. |
| 910 | No pudimos confirmar el link. Reintenta la misma operación: vamos a reutilizarla para no crear otra invitación. |
| 922 | Tienes una apertura sin confirmar: reinténtala antes de cambiar la mesa |
| 964 | Paso 1 de 5 |
| 967 | Escanea el ticket |
| 983 | Subiendo la foto… |
| 983 | Encuadra el ticket dentro del marco |
| 1000 | No pudimos leer el ticket |
| 1002 | Prueba sacar la foto de nuevo con más luz, o carga los consumos a mano. |
| 1010 | Reintentar |
| 1013 | Cargarlo a mano |
| 1023 | La foto pesa más de 8 MB |
| 1024 | Prueba con menos calidad. |
| 1029 | Sacar otra foto |
| 1042 | Modo demo: |
| 1042 | Ojo: |
| 1044 | todavía no leemos la foto. Usamos un ticket de ejemplo para que puedas probar el resto del flujo. |
| 1045 | todavía no leemos la foto de verdad — sacala igual y vas a recibir un ticket de ejemplo para continuar. |
| 1072 | Capturar |
| 1104 | Paso 2 de 5 |
| 1106 | Restaurante |
| 1114 | Total |
| 1121 | title-card-note {totalMismatch ? 'warn' : ''} |
| 1124 | warning |
| 1124 | info |
| 1127 | No coincide con el total del ticket ({formatMXN(totalMismatch.printed)}): hay {formatMXN(Math.abs(totalMismatch.diff))} de {totalMismatch.diff > 0 ? 'más' : 'menos'}. |
| 1127 | más |
| 1127 | menos |
| 1128 | Checa que el total coincida con el total del ticket |
| 1137 | consumo {idx + 1} |
| 1142 | Consumo |
| 1146 | Nombre del consumo |
| 1151 | Precio por unidad |
| 1156 | 0 |
| 1163 | Cantidad de {etiqueta} |
| 1166 | Una unidad menos de {etiqueta} |
| 1175 | Una unidad más de {etiqueta} |
| 1181 | Eliminar |
| 1190 | tk-name {nombre ? '' : 'tk-sin-nombre'} |
| 1191 | Sin nombre |
| 1200 | Modificar {etiqueta} |
| 1217 | check |
| 1217 | pencil |
| 1218 | Listo |
| 1218 | Modificar ítems |
| 1222 | Agregar consumo |
| 1231 | Continuar |
| 1264 | Paso 3 de 5 |
| 1266 | ¿Cómo dividen? |
| 1273 | div-card {division === 'consumo' ? 'sel' : ''} |
| 1279 | Por lo que pidió cada uno |
| 1280 | Cada uno elige sus platos |
| 1284 | div-card {division === 'igual' ? 'sel' : ''} |
| 1295 | En partes iguales |
| 1296 | El total dividido entre todos |
| 1309 | card card-p{participants === null ? ' tip-block tip-block--pending' : ''}{stepperPulse ? ' tip-block--pulse' : ''} |
| 1315 | ¿Cuántos pagan? |
| 1315 | ¿Cuántos son en la mesa? |
| 1317 | Cantidad de comensales |
| 1320 | Un comensal menos |
| 1329 | Un comensal más |
| 1344 | base de propina · c/u |
| 1353 | Continuar |
| 1360 | Elige cuántos son |
| 1378 | Garantiza la mesa |
| 1394 | Garantía de la mesa |
| 1398 | Se retiene, no se cobra. Si todos pagan, se libera completa. |
| 1405 | Para abrir la mesa se retiene el total como garantía: el restaurante cobra sí o sí. Cuando todos pagan su parte, la retención se libera. Si alguien no paga, tu garantía cubre solo ese faltante. |
| 1416 | ¿Con qué garantizas? |
| 1428 | No podemos mostrarte con qué tarjeta se garantizó esta mesa. |
| 1430 | La mesa ya existe y su garantía sigue respaldada por la tarjeta original: la que elijas aquí acompaña el reenvío, no la reemplaza. |
| 1431 | Elige con cuál reenviar. |
| 1441 | method-card {method === 'card' && cardChoice === c.id ? 'sel' : ''} |
| 1460 | Principal |
| 1465 | Vence |
| 1473 | method-card {method === 'card' && cardChoice === 'new' ? 'sel' : ''} |
| 1487 | Usar otra tarjeta |
| 1487 | Tarjeta |
| 1489 | Retención en la tarjeta (puede pedir confirmación del banco) |
| 1498 | La ingresas al confirmar (segura, vía Stripe). |
| 1508 | Los datos van directo a Stripe: PayMe nunca ve el número completo. |
| 1518 | Guardar esta tarjeta para la próxima |
| 1523 | method-card {method === 'wallet' ? 'sel' : ''} |
| 1533 | Saldo PayMe |
| 1535 | Congela |
| 1535 | de tu saldo hasta que la mesa cierre |
| 1559 | Autorizando… |
| 1562 | Reconciliación necesaria |
| 1566 | Reintentar esta apertura |
| 1570 | Garantizar |
| 1570 | y abrir mesa |
| 1586 | Confirma con tu banco |
| 1588 | Volver a elegir la garantía |
| 1594 | Tu banco pide confirmar |
| 1597 | La retención de |
| 1597 | necesita que la confirmes con tu banco. |
| 1606 | En la versión final, aquí se abre la verificación de tu banco. |
| 1609 | Confirmando… |
| 1609 | Confirmar autorización |
| 1617 | Cancelar y elegir otra garantía |
| 1684 | Link de invitación copiado ✓ |
| 1684 | No se pudo copiar: tu navegador no habilitó el portapapeles |
| 1692 | Ver mesa |
| 1696 | ¡Mesa garantizada! |
| 1697 | Comparte el código para que se sumen |
| 1710 | Copiar el link de invitación de la mesa {code} |
| 1716 | btn share-wa {link ? '' : 'off'} |
| 1717 | Súmate a la mesa {code} en PayMe: {link} |
| 1722 | Compartir por WhatsApp |
| 1732 | Guarda el link: por seguridad se muestra |
| 1732 | una sola vez |
| 1732 | (después puedes generar otro desde la mesa). |
| 1739 | Generando el link… |
| 1747 | No pudimos generar el link |
| 1749 | La mesa está abierta igual: puedes invitar desde aquí abajo. |
| 1754 | Reintentar el mismo link |
| 1762 | Ir a Inicio |

### La mesa · dividir, elegir y pagar

_279 apariciones · 259 textos únicos_


**`src/screens/invitacionAdmision.ts`**

| línea | texto |
|---:|---|
| 117 | Mesa {inv.mesaCode} |
| 137 | Esta mesa ya cerró |
| 141 | No pudimos verificar esta invitación. Actualiza en un momento. |

**`src/screens/joinLinkView.ts`**

| línea | texto |
|---:|---|
| 124 | Sumándote a la mesa… |
| 125 | Un segundo. |
| 137 | Este link ya no funciona |
| 138 | Pedile a quien te invitó que te comparta uno nuevo. |
| 143 | Este link está incompleto |
| 144 | Puede haberse cortado al copiarlo. Pide que te lo manden de nuevo y ábrelo entero. |
| 151 | Esta mesa ya cerró |
| 152 | Habla con quien te invitó si crees que es un error. |
| 154 | Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras. |
| 158 | No pudimos verificar el link |
| 159 | No es que no sirva: no pudimos comprobarlo ahora. Prueba de nuevo en un momento. |
| 164 | No pudimos sumarte |
| 165 | Puede ser la conexión. Prueba de nuevo. |

**`src/screens/JoinMesaScreen.tsx`**

| línea | texto |
|---:|---|
| 237 | ¡Te sumaste a la mesa! |
| 247 | Ver mis ítems |
| 271 | Te invitaron a una mesa |
| 273 | Crea tu cuenta o entra para sumarte y pagar tu parte. |
| 286 | Te invitaron a una mesa |
| 291 | Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe |
| 299 | Crear cuenta gratis |
| 306 | Ya tengo cuenta · Entrar |
| 334 | Reintentar |
| 348 | Ir a PayMe |

**`src/screens/MesaDetailView.tsx`**

| línea | texto |
|---:|---|
| 100 | Pagado |
| 101 | Lo eligió otro |
| 103 | No pudimos leer este ítem |
| 104 | Queda {bpsLabel(item.remaining_bps)} |
| 141 | Copiar link de invitación |
| 150 | Tienes un pago sin confirmar. |
| 150 | Puede que ya se haya cobrado. Reinténtalo tal cual antes de cambiar tu selección. |
| 157 | Reintentar ese pago |
| 183 | No queda nada por pagar |
| 185 | No quedan partes |
| 187 | Elige lo que consumiste |
| 190 | Otra parte |
| 190 | Mi parte |
| 206 | Mesa |
| 206 | cada uno lo suyo |
| 206 | partes iguales |
| 215 | Pagado {pct}% de la mesa |
| 221 | de |
| 223 | mi-count {urgente ? 'urgent' : ''} |
| 224 | venció |
| 234 | Toca lo que consumiste. Al elegirlo queda |
| 234 | reservado |
| 234 | para ti. |
| 238 | Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues. |
| 244 | ¿Qué consumiste? |
| 246 | Márcalo para el restaurante — no cambia lo que pagas. |
| 271 | mi-row {sel ? 'sel' : ''} |
| 275 | {i.name}{i.quantity > 1 ? ` por ${i.quantity}` : ''}{tag ? `, ${tag}` : ''} |
| 275 | por {i.quantity} |
| 275 | , {tag} |
| 278 | mi-check {sel ? 'on' : ''} {state === 'pagado' ? 'paid' : ''} {state === 'tomado' ? 'taken' : ''} |
| 288 | mi-name {bloqueado ? 'dim' : ''} {state === 'pagado' ? 'paid' : ''} |
| 290 | × {i.quantity} |
| 294 | mi-price {bloqueado ? 'dim' : ''} |
| 302 | ¿Cuánto tomas tú? |
| 309 | seg-btn {myBpsSel === f.bps ? 'on' : ''} |
| 313 | Entero |
| 320 | Tu parte: |
| 330 | La cuenta se dividió en |
| 330 | partes iguales de |
| 331 | . Quedan |
| 331 | por pagar. |
| 341 | Ya pagaste |
| 341 | {mySlotsTaken} partes |
| 341 | tu parte |
| 342 |  Si tocas pagar de nuevo, cubres la parte de otro comensal. |
| 353 | Invitar amigos de PayMe |
| 363 | Continuar |

**`src/screens/MesaScreen.tsx`**

| línea | texto |
|---:|---|
| 154 | Elige tu propina |
| 154 | Tu propina |
| 157 | Tu base: |
| 157 | (la cuenta ÷ |
| 165 | tip-pill {elegida ? 'sel' : ''} |
| 176 | tip-pill tip-pill--otro {tip.mode === 'custom' ? 'sel' : ''} |
| 182 | Otro |
| 192 | 0.00 |
| 196 | Monto de propina a mano |
| 380 | La invitación anterior venció. Toca de nuevo para generar otra. |
| 384 | La invitación pudo haberse creado, pero no recibimos el link. Reintenta la misma operación; no generes otra. |
| 397 | Link de invitación copiado ✓ |
| 399 | El link ya se generó, pero no se pudo copiar. Toca de nuevo: no vamos a crear otro. |
| 407 | El servicio no pudo confirmar el link. Reintenta esta misma operación; no generes otra. |
| 409 | No se pudo generar el link |
| 410 | No pudimos confirmar el link. Reintenta la misma operación: vamos a reutilizarla. |
| 485 | Tienes un pago sin confirmar: resuélvelo antes de cambiar tu selección |
| 499 | No pudimos leer cuánto queda de ese ítem. Actualiza la mesa. |
| 509 | Tienes un pago sin confirmar: resuélvelo antes de cambiar tu selección |
| 536 | De ese plato queda solo {bpsLabel(rem)} |
| 536 | Ese plato ya está completo |
| 545 | Alguien ya tomó uno de esos consumos |
| 554 | No pudimos reservar lo que elegiste |
| 574 | Comprobante PayMe |
| 575 | Restaurante: {mesa.restaurant.name} |
| 576 | Mesa: {code} |
| 577 | Fecha: {new Date().toLocaleString('es-MX')} |
| 578 | Método: {result.methodLabel} |
| 582 | Cobrado por: {mesa.restaurant.name} |
| 584 | En tu resumen de tarjeta: {result.statementDescriptor} |
| 588 | {mesa.division_mode === 'igual' ? 'Mi parte' : 'Mis consumos'}: {formatMXN(result.itemsAmount)} |
| 588 | Mi parte |
| 588 | Mis consumos |
| 589 | Propina (al mozo): {formatMXN(result.tip)} |
| 590 | Total pagado: {formatMXN(result.gross)} |
| 598 | Comprobante PayMe |
| 603 | Comprobante copiado ✓ |
| 604 | No se pudo copiar: tu navegador no habilitó el portapapeles |
| 660 | Hay un pago de una sesión anterior. No vamos a reenviarlo ni iniciar otro hasta reconciliarlo. |
| 663 | Hay un pago anterior que no podemos atribuir de forma segura. Espera la reconciliación antes de pagar. |
| 769 | Ese pago ya está registrado ✓ |
| 775 | No pudimos consultar el estado de la mesa. Prueba de nuevo en un momento. |
| 789 | Listo: puedes pagar de nuevo |
| 791 | No pudimos cerrar ese intento. Sigue bloqueado por seguridad. |
| 834 | Ese pago se cobró y después te lo reembolsaron. No volvimos a cobrarte. |
| 854 | Se cortó la conexión mientras el banco confirmaba. No reintentes con otro método: toca "Reintentar el pago sin confirmar". |
| 863 | Tu banco aprobó la operación; todavía estamos confirmando el pago. Reintenta esta misma confirmación, sin cambiar el método. |
| 872 | Ese pago no prosperó. Puedes iniciar uno nuevo. |
| 881 | Estamos confirmando este pago. No inicies otro ni cambies el método hasta que se resuelva. |
| 888 | Saldo PayMe |
| 890 | Apple Pay |
| 892 | Ⓖ Google Pay |
| 893 | {savedCard ? `${savedCard.brand === 'visa' ? 'Visa' : savedCard.brand} ··${savedCard.last_four}` : 'Tarjeta'} |
| 893 | {savedCard.brand === 'visa' ? 'Visa' : savedCard.brand} ··{savedCard.last_four} |
| 893 | Visa |
| 893 | Tarjeta |
| 922 | No pudimos verificar una identidad segura para este pago. |
| 922 | Preparando una identidad segura para este pago… |
| 927 | Este pago no puede reenviarse desde la sesión actual. Sigue bloqueado hasta reconciliar su resultado. |
| 938 | Elige tu propina para pagar |
| 1007 | Ingresa los datos de la tarjeta para continuar. |
| 1079 | El pago pertenece a una sesión anterior. No lo reenviamos ni iniciamos otro hasta reconciliarlo. |
| 1088 | Ese intento de pago ya no sirve. Prueba de nuevo. |
| 1091 | Otra pestaña ya cerró este intento. Actualizamos la mesa antes de permitir una nueva acción. |
| 1097 | Tienes un pago sin confirmar en esta mesa. Reintenta ese mismo pago antes de cambiar nada. |
| 1105 | Saldo insuficiente: tienes {formatMXN(available)} disponibles y necesitas {formatMXN(gross)}. Carga saldo o paga con tarjeta. |
| 1106 | Saldo insuficiente: tienes {formatMXN(available)} disponibles y necesitas {formatMXN(gross)}. Paga con tarjeta. |
| 1111 | Para pagar con saldo PayMe tienes que iniciar sesión. |
| 1112 | Ese método de pago no está disponible. Paga con tarjeta. |
| 1115 | La mesa ya cerró. |
| 1118 | Ya no quedan partes por pagar en esta mesa. |
| 1123 | No pudimos completar el pago. Revisa la mesa y prueba de nuevo. |
| 1132 | No pudimos confirmar el pago. Puede que se haya cobrado igual: reintenta ESTE mismo pago, no armes otro. |
| 1147 | Mesa |
| 1150 | No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la cuenta. |
| 1155 | Reintentar |
| 1166 | Mesa |
| 1168 | Cargando mesa… |
| 1176 | Te invitaron a |
| 1176 | Te invitaron a |
| 1187 | ← Volver a mi cuenta |
| 1204 | Actualizar estado |
| 1213 | Cierre completado |
| 1220 | clock |
| 1223 | Se cerró por tiempo |
| 1223 | Quedó todo pago |
| 1226 | · Mesa |
| 1231 | Total mesa |
| 1235 | Pagado por los comensales |
| 1242 | Cubrió tu garantía |
| 1242 | Cubrió la garantía |
| 1250 | Recibió el restaurante |
| 1257 | Tu garantía cubrió |
| 1257 | El restaurante cobró el total y nadie quedó debiendo en la mesa. Pronto vas a poder pedirle ese monto a quien no llegó a pagar. |
| 1268 | Actualizar |
| 1272 | Inicio |
| 1288 | ¡Listo! |
| 1291 | Pagaste tu parte. |
| 1293 | La mesa sigue abierta para los demás. |
| 1296 | La mesa quedó completa. |
| 1303 | Comprobante |
| 1306 | Restaurante |
| 1310 | Mesa |
| 1314 | Método |
| 1320 | Cobrado por |
| 1326 | En tu resumen de tarjeta vas a ver |
| 1337 | Mi parte |
| 1337 | Mis consumos |
| 1341 | Propina (al mozo) |
| 1346 | Total pagado |
| 1353 | Con una cuenta PayMe puedes abrir la mesa tú la próxima vez. |
| 1362 | Enviar comprobante |
| 1365 | Descargar |
| 1374 | Ver la mesa |
| 1377 | Crear mi cuenta |
| 1382 | Inicio |
| 1395 | Pagar mi parte |
| 1397 | Volver a la mesa |
| 1404 | Reconciliación necesaria |
| 1404 | Pendiente de confirmar |
| 1404 | Pagas SOLO tu parte |
| 1412 | Pago sin confirmar |
| 1416 | No podemos reenviar este pago desde la sesión actual. No iniciaremos otro hasta reconciliarlo. |
| 1417 | Reinténtalo para saber si se cobró: mandamos el mismo pago, no uno nuevo. |
| 1429 | Consultando… |
| 1429 | Revisar si se cobró |
| 1435 | No encontramos ese pago en la mesa: no llegó a tomar tu parte. Si continúas, el próximo intento es un |
| 1436 | cobro nuevo |
| 1444 | Cerrando… |
| 1444 | Entiendo, desbloquear el pago |
| 1458 | Tu parte |
| 1458 | Tus consumos |
| 1459 | + propina {formatMXN(tipCents)} |
| 1463 | + propina (elige abajo) |
| 1477 | Confirmar propina |
| 1478 | Tu propina: |
| 1478 | Es más de 3 veces la base de |
| 1479 | (la cuenta ÷ |
| 1488 | Volver a editar |
| 1498 | Sí, pagar |
| 1504 | Confirmar parte adicional |
| 1505 | Desde este teléfono ya se pagó una parte de esta mesa. |
| 1507 | Tu parte ya figura pagada. |
| 1508 | Fue con otra sesión (link de invitado o tu cuenta). |
| 1509 | Si continúas vas a pagar una parte |
| 1509 | adicional |
| 1509 | , y se cobra aparte. |
| 1518 | Sí, pagar otra parte |
| 1524 | Cancelar |
| 1540 | Hay un pago que no podemos reenviar. |
| 1540 | Pertenece a una sesión anterior o se perdió su cuerpo exacto al recargar. Sigue bloqueado para evitar un segundo cobro. |
| 1542 | Tienes un pago sin confirmar. |
| 1542 | Puede que ya se haya cobrado. Reinténtalo tal cual está: si ya salió, no te cobramos de nuevo. Hasta resolverlo no puedes cambiar propina, método ni consumos. |
| 1548 | Ese pago se te |
| 1548 | reembolsó |
| 1548 | . No lo repetimos solos: si quieres pagar igual, toca el botón de abajo. |
| 1561 | No pudimos cargar las opciones de propina — tu pago sigue sin propina. |
| 1582 | ¿Para quién? |
| 1588 | tip-pill {staffId === s.id ? 'sel' : ''} |
| 1601 | Método |
| 1609 | Estás pagando tu parte en |
| 1610 | — PayMe divide la cuenta. |
| 1617 | method-card {payType === 'wallet' ? 'sel' : ''} |
| 1627 | Saldo PayMe |
| 1633 | method-card {payType === 'card' ? 'sel' : ''} |
| 1647 | Tarjeta de crédito o débito |
| 1651 | {cards.find((c) => c.id === cardChoice)!.bank_name ?? cards.find((c) => c.id === cardChoice)!.brand} ···· {cards.find((c) => c.id === cardChoice)!.last_four} |
| 1652 | Elige una guardada o usa otra |
| 1654 | La ingresas al confirmar (segura, vía Stripe) |
| 1655 | Ingresa los datos abajo (seguro, vía Stripe) |
| 1668 | Tarjeta guardada |
| 1672 | method-card {cardChoice === c.id ? 'sel' : ''} |
| 1684 | Principal |
| 1689 | Vence |
| 1696 | method-card {cardChoice === 'new' ? 'sel' : ''} |
| 1706 | Usar otra tarjeta |
| 1736 | Guardar esta tarjeta para la próxima |
| 1746 | method-card {payType === 'apple_pay' ? 'sel' : ''} |
| 1756 | Apple Pay |
| 1757 | vía Stripe |
| 1764 | method-card {payType === 'google_pay' ? 'sel' : ''} |
| 1775 | G |
| 1778 | Google Pay |
| 1779 | vía Stripe |
| 1787 | Es una demo: |
| 1787 | no se cobra nada de verdad y no hay ninguna tarjeta real conectada. |
| 1796 | Sin iniciar sesión pagas con tarjeta |
| 1796 |  o Apple Pay |
| 1797 |  (el saldo PayMe pide cuenta) |
| 1807 | Ese intento reembolsado requiere reconciliación antes de iniciar otro pago. |
| 1825 | Procesando… |
| 1827 | Reconciliación necesaria |
| 1829 | Reintentar el pago sin confirmar |
| 1831 | Pagar de nuevo {formatMXN(gross)} |
| 1832 | Pagar {formatMXN(gross)} |

**`src/screens/reconciliacionMesaView.ts`**

| línea | texto |
|---:|---|
| 86 | No pudimos verificar cómo quedó esa apertura. Prueba de nuevo en un momento; no vamos a abrir otra mesa mientras tanto. |
| 116 | acreditada |
| 123 | muerta |
| 128 | Esa apertura terminó sin quedar en pie (mesa {code}). Ya puedes abrir una nueva. |
| 129 | Esa apertura terminó sin quedar en pie. Ya puedes abrir una nueva. |
| 140 | La mesa {code} se creó, pero su garantía quedó sin confirmar. Podemos retomar ESA misma garantía; no abrimos otra mesa. |
| 141 | La mesa se creó, pero su garantía quedó sin confirmar. No abrimos otra mesa. |
| 149 | No encontramos ninguna mesa creada con este intento. Podemos reenviarlo tal cual: si llegó a crearse, te devolvemos esa misma mesa en vez de retener el total otra vez. |
| 155 | conflicto |
| 159 | Este intento no coincide con la apertura que quedó pendiente. No vamos a reenviarlo ni a abrir otra mesa: escribinos para resolverlo. |

### Inicio y mesas

_65 apariciones · 57 textos únicos_


**`src/screens/historialView.ts`**

| línea | texto |
|---:|---|
| 91 | Mañana |
| 92 | Mediodía |
| 93 | Tarde |
| 94 | Noche |
| 174 | Sin fecha |

**`src/screens/homeMesasView.ts`**

| línea | texto |
|---:|---|
| 45 | +1 mesa abierta más |
| 45 | +{n} mesas abiertas más |

**`src/screens/HomeScreen.tsx`**

| línea | texto |
|---:|---|
| 48 | Cuenta |
| 49 | Estadísticas |
| 50 | Asociadas |
| 56 | Hoy |
| 57 | Ayer |
| 162 | Ver tarjetas |
| 163 | Ver pagos |
| 170 | ¿Quieres ver qué consumes, cuánto y dónde? |
| 173 | Ver mis estadísticas |
| 198 | Todavía no está disponible |
| 200 | Asociar la cuenta de otra persona toca cómo se autoriza un pago, así que no la abrimos hasta tenerlo resuelto. |
| 210 | Tu mesa abierta |
| 218 | No pudimos cargar tu mesa |
| 219 | Revisa la conexión y prueba de nuevo. |
| 225 | Reintentar |
| 231 | Cargando tu mesa |
| 246 | Tu mesa abierta |
| 254 | Mesa |
| 260 | de |
| 270 | mesa-cd {cuenta.urgent ? 'urgent' : ''} |
| 271 | Vence en |
| 274 | Ver mesa → |
| 294 | No tienes mesas abiertas |
| 295 | Toca el + para abrir una |
| 305 | Los datos de ejemplo de esta demo ya vencieron. |
| 315 | Reiniciar la demo |
| 335 | Tu saldo PayMe |
| 344 | Ocultar saldo |
| 344 | Mostrar saldo |
| 347 | eye |
| 349 | Ir a Cuenta |
| 355 | Cargar |
| 362 | Transferir |
| 371 | Últimos movimientos |
| 373 | Ver más |
| 429 | Mesas abiertas |
| 433 | Tus otras mesas abiertas |
| 437 | Cerrar |
| 454 | Mesa |
| 461 | de |
| 464 | mesa-cd {cd.urgent ? 'urgent' : ''} |
| 465 | Vence en |

**`src/screens/MesasScreen.tsx`**

| línea | texto |
|---:|---|
| 40 | Hoy |
| 41 | Ayer |
| 115 | Historial |
| 123 | No pudimos cargar tu historial |
| 124 | Revisa la conexión y prueba de nuevo. |
| 128 | Reintentar |
| 132 | Cargando tu historial |
| 143 | Todavía no cerraste ninguna mesa. |
| 154 | hist-item {on ? 'on' : ''} |
| 162 | dining |
| 182 | hist-chevron {on ? 'on' : ''} |
| 194 | El detalle de esta mesa todavía no está disponible |
| 197 | No podemos confirmar que sea seguro de mostrar. Lo que pagaste tú es el monto de esta fila. |
| 214 | Atajo de demo: |
| 214 | mira cómo queda una mesa que venció sin que todos pagaran y la garantía cubrió el faltante. |
| 221 | Ver mesa vencida (ejemplo) → |

### Social · amigos, grupos, invitaciones

_97 apariciones · 87 textos únicos_


**`src/components/InviteFriends.tsx`**

| línea | texto |
|---:|---|
| 110 | La invitación anterior a {f.first_name} venció. Toca de nuevo para generar otra. |
| 115 | Invitación enviada a {f.first_name} ✓ |
| 123 | La mesa ya no acepta invitados |
| 125 | El servicio no pudo confirmar la invitación a {f.first_name}. Reintenta esta misma invitación; no generes otra. |
| 127 | No pudimos invitar a {f.first_name} |
| 128 | No pudimos confirmar la invitación a {f.first_name}. Reintenta la misma: vamos a reutilizarla. |
| 164 | {m.first_name} {m.last_name} |
| 188 | btn btn-sm btn-fit {done ? 'btn-ghost' : 'btn-outline'} |
| 192 | Invitado ✓ |
| 192 | Enviando… |
| 192 | Invitar |
| 205 | No pudimos cargar tus contactos |
| 207 | Puedes compartir el link igual mientras tanto. |
| 212 | Reintentar |
| 223 | Invitar |
| 226 | Buscar por nombre o ID |
| 229 | Buscar contactos para invitar |
| 233 | Ningún contacto coincide con “ |
| 238 | O invita a un grupo |
| 261 | integrante |
| 261 | integrantes |
| 264 | inv-chevron {abierto ? 'on' : ''} |
| 270 | Cargando integrantes… |
| 273 | No pudimos abrir el grupo. |
| 275 | Reintentar |
| 279 | Este grupo no tiene integrantes. |

**`src/screens/SocialScreen.tsx`**

| línea | texto |
|---:|---|
| 130 | Ahora son amigos con {quien} ✓ |
| 131 | Solicitud rechazada |
| 132 | Solicitud cancelada |
| 138 | Esa solicitud ya no está disponible |
| 146 | ¿Bloquear a {quien}? Se rompe la amistad y no van a poder mandarse solicitudes. |
| 149 | {quien} quedó bloqueado |
| 153 | No pudimos bloquear a esa persona |
| 166 | Si tiene PayMe, le va a llegar tu solicitud |
| 174 | No pudimos enviar la solicitud. Prueba de nuevo. |
| 185 | Grupo creado ✓ |
| 191 | No pudimos crear el grupo |
| 222 | Amigos |
| 223 | Grupos |
| 224 | Solicitudes |
| 235 | {detail.group.icon} {detail.group.name} |
| 241 | Miembros ( |
| 244 | Sin miembros todavía. |
| 248 | {m.first_name} {m.last_name} |
| 258 | Quitar a {m.first_name} del grupo |
| 265 | No se pudo quitar |
| 276 | Agregar del listado de amigos |
| 288 | No se pudo agregar |
| 297 | + sumar |
| 306 | ¿Eliminar el grupo "{detail.group.name}"? |
| 309 | Grupo eliminado |
| 313 | No se pudo eliminar |
| 317 | Eliminar grupo |
| 345 | Nuevo amigo |
| 351 | Nuevo grupo |
| 373 | Agregar amigo |
| 376 | Email o ID PayMe (payme_mx_xxxx) |
| 386 | Cancelar |
| 394 | Buscando… |
| 394 | Agregar |
| 404 | Buscar entre tus amigos |
| 405 | Buscar entre tus amigos |
| 410 | Cargando amigos… |
| 415 | Todavía no agregaste amigos. |
| 416 | Sin resultados para esa búsqueda. |
| 431 | Transferir a {f.full_name} |
| 439 | Quitar a {f.first_name} |
| 441 | ¿Quitar a {f.full_name} de tus amigos? |
| 444 | Amigo quitado |
| 447 | No se pudo quitar |
| 463 | Nuevo grupo |
| 466 | Nombre (Familia, Trabajo…) |
| 473 | Ícono |
| 474 | Ícono del grupo |
| 481 | Ícono {ic} |
| 482 | icon-pick-opt {ic === newIcon ? 'on' : ''} |
| 495 | Cancelar |
| 503 | Creando… |
| 503 | Crear |
| 513 | Buscar entre tus grupos |
| 514 | Buscar entre tus grupos |
| 519 | Cargando grupos… |
| 524 | Crea un grupo para dividir siempre con la misma gente. |
| 525 | Sin resultados para esa búsqueda. |
| 533 | No pudimos abrir el grupo |
| 540 | miembro |
| 540 | miembros |
| 594 | No tienes solicitudes pendientes. |
| 603 | Te quieren agregar ( |
| 617 | Aceptar |
| 624 | Rechazar |
| 628 | Bloquear a {r.fullName} |
| 642 | Enviadas ( |
| 647 | Por privacidad no mostramos a quién hasta que acepte. |
| 659 | Solicitud enviada |
| 660 | · pendiente |
| 667 | Cancelar |

### Cuenta · tarjetas, pagos, estadísticas

_90 apariciones · 85 textos únicos_


**`src/api/paymentStatus.ts`**

| línea | texto |
|---:|---|
| 8 | Pagos registrados |
| 8 | La mesa todavía está pendiente de cierre y liquidación. |
| 10 | Mesa liquidada |
| 10 | El faltante, si existió, quedó registrado. Aún no podemos afirmar la entrega al restaurante. |
| 12 | Cierre completado |
| 12 | La mesa terminó su proceso de cierre. |
| 14 | Garantía en confirmación |
| 14 | Todavía no podemos confirmar el resultado de la garantía. |
| 16 | Garantía no confirmada |
| 16 | No podemos afirmar que exista un cobro o cierre de la mesa. |
| 18 | Mesa cancelada |
| 18 | No podemos afirmar que exista un cobro o cierre de la mesa. |
| 20 | Mesa vencida |
| 20 | El cierre y cualquier liquidación todavía requieren confirmación. |
| 22 | Mesa en liquidación |
| 22 | El cierre sigue en proceso; todavía no está confirmado. |
| 24 | Entrega en proceso |
| 24 | La liquidación sigue en proceso; todavía no está confirmada. |
| 26 | Estado de la mesa |
| 26 | Todavía no podemos confirmar el cierre ni una entrega al restaurante. |

**`src/components/CardField.tsx`**

| línea | texto |
|---:|---|
| 101 | No pudimos cargar el formulario de pago. Revisa tu conexión. |
| 133 | Cargando el formulario seguro… |

**`src/components/CardsPanel.tsx`**

| línea | texto |
|---:|---|
| 61 | No podemos verificar el alta anterior de tarjeta. No vamos a crear otra hasta recuperar el estado local. |
| 102 | No se pudo actualizar |
| 107 | ¿Quitar la tarjeta terminada en {pm.last_four}? |
| 110 | Tarjeta eliminada |
| 113 | No se pudo eliminar |
| 130 | Tu sesión ya no está disponible. Vuelve a ingresar antes de guardar una tarjeta. |
| 163 | Carga los datos de la tarjeta para continuar. |
| 177 | El banco rechazó la tarjeta, pero no pudimos limpiar el intento local. No vamos a reenviarlo. |
| 210 | Tarjeta guardada ✓ |
| 218 | No pudimos guardar de forma segura el estado de esta alta. No vamos a enviar otra operación. |
| 232 | El rechazo fue definitivo, pero no pudimos limpiar el intento local. No vamos a reenviarlo. |
| 239 | El servicio no pudo confirmar la tarjeta. Reintenta esta misma operación; no agregues otra. |
| 241 | No pudimos guardar la tarjeta. Revisa los datos y prueba de nuevo. |
| 242 | No pudimos confirmar si la tarjeta se guardó. Reintenta la misma operación: no vamos a crear otra. |
| 252 | Cargando tarjetas… |
| 258 | Todavía no guardaste ninguna tarjeta. |
| 260 | Agregar tarjeta |
| 282 | Crédito |
| 282 | Débito |
| 283 | · Vence {vto} |
| 292 | Principal |
| 295 | Hacer principal |
| 303 | Quitar tarjeta {pm.last_four} |
| 314 | Nueva tarjeta |
| 318 | Esta tarjeta quedó sin confirmar. Reintenta la misma operación: conservamos el mismo registro y no vamos a generar otra. |
| 319 | Esta alta quedó sin confirmar. Reintenta la misma operación: conservamos su clave. |
| 329 | La tarjeta ya fue materializada por Stripe. Solo reintentaremos registrar esa misma referencia. |
| 333 | En la demo no pedimos datos reales: se agrega una tarjeta de ejemplo. |
| 344 | Los datos van directo a Stripe: PayMe nunca ve el número completo. |
| 356 | Cancelar |
| 364 | Guardando… |
| 366 | Reintentar la misma tarjeta |
| 367 | Guardar tarjeta |
| 379 | Agregar tarjeta |

**`src/screens/EstadisticasScreen.tsx`**

| línea | texto |
|---:|---|
| 75 | Mis estadísticas |
| 82 | No podemos mostrar tus estadísticas ahora |
| 83 | Prueba de nuevo más tarde. |
| 91 | No pudimos cargar tus estadísticas |
| 92 | Revisa la conexión y prueba de nuevo. |
| 96 | Reintentar |
| 100 | Cargando tus estadísticas |
| 112 | Todavía no registramos consumos este mes. |
| 118 | Este mes |
| 125 | Visitas |
| 129 | Promedio por visita |
| 135 | Tus restaurantes |
| 144 | visita |
| 144 | visitas |
| 164 | Plato más pedido |
| 169 | vez |
| 169 | veces |
| 177 | Tipo de cocina favorito |
| 193 | Todavía no existe en el contrato |
| 195 | Comparación con el mes anterior · propinas acumuladas · ranking por tipología de plato. |

**`src/screens/PagosScreen.tsx`**

| línea | texto |
|---:|---|
| 85 | Mis pagos |
| 94 | No podemos mostrar tus pagos ahora |
| 95 | Prueba de nuevo más tarde. |
| 103 | No pudimos cargar tus pagos |
| 104 | Revisa la conexión y prueba de nuevo. |
| 108 | Reintentar |
| 112 | Cargando tus pagos |
| 124 | Todavía no pagaste ninguna mesa. |
| 138 | Mesa |
| 152 | No pudimos traer más pagos. Lo que ves sigue siendo correcto. |
| 164 | Cargando… |
| 164 | Cargar más |

**`src/screens/pagosView.ts`**

| línea | texto |
|---:|---|
| 55 | Sin fecha |

**`src/screens/TarjetasScreen.tsx`**

| línea | texto |
|---:|---|
| 22 | Mis tarjetas |

### Avisos

_19 apariciones · 19 textos únicos_


**`src/screens/AvisosScreen.tsx`**

| línea | texto |
|---:|---|
| 101 | Te sumaste a la mesa ✓ |
| 111 | Esta mesa ya cerró. |
| 111 | No pudimos aceptar la invitación |
| 123 | No se pudo marcar como leído |
| 137 | Marcar leídos |
| 144 | Te invitaron |
| 175 | {inv.invitador} te invitó a |
| 175 | Te invitaron a una mesa |
| 204 | Sumándote… |
| 204 | Sumarme |
| 213 | Notificaciones |
| 214 | Cargando avisos… |
| 218 | No tienes avisos. |
| 227 | aviso-dot {sinLeer ? '' : 'off'} |
| 228 | true |
| 229 | Sin leer |
| 230 | img |
| 232 | bell |
| 234 | aviso-title {sinLeer ? 'unread' : ''} |

### Entrar y perfil

_36 apariciones · 33 textos únicos_


**`src/screens/LoginScreen.tsx`**

| línea | texto |
|---:|---|
| 13 | Email o contraseña incorrectos. |
| 14 | Ese email ya está registrado. |
| 15 | Tu cuenta está suspendida. Escribinos. |
| 16 | Demasiados intentos. Espera un minuto. |
| 17 | Revisa los datos: email válido y contraseña de al menos 8 caracteres. |
| 22 | No pudimos conectar. Prueba de nuevo. |
| 24 | No pudimos conectar. Prueba de nuevo. |
| 65 | Pay |
| 65 | Me |
| 68 | Divide y paga la cuenta desde la mesa |
| 74 | Entra a tu cuenta |
| 74 | Crea tu cuenta |
| 85 | Nombre |
| 93 | Apellido |
| 104 | Email |
| 113 | Contraseña |
| 121 | Un segundo… |
| 121 | Entrar |
| 121 | Registrarme |
| 132 | ¿No tienes cuenta? Regístrate |
| 132 | Ya tengo cuenta → entrar |
| 137 | Modo demo: entra con cualquier email y contraseña. |

**`src/screens/MasScreen.tsx`**

| línea | texto |
|---:|---|
| 31 | Más |
| 38 | {user.first_name} {user.last_name} |
| 38 | PayMe |
| 40 | {user.first_name} {user.last_name} |
| 40 | Tu cuenta |
| 50 | Tus datos van a aparecer aquí en cuanto termines de crear tu cuenta. |
| 58 | Email |
| 93 | Saldo y tarjetas |
| 93 | Mis tarjetas |
| 111 | Modo demo: |
| 111 | los datos son de ejemplo y se guardan solo en este teléfono. Nada de lo que hagas aquí mueve dinero de verdad. |
| 118 | ¿Volver la demo a su estado inicial? |
| 123 | Reiniciar la demo |
| 133 | Cerrar sesión |

### Marco de la app

_27 apariciones · 22 textos únicos_


**`src/App.tsx`**

| línea | texto |
|---:|---|
| 234 | Demo · datos de ejemplo, no se cobra dinero real |

**`src/components/AppBottomBar.tsx`**

| línea | texto |
|---:|---|
| 43 | Inicio |
| 44 | Mesas |
| 60 | Amigos |
| 61 | Más |
| 89 | Nueva |
| 101 | appbar-item {on ? 'on' : ''} |
| 103 | page |
| 117 | Navegación principal |

**`src/components/AppHeader.tsx`**

| línea | texto |
|---:|---|
| 23 | Pay |
| 23 | Me |
| 76 | hdr {compact ? 'hdr-compact' : ''} {tabs ? 'hdr-tabbed' : ''} |
| 85 | Estás en Avisos |
| 90 | Avisos |
| 93 | {unread} sin leer |
| 125 | hdr {compact ? 'hdr-compact' : ''} {tabs ? 'hdr-tabbed' : ''} |
| 129 | Volver |
| 156 | Volver |
| 191 | hdr hdr-flow {compact ? 'hdr-compact' : ''} |
| 246 | btab {on ? 'on' : ''} |
| 259 | {t.badge} pendientes |
| 316 | mounted-card {flush ? 'flush' : ''} {className} |

**`src/components/ui.tsx`**

| línea | texto |
|---:|---|
| 8 | top-logo {inv ? 'inv' : ''} |
| 9 | Pay |
| 9 | Me |
| 18 | Volver |
| 64 | VISA |

### Etiquetas y formatos compartidos

_55 apariciones · 47 textos únicos_


**`src/api/http.ts`**

| línea | texto |
|---:|---|
| 68 | Bearer {token} |

**`src/api/index.ts`**

| línea | texto |
|---:|---|
| 377 | definitive |
| 377 | ambiguous |
| 379 | No pudimos confirmar la respuesta de tu banco. |
| 379 | ambiguous |
| 392 | La garantía ya no está vigente. |
| 395 | Tu banco pudo haber autorizado la garantía; todavía la estamos verificando. |
| 395 | ambiguous |
| 399 | Tu banco pudo haber autorizado la garantía; todavía la estamos verificando. |
| 399 | ambiguous |
| 600 | success |
| 600 | ambiguous |

**`src/api/invitationLink.ts`**

| línea | texto |
|---:|---|
| 126 | {hash.slice(0, i)}{resto ? `?${resto}` : ''} |

**`src/api/stripe.ts`**

| línea | texto |
|---:|---|
| 117 | No pudimos leer la tarjeta. |
| 143 | Tu banco no autorizó la operación. |
| 169 | No pudimos guardar la tarjeta. |

**`src/utils/format.ts`**

| línea | texto |
|---:|---|
| 52 | menos de 1 min |
| 53 | {totalMin} min |
| 56 | {hs} h |
| 56 | {hs} h {min} min |
| 67 | recién |
| 68 | hace {mins} min |
| 70 | hace {hs} h |
| 72 | hace {days} días |
| 72 | ayer |

**`src/utils/labels.ts`**

| línea | texto |
|---:|---|
| 13 | Autorizando |
| 14 | Abierta |
| 20 | Pago en curso |
| 21 | Completa |
| 22 | Vencida |
| 23 | Cerrando |
| 24 | Cerrada |
| 25 | Cerrada |
| 26 | Cerrada |
| 27 | Sin garantía |
| 28 | Cancelada |
| 34 | Cerrada |
| 38 | En curso |
| 51 | Carga en OXXO |
| 52 | Carga con tarjeta |
| 53 | Abono por SPEI |
| 54 | Transferencia recibida |
| 55 | Transferencia enviada |
| 56 | Pago de mesa |
| 57 | Devolución de mesa |
| 58 | Propina recibida |
| 59 | Propina enviada |
| 60 | Ajuste a favor |
| 61 | Ajuste en contra |
| 65 | Movimiento |
| 102 | Italiana |
| 103 | Japonesa |
| 104 | Mexicana |
| 105 | Café |
| 106 | Otros |

### Sin clasificar


**`index.html`**

| línea | texto |
|---:|---|
| 7 | PayMe |

**`src/screens/mesaItemsView.ts`**

| línea | texto |
|---:|---|
| 62 | entero |

**`src/utils/payloadIdentity.ts`**

| línea | texto |
|---:|---|
| 83 | {{Object.keys(object) .sort() .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash(object[key])}`) .join(',')}} |
