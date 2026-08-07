import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import os, numpy as np

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
                vals = {'_dt': dt}
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
                vals = {'_dt': dt}
                try: vals['_pid'] = int(parts[2])
                except: vals['_pid'] = 0
                for i in range(3, len(parts), 2):
                    if i+1 < len(parts):
                        try: vals[parts[i]] = float(parts[i+1])
                        except: pass
                data.append(vals)
            except: pass
    return data

def stats_str(arr, unit='', div=1):
    if not arr: return '-'
    vals = [v for v in arr if v is not None]
    if not vals: return '-'
    return f'{int(min(vals)/div)}~{int(max(vals)/div)}{unit}'

def pid_info(data, name, start_time):
    """Return (first_pid, is_stable, changes_list)
    Each change = (dt, old_pid, new_pid, elapsed_str). PID=0 means process died."""
    if not data: return (0, True, [])
    first = None
    changes = []
    last = None
    for d in data:
        pid = d.get('_pid', -1)
        if pid < 0: continue
        dt = d['_dt']
        if first is None: first = pid
        if last is not None and pid != last:
            elapsed = dt - start_time
            hours = int(elapsed.total_seconds() // 3600)
            mins = int((elapsed.total_seconds() % 3600) // 60)
            elapsed_str = f'{hours}h{mins:02d}m'
            changes.append((dt, last, pid, elapsed_str))
        last = pid
    if first is None: return (0, True, [])
    return (first, len(changes) == 0, changes)

def gen_png(sn, base):
    cpu = parse_kv_log(f'{base}/cpu_info.log')
    bat = parse_kv_log(f'{base}/battery_info.log')
    tmp = parse_kv_log(f'{base}/temp_info.log')
    mem = parse_kv_log(f'{base}/mem_info.log')
    miniapp     = parse_mem_log(f'{base}/mem_info_miniapp.log')
    capframe    = parse_mem_log(f'{base}/mem_info_CapFrame.log')
    soundplayer = parse_mem_log(f'{base}/mem_info_SoundPlayer.log')
    soundrecord = parse_mem_log(f'{base}/mem_info_SoundRecord.log')

    if not bat and not cpu:
        print(f'  [skip] no data')
        return

    plt.rcParams['font.family'] = 'Microsoft YaHei'
    plt.rcParams['axes.unicode_minus'] = False
    BG = '#FAFAFA'; GRID = '#E0E0E0'; TEXT = '#333'; SUBTEXT = '#888'

    t_all = [d['_dt'] for d in (bat or cpu)]
    start_time = t_all[0]

    # PID tracking
    procs_pid = {}
    total_crashes = 0
    for name, pdata in [('miniapp', miniapp), ('CapFrame', capframe),
                         ('SoundPlayer', soundplayer), ('SoundRecord', soundrecord)]:
        first_pid, stable, changes = pid_info(pdata, name, start_time)
        procs_pid[name] = {'pid': first_pid, 'stable': stable, 'changes': changes}
        total_crashes += len(changes)

    crash_str = f' | CRASH x{total_crashes}' if total_crashes > 0 else ' | No crash'
    title_text = (f'Y15-3 Stability | SN: {sn} | '
                  f'{t_all[0].strftime("%m-%d %H:%M")} ~ {t_all[-1].strftime("%m-%d %H:%M")} '
                  f'| {len(t_all)} samples{crash_str}')

    fig = plt.figure(figsize=(20, 12))
    fig.patch.set_facecolor(BG)
    fig.suptitle(title_text, fontsize=14, fontweight='bold', color='#2c3e50', y=0.99)

    # ====== PID Monitor Box ======
    pid_lines = []
    for name in ['miniapp', 'CapFrame', 'SoundPlayer', 'SoundRecord']:
        info = procs_pid[name]
        if info['pid'] == 0: continue
        if info['stable']:
            pid_lines.append(f'{name}: PID={info["pid"]} (stable)')
        else:
            for c in info['changes']:
                label = f'{name}: PID {c[1]} -> {c[2]} @ {c[3]} (DIED!)' if c[2] == 0 else f'{name}: PID {c[1]} -> {c[2]} @ {c[3]} (CRASH!)'
                pid_lines.append(label)

    if pid_lines:
        pid_box_color = '#e74c3c' if total_crashes > 0 else '#27ae60'
        fig.text(0.99, 0.97, '\n'.join(pid_lines), transform=fig.transFigure,
                 fontsize=10, color=pid_box_color, ha='right', va='top',
                 family='sans-serif', fontweight='bold',
                 bbox=dict(boxstyle='round,pad=0.8', facecolor='white',
                           edgecolor=pid_box_color, linewidth=1.5))

    # ====== 1. Battery + Temp ======
    ax1 = plt.subplot(2, 3, 1)
    ax1.set_facecolor('white')
    s1 = ''
    if bat:
        t = [d['_dt'] for d in bat]
        ax1.plot(t, [d.get('capacity',None) for d in bat], color='#27ae60', linewidth=1.5, label='Battery (%)')
        s1 = 'Battery ' + stats_str([d.get('capacity',None) for d in bat], '%')
    ax1.set_ylabel('%', color='#27ae60', fontsize=11, fontweight='bold')
    ax1.tick_params(axis='y', colors='#27ae60', labelsize=9)
    if tmp:
        t2 = [d['_dt'] for d in tmp]
        cpu_t = [d.get('cpu_temp',None) for d in tmp]
        bat_t = [d.get('battery_temp',None) for d in tmp]
        ax1b = ax1.twinx()
        ax1b.plot(t2, cpu_t, color='#e74c3c', linewidth=1.0, label='CPU temp', alpha=0.85)
        ax1b.plot(t2, bat_t, color='#f39c12', linewidth=0.8, label='Bat temp', alpha=0.7)
        ax1b.set_ylabel('degC', color='#e74c3c', fontsize=11, fontweight='bold')
        ax1b.tick_params(axis='y', colors='#e74c3c', labelsize=9)
        s1 += ' | CPU ' + stats_str(cpu_t, 'degC')
        l1,l1b = ax1.get_legend_handles_labels()
        l2,l2b = ax1b.get_legend_handles_labels()
        ax1.legend(l1+l2, l1b+l2b, loc='upper left', fontsize=9,
                   facecolor='white', edgecolor=GRID, labelcolor=TEXT)
    ax1.set_title('Battery & Temp', color=TEXT, fontsize=13, fontweight='bold', pad=10)
    ax1.tick_params(colors=SUBTEXT, labelsize=9)
    ax1.grid(True, alpha=0.4, color=GRID, linewidth=0.5)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
    if s1:
        ax1.text(0.99, 0.01, s1, transform=ax1.transAxes, fontsize=9, color=SUBTEXT,
                 ha='right', va='bottom', bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor=GRID, alpha=0.8))

    # ====== 2. CPU ======
    ax2 = plt.subplot(2, 3, 2)
    ax2.set_facecolor('white')
    s2 = ''
    if cpu:
        t = [d['_dt'] for d in cpu]
        usr = [d.get('usr', 0) for d in cpu]
        sys_v = [d.get('sys', 0) for d in cpu]
        idle_v = [d.get('idle', 0) for d in cpu]
        ax2.fill_between(t, 0, usr, color='#e74c3c', alpha=0.7, label='usr')
        ax2.fill_between(t, usr, [u+s for u,s in zip(usr, sys_v)], color='#f39c12', alpha=0.7, label='sys')
        ax2.fill_between(t, [u+s for u,s in zip(usr, sys_v)], 100, color='#3498db', alpha=0.5, label='idle')
        s2 = 'usr ' + stats_str(usr,'%') + ' | sys ' + stats_str(sys_v,'%') + ' | idle ' + stats_str(idle_v,'%')
    ax2.set_ylim(0, 100)
    ax2.set_title('CPU Usage', color=TEXT, fontsize=13, fontweight='bold', pad=10)
    ax2.legend(loc='upper right', fontsize=9, facecolor='white', edgecolor=GRID, labelcolor=TEXT)
    ax2.tick_params(colors=SUBTEXT, labelsize=9)
    ax2.grid(True, alpha=0.4, color=GRID, linewidth=0.5)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
    ax2.text(0.99, 0.01, s2, transform=ax2.transAxes, fontsize=9, color=SUBTEXT,
             ha='right', va='bottom', bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor=GRID, alpha=0.8))

    # ====== 3. System Memory ======
    ax3 = plt.subplot(2, 3, 3)
    ax3.set_facecolor('white')
    s3 = ''
    if mem:
        t = [d['_dt'] for d in mem]
        mav = [d.get('MemAvailable', 0)/1024 for d in mem]
        mfr = [d.get('MemFree', 0)/1024 for d in mem]
        mca = [d.get('Cached', 0)/1024 for d in mem]
        ax3.plot(t, mav, color='#27ae60', linewidth=1.5, label='Available')
        ax3.plot(t, mfr, color='#2980b9', linewidth=1.0, alpha=0.9, label='Free')
        ax3.fill_between(t, 0, mca, color='#f39c12', alpha=0.2, label='Cached')
        s3 = 'Available ' + stats_str(mav,'MB') + ' | Free ' + stats_str(mfr,'MB')
    ax3.set_title('System Memory', color=TEXT, fontsize=13, fontweight='bold', pad=10)
    ax3.set_ylabel('MB', fontsize=11, color=SUBTEXT)
    ax3.legend(loc='upper right', fontsize=9, facecolor='white', edgecolor=GRID, labelcolor=TEXT)
    ax3.tick_params(colors=SUBTEXT, labelsize=9)
    ax3.grid(True, alpha=0.4, color=GRID, linewidth=0.5)
    ax3.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
    ax3.text(0.99, 0.01, s3, transform=ax3.transAxes, fontsize=9, color=SUBTEXT,
             ha='right', va='bottom', bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor=GRID, alpha=0.8))

    # ====== 4. miniapp Memory + All PID ======
    ax4 = plt.subplot(2, 1, 2)
    ax4.set_facecolor('white')
    if miniapp:
        t = [d['_dt'] for d in miniapp]
        rss = [d.get('VmRSS', None) for d in miniapp]
        hwm = [d.get('VmHWM', None) for d in miniapp]
        rfile = [d.get('RssFile') or 0 for d in miniapp]
        ranon = [d.get('RssAnon') or 0 for d in miniapp]

        ax4.plot(t, rss, color='#e74c3c', linewidth=1.5, label='VmRSS')
        ax4.plot(t, hwm, color='#f39c12', linewidth=1.2, label='VmHWM (peak)', linestyle=':')
        ax4.fill_between(t, 0, rfile, color='#3498db', alpha=0.2, label='RssFile')
        ax4.fill_between(t, rfile, [rf+ra for rf,ra in zip(rfile,ranon)],
                         color='#9b59b6', alpha=0.2, label='RssAnon')

        # PID lines for all processes
        ax4_pid = ax4.twinx()
        pid_configs = [
            ('miniapp', miniapp, '#1abc9c', 2.0),
            ('CapFrame', capframe, '#3498db', 0.8),
            ('SoundPlayer', soundplayer, '#27ae60', 0.8),
            ('SoundRecord', soundrecord, '#f39c12', 0.8),
        ]
        for pname, pdata, pcolor, plw in pid_configs:
            if pdata:
                pt = [d['_dt'] for d in pdata]
                pp = [d.get('_pid', None) for d in pdata]
                if any(p is not None for p in pp):
                    ls = '--' if pname == 'miniapp' else ':'
                    ax4_pid.plot(pt, pp, color=pcolor, linewidth=plw, linestyle=ls,
                                 alpha=0.5 if pname != 'miniapp' else 0.7,
                                 label=f'{pname} PID')

        ax4_pid.set_ylabel('PID (any change = crash)', color='#e74c3c', fontsize=11, fontweight='bold')
        ax4_pid.tick_params(axis='y', colors='#e74c3c', labelsize=9)

        # Mark crash points
        all_crashes = []
        for name, pdata in [('miniapp',miniapp), ('CapFrame',capframe),
                             ('SoundPlayer',soundplayer), ('SoundRecord',soundrecord)]:
            _, _, changes = pid_info(pdata, name, start_time)
            for dt, old, new, elapsed in changes:
                all_crashes.append((dt, name, old, new, elapsed))
                ax4.axvline(x=dt, color='#e74c3c', linewidth=1.5, linestyle='--', alpha=0.6)
                ylims = ax4.get_ylim()
                ypos = ylims[0] + (ylims[1] - ylims[0]) * 0.90
                annot_text = f'{name} DIED!' if new == 0 else f'{name} CRASH!'
                annot_text += f'\nPID {old} -> {new}\n@{elapsed}'
                ax4.annotate(annot_text,
                            xy=(dt, ypos), fontsize=8, color='#e74c3c',
                            fontweight='bold', ha='center', va='top',
                            bbox=dict(boxstyle='round,pad=0.4', facecolor='#fff5f5',
                                      edgecolor='#e74c3c', linewidth=1.2, alpha=0.9))

        s4 = f'VmRSS {stats_str(rss,"KB")} | VmHWM {stats_str(hwm,"KB")}'
        if all_crashes: s4 += f' | CRASH x{len(all_crashes)}'
        l4a, l4b = ax4.get_legend_handles_labels()
        l4c, l4d = ax4_pid.get_legend_handles_labels()
        ax4.legend(l4a+l4c, l4b+l4d, loc='upper left', fontsize=8,
                   facecolor='white', edgecolor=GRID, labelcolor=TEXT, ncol=4)

    ax4.set_title('miniapp Memory + Process PID Monitor (PID change = crash)',
                  color=TEXT, fontsize=13, fontweight='bold', pad=10)
    ax4.set_ylabel('KB', fontsize=11, color=SUBTEXT)
    ax4.tick_params(colors=SUBTEXT, labelsize=9)
    ax4.grid(True, alpha=0.4, color=GRID, linewidth=0.5)
    ax4.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
    ax4.text(0.01, 0.01, s4, transform=ax4.transAxes, fontsize=10, color=TEXT,
             ha='left', va='bottom', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.5', facecolor='white', edgecolor=GRID, alpha=0.9))

    for ax in [ax1, ax2, ax3, ax4]:
        for s in ax.spines.values(): s.set_color(GRID)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=0, ha='center', fontsize=8)

    plt.tight_layout(rect=[0, 0.01, 1, 0.97])
    out = os.path.join(os.path.dirname(base), sn + '.png')
    fig.savefig(out, dpi=130, bbox_inches='tight', facecolor=BG, edgecolor='none')
    plt.close(fig)
    size_kb = os.path.getsize(out) // 1024
    status = f'{total_crashes} crashes' if total_crashes > 0 else 'stable'
    print(f'  [OK] {out} ({size_kb} KB) | PIDs: {status}')

root = r'D:\HardWare\Stableness'
for sn in sorted(os.listdir(root)):
    sp = os.path.join(root, sn)
    if not os.path.isdir(sp): continue
    gp = os.path.join(sp, 'grafana')
    if not os.path.isdir(gp): continue
    print(f'Processing {sn}...')
    gen_png(sn, gp)
print('\nAll done.')
