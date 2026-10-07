# Docker Compose 部署

`compose.yaml` 会启动两个相互隔离的服务：

- `catalog-db`：独立的 PostgreSQL 17 元数据库，不发布宿主机端口。
- `app`：数据地图 Node.js 服务，默认只发布到宿主机的 `127.0.0.1:58974`。

该配置不会占用宿主机的 `5432`，也不会修改服务器上已经运行的 PostgreSQL、Caddy 或其他 Docker Compose 项目。

## 1. 创建本地密钥文件

在 `plan3` 目录执行：

```bash
umask 077
printf 'CATALOG_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env
printf 'DATAMAP_CREDENTIAL_MASTER_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
printf 'DATAMAP_HOST_PORT=58974\n' >> .env
chmod 600 .env
```

`.env` 已被 Git 忽略，不得提交到仓库、聊天或工单。主密钥丢失后，数据库中已有的业务数据源密码密文无法恢复。

如果恢复的元数据库已经包含 `data_source_credentials`，必须使用生成这些密文时的原主密钥，不可重新生成。

## 2. 校验和构建

```bash
docker compose config --quiet
docker compose build app
```

## 3. 新建空元数据库并启动

仅在不需要迁移旧元数据库时执行：

```bash
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:58974/api/catalog/summary
```

应用容器会在启动时先执行 migration，再启动 HTTP 服务。

## 4. 恢复已有元数据库

恢复前只启动数据库：

```bash
docker compose up -d catalog-db
docker compose exec -T catalog-db pg_isready -U datamap_catalog_app -d datamap_catalog
```

把自定义格式的 `pg_dump` 文件放到当前目录，例如 `datamap_catalog.dump`，然后恢复：

```bash
docker compose exec -T catalog-db pg_restore \
  -U datamap_catalog_app \
  -d datamap_catalog \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  < datamap_catalog.dump
```

恢复成功后启动应用：

```bash
docker compose up -d app
docker compose ps
curl -fsS http://127.0.0.1:58974/api/catalog/summary
```

## 5. 日常命令

```bash
docker compose ps
docker compose logs --tail=100 app
docker compose restart app
docker compose pull catalog-db
docker compose build app
docker compose up -d
```

默认端口只绑定到 `127.0.0.1`。需要给公司用户访问时，应由现有 Caddy 或 Nginx 通过 HTTPS 反向代理到该端口，不应直接把应用或数据库端口暴露到公网。
