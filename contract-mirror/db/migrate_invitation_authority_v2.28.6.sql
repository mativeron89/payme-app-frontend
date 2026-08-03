-- PayMe App Backend v2.28.6 — autoridad única de invitaciones
--
-- Históricamente, crear una invitación también materializaba un participant
-- pending. Ese duplicado sobrevivía a cancelación/expiración y podía otorgar
-- acceso. La invitación pending y vigente pasa a ser la única autoridad previa
-- a aceptar; sólo la aceptación materializa/activa al participante.
--
-- Idempotente: una segunda ejecución no encuentra filas. No toca participants
-- active/left y, por lo tanto, no revoca accesos ya aceptados.

BEGIN;

DELETE FROM mesa_participants
 WHERE status = 'pending';

COMMIT;
