import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedHostPatterns,
  cookieAttributes,
  hostAllowed,
  hostMatchesPattern,
  openModeEnabled,
} from "../../src/server/access.js";

test("open mode is opt-in", () => {
  assert.equal(openModeEnabled({}), false);
  assert.equal(openModeEnabled({ SCOUT_OPEN: "1" }), true);
});

test("open mode defaults to Cloudflare quick-tunnel hosts", () => {
  assert.deepEqual(allowedHostPatterns({ SCOUT_OPEN: "1" }), ["*.trycloudflare.com"]);
  assert.deepEqual(allowedHostPatterns({ SCOUT_OPEN: "1", SCOUT_HOSTS: "demo.example.com" }), ["demo.example.com"]);
});

test("loopback is always allowed; other hosts follow SCOUT_HOSTS", () => {
  assert.equal(hostAllowed("127.0.0.1:47831", {}), true);
  assert.equal(hostAllowed("localhost", {}), true);
  assert.equal(hostAllowed("evil.example", {}), false);
  assert.equal(hostAllowed("abc.trycloudflare.com", { SCOUT_OPEN: "1" }), true);
  assert.equal(hostAllowed("trycloudflare.com", { SCOUT_OPEN: "1" }), false);
  assert.equal(hostAllowed("nottrycloudflare.com", { SCOUT_OPEN: "1" }), false);
  assert.equal(hostAllowed("a.b.trycloudflare.com", { SCOUT_OPEN: "1" }), false);
});

test("wildcard matches a single extra label only", () => {
  assert.equal(hostMatchesPattern("foo.trycloudflare.com", "*.trycloudflare.com"), true);
  assert.equal(hostMatchesPattern("trycloudflare.com", "*.trycloudflare.com"), false);
});

test("HTTPS behind a tunnel sets Secure cookies", () => {
  assert.match(cookieAttributes({ headers: { "x-forwarded-proto": "https" } }), /Secure/);
  assert.match(cookieAttributes({ headers: { "x-forwarded-proto": "https" } }), /SameSite=Lax/);
  assert.doesNotMatch(cookieAttributes({ headers: {} }), /Secure/);
});
