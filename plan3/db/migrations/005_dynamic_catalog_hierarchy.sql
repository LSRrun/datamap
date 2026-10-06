CREATE TABLE catalog_hierarchy_levels (
  id BIGSERIAL PRIMARY KEY,
  level_code VARCHAR(30) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  level_order INTEGER NOT NULL UNIQUE,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_hierarchy_levels_order_check CHECK (level_order BETWEEN 1 AND 6)
);

COMMENT ON TABLE catalog_hierarchy_levels IS '可配置的业务目录层级定义；数据资产和物理表不属于可删除目录层级';

INSERT INTO catalog_hierarchy_levels (level_code, display_name, level_order)
VALUES
  ('L1', '一级主题域', 1),
  ('L2', '二级主题域', 2),
  ('L3', '业务对象', 3);

CREATE TABLE catalog_hierarchy_nodes (
  id BIGSERIAL PRIMARY KEY,
  level_id BIGINT NOT NULL REFERENCES catalog_hierarchy_levels(id) ON DELETE RESTRICT,
  parent_id BIGINT REFERENCES catalog_hierarchy_nodes(id) ON DELETE RESTRICT,
  node_code VARCHAR(120),
  node_name VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(20),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_hierarchy_nodes_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX catalog_hierarchy_nodes_sibling_name_key
  ON catalog_hierarchy_nodes (level_id, COALESCE(parent_id, 0), LOWER(node_name));
CREATE INDEX catalog_hierarchy_nodes_parent_idx ON catalog_hierarchy_nodes (parent_id, sort_order, id);
CREATE INDEX catalog_hierarchy_nodes_level_idx ON catalog_hierarchy_nodes (level_id, sort_order, id);

CREATE TABLE catalog_asset_hierarchy (
  asset_id BIGINT PRIMARY KEY REFERENCES catalog_assets(id) ON DELETE CASCADE,
  leaf_node_id BIGINT NOT NULL REFERENCES catalog_hierarchy_nodes(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX catalog_asset_hierarchy_leaf_idx ON catalog_asset_hierarchy (leaf_node_id);

CREATE TRIGGER catalog_hierarchy_levels_set_updated_at
BEFORE UPDATE ON catalog_hierarchy_levels
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

CREATE TRIGGER catalog_hierarchy_nodes_set_updated_at
BEFORE UPDATE ON catalog_hierarchy_nodes
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

CREATE TRIGGER catalog_asset_hierarchy_set_updated_at
BEFORE UPDATE ON catalog_asset_hierarchy
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

DO $$
DECLARE
  asset RECORD;
  l1_level_id BIGINT;
  l2_level_id BIGINT;
  l3_level_id BIGINT;
  l1_node_id BIGINT;
  l2_node_id BIGINT;
  l3_node_id BIGINT;
BEGIN
  SELECT id INTO l1_level_id FROM catalog_hierarchy_levels WHERE level_order = 1;
  SELECT id INTO l2_level_id FROM catalog_hierarchy_levels WHERE level_order = 2;
  SELECT id INTO l3_level_id FROM catalog_hierarchy_levels WHERE level_order = 3;

  FOR asset IN
    SELECT id, l1_domain, l2_topic, l3_object
    FROM catalog_assets
    ORDER BY source_row NULLS LAST, id
  LOOP
    SELECT id INTO l1_node_id
    FROM catalog_hierarchy_nodes
    WHERE level_id = l1_level_id AND parent_id IS NULL AND LOWER(node_name) = LOWER(asset.l1_domain)
    LIMIT 1;
    IF l1_node_id IS NULL THEN
      INSERT INTO catalog_hierarchy_nodes (level_id, parent_id, node_name, sort_order)
      VALUES (l1_level_id, NULL, asset.l1_domain, 0)
      RETURNING id INTO l1_node_id;
    END IF;

    SELECT id INTO l2_node_id
    FROM catalog_hierarchy_nodes
    WHERE level_id = l2_level_id AND parent_id = l1_node_id AND LOWER(node_name) = LOWER(asset.l2_topic)
    LIMIT 1;
    IF l2_node_id IS NULL THEN
      INSERT INTO catalog_hierarchy_nodes (level_id, parent_id, node_name, sort_order)
      VALUES (l2_level_id, l1_node_id, asset.l2_topic, 0)
      RETURNING id INTO l2_node_id;
    END IF;

    SELECT id INTO l3_node_id
    FROM catalog_hierarchy_nodes
    WHERE level_id = l3_level_id AND parent_id = l2_node_id AND LOWER(node_name) = LOWER(asset.l3_object)
    LIMIT 1;
    IF l3_node_id IS NULL THEN
      INSERT INTO catalog_hierarchy_nodes (level_id, parent_id, node_name, sort_order)
      VALUES (l3_level_id, l2_node_id, asset.l3_object, 0)
      RETURNING id INTO l3_node_id;
    END IF;

    INSERT INTO catalog_asset_hierarchy (asset_id, leaf_node_id)
    VALUES (asset.id, l3_node_id)
    ON CONFLICT (asset_id) DO UPDATE SET leaf_node_id = EXCLUDED.leaf_node_id;

    l1_node_id := NULL;
    l2_node_id := NULL;
    l3_node_id := NULL;
  END LOOP;
END $$;

