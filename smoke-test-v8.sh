#!/bin/sh
# ============================================================
# 有道词典笔 Y15C 冒烟测试脚本 v8
# 坐标: X=640, Y=172 | 左滑翻页: 620→20 | 桌面3页
# 核心交互模型:
#   - 语音键(asr) = 返回桌面
#   - 下滑(顶部→下) = 打开状态栏快捷菜单
#   - 上滑 = 页面内向上滚动
#   - 无长按(长按=点击，已移除)
#   - 左滑(右→左) = 桌面翻页
# ============================================================

set +e

DEVICE="/data/smoke_test"
LOG_FILE="${DEVICE}/smoke.log"
RESULT_FILE="${DEVICE}/results.txt"
CYCLE_LOG="${DEVICE}/cycle_count.txt"

W=640; H=172
MX=10; MY=8
CENTER_X=$((W / 2)); CENTER_Y=$((H / 2))
RIGHT_X=$((W - MX)); BOTTOM_Y=$((H - MY))
DESKTOP_PAGES=3
APPS_PER_PAGE=4

total_ops=0

init_test() {
    rm -rf "${DEVICE}/screenshots" 2>/dev/null; mkdir -p "${DEVICE}" 2>/dev/null
    cat > "${LOG_FILE}" <<HEAD
============================================
Y15C Smoke Test v8 Start: $(date '+%Y-%m-%d %H:%M:%S')
Coords: ${W}x${H}  Pages: ${DESKTOP_PAGES}
Key model: asr=home  swipe_down=statusbar  no_longpress
============================================
HEAD
    echo "0" > "${CYCLE_LOG}"
    echo "PASS=0 FAIL=0 OPS=0" > "${RESULT_FILE}"
}

random_range() { echo $(( ($RANDOM % ($2 - $1 + 1)) + $1 )); }
log_msg()    { echo "[$(date '+%H:%M:%S')] $1" >> "${LOG_FILE}"; }
page_inc()   { total_ops=$((total_ops + 1)); }

# ---- 触控原子 ----
click() {
    send_event touch press $1 $2 >/dev/null 2>&1; sleep 0.12
    send_event touch release >/dev/null 2>&1; sleep 0.3
}
swipe() {
    x1=$1; y1=$2; x2=$3; y2=$4; steps=${5:-6}
    send_event touch press $x1 $y1 >/dev/null 2>&1; sleep 0.04
    i=1
    while [ $i -le $steps ]; do
        send_event touch slip $(( x1 + (x2 - x1) * i / steps )) $(( y1 + (y2 - y1) * i / steps )) >/dev/null 2>&1
        i=$((i + 1))
    done
    send_event touch release $x2 $y2 >/dev/null 2>&1; sleep 0.4
}

# ---- 语义化操作 ----
swipe_left()       { swipe 620 86 20 86 7;            sleep 1.2; }  # 桌面翻页
swipe_right()      { swipe 20 86 620 86 7;            sleep 1.2; }
scroll_up()        { swipe $CENTER_X $BOTTOM_Y $CENTER_X $MY 6;    sleep 0.5; }  # 页面内上滑
scroll_down()      { swipe $CENTER_X $MY $CENTER_X $BOTTOM_Y 6;    sleep 0.5; }
pull_statusbar()   { swipe $CENTER_X 40 $CENTER_X 150 8;            sleep 0.5; }     # 页面下滑

go_home()          { pull_statusbar
                     send_event asr press >/dev/null 2>&1; sleep 0.3
                     send_event asr release >/dev/null 2>&1; sleep 0.8; }
start_scan()       { send_event camera press >/dev/null 2>&1; sleep ${1:-2}
                     send_event camera release >/dev/null 2>&1; sleep 1.5; }
press_menu()       { send_event menu press >/dev/null 2>&1; sleep 0.3
                     send_event menu release >/dev/null 2>&1; sleep 0.8; }
press_power()      { send_event power press >/dev/null 2>&1; sleep 0.2
                     send_event power release >/dev/null 2>&1; sleep 1; }
press_statusbar() { send_event asr press >/dev/null 2>&1; sleep 0.1
                send_event asr release >/dev/null 2>&1; sleep 0.1;
                 send_event asr press >/dev/null 2>&1; sleep 0.1
                send_event asr release >/dev/null 2>&1; sleep 0.2;
}

# ---- 通用: 进入某个功能后做深度探索（不按语音键，避免退出）----
explore_inpage() {
    label="${1:-inpage}"
    n=${2:-4}
    i=0
    while [ $i -lt $n ]; do
        act=$(random_range 0 3)
        case $act in
            0) click $(random_range $MX $RIGHT_X) $(random_range $MY $BOTTOM_Y)
               log_msg "    [$label] 点击" ;;
            1) scroll_up;   log_msg "    [$label] 上滑" ;;
            2) scroll_down; log_msg "    [$label] 下滑" ;;
            3) pull_statusbar
               log_msg "    [$label] 状态栏下拉"
               # 状态栏打开后，点空白处关闭或按语音键
               click $(random_range 100 540) $(random_range 10 50); sleep 0.5 ;;
        esac
        sleep $(random_range 1 2); page_inc
        i=$((i + 1))
    done
}

# ---- 场景1: 桌面全遍历 ----
test_desktop_traversal() {
    log_msg "=== 场景1: 桌面全遍历 (${DESKTOP_PAGES}页) ==="
    # 回到首页
    go_home; sleep 0.5
    swipe_right; swipe_right; swipe_right; swipe_right
    go_home; sleep 0.5

    pg=0
    while [ $pg -lt $DESKTOP_PAGES ]; do
        log_msg "--- P${pg} ---"
        a=0
        while [ $a -lt $APPS_PER_PAGE ]; do
            ax=$(random_range 60 580)
            ay=$(random_range 15 150)
            log_msg "  P${pg} 点击应用 ($ax, $ay)"
            click $ax $ay; page_inc; sleep 2
            test_rapid_tap
            explore_inpage "P${pg}A${a}" 8
            go_home; sleep 1
            a=$((a + 1))
        done
        [ $pg -lt $((DESKTOP_PAGES - 1)) ] && swipe_left
        pg=$((pg + 1))
    done
    swipe_right; swipe_right; swipe_right; swipe_right
    go_home; sleep 1
}

# ---- 场景2: 状态栏专项测试 ----
test_statusbar() {
    log_msg "=== 场景2: 状态栏专项 ==="
    go_home; sleep 1

    # 桌面上下拉状态栏
    log_msg "  桌面下拉状态栏"
    pull_statusbar
    # 在状态栏内点几个快捷开关
    i=0
    while [ $i -lt 4 ]; do
        click $(random_range 80 560) $(random_range 10 100)
        log_msg "  状态栏内点击 #$i"; sleep 0.5; page_inc
        i=$((i + 1))
    done
    # 从底部上滑关闭状态栏
    swipe $CENTER_X 120 $CENTER_X 1 6; sleep 0.5
    log_msg "  关闭状态栏"

    # 应用内下拉状态栏
    click $(random_range 80 560) $(random_range 20 130); sleep 2
    log_msg "  应用内下拉状态栏"
    pull_statusbar
    click $(random_range 80 560) $(random_range 10 100); sleep 0.5; page_inc
    go_home
}

# ---- 场景3: 扫描深度测试 ----
test_scan_deep() {
    log_msg "=== 场景3: 扫描深度测试 ==="
    go_home; sleep 1
    r=0
    while [ $r -lt 5 ]; do
        log_msg "  扫描轮 $((r+1))"
        start_scan $(random_range 1 3)
        sleep $(random_range 3 6)
        explore_inpage "scan" 8
        scroll_up; sleep 0.5; page_inc
        explore_inpage "scan" 8
        sleep 8
        go_home; sleep 1
        r=$((r + 1))
    done
}

# ---- 场景4: 休眠唤醒 ----
test_sleep_wake() {
    log_msg "=== 场景4: 休眠唤醒 ==="
    go_home; sleep 1
    log_msg "  休眠"; press_power; sleep 3
    log_msg "  唤醒"; press_power; sleep 2
    go_home; sleep 1
    log_msg "  唤醒后验证"; click $(random_range 80 560) $(random_range 20 130)
    sleep 1.5; go_home; page_inc
}

# ---- 场景5: 快速切换压力 ----
test_stress_mix() {
    log_msg "=== 场景5: 快速切换压力 ==="
    go_home; sleep 1
    s=0
    while [ $s -lt 5 ]; do
        click $(random_range 80 560) $(random_range 20 130); sleep 1.5; page_inc
        scroll_up; sleep 0.5; page_inc
        click $(random_range $MX $RIGHT_X) $(random_range $MY $BOTTOM_Y); sleep 0.5; page_inc
        go_home; sleep 0.6
        s=$((s + 1))
    done
}

# ---- 场景6: 边界点击 ----
test_boundary() {
    log_msg "=== 场景6: 边界点击 ==="
    click $MX $MY; click $RIGHT_X $MY
    click $MX $BOTTOM_Y; click $RIGHT_X $BOTTOM_Y
    click $CENTER_X 1; click $CENTER_X $BOTTOM_Y
    click 1 $CENTER_Y; click $RIGHT_X $CENTER_Y
    page_inc
}

# ---- 场景7: 快速连点 ----
test_rapid_tap() {
    tap_count=${1:-30}
    # log_msg "=== 场景7: 快速连点 ==="
    # log_msg "  随机坐标 × ${tap_count}"
    i=0
    while [ $i -lt $tap_count ]; do
        cx=$(random_range 10 630); cy=$(random_range 10 160)
        # log_msg "    点击 #$((i+1)): ($cx, $cy)"
        send_event touch press $cx $cy >/dev/null 2>&1; sleep 0.05
        send_event touch release >/dev/null 2>&1; sleep 0.05
        i=$((i + 1))
        sleep 1
    done
    sleep 1; page_inc
}

# ---- 场景8: 菜单探索 ----
test_menu() {
    log_msg "=== 场景8: 菜单探索 ==="
    go_home; sleep 1
    press_menu; sleep 2
    explore_inpage "menu" 8
    go_home
}

# ---- 场景9: 连续扫描 ----
test_scan_burst() {
    log_msg "=== 场景9: 连续扫描 ==="
    go_home; sleep 1
    b=0
    while [ $b -lt 5 ]; do
        log_msg "  扫描 #$b"
        send_event camera press >/dev/null 2>&1; sleep 1
        send_event camera release >/dev/null 2>&1; sleep 1
        b=$((b + 1)); page_inc
    done
    sleep 8; go_home
}

# ---- 场景10: 上下滑动回弹 ----
test_scroll_bounce() {
    log_msg "=== 场景10: 边界回弹滑动 ==="
    go_home; sleep 1
    click $(random_range 80 560) $(random_range 20 130); sleep 2
    r=0
    while [ $r -lt 4 ]; do
        swipe $CENTER_X $BOTTOM_Y $CENTER_X $MY 8; log_msg "  快速上滑"; sleep 0.3
        swipe $CENTER_X $MY $CENTER_X $BOTTOM_Y 8; log_msg "  快速下滑"; sleep 0.3
        r=$((r + 1)); page_inc
    done
    go_home
}

# ---- 场景11: 语音键专项（在各页面按语音键验证返回桌面）----
test_asr_nav() {
    log_msg "=== 场景11: 语音键导航验证 ==="
    go_home; sleep 1
    r=0
    while [ $r -lt 4 ]; do
        # 进入不同应用
        click $(random_range 80 560) $(random_range 20 130); sleep 2; page_inc
        explore_inpage "asr_test" 8
        # 按语音键返回
        log_msg "  按语音键返回"; go_home
        r=$((r + 1))
    done
}

test_two_cycle() { 
    log_msg "=== 测试二屏应用 ==="
    go_home; sleep 1
    scroll_up; sleep 0.5; page_inc
    test_rapid_tap
    go_home; sleep 1
    scroll_up; sleep 0.5; page_inc
    test_rapid_tap

}

# ---- 内存 ----
check_memory() {
    mem=$(miniapp_cli memoryApp 2>/dev/null | grep fordblks | head -1)
    [ -n "$mem" ] && log_msg "[内存] $mem"
}

main() {
    init_test
    cycle=0
    while true; do
        cycle=$((cycle + 1))
        echo "${cycle}" > "${CYCLE_LOG}"

        log_msg "===== CYCLE ${cycle} START ====="
        check_memory

        if [ $((cycle % 2)) -eq 1 ]; then
            log_msg "[模式] 全量 (11场景)"
            test_desktop_traversal
            test_statusbar
            test_scan_deep
            test_sleep_wake
            test_stress_mix
            test_boundary
            test_rapid_tap
            test_menu
            test_scan_burst
            test_scroll_bounce
            test_asr_nav
            test_two_cycle
        else
            log_msg "[模式] 核心 (6场景)"
            test_desktop_traversal
            test_statusbar
            test_scan_deep
            test_stress_mix
            test_boundary
            test_asr_nav
            test_two_cycle
        fi

        go_home; sleep 1
        echo "CYCLE=${cycle} OPS=${total_ops}" > "${RESULT_FILE}"
        check_memory
        log_msg "===== CYCLE ${cycle} END (ops=${total_ops}) ====="
    done
}

main
