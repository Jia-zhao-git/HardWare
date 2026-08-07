// electron/modules/stability_report.js
// Pure Node.js stability report generator - no Python dependency

const fs = require('fs');
const path = require('path');

const WEEKDAYS = ['周日','周一','周二','周三','周四','周五','周六'];

// === Log Parsers ===
function parseKvLog(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const data = [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('|');
        if (parts.length < 3) continue;
        try {
            const dt = new Date(
                parseInt(parts[0].slice(0,4)), parseInt(parts[0].slice(4,6))-1,
                parseInt(parts[0].slice(6,8)), parseInt(parts[0].slice(9,11)),
                parseInt(parts[0].slice(12,14)), parseInt(parts[0].slice(15,17))
            );
            const vals = { _ts: dt.toISOString() };
            for (let i = 1; i < parts.length - 1; i += 2) {
                const v = parseFloat(parts[i+1]);
                if (!isNaN(v)) vals[parts[i]] = v;
            }
            data.push(vals);
        } catch(e) {}
    }
    return data;
}

function parseMemLog(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const data = [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('|');
        if (parts.length < 6) continue;
        try {
            const dt = new Date(
                parseInt(parts[0].slice(0,4)), parseInt(parts[0].slice(4,6))-1,
                parseInt(parts[0].slice(6,8)), parseInt(parts[0].slice(9,11)),
                parseInt(parts[0].slice(12,14)), parseInt(parts[0].slice(15,17))
            );
            const vals = { _ts: dt.toISOString() };
            vals._pid = parseInt(parts[2]) || 0;
            for (let i = 3; i < parts.length - 1; i += 2) {
                const v = parseFloat(parts[i+1]);
                if (!isNaN(v)) vals[parts[i]] = v;
            }
            data.push(vals);
        } catch(e) {}
    }
    return data;
}

function toDataArray(data, keys) {
    const result = {};
    for (const k of keys) result[k] = [];
    for (const d of data) {
        for (const k of keys) {
            if (d[k] != null) result[k].push([d._ts, d[k]]);
        }
    }
    return result;
}

function pidInfo(data) {
    if (!data.length) return { first: 0, stable: true, changes: [] };
    let first = null, last = null;
    const changes = [], t0 = data[0]._ts ? new Date(data[0]._ts) : null;
    for (const d of data) {
        const pid = d._pid;
        if (pid == null) continue;
        if (first == null) first = pid;
        if (last != null && pid !== last) {
            const elapsed = t0 ? new Date(d._ts) - t0 : 0;
            const h = Math.floor(elapsed / 3600000);
            const m = Math.floor((elapsed % 3600000) / 60000);
            changes.push({ old: last, pid, ts: d._ts, elapsed: `${h}h${String(m).padStart(2,'0')}m` });
        }
        last = pid;
    }
    return { first: first || 0, stable: changes.length === 0, changes };
}

function statsStr(data, key, div = 1) {
    let min = Infinity, max = -Infinity;
    for (const d of data) {
        const v = d[key];
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    if (min === Infinity) return '-';
    return `${Math.floor(min/div)}~${Math.floor(max/div)}`;
}

// === HTML Generator ===
function generateHTML(sn, grafanaDir) {
    const cpu = parseKvLog(path.join(grafanaDir, 'cpu_info.log'));
    const bat = parseKvLog(path.join(grafanaDir, 'battery_info.log'));
    const tmp = parseKvLog(path.join(grafanaDir, 'temp_info.log'));
    const mem = parseKvLog(path.join(grafanaDir, 'mem_info.log'));
    const miniapp     = parseMemLog(path.join(grafanaDir, 'mem_info_miniapp.log'));
    const capframe    = parseMemLog(path.join(grafanaDir, 'mem_info_CapFrame.log'));
    const soundplayer = parseMemLog(path.join(grafanaDir, 'mem_info_SoundPlayer.log'));
    const soundrecord = parseMemLog(path.join(grafanaDir, 'mem_info_SoundRecord.log'));

    const all = bat.length ? bat : cpu;
    if (!all.length) return null;
    const t0 = all[0]._ts, t1 = all[all.length-1]._ts;

    // PID tracking
    const pids = {};
    let crashCount = 0;
    for (const [name, pdata] of [['miniapp',miniapp],['CapFrame',capframe],['SoundPlayer',soundplayer],['SoundRecord',soundrecord]]) {
        pids[name] = pidInfo(pdata);
        crashCount += pids[name].changes.length;
    }

    // Build data JSON
    const D = {
        battery: toDataArray(bat, ['capacity','voltage','current']),
        temp: toDataArray(tmp, ['cpu_temp','battery_temp']),
        cpu: toDataArray(cpu, ['usr','sys','idle']),
        mem: toDataArray(mem, ['MemAvailable','MemFree','Cached']),
        miniapp: toDataArray(miniapp, ['VmRSS','VmHWM','RssFile','RssAnon','VmData']),
        capframe: toDataArray(capframe, ['VmRSS','VmHWM','RssFile','RssAnon']),
        soundplayer: toDataArray(soundplayer, ['VmRSS']),
        soundrecord: toDataArray(soundrecord, ['VmRSS']),
        miniapp_pid: toDataArray(miniapp, ['_pid']),
        capframe_pid: toDataArray(capframe, ['_pid']),
        soundplayer_pid: toDataArray(soundplayer, ['_pid']),
        soundrecord_pid: toDataArray(soundrecord, ['_pid']),
        crashes: pids,
        meta: {
            sn, t0, t1,
            samples: all.length,
            crashCount,
            crashStr: crashCount ? `| CRASH x${crashCount}` : '| No crash'
        }
    };

    const dataJSON = JSON.stringify(D);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Stability · ${sn}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#FAFAFA;color:#333;font-family:"Microsoft YaHei",sans-serif;font-size:12px}
.header{padding:10px 16px;background:#fff;border-bottom:1px solid #e0e0e0;display:flex;align-items:center;gap:12px}
.header h1{font-size:14px;color:#2c3e50}
.pid-box{position:fixed;top:8px;right:16px;z-index:10;background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:8px 14px;font-size:11px;font-family:monospace}
.pid-box.stable{color:#27ae60}
.pid-box.crash{color:#e74c3c;border-color:#e74c3c}
.row{display:flex;gap:2px;padding:0 2px 2px}
.panel{flex:1;background:#fff;border:1px solid #e0e0e0;min-width:0;margin:2px}
.panel h3{padding:8px 12px 4px;font-size:12px;color:#2c3e50;border-bottom:1px solid #f0f0f0}
.chart{width:100%;height:220px}
.chart.tall{height:300px}
</style>
</head>
<body>
<div class="header">
  <h1>Y15-3 Stability Report · SN: ${sn}</h1>
  <span style="color:#888;font-size:11px">${t0.slice(0,16).replace('T',' ')} ~ ${t1.slice(0,16).replace('T',' ')} · ${all.length} samples · OS 4.51.1</span>
</div>
<div id="pidBox" class="pid-box"></div>

<div class="row">
  <div class="panel"><h3>Battery & Temperature</h3><div id="c_bat" class="chart"></div></div>
  <div class="panel"><h3>CPU Usage</h3><div id="c_cpu" class="chart"></div></div>
  <div class="panel"><h3>System Memory (MB)</h3><div id="c_mem" class="chart"></div></div>
</div>
<div class="row">
  <div class="panel" style="flex:2"><h3>miniapp Memory + PID Monitor</h3><div id="c_miniapp" class="chart tall"></div></div>
  <div class="panel"><h3>Process VmRSS Comparison</h3><div id="c_procs" class="chart tall"></div></div>
</div>

<script>
const D = ${dataJSON};
const allCharts = [];

function opt(series, yLabel, stack) {
  return {
    backgroundColor:'#fff', animation:false,
    tooltip:{trigger:'axis',backgroundColor:'rgba(255,255,255,0.95)',borderColor:'#ddd',textStyle:{fontSize:11,color:'#333'}},
    legend:{bottom:2,left:8,textStyle:{color:'#666',fontSize:10},icon:'roundRect',itemWidth:14,itemHeight:4,data:series.map(s=>s.name)},
    grid:{left:55,right:15,top:10,bottom:38},
    dataZoom:[{type:'inside'},{type:'inside',yAxisIndex:0}],
    xAxis:{type:'time',splitLine:{show:false},axisLabel:{color:'#888',fontSize:9,formatter:'{HH}:{mm}'}},
    yAxis:{type:'value',name:yLabel||'',nameTextStyle:{color:'#888',fontSize:9},splitLine:{lineStyle:{color:'#f0f0f0'}},axisLabel:{color:'#888',fontSize:9}},
    series
  };
}
function ls(name, data, color, area, stack) {
  return {name,type:'line',showSymbol:false,sampling:'lttb',
    lineStyle:{width:0.8,color},itemStyle:{color},
    areaStyle:area?{color,opacity:area}:undefined,
    stack:stack||undefined,emphasis:{disabled:true},data};
}

// PID box
const pidEl = document.getElementById('pidBox');
const pidLines = [];
${JSON.stringify(Object.entries(pids).map(([k,v]) => {
    if (v.stable) return `${k}: PID=${v.first} (stable)`;
    return v.changes.map(c => `${k}: PID ${c.old}->${c.pid} @${c.elapsed} (${c.pid===0?'DIED':'CRASH'})`).join('\n');
}).join('\n'))}
pidEl.innerHTML = pidLines.join('<br>');
pidEl.className = crashCount > 0 ? 'pid-box crash' : 'pid-box stable';

function initChart(id, series, yLabel, stack) {
  const c = echarts.init(document.getElementById(id));
  c.setOption(opt(series, yLabel, stack));
  allCharts.push(c); return c;
}

// Charts
initChart('c_bat', [
  ls('Battery(%)', D.battery.capacity, '#27ae60', 0.2),
  ls('Voltage(V)', D.battery.voltage, '#e74c3c', 0.05),
  ls('Current(A)', D.battery.current, '#f39c12', 0.1),
], '');
initChart('c_cpu', [
  ls('usr', D.cpu.usr, '#e74c3c', 0.5, 'cpu'),
  ls('sys', D.cpu.sys, '#f39c12', 0.4, 'cpu'),
  ls('idle', D.cpu.idle, '#3498db', 0.3, 'cpu'),
], '%');
initChart('c_mem', [
  ls('Available', D.mem.MemAvailable, '#27ae60', 0.2),
  ls('Free', D.mem.MemFree, '#2980b9', 0.1),
  ls('Cached', D.mem.Cached, '#f39c12', 0.1),
], 'MB');

const APP_COLORS = {VmRSS:'#e74c3c',VmHWM:'#f39c12',RssFile:'#3498db',RssAnon:'#9b59b6',VmData:'#95a5a6'};
initChart('c_miniapp', [
  ...Object.entries(D.miniapp).map(([k,v])=>ls(k,v,APP_COLORS[k]||'#aaa',k==='VmRSS'?0.15:0)),
  ls('miniapp PID', D.miniapp_pid._pid, '#1abc9c', 0),
], 'KB / PID');

const PROC_COLORS = {miniapp:'#e74c3c',capframe:'#3498db',soundplayer:'#27ae60',soundrecord:'#f39c12'};
initChart('c_procs', [
  ls('miniapp', D.miniapp.VmRSS, '#e74c3c', 0),
  ls('CapFrame', D.capframe.VmRSS, '#3498db', 0),
  ls('SoundPlayer', D.soundplayer.VmRSS, '#27ae60', 0),
  ls('SoundRecord', D.soundrecord.VmRSS, '#f39c12', 0),
], 'KB');

window.addEventListener('resize',()=>allCharts.forEach(c=>c.resize()));

// Sync zoom
let sync=false;
allCharts.forEach(c=>c.on('datazoom',()=>{
  if(sync)return;
  const dz=c.getOption().dataZoom[0];if(!dz)return;
  sync=true;
  allCharts.forEach(o=>{if(o!==c)o.dispatchAction({type:'dataZoom',dataZoomIndex:0,start:dz.start,end:dz.end})});
  sync=false;
}));
</script>
</body>
</html>`;
}

// === PNG Generator (via Electron BrowserWindow) ===
async function generatePNG(htmlPath, pngPath) {
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({
        width: 1600, height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    try {
        await win.loadFile(htmlPath);
        // Wait for ECharts to render
        await new Promise(resolve => setTimeout(resolve, 3000));
        const image = await win.webContents.capturePage();
        fs.writeFileSync(pngPath, image.toPNG());
        return true;
    } catch(e) {
        console.error('[STB] PNG capture error:', e.message);
        return false;
    } finally {
        win.close();
    }
}

module.exports = { generateHTML, generatePNG, parseKvLog, parseMemLog, pidInfo, toDataArray };
