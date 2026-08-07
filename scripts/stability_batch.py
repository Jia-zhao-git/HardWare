import json, os, sys
from datetime import datetime

def parse_kv_log(path):
    data = []
    if not os.path.exists(path): return data
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            parts = line.split('|')
            if len(parts) < 3: continue
            try:
                dt = datetime.strptime(parts[0], '%Y%m%d %H:%M:%S')
                vals = {'_ts': dt.strftime('%Y-%m-%dT%H:%M:%S')}
                for i in range(1, len(parts), 2):
                    if i+1 < len(parts):
                        try: vals[parts[i]] = float(parts[i+1])
                        except: pass
                data.append(vals)
            except: pass
    return data

def parse_mem_log(path):
    data = []
    if not os.path.exists(path): return data
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            parts = line.split('|')
            if len(parts) < 6: continue
            try:
                dt = datetime.strptime(parts[0], '%Y%m%d %H:%M:%S')
                vals = {'_ts': dt.strftime('%Y-%m-%dT%H:%M:%S')}
                for i in range(3, len(parts), 2):
                    if i+1 < len(parts):
                        try: vals[parts[i]] = float(parts[i+1])
                        except: pass
                data.append(vals)
            except: pass
    return data

def extract(data, key):
    raw = [[d['_ts'], d.get(key)] for d in data if d.get(key) is not None]
    return downsample(raw, 500)

def extract_div(data, key, div=1):
    raw = [[d['_ts'], round(d[key]/div, 0)] for d in data if d.get(key) is not None]
    return downsample(raw, 500)

def downsample(arr, max_points):
    n = len(arr)
    if n <= max_points: return arr
    step = n / max_points
    result = []
    for i in range(max_points):
        start = round(i * step)
        end = min(round((i+1) * step), n)
        bucket = arr[start:end]
        if bucket:
            # Keep first point's timestamp, mean of values
            ts = bucket[0][0]
            val = sum(b[1] for b in bucket) / len(bucket)
            result.append([ts, round(val, 0)])
    return result

def gen_html(sn, base):
    cpu = parse_kv_log(f'{base}/cpu_info.log')
    bat = parse_kv_log(f'{base}/battery_info.log')
    tmp = parse_kv_log(f'{base}/temp_info.log')
    mem = parse_kv_log(f'{base}/mem_info.log')
    miniapp     = parse_mem_log(f'{base}/mem_info_miniapp.log')
    capframe    = parse_mem_log(f'{base}/mem_info_CapFrame.log')
    soundplayer = parse_mem_log(f'{base}/mem_info_SoundPlayer.log')
    soundrecord = parse_mem_log(f'{base}/mem_info_SoundRecord.log')
    resource    = parse_mem_log(f'{base}/mem_info_ResourceManager.log')

    if not cpu and not bat:
        print(f'  [skip] no data in {base}')
        return

    # Time range
    all_ts = [d['_ts'] for d in cpu] if cpu else [d['_ts'] for d in bat]
    t_start = all_ts[0][:16].replace('T',' ') if all_ts else '?'
    t_end   = all_ts[-1][:16].replace('T',' ') if all_ts else '?'
    n_pts   = len(all_ts)

    CHARTS = {
        'battery': {
            'current':  extract(bat, 'current'),
            'capacity': extract(bat, 'capacity'),
            'voltage':  extract(bat, 'voltage'),
        },
        'temp': {
            'cpu_temp':     extract(tmp, 'cpu_temp'),
            'battery_temp': extract(tmp, 'battery_temp'),
        },
        'cpu': {
            'usr':  extract(cpu, 'usr'),
            'idle': extract(cpu, 'idle'),
            'sys':  extract(cpu, 'sys'),
        },
        'mem': {
            'SReclaimable': extract_div(mem, 'SReclaimable', 1024),
            'Shmem':        extract_div(mem, 'Shmem', 1024),
            'Swap':         extract_div(mem, 'Swap', 1024),
            'MemAvailable': extract_div(mem, 'MemAvailable', 1024),
            'Cached':       extract_div(mem, 'Cached', 1024),
            'MemFree':      extract_div(mem, 'MemFree', 1024),
            'Buffers':      extract_div(mem, 'Buffers', 1024),
            'Unevictable':  extract_div(mem, 'Unevictable', 1024),
            'Slab':         extract_div(mem, 'Slab', 1024),
        },
        'miniapp': {k: extract(miniapp, k) for k in ['VmData','Threads','RssShmem','VmSwap','VmRSS','VmHWM','RssFile','RssAnon']},
        'capframe': {k: extract(capframe, k) for k in ['VmData','Threads','RssShmem','VmSwap','VmRSS','VmHWM','RssFile','RssAnon']},
        'soundplayer': {k: extract(soundplayer, k) for k in ['VmRSS','VmHWM','RssFile','RssAnon','Threads']},
        'soundrecord': {k: extract(soundrecord, k) for k in ['VmRSS','VmHWM','RssFile','RssAnon','Threads']},
        'resource':    {k: extract(resource, k) for k in ['VmRSS','VmHWM','RssFile','RssAnon','Threads']},
    }

    json_data = json.dumps(CHARTS, ensure_ascii=False, separators=(',', ':'))

    HTML = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>稳定性 · {sn}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#111;color:#ccc;font-family:"Microsoft YaHei",sans-serif;font-size:12px}}
.ctrl{{display:flex;gap:8px;padding:8px 12px;background:#141414;border-bottom:1px solid #252525;align-items:center;flex-wrap:wrap}}
.ctrl button{{background:#1f1f1f;border:1px solid #333;color:#aaa;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:11px}}
.ctrl button:hover{{background:#2a2a2a;color:#fff}}
.page{{padding:12px}}
.sec-title{{padding:6px 12px;font-size:13px;font-weight:600;color:#aaa;background:#181818;border-left:3px solid #444;margin-bottom:2px;cursor:pointer;user-select:none}}
.row{{display:flex;gap:2px;margin-bottom:2px}}
.panel{{flex:1;background:#181818;border:1px solid #252525;min-width:0}}
.panel-title{{padding:6px 12px 4px;font-size:12px;color:#ccc;border-bottom:1px solid #252525}}
.chart{{width:100%;height:220px}}
.chart.tall{{height:280px}}
</style>
</head>
<body>
<div class="ctrl">
  <span style="color:#e0a84b;font-weight:600;font-size:13px">📊 Y15-3 稳定性</span>
  <span style="color:#666">SN: {sn} &nbsp;|&nbsp; {t_start} ~ {t_end} &nbsp;|&nbsp; {n_pts:,} 采样</span>
  <div style="margin-left:auto;display:flex;gap:6px">
    <button onclick="zoomAll(0,100)">全程</button>
    <button onclick="zoomAll(0,33)">前段</button>
    <button onclick="zoomAll(33,66)">中段</button>
    <button onclick="zoomAll(67,100)">后段</button>
  </div>
</div>
<div class="page">
<div class="sec-title" onclick="toggle('s_bat')">▼ 电池</div>
<div id="s_bat"><div class="row">
  <div class="panel"><div class="panel-title">电池百分比 / 电流 / 电压</div><div id="c_bat" class="chart"></div></div>
  <div class="panel"><div class="panel-title">温度</div><div id="c_temp" class="chart"></div></div>
</div></div>

<div class="sec-title" onclick="toggle('s_sys')">▼ 系统</div>
<div id="s_sys"><div class="row">
  <div class="panel"><div class="panel-title">CPU (%)</div><div id="c_cpu" class="chart tall"></div></div>
  <div class="panel"><div class="panel-title">内存 (MB)</div><div id="c_mem" class="chart tall"></div></div>
</div></div>

<div class="sec-title" onclick="toggle('s_app')">▼ App 进程内存</div>
<div id="s_app">
<div class="row">
  <div class="panel"><div class="panel-title">miniapp (KB)</div><div id="c_miniapp" class="chart tall"></div></div>
  <div class="panel"><div class="panel-title">CapFrame (KB)</div><div id="c_capframe" class="chart tall"></div></div>
</div>
<div class="row">
  <div class="panel"><div class="panel-title">SoundPlayer (KB)</div><div id="c_soundplayer" class="chart"></div></div>
  <div class="panel"><div class="panel-title">SoundRecord (KB)</div><div id="c_soundrecord" class="chart"></div></div>
  <div class="panel"><div class="panel-title">ResourceManager (KB)</div><div id="c_resource" class="chart"></div></div>
</div>
</div>
</div>

<script>
const D = {json_data};
const allC = [];

function opt(series, yName, stack) {{
  return {{
    backgroundColor:'transparent', animation:false,
    tooltip:{{trigger:'axis',backgroundColor:'rgba(0,0,0,0.85)',borderColor:'#333',textStyle:{{fontSize:11,color:'#ccc'}},axisPointer:{{lineStyle:{{color:'#333'}}}}}},
    legend:{{bottom:4,left:8,textStyle:{{color:'#888',fontSize:10}},icon:'roundRect',itemWidth:14,itemHeight:4,data:series.map(s=>s.name)}},
    grid:{{left:60,right:20,top:10,bottom:42}},
    dataZoom:[{{type:'inside',xAxisIndex:0,throttle:50}},{{type:'inside',yAxisIndex:0}}],
    xAxis:{{type:'time',splitLine:{{show:false}},axisLine:{{lineStyle:{{color:'#333'}}}},axisLabel:{{color:'#555',fontSize:10,formatter:'{{HH}}:{{mm}}'}},axisTick:{{lineStyle:{{color:'#333'}}}}}},
    yAxis:{{type:'value',name:yName||'',nameTextStyle:{{color:'#555',fontSize:10}},splitLine:{{lineStyle:{{color:'#1e1e1e'}}}},axisLabel:{{color:'#555',fontSize:10}},axisLine:{{show:false}},axisTick:{{show:false}}}},
    series:series
  }};
}}
function ls(name, data, color, ao, stack) {{
  return {{name,type:'line',showSymbol:false,sampling:'lttb',
    lineStyle:{{width:0.8,color}},itemStyle:{{color}},
    areaStyle:ao>0?{{color,opacity:ao}}:undefined,
    stack:stack||undefined,emphasis:{{disabled:true}},data}};
}}

function mkChart(id, series, yLabel, stack) {{
  const c = echarts.init(document.getElementById(id));
  c.setOption(opt(series, yLabel, stack));
  allC.push(c);
  return c;
}}

const MEM_COLORS = {{'SReclaimable':'#f2495c','Shmem':'#ff9830','Swap':'#b877d9','MemAvailable':'#5794f2','Cached':'#e0a84b','MemFree':'#73bf69','Buffers':'#1f60c4','Unevictable':'#8ab8ff','Slab':'#37872d'}};
const APP_COLORS = {{'VmData':'#5794f2','Threads':'#ff9830','RssShmem':'#b877d9','VmSwap':'#1f60c4','VmRSS':'#f2495c','VmHWM':'#e0a84b','RssFile':'#8ab8ff','RssAnon':'#ffb357'}};

mkChart('c_bat',  [ls('current',D.battery.current,'#e0a84b',0.15),ls('capacity',D.battery.capacity,'#73bf69',0.3),ls('voltage',D.battery.voltage,'#f2495c',0.1)], '');
mkChart('c_temp', [ls('cpu_temp',D.temp.cpu_temp,'#e0a84b',0.2),ls('battery_temp',D.temp.battery_temp,'#73bf69',0.1)], '°C');
mkChart('c_cpu',  [ls('usr',D.cpu.usr,'#e0a84b',0.5,'c'),ls('idle',D.cpu.idle,'#5794f2',0.3,'c'),ls('sys',D.cpu.sys,'#73bf69',0.5,'c')], '%');
mkChart('c_mem',  Object.entries(D.mem).map(([k,v])=>ls(k,v,MEM_COLORS[k]||'#aaa',0.12)), 'MB');
mkChart('c_miniapp',    Object.entries(D.miniapp).filter(([k])=>k!='Threads').map(([k,v])=>ls(k,v,APP_COLORS[k]||'#aaa',k=='VmRSS'?0.15:0)), 'KB');
mkChart('c_capframe',   Object.entries(D.capframe).filter(([k])=>k!='Threads').map(([k,v])=>ls(k,v,APP_COLORS[k]||'#aaa',k=='VmRSS'?0.15:0)), 'KB');
mkChart('c_soundplayer',Object.entries(D.soundplayer).filter(([k])=>k!='Threads').map(([k,v])=>ls(k,v,APP_COLORS[k]||'#aaa',0)), 'KB');
mkChart('c_soundrecord',Object.entries(D.soundrecord).filter(([k])=>k!='Threads').map(([k,v])=>ls(k,v,APP_COLORS[k]||'#aaa',0)), 'KB');
mkChart('c_resource',   Object.entries(D.resource).filter(([k])=>k!='Threads').map(([k,v])=>ls(k,v,APP_COLORS[k]||'#aaa',0)), 'KB');

window.addEventListener('resize', ()=>allC.forEach(c=>c.resize()));

let syncing=false;
allC.forEach(c=>c.on('datazoom',()=>{{
  if(syncing)return; const dz=c.getOption().dataZoom[0]; if(!dz)return;
  syncing=true; allC.forEach(o=>o!==c&&o.dispatchAction({{type:'dataZoom',dataZoomIndex:0,start:dz.start,end:dz.end}})); syncing=false;
}}));

function zoomAll(s,e){{allC.forEach(c=>c.dispatchAction({{type:'dataZoom',dataZoomIndex:0,start:s,end:e}}));}}
function toggle(id){{const el=document.getElementById(id);el.style.display=el.style.display==='none'?'':'none';allC.forEach(c=>c.resize());}}
</script>
</body>
</html>"""

    out = os.path.join(os.path.dirname(base), 'stability_report.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(HTML)
    size_kb = os.path.getsize(out) // 1024
    print(f'  [OK] {out}  ({size_kb} KB)')

# ---- main ----
root = r'D:\HardWare\Stableness'
for sn in sorted(os.listdir(root)):
    sn_path = os.path.join(root, sn)
    if not os.path.isdir(sn_path): continue
    grafana_path = os.path.join(sn_path, 'grafana')
    if not os.path.isdir(grafana_path):
        print(f'  [skip] no grafana/ in {sn}')
        continue
    print(f'Processing {sn}...')
    gen_html(sn, grafana_path)

print('\nAll done.')
