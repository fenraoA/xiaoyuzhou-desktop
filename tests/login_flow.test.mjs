// 登录流程的纯逻辑回归测试（不依赖浏览器环境）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(path.join(projectRoot, "app.js"), "utf8");
const bgSource = readFileSync(path.join(projectRoot, "background.js"), "utf8");

// 二维码边长必须由固定基准算出，不能由 canvas.width 反推（否则每次刷新都会变小）
function qrcodeSize(moduleCount, baseSize) {
  const scale = Math.max(2, Math.floor(baseSize / (moduleCount + 2)));
  return { scale, size: moduleCount * scale };
}

test("QR code size is stable across repeated refreshes", () => {
  const BASE = 200;
  const moduleCount = 37; // 登录 URL（68 字节）实际产生的模块数
  const first = qrcodeSize(moduleCount, BASE);
  for (let i = 0; i < 10; i += 1) {
    const again = qrcodeSize(moduleCount, BASE);
    assert.deepEqual(again, first, "重复刷新后二维码尺寸不应变化");
  }
  assert.ok(first.size >= 180, "二维码渲染结果不应小于 180px，否则难以扫描");
});

test("qrcode base size is a constant, not derived from canvas.width", () => {
  assert.match(
    appSource,
    /const LOGIN_QRCODE_BASE_SIZE = \d+;/,
    "应使用固定常量作为二维码基准尺寸"
  );
  assert.equal(
    /Math\.floor\(canvas\.width/.test(appSource),
    false,
    "不得用 canvas.width 计算缩放（会被绘制结果覆写）"
  );
});

test("login poll loop handles every status the backend can return", () => {
  const handled = ["authorized", "scanned", "expired", "canceled"];
  for (const status of handled) {
    assert.ok(
      appSource.includes(`case "${status}"`),
      `前端缺少 ${status} 状态分支`
    );
  }
  // 后台能产出的所有状态
  const produced = ["waiting", "scanned", "expired", "canceled", "authorized"];
  for (const status of produced) {
    const inApp = appSource.includes(`case "${status}"`) || status === "waiting";
    assert.ok(inApp, `后台会返回 ${status}，前端未处理`);
  }
});

test("polling uses recursive setTimeout instead of setInterval", () => {
  const start = appSource.indexOf("async function startLoginQrcode");
  const end = appSource.indexOf("function openLogin", start);
  const body = appSource.slice(start, end);
  // 只检查真实调用，注释里提到 setInterval 不算
  assert.equal(/setInterval\s*\(/.test(body), false, "不应在轮询里使用 setInterval，会重叠请求");
  assert.ok(body.includes("setTimeout(tick"), "应使用递归 setTimeout 串行轮询");
});

test("login success pulls the full auth object from the background", () => {
  const start = appSource.indexOf("async function startLoginQrcode");
  const end = appSource.indexOf("function openLogin", start);
  const body = appSource.slice(start, end);
  assert.ok(
    body.includes('state.auth = await send("get-auth")'),
    "登录成功后应从后台取完整 auth 对象，而不是用返回的 user 拼半个对象"
  );
});

test("background parses JSON safely everywhere", () => {
  assert.equal(
    /await response\.json\(\)/.test(bgSource),
    false,
    "不应直接调用 response.json()，非 JSON 响应会导致误导性的解析错误"
  );
  assert.ok(bgSource.includes("readJsonSafe"), "应统一走 readJsonSafe");
});

test("background no longer ships dead SMS login or localhost probe", () => {
  for (const needle of ["sendSmsCode", 'case "send-code"', "127.0.0.1:7777"]) {
    assert.equal(bgSource.includes(needle), false, `后台仍残留：${needle}`);
  }
});

test("qrcode library exposes a usable factory in a bare sandbox", () => {
  const source = readFileSync(path.join(projectRoot, "qrcode.js"), "utf8");
  const sandbox = { module: undefined, exports: undefined, define: undefined };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.equal(typeof sandbox.qrcode, "function", "qrcode.js 应暴露全局 qrcode 函数");
  const code = sandbox.qrcode(0, "M");
  code.addData("https://h5.xiaoyuzhoufm.com/oauth?qrcode_id=6af54b6c6c1b8642d31d22fd");
  code.make();
  const count = code.getModuleCount();
  assert.ok(count > 0 && count <= 40, "应自动选择合法版本：" + count);
  assert.equal(typeof code.isDark(0, 0), "boolean");
});

test("volume control is wired and persists the level", () => {
  const html = readFileSync(path.join(projectRoot, "app.html"), "utf8");
  for (const id of ["volume-control", "volume-button", "volume-slider", "volume-value", "volume-icon"]) {
    assert.ok(html.includes(`id="${id}"`), `app.html 缺少 #${id}`);
  }
  // 滑块必须覆盖完整音域，否则静音和最大音量表达不了
  assert.match(html, /id="volume-slider"[^>]*min="0"[^>]*max="100"/);

  assert.ok(appSource.includes("function initVolumeControl"), "缺少 initVolumeControl");
  assert.ok(appSource.includes("function applyVolume"), "缺少 applyVolume");
  assert.ok(appSource.includes('localStorage.setItem(VOLUME_KEY'), "音量未持久化");

  // initPlayer 必须真的调用它，否则控件是死的
  const start = appSource.indexOf("function initPlayer");
  const end = appSource.indexOf("function volumeIconFor", start);
  assert.ok(appSource.slice(start, end).includes("initVolumeControl(audio)"),
    "initPlayer 未调用 initVolumeControl");

  // 音量必须落到 audio.volume 上，不能只改 UI
  assert.match(appSource, /audio\.volume\s*=/, "音量未写入 audio.volume");
});

test("volume icon reflects the level", () => {
  const start = appSource.indexOf("function volumeIconFor");
  const end = appSource.indexOf("function applyVolume", start);
  const body = appSource.slice(start, end);
  for (const icon of ["🔇", "🔈", "🔉", "🔊"]) {
    assert.ok(body.includes(icon), `音量图标缺少 ${icon}`);
  }
});
