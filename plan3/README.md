# 东鹏数据地图 Demo

这是一个逐步服务化中的数据地图 Demo。当前目录数据仍来自 `数据模型全.xlsx` 生成的静态文件，页面由 Node.js 后端统一提供。

## 项目结构

```text
frontend/          当前页面、样式和静态目录数据
backend/           API、静态资源服务和 PostgreSQL 连接管理
db/migrations/     后续元数据仓库 migration
deploy/            后续服务器与容器部署配置
scripts/           现有 Excel 提取脚本（待改造成导入命令）
```

本轮只完成运行时代码的目录分层，不改变页面 URL、交互和 PostgreSQL 连接配置位置。`src/` 与 `server.mjs` 是早期原型，暂不参与当前启动流程，后续单独核对清理。

## 使用方式

首次运行先安装依赖，然后启动本地服务：

```bash
npm install
npm start
```

然后访问 `http://127.0.0.1:58973/`。数据库连接测试需要通过该服务运行；直接双击 HTML 时只能查看页面，不能测试 PostgreSQL 连接。

首页“业务主题分布”支持五步钻取：L1 领域 → L2 主题域 → L3 业务对象 → L4 数据资产 → 实体表。点击任意层级卡片后，面包屑、状态统计和下方 Data Catalog 会同步到当前范围；一个 L4 关联多张物理表时，最后一级会拆成独立实体表卡片，点击后直接打开对应物理表的详情、字段结构和数据查询。

元数据管理页面位于 `http://127.0.0.1:58973/metadata.html`，也可以从数据地图顶部的“元数据管理”按钮进入。该页面读取 `CATALOG_DB`，支持搜索、状态筛选、分页、排序，以及编辑 L1/L2/L3、中文表名、负责人、说明、线上化、入湖和敏感等级。每条已登记物理表的资产都可通过“字段结构”查看同步后的字段明细；一个资产关联多张物理表时可在弹窗内切换。物理表名由同步流程维护，页面中仅供查看。

数据表详情侧边栏提供“表数据查询”。查询目标必须来自 `CATALOG_DB` 中该资产已登记的物理表，浏览器不能提交 SQL 或任意表名；服务端使用已保存的只读业务 PostgreSQL 连接执行分页查询，默认每页 20 行、单次最多 100 行，并设置查询超时。

字段结构来自 `CATALOG_DB`，不在打开侧边栏时临时扫描业务库。执行字段同步后，侧边栏会按当前物理表展示字段顺序、字段名、类型、可空性、主键和字段备注。

## 元数据仓库 migration

校验 migration 文件但不连接数据库：

```bash
npm run db:migrate -- --dry-run
```

配置独立元数据 PostgreSQL 后执行：

```bash
CATALOG_DATABASE_URL='postgresql://user:password@host:5432/datamap_catalog' npm run db:migrate
```

此连接只用于 `CATALOG_DB`，不得填写现有只读业务数据源。已执行 migration 的版本和校验值记录在 `catalog_schema_migrations` 表中。

当前 macOS 本地开发环境已创建独立的 PostgreSQL 15 数据库：

```text
数据库：datamap_catalog
所有者：datamap_catalog_app
地址：127.0.0.1:5432
```

本机执行 migration 时使用：

```bash
CATALOG_DATABASE_URL='postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog' npm run db:migrate
```

该无密码连接仅适用于当前本机开发实例。服务器环境必须使用独立密码或密钥服务，不能照搬本地认证方式。

## 业务数据源密码加密存储

业务 PostgreSQL 密码使用 AES-256-GCM 加密后保存在元数据仓库的 `data_source_credentials` 表中。数据库只保存密文、随机 IV、认证标签和密钥版本；用于解密的 32 字节主密钥必须通过服务端环境变量提供，不能写入数据库、代码仓库或浏览器。

首次部署生成主密钥：

```bash
openssl rand -base64 32
```

启动服务、保存连接和执行同步时使用同一个主密钥：

```bash
export DATAMAP_CREDENTIAL_MASTER_KEY='<32 字节密钥的 Base64 或 64 位十六进制编码>'
export CATALOG_DATABASE_URL='postgresql://user:password@host:5432/datamap_catalog'
npm start
```

执行 `007_encrypted_data_source_credentials.sql` 后，需要在设置页面重新输入并保存一次业务数据库密码。后续连接测试、心跳重连、数据预览和 `sync:catalog` 都从元数据仓库读取并在服务进程内解密。主密钥丢失后已有密文无法恢复；更换主密钥前必须先实现密钥轮换或重新保存密码。

## Excel 目录导入

导入脚本需要 Python 3 和 `openpyxl`：

```bash
python3 -m pip install -r requirements.txt
```

先执行预检，只解析工作簿并生成报告，不写数据库：

```bash
PYTHON_BIN=python3 npm run import:catalog -- '/path/to/数据模型全.xlsx' --dry-run
```

确认报告后导入本机元数据仓库：

```bash
PYTHON_BIN=python3 \
CATALOG_DATABASE_URL='postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog' \
npm run import:catalog -- '/path/to/数据模型全.xlsx'
```

导入报告保存在 `.data/catalog-import-report.json`。脚本会按 L1/L2/L3/L4 层级补全合并单元格产生的空白，拆分一个单元格中的多个物理表名，并使用数据源设置中的默认 Schema 补全未写 Schema 的表名。重复物理表只保留第一次出现的主关联，并在报告中列出冲突。重复执行不会覆盖人工维护的负责人、说明和分类。

## PostgreSQL 字段结构同步

先执行最新 migration，再预检当前数据源中可匹配的物理表和字段：

```bash
CATALOG_DATABASE_URL='postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog' \
npm run db:migrate

CATALOG_DATABASE_URL='postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog' \
DATAMAP_CREDENTIAL_MASTER_KEY='<主密钥>' \
npm run sync:catalog -- --dry-run
```

确认预检结果后正式同步：

```bash
CATALOG_DATABASE_URL='postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog' \
DATAMAP_CREDENTIAL_MASTER_KEY='<主密钥>' \
npm run sync:catalog
```

同步脚本从元数据仓库读取业务数据源配置和加密密码，只在进程内使用主密钥解密；随后读取业务 PostgreSQL 的 `pg_catalog` 和 `information_schema`，将表、字段、类型、主键、备注、结构指纹和在线状态写入元数据仓库。密码不会写入报告，结果保存在 `.data/catalog-sync-report.json`。

## 功能

- L1 → L2 → L3 → L4 四级可展开目录树
- 参考 plan1 的圆形数据表粒子网络，不在网络中绘制 L1/L2/L3 层级节点
- 默认按 L3 业务对象连接数据表，可切换为按 L2 主题域连接
- 点击一级主题域自动居中聚焦并隐藏其他主题域
- 拖拽平移、滚轮/按钮缩放和平滑镜头动画
- 点击地图节点或目录中的 L4 数据表打开详情抽屉
- 中文表名、英文表名、业务对象和负责人搜索
- 地图左上角与目录联动的线上/未线上、入湖/未入湖状态筛选
- 按二级主题域分组的卡片/紧凑视图
- 参考 plan1 的图内浮动详情卡，无全屏遮罩；可查看相同 L3 业务对象或相同 L2 主题域的数据表，并按所选层级高亮当前节点的关联边
- 目录工具栏支持 L2 主题域与 L3 业务对象级联筛选，并同步更新关系图
- 点击左侧目录中的 L4 数据表时，Data Catalog 自动同步其 L1、L2、L3 筛选
- 当前选中的数据表会在 Data Catalog 中显示主题色高亮外圈
- 顶部“设置”进入数据库连接页，支持测试并持久保存 PostgreSQL 连接
- 保存后由本机服务端连接池持续保持连接，每 15 秒执行心跳检查，断线后自动重连，服务重启后自动恢复
- PostgreSQL 密码以 AES-256-GCM 密文保存在元数据仓库中；主密钥仅由服务端环境变量提供，`.data/postgres-connection.json` 只作为非敏感兼容配置
- 数据表详情支持从已连接 PostgreSQL 只读分页查询当前物理表，并可在侧边栏中翻页、刷新和横向查看字段
- 字段同步后，详情侧边栏自动展示当前物理表的字段名、类型、可空性、主键和字段备注
- 详情侧边栏按当前物理表展示质量分、SLA、存储量、精确数据行数、下游引用和访问热度；存储量通过 `pg_size_pretty(pg_total_relation_size(...))`、数据行数通过只读 `COUNT(*)` 按需计算并缓存到元数据仓库
- 元数据管理页面可按物理表维护质量分、SLA 达成率、下游引用和访问热度；存储量与数据行数为自动计算的只读指标
- 详情侧边栏可通过“编辑元数据”直接进入元数据管理页，并自动打开当前资产的编辑弹窗
- 资产类型和数据分层以 Excel 清单为准同步到每张物理表，详情侧边栏展示真实标签；元数据管理页支持按物理表修改标签
- 桌面和移动端响应式布局

## 更新数据

当前 `frontend/data.js` 为从 Excel 生成的静态数据。Excel 更新后，需要重新生成该文件。

当 Excel 用黄色底色标记“英文表名”改动时，可只应用这些高亮单元格，避免覆盖未标记的目录内容：

```bash
npm run update:highlighted-tables -- \
  "/path/to/数据地图资产清单.xlsx" \
  frontend/data.js \
  --report .data/highlighted-table-update-report.json
```

该命令与目录导入共用 `PYTHON_BIN` 配置（默认优先使用项目 `.venv/bin/python3`），脚本会按 Excel 行号更新对应 L4 的英文表名，并忽略其他列的黄色备注。随后执行目录导入和字段同步：

```bash
npm run import:catalog -- "/path/to/数据地图资产清单.xlsx"
npm run sync:catalog
```

目录导入发现同一 L4 下表名不变、仅 Schema 变化时，会原地更新物理表记录并保留其标识和已有字段数据；字段同步随后会按新 Schema 刷新在线状态与字段结构。
