#!/usr/bin/env node
// Servidor estático mínimo, sem dependências, para ver e testar o site na
// sua máquina. Imita o GitHub Pages: o conteúdo de site/ fica sob o
// subcaminho /presentes-casamento/ (igual à produção), então URLs absolutas
// quebradas aparecem aqui e não só depois de publicar.
//
//   node scripts/servir.mjs [--port 4173]      (ou PORT=4173)
//
// Abra: http://127.0.0.1:4173/presentes-casamento/

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const PREFIX = "/presentes-casamento/";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ics": "text/calendar; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const BASE_HEADERS = { "Cache-Control": "no-cache" };

// ---------- Linha de comando ----------
function parsePort(argv, env) {
  let raw = env.PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") raw = argv[++i];
    else if (arg.startsWith("--port=")) raw = arg.slice("--port=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("Uso: node scripts/servir.mjs [--port 4173]   (ou PORT=4173)");
      process.exit(0);
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Porta inválida: "${raw}" (use um número de 0 a 65535).`);
  }
  return port;
}

// ---------- Respostas ----------
function send(res, status, body, headers = {}, method = "GET") {
  const data = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": data.length,
    ...BASE_HEADERS,
    ...headers,
  });
  res.end(method === "HEAD" ? undefined : data);
}

function redirect(res, status, location, method) {
  send(res, status, `Redirecionando para ${location}\n`, { Location: location }, method);
}

function sendFile(res, file, info, method, status = 200) {
  res.writeHead(status, {
    "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": info.size,
    ...BASE_HEADERS,
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  pipeline(createReadStream(file), res, (error) => {
    if (error) res.destroy();
  });
}

async function sendNotFound(res, method) {
  const page = path.join(ROOT_DIR, "404.html");
  const info = await stat(page).catch(() => null);
  if (info && info.isFile()) return sendFile(res, page, info, method, 404);
  return send(res, 404, "404 — não encontrado\n", {}, method);
}

// ---------- Busca do arquivo ----------
// Procura cada trecho do caminho listando a pasta, para que maiúsculas e
// minúsculas contem (como no GitHub Pages, que roda em Linux). Assim
// "Foto.JPG" não funciona aqui e quebra só depois de publicar.
async function findEntry(segments) {
  let current = ROOT_DIR;
  for (const segment of segments) {
    const wanted = segment.normalize("NFC");
    const entries = await readdir(current).catch(() => []);
    const match = entries.find((name) => name.normalize("NFC") === wanted);
    if (!match) return null;
    current = path.join(current, match);
  }
  const info = await stat(current).catch(() => null);
  if (!info) return null;
  // Links simbólicos que apontam para fora de site/ não são servidos.
  const [real, realRoot] = await Promise.all([realpath(current), realpath(ROOT_DIR)]);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  return { file: current, info };
}

async function handle(req, res) {
  const method = req.method;
  if (method !== "GET" && method !== "HEAD") {
    return send(res, 405, "Método não permitido\n", { Allow: "GET, HEAD" }, method);
  }
  if (typeof req.url !== "string" || !req.url.startsWith("/")) {
    return send(res, 400, "Requisição inválida\n", {}, method);
  }

  // Não usamos new URL() de propósito: "//host/x" seria lido como outro host.
  const cut = req.url.search(/[?#]/);
  const rawPath = cut < 0 ? req.url : req.url.slice(0, cut);
  const query = cut < 0 || req.url[cut] === "#" ? "" : req.url.slice(cut).split("#")[0];

  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return send(res, 400, "Endereço inválido\n", {}, method);
  }
  if (pathname.includes("\0") || pathname.includes("\\")) {
    return send(res, 400, "Endereço inválido\n", {}, method);
  }

  if (pathname === "/" || pathname === PREFIX.slice(0, -1)) {
    return redirect(res, 302, PREFIX + query, method);
  }
  if (!pathname.startsWith(PREFIX)) return sendNotFound(res, method);

  const segments = pathname.slice(PREFIX.length).split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) {
    return send(res, 403, "Acesso negado\n", {}, method);
  }
  // O GitHub Pages não publica arquivos e pastas ocultos (.git, .env...).
  if (segments.some((s) => s.startsWith("."))) return sendNotFound(res, method);

  const found = await findEntry(segments);
  if (!found) return sendNotFound(res, method);

  const hasSlash = pathname.endsWith("/");
  if (found.info.isDirectory()) {
    const index = await findEntry([...segments, "index.html"]);
    if (!index || !index.info.isFile()) return sendNotFound(res, method);
    if (!hasSlash) return redirect(res, 301, rawPath + "/" + query, method);
    return sendFile(res, index.file, index.info, method);
  }
  if (!found.info.isFile() || hasSlash) return sendNotFound(res, method);
  return sendFile(res, found.file, found.info, method);
}

// ---------- Início ----------
let port;
try {
  port = parsePort(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, "Erro interno\n", {}, req.method);
    else res.destroy();
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`A porta ${port} já está em uso. Escolha outra: node scripts/servir.mjs --port 4174`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, HOST, () => {
  const { port: actual } = server.address();
  console.log(`Servindo site/ em http://${HOST}:${actual}${PREFIX}  (Ctrl+C para parar)`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
