# 数据地图 Plan 2

主题域目录 + 数据表卡片 Demo。页面数据来自 `数据模型全.xlsx`。

## 启动

```bash
npm run dev
```

默认地址是 `http://127.0.0.1:4173`。若端口被占用，服务会自动尝试 4174、4175 等后续端口，以终端实际输出为准。

## 更新目录数据

```bash
python3 scripts/extract_excel.py /path/to/数据模型全.xlsx src/data.js
```
