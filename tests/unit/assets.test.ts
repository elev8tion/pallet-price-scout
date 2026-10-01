import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Database } from "../../src/db/database.js";
import { createAsset } from "../../src/scout/assets.js";

test("failed image normalization removes the incomplete asset directory", () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-assets-"));
  const db = new Database(join(root, "scout.sqlite"));
  assert.throws(() => createAsset(db, root, { name: "broken.png", mimeType: "image/png", bytes: Buffer.from("not an image") }), /NORMALIZATION_FAILED/);
  const assetsDir = join(root, "assets");
  assert.equal(existsSync(assetsDir) ? readdirSync(assetsDir).length : 0, 0);
  db.close();
});
