#!/usr/bin/env python3
"""
Fast touch coordinate calibration for DictPen devices.

Old approach: grid scan with app re-launch per point (~7 min).
New approach:
  1. Launch settings app ONCE.
  2. Fire a dense row of taps along X and Y axes (no re-launch).
  3. Capture screenshots before each row and compare.
  4. Derive effective touch range from first/last hit positions.
  5. Save calibration file.

Typical runtime: < 60 seconds.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dictpen_ui.adb import Adb
from dictpen_ui.device import DictPenDevice
from dictpen_ui.screenshot import ScreenshotDriver, sha256_file


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

    print(json.dumps({"step": "init", "sku": sku, "phys_w": phys_w, "phys_h": phys_h,
                      "direction": direction, "tp_direction": tp_dir}, ensure_ascii=False), flush=True)

    tmp_dir = ROOT / "runs" / "calib_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # ── Step 1: go home, launch settings app ──
    print(json.dumps({"step": "launch_app"}), flush=True)
    adb.shell("send_event asr press; sleep 0.1; send_event asr release", check=False)
    time.sleep(0.8)
    adb.shell("miniapp_cli start 8080272425914438 2>/dev/null || true", timeout=15, check=False)
    time.sleep(2.5)

    # baseline screenshot
    baseline = tmp_dir / "baseline.png"
    shots.capture(baseline)
    baseline_hash = sha256_file(baseline)
    baseline_size = baseline.stat().st_size
    print(json.dumps({"step": "baseline", "size": baseline_size, "hash": baseline_hash[:8]}), flush=True)

    if baseline_size < 1000:
        print(json.dumps({"step": "error", "msg": "Baseline screenshot too small — device may be off or disconnected"}), flush=True)
        return _fallback(sku, phys_w, phys_h, direction, tp_dir, tp_xoff, tp_yoff, "baseline_failed")

    # ── Step 2: fast tap scan — NO app re-launch between points ──
    # After each tap, take screenshot and compare to the one BEFORE that tap.
    # A "hit" means the tap triggered a UI change.

    def tap_and_check(tx: int, ty: int, prev_hash: str) -> tuple[bool, str]:
        """Fire a tap, return (hit, new_hash)."""
        adb.shell(
            f"send_event touch press {tx} {ty}; sleep 0.10; send_event touch release",
            timeout=8, check=False,
        )
        time.sleep(0.35)
        p = tmp_dir / "probe.png"
        shots.capture(p)
        h = sha256_file(p)
        return h != prev_hash, h

    # ── Scan X axis (at Y = phys_h // 2) ──
    print(json.dumps({"step": "scan_x", "y_fixed": phys_h // 2, "range": phys_w}), flush=True)
    y_mid = phys_h // 2
    step_x = max(1, phys_w // 20)  # ~20 points across X
    hits_x: list[int] = []
    prev = sha256_file(baseline)

    for x in range(0, phys_w, step_x):
        hit, prev = tap_and_check(x, y_mid, prev)
        if hit:
            hits_x.append(x)
        print(json.dumps({"scan": "x", "x": x, "hit": hit}), flush=True)

    # ── Scan Y axis (at X = phys_w // 2) ──
    print(json.dumps({"step": "scan_y", "x_fixed": phys_w // 2, "range": phys_h}), flush=True)
    x_mid = phys_w // 2
    step_y = max(1, phys_h // 15)  # ~15 points across Y
    hits_y: list[int] = []

    for y in range(0, phys_h, step_y):
        hit, prev = tap_and_check(x_mid, y, prev)
        if hit:
            hits_y.append(y)
        print(json.dumps({"scan": "y", "y": y, "hit": hit}), flush=True)

    print(json.dumps({"step": "scan_done", "hits_x": hits_x, "hits_y": hits_y}), flush=True)

    # ── Step 3: decide calibration result ──
    if not hits_x and not hits_y:
        # Zero hits — likely app didn't launch or device is showing blank screen
        # Fall back to cfg.json values (still better than nothing)
        print(json.dumps({"step": "warn", "msg": "No hits found — using cfg.json defaults"}), flush=True)
        return _save(sku, phys_w, phys_h, direction, tp_dir, tp_xoff, tp_yoff, calibrated=False, note="no_hits")

    # Compute effective touch offsets from hits
    # If hits are shifted from [0, phys_w] we can estimate xoffset
    x_min_hit = min(hits_x) if hits_x else 0
    x_max_hit = max(hits_x) if hits_x else phys_w - 1
    y_min_hit = min(hits_y) if hits_y else 0
    y_max_hit = max(hits_y) if hits_y else phys_h - 1

    # Derive offset: if first hit is far from 0, the touch panel has an offset
    x_offset = x_min_hit if x_min_hit > phys_w * 0.1 else 0
    y_offset = y_min_hit if y_min_hit > phys_h * 0.1 else 0

    # Combine with existing cfg offsets
    total_xoff = tp_xoff + x_offset
    total_yoff = tp_yoff + y_offset

    return _save(sku, phys_w, phys_h, direction, tp_dir, total_xoff, total_yoff,
                 calibrated=True, note="fast_scan",
                 touch_x_range=[x_min_hit, x_max_hit],
                 touch_y_range=[y_min_hit, y_max_hit])


def _fallback(sku, phys_w, phys_h, direction, tp_dir, tp_xoff, tp_yoff, note):
    return _save(sku, phys_w, phys_h, direction, tp_dir, tp_xoff, tp_yoff,
                 calibrated=False, note=note)


def _save(sku, phys_w, phys_h, direction, tp_dir, tp_xoff, tp_yoff,
          calibrated=True, note="", **extra) -> dict:
    result = {
        "sku": sku,
        "phys_w": phys_w, "phys_h": phys_h,
        "direction": direction, "tp_direction": tp_dir,
        "tp_xoffset": tp_xoff, "tp_yoffset": tp_yoff,
        "calibrated": calibrated,
        "note": note,
        **extra,
    }
    ui_map_dir = ROOT / "ui-map"
    ui_map_dir.mkdir(exist_ok=True)
    calib_file = ui_map_dir / f"{sku}.json"
    calib_file.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({"step": "saved", "file": str(calib_file), "calibrated": calibrated}), flush=True)
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument("--adb", default="adb")
    args = parser.parse_args()
    result = calibrate(args.serial, adb_path=args.adb)
    print(json.dumps(result, indent=2, ensure_ascii=False))
