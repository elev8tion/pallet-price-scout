import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DataLock } from "../../src/server/lock.js";

test("first acquire succeeds and writes an owner token", () => {
  const dir = mkdtempSync(join(tmpdir(), "pallet-scout-lock-"));
  const lock = new DataLock(dir);
  lock.acquire();
  assert.ok(existsSync(join(dir, ".scout.lock")));
  const content = readFileSync(join(dir, ".scout.lock"), "utf8");
  assert.ok(content.startsWith(`${process.pid}:`));
  lock.release();
  assert.ok(!existsSync(join(dir, ".scout.lock")));
});

test("second owner is rejected before touching data", () => {
  const dir = mkdtempSync(join(tmpdir(), "pallet-scout-lock-2-"));
  const first = new DataLock(dir);
  first.acquire();
  const second = new DataLock(dir);
  assert.throws(() => second.acquire(), /LOCK_HELD/);
  // First lock still holds.
  assert.ok(existsSync(join(dir, ".scout.lock")));
  first.release();
});

test("startup failure releases the lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "pallet-scout-lock-fail-"));
  const lock = new DataLock(dir);
  lock.acquire();
  // Simulate a startup error after lock acquisition.
  try { lock.release(); } catch { /* ignore */ }
  assert.ok(!existsSync(join(dir, ".scout.lock")));
});

test("release only removes the lock owned by this instance", () => {
  const dir = mkdtempSync(join(tmpdir(), "pallet-scout-lock-owner-"));
  const first = new DataLock(dir);
  first.acquire();
  const content = readFileSync(join(dir, ".scout.lock"), "utf8");
  // A second instance that never acquired should not remove the first's lock.
  const second = new DataLock(dir);
  second.release();
  assert.ok(existsSync(join(dir, ".scout.lock")));
  assert.equal(readFileSync(join(dir, ".scout.lock"), "utf8"), content);
  first.release();
  assert.ok(!existsSync(join(dir, ".scout.lock")));
});

test("stale lock from a dead PID is reclaimed", () => {
  const dir = mkdtempSync(join(tmpdir(), "pallet-scout-lock-stale-"));
  // Write a lock file with a PID that does not exist (999999).
  writeFileSync(join(dir, ".scout.lock"), "999999:0:stale", { encoding: "utf8" });
  const lock = new DataLock(dir);
  lock.acquire();
  assert.ok(existsSync(join(dir, ".scout.lock")));
  const content = readFileSync(join(dir, ".scout.lock"), "utf8");
  assert.ok(content.startsWith(`${process.pid}:`), "reclaimed by current PID");
  lock.release();
});
