const fs = require('fs');
const path = require('path');

// ==== PARSERS ====
function parseTime(s) {
    return new Date(
        parseInt(s.slice(0,4)), parseInt(s.slice(4,6))-1, parseInt(s.slice(6,8)),
        parseInt(s.slice(9,11)), parseInt(s.slice(12,14)), parseInt(s.slice(15,17))
    );
}
function parseKvLog(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const data = [];
    for (const line of fs.readFileSync(filePath,'utf-8').split('\n')) {
        if (!line.trim()) continue;
        const p = line.split('|'); if (p.length<3) continue;
        try {
            const vals = { _ts: parseTime(p[0]).toISOString() };
            for (let i=1; i<p.length-1; i+=2) { const v=parseFloat(p[i+1]); if(!isNaN(v)) vals[p[i]]=v; }
            data.push(vals);
        } catch(e) {}
    }
    return data;
}
function parseMemLog(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const data = [];
    for (const line of fs.readFileSync(filePath,'utf-8').split('\n')) {
        if (!line.trim()) continue;
        const p = line.split('|'); if (p.length<6) continue;
        try {
            const vals = { _ts: parseTime(p[0]).toISOString() };
            vals._pid = parseInt(p[2]) || 0;
            for (let i=3; i<p.length-1; i+=2) { const v=parseFloat(p[i+1]); if(!isNaN(v)) vals[p[i]]=v; }
            data.push(vals);
        } catch(e) {}
    }
    return data;
}
function toArray(data, keys, maxPts=500, div=1) {
    const result = {};
    for (const k of keys) result[k] = [];
    for (const d of data) { for (const k of keys) { if (d[k]!=null) result[k].push([d._ts, Math.round(d[k]/div)]); } }
    for (const k of keys) {
        const arr = result[k];
        if (arr.length <= maxPts) continue;
        const step = arr.length / maxPts, ds = [];
        for (let i=0; i<maxPts; i++) {
            const s=Math.round(i*step), e=Math.min(Math.round((i+1)*step), arr.length);
            const bucket = arr.slice(s,e);
            if (bucket.length) ds.push([bucket[0][0], Math.round(bucket.reduce((a,b)=>a+b[1],0)/bucket.length)]);
        }
        result[k] = ds;
    }
    return result;
}
function pidInfo(data) {
    if (!data.length) return { first:0, stable:true, changes:[] };
    let f=null, l=null; const ch=[], t0=new Date(data[0]._ts);
    for (const d of data) {
        const pid=d._pid; if (pid==null) continue;
        if (f==null) f=pid;
        if (l!=null && pid!==l) {
            const et=new Date(d._ts)-t0, h=Math.floor(et/36e5), m=Math.floor((et%36e5)/6e4);
            ch.push({ old:l, pid, ts:d._ts, elapsed:`${h}h${String(m).padStart(2,'0')}m` });
        }
        l=pid;
    }
    return { first:f||0, stable:!ch.length, changes:ch };
}

// ==== HTML GENERATOR ====
function generateHTML(sn, grafanaDir) {
    const cpu = parseKvLog(path.join(grafanaDir,'cpu_info.log'));
    const bat = parseKvLog(path.join(grafanaDir,'battery_info.log'));
    const tmp = parseKvLog(path.join(grafanaDir,'temp_info.log'));
    const mem = parseKvLog(path.join(grafanaDir,'mem_info.log'));
    const ma  = parseMemLog(path.join(grafanaDir,'mem_info_miniapp.log'));
    const cf  = parseMemLog(path.join(grafanaDir,'mem_info_CapFrame.log'));
    const sp  = parseMemLog(path.join(grafanaDir,'mem_info_SoundPlayer.log'));
    const sr  = parseMemLog(path.join(grafanaDir,'mem_info_SoundRecord.log'));
    const res = parseMemLog(path.join(grafanaDir,'mem_info_ResourceManager.log'));

    const all = bat.length?bat:cpu; if (!all.length) return null;
    const t0 = all[0]._ts, t1 = all[all.length-1]._ts;
    const N = all.length;

    // PID tracking
    const pids = {};
    let crashCount = 0;
    for (const [n,d] of [['miniapp',ma],['CapFrame',cf],['SoundPlayer',sp],['SoundRecord',sr]]) {
        pids[n] = pidInfo(d); crashCount += pids[n].changes.length;
    }

    const D = {
        bat: toArray(bat, ['capacity','voltage','current']),
        tmp: toArray(tmp, ['cpu_temp','battery_temp']),
        cpu: toArray(cpu, ['usr','sys','idle']),
        sys: toArray(mem, ['MemAvailable','MemFree','Cached','SReclaimable','Slab','Swap'], 500, 1024),
        ma_rss: toArray(ma, ['VmRSS','VmHWM']),
        ma_detail: toArray(ma, ['RssFile','RssAnon','Threads'], 500),
        cf_rss: toArray(cf, ['VmRSS','VmHWM']),
        sp_rss: toArray(sp, ['VmRSS','VmHWM']),
        sr_rss: toArray(sr, ['VmRSS','VmHWM']),
        res_rss: toArray(res, ['VmRSS','VmHWM']),
        ma_pid: toArray(ma, ['_pid']),
        cf_pid: toArray(cf, ['_pid']),
        sp_pid: toArray(sp, ['_pid']),
        sr_pid: toArray(sr, ['_pid']),
        pids, sn, t0, t1, N, crashCount,
    };

    const dataStr = JSON.stringify(D);

    // PID lines for info box
    const pidLines = [];
    for (const [k,v] of Object.entries(pids)) {
        if (v.stable) pidLines.push(`${k}: PID=${v.first} (stable)`);
        else for (const c of v.changes) pidLines.push(`${k}: PID ${c.old}->${c.pid} @${c.elapsed} (${c.pid===0?'DIED':'CRASH'})`);
    }

    return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>${sn}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;color:#333;font:12px Microsoft YaHei,sans-serif;padding:8px}
.top{display:flex;align-items:center;gap:12px;padding:8px 12px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:8px;font-size:12px}
.top strong{color:#1a73e8}.top .crash{color:#c62828;font-weight:700}
.pid-box{display:flex;gap:16px;margin-left:auto;font-family:monospace;font-size:11px;color:#555;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.panel{background:#fff;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden}
.panel.w2{grid-column:span 2}
.panel h3{padding:6px 10px;font-size:11px;font-weight:600;color:#555;background:#f8f9fa;border-bottom:1px solid #e8e8e8;display:flex;justify-content:space-between}
.panel h3 span{color:#999;font-weight:400}
.chart{width:100%;height:200px}.chart.h240{height:240px}.chart.h280{height:280px}
</style></head><body>
<div class="top">
  <strong>${sn}</strong>
  <span>${t0.slice(0,16).replace('T',' ')} ~ ${t1.slice(0,16).replace('T',' ')}</span>
  <span>${N} samples</span>
  <span class="crash">${crashCount?`CRASH x${crashCount}`:'No crash'}</span>
  <div class="pid-box">${pidLines.join('&nbsp;&nbsp;|&nbsp;&nbsp;')}</div>
</div>
<div class="grid">
  <div class="panel"><h3>Battery <span>% / V / A</span></h3><div id="c1" class="chart"></div></div>
  <div class="panel"><h3>Temperature <span>degC</span></h3><div id="c2" class="chart"></div></div>
  <div class="panel"><h3>CPU <span>%</span></h3><div id="c3" class="chart"></div></div>
  <div class="panel w2"><h3>System Memory <span>MB</span></h3><div id="c4" class="chart h240"></div></div>
  <div class="panel"><h3>Swap & Slab <span>MB</span></h3><div id="c5" class="chart"></div></div>
  <div class="panel w2"><h3>miniapp Memory & PID <span>KB</span></h3><div id="c6" class="chart h280"></div></div>
  <div class="panel"><h3>miniapp Threads & Mem Detail</h3><div id="c7" class="chart"></div></div>
  <div class="panel"><h3>CapFrame Memory <span>KB</span></h3><div id="c8" class="chart"></div></div>
  <div class="panel"><h3>SoundPlayer Memory <span>KB</span></h3><div id="c9" class="chart"></div></div>
  <div class="panel"><h3>SoundRecord Memory <span>KB</span></h3><div id="c10" class="chart"></div></div>
  <div class="panel w2"><h3>All Process VmRSS Compare <span>KB</span></h3><div id="c11" class="chart h240"></div></div>
  <div class="panel"><h3>ResourceManager <span>KB</span></h3><div id="c12" class="chart"></div></div>
</div>
<script>
const D = ${dataStr};

function o(s,y,stack){
 return{backgroundColor:'#fff',animation:false,
  tooltip:{trigger:'axis',backgroundColor:'rgba(255,255,255,.96)',borderColor:'#ddd',textStyle:{fontSize:10,color:'#333'}},
  legend:{bottom:0,left:0,textStyle:{color:'#666',fontSize:9},icon:'roundRect',itemWidth:12,itemHeight:3,padding:[0,0,0,8],data:s.map(x=>x.name)},
  grid:{left:55,right:12,top:8,bottom:30},
  xAxis:{type:'time',splitLine:{show:false},axisLabel:{color:'#999',fontSize:9,formatter:'{HH}:{mm}'}},
  yAxis:{type:'value',name:y||'',nameTextStyle:{color:'#999',fontSize:9},splitLine:{lineStyle:{color:'#f0f0f0'}},axisLabel:{color:'#999',fontSize:9}},
  series:s};
}
function l(name,data,color,ao,stack,lw){
 return{name,type:'line',showSymbol:false,sampling:'lttb',lineStyle:{width:lw||0.6,color},itemStyle:{color},areaStyle:ao?{color,opacity:ao}:undefined,stack,emphasis:{disabled:true},data};
}
const C={VmRSS:'#e6522c',VmHWM:'#b71c1c',RssFile:'#3498db',RssAnon:'#7e57c2',Threads:'#00897b',mem_avail:'#2e7d32',mem_free:'#1976d2',mem_cached:'#f9a825',mem_slab:'#6d4c41',mem_recl:'#8d6e63',mem_swap:'#d32f2f',cpu_usr:'#e6522c',cpu_sys:'#f9a825',cpu_idle:'#81c784',bat_cap:'#2e7d32',bat_vol:'#1976d2',bat_cur:'#f9a825',temp_cpu:'#e6522c',temp_bat:'#f9a825',pid:'#00897b'};

const charts=[];
function c(id,s,y,st){const ch=echarts.init(document.getElementById(id));ch.setOption(o(s,y,st));charts.push(ch);return ch;}

c('c1',[l('capacity(%)',D.bat.capacity,C.bat_cap,0.15),l('voltage(V)',D.bat.voltage,C.bat_vol,0.05),l('current(A)',D.bat.current,C.bat_cur,0.05)]);
c('c2',[l('cpu_temp',D.tmp.cpu_temp,C.temp_cpu,0.1),l('battery_temp',D.tmp.battery_temp,C.temp_bat,0.1)],'degC');
c('c3',[l('usr',D.cpu.usr,C.cpu_usr,0.4,'cpu'),l('sys',D.cpu.sys,C.cpu_sys,0.3,'cpu'),l('idle',D.cpu.idle,C.cpu_idle,0.2,'cpu')],'%');
c('c4',[l('Available',D.sys.MemAvailable,C.mem_avail,0.15),l('Free',D.sys.MemFree,C.mem_free,0.08),l('Cached',D.sys.Cached,C.mem_cached,0.08),l('SReclaimable',D.sys.SReclaimable,C.mem_recl,0.05),l('Slab',D.sys.Slab,C.mem_slab,0.05)],'MB');
c('c5',[l('Swap',D.sys.Swap,C.mem_swap,0.1)],'MB');
c('c6',[
 l('VmRSS',D.ma_rss.VmRSS,C.VmRSS,0.2,undefined,1),l('VmHWM(peak)',D.ma_rss.VmHWM,C.VmHWM,0,undefined,0.8),
 l('PID',D.ma_pid._pid,C.pid,0,undefined,1.2)
],'KB');
c('c7',[l('Threads',D.ma_detail.Threads,C.Threads,0.1),l('RssAnon',D.ma_detail.RssAnon,C.RssAnon,0.1),l('RssFile',D.ma_detail.RssFile,C.RssFile,0.1)]);
c('c8',[l('VmRSS',D.cf_rss.VmRSS,C.VmRSS,0.12,undefined,0.8),l('VmHWM',D.cf_rss.VmHWM,C.VmHWM,0,undefined,0.8)]);
c('c9',[l('VmRSS',D.sp_rss.VmRSS,'#2e7d32',0.12,undefined,0.8),l('VmHWM',D.sp_rss.VmHWM,'#1b5e20',0,undefined,0.8)]);
c('c10',[l('VmRSS',D.sr_rss.VmRSS,'#0277bd',0.12,undefined,0.8),l('VmHWM',D.sr_rss.VmHWM,'#01579b',0,undefined,0.8)]);
c('c11',[
 l('miniapp',D.ma_rss.VmRSS,'#e6522c',0,undefined,0.8),
 l('CapFrame',D.cf_rss.VmRSS,'#1976d2',0,undefined,0.8),
 l('SoundPlayer',D.sp_rss.VmRSS,'#2e7d32',0,undefined,0.8),
 l('SoundRecord',D.sr_rss.VmRSS,'#0277bd',0,undefined,0.8)
],'KB');
c('c12',[l('VmRSS',D.res_rss.VmRSS,'#6a1b9a',0.12,undefined,0.8),l('VmHWM',D.res_rss.VmHWM,'#4a148c',0,undefined,0.8)]);

addEventListener('resize',()=>charts.forEach(x=>x.resize()));
let sy=false;charts.forEach(x=>x.on('datazoom',()=>{if(sy)return;const dz=x.getOption().dataZoom[0];if(!dz)return;sy=true;charts.forEach(o=>{if(o!==x)o.dispatchAction({type:'dataZoom',dataZoomIndex:0,start:dz.start,end:dz.end})});sy=false;}));
</script></body></html>`;
}

// ==== PNG via Electron capture ====
async function generatePNG(htmlPath, pngPath) {
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({ width:1400, height:900, show:false, webPreferences:{ nodeIntegration:false, contextIsolation:true } });
    try {
        await win.loadFile(htmlPath);
        await new Promise(r => setTimeout(r, 3000));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(pngPath, img.toPNG());
        return true;
    } catch(e) { console.error('[STB] PNG error:', e.message); return false; }
    finally { win.close(); }
}

module.exports = { generateHTML, generatePNG };
