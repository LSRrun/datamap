#!/usr/bin/env python3
"""Apply yellow-highlighted English table-name changes to frontend/data.js."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook


REQUIRED_HEADERS = ("数据表", "英文表名")
YELLOW_RGB = "FFFF00"


def normalize(value) -> str:
    return "" if value is None else str(value).strip()


def select_sheet(workbook):
    candidates = []
    for sheet in workbook.worksheets:
        headers = [normalize(cell.value) for cell in sheet[1]]
        if all(name in headers for name in REQUIRED_HEADERS):
            candidates.append(sheet)
    if "模型目录" in workbook.sheetnames:
        return workbook["模型目录"]
    if len(candidates) == 1:
        return candidates[0]
    raise ValueError("无法唯一识别目录工作表")


def is_yellow(cell) -> bool:
    color = cell.fill.fgColor
    return (
        cell.fill.fill_type == "solid"
        and color.type == "rgb"
        and str(color.rgb).upper().endswith(YELLOW_RGB)
    )


def read_data_js(path: Path) -> dict:
    source = path.read_text(encoding="utf-8").strip()
    prefix = "window.DATA_MAP = "
    if not source.startswith(prefix) or not source.endswith(";"):
        raise ValueError(f"{path} 不是有效的 window.DATA_MAP 文件")
    return json.loads(source[len(prefix):-1])


def write_data_js(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        "window.DATA_MAP = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("data_js", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    workbook = load_workbook(args.workbook, read_only=False, data_only=True)
    sheet = select_sheet(workbook)
    headers = [normalize(cell.value) for cell in sheet[1]]
    english_column = headers.index("英文表名") + 1

    payload = read_data_js(args.data_js)
    tables_by_row = {int(table["sourceRow"]): table for table in payload.get("tables", [])}
    changes = []
    ignored_yellow = []

    for row_number in range(2, sheet.max_row + 1):
        for cell in sheet[row_number]:
            if is_yellow(cell) and cell.column != english_column:
                ignored_yellow.append({"cell": cell.coordinate, "value": normalize(cell.value)})
        cell = sheet.cell(row_number, english_column)
        if not is_yellow(cell):
            continue
        table = tables_by_row.get(row_number)
        if table is None:
            raise ValueError(f"黄色表名单元格 {cell.coordinate} 无法匹配 sourceRow={row_number}")
        before = normalize(table.get("englishName"))
        after = normalize(cell.value)
        if not after:
            raise ValueError(f"黄色表名单元格 {cell.coordinate} 不能为空")
        if before == after:
            continue
        table["englishName"] = after
        changes.append({
            "cell": cell.coordinate,
            "sourceRow": row_number,
            "name": table.get("name", ""),
            "before": before,
            "after": after,
        })

    meta = payload.setdefault("meta", {})
    meta["source"] = args.workbook.name
    meta["sourceDate"] = datetime.fromtimestamp(args.workbook.stat().st_mtime).date().isoformat()
    write_data_js(args.data_js, payload)
    workbook.close()

    report = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "workbook": str(args.workbook.resolve()),
        "sheet": sheet.title,
        "yellowTableCells": len(changes),
        "changes": changes,
        "ignoredYellowCells": ignored_yellow,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已更新 {len(changes)} 个黄色英文表名单元格；忽略 {len(ignored_yellow)} 个其他黄色单元格")


if __name__ == "__main__":
    main()
