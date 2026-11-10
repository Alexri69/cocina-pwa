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


-- ------------------------------------------------------------
-- PLANTILLAS_ETIQUETA (productos habituales: etiquetar en un toque)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plantillas_etiqueta (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre          text        NOT NULL,
  dias_caducidad  integer     NOT NULL DEFAULT 1 CHECK (dias_caducidad > 0),
  alergenos       text[]      NOT NULL DEFAULT '{}',
  usos            integer     NOT NULL DEFAULT 0,
  timestamp       bigint      NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id         uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);
-- Un mismo nombre (sin distinguir mayúsculas) solo una vez por usuario
CREATE UNIQUE INDEX IF NOT EXISTS plantillas_etiqueta_nombre_unico ON public.plantillas_etiqueta (user_id, lower(nombre));


-- ------------------------------------------------------------
-- APPCC: elementos a controlar (equipos de frío, freidoras, tareas de limpieza)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appcc_elementos (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo        text        NOT NULL CHECK (tipo IN ('temperatura','freidora','limpieza')),
  nombre      text        NOT NULL,
  zona        text        NOT NULL DEFAULT '',
  min         numeric(6,1),                       -- temperatura mínima (°C)
  max         numeric(6,1),                       -- temperatura máxima (°C) o % polares máximo
  frecuencia  text        NOT NULL DEFAULT 'diaria',  -- dos_al_dia | diaria | semanal | mensual (ver CHECK abajo)
  activo      boolean     NOT NULL DEFAULT true,
  orden       integer     NOT NULL DEFAULT 0,
  timestamp   bigint      NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Frecuencias admitidas (se redefine para añadir "dos_al_dia" sin recrear la tabla)
ALTER TABLE public.appcc_elementos DROP CONSTRAINT IF EXISTS appcc_elementos_frecuencia_check;
ALTER TABLE public.appcc_elementos ADD CONSTRAINT appcc_elementos_frecuencia_check
  CHECK (frecuencia IN ('dos_al_dia','diaria','semanal','mensual'));

-- ------------------------------------------------------------
-- APPCC: registros (lecturas de temperatura, aceite, limpiezas, recepción)
-- elemento_nombre guarda el nombre en ese momento: el registro sigue siendo
-- legible aunque luego se renombre o elimine el equipo.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appcc_registros (
  id                 uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo               text          NOT NULL CHECK (tipo IN ('temperatura','freidora','limpieza','recepcion')),
  elemento_id        uuid          REFERENCES public.appcc_elementos(id) ON DELETE SET NULL,
  elemento_nombre    text          NOT NULL DEFAULT '',
  fecha              timestamptz   NOT NULL DEFAULT now(),
  valor              numeric(7,1),                -- °C o % compuestos polares
  correcto           boolean       NOT NULL DEFAULT true,
  accion_correctora  text          NOT NULL DEFAULT '',
  responsable        text          NOT NULL DEFAULT '',
  datos              jsonb         NOT NULL DEFAULT '{}',   -- recepción: proveedor, producto, lote…; aceite: cambio
  timestamp          bigint        NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  user_id            uuid          NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS appcc_registros_user_fecha ON public.appcc_registros (user_id, fecha DESC);


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


-- ============================================================
-- RESTAURANTES Y EQUIPO
-- ============================================================
CREATE TABLE IF NOT EXISTS public.restaurantes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      text        NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 100),
  creado_por  uuid        DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.miembros (
  restaurante_id uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rol            text        NOT NULL DEFAULT 'cocina' CHECK (rol IN ('propietario','encargado','cocina')),
  nombre         text        NOT NULL DEFAULT '',
  email          text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurante_id, user_id)
);
CREATE INDEX IF NOT EXISTS miembros_user ON public.miembros (user_id);

CREATE TABLE IF NOT EXISTS public.invitaciones (
  codigo          text        PRIMARY KEY,
  restaurante_id  uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
  rol             text        NOT NULL CHECK (rol IN ('encargado','cocina')),
  creada_por      uuid        DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  expira_en       timestamptz NOT NULL DEFAULT now() + interval '7 days',
  usos_max        integer     NOT NULL DEFAULT 1 CHECK (usos_max BETWEEN 1 AND 50),
  usos            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---- Funciones auxiliares para las políticas (SECURITY DEFINER: sin recursión de RLS) ----
CREATE OR REPLACE FUNCTION public.es_miembro(r uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM miembros WHERE restaurante_id = r AND user_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.rol_en(r uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT rol FROM miembros WHERE restaurante_id = r AND user_id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.puede_gestionar(r uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT coalesce(public.rol_en(r) IN ('propietario','encargado'), false) $$;

-- Restaurante por defecto del usuario (para versiones antiguas de la app que no envían restaurante_id)
CREATE OR REPLACE FUNCTION public.restaurante_por_defecto() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT restaurante_id FROM miembros WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1 $$;

-- ---- Operaciones del equipo (RPC) ----
CREATE OR REPLACE FUNCTION public.crear_restaurante(p_nombre text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE v_id uuid; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  IF coalesce(length(trim(p_nombre)), 0) = 0 THEN RAISE EXCEPTION 'El nombre del restaurante es obligatorio'; END IF;
  IF (SELECT count(*) FROM miembros WHERE user_id = auth.uid() AND rol = 'propietario') >= 20 THEN
    RAISE EXCEPTION 'Has alcanzado el máximo de restaurantes';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO restaurantes (nombre, creado_por) VALUES (trim(p_nombre), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO miembros (restaurante_id, user_id, rol, email) VALUES (v_id, auth.uid(), 'propietario', coalesce(v_email, ''));
  INSERT INTO config (restaurante_id, user_id, empresa) VALUES (v_id, auth.uid(), jsonb_build_object('razonSocial', trim(p_nombre)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crear_invitacion(p_restaurante uuid, p_rol text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE v_codigo text; v_rol text := public.rol_en(p_restaurante);
BEGIN
  IF v_rol IS NULL OR v_rol = 'cocina' THEN RAISE EXCEPTION 'No tienes permiso para invitar'; END IF;
  IF p_rol NOT IN ('encargado','cocina') THEN RAISE EXCEPTION 'Rol no válido'; END IF;
  IF v_rol = 'encargado' AND p_rol <> 'cocina' THEN RAISE EXCEPTION 'Un encargado solo puede invitar a personal de cocina'; END IF;
  -- Código de 8 caracteres sin letras ni números confusos (0/O, 1/I/L)
  LOOP
    v_codigo := (SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') FROM generate_series(1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM invitaciones WHERE codigo = v_codigo);
  END LOOP;
  INSERT INTO invitaciones (codigo, restaurante_id, rol, creada_por) VALUES (v_codigo, p_restaurante, p_rol, auth.uid());
  RETURN v_codigo;
END $$;

CREATE OR REPLACE FUNCTION public.unirse_con_codigo(p_codigo text, p_nombre text DEFAULT '') RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE v_inv invitaciones%ROWTYPE; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  SELECT * INTO v_inv FROM invitaciones WHERE codigo = upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código no válido'; END IF;
  IF v_inv.expira_en < now() THEN RAISE EXCEPTION 'El código ha caducado. Pide uno nuevo.'; END IF;
  IF EXISTS (SELECT 1 FROM miembros WHERE restaurante_id = v_inv.restaurante_id AND user_id = auth.uid()) THEN
    RETURN v_inv.restaurante_id;  -- ya era miembro
  END IF;
  IF v_inv.usos >= v_inv.usos_max THEN RAISE EXCEPTION 'Este código ya se ha usado. Pide uno nuevo.'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO miembros (restaurante_id, user_id, rol, nombre, email)
    VALUES (v_inv.restaurante_id, auth.uid(), v_inv.rol, left(trim(coalesce(p_nombre, '')), 60), coalesce(v_email, ''));
  UPDATE invitaciones SET usos = usos + 1 WHERE codigo = v_inv.codigo;
  RETURN v_inv.restaurante_id;
END $$;

-- Salir de un restaurante (el último propietario no puede: antes debe nombrar a otro)
CREATE OR REPLACE FUNCTION public.salir_restaurante(p_restaurante uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  IF public.rol_en(p_restaurante) = 'propietario'
     AND (SELECT count(*) FROM miembros WHERE restaurante_id = p_restaurante AND rol = 'propietario') <= 1 THEN
    RAISE EXCEPTION 'Eres el único propietario: nombra antes a otro propietario o elimina el restaurante.';
  END IF;
  DELETE FROM miembros WHERE restaurante_id = p_restaurante AND user_id = auth.uid();
END $$;

-- Impedir que un restaurante se quede sin propietario al cambiar roles o expulsar
CREATE OR REPLACE FUNCTION public.miembros_conservar_propietario() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  IF OLD.rol = 'propietario' AND (TG_OP = 'DELETE' OR NEW.rol <> 'propietario')
     AND EXISTS (SELECT 1 FROM restaurantes WHERE id = OLD.restaurante_id)
     AND (SELECT count(*) FROM miembros WHERE restaurante_id = OLD.restaurante_id AND rol = 'propietario' AND user_id <> OLD.user_id) = 0 THEN
    RAISE EXCEPTION 'El restaurante debe tener al menos un propietario';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS miembros_conservar_propietario ON public.miembros;
CREATE TRIGGER miembros_conservar_propietario BEFORE UPDATE OR DELETE ON public.miembros
  FOR EACH ROW EXECUTE FUNCTION public.miembros_conservar_propietario();

REVOKE ALL ON FUNCTION public.crear_restaurante(text), public.crear_invitacion(uuid, text),
  public.unirse_con_codigo(text, text), public.salir_restaurante(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.crear_restaurante(text), public.crear_invitacion(uuid, text),
  public.unirse_con_codigo(text, text), public.salir_restaurante(uuid) TO authenticated;


-- ============================================================
-- MIGRACIÓN: datos por usuario → datos por restaurante (idempotente)
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['productos','plantillas_etiqueta','ingredientes','platos','bebidas','facturas','appcc_elementos','appcc_registros','config']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS restaurante_id uuid REFERENCES public.restaurantes(id) ON DELETE CASCADE', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN restaurante_id SET DEFAULT public.restaurante_por_defecto()', t);
  END LOOP;
END $$;

-- Cada usuario con datos y sin restaurante pasa a ser propietario de uno propio
DO $$
DECLARE u record; v_id uuid; v_nombre text;
BEGIN
  FOR u IN
    SELECT DISTINCT x.user_id FROM (
      SELECT user_id FROM productos UNION SELECT user_id FROM plantillas_etiqueta UNION SELECT user_id FROM ingredientes
      UNION SELECT user_id FROM platos UNION SELECT user_id FROM bebidas UNION SELECT user_id FROM facturas
      UNION SELECT user_id FROM appcc_elementos UNION SELECT user_id FROM appcc_registros UNION SELECT user_id FROM config
    ) x
    WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM miembros m WHERE m.user_id = x.user_id)
  LOOP
    SELECT nullif(trim(empresa->>'razonSocial'), '') INTO v_nombre FROM config WHERE user_id = u.user_id LIMIT 1;
    INSERT INTO restaurantes (nombre, creado_por) VALUES (coalesce(v_nombre, 'Mi restaurante'), u.user_id) RETURNING id INTO v_id;
    INSERT INTO miembros (restaurante_id, user_id, rol, email)
      VALUES (v_id, u.user_id, 'propietario', coalesce((SELECT email FROM auth.users WHERE id = u.user_id), ''));
  END LOOP;
END $$;

-- Asignar a cada fila el restaurante de su autor
DO $$
DECLARE t text; n integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['productos','plantillas_etiqueta','ingredientes','platos','bebidas','facturas','appcc_elementos','appcc_registros','config']
  LOOP
    EXECUTE format('UPDATE public.%I d SET restaurante_id = (SELECT m.restaurante_id FROM public.miembros m WHERE m.user_id = d.user_id ORDER BY m.created_at LIMIT 1) WHERE d.restaurante_id IS NULL', t);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE restaurante_id IS NULL', t) INTO n;
    IF n = 0 THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN restaurante_id SET NOT NULL', t);
    ELSE
      RAISE NOTICE '%: % filas sin restaurante (sin autor); revísalas', t, n;
    END IF;
  END LOOP;
END $$;

-- config: una fila por restaurante (antes, por usuario)
ALTER TABLE public.config ALTER COLUMN user_id SET DEFAULT auth.uid();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'public.config'::regclass AND i.indisprimary AND a.attname = 'restaurante_id'
  ) THEN
    ALTER TABLE public.config DROP CONSTRAINT IF EXISTS config_pkey;
    ALTER TABLE public.config ADD PRIMARY KEY (restaurante_id);
  END IF;
END $$;
ALTER TABLE public.config ALTER COLUMN user_id DROP NOT NULL;  -- ahora solo indica quién lo cambió

-- Índices por restaurante
CREATE INDEX IF NOT EXISTS productos_rest_caducidad    ON public.productos (restaurante_id, fecha_caducidad);
CREATE INDEX IF NOT EXISTS appcc_registros_rest_fecha  ON public.appcc_registros (restaurante_id, fecha DESC);
CREATE INDEX IF NOT EXISTS facturas_rest_tipo_numero   ON public.facturas (restaurante_id, tipo, numero);
DROP INDEX IF EXISTS public.productos_user_caducidad;
DROP INDEX IF EXISTS public.appcc_registros_user_fecha;
DROP INDEX IF EXISTS public.facturas_user_tipo_numero;
DROP INDEX IF EXISTS public.plantillas_etiqueta_nombre_unico;
CREATE UNIQUE INDEX IF NOT EXISTS plantillas_etiqueta_nombre_unico ON public.plantillas_etiqueta (restaurante_id, lower(nombre));


-- ============================================================
-- ROW LEVEL SECURITY
--   · Todo el equipo: etiquetas, habituales, registros APPCC; leer carta, equipos APPCC y configuración
--   · Propietario y encargado: además facturas, carta, equipos APPCC y configuración
--   · Solo propietario: gestionar el restaurante y el equipo
-- ============================================================
DO $$
DECLARE t text; p record;
BEGIN
  -- Borrar las políticas anteriores
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('productos','plantillas_etiqueta','ingredientes','platos','bebidas','facturas','appcc_elementos','appcc_registros','config','restaurantes','miembros','invitaciones','push_subscriptions')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['productos','plantillas_etiqueta','ingredientes','platos','bebidas','facturas','appcc_elementos','appcc_registros','config','restaurantes','miembros','invitaciones','push_subscriptions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Todo el equipo lee y escribe
  FOREACH t IN ARRAY ARRAY['productos','plantillas_etiqueta']
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.es_miembro(restaurante_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.es_miembro(restaurante_id) AND user_id = auth.uid())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.es_miembro(restaurante_id)) WITH CHECK (public.es_miembro(restaurante_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.es_miembro(restaurante_id))', t || '_delete', t);
  END LOOP;

  -- Todo el equipo lee; propietario y encargado escriben
  FOREACH t IN ARRAY ARRAY['ingredientes','platos','bebidas','appcc_elementos']
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.es_miembro(restaurante_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.puede_gestionar(restaurante_id) AND user_id = auth.uid())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.puede_gestionar(restaurante_id)) WITH CHECK (public.puede_gestionar(restaurante_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.puede_gestionar(restaurante_id))', t || '_delete', t);
  END LOOP;
END $$;

-- Facturas y presupuestos: solo propietario y encargado
CREATE POLICY facturas_select ON public.facturas FOR SELECT TO authenticated USING (public.puede_gestionar(restaurante_id));
CREATE POLICY facturas_insert ON public.facturas FOR INSERT TO authenticated WITH CHECK (public.puede_gestionar(restaurante_id) AND user_id = auth.uid());
CREATE POLICY facturas_update ON public.facturas FOR UPDATE TO authenticated USING (public.puede_gestionar(restaurante_id)) WITH CHECK (public.puede_gestionar(restaurante_id));
CREATE POLICY facturas_delete ON public.facturas FOR DELETE TO authenticated USING (public.puede_gestionar(restaurante_id));

-- Registros APPCC: todo el equipo; borrar solo durante 24 h (la dirección, siempre)
CREATE POLICY appcc_registros_select ON public.appcc_registros FOR SELECT TO authenticated USING (public.es_miembro(restaurante_id));
CREATE POLICY appcc_registros_insert ON public.appcc_registros FOR INSERT TO authenticated WITH CHECK (public.es_miembro(restaurante_id) AND user_id = auth.uid());
CREATE POLICY appcc_registros_delete ON public.appcc_registros FOR DELETE TO authenticated
  USING (public.es_miembro(restaurante_id) AND (fecha > now() - interval '1 day' OR public.puede_gestionar(restaurante_id)));

-- Configuración del restaurante: todo el equipo la lee; propietario y encargado la cambian
CREATE POLICY config_select ON public.config FOR SELECT TO authenticated USING (public.es_miembro(restaurante_id));
CREATE POLICY config_insert ON public.config FOR INSERT TO authenticated WITH CHECK (public.puede_gestionar(restaurante_id));
CREATE POLICY config_update ON public.config FOR UPDATE TO authenticated USING (public.puede_gestionar(restaurante_id)) WITH CHECK (public.puede_gestionar(restaurante_id));

-- Restaurantes, miembros e invitaciones
CREATE POLICY restaurantes_select ON public.restaurantes FOR SELECT TO authenticated USING (public.es_miembro(id));
CREATE POLICY restaurantes_update ON public.restaurantes FOR UPDATE TO authenticated USING (public.rol_en(id) = 'propietario') WITH CHECK (public.rol_en(id) = 'propietario');
CREATE POLICY restaurantes_delete ON public.restaurantes FOR DELETE TO authenticated USING (public.rol_en(id) = 'propietario');
CREATE POLICY miembros_select ON public.miembros FOR SELECT TO authenticated USING (public.es_miembro(restaurante_id));
-- El propietario cambia roles; cada uno puede cambiar su propio nombre (no su rol)
CREATE POLICY miembros_update ON public.miembros FOR UPDATE TO authenticated
  USING (public.rol_en(restaurante_id) = 'propietario' OR user_id = auth.uid())
  WITH CHECK (public.rol_en(restaurante_id) = 'propietario' OR (user_id = auth.uid() AND rol = public.rol_en(restaurante_id)));
CREATE POLICY miembros_delete ON public.miembros FOR DELETE TO authenticated USING (public.rol_en(restaurante_id) = 'propietario');
CREATE POLICY invitaciones_select ON public.invitaciones FOR SELECT TO authenticated USING (public.puede_gestionar(restaurante_id));
CREATE POLICY invitaciones_delete ON public.invitaciones FOR DELETE TO authenticated USING (public.puede_gestionar(restaurante_id));

-- Dispositivos para avisos push: cada uno pertenece a su usuario
CREATE POLICY push_subs_own ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ------------------------------------------------------------
-- NUMERACIÓN DE FACTURAS SIN DUPLICADOS (por restaurante)
-- ------------------------------------------------------------
DROP INDEX IF EXISTS public.facturas_numero_unico;
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS facturas_numero_unico ON public.facturas (restaurante_id, tipo, numero);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'No se pudo crear el índice único: hay números de factura duplicados. Consulta: SELECT restaurante_id, tipo, numero, count(*) FROM public.facturas GROUP BY 1,2,3 HAVING count(*) > 1;';
END $$;

-- Refrescar la caché de la API para que vea los cambios al momento
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CARTA PÚBLICA CON QR (alérgenos para clientes)
-- Cada restaurante puede publicar su carta en un enlace secreto (carta_token).
-- La página pública la lee con la función carta_publica (sin iniciar sesión).
-- ============================================================
ALTER TABLE public.restaurantes ADD COLUMN IF NOT EXISTS carta_token text;
CREATE UNIQUE INDEX IF NOT EXISTS restaurantes_carta_token ON public.restaurantes (carta_token) WHERE carta_token IS NOT NULL;
ALTER TABLE public.bebidas ADD COLUMN IF NOT EXISTS alergenos text[] NOT NULL DEFAULT '{}';

-- Publicar (o renovar el enlace de) la carta: solo propietario o encargado
CREATE OR REPLACE FUNCTION public.publicar_carta(p_restaurante uuid, p_renovar boolean DEFAULT false) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE v_token text;
BEGIN
  IF NOT public.puede_gestionar(p_restaurante) THEN RAISE EXCEPTION 'No tienes permiso para publicar la carta'; END IF;
  SELECT carta_token INTO v_token FROM restaurantes WHERE id = p_restaurante;
  IF v_token IS NULL OR p_renovar THEN
    v_token := replace(gen_random_uuid()::text, '-', '');   -- 122 bits aleatorios: no se puede adivinar
    UPDATE restaurantes SET carta_token = v_token WHERE id = p_restaurante;
  END IF;
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION public.despublicar_carta(p_restaurante uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  IF NOT public.puede_gestionar(p_restaurante) THEN RAISE EXCEPTION 'No tienes permiso'; END IF;
  UPDATE restaurantes SET carta_token = NULL WHERE id = p_restaurante;
END $$;

-- Lectura pública: solo lo necesario para el cliente (nada de precios de coste, facturas, etc.)
CREATE OR REPLACE FUNCTION public.carta_publica(p_token text) RETURNS json
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT json_build_object(
    'nombre',    coalesce(nullif(trim(c.empresa->>'razonSocial'), ''), r.nombre),
    'direccion', concat_ws(', ', nullif(c.empresa->>'direccion', ''), nullif(c.empresa->>'ciudad', '')),
    'telefono',  nullif(c.empresa->>'telefono', ''),
    'logo',      c.logo,
    'platos',  coalesce((SELECT json_agg(json_build_object('nombre', p.nombre, 'descripcion', p.descripcion, 'precio', p.precio, 'alergenos', p.alergenos) ORDER BY lower(p.nombre))
                         FROM platos p WHERE p.restaurante_id = r.id), '[]'::json),
    'bebidas', coalesce((SELECT json_agg(json_build_object('nombre', b.nombre, 'descripcion', b.descripcion, 'precio', b.precio, 'categoria', b.categoria, 'alergenos', b.alergenos) ORDER BY b.categoria, lower(b.nombre))
                         FROM bebidas b WHERE b.restaurante_id = r.id), '[]'::json)
  )
  FROM restaurantes r LEFT JOIN config c ON c.restaurante_id = r.id
  WHERE p_token IS NOT NULL AND length(p_token) >= 24 AND r.carta_token = p_token
$$;

REVOKE ALL ON FUNCTION public.publicar_carta(uuid, boolean), public.despublicar_carta(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.publicar_carta(uuid, boolean), public.despublicar_carta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carta_publica(text) TO anon, authenticated;


-- ============================================================
-- ESCANDALLOS: coste de cada ingrediente (los platos guardan la cantidad por ración en su jsonb)
-- ============================================================
ALTER TABLE public.ingredientes
  ADD COLUMN IF NOT EXISTS precio_compra numeric(10,2),                      -- € por unidad de compra (null = sin precio)
  ADD COLUMN IF NOT EXISTS unidad        text         NOT NULL DEFAULT 'kg', -- kg | l | ud
  ADD COLUMN IF NOT EXISTS merma         numeric(5,2) NOT NULL DEFAULT 0;    -- % que se pierde al limpiar o cocinar
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredientes_unidad_ok') THEN
    ALTER TABLE public.ingredientes ADD CONSTRAINT ingredientes_unidad_ok CHECK (unidad IN ('kg','l','ud'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredientes_merma_ok') THEN
    ALTER TABLE public.ingredientes ADD CONSTRAINT ingredientes_merma_ok CHECK (merma >= 0 AND merma < 100);
  END IF;
END $$;


-- ============================================================
-- FACTURAS RECTIFICATIVAS (serie propia R-AAAA-NNNN, tipo = 'factura')
-- ============================================================
ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS rectifica_id         uuid REFERENCES public.facturas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rectifica_numero     text,
  ADD COLUMN IF NOT EXISTS rectifica_fecha      date,
  ADD COLUMN IF NOT EXISTS motivo_rectificacion text;


-- ============================================================
-- COPIAS DE SEGURIDAD AUTOMÁTICAS (cada semana y por restaurante; se guardan las 8 últimas)
-- Solo las crean estas funciones; propietario y encargado las ven y descargan.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.copias_seguridad (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurante_id uuid        NOT NULL REFERENCES public.restaurantes(id) ON DELETE CASCADE,
  creada         timestamptz NOT NULL DEFAULT now(),
  origen         text        NOT NULL DEFAULT 'automatica',   -- automatica | manual
  huella         text        NOT NULL,                        -- md5 de los datos (no se guardan dos copias idénticas seguidas)
  resumen        jsonb       NOT NULL DEFAULT '{}',
  datos          jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS copias_seguridad_rest_fecha ON public.copias_seguridad (restaurante_id, creada DESC);
ALTER TABLE public.copias_seguridad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS copias_seguridad_select ON public.copias_seguridad;
CREATE POLICY copias_seguridad_select ON public.copias_seguridad FOR SELECT TO authenticated USING (public.puede_gestionar(restaurante_id));

-- Todos los datos de un restaurante (formato de la BD, sin user_id ni restaurante_id)
CREATE OR REPLACE FUNCTION public._datos_restaurante(p_restaurante uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT jsonb_build_object(
    'productos',       coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM productos t           WHERE t.restaurante_id = p_restaurante), '[]'),
    'plantillas',      coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM plantillas_etiqueta t WHERE t.restaurante_id = p_restaurante), '[]'),
    'ingredientes',    coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM ingredientes t        WHERE t.restaurante_id = p_restaurante), '[]'),
    'platos',          coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM platos t              WHERE t.restaurante_id = p_restaurante), '[]'),
    'bebidas',         coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM bebidas t             WHERE t.restaurante_id = p_restaurante), '[]'),
    'facturas',        coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM facturas t            WHERE t.restaurante_id = p_restaurante), '[]'),
    'appcc_elementos', coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM appcc_elementos t     WHERE t.restaurante_id = p_restaurante), '[]'),
    'appcc_registros', coalesce((SELECT jsonb_agg(to_jsonb(t) - 'user_id' - 'restaurante_id' ORDER BY t.id) FROM appcc_registros t     WHERE t.restaurante_id = p_restaurante), '[]'),
    'config',          (SELECT jsonb_build_object('empresa', c.empresa, 'impresora', c.impresora) FROM config c WHERE c.restaurante_id = p_restaurante)
  )
$$;

-- Guarda una copia si los datos han cambiado desde la última; conserva 8 automáticas y 5 manuales
CREATE OR REPLACE FUNCTION public._guardar_copia(p_restaurante uuid, p_origen text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE v_datos jsonb; v_huella text; v_id uuid; v_ultima text;
BEGIN
  v_datos  := public._datos_restaurante(p_restaurante);
  v_huella := md5(v_datos::text);
  SELECT id, huella INTO v_id, v_ultima FROM copias_seguridad WHERE restaurante_id = p_restaurante ORDER BY creada DESC LIMIT 1;
  IF v_ultima = v_huella THEN
    RETURN v_id;  -- nada ha cambiado: no hace falta otra copia igual
  END IF;
  INSERT INTO copias_seguridad (restaurante_id, origen, huella, resumen, datos)
  VALUES (p_restaurante, p_origen, v_huella,
          coalesce((SELECT jsonb_object_agg(k, jsonb_array_length(v)) FROM jsonb_each(v_datos) AS e(k, v) WHERE jsonb_typeof(v) = 'array'), '{}'),
          v_datos)
  RETURNING id INTO v_id;
  DELETE FROM copias_seguridad WHERE id IN (
    SELECT id FROM copias_seguridad WHERE restaurante_id = p_restaurante AND origen = p_origen
    ORDER BY creada DESC OFFSET CASE WHEN p_origen = 'manual' THEN 5 ELSE 8 END);
  RETURN v_id;
END $$;

-- Copia en el momento (botón de Configuración): solo propietario o encargado
CREATE OR REPLACE FUNCTION public.crear_copia_ahora(p_restaurante uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  IF NOT public.puede_gestionar(p_restaurante) THEN RAISE EXCEPTION 'No tienes permiso para hacer copias'; END IF;
  RETURN public._guardar_copia(p_restaurante, 'manual');
END $$;

-- Copia semanal de todos los restaurantes (la lanza pg_cron)
CREATE OR REPLACE FUNCTION public.crear_copias_semanales() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM restaurantes LOOP
    PERFORM public._guardar_copia(r.id, 'automatica');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public._datos_restaurante(uuid), public._guardar_copia(uuid, text), public.crear_copias_semanales() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.crear_copia_ahora(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.crear_copia_ahora(uuid) TO authenticated;

-- Programar la copia: los lunes a las 03:00 UTC (requiere la extensión pg_cron)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'copias-semanales';
    PERFORM cron.schedule('copias-semanales', '0 3 * * 1', 'SELECT public.crear_copias_semanales()');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
