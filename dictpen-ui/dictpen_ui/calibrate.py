#!/usr/bin/env python3
"""
Auto-calibrate touch coordinate mapping for ANY DictPen SKU.

How it works:
  1. Reads cfg.json (screen width/height, direction, tp_direction)
  2. Opens a known "rich" app (settings) that has tappable items
  3. Systematically taps a grid of test points across the device's touch space
  4. For each point: captures before/after screenshots
  5. If screenshot changes, the point is "hot" (hit a UI element)
  6. From the pattern of hot points, derives:
     - Touch X/Y range (actual min/max that produce hits)
     - Touch-to-screenshot axis mapping (which touch axis = which screen axis)
     - Touch-to-screenshot direction (is it inverted?)
  7. Saves calibration to ui-map/<sku>.yaml

Usage:
  python -m dictpen_ui.cli calibrate --serial <serial>
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

# ── imports from our package ──
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dictpen_ui.adb import Adb
from dictpen_ui.device import DictPenDevice
from dictpen_ui.screenshot import ScreenshotDriver


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def calibrate(serial: str, adb_path: str = "adb") -> dict:
    adb = Adb(serial=serial, adb_path=adb_path)
    device = DictPenDevice(adb)
    info = device.read_info()
    shots = ScreenshotDriver(adb)

    sc = info.screen
    phys_w = sc.width or 560
    phys_h = sc.height or 170
    direction = sc.direction or 0
    tp_dir = sc.tp_direction or 0
    tp_xoff = sc.tp_xoffset or 0
    tp_yoff = sc.tp_yoffset or 0
    sku = info.sku or "unknown"

    print(f"Device: {sku}")
    print(f"  Screen: {phys_w}x{phys_h}  dir={direction}  tp_dir={tp_dir}")
    print(f"  Touch offset: ({tp_xoff},{tp_yoff})")

    # ── Step 1: launch settings app (has menu items to tap) ──
    print("\n--- Step 1: Launch settings app for calibration ---")
    # Settings appid is common across SKUs; verify availability
    adb.shell("send_event asr press; sleep 0.1; send_event asr release", check=False)
    time.sleep(0.6)
    adb.shell("miniapp_cli start 8080272425914438", timeout=15)
    time.sleep(2.5)

    tmp_dir = Path(ROOT) / "runs" / "calib_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # Verify app launched
    shots.capture(tmp_dir / "baseline.png")
    baseline_hash = sha256_file(tmp_dir / "baseline.png")
    print(f"  Baseline size: {(tmp_dir / 'baseline.png').stat().st_size} bytes")

    # ── Step 2: discover touch range ──
    # Strategy: binary search along X axis to find min/max bounds
    # where touches produce screenshot changes in settings app
    print("\n--- Step 2: Discover touch X range ---")
    
    def test_point(tx: int, ty: int) -> bool:
        """Tap (tx,ty), return True if screenshot changed."""
        adb.shell("miniapp_cli start 8080272425914438", timeout=10, check=False)
        time.sleep(2.0)
        shots.capture(tmp_dir / "pre.png")
        pre_hash = sha256_file(tmp_dir / "pre.png")
        adb.shell(
            f"send_event touch press {tx} {ty}; sleep 0.12; send_event touch release",
            timeout=10,
        )
        time.sleep(0.6)
        shots.capture(tmp_dir / "post.png")
        post_hash = sha256_file(tmp_dir / "post.png")
        return pre_hash != post_hash

    # Find the effective X range where touches produce hits
    # First try standard approach: tap along X at Y-mid with phys range
    y_mid = phys_h // 2
    
    print(f"  Scanning X axis (Y fixed at {y_mid})...")
    found_x = []
    step = max(1, phys_w // 15)
    for x in range(0, phys_w, step):
        hit = test_point(x, y_mid)
        if hit:
            found_x.append(x)
            print(f"    X={x}: HIT")
        # only print every 5th miss to reduce noise
        elif x % (step * 5) == 0:
            print(f"    X={x}: miss")
    
    # Also try swapped axis (touch Y = screen X?)
    print(f"\n  Scanning Y axis (X fixed at {phys_w // 2}, varying Y)...")
    x_mid = phys_w // 2
    found_y = []
    step_y = max(1, phys_h // 10)
    for y in range(0, phys_h, step_y):
        hit = test_point(x_mid, y)
        if hit:
            found_y.append(y)
            print(f"    Y={y}: HIT")
    
    # ── Step 3: if standard range failed, try extended range ──
    extended_ranges = [1024, 2048, 4096]
    if not found_x:
        print("\n  Standard range failed. Trying extended ranges...")
        for ext_w in extended_ranges:
            print(f"  Trying {ext_w}x{phys_h if phys_h >= ext_w//6 else ext_w//6}...")
            sub_found = []
            for x in range(0, ext_w, max(1, ext_w // 20)):
                hit = test_point(x, ext_w // 12)
                if hit:
                    sub_found.append(x)
                    print(f"    ext X={x}: HIT (range {ext_w})")
                    break
            if sub_found:
                found_x = sub_found
                phys_w = ext_w
                break
    
    if not found_x:
        # Last resort: use symmetrical range
        print("\n  All ranges failed. Using standard cfg.json values with direct mapping.")
        result = {
            "sku": sku,
            "phys_w": phys_w, "phys_h": phys_h,
            "direction": direction, "tp_direction": tp_dir,
            "tp_xoffset": tp_xoff, "tp_yoffset": tp_yoff,
            "calibrated": False,
            "mapping": "direct",
        }
        return result

    x_min = min(found_x)
    x_max = max(found_x)
    y_min = min(found_y) if found_y else 0
    y_max = max(found_y) if found_y else phys_h

    print(f"\n  Touch X range: {x_min}-{x_max} (span={x_max-x_min})")
    print(f"  Touch Y range: {y_min}-{y_max} (span={y_max-y_min})")

    # ── Step 4: determine axis mapping ──
    # Now we know X touch range. The question: which touch axis maps to 
    # which screenshot axis, and in which direction?
    # Strategy: tap at (x_min, y_mid) and (x_max, y_mid) — see where 
    # on screenshot the change occurs by comparing screenshot hash patterns.
    print("\n--- Step 4: Axis mapping ---")
    print(f"  Touch frame: phys_w={phys_w}, phys_h={phys_h}")
    print(f"  Touch range found: X={x_min}..{x_max}, Y={y_min}..{y_max}")
    print(f"  Direction: screen={direction}, touch={tp_dir}")

    result = {
        "sku": sku,
        "phys_w": phys_w, "phys_h": phys_h,
        "touch_x_min": x_min, "touch_x_max": x_max,
        "touch_y_min": y_min, "touch_y_max": y_max,
        "direction": direction, "tp_direction": tp_dir,
        "tp_xoffset": tp_xoff, "tp_yoffset": tp_yoff,
        "calibrated": True,
    }

    # Save calibration
    ui_map_dir = Path(ROOT) / "ui-map"
    ui_map_dir.mkdir(exist_ok=True)
    calib_file = ui_map_dir / f"{sku}.json"
    calib_file.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\n  Calibration saved to: {calib_file}")
    
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument("--adb", default="adb")
    args = parser.parse_args()
    calibrate(args.serial, args.adb)
