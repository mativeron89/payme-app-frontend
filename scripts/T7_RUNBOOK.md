# T7 — correr el front contra el backend real (local)

Pasos para dejar la app hablando con `payme-app-backend` en vez de la demo.
El repo del backend es **solo lectura**: acá no se edita ninguno de sus archivos;
solo se crea su `.env` (config, no código) y se corre `npm start`.

## 1. Postgres

Instalar **Postgres.app** (https://postgresapp.com): arrastrar a Aplicaciones,
abrirla y hacer clic en *Initialize* (o *Start* si ya estaba inicializada).
Listo: cuando el elefante queda en verde, Postgres está corriendo.

> No hace falta tocar el PATH del sistema (eso pedía `sudo` y la contraseña de
> la Mac). El script de abajo usa los binarios que vienen dentro de
> Postgres.app por ruta completa.

## 2. Base + migraciones + restaurante semilla

```bash
bash scripts/t7-setup-db.sh
```

Imprime el `restaurant_id` que hace falta por **G-01** (el contrato no expone
la lista de restaurantes pero `POST /mesas` exige uno que exista).

## 3. Credenciales del backend

En `../payme-app-backend/`, copiar `.env.example` a `.env` y completar:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | `postgresql://localhost:5432/payme` |
| `JWT_SECRET` | cualquier texto de 32+ caracteres |
| `STRIPE_SECRET_KEY` | `sk_test_…` del panel de Stripe (modo test) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` del panel de Stripe (modo test) |
| `FRONTEND_PUBLIC_URL` | `http://localhost:5174/#` |

> Las claves de Stripe las pone **Mati**: son credenciales suyas y no deben
> pasar por el chat. La secreta vive solo en el backend; el front usa la
> publicable, que pide a `GET /api/config`.

`FRONTEND_PUBLIC_URL` termina en `/#` a propósito: el backend arma el link de
invitación como `${FRONTEND_PUBLIC_URL}/mesa/:code?t=…` y el router del front
es por hash.

## 4. Levantar backend y front

```bash
# terminal 1
cd ../payme-app-backend && npm start

# terminal 2 (en payme-app-frontend)
cp .env.local.example .env.local     # y pegar el VITE_RESTAURANT_ID del paso 2
npm run dev
```

## 5. Qué se puede probar y qué no

| Flujo | Estado con backend real |
| --- | --- |
| Registro / login / logout | ✅ completo |
| Amigos y grupos | ✅ dentro del alcance card-only |
| Abrir mesa con garantía por **tarjeta** | ⚠️ requiere claves Stripe test; tarjeta guardada o Elements según el contrato |
| Pagar con tarjeta / agregar tarjeta / 3DS | ⚠️ requiere claves de Stripe en test |
| Escanear ticket (OCR) | ⚠️ el backend responde un ticket de ejemplo (no hay proveedor real) |
| Pagar con **Apple Pay / Google Pay** | ❌ plan ratificado: primer pago con `pm_` efímero, no guardado/off-session; siguen apagados hasta integración real y prueba física; ver **G-12** |
| Wallet, topups, transferencias, CLABE, SPEI y STP | ❌ plan de apagado ratificado para post-auditoría; flags/UI/endpoints fail-closed, código/schema legacy intactos y nunca habilitados por SQL |

Este runbook acredita únicamente una prueba local. No permite inferir CI,
deploy ni estado de producción.
