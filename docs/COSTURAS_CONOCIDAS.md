# Costuras conocidas — `payme-app-frontend`

**Dueño: la sesión de App Frontend.** Se abre el 2026-08-20.

## Qué va acá, y qué NO

Acá van **costuras internas del front**: lugares donde el código es correcto
hoy, pero donde una guarda depende de una condición que nadie vigila, o donde
un riel prueba menos de lo que parece. **No son gaps de contrato** —eso es
`GAPS.md`, que trata de lo que el App Backend no publica— ni defectos —eso se
arregla, no se anota.

🔴 **Cada entrada tiene que traer su CONDICIÓN DE DISPARO escrita.** Una nota
que dice «ojo con esto» no sirve: dentro de tres semanas nadie sabe si sigue
importando. La condición de disparo es lo que permite cerrarla o confirmarla
**sin volver a razonar el caso desde cero**.

---

## C-01 · El riel mock es MÁS BLANDO que el real en identidad y sesión

**Medido el 2026-08-20**, leyendo `src/api/index.ts`, `http.ts` y `storage.ts`.

Todo el E2E corre en mock, y el mock **no ejercita tres cosas** que el riel real
sí tiene:

| qué | dónde | consecuencia |
|---|---|---|
| `onSessionExpired` es `() => undefined` | `src/api/index.ts` · `mockApi` | la cadena `401 → refresh → lápida → aviso a la UI` es **real-only** |
| los tokens son constantes (`'mock-access-token'`) | `mockLogin`/`mockRegister` | la comparación de tokens de `isCurrentSession` es **tautológica** ahí; sólo `family_id` distingue |
| `createSetupIntent` y `attachPaymentMethod` ignoran `expectedSession` | `mockApi` | el pinning de sesión de esas dos puertas no se observa |

⚠️ **Lo que esto NO significa:** la capa **sí** tiene cobertura unitaria fuerte y
sobre el riel real —`src/api/http.session.test.ts`, 13 casos, incluidos «sin Web
Locks», la rotación y las carreras de logout—. Lo ausente es lo **observable en
navegador**. **Un verde de E2E no acredita ninguna de las tres.**

**Condición de disparo:** si el mock empieza a producir tokens variables, a
publicar `onSessionExpired` o a recibir `expectedSession`, entonces esas
conductas **pasan a ser observables** y corresponde escribirles E2E en vez de
seguir declarando el límite. La tercera ya tiene aserción viva que lo avisa:
`src/api/pinningDeSesion.test.ts` se pone rojo si el mock empieza a recibir la
sesión.

---

## C-02 · `withSessionLock` distingue «no hay Web Locks» de «corrió bien» por `null` vs `undefined`

`src/api/http.ts`. Cuando el navegador no expone `navigator.locks`, la función
devuelve `null`; cuando corrió, devuelve lo que devolvió la acción. Los dos
llamadores conviven bien con eso **hoy**:

- `saveSession` devuelve `void` → la acción resuelve `undefined`, y
  `saved === null` sólo es cierto sin Web Locks;
- `invalidateSession` devuelve `boolean`, y el llamador usa `??` y **no `||`**,
  así que un `false` legítimo —«esta familia no era la actual»— no re-ejecuta.

**Condición de disparo, y es precisa:** el día que **alguna acción pasada a
`withSessionLock` pueda resolver `null` legítimamente**, esa acción **se
ejecutaría dos veces** —una bajo el lock y otra fuera—. Sobre rieles de sesión,
eso es una invalidación o un guardado duplicado.

**Por qué se anota y no se arregla:** el arreglo (un centinela propio en vez de
`null`) toca las tres puertas de sesión, y hacerlo dentro de un lote de
evidencia mezclaría un cambio de conducta con un cambio de oráculos. Va a orden
propia.

---

## C-03 · `getFriendRequests` es la única interpolación de la fachada sin `encodeURIComponent`

`src/api/index.ts`. Todas las demás interpolaciones de path de la fachada usan
`encodeURIComponent`; ésta no.

🔴 **Hoy NO es un defecto y no se reporta como tal:** el parámetro es la unión
literal `'incoming' | 'outgoing'` (`src/api/types.ts:817`), así que no hay valor
que escapar. Se anota porque **es la única excepción a un patrón, y el patrón es
lo que protege** — quien copie esa línea para un parámetro nuevo hereda la
omisión sin verla.

**Condición de disparo:** si `FriendRequestDirection` deja de ser una unión de
literales, o si aparece otra interpolación sin escapar. **Se cierra con una
guarda de CLASE** —un censo de las interpolaciones de path de la fachada, como
el de `censoSuperficiesPago`— **nunca con un parche puntual**: arreglar sólo
ésta borra el único síntoma sin cerrar la clase.

---

## C-04 · El valor de `VITE_API_URL` en Vercel está fuera de alcance

Desde `0.100.0`, el build real **falla** sin la variable (`exigirApiUrl` en
`vite.config.ts`), y eso vuelve el límite irrelevante en una dirección: **sin
variable no hay artefacto que publicar**.

**Lo que sigue sin poder verificarse desde el repo:** que el valor cargado en el
proyecto de Vercel sea **el correcto**. Un valor presente y equivocado compila
igual.

**Condición de disparo:** cualquier cambio de dominio del backend, o un
despliegue que responda pero contra el backend equivocado. Se detecta mirando el
tráfico del artefacto publicado, no compilando.
