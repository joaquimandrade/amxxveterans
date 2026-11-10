/** Serves the built client. French Rebellion runs entirely in the browser, so there is no game state here. */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 8091);
const host = process.env.HOST ?? "127.0.0.1";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp",
  ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

http.createServer(async (request, response) => {
  const path = decodeURIComponent((request.url ?? "/").split(/[?#]/)[0]);
  let file = join(root, normalize(path));

  if (!file.startsWith(root)) return response.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    await stat(file);
  } catch {
    return response.writeHead(404).end("not found");
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, host, () => console.log(`French Rebellion on http://${host}:${port}`));
