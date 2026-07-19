# T7 — correr el front contra el backend real (local)

Pasos para dejar la app hablando con `payme-app-backend` en vez de la demo.
El repo del backend es **solo lectura**: acá no se edita ninguno de sus archivos;
solo se crea su `.env` (config, no código) y se corre `npm start`.

## 1. Postgres

Instalar **Postgres.app** (https://postgresapp.com): arrastrar a Aplicaciones,
abrir, botón *Initialize*. Después, dejar sus herramientas en el PATH:

```bash
sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin \
  | sudo tee /etc/paths.d/postgresapp
```

Cerrar y reabrir la terminal.

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
| `STP_API_KEY` | `mock-development-key` (deja SPEI en modo simulado) |
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
| Amigos, grupos, transferencias | ✅ completo |
| Abrir mesa con garantía por **saldo** | ✅ completo (no toca Stripe) |
| Pagar con **saldo** | ✅ completo |
| Abrir mesa con garantía por **tarjeta** | ⚠️ funciona, pero **G-04**: hay que tipear la tarjeta cada vez (el contrato pide un `pm_…` que `GET /payment-methods` no devuelve) |
| Pagar con tarjeta / agregar tarjeta / 3DS | ⚠️ requiere claves de Stripe en test |
| Cargar saldo por OXXO o tarjeta | ⚠️ requiere claves de Stripe en test |
| Abono SPEI (CLABE) | ✅ con `STP_API_KEY=mock-development-key` |
| Escanear ticket (OCR) | ⚠️ el backend responde un ticket de ejemplo (no hay proveedor real) |

Para cargar saldo sin Stripe y poder probar los flujos de wallet, se puede
acreditar a mano en la base:

```sql
UPDATE wallets SET balance_cents = 500000
 WHERE user_id = (SELECT id FROM users WHERE email = 'TU_EMAIL');
```
