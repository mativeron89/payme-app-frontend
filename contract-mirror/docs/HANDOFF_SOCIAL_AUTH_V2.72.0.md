# Handoff owner-first · Google + Facebook dark · App Backend v2.72.0

Este handoff congela un contrato **local y oscuro**. No autoriza credenciales,
consolas, proveedores reales, App Live, push, deploy ni producción. Fuera del
harness sintético, los adapters de Google/Facebook y el transporte de recovery
no están instalados, por lo que las acciones interactivas quedan `OFF`.

## Capability pública

`GET /api/config` agrega `features.social_auth`; ausencia o payload malformado
apagan Google, Facebook y la solicitud de recovery. El login existente por
contraseña permanece visible y habilitado: social auth nunca puede ocultar el
único ingreso compatible con un backend anterior.

- `google_sign_in`: `enabled`, `registration`, `login`, `linking`,
  `web_client_id`. Alta exige recovery operativo; login/link pueden conservarse
  si un transporte ya configurado cae.
- `facebook_sign_in`: `enabled`, `registration`, `login`, `app_id`,
  `redirect_uri`. Config exacta, adapter y recovery son prerrequisitos de toda
  acción interactiva.
- `recovery_email`: `enabled`, `completion_route` (`#/recovery` o `null`).
- `password_login.enabled` permanece `true`.

Los callbacks Meta pueden seguir aceptando deauthorization/data deletion con
configuración criptográfica válida aunque el login interactivo esté apagado. La
consulta de una baja ya aceptada permanece disponible por confirmation code
aunque luego se retire esa configuración.

## Google

- `POST /api/auth/google/register`: F&F, aviso legal, perfil PayMe y
  `birth_date` según PQ-2; nunca acepta email del proveedor.
- `POST /api/auth/google/login`: resuelve exclusivamente un binding activo.
- `POST /api/auth/google/link`: bearer PayMe + password actual; cero auto-link
  por email.

El ID token sólo viaja en body HTTPS y nunca se guarda/loguea. Los errores son
opacos y una caída temporal se comunica como `503` sin revelar cuenta/binding.

## Facebook BFF/manual redirect

- `POST /api/auth/facebook/register/start` recibe invitación + perfil PayMe.
- `POST /api/auth/facebook/login/start` no recibe identidad.
- Ambos devuelven `authorization_url` y `expires_at`; state se guarda sólo como
  SHA-256 con TTL/one-use. La configuración admite únicamente HTTPS, host Meta
  exacto para autorización y `app.paymemx.com` para redirect/status, sin query,
  fragment, credenciales ni puerto no estándar.
- `POST .../register/complete` y `POST .../login/complete` reciben `{state,code}`.
  El backend canjea server-side, valida `is_valid/app_id/expires_at/user_id`,
  descarta el access token y devuelve la sesión PayMe sólo en el body.
- No existe Facebook link en v1.
- Tras deauthorization, el mismo subject queda bloqueado en v1. Reautorizarlo
  exige una orden futura que pueda acreditar que el nuevo grant es posterior al
  callback; no se limpia el control `remote_revoked` por inferencia.

### Browser-binding obligatorio

Al recibir un `start`, el Frontend extrae y guarda en `sessionStorage` el state
exacto y el purpose. En el callback compara el state de URL antes de llamar
`complete`, limpia `code/state` de la URL inmediatamente y borra el registro
local. State proveniente sólo de la URL **no es autoridad**: esa comparación
cierra login-CSRF/session swapping. Nunca se persiste code/state en
`localStorage` ni se ponen tokens PayMe en la URL.

## Deauthorization, recovery y data deletion

- `POST /api/auth/facebook/deauthorize` y `/data-deletion` reciben
  `application/x-www-form-urlencoded` con `signed_request` HMAC validado.
- Deauthorization revoca binding y todas las sesiones una sola vez. Si queda
  password/u otro binding, la cuenta sigue activa; si era el último método,
  queda `suspended/pending_recovery`.
- Recovery PayMe es no-oracular, usa token SHA-256 one-use y revoca sesiones.
  Sólo `pending_recovery` puede reactivar una suspendida; `pending_deletion` y
  `deleted` permanecen cerradas.
- El transporte entrega el enlace exacto
  `{app_origin}/#/recovery?token={percent_encoded_raw_token}`. El Frontend
  acepta una sola ocurrencia de `token` en la query del fragmento, la captura
  únicamente en memoria y la quita de la URL con `history.replaceState` antes
  de cualquier request. Ausencia, duplicados o encoding inválido fallan
  cerrados. El token nunca va en la query HTTP, `localStorage`,
  `sessionStorage`, IndexedDB, logs ni analytics; sólo se envía junto con la
  contraseña nueva en el body HTTPS de `POST /api/auth/recovery/complete`.
- Data deletion instala un tombstone HMAC antes de buscar/borrar binding,
  cancela recovery, revoca sesiones y devuelve confirmation code + URL. Los
  retries conservan el estado previo: nunca convierten un `pending` en
  `completed_no_data` por ausencia posterior del binding.
- El estado es `pending` hasta que una futura orden acredite quiescencia. No se
  borra historia/dinero ni se afirma cierre final por inferencia.

Los intents de alta guardan contexto temporal sólo hasta 10 minutos y un
cleanup independiente los scrubbea aun sin otro inicio de OAuth.

## Gates externos antes de cualquier ON

- verifier Google oficial, client IDs/origins y prueba física web;
- transporte PayMe de recovery y aviso legal vigente;
- Meta Business/App Review, modo Live, redirect/callbacks exactos,
  `debug_token`, dominio y URLs medidos;
- ratificación legal de retención del tombstone HMAC y semántica de data
  deletion/quiescencia;
- prueba iOS Safari y Android Chrome; cero secretos en frontend.

La fuente mecánica exacta es `contract/social-auth-v1.json`. App Frontend sólo
puede adquirir lease después del commit owner y del inventario mirror publicado.
