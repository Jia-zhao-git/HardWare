"""
DictPen UI Test Dashboard
Usage: python dashboard.py [--runs-dir path] [--port 8080]
Opens browser to http://localhost:<port>/
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

RUNS_DIR = Path(__file__).parent / "runs"


# ---------------------------------------------------------------------------
# HTML Templates (all in-memory, no files)
# ---------------------------------------------------------------------------

DASHBOARD_HTML = r"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>DictPen Test Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh}
header{background:linear-gradient(135deg,#16213e,#0f3460);padding:16px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 8px #0008}
header h1{font-size:20px;color:#e94560;letter-spacing:1px}
header .sub{font-size:13px;color:#888;margin-top:2px}
nav{background:#16213e;padding:0 24px;display:flex;gap:0;border-bottom:1px solid #0f3460}
nav button{background:none;border:none;color:#aaa;padding:12px 20px;cursor:pointer;font-size:14px;border-bottom:3px solid transparent;transition:.2s}
nav button.active,nav button:hover{color:#e94560;border-bottom-color:#e94560}
main{padding:24px;max-width:1400px}
.card{background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:20px;margin-bottom:20px}
.card h2{font-size:15px;color:#e94560;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.stat-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.stat{background:#0f3460;border-radius:8px;padding:14px 20px;min-width:140px;text-align:center}
.stat .val{font-size:28px;font-weight:700;margin-bottom:4px}
.stat .lbl{font-size:12px;color:#888}
.passed{color:#00d084}
.warned{color:#ffb700}
.failed{color:#e94560}
canvas{width:100%;background:#0a0a1a;border-radius:6px;display:block;margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#0f3460;color:#aaa;padding:8px 10px;text-align:left;font-weight:600;position:sticky;top:0}
td{padding:7px 10px;border-bottom:1px solid #0f346044;vertical-align:top}
tr:hover td{background:#0f346033}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700}
.badge.passed{background:#00d08422;color:#00d084;border:1px solid #00d084}
.badge.warned{background:#ffb70022;color:#ffb700;border:1px solid #ffb700}
.badge.failed{background:#e9456022;color:#e94560;border:1px solid #e94560}
.run-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #0f3460;border-radius:6px;margin-bottom:8px;cursor:pointer;transition:.2s}
.run-item:hover{background:#0f346044;border-color:#e94560}
.run-item.selected{background:#0f346066;border-color:#e94560}
.run-id{font-family:monospace;font-size:12px;color:#888}
.screenshot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:8px}
.screenshot-item{background:#0a0a1a;border-radius:6px;overflow:hidden;border:1px solid #0f3460}
.screenshot-item img{width:100%;display:block}
.screenshot-item .cap{padding:6px 8px;font-size:11px;color:#888}
.screenshot-item.failed-step{border-color:#e94560}
.screenshot-item .cap.failed{color:#e94560}
.proc-table{font-size:12px}
#loading{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:1px solid #e94560;border-radius:8px;padding:24px 40px;color:#e94560;font-size:16px;display:none}
</style>
</head><body>
<header>
  <div>
    <h1>🔬 DictPen Test Dashboard</h1>
    <div class="sub" id="sub">Loading...</div>
  </div>
  <button onclick="refreshAll()" style="margin-left:auto;background:#e94560;border:none;color:#fff;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:13px">↻ Refresh</button>
</header>
<nav>
  <button class="active" onclick="switchTab('overview',this)">Overview</button>
  <button onclick="switchTab('runs',this)">Runs</button>
  <button onclick="switchTab('memory',this)">Memory</button>
  <button onclick="switchTab('cpu',this)">CPU</button>
  <button onclick="switchTab('processes',this)">Processes</button>
  <button onclick="switchTab('failures',this)">Failures</button>
</nav>
<main id="app"><div id="loading">Loading...</div></main>
<div id="loading">Loading data...</div>

<script>
var G = {runs:[],selected:null,tab:'overview'};

function api(path,cb){
  fetch(path).then(r=>r.json()).then(cb).catch(e=>console.error(e));
}

function switchTab(name,btn){
  G.tab=name;
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  render();
}

function refreshAll(){
  api('/api/runs',function(data){
    G.runs=data.runs||[];
    if(!G.selected&&G.runs.length>0)G.selected=G.runs[0].run_id;
    render();
    document.getElementById('sub').textContent=
      'Runs dir: '+data.runs_dir+' | '+G.runs.length+' runs | Last updated: '+(new Date()).toLocaleTimeString();
  });
}

function render(){
  var app=document.getElementById('app');
  if(G.tab==='overview')app.innerHTML=renderOverview();
  else if(G.tab==='runs')app.innerHTML=renderRuns();
  else if(G.tab==='memory')app.innerHTML=renderMemory();
  else if(G.tab==='cpu')app.innerHTML=renderCpu();
  else if(G.tab==='processes')app.innerHTML=renderProcesses();
  else if(G.tab==='failures')app.innerHTML=renderFailures();
  requestAnimationFrame(drawCharts);
}

// ---------- Overview ----------
function renderOverview(){
  if(!G.runs.length) return '<div class="card"><h2>No runs found</h2><p style="color:#888">Run a test first.</p></div>';
  var total=G.runs.length;
  var passed=G.runs.filter(r=>r.status==='passed').length;
  var warned=G.runs.filter(r=>r.status==='warned').length;
  var failed=G.runs.filter(r=>r.status==='failed').length;
  var crashes=G.runs.reduce(function(a,r){return a+(r.crash_count||0);},0);
  var passRate=total?Math.round(passed/total*100):0;
  var html='<div class="stat-row">'
    +'<div class="stat"><div class="val">'+total+'</div><div class="lbl">Total Cycles</div></div>'
    +'<div class="stat"><div class="val passed">'+passed+'</div><div class="lbl">Passed ('+passRate+'%)</div></div>'
    +'<div class="stat"><div class="val warned">'+warned+'</div><div class="lbl">Warned</div></div>'
    +'<div class="stat"><div class="val failed">'+failed+'</div><div class="lbl">Failed</div></div>'
    +'<div class="stat"><div class="val '+(crashes?'failed':'passed')+'">'+crashes+'</div><div class="lbl">Crash Events</div></div>'
    +'</div>';
  html+='<div class="card"><h2>📈 Pass Rate per Cycle</h2><canvas id="passChart" height="60"></canvas></div>';
  html+='<div class="card"><h2>🧠 Memory Available (last 20 cycles)</h2><canvas id="memOverviewChart" height="60"></canvas></div>';
  html+='<div class="card"><h2>⚡ CPU Idle % (last 20 cycles)</h2><canvas id="cpuOverviewChart" height="60"></canvas></div>';
  return html;
}

// ---------- Runs ----------
function renderRuns(){
  var html='<div class="card"><h2>All Cycles</h2>';
  html+='<div style="max-height:600px;overflow-y:auto">';
  G.runs.slice().reverse().forEach(function(r){
    var sel=G.selected===r.run_id?' selected':'';
    html+='<div class="run-item'+sel+'" onclick="selectRun(\''+r.run_id+'\')">'
      +'<span class="badge '+r.status+'">'+r.status.toUpperCase()+'</span>'
      +'<span class="run-id">'+r.run_id+'</span>'
      +'<span style="font-size:12px;color:#888">'+r.step_count+' steps</span>'
      +(r.crash_count?'<span class="badge failed">'+r.crash_count+' crash</span>':'')
      +'<span style="margin-left:auto;font-size:12px;color:#888">Mem: '+(r.mem_start_mb||'?')+'→'+(r.mem_end_mb||'?')+' MB</span>'
      +'</div>';
  });
  html+='</div></div>';
  if(G.selected){
    var r=G.runs.find(function(x){return x.run_id===G.selected;});
    if(r){
      html+='<div class="card"><h2>Steps: '+r.run_id+'</h2><div style="overflow-x:auto"><table>'
        +'<tr><th>#</th><th>Name</th><th>Action</th><th>Status</th><th>Mem Avail</th><th>Message</th></tr>';
      (r.steps||[]).forEach(function(s){
        html+='<tr><td>'+s.index+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.action)+'</td>'
          +'<td><span class="badge '+s.status+'">'+s.status+'</span></td>'
          +'<td>'+(s.mem_available_kb?Math.round(s.mem_available_kb/1024)+' MB':'')+'</td>'
          +'<td style="color:#e94560;font-size:12px">'+esc(s.message||'')+'</td></tr>';
      });
      html+='</table></div></div>';
    }
  }
  return html;
}

function selectRun(id){G.selected=id;render();}

// ---------- Memory ----------
function renderMemory(){
  return '<div class="card"><h2>🧠 Memory Available (MB) — All Cycles</h2><canvas id="memFineChart" height="80"></canvas></div>'
    +'<div class="card"><h2>💾 Swap Used (MB) — All Cycles</h2><canvas id="swapChart" height="60"></canvas></div>'
    +'<div class="card"><h2>📊 Per-Process VSZ (MB)</h2><canvas id="procMemChart" height="80"></canvas></div>';
}

// ---------- CPU ----------
function renderCpu(){
  return '<div class="card"><h2>⚡ CPU Idle % (All Cycles)</h2><canvas id="cpuIdleChart" height="70"></canvas></div>'
    +'<div class="card"><h2>🔥 Load Average 1min (All Cycles)</h2><canvas id="loadChart" height="60"></canvas></div>';
}

// ---------- Processes ----------
function renderProcesses(){
  if(!G.runs.length)return '<div class="card"><h2>No data</h2></div>';
  var first=G.runs[0], last=G.runs[G.runs.length-1];
  var fp=first.first_procs||{}, lp=last.last_procs||{};
  var names=Object.keys(Object.assign({},fp,lp));
  var html='<div class="card"><h2>🔍 Process PID: First Cycle Start → Last Cycle End</h2><table class="proc-table">'
    +'<tr><th>Process</th><th>Start PID</th><th>End PID</th><th>Status</th></tr>';
  names.forEach(function(n){
    var ok=fp[n]===lp[n];
    html+='<tr><td>'+esc(n)+'</td><td>'+( fp[n]||'—')+'</td><td>'+(lp[n]||'—')+'</td>'
      +'<td><span class="badge '+(ok?'passed':'failed')+'">'+(ok?'OK':'CHANGED')+'</span></td></tr>';
  });
  html+='</table></div>';

  var allCrashes=[];
  G.runs.forEach(function(r,i){(r.crash_issues||[]).forEach(function(c){allCrashes.push('Cycle '+(i+1)+': '+c.proc+' – '+c.issue);});});
  html+='<div class="card"><h2>💥 Crash Events ('+allCrashes.length+')</h2>';
  if(allCrashes.length){
    html+='<ul style="padding-left:20px">';
    allCrashes.forEach(function(c){html+='<li class="failed" style="margin:4px 0">'+esc(c)+'</li>';});
    html+='</ul>';
  }else html+='<p class="passed">No crash events detected.</p>';
  html+='</div>';
  return html;
}

// ---------- Failures ----------
function renderFailures(){
  var html='<div class="card"><h2>❌ Failed Steps (with Screenshots)</h2>';
  var found=false;
  G.runs.forEach(function(r,ri){
    var fails=(r.steps||[]).filter(function(s){return s.status==='failed'&&s.screenshot;});
    if(!fails.length)return;
    found=true;
    html+='<h3 style="color:#e94560;font-size:13px;margin:12px 0 8px">Cycle '+(ri+1)+': '+r.run_id+'</h3>';
    html+='<div class="screenshot-grid">';
    fails.forEach(function(s){
      html+='<div class="screenshot-item failed-step">'
        +'<img src="/api/screenshot?path='+encodeURIComponent(s.screenshot)+'" loading="lazy" onerror="this.style.display=\'none\'">'
        +'<div class="cap failed">'+esc(s.name)+'</div>'
        +'</div>';
    });
    html+='</div>';
  });
  if(!found)html+='<p class="passed">No failed steps with screenshots.</p>';
  html+='</div>';
  return html;
}

// ---------- Chart drawing ----------
function drawCharts(){
  if(G.tab==='overview'){
    drawLineChart('passChart', G.runs.map(function(r,i){return 'c'+(i+1);}),
      [{data:G.runs.map(function(r){return r.status==='passed'?100:r.status==='warned'?50:0;}),color:'#00d084',label:'Pass %'}], {min:0,max:100});
    var last20=G.runs.slice(-20);
    drawLineChart('memOverviewChart', last20.map(function(r,i){return 'c'+(i+1);}),
      [{data:last20.map(function(r){return r.mem_start_mb||0;}),color:'#e94560',label:'Mem Avail MB'}]);
    drawLineChart('cpuOverviewChart', last20.map(function(r,i){return 'c'+(i+1);}),
      [{data:last20.map(function(r){return r.cpu_idle_avg||0;}),color:'#4fc3f7',label:'CPU Idle %'}]);
  } else if(G.tab==='memory'){
    var allMem=[]; var allSwap=[]; var labels=[];
    G.runs.forEach(function(r,ri){
      (r.mem_series||[]).forEach(function(s){
        labels.push('c'+(ri+1)+'/'+s.label.substring(0,6));
        allMem.push(Math.round(s.mem_available_kb/1024));
        allSwap.push(Math.round(s.swap_used_kb/1024));
      });
    });
    drawLineChart('memFineChart',labels,[{data:allMem,color:'#00d084',label:'Avail MB'},{data:allMem.map(function(v,i){return Math.round((G.runs[0]&&G.runs[0].mem_series[0]?G.runs[0].mem_series[0].mem_total_kb:270588)/1024)-allMem[i];}) ,color:'#e94560',label:'Used MB'}]);
    drawLineChart('swapChart',labels,[{data:allSwap,color:'#ffb700',label:'Swap Used MB'}]);
    // proc mem
    var procNames={};
    G.runs.forEach(function(r){(r.proc_mem_series||[]).forEach(function(s){Object.keys(s.procs||{}).forEach(function(n){procNames[n]=1;});});});
    var pnames=Object.keys(procNames).slice(0,6);
    var colors=['#e94560','#00d084','#4fc3f7','#ffb700','#9c27b0','#ff5722'];
    var pmLabels=[];
    G.runs.forEach(function(r,ri){(r.proc_mem_series||[]).forEach(function(s){pmLabels.push('c'+(ri+1));});});
    var pmSeries=pnames.map(function(n,i){
      var d=[];
      G.runs.forEach(function(r){(r.proc_mem_series||[]).forEach(function(s){d.push(Math.round((s.procs[n]||0)/1024));});});
      return{data:d,color:colors[i%colors.length],label:n};
    });
    if(pmSeries.length)drawLineChart('procMemChart',pmLabels,pmSeries);
  } else if(G.tab==='cpu'){
    var cpuLabels=[]; var idle=[]; var load1=[];
    G.runs.forEach(function(r,ri){
      (r.cpu_series||[]).forEach(function(s){
        cpuLabels.push('c'+(ri+1)+'/'+s.label.substring(0,6));
        idle.push(s.idle);
        load1.push(s.load1);
      });
    });
    drawLineChart('cpuIdleChart',cpuLabels,[{data:idle,color:'#4fc3f7',label:'Idle %'}],{min:0,max:100});
    drawLineChart('loadChart',cpuLabels,[{data:load1,color:'#ffb700',label:'Load 1min'}]);
  }
}

function drawLineChart(id,labels,series,opts){
  var canvas=document.getElementById(id);
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var W=canvas.offsetWidth||900, H=canvas.offsetHeight||140;
  canvas.width=W; canvas.height=H;
  ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,W,H);
  if(!labels.length)return;
  var allVals=series.reduce(function(a,s){return a.concat(s.data);},[]);
  var minV=opts&&opts.min!=null?opts.min:Math.min.apply(null,allVals);
  var maxV=opts&&opts.max!=null?opts.max:Math.max.apply(null,allVals)||1;
  if(maxV===minV)maxV=minV+1;
  var pad={l:52,r:120,t:14,b:26};
  var w=W-pad.l-pad.r, h=H-pad.t-pad.b;
  var n=labels.length;
  function sx(i){return pad.l+(n<2?w/2:i/(n-1)*w);}
  function sy(v){return pad.t+h-((v-minV)/(maxV-minV))*h;}
  // grid
  ctx.strokeStyle='#0f3460'; ctx.lineWidth=1;
  for(var g=0;g<=4;g++){
    var y=pad.t+g*h/4;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
    ctx.fillStyle='#556';ctx.font='10px sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(minV+(maxV-minV)*(1-g/4)),pad.l-4,y+4);
  }
  // x labels
  var step=Math.max(1,Math.floor(n/14));
  ctx.fillStyle='#556';ctx.font='10px sans-serif';ctx.textAlign='center';
  labels.forEach(function(l,i){if(i%step===0)ctx.fillText(l.substring(0,10),sx(i),H-4);});
  // lines
  series.forEach(function(s,si){
    ctx.strokeStyle=s.color; ctx.lineWidth=2; ctx.beginPath();
    s.data.forEach(function(v,i){
      var x=sx(i),y=sy(v);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();
    // legend
    ctx.fillStyle=s.color; ctx.fillRect(W-115,10+si*16,12,3);
    ctx.fillStyle='#aaa';ctx.textAlign='left';ctx.font='11px sans-serif';
    ctx.fillText(s.label.substring(0,14),W-99,16+si*16);
  });
}

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Auto-refresh every 15s
refreshAll();
setInterval(refreshAll, 15000);
</script>
</body></html>"""


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    runs_dir: Path = RUNS_DIR

    def log_message(self, fmt, *args):
        pass  # silence request logs

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path

        if path == "/" or path == "/index.html":
            self._send(200, "text/html; charset=utf-8", DASHBOARD_HTML.encode("utf-8"))

        elif path == "/api/runs":
            self._send(200, "application/json", self._api_runs())

        elif path == "/api/screenshot":
            qs   = parse_qs(parsed.query)
            fpath = Path(qs.get("path", [""])[0])
            if fpath.exists() and fpath.suffix == ".png":
                self._send(200, "image/png", fpath.read_bytes())
            else:
                self._send(404, "text/plain", b"not found")
        else:
            self._send(404, "text/plain", b"not found")

    def _send(self, code: int, ct: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _api_runs(self) -> bytes:
        runs_dir = self.runs_dir
        run_dirs = sorted(
            (d for d in runs_dir.iterdir() if d.is_dir() and (d / "run.json").exists()),
            key=lambda d: d.name,
        )
        runs = []
        for rd in run_dirs:
            try:
                d = json.loads((rd / "run.json").read_text(encoding="utf-8", errors="replace"))
                r: dict = {
                    "run_id":    d.get("run_id", rd.name),
                    "status":    d.get("status", "unknown"),
                    "step_count": len(d.get("steps", [])),
                    "crash_count": len(d.get("crash_issues", [])),
                    "crash_issues": d.get("crash_issues", []),
                    "first_procs": d.get("proc_series", [{}])[0].get("procs", {}) if d.get("proc_series") else {},
                    "last_procs":  d.get("proc_series", [{}])[-1].get("procs", {}) if d.get("proc_series") else {},
                    "mem_series":  d.get("mem_series", []),
                    "cpu_series":  d.get("cpu_series", []),
                    "proc_mem_series": d.get("proc_mem_series", []),
                    "steps": [
                        {k: v for k, v in s.items() if k != "command"}
                        for s in d.get("steps", [])
                    ],
                }
                ms = d.get("mem_series", [])
                if ms:
                    r["mem_start_mb"] = round(ms[0]["mem_available_kb"] / 1024)
                    r["mem_end_mb"]   = round(ms[-1]["mem_available_kb"] / 1024)
                cs = d.get("cpu_series", [])
                if cs:
                    idles = [s["idle"] for s in cs if "idle" in s]
                    r["cpu_idle_avg"] = round(sum(idles) / len(idles), 1) if idles else 0
                runs.append(r)
            except Exception as e:
                runs.append({"run_id": rd.name, "status": "error", "step_count": 0, "error": str(e)})

        return json.dumps({"runs": runs, "runs_dir": str(runs_dir)}, ensure_ascii=False).encode("utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="DictPen Test Dashboard")
    parser.add_argument("--runs-dir", default=str(RUNS_DIR))
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    Handler.runs_dir = Path(args.runs_dir)
    Handler.runs_dir.mkdir(parents=True, exist_ok=True)

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Dashboard running at {url}")
    print(f"Runs dir: {Handler.runs_dir}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
