import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

async function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

await loadDotEnv();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const upstreamUrl = process.env.MALLET_UPSTREAM_URL || "https://api.walletwallet.dev/api/pkpass";
const apiKey = process.env.MALLET_API_KEY || "";

const mimeByExt = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error("Request payload is too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function isSafePath(resolvedPath) {
  return resolvedPath.startsWith(publicDir + path.sep) || resolvedPath === publicDir;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));

  if (!isSafePath(filePath)) {
    json(res, 403, { error: "Forbidden." });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      json(res, 404, { error: "Not found." });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeByExt[ext] || "application/octet-stream",
      "Content-Length": body.length
    });
    res.end(body);
  } catch {
    json(res, 404, { error: "Not found." });
  }
}

function validatePayload(payload) {
  const required = ["barcodeValue", "barcodeFormat", "title"];
  const missing = required.filter((field) => !payload[field] || String(payload[field]).trim() === "");
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  const body = {
    barcodeValue: String(payload.barcodeValue).trim(),
    barcodeFormat: String(payload.barcodeFormat).trim(),
    title: String(payload.title).trim()
  };

  if (payload.label) {
    body.label = String(payload.label).trim();
  }
  if (payload.value) {
    body.value = String(payload.value).trim();
  }
  if (payload.colorPreset) {
    body.colorPreset = String(payload.colorPreset).trim();
  }

  const expirationDays = Number(payload.expirationDays);
  if (Number.isFinite(expirationDays) && expirationDays > 0) {
    body.expirationDays = expirationDays;
  }

  return body;
}

async function proxyPkpass(req, res) {
  if (!apiKey) {
    json(res, 500, {
      error: "MALLET_API_KEY is not configured on the server.",
      hint: "Set MALLET_API_KEY before generating passes."
    });
    return;
  }

  let payload;
  try {
    payload = validatePayload(await readBody(req));
  } catch (error) {
    json(res, 400, { error: error.message || "Invalid request." });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    json(res, 502, {
      error: "Cannot reach the upstream pass API.",
      hint: "Check MALLET_UPSTREAM_URL and your network settings."
    });
    return;
  }

  if (!upstream.ok) {
    const contentType = upstream.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await upstream.json();
      json(res, upstream.status, body);
      return;
    }

    const text = await upstream.text();
    json(res, upstream.status, {
      error: text || `Upstream request failed with status ${upstream.status}.`
    });
    return;
  }

  const passBuffer = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": "application/vnd.apple.pkpass",
    "Content-Disposition": "attachment; filename=mallet-pass.pkpass",
    "Content-Length": passBuffer.length
  });
  res.end(passBuffer);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/pkpass") {
    await proxyPkpass(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }

  json(res, 405, { error: "Method not allowed." });
});

server.listen(port, host, () => {
  console.log(`Mallet running at http://${host}:${port}`);
});
