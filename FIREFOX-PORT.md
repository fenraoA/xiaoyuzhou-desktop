# Chrome → Firefox 移植说明

本目录是 [xiaoyuzhou-desktop](https://github.com/QWE38qwe/xiaoyuzhou-desktop) 的 Firefox 版本。
功能、UI 与业务逻辑与上游一致，改动集中在扩展运行环境相关的部分。

## 1. 清单（manifest.json）

| 项目 | Chrome 版 | Firefox 版 |
| --- | --- | --- |
| 后台脚本 | `background.service_worker`（Service Worker） | `background.scripts`（事件页，`type: "module"`） |
| 扩展标识 | 商店/开发者模式生成 | `browser_specific_settings.gecko.id` = `xiaoyuzhou-desktop@qwe38qwe.github.io` |
| 最低版本 | `minimum_chrome_version: "110"` | `gecko.strict_min_version: "140.0"`（`data_collection_permissions` 自 140 起可用） |
| 权限 | `storage` `windows` `cookies` `alarms` `clipboardWrite` `downloads` `nativeMessaging` | 仅保留实际调用的 `storage` `clipboardWrite` `downloads` `nativeMessaging` |
| 内容脚本 | 指向 `web_timestamp.js` | 已移除（该文件在仓库中并不存在，Firefox 会因此拒绝装入） |

Firefox 不支持 `background.service_worker`（bug 1573659），事件页是 MV3 下的等价实现。
因为后台不再是 Service Worker，`background.js` 里对 `document`/`localStorage` 的隐式依赖也更安全。

## 2. API 命名空间与回调

- `chrome.*` → `browser.*`（`background.js` 31 处、`app.js` 3 处）。
- Firefox 的 `browser.*` 返回 Promise，**不再接受 Chrome 风格的回调**。改写的三处：
  - `background.js` 的 `nativeHostRequest()`：`sendNativeMessage(msg, cb)` → `await sendNativeMessage(msg)`，
    并改用 try/catch 捕获原生主机不可用。
  - `background.js` 的 `runtime.onMessage`：改为返回 Promise（Firefox 支持这种写法，Chrome MV3 同样接受）。
  - `app.js` 的 `send()`：`sendMessage(msg, cb)` + `runtime.lastError` → `await sendMessage(msg)` + try/catch。
- 端口/消息协议（`{ ok, data }` / `{ ok, error }`）保持不变，`app.js` 与 `background.js` 的
  18 个消息类型逐一核对无缺失。

## 3. 浏览器差异

- **窗口尺寸记忆**：Firefox 没有 `windows.onBoundsChanged`（bug 1762975）。
  改为能力检测：存在则原样使用，否则退化为 `windows.onFocusChanged`，在窗口失焦时记录一次尺寸。
- **可选站点权限**：Firefox 把 `host_permissions` 当作可撤销权限。新增
  `check-host-permissions` / `request-host-permissions` 两个消息，`app.html` 增加提示条，
  `guardedFetch()` 在跨域失败且权限缺失时给出明确中文提示，而不是笼统的网络错误。

## 4. 原生消息主机（Native Host）

Firefox 的清单格式与 Chrome 不同：

```diff
- "allowed_origins": ["chrome-extension://<32位ID>/"]
+ "allowed_extensions": ["xiaoyuzhou-desktop@qwe38qwe.github.io"]
```

安装路径与注册表也随之改变：

| 平台 | Chrome 版 | Firefox 版 |
| --- | --- | --- |
| macOS 清单 | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | `~/Library/Application Support/Mozilla/NativeMessagingHosts/` |
| Windows 注册表 | `HKCU:\Software\Google\Chrome\NativeMessagingHosts`、`...\Microsoft\Edge\...` | `HKCU:\Software\Mozilla\NativeMessagingHosts` |

`install_native_host.sh` 额外支持 `FIREFOX_NATIVE_MANIFEST_DIR` 覆盖清单目录，
`install_native_host.ps1` 的扩展 ID 校验从 `^[a-p]{32}$`（Chrome 格式）改为 `name@domain`（Firefox 格式）。

`native_host.py` 本身无需修改：它只处理 stdio 帧协议与系统凭据，与浏览器无关。

## 5. 已知限制

- 本地 Qwen3-ASR 仍只支持 Apple Silicon，与移植无关。
- Firefox 没有 `windows.onBoundsChanged`，窗口位置恢复精度略低于 Chrome 版。
- 未发布到 AMO；`about:debugging` 临时载入在 Firefox 重启后失效，长期使用需自行签名。

## 6. 验证

```bash
node --check app.js
node --check background.js
node --test tests/
```

`tests/firefox_manifest.test.mjs` 覆盖：gecko id 存在、后台为事件页、权限项合法、
无 `content_scripts`、源码无 `chrome.*` 与 `runtime.lastError`、两份安装脚本写
`allowed_extensions` 与 Mozilla 路径。当前 9 项测试全部通过。