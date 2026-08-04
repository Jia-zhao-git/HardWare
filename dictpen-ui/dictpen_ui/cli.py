from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .adb import Adb
from .device import DictPenDevice
from .input import CoordinateAdapter, InputDriver
from .calibrate import calibrate
from .runner import TestRunner
from .screenshot import ScreenshotDriver, png_size, sha256_file
from .screenshot import files_differ
from .simple_yaml import load_simple_yaml
ROOT = Path(__file__).resolve().parents[1]


def _serial_from_args(args) -> str:
    if args.serial:
        return args.serial
    devices = [d for d in Adb.devices(args.adb) if d.get("state") == "device"]
    if not devices:
        raise SystemExit("No ADB device in 'device' state")
    if len(devices) > 1:
        raise SystemExit("Multiple devices found; pass --serial")
    return devices[0]["serial"]


def cmd_devices(args) -> int:
    print(json.dumps(Adb.devices(args.adb), ensure_ascii=False, indent=2))
    return 0


def cmd_info(args) -> int:
    serial = _serial_from_args(args)
    info = DictPenDevice(Adb(serial=serial, adb_path=args.adb)).read_info()
    print(json.dumps(info.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_screenshot(args) -> int:
    serial = _serial_from_args(args)
    out = Path(args.out)
    path = ScreenshotDriver(Adb(serial=serial, adb_path=args.adb)).capture(out)
    size = png_size(path)
    print(json.dumps({"path": str(path), "size": size, "sha256": sha256_file(path)}, ensure_ascii=False, indent=2))
    return 0


def cmd_tap(args) -> int:
    serial = _serial_from_args(args)
    info = DictPenDevice(Adb(serial=serial, adb_path=args.adb)).read_info()
    InputDriver(Adb(serial=serial, adb_path=args.adb), CoordinateAdapter(info.sku)).tap(args.x, args.y, args.duration_ms)
    print(json.dumps({"serial": serial, "tap": [args.x, args.y]}, ensure_ascii=False))
    return 0


def cmd_swipe(args) -> int:
    serial = _serial_from_args(args)
    info = DictPenDevice(Adb(serial=serial, adb_path=args.adb)).read_info()
    InputDriver(Adb(serial=serial, adb_path=args.adb), CoordinateAdapter(info.sku)).swipe(args.x1, args.y1, args.x2, args.y2, args.duration_ms)
    print(json.dumps({"serial": serial, "swipe": [[args.x1, args.y1], [args.x2, args.y2]]}, ensure_ascii=False))
    return 0


def cmd_press_key(args) -> int:
    serial = _serial_from_args(args)
    InputDriver(Adb(serial=serial, adb_path=args.adb)).press_key(args.key, args.duration_ms)
    print(json.dumps({"serial": serial, "key": args.key}, ensure_ascii=False))
    return 0


def cmd_run(args) -> int:
    import time
    serial = _serial_from_args(args)
    runner = TestRunner(serial=serial, root=ROOT, adb_path=args.adb)
    test_path = Path(args.test)
    runs_dir = ROOT / "runs"

    loop = args.loop  # 0 = infinite
    duration = args.duration * 60 if args.duration else None  # minutes -> seconds
    start_ts = time.time()
    cycle = 0
    last_status = "passed"
    all_results: list = []  # lightweight per-cycle summaries only (avoid OOM on long runs)
    consecutive_errors = 0
    MAX_CONSECUTIVE_ERRORS = 10  # abort long run if device is gone / disk full

    # ── device info header (first log line) ──
    info = runner.info
    spec = load_simple_yaml(test_path)
    test_name = spec.get("name", test_path.stem) if isinstance(spec, dict) else test_path.stem
    steps_total = len(spec.get("steps", [])) if isinstance(spec, dict) else 0
    ss_w, ss_h = runner.coords.screenshot_size
    device_header = {
        "event": "device_info",
        "serial": serial,
        "sku": info.sku,
        "hostname": info.hostname,
        "screen_physical": f"{info.screen.width or '?'}x{info.screen.height or '?'}",
        "screenshot": f"{ss_w}x{ss_h}",
        "direction": info.screen.direction,
        "tp_direction": info.screen.tp_direction,
        "tp_xoffset": info.screen.tp_xoffset,
        "tp_yoffset": info.screen.tp_yoffset,
        "test": test_name,
        "loop": "∞" if loop == 0 else str(loop),
        "duration_min": args.duration if args.duration else "∞",
        "apps_per_cycle": steps_total,
        "est_cycle_min": round(steps_total * 0.8 / 60, 1) if steps_total else 0,
    }
    print(json.dumps(device_header, ensure_ascii=False), flush=True)

    while True:
        cycle += 1
        elapsed = time.time() - start_ts
        if duration and elapsed >= duration:
            print(json.dumps({"info": "duration reached", "cycles": cycle - 1, "elapsed_min": round(elapsed / 60, 1)}))
            break

        # Brief progress line — not the full step log
        print(json.dumps({"cycle": cycle, "elapsed_min": round(elapsed / 60, 1)}, ensure_ascii=False), flush=True)
        try:
            result = runner.run_test(test_path, runs_dir)
            consecutive_errors = 0
        except Exception as exc:
            consecutive_errors += 1
            print(json.dumps({
                "cycle": cycle,
                "status": "error",
                "error": str(exc)[:200],
                "consecutive_errors": consecutive_errors,
            }, ensure_ascii=False), flush=True)
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                print(json.dumps({
                    "info": "aborting: too many consecutive errors (device offline / disk full?)",
                    "cycles": cycle - 1,
                }, ensure_ascii=False), flush=True)
                last_status = "failed"
                break
            time.sleep(3)  # back off before retry
            continue
        last_status = result.status

        # Only print key summary (not every step)
        failed = [s for s in result.steps if s.status == "failed"]
        warned = [s for s in result.steps if s.status == "warned"]
        mem = result.mem_series
        mem_delta = round((mem[-1]["mem_available_kb"] - mem[0]["mem_available_kb"]) / 1024, 1) if len(mem) >= 2 else None
        # Store only a lightweight summary in memory; full data is on disk in run.json
        all_results.append({
            "run_id": result.run_id,
            "run_dir": result.run_dir,
            "status": result.status,
            "crash_issues": result.crash_issues,
            "mem_avail_start": mem[0]["mem_available_kb"] if mem else 0,
            "mem_avail_end": mem[-1]["mem_available_kb"] if mem else 0,
            "failed_names": [s.name for s in failed[:5]],
        })
        summary: dict = {
            "cycle": cycle,
            "status": result.status,
            "run_id": result.run_id,
            "steps": len(result.steps),
            "failed": len(failed),
            "warned": len(warned),
        }
        if failed:
            summary["failed_steps"] = [s.name for s in failed[:5]]
        if result.crash_issues:
            summary["crash_issues"] = [c.get("proc", "?") + ":" + c.get("issue", "?") for c in result.crash_issues]
        if result.crash_log:
            summary["crash_log_preview"] = result.crash_log[:200]
        if mem_delta is not None:
            summary["mem_delta_mb"] = mem_delta
        print(json.dumps(summary, ensure_ascii=False), flush=True)

        # Free the heavy result object promptly
        del result

        # Prune old run directories
        if args.keep_runs > 0:
            _prune_runs(runs_dir, args.keep_runs)

        if loop > 0 and cycle >= loop:
            break

    # --- write summary report (always, even single cycle) ---
    _write_summary_report(all_results, runs_dir, time.time() - start_ts)

    return 0 if last_status in ("passed", "warned") else 2


def cmd_calibrate(args) -> int:
    serial = _serial_from_args(args)
    result = calibrate(serial, adb_path=args.adb)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _prune_runs(runs_dir: Path, keep: int) -> None:
    """Delete oldest run directories and stale summary HTML, keeping `keep` most recent."""
    dirs = sorted(
        (d for d in runs_dir.iterdir() if d.is_dir() and (d / "run.json").exists()),
        key=lambda d: d.name,
    )
    for old in dirs[:-keep]:
        try:
            import shutil
            shutil.rmtree(old, ignore_errors=True)
        except Exception:
            pass
    # Also prune old summary-*.html files (keep at most keep*2)
    summaries = sorted(runs_dir.glob("summary-*.html"), key=lambda p: p.name, reverse=True)
    for old_sum in summaries[keep * 2:]:
        try:
            old_sum.unlink(missing_ok=True)
        except Exception:
            pass


def _write_summary_report(results: list, runs_dir: Path, total_sec: float) -> None:
    import html as _html
    import time as _time

    summary_id = _time.strftime("%Y%m%d-%H%M%S")
    out = runs_dir / f"summary-{summary_id}.html"

    total = len(results)
    passed = sum(1 for r in results if r["status"] == "passed")
    warned = sum(1 for r in results if r["status"] == "warned")
    failed = sum(1 for r in results if r["status"] == "failed")
    crash_count = sum(1 for r in results if r.get("crash_issues"))

    # collect per-cycle memory trend (mem_available at start/end of each cycle)
    mem_labels: list[str] = []
    mem_avail_start: list[float] = []
    mem_avail_end: list[float] = []
    cycle_rows: list[str] = []

    for i, r in enumerate(results, start=1):
        avail_s = round(r.get("mem_avail_start", 0) / 1024, 1)
        avail_e = round(r.get("mem_avail_end", 0) / 1024, 1)
        mem_labels.append(f"c{i}")
        mem_avail_start.append(avail_s)
        mem_avail_end.append(avail_e)

        if r.get("crash_issues"):
            names = ", ".join(c["proc"] + "(" + c["issue"] + ")" for c in r["crash_issues"])
            crash_cell = f"<span class='failed'>{_html.escape(names)}</span>"
        else:
            crash_cell = "<span class='passed'>OK</span>"

        failed_cell = "; ".join(_html.escape(n) for n in r.get("failed_names", [])) or "-"

        run_name = Path(r["run_dir"]).name
        # per-cycle report.html is intentionally not generated; link would be dead.
        # Show the run id as plain text (run dir may also be pruned on long runs).
        cycle_rows.append(
            f"<tr><td>{i}</td><td>{_html.escape(run_name)}</td>"
            f"<td class='{r['status']}'>{r['status']}</td><td>{crash_cell}</td>"
            f"<td>{avail_s} MB</td><td>{avail_e} MB</td><td>{failed_cell}</td></tr>"
        )

    mem_labels_js = json.dumps(mem_labels)
    mem_s_js = json.dumps(mem_avail_start)
    mem_e_js = json.dumps(mem_avail_end)

    body = f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>Summary Report</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#fafafa}}
table{{border-collapse:collapse;width:100%;background:#fff;margin-bottom:16px}}
td,th{{border:1px solid #ddd;padding:6px 8px;vertical-align:top}}
th{{background:#f0f0f0}}
.passed{{color:#148a08;font-weight:700}}
.warned{{color:#b07800;font-weight:700}}
.failed{{color:#c00;font-weight:700}}
canvas{{max-width:960px;width:100%;background:#fff;border:1px solid #ddd;display:block;margin-bottom:24px}}
.stat{{display:inline-block;margin:8px 16px 8px 0;padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:4px;font-size:18px}}
</style>
<h1>DictPen Long-Run Summary Report</h1>
<p>Generated: {_time.strftime('%Y-%m-%d %H:%M:%S')} &nbsp; Total runtime: {round(total_sec/3600,2)} h</p>
<div>
  <div class='stat'>Total cycles: <b>{total}</b></div>
  <div class='stat passed'>Passed: <b>{passed}</b></div>
  <div class='stat warned'>Warned: <b>{warned}</b></div>
  <div class='stat failed'>Failed: <b>{failed}</b></div>
  <div class='stat failed'>Crash events: <b>{crash_count}</b></div>
</div>

<h2>Memory Available per Cycle (MB)</h2>
<canvas id="memChart" height="80"></canvas>
<script>
(function(){{
  var labels={mem_labels_js};
  var s={mem_s_js};
  var e={mem_e_js};
  var c=document.getElementById('memChart');
  var ctx=c.getContext('2d');
  var W=c.offsetWidth||960,H=c.offsetHeight||160;
  c.width=W;c.height=H;
  var n=s.length;
  if(n<1){{ctx.fillText('No data',10,20);return;}}
  var maxV=Math.max.apply(null,s.concat(e))||1;
  var minV=Math.min.apply(null,s.concat(e));
  var pad={{l:60,r:20,t:20,b:30}};
  var w=W-pad.l-pad.r,h=H-pad.t-pad.b;
  function sx(i){{return pad.l+(n<2?w/2:i/(n-1)*w);}}
  function sy(v){{return pad.t+h-((v-minV)/(maxV-minV||1))*h;}}
  ctx.strokeStyle='#eee';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){{
    var y=pad.t+g*h/4;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
    ctx.fillStyle='#888';ctx.font='11px sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(minV+(maxV-minV)*(1-g/4))+'MB',pad.l-4,y+4);
  }}
  ctx.strokeStyle='#1a7';ctx.lineWidth=2;ctx.beginPath();
  s.forEach(function(v,i){{i===0?ctx.moveTo(sx(i),sy(v)):ctx.lineTo(sx(i),sy(v));}});
  ctx.stroke();
  ctx.strokeStyle='#e88';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.beginPath();
  e.forEach(function(v,i){{i===0?ctx.moveTo(sx(i),sy(v)):ctx.lineTo(sx(i),sy(v));}});
  ctx.stroke();ctx.setLineDash([]);
  var step=Math.max(1,Math.floor(n/20));
  ctx.fillStyle='#555';ctx.font='10px sans-serif';ctx.textAlign='center';
  labels.forEach(function(l,i){{if(i%step===0)ctx.fillText(l,sx(i),H-4);}});
  ctx.fillStyle='#1a7';ctx.fillRect(W-140,8,14,4);ctx.fillStyle='#333';ctx.textAlign='left';ctx.font='11px sans-serif';ctx.fillText('Avail start',W-122,16);
  ctx.fillStyle='#e88';ctx.fillRect(W-140,20,14,4);ctx.fillStyle='#333';ctx.fillText('Avail end',W-122,28);
}})();
</script>

<h2>Cycle Detail</h2>
<table><tr><th>#</th><th>Run ID</th><th>Status</th><th>Process Check</th><th>Mem Start</th><th>Mem End</th><th>Failed Steps</th></tr>
{''.join(cycle_rows)}
</table>
</html>"""
    out.write_text(body, encoding="utf-8")
    print(json.dumps({"summary_report": str(out)}, ensure_ascii=False, indent=2))


def cmd_scan_home(args) -> int:
    import time

    serial = _serial_from_args(args)
    adb = Adb(serial=serial, adb_path=args.adb)
    info = DictPenDevice(adb).read_info()
    input_driver = InputDriver(adb, CoordinateAdapter(info.sku))
    shots = ScreenshotDriver(adb)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.home:
        input_driver.press_key("asr")
        time.sleep(args.wait)
    base = shots.capture(out_dir / "000_home.png")

    results = []
    index = 1
    for y in args.ys:
        for x in args.xs:
            if args.home_each:
                input_driver.press_key("asr")
                time.sleep(args.wait)
            before = shots.capture(out_dir / f"{index:03d}_{x}_{y}_before.png")
            input_driver.tap(x, y, args.duration_ms)
            time.sleep(args.wait)
            after = shots.capture(out_dir / f"{index:03d}_{x}_{y}_after.png")
            changed_from_before = files_differ(before, after)
            changed_from_home = files_differ(base, after)
            item = {
                "index": index,
                "point": [x, y],
                "changed_from_before": changed_from_before,
                "changed_from_home": changed_from_home,
                "before": str(before),
                "after": str(after),
            }
            results.append(item)
            print(json.dumps(item, ensure_ascii=False))
            index += 1

    (out_dir / "scan-home.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"out_dir": str(out_dir), "results": str(out_dir / "scan-home.json")}, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dictpen-ui", description="ADB-based UI automation for Youdao Dictionary Pen")
    p.add_argument("--adb", default="adb", help="adb executable path")
    p.add_argument("--serial", help="ADB serial; auto-selects single connected device if omitted")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("devices").set_defaults(func=cmd_devices)
    sub.add_parser("info").set_defaults(func=cmd_info)

    s = sub.add_parser("screenshot")
    s.add_argument("--out", required=True)
    s.set_defaults(func=cmd_screenshot)

    t = sub.add_parser("tap")
    t.add_argument("--x", type=int, required=True)
    t.add_argument("--y", type=int, required=True)
    t.add_argument("--duration-ms", type=int, default=120)
    t.set_defaults(func=cmd_tap)

    sw = sub.add_parser("swipe")
    sw.add_argument("--x1", type=int, required=True)
    sw.add_argument("--y1", type=int, required=True)
    sw.add_argument("--x2", type=int, required=True)
    sw.add_argument("--y2", type=int, required=True)
    sw.add_argument("--duration-ms", type=int, default=300)
    sw.set_defaults(func=cmd_swipe)

    k = sub.add_parser("press-key")
    k.add_argument("key", choices=["asr", "camera", "menu", "power", "screen_off", "rk8xx_pwrkey", "axp2101-pek"])
    k.add_argument("--duration-ms", type=int, default=120)
    k.set_defaults(func=cmd_press_key)

    r = sub.add_parser("run")
    r.add_argument("test")
    r.add_argument("--loop", type=int, default=1, metavar="N", help="repeat N times; 0 = loop forever until Ctrl+C")
    r.add_argument("--duration", type=float, default=0, metavar="MINUTES", help="stop after this many minutes")
    r.add_argument("--keep-runs", type=int, default=50, metavar="N", help="keep only N most recent run dirs (0=unlimited)")
    r.set_defaults(func=cmd_run)

    scan = sub.add_parser("scan-home", help="tap a grid/list of points and capture before/after screenshots")
    scan.add_argument("--xs", type=int, nargs="+", default=[120, 300, 468, 640, 820])
    scan.add_argument("--ys", type=int, nargs="+", default=[80, 140, 220])
    scan.add_argument("--out-dir", default=str(ROOT / "runs" / "scan-home"))
    scan.add_argument("--wait", type=float, default=0.8)
    scan.add_argument("--duration-ms", type=int, default=120)
    scan.add_argument("--home", action="store_true", help="press asr before first capture")
    scan.add_argument("--home-each", action="store_true", help="press asr before each point")
    scan.set_defaults(func=cmd_scan_home)

    cal = sub.add_parser("calibrate", help="auto-detect touch coordinate mapping for this device")
    cal.set_defaults(func=cmd_calibrate)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
