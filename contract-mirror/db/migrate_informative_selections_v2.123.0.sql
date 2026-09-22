-- Estado propio actual: no backfill, TTL, importes ni cambios de claims.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_items_mesa_id_id ON mesa_items(mesa_id,id);
-- No adoptar silenciosamente la tabla v1 del candidato histórico.
DO $$
BEGIN
  IF to_regclass('public.mesa_informative_selections') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.mesa_informative_selections')
      AND attname='declared_fraction_bps' AND atttypid='integer'::regtype AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'informative_selection_incompatible_schema';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS mesa_informative_selections (
  mesa_id UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  mesa_item_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  declared_fraction_bps INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(mesa_id,mesa_item_id,user_id),
  CONSTRAINT informative_fraction_v2 CHECK (declared_fraction_bps IN (2500,3333,5000,6667,7500,10000)),
  CONSTRAINT fk_informative_selection_item_mesa FOREIGN KEY(mesa_id,mesa_item_id)
    REFERENCES mesa_items(mesa_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_informative_selections_user_history
  ON mesa_informative_selections(user_id,updated_at DESC,mesa_id);
CREATE INDEX IF NOT EXISTS idx_informative_selections_mesa_user
  ON mesa_informative_selections(mesa_id,user_id,mesa_item_id);
-- Validación comparada con DDL esperado, también en una segunda aplicación.
-- La tabla temporal no lee ni modifica selecciones existentes.
CREATE TEMP TABLE informative_expected (
  mesa_id UUID NOT NULL,
  mesa_item_id UUID NOT NULL,
  user_id UUID NOT NULL,
  declared_fraction_bps INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(mesa_id,mesa_item_id,user_id)
) ON COMMIT DROP;
-- v2.124.0 reemplaza el CHECK de la fracción: al reaplicar este archivo se
-- acepta exactamente uno de los dos (v2 propio o v3 sucesor), comparado aparte.
CREATE TEMP TABLE informative_fraction_accepted (
  a INTEGER CONSTRAINT informative_fraction_v2 CHECK (a IN (2500,3333,5000,6667,7500,10000)),
  b INTEGER CONSTRAINT informative_fraction_v3 CHECK (b IN
    (10000,5000,3333,2500,2000,1666,1428,1250,1111,1000,909,833,769,714,666,625,588,555,526,500,6667,7500))
) ON COMMIT DROP;
DO $$
DECLARE actual JSONB; expected JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_array(attname,atttypid,attnotnull) ORDER BY attnum)
    INTO actual FROM pg_attribute WHERE attrelid='mesa_informative_selections'::regclass AND attnum>0 AND NOT attisdropped;
  SELECT jsonb_agg(jsonb_build_array(attname,atttypid,attnotnull) ORDER BY attnum)
    INTO expected FROM pg_attribute WHERE attrelid='informative_expected'::regclass AND attnum>0 AND NOT attisdropped;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'informative_selection_incompatible_columns'; END IF;
  SELECT jsonb_agg(jsonb_build_array(adnum,pg_get_expr(adbin,adrelid)) ORDER BY adnum)
    INTO actual FROM pg_attrdef WHERE adrelid='mesa_informative_selections'::regclass;
  SELECT jsonb_agg(jsonb_build_array(adnum,pg_get_expr(adbin,adrelid)) ORDER BY adnum)
    INTO expected FROM pg_attrdef WHERE adrelid='informative_expected'::regclass;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'informative_selection_incompatible_defaults'; END IF;
  SELECT jsonb_agg(conname || ' ' || replace(pg_get_constraintdef(oid),'declared_fraction_bps','v'))
    INTO actual FROM pg_constraint WHERE conrelid='mesa_informative_selections'::regclass AND contype='c';
  IF jsonb_array_length(COALESCE(actual,'[]'::jsonb)) <> 1 OR NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid='informative_fraction_accepted'::regclass AND contype='c'
        AND conname || ' ' || replace(replace(pg_get_constraintdef(oid),'(a ','(v '),'(b ','(v ') = actual->>0)
    THEN RAISE EXCEPTION 'informative_selection_incompatible_constraints'; END IF;
  SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid))
    INTO actual FROM pg_constraint WHERE conrelid='mesa_informative_selections'::regclass AND contype<>'c';
  SELECT jsonb_agg(def ORDER BY def) INTO expected FROM (
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='informative_expected'::regclass
      AND contype<>'c'
    UNION ALL SELECT unnest(ARRAY[
      'FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE CASCADE',
      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
      'FOREIGN KEY (mesa_id, mesa_item_id) REFERENCES mesa_items(mesa_id, id) ON DELETE CASCADE'
    ])
  ) expected_constraints;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'informative_selection_incompatible_constraints'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='uq_mesa_items_mesa_id_id'::regclass
      AND indrelid='mesa_items'::regclass AND indisunique AND indisvalid AND indpred IS NULL
      AND pg_get_indexdef(indexrelid,1,true)='mesa_id' AND pg_get_indexdef(indexrelid,2,true)='id'
      AND indnatts=2) THEN RAISE EXCEPTION 'informative_selection_incompatible_item_index'; END IF;
  IF pg_get_indexdef('idx_informative_selections_user_history'::regclass) <>
      'CREATE INDEX idx_informative_selections_user_history ON public.mesa_informative_selections USING btree (user_id, updated_at DESC, mesa_id)'
    OR pg_get_indexdef('idx_informative_selections_mesa_user'::regclass) <>
      'CREATE INDEX idx_informative_selections_mesa_user ON public.mesa_informative_selections USING btree (mesa_id, user_id, mesa_item_id)'
    THEN RAISE EXCEPTION 'informative_selection_incompatible_read_indexes'; END IF;
END $$;
COMMIT;
