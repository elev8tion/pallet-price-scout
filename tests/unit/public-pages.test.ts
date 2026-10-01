import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { PUBLIC_FILE_ROUTES, resolvePublicPage } from "../../src/server/public-pages.js";

const cwd = process.cwd();

test("scan is the entry page and routing is a sibling workspace", () => {
  assert.equal(resolvePublicPage("/")?.kind, "file");
  assert.deepEqual(resolvePublicPage("/"), { kind: "file", file: "web/index.html", type: "text/html" });
  assert.deepEqual(resolvePublicPage("/routing"), { kind: "redirect", location: "/routing/" });
  assert.deepEqual(resolvePublicPage("/routing/"), { kind: "file", file: "web/routing/index.html", type: "text/html" });
});

test("every public file exists and routing assets stay under /routing/", () => {
  for (const [url, entry] of Object.entries(PUBLIC_FILE_ROUTES)) {
    assert.ok(existsSync(join(cwd, entry.file)), `${entry.file} missing for ${url}`);
    if (url.startsWith("/routing/") && url !== "/routing/") {
      assert.ok(entry.file.startsWith("web/routing/"), `${url} must resolve inside web/routing/`);
    }
  }
});

test("unknown and traversal paths do not resolve", () => {
  for (const pathname of ["/routing/../index.html", "/routing/assets/../../app.js", "/etc/passwd", "/api/runtime", "/routing/missing.js"]) {
    assert.equal(resolvePublicPage(pathname), null, pathname);
  }
});

test("Fastify serves scan and routing from one origin without Pi", async () => {
  const app = Fastify({ logger: false });
  for (const pathname of Object.keys(PUBLIC_FILE_ROUTES)) {
    app.get(pathname, async (_request, reply) => {
      const page = resolvePublicPage(pathname);
      if (!page || page.kind !== "file") return reply.code(404).send("Not found");
      return reply.type(page.type).send(readFileSync(join(cwd, page.file)));
    });
  }
  app.get("/routing", async (_request, reply) => reply.redirect("/routing/"));
  const scan = await app.inject({ method: "GET", url: "/" });
  const routing = await app.inject({ method: "GET", url: "/routing/" });
  const bounce = await app.inject({ method: "GET", url: "/routing" });
  const css = await app.inject({ method: "GET", url: "/routing/styles.css" });
  const missing = await app.inject({ method: "GET", url: "/routing/secret.js" });
  assert.equal(scan.statusCode, 200);
  assert.match(scan.headers["content-type"] ?? "", /text\/html/);
  assert.match(scan.body, /PALLET PRICE SCOUT/);
  assert.equal(routing.statusCode, 200);
  assert.match(routing.body, /INVENTORY ROUTING/);
  assert.match(routing.body, /src="app.js"/);
  assert.equal(bounce.statusCode, 302);
  assert.equal(bounce.headers.location, "/routing/");
  assert.equal(css.statusCode, 200);
  assert.match(css.body, /assets\/space-grotesk\.woff2/);
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("scan and routing pages cross-link without colliding on /app.js", () => {
  const scan = readFileSync(join(cwd, "web/index.html"), "utf8");
  const routing = readFileSync(join(cwd, "web/routing/index.html"), "utf8");
  assert.match(scan, /href="\/routing\/"/);
  assert.match(scan, /aria-current="page">Scan</);
  assert.match(scan, /href="\/routing\/">Route this inventory/);
  assert.match(routing, /href="\/"/);
  assert.match(routing, /aria-current="page">Routing</);
  assert.match(routing, /href="styles.css"/);
  assert.match(routing, /src="app.js"/);
  assert.doesNotMatch(routing, /href="\/styles\.css"/);
  assert.doesNotMatch(routing, /src="\/app\.js"/);
  const scanApp = readFileSync(join(cwd, "web/app.js"), "utf8");
  const routingApp = readFileSync(join(cwd, "web/routing/app.js"), "utf8");
  assert.notEqual(scanApp, routingApp, "scan and routing must keep separate app.js files");
});
