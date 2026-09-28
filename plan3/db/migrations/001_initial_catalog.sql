CREATE TABLE data_sources (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  type VARCHAR(30) NOT NULL DEFAULT 'postgresql',
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 5432,
  database_name VARCHAR(120) NOT NULL,
  username VARCHAR(120) NOT NULL,
  default_schema VARCHAR(120) NOT NULL DEFAULT 'public',
  ssl_mode VARCHAR(20) NOT NULL DEFAULT 'disable',
  credential_provider VARCHAR(30) NOT NULL DEFAULT 'env',
  credential_ref VARCHAR(255),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  include_schemas TEXT[] NOT NULL DEFAULT ARRAY['public']::TEXT[],
  exclude_schemas TEXT[] NOT NULL DEFAULT ARRAY['pg_catalog', 'information_schema', 'pg_toast']::TEXT[],
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_sources_type_check CHECK (type = 'postgresql'),
  CONSTRAINT data_sources_port_check CHECK (port BETWEEN 1 AND 65535),
  CONSTRAINT data_sources_sync_interval_check CHECK (sync_interval_minutes > 0)
);

COMMENT ON TABLE data_sources IS '业务数据源的非敏感连接信息；数据库密码不得写入本表';
COMMENT ON COLUMN data_sources.credential_ref IS '环境变量、密钥管理服务或本地钥匙串中的凭据引用，不保存密码原文';

CREATE TABLE catalog_assets (
  id BIGSERIAL PRIMARY KEY,
  asset_code VARCHAR(120) NOT NULL UNIQUE,
  name_cn VARCHAR(255) NOT NULL,
  l1_domain VARCHAR(255) NOT NULL,
  l2_topic VARCHAR(255) NOT NULL,
  l3_object VARCHAR(255) NOT NULL,
  owner VARCHAR(120),
  description TEXT,
  online_status VARCHAR(30),
  lake_status VARCHAR(30),
  sensitivity_level VARCHAR(30),
  source_row INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_assets_source_row_check CHECK (source_row IS NULL OR source_row > 0)
);

CREATE INDEX catalog_assets_hierarchy_idx
  ON catalog_assets (l1_domain, l2_topic, l3_object);
CREATE INDEX catalog_assets_name_cn_idx ON catalog_assets (name_cn);

CREATE TABLE catalog_physical_tables (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT REFERENCES catalog_assets(id) ON DELETE SET NULL,
  source_id BIGINT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  schema_name VARCHAR(120) NOT NULL,
  table_name VARCHAR(255) NOT NULL,
  table_type VARCHAR(30) NOT NULL DEFAULT 'table',
  table_comment TEXT,
  estimated_rows BIGINT,
  total_bytes BIGINT,
  structure_hash CHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_physical_tables_identity_key UNIQUE (source_id, schema_name, table_name),
  CONSTRAINT catalog_physical_tables_estimated_rows_check CHECK (estimated_rows IS NULL OR estimated_rows >= 0),
  CONSTRAINT catalog_physical_tables_total_bytes_check CHECK (total_bytes IS NULL OR total_bytes >= 0)
);

CREATE INDEX catalog_physical_tables_asset_idx ON catalog_physical_tables (asset_id);
CREATE INDEX catalog_physical_tables_active_idx ON catalog_physical_tables (source_id, is_active);

CREATE TABLE catalog_columns (
  id BIGSERIAL PRIMARY KEY,
  physical_table_id BIGINT NOT NULL REFERENCES catalog_physical_tables(id) ON DELETE CASCADE,
  column_name VARCHAR(255) NOT NULL,
  ordinal_position INTEGER NOT NULL,
  data_type TEXT NOT NULL,
  is_nullable BOOLEAN NOT NULL,
  default_value TEXT,
  is_primary_key BOOLEAN NOT NULL DEFAULT FALSE,
  column_comment TEXT,
  sensitivity_level VARCHAR(30),
  masking_rule VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_columns_identity_key UNIQUE (physical_table_id, column_name),
  CONSTRAINT catalog_columns_ordinal_check CHECK (ordinal_position > 0)
);

CREATE INDEX catalog_columns_order_idx
  ON catalog_columns (physical_table_id, ordinal_position);

CREATE TABLE catalog_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  trigger_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  tables_found INTEGER NOT NULL DEFAULT 0,
  tables_created INTEGER NOT NULL DEFAULT 0,
  tables_updated INTEGER NOT NULL DEFAULT 0,
  tables_offline INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_sync_runs_trigger_check CHECK (trigger_type IN ('startup', 'scheduled', 'manual')),
  CONSTRAINT catalog_sync_runs_status_check CHECK (status IN ('running', 'success', 'partial_success', 'failed', 'skipped')),
  CONSTRAINT catalog_sync_runs_counts_check CHECK (
    tables_found >= 0 AND tables_created >= 0 AND tables_updated >= 0 AND tables_offline >= 0
  ),
  CONSTRAINT catalog_sync_runs_time_check CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX catalog_sync_runs_source_started_idx
  ON catalog_sync_runs (source_id, started_at DESC);

CREATE TABLE catalog_annotations (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT REFERENCES catalog_assets(id) ON DELETE CASCADE,
  physical_table_id BIGINT REFERENCES catalog_physical_tables(id) ON DELETE CASCADE,
  column_id BIGINT REFERENCES catalog_columns(id) ON DELETE CASCADE,
  annotation_key VARCHAR(80) NOT NULL,
  annotation_value JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_annotations_one_target_check CHECK (
    (CASE WHEN asset_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN physical_table_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN column_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

CREATE UNIQUE INDEX catalog_annotations_asset_key
  ON catalog_annotations (asset_id, annotation_key) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_annotations_table_key
  ON catalog_annotations (physical_table_id, annotation_key) WHERE physical_table_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_annotations_column_key
  ON catalog_annotations (column_id, annotation_key) WHERE column_id IS NOT NULL;

CREATE OR REPLACE FUNCTION catalog_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER data_sources_set_updated_at
BEFORE UPDATE ON data_sources
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

CREATE TRIGGER catalog_assets_set_updated_at
BEFORE UPDATE ON catalog_assets
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

CREATE TRIGGER catalog_physical_tables_set_updated_at
BEFORE UPDATE ON catalog_physical_tables
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

CREATE TRIGGER catalog_columns_set_updated_at
BEFORE UPDATE ON catalog_columns
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

CREATE TRIGGER catalog_annotations_set_updated_at
BEFORE UPDATE ON catalog_annotations
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();
