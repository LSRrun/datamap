ALTER TABLE catalog_physical_tables
  ADD COLUMN exact_row_count BIGINT,
  ADD COLUMN total_size_pretty VARCHAR(64),
  ADD COLUMN quality_score NUMERIC(5, 2),
  ADD COLUMN sla_achievement_rate NUMERIC(5, 2),
  ADD COLUMN downstream_references INTEGER,
  ADD COLUMN access_heat INTEGER;

ALTER TABLE catalog_physical_tables
  ADD CONSTRAINT catalog_physical_tables_exact_row_count_check
    CHECK (exact_row_count IS NULL OR exact_row_count >= 0),
  ADD CONSTRAINT catalog_physical_tables_quality_score_check
    CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 100),
  ADD CONSTRAINT catalog_physical_tables_sla_rate_check
    CHECK (sla_achievement_rate IS NULL OR sla_achievement_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT catalog_physical_tables_downstream_references_check
    CHECK (downstream_references IS NULL OR downstream_references >= 0),
  ADD CONSTRAINT catalog_physical_tables_access_heat_check
    CHECK (access_heat IS NULL OR access_heat >= 0);

COMMENT ON COLUMN catalog_physical_tables.exact_row_count IS '从业务数据源执行 COUNT(*) 得到的精确数据行数';
COMMENT ON COLUMN catalog_physical_tables.total_size_pretty IS '从业务数据源执行 pg_size_pretty(pg_total_relation_size(...)) 得到的存储量';
COMMENT ON COLUMN catalog_physical_tables.quality_score IS '人工维护的数据质量分，0 到 100';
COMMENT ON COLUMN catalog_physical_tables.sla_achievement_rate IS '人工维护的 SLA 达成率，0 到 100';
COMMENT ON COLUMN catalog_physical_tables.downstream_references IS '人工维护的下游引用数量';
COMMENT ON COLUMN catalog_physical_tables.access_heat IS '人工维护的访问热度';
