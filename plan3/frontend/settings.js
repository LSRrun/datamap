(function () {
  "use strict";

  const LEGACY_STORAGE_KEY = "datamap.postgres.connection.v1";
  const form = document.getElementById("postgresForm");
  const testButton = document.getElementById("testConnection");
  const saveButton = document.getElementById("saveConnection");
  const message = document.getElementById("formMessage");
  const serviceState = document.getElementById("serviceState");
  const passwordInput = document.getElementById("password");
  const togglePassword = document.getElementById("togglePassword");
  let statusTimer = null;

  function field(name) { return document.getElementById(name); }

  function formValue(name) { return field(name).value.trim(); }

  function collectConfig() {
    return {
      connectionName: formValue("connectionName"),
      host: formValue("host"),
      port: Number(formValue("port")),
      database: formValue("database"),
      schema: formValue("schema") || "public",
      username: formValue("username"),
      password: passwordInput.value,
      sslMode: field("sslMode").value,
      timeout: Number(field("timeout").value),
    };
  }

  function validate() {
    const required = ["connectionName", "host", "port", "database", "username"];
    let valid = true;
    required.forEach((name) => {
      const input = field(name);
      const empty = !String(input.value).trim();
      const invalidPort = name === "port" && (Number(input.value) < 1 || Number(input.value) > 65535);
      input.setAttribute("aria-invalid", String(empty || invalidPort));
      if (empty || invalidPort) valid = false;
    });
    if (!valid) showMessage("error", "请完整填写主机地址、端口、数据库名和用户名等必填项。");
    return valid;
  }

  function showMessage(type, text) {
    message.hidden = false;
    message.className = `form-message is-${type}`;
    message.textContent = text;
  }

  function setServiceState(type, text) {
    serviceState.className = `service-state${type ? ` is-${type}` : ""}`;
    serviceState.querySelector("span").textContent = text;
  }

  function setBusy(busy, action) {
    testButton.disabled = busy;
    saveButton.disabled = busy;
    testButton.lastChild.textContent = busy && action === "test" ? " 正在测试…" : " 测试连接";
    saveButton.lastChild.textContent = busy && action === "save" ? " 正在保存并连接…" : " 保存并保持连接";
  }

  function formatTime(value) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
  }

  function updateSummary(config, connection) {
    if (!config) {
      document.getElementById("savedEmpty").hidden = false;
      document.getElementById("savedSummary").hidden = true;
      document.getElementById("savedStatus").className = "";
      document.getElementById("savedStatus").textContent = "尚未保存";
      return;
    }
    document.getElementById("savedEmpty").hidden = true;
    document.getElementById("savedSummary").hidden = false;
    const status = connection?.status || "disconnected";
    const statusLabels = {
      connected: "持续连接中",
      reconnecting: "自动重连中",
      disconnected: "连接已断开",
      not_configured: "配置已保存",
    };
    const savedStatus = document.getElementById("savedStatus");
    savedStatus.textContent = statusLabels[status] || "配置已保存";
    savedStatus.className = status === "connected" ? "is-saved" : status === "reconnecting" ? "is-warning" : "";
    document.getElementById("summaryName").textContent = config.connectionName || "—";
    document.getElementById("summaryAddress").textContent = `${config.host}:${config.port}`;
    document.getElementById("summaryDatabase").textContent = `${config.database} · ${config.username}`;
    document.getElementById("summarySchema").textContent = config.schema || "public";
    document.getElementById("summaryConnection").textContent = statusLabels[status] || "未知";
    document.getElementById("summaryTested").textContent = formatTime(connection?.lastCheckedAt);
  }

  function populateForm(config) {
    if (!config) return;
    ["connectionName", "host", "port", "database", "schema", "username", "sslMode", "timeout"].forEach((name) => {
      if (config[name] !== undefined && field(name)) field(name).value = config[name];
    });
    passwordInput.value = "";
    passwordInput.placeholder = config.hasPassword ? "已保存，留空继续使用原密码" : "数据库密码（如有）";
  }

  function applyStatus(result, populate) {
    const config = result?.config || null;
    const connection = result?.connection || { status: "not_configured" };
    if (populate) populateForm(config);
    updateSummary(config, connection);
    if (!config) {
      setServiceState("", "等待配置");
      return;
    }
    if (connection.status === "connected") {
      setServiceState("success", "PostgreSQL 持续连接中");
    } else if (connection.status === "reconnecting") {
      setServiceState("warning", "连接中断，正在自动重连");
    } else {
      setServiceState("error", "连接未建立");
    }
  }

  async function loadStatus(populate) {
    try {
      const response = await fetch("/api/postgres/status", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || "无法读取连接状态");
      applyStatus(result, populate);
    } catch (error) {
      setServiceState("error", "无法读取服务端连接状态");
      if (populate) showMessage("error", `读取配置失败：${error.message}`);
    }
  }

  async function testConnection() {
    if (!validate()) return;
    const config = collectConfig();
    setBusy(true, "test");
    showMessage("success", "正在尝试连接 PostgreSQL，请稍候…");
    setServiceState("", "正在测试连接");
    try {
      const response = await fetch("/api/postgres/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || "数据库拒绝了连接请求");
      const version = result.server?.version ? `，${result.server.version}` : "";
      showMessage("success", `连接成功：${result.server?.database || config.database}（用户 ${result.server?.user || config.username}）${version}`);
      setServiceState("success", "连接测试成功，保存后将持续连接");
    } catch (error) {
      showMessage("error", `连接失败：${error.message || "请检查连接参数和网络访问权限"}`);
      setServiceState("error", "连接测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveConnection(event) {
    event.preventDefault();
    if (!validate()) return;
    setBusy(true, "save");
    showMessage("success", "正在保存配置并建立持续连接…");
    setServiceState("", "正在保存并连接");
    try {
      const response = await fetch("/api/postgres/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectConfig()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || "配置保存失败");
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      applyStatus(result, true);
      showMessage("success", result.message || "配置已保存，PostgreSQL 正在持续连接。");
    } catch (error) {
      showMessage("error", `保存失败：${error.message || "请检查连接参数和数据库状态"}`);
      setServiceState("error", "配置未保存");
    } finally {
      setBusy(false);
    }
  }

  testButton.addEventListener("click", testConnection);
  form.addEventListener("submit", saveConnection);
  togglePassword.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    togglePassword.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
  });

  form.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => input.removeAttribute("aria-invalid")));
  loadStatus(true);
  statusTimer = window.setInterval(() => {
    if (!document.hidden) loadStatus(false);
  }, 15000);
  window.addEventListener("pagehide", () => window.clearInterval(statusTimer), { once: true });
})();
