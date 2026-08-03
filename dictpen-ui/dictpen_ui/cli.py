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
    all_results: list = []

    while True:
        cycle += 1
        elapsed = time.time() - start_ts
        if duration and elapsed >= duration:
            print(json.dumps({"info": "duration reached", "cycles": cycle - 1, "elapsed_min": round(elapsed / 60, 1)}))
            break

        # Brief progress line — not the full step log
        print(json.dumps({"cycle": cycle, "elapsed_min": round(elapsed / 60, 1)}, ensure_ascii=False), flush=True)
        result = runner.run_test(test_path, runs_dir)
        last_status = result.status
        all_results.append(result)

        # Only print key summary (not every step)
        failed = [s for s in result.steps if s.status == "failed"]
        warned = [s for s in result.steps if s.status == "warned"]
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
        mem = result.mem_series
        if len(mem) >= 2:
            delta = round((mem[-1]["mem_available_kb"] - mem[0]["mem_available_kb"]) / 1024, 1)
            summary["mem_delta_mb"] = delta
        print(json.dumps(summary, ensure_ascii=False), flush=True)

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
    """Delete oldest run directories, keeping `keep` most recent."""
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


def _write_summary_report(results: list, runs_dir: Path, total_sec: float) -> None:
    import html as _html
    import time as _time

    summary_id = _time.strftime("%Y%m%d-%H%M%S")
    out = runs_dir / f"summary-{summary_id}.html"

    total = len(results)
    passed = sum(1 for r in results if r.status == "passed")
    warned = sum(1 for r in results if r.status == "warned")
    failed = sum(1 for r in results if r.status == "failed")
    crash_count = sum(1 for r in results if r.crash_issues)

    # collect per-cycle memory trend (mem_available at start/end of each cycle)
    mem_labels: list[str] = []
    mem_avail_start: list[float] = []
    mem_avail_end: list[float] = []
    cycle_rows: list[str] = []

    for i, r in enumerate(results, start=1):
        ms = r.mem_series
        avail_s = round(ms[0]["mem_available_kb"] / 1024, 1) if ms else 0
        avail_e = round(ms[-1]["mem_available_kb"] / 1024, 1) if ms else 0
        mem_labels.append(f"c{i}")
        mem_avail_start.append(avail_s)
        mem_avail_end.append(avail_e)

        crash_cell = ""
        if r.crash_issues:
            names = ", ".join(c["proc"] + "(" + c["issue"] + ")" for c in r.crash_issues)
            crash_cell = f"<span class='failed'>{_html.escape(names)}</span>"
        else:
            crash_cell = "<span class='passed'>OK</span>"

        failed_steps = [s for s in r.steps if s.status == "failed"]
        failed_cell = "; ".join(_html.escape(s.name) for s in failed_steps[:5]) or "-"

        rel_report = Path(r.run_dir).name + "/report.html"
        cycle_rows.append(
            f"<tr><td>{i}</td><td><a href='{_html.escape(rel_report)}'>{_html.escape(Path(r.run_dir).name)}</a></td>"
            f"<td class='{r.status}'>{r.status}</td><td>{crash_cell}</td>"
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
def _write_summary_report(results: list, runs_dir: Path, total_sec: float) -> None:
    import base64
    import html as _html
    import time as _time

    if not results:
        return

    summary_id = _time.strftime("%Y%m%d-%H%M%S")
    out = runs_dir / f"summary-{summary_id}.html"

    total      = len(results)
    passed     = sum(1 for r in results if r.status == "passed")
    warned     = sum(1 for r in results if r.status == "warned")
    failed_c   = sum(1 for r in results if r.status == "failed")
    crash_count= sum(1 for r in results if r.crash_issues)
    pass_rate  = round(passed / total * 100, 1) if total else 0

    # ------------------------------------------------------------------
    # Memory series across all cycles
    # ------------------------------------------------------------------
    mem_cycle_labels: list[str] = []
    mem_avail_start:  list[float] = []
    mem_avail_end:    list[float] = []
    # fine-grained: every mem snapshot across all cycles in order
    all_mem_ts:    list[float] = []
    all_mem_avail: list[float] = []
    all_mem_used:  list[float] = []
    all_mem_xlabels: list[str] = []

    for i, r in enumerate(results, start=1):
        ms = r.mem_series
        if ms:
            avail_s = round(ms[0]["mem_available_kb"] / 1024, 1)
            avail_e = round(ms[-1]["mem_available_kb"] / 1024, 1)
        else:
            avail_s = avail_e = 0
        mem_cycle_labels.append(f"c{i}")
        mem_avail_start.append(avail_s)
        mem_avail_end.append(avail_e)
        for snap in ms:
            all_mem_ts.append(snap["ts"])
            all_mem_avail.append(round(snap["mem_available_kb"] / 1024, 1))
            all_mem_used.append(round(snap["mem_used_kb"] / 1024, 1))
            # X label: actual HH:MM:SS timestamp
            import datetime as _dt
            ts_label = _dt.datetime.fromtimestamp(snap["ts"]).strftime("%H:%M:%S")
            all_mem_xlabels.append(ts_label)

    # ------------------------------------------------------------------
    # Process PID comparison: first cycle start vs last cycle end
    # ------------------------------------------------------------------
    first_procs = results[0].proc_series[0]["procs"]  if results[0].proc_series else {}
    last_procs  = results[-1].proc_series[-1]["procs"] if results[-1].proc_series else {}
    all_proc_names = sorted(set(list(first_procs) + list(last_procs)))
    proc_rows = "".join(
        f"<tr><td>{_html.escape(n)}</td><td>{first_procs.get(n,'—')}</td><td>{last_procs.get(n,'—')}</td>"
        f"<td class='{'passed' if first_procs.get(n)==last_procs.get(n) else 'failed'}'>"
        f"{'OK' if first_procs.get(n)==last_procs.get(n) else 'CHANGED'}</td></tr>"
        for n in all_proc_names
    )

    # ------------------------------------------------------------------
    # Crash summary across all cycles
    # ------------------------------------------------------------------
    all_crashes: list[str] = []
    for i, r in enumerate(results, start=1):
        for c in r.crash_issues:
            all_crashes.append(f"Cycle {i}: {c['proc']} — {c['issue']} (PID {c.get('original_pid','')} → {c.get('new_pid','')})")
    crash_html = "".join(f"<li class='failed'>{_html.escape(s)}</li>" for s in all_crashes) if all_crashes else "<li class='passed'>No crashes detected</li>"

    # ------------------------------------------------------------------
    # Cycle table + failed step screenshots (base64 embedded)
    # ------------------------------------------------------------------
    def _img_b64(path_str: str) -> str:
        try:
            data = Path(path_str).read_bytes()
            return "data:image/png;base64," + base64.b64encode(data).decode()
        except Exception:
            return ""

    cycle_rows: list[str] = []
    for i, r in enumerate(results, start=1):
        ms = r.mem_series
        avail_s = round(ms[0]["mem_available_kb"] / 1024, 1) if ms else 0
        avail_e = round(ms[-1]["mem_available_kb"] / 1024, 1) if ms else 0
        delta   = round(avail_e - avail_s, 1)
        delta_cls = "failed" if delta < -5 else ("warned" if delta < 0 else "passed")

        crash_cell = ""
        if r.crash_issues:
            names = ", ".join(c["proc"] + "(" + c["issue"] + ")" for c in r.crash_issues)
            crash_cell = f"<span class='failed'>{_html.escape(names)}</span>"
        else:
            crash_cell = "<span class='passed'>OK</span>"

        failed_steps = [s for s in r.steps if s.status == "failed"]
        shot_cells = []
        for s in failed_steps[:3]:
            if s.screenshot:
                src = _img_b64(s.screenshot)
                if src:
                    shot_cells.append(f"<div style='font-size:11px;color:#c00'>{_html.escape(s.name)}</div>"
                                      f"<img src='{src}' style='max-width:300px;border:1px solid #c00'>")
        failed_cell = "<br>".join(_html.escape(s.name) for s in failed_steps) or "-"
        shots_html  = "".join(shot_cells) or "-"

        cycle_rows.append(
            f"<tr><td>{i}</td><td>{_html.escape(r.run_id)}</td>"
            f"<td class='{r.status}'>{r.status}</td>"
            f"<td>{crash_cell}</td>"
            f"<td>{avail_s} MB</td><td>{avail_e} MB</td>"
            f"<td class='{delta_cls}'>{'+' if delta>=0 else ''}{delta} MB</td>"
            f"<td>{failed_cell}</td>"
            f"<td>{shots_html}</td></tr>"
        )

    # JS data
    _js = json.dumps
    fine_avail_js  = _js(all_mem_avail)
    fine_used_js   = _js(all_mem_used)
    fine_xlabels_js= _js(all_mem_xlabels)
    cycle_avail_s_js = _js(mem_avail_start)
    cycle_avail_e_js = _js(mem_avail_end)
    cycle_labels_js  = _js(mem_cycle_labels)

    def _chart(canvas_id: str, labels_js: str, series: list[tuple[str, str, str]]) -> str:
        """series = [(js_data, color, label_text), ...]"""
        lines = []
        for data_js, color, lbl in series:
            lines.append(f"drawLine(ctx,{data_js},'{color}',false);")
        legend = "".join(
            f"ctx.fillStyle='{color}';ctx.fillRect(W-140,{8+12*k},14,4);"
            f"ctx.fillStyle='#333';ctx.fillText('{lbl}',W-122,{16+12*k});"
            for k,(_, color, lbl) in enumerate(series)
        )
        return f"""<canvas id="{canvas_id}" height="80"></canvas>
<script>
(function(){{
  var labels={labels_js};
  var c=document.getElementById('{canvas_id}');
  var ctx=c.getContext('2d');
  var W=c.offsetWidth||960,H=c.offsetHeight||160;
  c.width=W;c.height=H;
  var allVals=[].concat({''.join(d+',' for d,_,_ in series)});
  var maxV=Math.max.apply(null,allVals)||1;
  var minV=Math.min.apply(null,allVals);
  var pad={{l:60,r:150,t:20,b:30}};
  var w=W-pad.l-pad.r,h=H-pad.t-pad.b;
  var n=labels.length;
  function sx(i){{return pad.l+(n<2?w/2:i/(n-1)*w);}}
  function sy(v){{return pad.t+h-((v-minV)/((maxV-minV)||1))*h;}}
  ctx.strokeStyle='#eee';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){{var y=pad.t+g*h/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
    ctx.fillStyle='#888';ctx.font='11px sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(minV+(maxV-minV)*(1-g/4))+'MB',pad.l-4,y+4);}}
  function drawLine(ctx,data,color,dashed){{
    ctx.strokeStyle=color;ctx.lineWidth=2;
    if(dashed)ctx.setLineDash([4,3]);else ctx.setLineDash([]);
    ctx.beginPath();
    data.forEach(function(v,i){{i===0?ctx.moveTo(sx(i),sy(v)):ctx.lineTo(sx(i),sy(v));}});
    ctx.stroke();ctx.setLineDash([]);
  }}
  {''.join(lines)}
  var step=Math.max(1,Math.floor(n/16));
  ctx.fillStyle='#555';ctx.font='10px sans-serif';ctx.textAlign='center';
  labels.forEach(function(l,i){{if(i%step===0)ctx.fillText(l,sx(i),H-4);}});
  ctx.textAlign='left';ctx.font='11px sans-serif';
  {legend}
}})();
</script>"""

    fine_chart  = _chart("fineChart",  fine_xlabels_js,
                         [(fine_avail_js, "#1a7", "Available"), (fine_used_js, "#e44", "Used")])
    cycle_chart = _chart("cycleChart", cycle_labels_js,
                         [(cycle_avail_s_js, "#1a7", "Start avail"), (cycle_avail_e_js, "#e88", "End avail")])

    body = f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>DictPen Summary Report</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#fafafa}}
table{{border-collapse:collapse;width:100%;background:#fff;margin-bottom:16px}}
td,th{{border:1px solid #ddd;padding:6px 8px;vertical-align:top}}
th{{background:#f0f0f0}}
.passed{{color:#148a08;font-weight:700}}
.warned{{color:#b07800;font-weight:700}}
.failed{{color:#c00;font-weight:700}}
canvas{{max-width:960px;width:100%;background:#fff;border:1px solid #ddd;display:block;margin-bottom:24px}}
.stat{{display:inline-block;margin:8px 12px 8px 0;padding:10px 18px;border:1px solid #ddd;background:#fff;border-radius:6px;font-size:18px;min-width:120px}}
</style>
<h1>DictPen UI Long-Run Summary Report</h1>
<p>Generated: {_time.strftime('%Y-%m-%d %H:%M:%S')} &nbsp;&nbsp; Total runtime: <b>{round(total_sec/3600,2)} h</b>
 &nbsp;&nbsp; Test: {_html.escape(results[0].test_name)}</p>
<div>
  <div class='stat'>Cycles<br><b>{total}</b></div>
  <div class='stat passed'>Passed<br><b>{passed} ({pass_rate}%)</b></div>
  <div class='stat warned'>Warned<br><b>{warned}</b></div>
  <div class='stat failed'>Failed<br><b>{failed_c}</b></div>
  <div class='stat {'failed' if crash_count else 'passed'}'>Crash events<br><b>{crash_count}</b></div>
</div>

<h2>Memory — Fine-Grained (all steps)</h2>
{fine_chart}

<h2>Memory — Per-Cycle Available (MB)</h2>
{cycle_chart}

<h2>Process PID Check (first cycle start → last cycle end)</h2>
<table><tr><th>Process</th><th>Start PID</th><th>End PID</th><th>Status</th></tr>
{proc_rows}
</table>

<h2>Crash / Restart Events</h2>
<ul>{crash_html}</ul>

<h2>Device Crash Log (last run)</h2>
<pre style='background:#0a0a1a;color:#e94560;padding:10px;border-radius:6px;font-size:11px;max-height:300px;overflow-y:auto'>{_html.escape(results[-1].crash_log if results and results[-1].crash_log else 'No crash log entries.')}</pre>

<h2>Cycle Detail</h2>
<table>
<tr><th>#</th><th>Run ID</th><th>Status</th><th>Process</th><th>Mem Start</th><th>Mem End</th><th>Δ Mem</th><th>Failed Steps</th><th>Screenshots</th></tr>
{''.join(cycle_rows)}
</table>
</html>"""

    out.write_text(body, encoding="utf-8")
    print(json.dumps({"summary_report": str(out)}, ensure_ascii=False, indent=2))
