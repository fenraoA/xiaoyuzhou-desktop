// Firefox 清单与原生消息主机清单的回归测试
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("manifest targets Firefox (gecko id present, no Chrome-only keys)", () => {
  assert.ok(manifest.browser_specific_settings?.gecko?.id, "缺少 gecko id");
  assert.match(manifest.browser_specific_settings.gecko.id, /^[^\s@]+@[^\s@]+$/);
  assert.match(manifest.browser_specific_settings.gecko.strict_min_version, /^\d+\.\d+$/);
  const collection = manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.ok(Array.isArray(collection?.required) && collection.required.length > 0,
    "AMO 从 2025-11 起要求 data_collection_permissions");
  assert.equal(manifest.minimum_chrome_version, undefined);
});

test("background runs as an event page script, not a service worker", () => {
  assert.equal(manifest.background.service_worker, undefined);
  assert.deepEqual(manifest.background.scripts, ["background.js"]);
  assert.equal(manifest.background.type, "module");
});

test("every manifest permission and host pattern is valid for Firefox", () => {
  const allowedPermissions = new Set([
    "alarms", "clipboardWrite", "cookies", "downloads", "nativeMessaging", "storage"
  ]);
  for (const permission of manifest.permissions) {
    assert.ok(allowedPermissions.has(permission), `Firefox 不支持权限：${permission}`);
  }
  assert.ok(Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0);
  for (const pattern of manifest.host_permissions) {
    assert.match(pattern, /^https:\/\/[^/]+\/\*$/, `主机权限格式异常：${pattern}`);
  }
});

test("version is bumped past the last released build", () => {
  // AMO 拒绝重复版本号。0.5.11 已作为首个签名版本上传，之后任何改动都必须升版本。
  const LAST_RELEASED = "0.8.0";
  const version = manifest.version;
  const toParts = (v) => v.split(".").map((n) => Number.parseInt(n, 10));
  const [a, b, c] = toParts(version);
  const [x, y, z] = toParts(LAST_RELEASED);
  const newer = a > x || (a === x && (b > y || (b === y && c > z)));
  assert.ok(
    newer,
    `manifest 版本 ${version} 不大于已发布的 ${LAST_RELEASED}，AMO 会拒绝上传`
  );
});

test("all referenced files exist and content scripts are omitted", () => {
  for (const file of [...manifest.background.scripts, "app.html", "app.js", "app.css"]) {
    assert.ok(existsSync(path.join(projectRoot, file)), `缺少文件：${file}`);
  }
  for (const icon of Object.values(manifest.icons)) {
    assert.ok(existsSync(path.join(projectRoot, icon)), `缺少图标：${icon}`);
  }
  assert.equal(manifest.content_scripts, undefined);
});

test("source never falls back to the chrome namespace or callback-style runtime calls", () => {
  for (const file of ["background.js", "app.js"]) {
    const source = readFileSync(path.join(projectRoot, file), "utf8");
    assert.equal(/\bchrome\./.test(source), false, `${file} 仍在使用 chrome.*`);
    assert.equal(/runtime\.lastError/.test(source), false, `${file} 仍在使用 runtime.lastError 回调`);
    assert.equal(/sendMessage\([^)]*, *\(?[a-zA-Z_]*\)? *=>/.test(source), false, `${file} 仍在用回调式 sendMessage`);
  }
});

test("native host manifests use allowed_extensions instead of allowed_origins", () => {
  const sh = readFileSync(path.join(projectRoot, "install_native_host.sh"), "utf8");
  const ps1 = readFileSync(path.join(projectRoot, "install_native_host.ps1"), "utf8");
  for (const [name, source] of [["install_native_host.sh", sh], ["install_native_host.ps1", ps1]]) {
    assert.equal(source.includes("allowed_origins"), false, `${name} 仍写入 allowed_origins`);
    assert.equal(source.includes("allowed_extensions"), true, `${name} 缺少 allowed_extensions`);
  }
  assert.match(sh, /Mozilla\/NativeMessagingHosts/);
  assert.ok(ps1.includes("Software\\Mozilla\\NativeMessagingHosts"), "PowerShell 脚本未写入 Firefox 注册表路径");
});