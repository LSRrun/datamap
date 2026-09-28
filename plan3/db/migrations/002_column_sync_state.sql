ALTER TABLE catalog_columns
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE catalog_columns
  ADD COLUMN last_seen_at TIMESTAMPTZ;

CREATE INDEX catalog_columns_active_idx
  ON catalog_columns (physical_table_id, is_active, ordinal_position);

COMMENT ON COLUMN catalog_columns.is_active IS '字段是否仍存在于最近一次成功采集的物理表结构中';
COMMENT ON COLUMN catalog_columns.last_seen_at IS '字段最近一次在业务数据源中被发现的时间';
