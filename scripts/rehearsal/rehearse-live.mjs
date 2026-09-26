import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const root = process.cwd();
const artifactDir = `${root}/.rehearsal`;
const config = await import("../../src/lib/rehearsal/config.ts").then(({ parseLiveRehearsalConfig }) => parseLiveRehearsalConfig());
const reference = config.REHEARSAL_REFERENCE_VIDEO;
const { probeReferenceMedia } = await import("../../src/lib/rehearsal/preflight.ts");
const { durationSeconds, byteSize, sha256: fingerprint } = await probeReferenceMedia(reference);

await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/preflight.json`, JSON.stringify({ timestamp: new Date().toISOString(), mode: "live", referenceFingerprint: fingerprint, durationSeconds, byteSize }, null, 2));

const testCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(testCommand, ["exec", "playwright", "test", "tests/rehearsal/live.spec.ts", "--config=playwright.rehearsal.config.ts"], { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, REHEARSAL_REFERENCE_FINGERPRINT: fingerprint, REHEARSAL_REFERENCE_DURATION: String(durationSeconds) } });
const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
if (exitCode !== 0) process.exit(exitCode);

const verify = spawn(testCommand, ["exec", "node", "scripts/rehearsal/verify-runs.mjs"], { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, REHEARSAL_REFERENCE_FINGERPRINT: fingerprint } });
const verifyCode = await new Promise((resolve) => verify.on("exit", (code) => resolve(code ?? 1)));
process.exit(verifyCode);
