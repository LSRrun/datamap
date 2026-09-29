ALTER TABLE catalog_physical_tables
  ADD COLUMN asset_type VARCHAR(30),
  ADD COLUMN data_layer VARCHAR(30);

COMMENT ON COLUMN catalog_physical_tables.asset_type IS '资产清单维护的资产类型，如事实表、维度表';
COMMENT ON COLUMN catalog_physical_tables.data_layer IS '资产清单维护的数据分层，如模型层、应用层';
