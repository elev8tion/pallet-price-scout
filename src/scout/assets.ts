import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Database } from "../db/database.js";

const MAX_BYTES = 30 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function safeName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload";
}

export function createAsset(db: Database, dataDir: string, input: { name: string; mimeType: string; bytes: Buffer }): any {
  if (!ALLOWED[input.mimeType]) throw new Error("UPLOAD_INVALID: only JPEG, PNG, GIF, WebP, HEIC, and HEIF images are supported");
  if (input.bytes.length === 0) throw new Error("UPLOAD_INVALID: image is empty");
  if (input.bytes.length > MAX_BYTES) throw new Error("UPLOAD_TOO_LARGE: image exceeds 30 MiB");
  const id = randomUUID();
  const dir = join(dataDir, "assets", id);
  mkdirSync(dir, { recursive: true });
  const originalName = safeName(input.name);
  const originalPath = join(dir, `original${ALLOWED[input.mimeType]}`);
  const normalizedPath = join(dir, "normalized.jpg");
  const previewPath = join(dir, "preview.jpg");
  writeFileSync(originalPath, input.bytes, { flag: "wx" });
  let sourcePath = originalPath;
  let convertedPath: string | undefined;
  try {
    if (input.mimeType === "image/heic" || input.mimeType === "image/heif") {
      convertedPath = join(dir, "heic-converted.jpg");
      execFileSync("sips", ["-s", "format", "jpeg", originalPath, "--out", convertedPath], { stdio: "ignore", timeout: 30000 });
      sourcePath = convertedPath;
    }
    const output = execFileSync("python3", [join(process.cwd(), "scripts", "normalize_image.py"), sourcePath, normalizedPath, previewPath], { encoding: "utf8", timeout: 60000 });
    const metadata = JSON.parse(output.trim()) as { width: number; height: number; source_width: number; source_height: number };
    const asset = {
      id,
      originalName,
      mimeType: input.mimeType,
      originalPath,
      normalizedPath,
      previewPath,
      sha256: createHash("sha256").update(readFileSync(normalizedPath)).digest("hex"),
      width: metadata.width,
      height: metadata.height,
      createdAt: new Date().toISOString(),
    };
    db.insertAsset(asset);
    return asset;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`NORMALIZATION_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (convertedPath) {
      try { unlinkSync(convertedPath); } catch { /* best effort */ }
    }
  }
}
