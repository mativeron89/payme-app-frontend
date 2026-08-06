-- ═══════════════════════════════════════════════════════════════════════════
-- migrate_idem_mesas_v2.25.sql — B-06 §4.1: idempotencia en la CREACIÓN de mesa
-- Reporte: front del comensal, 2026-07-25. Acta relacionada:
-- ops/actas/[PAYME]_ACTA_2026-07-25_PAGAR_VARIAS_PARTES.md
--
-- EL BUG QUE CIERRA. `POST /mesas` era la ÚNICA ruta de dinero sin idempotencia
-- (pagar, recargar y transferir sí la exigen). Si el front perdía la RESPUESTA
-- después de colocarse la garantía, el reintento creaba una SEGUNDA MESA con un
-- SEGUNDO HOLD POR EL TOTAL. Y no quedaba ahí: la mesa fantasma NO queda
-- colgada — a los 30 minutos el sweep la liquida, nadie la pagó, y la garantía
-- captura el total. Reproducido: el saldo del organizador bajó de verdad, con
-- asiento "Faltante mesa (garantía)". Es doble COBRO consumado, sin que
-- intervenga una persona. Además la mesa fantasma emite eventos al dashboard,
-- así que el restaurante ve facturación que nunca ocurrió.
--
-- La idempotencia de Stripe no salvaba nada: su clave se deriva de la mesa
-- (`guarantee_${mesaId}`), y la mesa duplicada tiene id nuevo.
--
-- Idempotente. Aditivo: las mesas sin clave (todas las de hoy) no se tocan.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS idempotency_payload_hash VARCHAR(64);

-- Una clave por organizador. PARCIAL: las mesas sin clave (legacy y las de
-- clientes que todavía no la mandan) no colisionan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesas_opener_idem
  ON mesas(opener_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
