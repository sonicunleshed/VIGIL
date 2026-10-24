#!/usr/bin/env node
// Installs the VIGIL Vision assets into public/ so the camera feature runs fully offline:
//  - MediaPipe Tasks WASM runtime, copied from the pinned npm package
//  - Pose Landmarker (lite) model, downloaded once from Google's model bucket and verified
//    against a pinned SHA-256
// Both destinations are gitignored. Network failure is a warning (the rest of the app still
// builds); pass --strict to make it fatal.
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const MODEL = {
  url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  dest: join(root, "public/models/pose_landmarker_lite.task"),
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const exists = (p) => stat(p).then(() => true, () => false);

async function installWasm() {
  // The package's "exports" map hides package.json, so read it from node_modules directly.
  const pkgJson = join(root, "node_modules/@mediapipe/tasks-vision/package.json");
  const { version } = JSON.parse(await readFile(pkgJson, "utf8"));
  const dest = join(root, "public/mediapipe/wasm");
  const stamp = join(dest, ".version");
  if ((await exists(stamp)) && (await readFile(stamp, "utf8")).trim() === version) return;
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(join(dirname(pkgJson), "wasm"), dest, { recursive: true });
  await writeFile(stamp, version);
  console.log(`[vision] copied MediaPipe WASM ${version}`);
}

async function installModel() {
  if (await exists(MODEL.dest)) {
    if (sha256(await readFile(MODEL.dest)) === MODEL.sha256) return;
    console.warn("[vision] model checksum mismatch, re-downloading");
  }
  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== MODEL.sha256) throw new Error(`model checksum mismatch: expected ${MODEL.sha256}, got ${got}`);
  await mkdir(dirname(MODEL.dest), { recursive: true });
  await writeFile(`${MODEL.dest}.tmp`, buf);
  await rename(`${MODEL.dest}.tmp`, MODEL.dest);
  console.log(`[vision] installed pose model (${(buf.length / 1e6).toFixed(1)} MB, sha256 verified)`);
}

try {
  await installWasm();
  await installModel();
} catch (err) {
  console.warn(`[vision] ${err instanceof Error ? err.message : err}`);
  console.warn("[vision] The Vision page will show 'model not installed' until `pnpm vision:setup` succeeds.");
  if (strict) process.exit(1);
}
