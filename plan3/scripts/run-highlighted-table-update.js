"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const updater = path.join(__dirname, "apply_highlighted_table_names.py");

function pythonExecutable() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venvPython = path.join(projectRoot, ".venv", "bin", "python3");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

const result = spawnSync(pythonExecutable(), [updater, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(`无法启动 Excel 更新脚本：${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
