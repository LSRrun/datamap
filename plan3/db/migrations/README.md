# 元数据仓库 migrations

此目录保存按版本排序的 PostgreSQL migration。文件名必须使用 `数字_名称.sql`，已经执行的文件不得修改；执行器会校验文件名、版本号和 SHA-256 校验值。

仅校验本地 migration 文件，不连接数据库：

```bash
npm run db:migrate -- --dry-run
```

对元数据仓库执行 migration：

```bash
CATALOG_DATABASE_URL='postgresql://user:password@host:5432/datamap_catalog' npm run db:migrate
```

如需显式配置 SSL，可设置 `CATALOG_DATABASE_SSL_MODE=disable|require|verify`。执行器使用 PostgreSQL Advisory Lock 防止多个应用实例并发迁移，并通过 `catalog_schema_migrations` 记录已执行版本。

数据库结构只通过 migration 变更，不在应用启动过程中临时建表。业务数据源 `SOURCE_DB` 不得用于执行此命令。

当前 migration：

- `001_initial_catalog.sql`：元数据仓库基础表、索引与更新时间触发器。
- `002_column_sync_state.sql`：为字段增加在线状态和最近发现时间，用于字段结构同步与软下线。
