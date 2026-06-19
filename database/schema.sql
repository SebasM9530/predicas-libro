-- ============================================
-- Extensiones necesarias
-- ============================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid()

-- ============================================
-- Tabla: capitulos
-- ============================================
CREATE TABLE capitulos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_orden    INTEGER,
    titulo          TEXT,
    fecha_sermon    DATE NOT NULL,
    estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'transcribiendo', 'analizando', 'listo', 'error')),
    audio_url       TEXT,
    texto_original  TEXT,
    texto_actual    TEXT,
    promovido       BOOLEAN NOT NULL DEFAULT FALSE,
    error_detalle   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_capitulos_estado ON capitulos(estado);
CREATE INDEX idx_capitulos_fecha ON capitulos(fecha_sermon);

-- ============================================
-- Tabla: sugerencias
-- ============================================
CREATE TABLE sugerencias (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capitulo_id         UUID NOT NULL REFERENCES capitulos(id) ON DELETE CASCADE,
    fragmento_original  TEXT NOT NULL,
    fragmento_nuevo     TEXT NOT NULL,
    tipo                TEXT NOT NULL,
    problema            TEXT NOT NULL,
    nota_adicional      TEXT,
    posicion_inicio     INTEGER,
    posicion_fin        INTEGER,
    estado              TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'aplicada')),
    origen              TEXT NOT NULL DEFAULT 'automatico'
                        CHECK (origen IN ('automatico', 'instruccion_manual')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sugerencias_capitulo ON sugerencias(capitulo_id);
CREATE INDEX idx_sugerencias_estado ON sugerencias(estado);

-- ============================================
-- Tabla: trabajos_cola
-- ============================================
CREATE TABLE trabajos_cola (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capitulo_id     UUID NOT NULL REFERENCES capitulos(id) ON DELETE CASCADE,
    tipo            TEXT NOT NULL
                    CHECK (tipo IN ('transcripcion', 'analisis_ia', 'instruccion_manual')),
    estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'procesando', 'completado', 'fallido')),
    intentos        INTEGER NOT NULL DEFAULT 0,
    payload         JSONB,
    error_detalle   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trabajos_capitulo ON trabajos_cola(capitulo_id);
CREATE INDEX idx_trabajos_estado ON trabajos_cola(estado);

-- ============================================
-- Tabla: libro_capitulos
-- ============================================
CREATE TABLE libro_capitulos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capitulo_id     UUID NOT NULL UNIQUE REFERENCES capitulos(id) ON DELETE CASCADE,
    numero_orden    INTEGER NOT NULL,
    titulo          TEXT NOT NULL,
    fecha_sermon    DATE NOT NULL,
    texto_final     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_libro_capitulos_orden ON libro_capitulos(numero_orden);

-- ============================================
-- Tabla: libro_config (singleton)
-- ============================================
CREATE TABLE libro_config (
    id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    titulo_libro        TEXT NOT NULL DEFAULT 'Prédicas',
    autor               TEXT,
    subtitulo           TEXT,
    config_estilos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO libro_config (id) VALUES (1);

-- ============================================
-- Trigger genérico: actualizar updated_at
-- ============================================
CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_capitulos_updated_at
    BEFORE UPDATE ON capitulos
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_trabajos_updated_at
    BEFORE UPDATE ON trabajos_cola
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_libro_capitulos_updated_at
    BEFORE UPDATE ON libro_capitulos
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trg_libro_config_updated_at
    BEFORE UPDATE ON libro_config
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();
