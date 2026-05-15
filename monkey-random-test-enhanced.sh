#!/bin/sh
# 随机Monkey测试脚本 - 增强版（无限循环）
# 功能：随机扫描、点击、滑动、打开APP等操作，长时间稳定运行
# 优化：参考 monkey.sh 的分步滑动 + 设备坐标映射 + 方向感知

# ==================== 配置区 ====================
# APP ID 列表
APP_IDS="8001650599023931 8001666679481944 8001670668055425 8001671616562847 8001707294117702 8080212246010681 8080212335092787 8080222437664451 8080222501178405 8080232418330628 8080252464522508 8080262605498742 8080272425914438 8080282263329158 8080282888534774 8080292001695606 8080292157485624"

# 桌面APP ID
DESKTOP_APP_ID="8080222437664451"

# 内存数据记录文件路径
MEMORY_LOG_FILE="/data/memory_monitor.log"
# ===============================================

# 设置错误处理
set +e

# 计算APP数量
APP_COUNT=0
for app in $APP_IDS; do
    APP_COUNT=$((APP_COUNT + 1))
done

# 记录开始时间
START_TIME=$(date +%s)
LAST_MEMORY_CHECK=$START_TIME

echo "=========================================="
echo "开始随机Monkey测试（增强版 - 无限循环）"
echo "APP数量: $APP_COUNT"
echo "运行模式: 持续运行，手动停止"
echo "内存监控: 每分钟记录一次 -> $MEMORY_LOG_FILE"
echo "=========================================="

# 获取设备SKU
SKU=""
SKU=$(yd_misc_info_tool -r YD_LINUX_SKU_ID -t string 2>/dev/null | awk 'NF{print $NF; exit}')
if [ -z "$SKU" ]; then
    SKU=$(vendor_storage -r VENDOR_CUSTOM_ID_0E -t string 2>/dev/null | awk 'NF{print $NF; exit}')
fi
if [ -z "$SKU" ]; then
    SKU="unknown"
fi
echo "设备SKU: $SKU"

# 获取设备分辨率
WIDTH=0
HEIGHT=0
cfg_file="/etc/miniapp/resources/cfg.json"
if [ -f "$cfg_file" ]; then
    cfg_content=$(cat "$cfg_file" 2>/dev/null)
    WIDTH=$(echo "$cfg_content" | grep '"width"' | awk -F': *' '{print $2}' | tr -d ', "')
    HEIGHT=$(echo "$cfg_content" | grep '"height"' | awk -F': *' '{print $2}' | tr -d ', "')
fi
# 如果解析失败，使用默认值
[ -z "$WIDTH" ] || [ "$WIDTH" -eq 0 ] 2>/dev/null && WIDTH=1024
[ -z "$HEIGHT" ] || [ "$HEIGHT" -eq 0 ] 2>/dev/null && HEIGHT=600

echo "分辨率: ${WIDTH}x${HEIGHT}"

# 判断设备类型（参考 monkey.sh 的分类逻辑）
IS_Y07_TYPE=false
IS_Y03_TYPE=false
IS_LANDSCAPE_OFFSET_TYPE=false
IS_LANDSCAPE_NO_OFFSET_TYPE=false

case "$SKU" in
    *OVERHEAD_Y07*)
        IS_Y07_TYPE=true
        ;;
    *OVERHEAD_Y03*|*OVERHEAD_Y09P*|*OVERHEAD_Y09*|*OVERHEAD_A62*)
        IS_Y03_TYPE=true
        ;;
    *OVERHEAD_Y01*|*OVERHEAD_S61*|*OVERHEAD_P6*|*OVERHEAD_X62*|*OVERHEAD_X61*|*OVERHEAD_P5*|*OVERHEAD_X5*|*OVERHEAD_D3*|*OVERHEAD_X3S*)
        IS_LANDSCAPE_OFFSET_TYPE=true
        ;;
    *OVERHEAD_Y02*|*OVERHEAD_Y08*|*OVERHEAD_A61*|*OVERHEAD_S62*)
        IS_LANDSCAPE_NO_OFFSET_TYPE=true
        ;;
    *)
        IS_Y03_TYPE=true
        ;;
esac

# 坐标规范化与映射（基于模拟坐标文档的静态配置）
# 输入：u, v（系统内部坐标系）
# 输出：x, y（设备实际坐标）
map_uv_to_xy() {
    u="$1"
    v="$2"
    w="$WIDTH"
    h="$HEIGHT"
    x=""
    y=""

    if [ "$IS_Y07_TYPE" = true ]; then
        # Y07: tp_direction=180, 原点右下角, width=x, height=y
        x=$((w - 1 - u))
        y=$((h - 1 - v))
    elif [ "$IS_Y03_TYPE" = true ]; then
        # Y03/Y09P/Y09/A62: tp_direction=0, 原点左上角, width=x, height=y
        x=$u
        y=$v
    elif [ "$IS_LANDSCAPE_OFFSET_TYPE" = true ]; then
        # Y01/S61/P6/X62/X61/P5/X5/D3/X3S: tp_direction=270, 原点右上角, width=y, height=x, 需要107偏移
        x=$((h - 1 - v + 107))
        y=$u
    elif [ "$IS_LANDSCAPE_NO_OFFSET_TYPE" = true ]; then
        # Y02/Y08/A61/S62: 根据具体设备类型处理
        case "$SKU" in
            *OVERHEAD_Y02*|*OVERHEAD_A61*)
                x=$((h - 1 - v))
                y=$u
                ;;
            *OVERHEAD_Y08*)
                x=$((w - 1 - v))
                y=$u
                ;;
            *OVERHEAD_S62*)
                x=$v
                y=$u
                ;;
        esac
    else
        x=$u
        y=$v
    fi
    echo "$x $y"
}

# ==================== 工具函数 ====================

# 解析坐标字符串为两个变量（POSIX sh 兼容）
parse_coords() {
    coord_str="$1"
    COORD_X=$(echo "$coord_str" | cut -d' ' -f1)
    COORD_Y=$(echo "$coord_str" | cut -d' ' -f2)
}

# 生成随机数函数
random_range() {
    min=$1
    max=$2
    echo $(( (RANDOM % (max - min + 1)) + min ))
}

# 获取时间戳
get_timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# 随机延迟函数（秒）
random_delay() {
    min=$1
    max=$2
    delay=$(random_range $min $max)
    echo "[$(get_timestamp)] 等待 ${delay} 秒..."
    sleep $delay
}

# 获取随机APP ID
get_random_app() {
    index=$(random_range 1 $APP_COUNT)
    echo "$APP_IDS" | cut -d' ' -f$index
}

# ----------------------------
# 优化：滑动操作（简化版，直接使用坐标）
# ----------------------------
random_swipe() {
    w="$WIDTH"
    h="$HEIGHT"

    # 确保分辨率有效
    if [ "$w" -eq 0 ] || [ "$h" -eq 0 ]; then
        echo "[$(get_timestamp)] [警告] 分辨率无效 (${w}x${h})，跳过滑动"
        return
    fi

    # 随机生成起点和终点坐标
    x1=$(random_range 50 $((w - 50)))
    y1=$(random_range 50 $((h / 2)))
    x2=$(random_range 50 $((w - 50)))
    y2=$(random_range $((h / 2)) $((h - 50)))

    echo "[$(get_timestamp)] [随机滑动] ($x1,$y1) -> ($x2,$y2)"
    
    # 简单的三段式滑动：press -> slip -> release
    # 注意：某些设备可能需要 Y X 的顺序
    send_event touch press $y1 $x1 || true
    sleep 0.1 || true
    send_event touch slip $y2 $x2 || true
    sleep 0.1 || true
    send_event touch release || true
    sleep 0.3 || true
}

# ----------------------------
# 优化：连续滑动（用于下拉/上滑操作，类似 go_home）
# ----------------------------
continuous_swipe() {
    w="$WIDTH"
    h="$HEIGHT"
    direction="$1"  # "up" 或 "down"

    # 确保分辨率有效
    if [ "$w" -eq 0 ] || [ "$h" -eq 0 ]; then
        echo "[$(get_timestamp)] [警告] 分辨率无效 (${w}x${h})，跳过连续滑动"
        return
    fi

    # 随机选择X坐标
    x_pos=$(random_range 50 $((w - 50)))

    if [ "$direction" = "up" ]; then
        y_start=$((h - 20))
        y_end=20
        echo "[$(get_timestamp)] [连续滑动] 方向=上 ($x_pos,$y_start) -> ($x_pos,$y_end)"
    else
        y_start=20
        y_end=$((h - 20))
        echo "[$(get_timestamp)] [连续滑动] 方向=下 ($x_pos,$y_start) -> ($x_pos,$y_end)"
    fi

    # 简单的三段式滑动（Y X 顺序）
    send_event touch press $y_start $x_pos || true
    sleep 0.1 || true
    send_event touch slip $y_end $x_pos || true
    sleep 0.1 || true
    send_event touch release || true
    sleep 0.3 || true
}

# ----------------------------
# 随机点击（直接使用坐标）
# ----------------------------
random_click() {
    w="$WIDTH"
    h="$HEIGHT"

    # 确保分辨率有效
    if [ "$w" -eq 0 ] || [ "$h" -eq 0 ]; then
        echo "[$(get_timestamp)] [警告] 分辨率无效 (${w}x${h})，跳过点击"
        return
    fi

    x_click=$(random_range 20 $((w - 20)))
    y_click=$(random_range 20 $((h - 20)))

    echo "[$(get_timestamp)] [随机点击] ($x_click, $y_click)"
    send_event touch press $y_click $x_click || true
    sleep 0.15 || true
    send_event touch release || true
    sleep 0.2 || true
}

# ----------------------------
# 在页面上执行多次随机操作（只包含点击和滑动）
# ----------------------------
perform_random_actions() {
    count=$1
    echo "[$(get_timestamp)] 执行 $count 次随机操作..."
    i=0
    while [ $i -lt $count ]; do
        # 0:点击, 1:滑动（各50%概率）
        action=$(random_range 0 1)
        case $action in
            0) random_click ;;
            1) random_swipe ;;
        esac
        i=$((i + 1))
    done
}

# ----------------------------
# 在等待期间执行随机操作（模拟用户在等待时的随机交互）
# ----------------------------
perform_waiting_actions() {
    duration=$1
    echo "[$(get_timestamp)] 开始 $duration 秒等待期间的随机操作..."

    start_time=$(date +%s)
    current_time=$start_time

    while [ $((current_time - start_time)) -lt $duration ]; do
        # 0:点击, 1:滑动（各50%概率）
        action=$(random_range 0 1)
        case $action in
            0) random_click ;;
            1) random_swipe ;;
        esac

        # 随机延迟（0.3-1.5秒），不超过总等待时间
        delay=$(random_range 3 15)
        delay=$(echo $delay | awk '{print $1/10}')
        sleep $delay 2>/dev/null || sleep 1

        current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $duration ]; then
            break
        fi
    done

    echo "[$(get_timestamp)] 等待期间随机操作完成"
}

# ----------------------------
# 记录内存数据
# ----------------------------
record_memory_data() {
    current_time=$(date +%s)
    elapsed=$((current_time - LAST_MEMORY_CHECK))

    if [ $elapsed -ge 60 ]; then
        timestamp=$(get_timestamp)
        memory_data=$(miniapp_cli memoryApp | grep fordblks || true)

        if [ -n "$memory_data" ]; then
            echo "[$timestamp] $memory_data" >> $MEMORY_LOG_FILE
            echo "[$timestamp] [内存监控] 已记录: $memory_data"
        else
            echo "[$timestamp] [内存监控] 获取失败" >> $MEMORY_LOG_FILE
        fi

        LAST_MEMORY_CHECK=$current_time
    fi
}

# 操作计数器
operation_count=0
last_action_type=-1

# ==================== 主循环 ====================
while true; do
    operation_count=$((operation_count + 1))
    echo ""
    echo "========== $(get_timestamp) 第 $operation_count 次主操作 =========="

    # 检查并记录内存数据
    record_memory_data

    # 随机选择操作类型，避免连续相同操作
    while true; do
        action_type=$(random_range 0 4)
        if [ $action_type -ne $last_action_type ]; then
            break
        fi
    done
    last_action_type=$action_type

    case $action_type in
        0)
            # 扫描操作
            echo "[$(get_timestamp)] [扫描] 执行扫描操作..."
            send_event camera press || true
            sleep 3 || true
            send_event camera release || true

            wait_duration=$(random_range 20 70)
            echo "[$(get_timestamp)] [扫描] 等待释义加载 (${wait_duration}秒)..."
            perform_waiting_actions $wait_duration

            extra_actions=$(random_range 8 15)
            perform_random_actions $extra_actions

            echo "[$(get_timestamp)] [扫描] 完成"
            ;;

        1)
            # 随机点击操作
            random_click
            random_delay 1 3
            echo "[$(get_timestamp)] [点击] 完成"
            ;;

        2)
            # 随机滑动操作（优化：使用分步滑动 + 映射坐标）
            random_swipe
            random_delay 1 2
            echo "[$(get_timestamp)] [滑动] 完成"
            ;;

        3)
            # 随机打开APP
            app_id=$(get_random_app)
            echo "[$(get_timestamp)] [打开APP] 打开APP ID: $app_id"
            miniapp_cli start $app_id || true

            wait_duration=$(random_range 20 70)
            echo "[$(get_timestamp)] [打开APP] 等待APP加载 (${wait_duration}秒)..."
            perform_waiting_actions $wait_duration

            extra_actions=$(random_range 10 20)
            perform_random_actions $extra_actions

            echo "[$(get_timestamp)] [打开APP] 完成"
            ;;

        4)
            # 返回桌面
            echo "[$(get_timestamp)] [返回桌面] 返回主界面..."
            miniapp_cli start $DESKTOP_APP_ID || true

            wait_duration=$(random_range 15 40)
            echo "[$(get_timestamp)] [返回桌面] 等待桌面加载 (${wait_duration}秒)..."
            perform_waiting_actions $wait_duration

            extra_actions=$(random_range 8 12)
            perform_random_actions $extra_actions

            echo "[$(get_timestamp)] [返回桌面] 完成"
            ;;
    esac

    # 每次主操作后额外延迟
    sleep 2

done

echo ""
echo "=========================================="
echo "测试已停止（手动中断）"
echo "总执行次数: $operation_count"
echo "=========================================="
