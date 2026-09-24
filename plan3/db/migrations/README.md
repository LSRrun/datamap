# 元数据仓库 migrations

此目录用于保存按版本排序的 PostgreSQL migration。

下一步将在这里建立 migration 执行机制，并创建数据源、逻辑资产、物理表、字段和同步记录等元数据表。数据库结构只通过 migration 变更，不在应用启动过程中临时建表。
