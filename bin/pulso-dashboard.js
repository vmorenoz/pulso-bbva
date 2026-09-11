#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const dashboard = require("../lib/pulso-dashboard-core.js");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const directory = path.resolve(option("--project", process.cwd()));
const requestedPort = Number(option("--port", "4177"));
const timeoutMinutes = Number(option("--timeout", "30"));
const token = option("--token", crypto.randomBytes(24).toString("hex"));
const shouldOpen = process.argv.includes("--open");
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error("--port must be between 0 and 65535.");
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 240) throw new Error("--timeout must be between 1 and 240 minutes.");
if (!/^[a-f0-9]{32,128}$/i.test(token)) throw new Error("--token must be a hexadecimal value of at least 32 characters.");

let idleTimer;
function refreshIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => server.close(() => process.exit(0)), timeoutMinutes * 60000);
  idleTimer.unref();
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function authorized(url) {
  return url.searchParams.get("token") === token;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const headers = {
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (!authorized(url)) {
    response.writeHead(403, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  refreshIdleTimer();
  if (request.method === "GET" && url.pathname === "/") {
    const nonce = crypto.randomBytes(18).toString("base64");
    response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` });
    response.end(dashboard.renderDashboard(token, nonce));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/data") {
    try {
      response.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(dashboard.loadDashboardData(directory)));
    } catch (error) {
      response.writeHead(500, { ...headers, "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/stop") {
    response.writeHead(202, { ...headers, "Content-Type": "application/json; charset=utf-8" });
    response.end('{"status":"stopping"}');
    setImmediate(() => server.close(() => process.exit(0)));
    return;
  }
  response.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.on("error", (error) => {
  process.stderr.write(`Pulso dashboard failed: ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/?token=${token}`;
  refreshIdleTimer();
  process.stdout.write(`PULSO_DASHBOARD_URL=${url}\n`);
  if (shouldOpen) openBrowser(url);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
