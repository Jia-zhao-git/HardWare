#!/usr/bin/env python3
"""
Generate tests/all-apps.yaml from a connected device.

Automatically reads screen config (cfg.json) and installed apps (packages.json).
Coordinates are derived from cfg.json — no hardcoded values.

Each app flow (~16 steps):
  home → launch → verify launched → tap center → tap right
  → scroll down → scroll up → tap left → exit → verify exit
  → proc snapshot

Usage: python gen_all_apps_test.py [--serial <serial>] [--adb <path>]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# Import coordinate adapter for swipe/tap generation
_sys = sys
_this_dir = str(Path(__file__).parent)
if _this_dir not in _sys.path:
    _sys.path.insert(0, _this_dir)

from dictpen_ui.coordinates import CoordinateAdapter  # noqa: E402

# ──────────────────────────────────────────────────────────
# Parse args
# ──────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--serial", default="auto")
parser.add_argument("--adb",   default="adb")
cli_args = parser.parse_args()

ADB    = cli_args.adb
SERIAL = cli_args.serial

# ──────────────────────────────────────────────────────────
# Detect device
# ──────────────────────────────────────────────────────────
print("Detecting connected device …")
r = subprocess.run(
    [ADB, "devices", "-l"],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
)
connected = []
for line in r.stdout.decode("utf-8", "replace").splitlines()[1:]:
    parts = line.strip().split()
    if len(parts) >= 2 and parts[1] == "device":
        connected.append(parts[0])

if SERIAL == "auto":
    if not connected:
        print("ERROR: No ADB device connected", file=sys.stderr)
        sys.exit(1)
    SERIAL = connected[0]
print(f"  device = {SERIAL}")


def shell(cmd: str, timeout: int = 20) -> str:
    r = subprocess.run(
        [ADB, "-s", SERIAL, "shell", cmd],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
    )
    return r.stdout.decode("utf-8", "replace")


# ──────────────────────────────────────────────────────────
# Read SKU for calibration lookup (must come before screen config)
# ──────────────────────────────────────────────────────────
sku_raw = shell("grep ^sku= /data/cfg/sys_config.conf 2>/dev/null")
sku_match = re.search(r'^sku=(.*)', sku_raw, re.MULTILINE)
sku = sku_match.group(1).strip() if sku_match else "unknown"
print(f"  SKU: {sku}")

# ──────────────────────────────────────────────────────────
# Read screen config → CoordinateAdapter
# ──────────────────────────────────────────────────────────
print("Reading screen config …")
cfg_raw = shell("cat /etc/miniapp/resources/cfg.json 2>/dev/null")
try:
    cfg = json.loads(cfg_raw)
    scr = cfg.get("screen", {})
    phys_w    = scr.get("width", 280)
    phys_h    = scr.get("height", 936)
    direction = scr.get("direction", 0)
    tp_dir    = scr.get("tp_direction", 0)
    tp_xoff   = scr.get("tp_xoffset", 0)
    tp_yoff   = scr.get("tp_yoffset", 0)
except Exception as e:
    print(f"WARN: cfg.json parse error ({e}), using defaults")
    phys_w, phys_h, direction, tp_dir, tp_xoff, tp_yoff = 280, 936, 270, 270, 0, 0

# Create coordinate adapter (auto-loads per-SKU calibration if available)
adapter = CoordinateAdapter.from_sku(sku, cfg)
ss_w, ss_h = adapter.screenshot_size
print(f"  phys={phys_w}x{phys_h}  dir={direction} tp_dir={tp_dir}  →  screenshot={ss_w}x{ss_h}")

# ──────────────────────────────────────────────────────────
# Interaction commands (all use adapter)
# ──────────────────────────────────────────────────────────

def _tap(ss_x: int, ss_y: int) -> str:
    p = adapter.screenshot_to_touch(ss_x, ss_y)
    return f"send_event touch press {p.x} {p.y}; sleep 0.12; send_event touch release"

TOUCH_CENTER      = _tap(ss_w // 2,      ss_h // 2)
TOUCH_RIGHT       = _tap(ss_w * 3 // 4,  ss_h // 2)
TOUCH_LEFT        = _tap(ss_w // 4,      ss_h // 2)
TOUCH_TOP_RIGHT   = _tap(ss_w * 3 // 4,  ss_h // 4)
TOUCH_BOTTOM_LEFT = _tap(ss_w // 4,      ss_h * 3 // 4)

SCROLL_DOWN  = adapter.swipe_down().to_shell_command()
SCROLL_UP    = adapter.swipe_up().to_shell_command()
SCROLL_LEFT  = adapter.swipe_left().to_shell_command()
SCROLL_RIGHT = adapter.swipe_right().to_shell_command()

# ──────────────────────────────────────────────────────────
# Read installed apps
# ──────────────────────────────────────────────────────────
print("Reading installed apps …")

SKIP_CATS = {
    "HOME", "TOP_PANEL", "Youdao_IM", "RECORD_SERVICES", "RECORD_SERVICE",
    "PARENTCONTROL", "USER_CENTER", "GUIDE",
}
NO_SCROLL_CATS = {"OCRPREVIEW", "IM_PANEL_DICT"}
MIN_KB     = 3
KEY_PROCS  = ["miniapp", "runDictPen"]
LOAD_WAIT  = 2.5

apps: list[dict] = []

# Multi-source fallback — different SKUs store apps in different paths
print("Reading installed apps from device …")
sources = [
    "cat /data/miniapp/data/mini_app/pkg/packages.json 2>/dev/null",
    "cat /etc/miniapp/resources/local_packages.json 2>/dev/null",
    "cat /etc/miniapp/resources/local_packages_thirdparty.json 2>/dev/null",
]
seen_appids: set[str] = set()

for src in sources:
    raw = shell(src)
    if not raw.strip():
        continue
    try:
        data = json.loads(raw)
        # packages.json format: {"packages": [{appid, name, category, ...}]}
        if "packages" in data:
            for p in data["packages"]:
                cat   = p.get("category", "")
                name  = p.get("name", "")
                appid = p.get("appid", "")
                if cat and name and appid and cat not in SKIP_CATS and appid not in seen_appids:
                    apps.append({"appid": appid, "name": name, "category": cat})
                    seen_appids.add(appid)
        # local_packages format: {"PackageList": [{id, Name, Category, ...}]}
        elif "PackageList" in data:
            for p in data["PackageList"]:
                cat   = p.get("Category", "")
                name  = p.get("Name", "")
                appid = p.get("id", "")
                if cat and name and appid and cat not in SKIP_CATS and appid not in seen_appids:
                    apps.append({"appid": appid, "name": name, "category": cat})
                    seen_appids.add(appid)
    except Exception as e:
        print(f"  WARN: parse error for {src[:60]}... ({e})")

if not apps:
    print("ERROR: no apps found", file=sys.stderr)
    sys.exit(1)

print(f"  {len(apps)} apps")
for a in apps:
    print(f"    {a['appid']:20s}  {a['name']:18s}  {a['category']}")

# ──────────────────────────────────────────────────────────
# Build YAML
# ──────────────────────────────────────────────────────────
def _key(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", s)[:20].strip("_") or "app"


def app_steps(idx: int, appid: str, name: str, category: str) -> list[str]:
    k = _key(name)
    do_scrl = category not in NO_SCROLL_CATS
    L: list[str] = []

    # home
    L += [
        f"  - name: home_before_{idx}",
        f"    action: press_key", f"    key: asr",
        f"    wait: 1.0", f"    capture: home_{idx}", "",
        f"  - name: assert_home_not_blank_{idx}",
        f"    action: assert", f"    capture_not_blank: home_{idx}",
        f"    min_kb: {MIN_KB}", "",
    ]
    # launch
    L += [
        f"  - name: launch_{idx}_{k}",
        f"    action: shell", f"    command: miniapp_cli start {appid}",
        f"    wait: {LOAD_WAIT}", f"    capture: enter_{idx}", "",
        f"  - name: assert_launched_{idx}",
        f"    action: assert",
        f"    screen_changed_from: home_{idx}", f"    current: enter_{idx}", "",
        f"  - name: assert_enter_not_blank_{idx}",
        f"    action: assert", f"    capture_not_blank: enter_{idx}",
        f"    min_kb: {MIN_KB}", "",
    ]
    # procs
    L.append(f"  - name: assert_procs_{idx}")
    L.append(f"    action: assert")
    L.append(f"    proc_alive:")
    for p in KEY_PROCS:
        L.append(f"      - {p}")
    L.append("")
    # tap center
    L += [
        f"  - name: tap_center_{idx}",
        f"    action: shell", f"    command: {TOUCH_CENTER}",
        f"    wait: 0.8", f"    capture: tap_center_{idx}", "",
        f"  - name: assert_tap_center_{idx}",
        f"    action: assert", f"    warn_only: true",
        f"    screen_changed_from: enter_{idx}", f"    current: tap_center_{idx}", "",
    ]
    # tap right
    L += [
        f"  - name: tap_right_{idx}",
        f"    action: shell", f"    command: {TOUCH_RIGHT}",
        f"    wait: 0.8", f"    capture: tap_right_{idx}", "",
    ]
    # scroll
    if do_scrl:
        L += [
            f"  - name: scroll_down_{idx}",
            f"    action: shell", f"    command: {SCROLL_DOWN}",
            f"    wait: 0.8", f"    capture: scroll_down_{idx}", "",
            f"  - name: assert_scroll_down_{idx}",
            f"    action: assert", f"    warn_only: true",
            f"    screen_changed_from: tap_right_{idx}", f"    current: scroll_down_{idx}", "",
            f"  - name: scroll_up_{idx}",
            f"    action: shell", f"    command: {SCROLL_UP}",
            f"    wait: 0.8", f"    capture: scroll_up_{idx}", "",
        ]
    # random taps (3 random positions) — simulate rapid exploration
    L += [
        f"  - name: random_tap_{idx}",
        f"    action: random_tap",
        f"    count: 3", f"    duration_ms: 100",
        f"    wait: 0.5",
        f"    capture: random_tap_{idx}", "",
    ]
    # shuffle (random mix of tap/swipe/long_press x 4)
    L += [
        f"  - name: shuffle_{idx}",
        f"    action: shuffle",
        f"    n: 4",
        f"    wait: 0.5",
        f"    capture: shuffle_{idx}", "",
        f"  - name: assert_shuffle_{idx}",
        f"    action: assert", f"    warn_only: true",
        f"    capture_not_blank: shuffle_{idx}",
        f"    min_kb: {MIN_KB}", "",
    ]
    # edge swipe (pull from top or side)
    L += [
        f"  - name: edge_swipe_{idx}",
        f"    action: edge_swipe",
        f"    edge: top",
        f"    wait: 0.8",
        f"    capture: edge_swipe_{idx}", "",
    ]
    # tap left
    L += [
        f"  - name: tap_left_{idx}",
        f"    action: shell", f"    command: {TOUCH_LEFT}",
        f"    wait: 0.8", f"    capture: tap_left_{idx}", "",
    ]
    # exit
    L += [
        f"  - name: exit_{idx}",
        f"    action: press_key", f"    key: asr",
        f"    wait: 0.5", f"    capture: after_exit_{idx}", "",
        f"  - name: assert_exit_{idx}",
        f"    action: assert",
        f"    screen_changed_from: enter_{idx}", f"    current: after_exit_{idx}", "",
        f"  - name: proc_snapshot_{idx}",
        f"    action: proc_snapshot", f"    label: after_{k}", "",
    ]
    return L


HEAD = [
    f"# Auto-generated by gen_all_apps_test.py",
    f"# Device: {SERIAL}",
    f"# Screen: {ss_w}x{ss_h}, dir={direction}, tp_dir={tp_dir}",
    f"# Apps: {len(apps)}",
    "name: all_apps_regression",
    "on_failure:",
    "  stop: false",
    "steps:",
]
STEPS: list[str] = []
for i, p in enumerate(apps, start=1):
    STEPS.extend(app_steps(i, p["appid"], p["name"], p["category"]))
STEPS += [
    "  - name: final_memory_check",
    "    action: assert",
    "    mem_delta_ok: -30",
    "",
]

out = Path(__file__).parent / "tests" / "all-apps.yaml"
content = "\n".join(HEAD + STEPS) + "\n"
out.write_bytes(content.encode("ascii", errors="replace"))

n_steps = sum(1 for l in STEPS if l.strip().startswith("- name:"))
est = len(apps) * (1.0 + LOAD_WAIT + 5 * 0.8 + 0.5 + 1.0)
print(f"\nWritten: {out}")
print(f"  Apps: {len(apps)}  Steps: {n_steps}  Est/cycle: {est:.0f}s (~{est/60:.1f} min)")
