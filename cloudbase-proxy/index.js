const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PASSWORD_HASH = process.env.PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
if (!PASSWORD_HASH || !SESSION_SECRET) {
  throw new Error("Configure PASSWORD_HASH and SESSION_SECRET in CloudBase environment variables");
}
const SESSION_SECONDS = 12 * 60 * 60;
const SESSION_COOKIE = "asset_allocation_session";
const PUBLIC_ROOT = path.join(__dirname, "public");
const DATA_PATH = path.join(__dirname, "latest-payload.json");
const ADVISORY_PATH = path.join(__dirname, "advisory.json");

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8", "no-store"],
  "/index.html": ["index.html", "text/html; charset=utf-8", "no-store"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8", "public, max-age=300"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8", "public, max-age=300"],
};

function json(statusCode, value, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      ...headers,
    },
    body: JSON.stringify(value),
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function sessionToken() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${expires}.${sign(String(expires))}`;
}

function isAuthorized(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || "";
  const token = parseCookies(cookieHeader)[SESSION_COOKIE] || "";
  const [expiresRaw, signature] = token.split(".");
  const expires = Number(expiresRaw);
  if (!expiresRaw || !signature || !Number.isFinite(expires)) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(signature, sign(expiresRaw));
}

function requestPath(event) {
  const raw = event.path || event.rawPath || "/";
  try {
    return new URL(raw, "https://local.invalid").pathname;
  } catch {
    return "/";
  }
}

function requestMethod(event) {
  return String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
}

function requestJson(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
  return JSON.parse(raw);
}

function serveStatic(route, method) {
  const [fileName, contentType, cacheControl] = staticFiles[route];
  const body = fs.readFileSync(path.join(PUBLIC_ROOT, fileName), "utf8");
  return {
    statusCode: 200,
    headers: {
      "content-type": contentType,
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
    body: method === "HEAD" ? "" : body,
  };
}

function dataHealth() {
  const bytes = fs.readFileSync(DATA_PATH);
  const advisoryBytes = fs.readFileSync(ADVISORY_PATH);
  const payload = JSON.parse(bytes.toString("utf8"));
  return {
    asOf: payload.asOf,
    dataRevision: crypto.createHash("sha256").update(bytes).digest("hex"),
    advisoryRevision: crypto.createHash("sha256").update(advisoryBytes).digest("hex"),
  };
}

exports.main = async function main(event) {
  const route = requestPath(event);
  const method = requestMethod(event);

  if (route === "/api/health") {
    try {
      return json(200, { ok: true, service: "asset-allocation-cn", ...dataHealth() });
    } catch (error) {
      console.error("Unable to read dataset health", error);
      return json(503, { ok: false, service: "asset-allocation-cn" });
    }
  }

  if (route === "/api/auth/login" && method === "POST") {
    let password = "";
    try {
      password = String(requestJson(event).password || "");
    } catch {
      return json(400, { error: "请求格式不正确。" });
    }
    if (!constantTimeEqual(sha256(password), PASSWORD_HASH)) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return json(401, { error: "密码不正确，请重试。" });
    }
    return json(200, { ok: true }, {
      "set-cookie": `${SESSION_COOKIE}=${sessionToken()}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  if (route === "/api/auth/logout" && method === "POST") {
    return json(200, { ok: true }, {
      "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  if (route === "/api/data" && method === "GET") {
    if (!isAuthorized(event)) return json(401, { error: "unauthorized" });
    try {
      const payload = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
      const advisory = JSON.parse(fs.readFileSync(ADVISORY_PATH, "utf8"));
      return json(200, { payload, advisory });
    } catch (error) {
      console.error("Unable to read dataset", error);
      return json(503, { error: "data_unavailable" });
    }
  }

  if (Object.prototype.hasOwnProperty.call(staticFiles, route) && (method === "GET" || method === "HEAD")) {
    return serveStatic(route, method);
  }

  return json(404, { error: "not_found" });
};
