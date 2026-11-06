/**
 * Lists the repository branches and runs each one in its own container.
 * GET /branch/NAME/ builds the latest commit when needed, then proxies HTTP
 * and WebSocket traffic to the container that runs it.
 */
import { execFile, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const PORT = Number(process.env.PORT ?? 8091);
const HOST = process.env.HOST ?? "127.0.0.1";
const REPO = "https://github.com/joaquimandrade/amxxveterans.git";
const ROOT = join(homedir(), ".local/share/amxx-previews");
const MIRROR = join(ROOT, "mirror.git");
const BUILDS = join(ROOT, "builds");
const IMAGE = "node:26-slim";
const NETWORK = "amxx-previews";
const APP_PORT = 8091;
const FETCH_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

const exec = promisify(execFile);

type Branch = { name: string; sha: string; date: string; author: string; subject: string };
type Preview = { sha?: string; ip?: string; building?: Promise<void>; buildingSha?: string; error?: string };

const previews = new Map<string, Preview>();
let lastFetch = 0;
let buildQueue: Promise<unknown> = Promise.resolve();

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function git(...args: string[]) {
  const { stdout } = await exec("git", ["--git-dir", MIRROR, ...args]);

  return stdout;
}

async function fetchRepo(force = false) {
  if (!force && Date.now() - lastFetch < FETCH_INTERVAL_MS) return;
  lastFetch = Date.now();
  await git("fetch", "--prune", "origin", "+refs/heads/*:refs/heads/*");
}

async function listBranches(): Promise<Branch[]> {
  const format = "%(refname:short)%09%(objectname)%09%(committerdate:relative)%09%(authorname)%09%(subject)";
  const output = await git("for-each-ref", "--sort=-committerdate", `--format=${format}`, "refs/heads");

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha, date, author, ...subject] = line.split("\t");

      return { name, sha, date, author, subject: subject.join("\t") };
    })
    .filter((branch) => SAFE_BRANCH.test(branch.name));
}

const containerName = (branch: string) => `amxx-${branch.replace(/[^A-Za-z0-9_.-]/g, "-")}`;

async function containerIp(name: string) {
  const { stdout } = await exec("docker", [
    "inspect", "-f", `{{(index .NetworkSettings.Networks "${NETWORK}").IPAddress}}`, name,
  ]);

  return stdout.trim();
}

async function waitForServer(ip: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await new Promise<boolean>((resolve) => {
      const request = http.get({ host: ip, port: APP_PORT, path: "/", timeout: 1000 }, (response) => {
        response.resume();
        resolve(true);
      });

      request.on("error", () => resolve(false));
      request.on("timeout", () => (request.destroy(), resolve(false)));
    });

    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("server did not start");
}

async function exportCommit(sha: string, dir: string) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const archive = spawn("git", ["--git-dir", MIRROR, "archive", sha]);
    const tar = spawn("tar", ["-x", "-C", dir]);

    archive.stdout.pipe(tar.stdin);
    tar.on("error", reject);
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
  });
}

const sandbox = ["--user", `${process.getuid!()}:${process.getgid!()}`, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256"];

async function deploy(branch: string, sha: string) {
  const dir = join(BUILDS, `${branch}-${sha.slice(0, 12)}`);
  const name = containerName(branch);

  await exportCommit(sha, dir);
  await exec("docker", [
    "run", "--rm", ...sandbox, "--memory", "1500m", "--cpus", "4",
    "-e", "HOME=/tmp", "-e", `VITE_BASE=/branch/${branch}/`,
    "-v", `${dir}:/app`, "-w", "/app", IMAGE,
    "sh", "-c", "npm ci --no-audit --no-fund && npm run build",
  ], { maxBuffer: 1 << 24 });

  await exec("docker", ["rm", "-f", name]).catch(() => {});
  await exec("docker", [
    "run", "-d", "--name", name, "--network", NETWORK, ...sandbox,
    "--memory", "512m", "--cpus", "1", "--read-only", "--tmpfs", "/tmp",
    "--label", `amxx.sha=${sha}`, "--label", `amxx.branch=${branch}`,
    "-e", "HOME=/tmp", "-e", "HOST=0.0.0.0", "-e", `PORT=${APP_PORT}`,
    "-v", `${dir}:/app:ro`, "-w", "/app", IMAGE, "npm", "run", "start",
  ]);

  const ip = await containerIp(name);

  await waitForServer(ip);
  const preview = previews.get(branch)!;
  const previous = preview.sha;

  preview.sha = sha;
  preview.ip = ip;
  preview.error = undefined;
  if (previous && previous !== sha) {
    await rm(join(BUILDS, `${branch}-${previous.slice(0, 12)}`), { recursive: true, force: true });
  }
}

function ensure(branch: string, sha: string) {
  const preview = previews.get(branch) ?? {};

  previews.set(branch, preview);
  if (preview.sha === sha || preview.buildingSha === sha) return preview;
  if (preview.building) return preview;

  preview.buildingSha = sha;
  preview.error = undefined;
  const job = buildQueue.then(() => deploy(branch, sha));

  buildQueue = job.catch(() => {});
  preview.building = job
    .catch((error: { stderr?: string; message: string }) => {
      preview.error = (error.stderr || error.message).split("\n").slice(-12).join("\n");
    })
    .finally(() => {
      preview.building = undefined;
      preview.buildingSha = undefined;
    });
  return preview;
}

async function restore() {
  const { stdout } = await exec("docker", [
    "ps", "--filter", "label=amxx.branch", "--format", '{{.Names}}\t{{.Label "amxx.branch"}}\t{{.Label "amxx.sha"}}',
  ]);

  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, branch, sha] = line.split("\t");

    previews.set(branch, { sha, ip: await containerIp(name) });
  }
}

const page = (title: string, body: string, refresh = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="2">' : ""}<title>${title}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; background: #1a1412; color: #f3e6d0; font: 16px/1.5 ui-monospace, Menlo, Consolas, monospace; }
main { max-width: 760px; margin: 0 auto; padding: 48px 16px; }
h1 { margin: 0 0 24px; color: #ffb347; font-size: 28px; }
a.branch { display: block; padding: 14px 16px; margin-bottom: 10px; border: 1px solid #5a4230; border-radius: 6px; color: inherit; text-decoration: none; }
a.branch:hover, a.branch:focus { border-color: #ffb347; background: #2a1f19; }
a.branch b { color: #ffb347; font-size: 18px; }
small { display: block; color: #b9a58c; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; color: #ff9c8a; }
</style></head><body><main>${body}</main></body></html>`;

function send(response: http.ServerResponse, status: number, html: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
}

async function home(response: http.ServerResponse) {
  await fetchRepo().catch(() => {});
  const items = (await listBranches()).map((branch) => {
    const state = previews.get(branch.name)?.sha === branch.sha ? "running" : "starts on open";

    return `<a class="branch" href="/branch/${branch.name}/"><b>${branch.name}</b>
<small>${escapeHtml(branch.subject)}</small>
<small>${branch.sha.slice(0, 7)} · ${escapeHtml(branch.author)} · ${escapeHtml(branch.date)} · ${state}</small></a>`;
  });

  send(response, 200, page("AMXX Veterans", `<h1>AMXX Veterans</h1>${items.join("")}`));
}

function forward(request: http.IncomingMessage, response: http.ServerResponse, ip: string, path: string) {
  const upstream = http.request(
    { host: ip, port: APP_PORT, path, method: request.method, headers: request.headers },
    (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) send(response, 502, page("Unavailable", "<h1>Branch is not responding</h1>", true));
    else response.destroy();
  });
  request.pipe(upstream);
}

function parseRoute(url: string) {
  const match = /^\/branch\/([^/?#]+)(\/[^#]*|\?[^#]*)?$/.exec(url);

  if (!match) return null;
  const path = match[2] ?? "";

  return { branch: decodeURIComponent(match[1]), path, needsSlash: !path.startsWith("/") };
}

async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
  const url = request.url ?? "/";

  if (url === "/") return home(response);

  const route = parseRoute(url);

  if (!route || !SAFE_BRANCH.test(route.branch)) return send(response, 404, page("Not found", "<h1>Not found</h1>"));
  if (route.needsSlash) {
    response.writeHead(302, { location: `/branch/${route.branch}/${route.path}` });
    return response.end();
  }

  const isPageLoad = route.path === "/";

  if (isPageLoad) await fetchRepo().catch(() => {});

  const branch = (await listBranches()).find((item) => item.name === route.branch);

  if (!branch) return send(response, 404, page("Not found", "<h1>No such branch</h1>"));

  const preview = isPageLoad ? ensure(branch.name, branch.sha) : previews.get(branch.name);

  if (isPageLoad && preview?.sha !== branch.sha) {
    if (preview?.error) {
      return send(response, 500, page("Build failed",
        `<h1>${branch.name} failed to build</h1><p>Push a fix and reload.</p><pre>${escapeHtml(preview.error)}</pre>`));
    }
    return send(response, 503, page("Building",
      `<h1>Building ${branch.name}</h1><small>${branch.sha.slice(0, 7)} · ${escapeHtml(branch.subject)}</small>`, true));
  }
  if (!preview?.ip) return send(response, 503, page("Building", "<h1>Starting</h1>", true));
  forward(request, response, preview.ip, route.path);
}

function handleUpgrade(request: http.IncomingMessage, socket: net.Socket, head: Buffer) {
  const route = parseRoute(request.url ?? "");
  const ip = route && previews.get(route.branch)?.ip;

  if (!route || !ip) return socket.destroy();

  const upstream = net.connect(APP_PORT, ip, () => {
    const headers = Object.entries(request.headers)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\r\n");

    upstream.write(`GET ${route.path} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

await mkdir(BUILDS, { recursive: true });
await exec("git", ["clone", "--quiet", "--mirror", REPO, MIRROR]).catch(() => {});
await fetchRepo(true);
await restore();

setInterval(async () => {
  await fetchRepo(true).catch(() => {});
  for (const branch of await listBranches()) {
    if (previews.get(branch.name)?.sha) ensure(branch.name, branch.sha);
  }
}, POLL_INTERVAL_MS);

const server = http.createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) send(response, 500, page("Error", "<h1>Something went wrong</h1>"));
  });
});

server.on("upgrade", handleUpgrade);
server.listen(PORT, HOST, () => console.log(`hub on http://${HOST}:${PORT}`));
