-- ============================================================
-- Cocina — Esquema completo de la base de datos (Supabase)
--
-- Ejecutar en: Supabase → SQL Editor → New query → pegar todo → Run
--
-- Es IDEMPOTENTE: se puede ejecutar tantas veces como se quiera.
--   · En un proyecto nuevo crea todas las tablas.
--   · En el proyecto actual solo añade lo que falte (no borra datos).
--
-- Seguridad: todas las tablas tienen Row Level Security (RLS):
-- cada usuario solo puede ver y modificar sus propias filas.
-- ============================================================


-- ------------------------------------------------------------
-- PRODUCTOS (etiquetas de trazabilidad de recipientes abiertos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre           text        NOT NULL,
  lote             text        NOT NULL DEFAULT '',
  dias_caducidad   integer     NOT NULL DEFAULT 1,
  fecha_apertura   timestamptz NOT NULL DEFAULT now(),
  fecha_caducidad  timestamptz NOT NULL,
  alergenos        text[]      NOT NULL DEFAULT '{}',
  timestamp        bigint      NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id          uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS productos_user_caducidad ON public.productos (user_id, fecha_caducidad);


-- ------------------------------------------------------------
-- INGREDIENTES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingredientes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      text        NOT NULL,
  alergenos   text[]      NOT NULL DEFAULT '{}',
  timestamp   bigint      NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);


-- ------------------------------------------------------------
-- PLATOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platos (
  id           uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre       text          NOT NULL,
  descripcion  text          NOT NULL DEFAULT '',
  precio       numeric(10,2) NOT NULL DEFAULT 0,
  ingredientes jsonb         NOT NULL DEFAULT '[]',
  alergenos    text[]        NOT NULL DEFAULT '{}',
  timestamp    bigint        NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id      uuid          NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);


-- ------------------------------------------------------------
-- BEBIDAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bebidas (
  id           uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre       text          NOT NULL,
  descripcion  text          NOT NULL DEFAULT '',
  precio       numeric(10,2) NOT NULL DEFAULT 0,
  categoria    text          NOT NULL DEFAULT 'otro',
  timestamp    bigint        NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id      uuid          NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);


-- ------------------------------------------------------------
-- FACTURAS y PRESUPUESTOS (misma tabla, columna "tipo")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facturas (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  numero          text          NOT NULL,
  cliente         text          NOT NULL,
  nif             text          NOT NULL DEFAULT '',
  direccion       text          NOT NULL DEFAULT '',
  fecha           date          NOT NULL,
  lineas          jsonb         NOT NULL DEFAULT '[]',
  subtotal        numeric(10,2) NOT NULL DEFAULT 0,
  porcentaje_igic numeric(5,2)  NOT NULL DEFAULT 7,
  cuota_igic      numeric(10,2) NOT NULL DEFAULT 0,
  total           numeric(10,2) NOT NULL DEFAULT 0,
  pagada          boolean       NOT NULL DEFAULT false,
  notas           text          NOT NULL DEFAULT '',
  timestamp       bigint        NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id         uuid          NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Columnas añadidas después (no hacen nada si ya existen)
ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS retencion_irpf     numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cuota_irpf         numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forma_pago         text          NOT NULL DEFAULT 'efectivo',
  ADD COLUMN IF NOT EXISTS vencimiento        date,
  ADD COLUMN IF NOT EXISTS tipo               text          NOT NULL DEFAULT 'factura',
  ADD COLUMN IF NOT EXISTS estado_presupuesto text,
  ADD COLUMN IF NOT EXISTS descripcion_evento text          NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fecha_evento       date,
  ADD COLUMN IF NOT EXISTS comensales         integer;      -- nº de comensales (presupuestos de eventos)

CREATE INDEX IF NOT EXISTS facturas_user_tipo_numero ON public.facturas (user_id, tipo, numero);


-- ------------------------------------------------------------
-- CONFIG (datos de empresa, impresora y logo: 1 fila por usuario)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.config (
  user_id     uuid        PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa     jsonb       NOT NULL DEFAULT '{}',
  impresora   jsonb       NOT NULL DEFAULT '{}',
  logo        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ------------------------------------------------------------
-- PUSH_SUBSCRIPTIONS (dispositivos que reciben avisos de caducidad)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint    text        PRIMARY KEY,
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subscriptions (user_id);


-- productos.user_id: siempre el usuario que inserta (en versiones antiguas no tenía valor por defecto)
ALTER TABLE public.productos ALTER COLUMN user_id SET DEFAULT auth.uid();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.productos WHERE user_id IS NULL) THEN
    ALTER TABLE public.productos ALTER COLUMN user_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'Hay productos sin user_id: no se ha podido marcar la columna como obligatoria.';
  END IF;
END $$;


-- ------------------------------------------------------------
-- ROW LEVEL SECURITY: cada usuario solo ve y modifica lo suyo
-- (también al INSERTAR: antes la política de insert era "true" y permitía
--  crear filas a nombre de otro usuario)
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  -- Tablas con una política por operación
  FOREACH t IN ARRAY ARRAY['productos','ingredientes','platos','bebidas','facturas']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "solo_propietario" ON public.%I', t);  -- versión anterior de este script
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t || '_delete', t);
  END LOOP;

  -- Tablas con una única política para todo
  ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "solo_propietario" ON public.config;
  DROP POLICY IF EXISTS config_own ON public.config;
  CREATE POLICY config_own ON public.config FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "solo_propietario" ON public.push_subscriptions;
  DROP POLICY IF EXISTS push_subs_own ON public.push_subscriptions;
  CREATE POLICY push_subs_own ON public.push_subscriptions FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
END $$;


-- ------------------------------------------------------------
-- NUMERACIÓN DE FACTURAS SIN DUPLICADOS
-- Impide que existan dos facturas (o presupuestos) con el mismo número.
-- Si ya hubiera duplicados, no se crea y se muestra un aviso con cuáles son:
-- corrígelos y vuelve a ejecutar este script.
-- ------------------------------------------------------------
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS facturas_numero_unico ON public.facturas (user_id, tipo, numero);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'No se pudo crear el índice único: hay números de factura duplicados. Consulta: SELECT tipo, numero, count(*) FROM public.facturas GROUP BY 1,2 HAVING count(*) > 1;';
END $$;

-- Refrescar la caché de la API para que vea las columnas nuevas al momento
NOTIFY pgrst, 'reload schema';
