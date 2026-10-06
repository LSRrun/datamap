ALTER TABLE catalog_hierarchy_levels
  ADD COLUMN level_type VARCHAR(30) NOT NULL DEFAULT 'directory';

ALTER TABLE catalog_hierarchy_levels
  ADD CONSTRAINT catalog_hierarchy_levels_type_check
  CHECK (level_type IN ('directory', 'data_table'));

INSERT INTO catalog_hierarchy_levels (
  level_code, display_name, level_order, level_type, is_required, is_enabled
)
VALUES ('L4', '数据表', 4, 'data_table', TRUE, TRUE);

COMMENT ON COLUMN catalog_hierarchy_levels.level_type IS
  'directory 为可配置业务目录层级；data_table 为必须保留在末级的数据表层';
COMMENT ON TABLE catalog_hierarchy_levels IS
  '可配置的业务目录层级定义；末级数据表来自 catalog_assets，实体表来自 catalog_physical_tables';

WITH data_table_level AS (
  SELECT id FROM catalog_hierarchy_levels WHERE level_type = 'data_table'
)
INSERT INTO catalog_hierarchy_nodes (
  level_id, parent_id, node_code, node_name, sort_order, is_enabled
)
SELECT
  data_table_level.id,
  assignment.leaf_node_id,
  asset.asset_code,
  asset.name_cn,
  COALESCE(asset.source_row, asset.id)::INTEGER,
  TRUE
FROM catalog_assets asset
JOIN catalog_asset_hierarchy assignment ON assignment.asset_id = asset.id
CROSS JOIN data_table_level
ORDER BY asset.source_row NULLS LAST, asset.id;

WITH data_table_level AS (
  SELECT id FROM catalog_hierarchy_levels WHERE level_type = 'data_table'
)
UPDATE catalog_asset_hierarchy assignment
SET leaf_node_id = data_table_node.id
FROM catalog_assets asset
JOIN catalog_hierarchy_nodes data_table_node
  ON data_table_node.node_code = asset.asset_code
CROSS JOIN data_table_level
WHERE assignment.asset_id = asset.id
  AND data_table_node.level_id = data_table_level.id;

CREATE UNIQUE INDEX catalog_hierarchy_nodes_data_table_code_key
  ON catalog_hierarchy_nodes (level_id, LOWER(node_code))
  WHERE node_code IS NOT NULL;

