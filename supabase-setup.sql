-- ============================================================
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Crea las 3 tablas con Row Level Security activado.
-- Solo el usuario autenticado puede ver y modificar sus datos.
-- ============================================================

-- INGREDIENTES
CREATE TABLE public.ingredientes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      text        NOT NULL,
  alergenos   text[]      NOT NULL DEFAULT '{}',
  timestamp   bigint      NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.ingredientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solo_propietario" ON public.ingredientes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PLATOS
CREATE TABLE public.platos (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre       text        NOT NULL,
  descripcion  text        NOT NULL DEFAULT '',
  precio       numeric(10,2) NOT NULL DEFAULT 0,
  ingredientes jsonb       NOT NULL DEFAULT '[]',
  alergenos    text[]      NOT NULL DEFAULT '{}',
  timestamp    bigint      NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id      uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.platos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solo_propietario" ON public.platos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- FACTURAS
CREATE TABLE public.facturas (
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
ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solo_propietario" ON public.facturas
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
