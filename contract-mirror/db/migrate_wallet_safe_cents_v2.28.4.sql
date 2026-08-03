-- El runtime monetario opera con Number y exige enteros exactos. BIGINT acepta
-- valores mayores a 2^53-1; este guard evita que un saldo válido para Postgres
-- se redondee silenciosamente al entrar a JavaScript.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_wallets_balance_safe'
       AND conrelid = 'wallets'::regclass
  ) THEN
    ALTER TABLE wallets
      ADD CONSTRAINT chk_wallets_balance_safe
      CHECK (balance_cents BETWEEN 0 AND 9007199254740991) NOT VALID;
  END IF;
END $$;

ALTER TABLE wallets VALIDATE CONSTRAINT chk_wallets_balance_safe;

COMMIT;
