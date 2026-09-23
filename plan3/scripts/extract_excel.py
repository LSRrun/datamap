#!/usr/bin/env python3
"""Extract the data catalog workbook into a browser-ready JavaScript file."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook


HEADERS = {
    "主题域分组": "domain",
    "主题域": "subdomain",
    "业务对象": "object",
    "数据表": "name",
    "英文表名": "englishName",
    "模型负责人": "owner",
    "上线时间": "launchDate",
    "是否线上化": "online",
    "是否入湖": "inLake",
    "说明": "note",
}


def normalize(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    return str(value).strip()


def extract(workbook_path: Path) -> dict:
    # This workbook's cached worksheet dimension stops at column I even though
    # useful fields continue through column K. Normal mode recalculates the
    # real used range; read-only mode would silently omit "是否入湖" and "说明".
    workbook = load_workbook(workbook_path, read_only=False, data_only=True)
    sheet = workbook["模型目录"]
    rows = sheet.iter_rows(values_only=True)
    headers = [normalize(value) for value in next(rows)]
    positions = {name: headers.index(name) for name in HEADERS if name in headers}

    current = {"domain": "", "subdomain": "", "object": ""}
    domain_order: list[str] = []
    tables: list[dict] = []

    for values in rows:
        row = {
            target: normalize(values[positions[source]])
            for source, target in HEADERS.items()
            if source in positions and positions[source] < len(values)
        }
        for level in ("domain", "subdomain", "object"):
            if row.get(level):
                current[level] = row[level]
            else:
                row[level] = current[level]

        if row.get("domain") and row["domain"] not in domain_order:
            domain_order.append(row["domain"])
        if row.get("name"):
            tables.append({key: row.get(key, "") for key in HEADERS.values()})

    counts = {name: 0 for name in domain_order}
    for table in tables:
        counts[table["domain"]] = counts.get(table["domain"], 0) + 1

    return {
        "source": workbook_path.name,
        "domains": [{"name": name, "count": counts.get(name, 0)} for name in domain_order],
        "tables": tables,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    payload = extract(args.workbook)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "window.DATA_MAP = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Extracted {len(payload['tables'])} tables across {len(payload['domains'])} domains -> {args.output}")


if __name__ == "__main__":
    main()
