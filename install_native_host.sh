#!/bin/sh
set -eu

HOST_NAME="com.xiaoyuzhou.desktop"
DEFAULT_EXTENSION_ID="xiaoyuzhou-desktop@qwe38qwe.github.io"
EXTENSION_ID="${1:-$DEFAULT_EXTENSION_ID}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_HOST_SCRIPT="$SCRIPT_DIR/native_host.py"
SOURCE_LOCAL_WORKER="$SCRIPT_DIR/local_asr_worker.py"
INSTALL_DIR="$HOME/Library/Application Support/Xiaoyuzhou Desktop Native Host"
HOST_SCRIPT="$INSTALL_DIR/native_host.py"
LOCAL_WORKER="$INSTALL_DIR/local_asr_worker.py"
HOST_LAUNCHER="$INSTALL_DIR/native-host"
if [ -n "${FIREFOX_NATIVE_MANIFEST_DIR:-}" ]; then
  MANIFEST_DIR="$FIREFOX_NATIVE_MANIFEST_DIR"
else
  MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
fi
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

case "$EXTENSION_ID" in
  *@*)
    ;;
  *)
    echo "无效的扩展 ID：$EXTENSION_ID（Firefox 需要形如 name@example.org 的 ID）" >&2
    exit 1
    ;;
esac

mkdir -p "$INSTALL_DIR"
cp "$SOURCE_HOST_SCRIPT" "$HOST_SCRIPT"
chmod +x "$HOST_SCRIPT"
if [ -f "$SOURCE_LOCAL_WORKER" ]; then
  cp "$SOURCE_LOCAL_WORKER" "$LOCAL_WORKER"
  chmod +x "$LOCAL_WORKER"
fi

cat > "$HOST_LAUNCHER" <<EOF
#!/bin/sh
exec /usr/bin/python3 "$HOST_SCRIPT"
EOF
chmod +x "$HOST_LAUNCHER"
mkdir -p "$MANIFEST_DIR"

/usr/bin/python3 - "$MANIFEST_PATH" "$HOST_LAUNCHER" "$DEFAULT_EXTENSION_ID" "$EXTENSION_ID" <<'PY'
import json
import re
import sys
from pathlib import Path

manifest_path, host_launcher, default_extension_id, extension_id = sys.argv[1:]
allowed_extensions = {
    default_extension_id,
    extension_id,
}
path = Path(manifest_path)
if path.is_file():
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
        allowed_extensions.update(
            value
            for value in current.get("allowed_extensions", [])
            if re.fullmatch(r"[^\s]+@[^\s]+", str(value))
        )
    except (OSError, ValueError, TypeError):
        pass
manifest = {
    "name": "com.xiaoyuzhou.desktop",
    "description": "Xiaoyuzhou Desktop local file and ASR helper",
    "path": host_launcher,
    "type": "stdio",
    "allowed_extensions": sorted(allowed_extensions),
}
with path.open("w", encoding="utf-8") as file:
    json.dump(manifest, file, ensure_ascii=False, indent=2)
    file.write("\n")
PY

echo "本地助手已安装：$MANIFEST_PATH"
echo "已加入扩展 ID：$EXTENSION_ID"
