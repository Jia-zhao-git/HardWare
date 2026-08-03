from __future__ import annotations

import html
import json
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import json

from .adb import Adb
from .device import DictPenDevice
from .coordinates import CoordinateAdapter
from .input import InputDriver
from .monitor import DeviceMonitor
from .screenshot import ScreenshotDriver, files_differ, png_size, sha256_file
from .simple_yaml import dump_json, load_simple_yaml

# memory sample interval in seconds (0 = only at step boundaries)
MEM_SAMPLE_INTERVAL = 0  # sample on every step that has capture=


@dataclass
class StepResult:
    index: int
    name: str
    action: str
    status: str = "passed"
    message: str = ""
    screenshot: Optional[str] = None
    command: Optional[str] = None
    elapsed_ms: int = 0
    mem_available_kb: Optional[int] = None


@dataclass
class RunResult:
    run_id: str
    test_name: str
    status: str = "passed"
    device: dict[str, Any] = field(default_factory=dict)
    steps: list[StepResult] = field(default_factory=list)
    run_dir: str = ""
    mem_series: list[dict[str, Any]] = field(default_factory=list)
    proc_series: list[dict[str, Any]] = field(default_factory=list)
    cpu_series: list[dict[str, Any]] = field(default_factory=list)
    proc_mem_series: list[dict[str, Any]] = field(default_factory=list)
    crash_issues: list[dict[str, Any]] = field(default_factory=list)
    crash_log: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "test_name": self.test_name,
            "status": self.status,
            "device": self.device,
            "run_dir": self.run_dir,
            "steps": [s.__dict__ for s in self.steps],
            "mem_series": self.mem_series,
            "cpu_series": self.cpu_series,
            "proc_mem_series": self.proc_mem_series,
            "proc_series": self.proc_series,
            "crash_issues": self.crash_issues,
            "crash_log": self.crash_log,
        }


class TestRunner:
    def __init__(self, serial: str, root: Path, adb_path: str = "adb"):
        self.root = root
        self.adb = Adb(serial=serial, adb_path=adb_path)
        self.device = DictPenDevice(self.adb)
        self.info = self.device.read_info()
        self.coords = CoordinateAdapter.from_sku(self.info.sku, self._read_cfg_json())
        self.input = InputDriver(self.adb, self.coords)
        self.screenshot = ScreenshotDriver(self.adb)
        self.monitor = DeviceMonitor(self.adb)
        self.ui_map = self._load_ui_map()

    def _read_cfg_json(self) -> dict | None:
        """Read cfg.json from the device as a Python dict."""
        try:
            raw = self.adb.shell("cat /etc/miniapp/resources/cfg.json 2>/dev/null", timeout=10, check=False)
            return json.loads(raw)
        except Exception:
            return None

    def _load_ui_map(self) -> dict[str, Any]:
        candidates = []
        sku = (self.info.sku or "unknown").lower()
        if "y18" in sku:
            candidates.append(self.root / "ui-map" / "y18.yaml")
        candidates.append(self.root / "ui-map" / "default.yaml")
        for path in candidates:
            if path.exists():
                data = load_simple_yaml(path)
                return data or {}
        return {}

    def run_test(self, test_path: Path, runs_dir: Path) -> RunResult:
        spec = load_simple_yaml(test_path)
        run_id = time.strftime("%Y%m%d-%H%M%S")
        run_dir = runs_dir / run_id
        steps_dir = run_dir / "steps"
        logs_dir = run_dir / "logs"
        steps_dir.mkdir(parents=True, exist_ok=True)
        logs_dir.mkdir(parents=True, exist_ok=True)

        result = RunResult(run_id=run_id, test_name=spec.get("name", test_path.stem), device=self.info.to_dict(), run_dir=str(run_dir))
        dump_json(self.info.to_dict(), run_dir / "device-info.json")
        (logs_dir / "disk.txt").write_text(self.device.disk(), encoding="utf-8", errors="ignore")
        (logs_dir / "memory.txt").write_text(self.device.memory(), encoding="utf-8", errors="ignore")

        # --- initial snapshots ---
        self.monitor.mem_snapshots.clear()
        self.monitor.cpu_snapshots.clear()
        self.monitor.proc_mem_snapshots.clear()
        self.monitor.proc_snapshots.clear()
        self.monitor.snapshot_mem("start")
        self.monitor.snapshot_cpu("start")
        self.monitor.snapshot_proc_mem("start")
        self.monitor.snapshot_procs("start")

        captures: dict[str, Path] = {}
        stop_on_failure = spec.get("on_failure", {}).get("stop", True) if isinstance(spec.get("on_failure"), dict) else True

        for i, step in enumerate(spec.get("steps", []), start=1):
            step_result = self._run_step(i, step, steps_dir, captures)
            result.steps.append(step_result)
            if step_result.status == "failed":
                result.status = "failed"
                if stop_on_failure:
                    break
            elif step_result.status == "warned" and result.status == "passed":
                result.status = "warned"

        # --- final snapshots ---
        self.monitor.snapshot_mem("end")
        self.monitor.snapshot_cpu("end")
        self.monitor.snapshot_proc_mem("end")
        self.monitor.snapshot_procs("end")

        result.mem_series = self.monitor.mem_series()
        result.cpu_series = self.monitor.cpu_series()
        result.proc_mem_series = self.monitor.proc_mem_series()
        result.proc_series = self.monitor.proc_series()
        result.crash_issues = self.monitor.check_crashes()

        if result.crash_issues and result.status == "passed":
            result.status = "failed"

        # --- collect crash logs from device ---
        result.crash_log = self._collect_crash_log(logs_dir)

        # --- delete passed-step screenshots to save disk ---
        keep_failed_only = spec.get("keep_failed_screenshots_only", True)
        if keep_failed_only:
            for s in result.steps:
                if s.status == "passed" and s.screenshot:
                    try:
                        Path(s.screenshot).unlink(missing_ok=True)
                    except Exception:
                        pass

        dump_json(result.to_dict(), run_dir / "run.json")
        return result

    def _collect_crash_log(self, logs_dir: Path) -> str:
        """Pull new ERROR/crash lines from device system log."""
        candidates = [
            "grep -i 'crash\\|FATAL\\|segfault\\|OOM\\|panic\\|abort' /data/applog/YD_PEN_APP.log 2>/dev/null | tail -30",
            "grep -i 'crash\\|FATAL\\|segfault\\|OOM\\|panic' /data/syslog/messages 2>/dev/null | tail -30",
            "dmesg 2>/dev/null | grep -i 'crash\\|OOM\\|oom_kill\\|panic\\|segfault' | tail -20",
        ]
        crash_text = ""
        for cmd in candidates:
            out = self.adb.shell(cmd, timeout=15, check=False).strip()
            if out:
                crash_text += f"--- {cmd[:50]} ---\n{out}\n\n"
        if crash_text:
            (logs_dir / "crash.log").write_text(crash_text, encoding="utf-8", errors="ignore")
        return crash_text[:2000]  # truncate for JSON

    def _run_step(self, index: int, step: dict[str, Any], steps_dir: Path, captures: dict[str, Path]) -> StepResult:
        name = step.get("name", f"step-{index}")
        action = step.get("action", "")
        res = StepResult(index=index, name=name, action=action)
        start = time.time()
        try:
            if action == "press_key":
                key = step["key"]
                res.command = f"send_event {key} press/release"
                self.input.press_key(key, int(step.get("duration_ms", 120)))
            elif action == "tap":
                x, y = step.get("point", [step.get("x"), step.get("y")])
                res.command = f"tap {x} {y}"
                self.input.tap(int(x), int(y), int(step.get("duration_ms", 120)))
            elif action == "tap_ui":
                point = self._ui_point(step["page"], step["target"])
                res.command = f"tap_ui {step['page']}.{step['target']} -> {point}"
                self.input.tap(point[0], point[1], int(step.get("duration_ms", 120)))
            elif action == "swipe":
                frm = step["from"]
                to = step["to"]
                res.command = f"swipe {frm} {to}"
                self.input.swipe(int(frm[0]), int(frm[1]), int(to[0]), int(to[1]), int(step.get("duration_ms", 300)))
            elif action == "wait":
                time.sleep(float(step.get("seconds", step.get("wait", 1))))
            elif action == "screenshot":
                label = step.get("label", name)
                path = self._capture(index, label, steps_dir)
                captures[label] = path
                res.screenshot = str(path)
            elif action == "assert":
                self._assert_step(step, captures)
            elif action == "proc_snapshot":
                # Take an inline process snapshot mid-test to catch crashes per-app
                # Compare against the PREVIOUS snapshot (not the very first) to avoid
                # reporting old crashes repeatedly on every subsequent app.
                label = step.get("label", f"snap_{index}")
                self.monitor.snapshot_procs(label)
                # Only compare last two snapshots so each proc_snapshot is independent
                issues = []
                snaps = self.monitor.proc_snapshots
                if len(snaps) >= 2:
                    prev = snaps[-2]
                    curr = snaps[-1]
                    for pname, pid in prev.procs.items():
                        if pname not in curr.procs:
                            issues.append(f"{pname}(disappeared)")
                        elif curr.procs[pname] != pid:
                            issues.append(f"{pname}(restarted {pid}->{curr.procs[pname]})")
                if issues:
                    raise AssertionError(f"Process anomaly: {', '.join(issues)}")
            elif action == "random_tap":
                # Tap N times at random positions within the safe area
                count = int(step.get("count", step.get("n", 3)))
                ss_w, ss_h = self.coords.ss_w, self.coords.ss_h
                for _ in range(count):
                    sx = random.randint(ss_w // 5, ss_w * 4 // 5)
                    sy = random.randint(ss_h // 5, ss_h * 4 // 5)
                    self.input.tap(sx, sy, int(step.get("duration_ms", 100)))
                    time.sleep(random.uniform(0.2, 0.6))
                res.command = f"random_tap x{count} (screen {ss_w}x{ss_h})"
                if step.get("capture"):
                    path = self._capture(index, str(step.get("capture")), steps_dir)
                    captures[str(step.get("capture"))] = path
                    res.screenshot = str(path)
            elif action == "random_swipe":
                # Swipe in random directions N times
                count = int(step.get("count", step.get("n", 2)))
                dirs = ["up", "down", "left", "right"]
                for _ in range(count):
                    d = random.choice(dirs)
                    if d == "up":
                        self.input.swipe(self.coords.ss_w//2, self.coords.ss_h*3//4, self.coords.ss_w//2, self.coords.ss_h//4)
                    elif d == "down":
                        self.input.swipe(self.coords.ss_w//2, self.coords.ss_h//4, self.coords.ss_w//2, self.coords.ss_h*3//4)
                    elif d == "left":
                        self.input.swipe(self.coords.ss_w*3//4, self.coords.ss_h//2, self.coords.ss_w//4, self.coords.ss_h//2)
                    elif d == "right":
                        self.input.swipe(self.coords.ss_w//4, self.coords.ss_h//2, self.coords.ss_w*3//4, self.coords.ss_h//2)
                    time.sleep(random.uniform(0.3, 0.8))
                res.command = f"random_swipe x{count}"
                if step.get("capture"):
                    path = self._capture(index, str(step.get("capture")), steps_dir)
                    captures[str(step.get("capture"))] = path
                    res.screenshot = str(path)
            elif action == "long_press":
                # Long press at screenshot coordinates
                ss_w, ss_h = self.coords.ss_w, self.coords.ss_h
                sx = int(step.get("sx", random.randint(ss_w//5, ss_w*4//5)))
                sy = int(step.get("sy", random.randint(ss_h//5, ss_h*4//5)))
                ms = int(step.get("duration_ms", 800))
                p = self.coords.screenshot_to_touch(sx, sy)
                self.adb.shell(f"send_event touch press {p.x} {p.y}; sleep {ms/1000:.3f}; send_event touch release", timeout=10)
                res.command = f"long_press ({sx},{sy}) {ms}ms"
                if step.get("capture"):
                    path = self._capture(index, str(step.get("capture")), steps_dir)
                    captures[str(step.get("capture"))] = path
                    res.screenshot = str(path)
            elif action == "edge_swipe":
                # Swipe from screen edge (simulate pull-down status bar or edge gesture)
                edge = step.get("edge", random.choice(["top", "bottom", "left", "right"]))
                ss_w, ss_h = self.coords.ss_w, self.coords.ss_h
                if edge == "top":
                    self.input.swipe(ss_w//2, ss_h//10, ss_w//2, ss_h//2)
                elif edge == "bottom":
                    self.input.swipe(ss_w//2, ss_h*9//10, ss_w//2, ss_h//2)
                elif edge == "left":
                    self.input.swipe(ss_w//10, ss_h//2, ss_w*3//4, ss_h//2)
                elif edge == "right":
                    self.input.swipe(ss_w*9//10, ss_h//2, ss_w//4, ss_h//2)
                res.command = f"edge_swipe {edge}"
                time.sleep(float(step.get("wait", 0.8)))
                if step.get("capture"):
                    path = self._capture(index, str(step.get("capture")), steps_dir)
                    captures[str(step.get("capture"))] = path
                    res.screenshot = str(path)
            elif action == "shuffle":
                # Do a random mix of operations: scroll+swipe+tap+long_press
                ss_w, ss_h = self.coords.ss_w, self.coords.ss_h
                ops_done = 0
                commands = []
                for _ in range(int(step.get("n", 5))):
                    op = random.choice(["tap", "swipe", "long_press"])
                    if op == "tap":
                        sx = random.randint(ss_w//5, ss_w*4//5)
                        sy = random.randint(ss_h//5, ss_h*4//5)
                        self.input.tap(sx, sy, random.randint(60, 200))
                        commands.append(f"tap({sx},{sy})")
                        ops_done += 1
                    elif op == "swipe":
                        d = random.choice(["up","down","left","right"])
                        if d == "up":    self.input.swipe(ss_w//2,ss_h*3//4, ss_w//2,ss_h//4)
                        elif d == "down":  self.input.swipe(ss_w//2,ss_h//4, ss_w//2,ss_h*3//4)
                        elif d == "left": self.input.swipe(ss_w*3//4,ss_h//2, ss_w//4,ss_h//2)
                        elif d == "right":self.input.swipe(ss_w//4,ss_h//2, ss_w*3//4,ss_h//2)
                        commands.append(f"swipe_{d}")
                        ops_done += 1
                    elif op == "long_press":
                        sx = random.randint(ss_w//5, ss_w*4//5)
                        sy = random.randint(ss_h//5, ss_h*4//5)
                        ms = random.randint(400, 1200)
                        p = self.coords.screenshot_to_touch(sx, sy)
                        self.adb.shell(f"send_event touch press {p.x} {p.y}; sleep {ms/1000:.3f}; send_event touch release", timeout=10)
                        commands.append(f"long_press({sx},{sy},{ms}ms)")
                        ops_done += 1
                    time.sleep(random.uniform(0.3, 0.7))
                res.command = f"shuffle({ops_done}): " + ", ".join(commands)
                if step.get("capture"):
                    path = self._capture(index, str(step.get("capture")), steps_dir)
                    captures[str(step.get("capture"))] = path
                    res.screenshot = str(path)
            elif action == "shell":
                cmd = step["command"]
                res.command = cmd
                out = self.adb.shell(cmd, timeout=int(step.get("timeout", 30)), check=False)
                label = step.get("save_as", f"{index:03d}_shell.txt")
                out_path = steps_dir / label
                out_path.write_text(out, encoding="utf-8", errors="ignore")
            else:
                raise ValueError(f"Unsupported action: {action}")

            if "wait" in step and action != "wait":
                time.sleep(float(step["wait"]))
            if step.get("capture"):
                label = str(step.get("capture"))
                path = self._capture(index, label, steps_dir)
                captures[label] = path
                res.screenshot = str(path)
                # sample memory + cpu after every capture step
                snap = self.monitor.snapshot_mem(label)
                self.monitor.snapshot_cpu(label)
                self.monitor.snapshot_proc_mem(label)
                res.mem_available_kb = snap.mem_available_kb

        except Exception as exc:
            msg = str(exc)
            if msg.startswith("[warn] "):
                res.status = "warned"
                res.message = msg[7:]
            else:
                res.status = "failed"
                res.message = msg
            try:
                path = self._capture(index, f"failure_{name}", steps_dir)
                res.screenshot = str(path)
            except Exception:
                pass
        finally:
            res.elapsed_ms = int((time.time() - start) * 1000)
        return res

    def _capture(self, index: int, label: str, steps_dir: Path) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
        path = steps_dir / f"{index:03d}_{safe}.png"
        return self.screenshot.capture(path)

    def _ui_point(self, page: str, target: str) -> list[int]:
        try:
            point = self.ui_map["pages"][page]["entries"][target]["point"]
            if len(point) != 2:
                raise ValueError
            return [int(point[0]), int(point[1])]
        except Exception as exc:
            raise KeyError(f"UI target not found in ui-map: {page}.{target}") from exc

    def _assert_step(self, step: dict[str, Any], captures: dict[str, Path]) -> None:
        warn_only = step.get("warn_only", False)

        def _fail(msg: str) -> None:
            if warn_only:
                raise AssertionError("[warn] " + msg)
            raise AssertionError(msg)

        # --- screen changed ---
        if "screen_changed_from" in step:
            before_key = step["screen_changed_from"]
            if before_key not in captures:
                raise AssertionError(f"Capture not found: {before_key}")
            before = captures[before_key]
            current_label = step.get("current")
            if current_label:
                if current_label not in captures:
                    raise AssertionError(f"Capture not found: {current_label}")
                current = captures[current_label]
            else:
                current = self._capture(step.get("index", 999), "assert_current", before.parent)
                captures["_assert_current_"] = current
            if not files_differ(before, current):
                _fail(f"Screen did not change: {before_key} -> {current_label or 'live'} (same hash)")

        # --- screenshot not blank (file size lower bound) ---
        if "capture_not_blank" in step:
            cap_key = step["capture_not_blank"]
            min_kb  = int(step.get("min_kb", 5))
            if cap_key not in captures:
                raise AssertionError(f"Capture not found: {cap_key}")
            size_kb = captures[cap_key].stat().st_size / 1024
            if size_kb < min_kb:
                _fail(f"Screenshot too small ({size_kb:.1f} KB < {min_kb} KB), likely blank/black screen: {cap_key}")

        # --- proc still alive ---
        if step.get("proc_alive"):
            raw = self.adb.shell("ps", check=False)
            pids = {p.split()[-1].split("/")[-1]: int(p.split()[0])
                    for p in raw.splitlines() if len(p.split()) >= 2 and p.split()[0].isdigit()}
            for proc_name in step["proc_alive"] if isinstance(step["proc_alive"], list) else [step["proc_alive"]]:
                alive = any(proc_name in cmd for cmd in pids)
                if not alive:
                    _fail(f"Process not alive: {proc_name}")

        # --- memory delta (MB) ---
        if "mem_delta_ok" in step:
            series = self.monitor.mem_series()
            if len(series) >= 2:
                before_avail = series[0]["mem_available_kb"]
                now_avail    = series[-1]["mem_available_kb"]
                delta_mb     = (now_avail - before_avail) / 1024
                threshold_mb = float(step.get("mem_delta_ok", -20))
                if delta_mb < threshold_mb:
                    _fail(f"Memory drop too large: {delta_mb:.1f} MB (threshold {threshold_mb} MB)")

        # --- file exists ---
        if "file_exists" in step:
            if not Path(step["file_exists"]).exists():
                raise AssertionError(f"File does not exist: {step['file_exists']}")

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------

    def _write_report(self, result: RunResult, path: Path) -> None:
        rows = []
        for s in result.steps:
            shot = ""
            if s.screenshot:
                try:
                    rel = Path(s.screenshot).relative_to(path.parent).as_posix()
                    shot = f'<a href="{html.escape(rel)}">截图</a><br><img src="{html.escape(rel)}" style="max-width:480px;border:1px solid #ddd">'
                except ValueError:
                    shot = s.screenshot
            mem_cell = f"{s.mem_available_kb // 1024} MB" if s.mem_available_kb else ""
            rows.append(
                "<tr>"
                f"<td>{s.index}</td><td>{html.escape(s.name)}</td><td>{html.escape(s.action)}</td>"
                f"<td class='{s.status}'>{s.status}</td><td>{html.escape(s.message)}</td>"
                f"<td><code style='white-space:pre-wrap;font-size:11px'>{html.escape(s.command or '')}</code></td>"
                f"<td>{s.elapsed_ms}</td><td>{mem_cell}</td><td>{shot}</td>"
                "</tr>"
            )

        # memory chart data
        mem_labels = json.dumps([s["label"] for s in result.mem_series])
        mem_avail  = json.dumps([round(s["mem_available_kb"] / 1024, 1) for s in result.mem_series])
        mem_used   = json.dumps([round(s["mem_used_kb"] / 1024, 1) for s in result.mem_series])

        # crash table
        if result.crash_issues:
            crash_rows = "".join(
                f"<tr><td>{html.escape(c['proc'])}</td><td class='failed'>{html.escape(c['issue'])}</td>"
                f"<td>{c.get('original_pid','')}</td><td>{c.get('new_pid','')}</td></tr>"
                for c in result.crash_issues
            )
            crash_section = f"""
<h2 style='color:#c00'>Process Anomalies (Crash / Restart)</h2>
<table><tr><th>Process</th><th>Issue</th><th>Original PID</th><th>New PID</th></tr>{crash_rows}</table>"""
        else:
            crash_section = "<h2 style='color:#148a08'>Process Check: All OK</h2><p>No process restarts or disappearances detected.</p>"

        # proc table (start vs end)
        start_procs = result.proc_series[0]["procs"] if result.proc_series else {}
        end_procs   = result.proc_series[-1]["procs"] if len(result.proc_series) > 1 else {}
        all_names   = sorted(set(list(start_procs) + list(end_procs)))
        proc_rows   = "".join(
            f"<tr><td>{html.escape(n)}</td><td>{start_procs.get(n,'—')}</td><td>{end_procs.get(n,'—')}</td>"
            f"<td class='{'passed' if start_procs.get(n)==end_procs.get(n) else 'failed'}'>"
            f"{'OK' if start_procs.get(n)==end_procs.get(n) else 'CHANGED'}</td></tr>"
            for n in all_names
        )
        proc_section = f"<table><tr><th>Process</th><th>Start PID</th><th>End PID</th><th>Status</th></tr>{proc_rows}</table>"

        body = f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>{html.escape(result.test_name)}</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#fafafa}}
table{{border-collapse:collapse;width:100%;background:#fff;margin-bottom:16px}}
td,th{{border:1px solid #ddd;padding:6px 8px;vertical-align:top}}
th{{background:#f0f0f0}}
.passed{{color:#148a08;font-weight:700}}
.warned{{color:#b07800;font-weight:700}}
.failed{{color:#c00;font-weight:700}}
canvas{{max-width:960px;width:100%;background:#fff;border:1px solid #ddd;display:block;margin-bottom:24px}}
h2{{margin-top:32px}}
</style>
<h1>DictPen UI Test Report</h1>
<p><b>Test:</b> {html.escape(result.test_name)}
&nbsp; <b>Status:</b> <span class="{result.status}">{result.status.upper()}</span>
&nbsp; <b>Run:</b> {html.escape(result.run_id)}</p>

<h2>Device</h2>
<pre style="background:#fff;border:1px solid #ddd;padding:8px;overflow:auto">{html.escape(json.dumps(result.device, ensure_ascii=False, indent=2))}</pre>

{crash_section}

<h2>Process PID Comparison</h2>
{proc_section}

<h2>Memory Available (MB)</h2>
<canvas id="memChart" height="80"></canvas>

<script>
(function(){{
  var labels={mem_labels};
  var avail={mem_avail};
  var used={mem_used};
  var c=document.getElementById('memChart');
  var ctx=c.getContext('2d');
  var W=c.offsetWidth||960,H=c.offsetHeight||160;
  c.width=W;c.height=H;
  var n=avail.length;
  if(n<2){{ctx.fillText('Not enough data',10,20);return;}}
  var maxV=Math.max.apply(null,avail.concat(used))||1;
  var pad={{l:60,r:20,t:20,b:40}};
  var w=W-pad.l-pad.r,h=H-pad.t-pad.b;
  function sx(i){{return pad.l+i/(n-1)*w;}}
  function sy(v){{return pad.t+h-(v/maxV)*h;}}
  // grid
  ctx.strokeStyle='#eee';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){{var y=pad.t+g*h/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
    ctx.fillStyle='#888';ctx.font='11px sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(maxV*(1-g/4))+'MB',pad.l-4,y+4);}}
  // available line
  ctx.strokeStyle='#1a7';ctx.lineWidth=2;ctx.beginPath();
  avail.forEach(function(v,i){{i===0?ctx.moveTo(sx(i),sy(v)):ctx.lineTo(sx(i),sy(v));}});
  ctx.stroke();
  // used line
  ctx.strokeStyle='#e44';ctx.lineWidth=2;ctx.beginPath();
  used.forEach(function(v,i){{i===0?ctx.moveTo(sx(i),sy(v)):ctx.lineTo(sx(i),sy(v));}});
  ctx.stroke();
  // dots + labels
  avail.forEach(function(v,i){{
    ctx.fillStyle='#1a7';ctx.beginPath();ctx.arc(sx(i),sy(v),3,0,Math.PI*2);ctx.fill();
  }});
  // x labels (sample every N)
  var step=Math.max(1,Math.floor(n/12));
  ctx.fillStyle='#555';ctx.font='10px sans-serif';ctx.textAlign='center';
  labels.forEach(function(l,i){{if(i%step===0){{
    ctx.fillText(l.substring(0,12),sx(i),H-6);
  }}}});
  // legend
  ctx.fillStyle='#1a7';ctx.fillRect(W-120,8,14,4);ctx.fillStyle='#333';ctx.textAlign='left';ctx.fillText('Available',W-102,16);
  ctx.fillStyle='#e44';ctx.fillRect(W-120,18,14,4);ctx.fillStyle='#333';ctx.fillText('Used',W-102,26);
}})();
</script>

<h2>Steps ({len(result.steps)} total)</h2>
<table>
<tr><th>#</th><th>Name</th><th>Action</th><th>Status</th><th>Message</th><th>Command</th><th>ms</th><th>Mem Avail</th><th>Screenshot</th></tr>
{''.join(rows)}
</table>
</html>"""
        path.write_text(body, encoding="utf-8")
