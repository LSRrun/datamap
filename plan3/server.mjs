import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const configuredPort = process.env.PORT ? Number(process.env.PORT) : null;
const startingPort = configuredPort || 4173;
let activePort = startingPort;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(root, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !configuredPort && activePort < startingPort + 20) {
    const occupiedPort = activePort;
    activePort += 1;
    console.warn(`端口 ${occupiedPort} 已被占用，正在尝试 ${activePort}…`);
    server.listen(activePort, "127.0.0.1");
    return;
  }

  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${activePort} 已被占用，请指定其他端口，例如：PORT=5000 npm run dev`);
    process.exitCode = 1;
    return;
  }

  throw error;
});

server.listen(activePort, "127.0.0.1", () => {
  console.log(`数据地图 Demo 已启动：http://127.0.0.1:${activePort}`);
});
