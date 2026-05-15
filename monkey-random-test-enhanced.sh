#!/bin/sh
# 随机Monkey测试脚本 - 增强版（无限循环）
# 功能：随机扫描、点击、滑动、打开APP等操作，长时间稳定运行
# 坐标范围：X: 20-610, Y: 20-150（避开边缘）

# ==================== 配置区 ====================
# 坐标安全边距
MIN_X=20
MAX_X=610
MIN_Y=20
MAX_Y=150

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
echo "坐标范围: X(${MIN_X}-${MAX_X}), Y(${MIN_Y}-${MAX_Y})"
echo "运行模式: 持续运行，手动停止"
echo "内存监控: 每分钟记录一次 -> $MEMORY_LOG_FILE"
echo "=========================================="

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

# 执行随机点击
random_click() {
    x=$(random_range $MIN_X $MAX_X)
    y=$(random_range $MIN_Y $MAX_Y)
    echo "[$(get_timestamp)]   [随机点击] ($x, $y)"
    send_event touch press $x $y || true
    sleep 0.1 || true
    send_event touch release || true
    sleep 0.3 || true
}

# 执行随机滑动
random_swipe() {
    x1=$(random_range $MIN_X $MAX_X)
    y1=$(random_range $MIN_Y $MAX_Y)
    x2=$(random_range $MIN_X $MAX_X)
    y2=$(random_range $MIN_Y $MAX_Y)
    echo "[$(get_timestamp)]   [随机滑动] ($x1,$y1) -> ($x2,$y2)"
    send_event touch press $x1 $y1 || true
    sleep 0.05 || true
    send_event touch slip $x2 $y2 || true
    sleep 0.1 || true
    send_event touch release || true
    sleep 0.3 || true
}

# 执行随机长按
random_long_press() {
    x=$(random_range $MIN_X $MAX_X)
    y=$(random_range $MIN_Y $MAX_Y)
    duration=$(random_range 1 2)
    echo "[$(get_timestamp)]   [随机长按] ($x, $y) ${duration}秒"
    send_event touch press $x $y || true
    sleep $duration || true
    send_event touch release || true
    sleep 0.5 || true
}

# 在页面上执行多次随机操作
perform_random_actions() {
    count=$1
    echo "[$(get_timestamp)]   执行 $count 次随机操作..."
    i=0
    while [ $i -lt $count ]; do
        # 0:点击, 1:滑动, 2:长按
        action=$(random_range 0 2)
        case $action in
            0) random_click ;;
            1) random_swipe ;;
            2) random_long_press ;;
        esac
        i=$((i + 1))
    done
}

# 在等待期间执行随机操作（模拟用户在等待时的随机交互）
perform_waiting_actions() {
    duration=$1
    echo "[$(get_timestamp)]   开始 $duration 秒等待期间的随机操作..."
    
    start_time=$(date +%s)
    current_time=$start_time
    
    while [ $((current_time - start_time)) -lt $duration ]; do
        # 随机决定操作类型
        action=$(random_range 0 2)
        case $action in
            0) random_click ;;
            1) random_swipe ;;
            2) random_long_press ;;
        esac
        
        # 随机延迟（0.5-2秒），不超过总等待时间
        delay=$(random_range 5 20)
        delay=$(echo $delay | awk '{print $1/10}')  # 转换为0.5-2.0秒
        sleep $delay 2>/dev/null || sleep 1
        
        current_time=$(date +%s)
        # 确保不超过总等待时间
        if [ $((current_time - start_time)) -ge $duration ]; then
            break
        fi
    done
    
    echo "[$(get_timestamp)]   等待期间随机操作完成"
}

# 记录内存数据
record_memory_data() {
    current_time=$(date +%s)
    elapsed=$((current_time - LAST_MEMORY_CHECK))
    
    # 每分钟记录一次（60秒）
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

# 主循环
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
            
            # 扫描后等待释义出现（20-70秒），期间执行随机操作
            wait_duration=$(random_range 20 70)
            echo "[$(get_timestamp)] [扫描] 等待释义加载 (${wait_duration}秒)..."
            perform_waiting_actions $wait_duration
            
            # 在扫描结果页进行多次随机测试（8-15次）
            extra_actions=$(random_range 8 15)
            perform_random_actions $extra_actions
            
            echo "[$(get_timestamp)] [扫描] 完成"
            ;;
            
        1)
            # 随机点击操作
            x=$(random_range $MIN_X $MAX_X)
            y=$(random_range $MIN_Y $MAX_Y)
            echo "[$(get_timestamp)] [点击] 点击坐标: ($x, $y)"
            
            send_event touch press $x $y || true
            sleep 0.1 || true
            send_event touch release || true
            
            random_delay 1 3
            echo "[$(get_timestamp)] [点击] 完成"
            ;;
            
        2)
            # 随机滑动操作
            x1=$(random_range $MIN_X $MAX_X)
            y1=$(random_range $MIN_Y $MAX_Y)
            x2=$(random_range $MIN_X $MAX_X)
            y2=$(random_range $MIN_Y $MAX_Y)
            echo "[$(get_timestamp)] [滑动] 从 ($x1, $y1) 滑动到 ($x2, $y2)"
            
            send_event touch press $x1 $y1 || true
            sleep 0.05 || true
            send_event touch slip $x2 $y2 || true
            sleep 0.1 || true
            send_event touch release || true
            
            random_delay 1 2
            echo "[$(get_timestamp)] [滑动] 完成"
            ;;
            
        3)
            # 随机打开APP
            app_id=$(get_random_app)
            echo "[$(get_timestamp)] [打开APP] 打开APP ID: $app_id"
            miniapp_cli start $app_id || true
            
            # 打开APP后等待加载（20-70秒），期间执行随机操作
            wait_duration=$(random_range 20 70)
            echo "[$(get_timestamp)] [打开APP] 等待APP加载 (${wait_duration}秒)..."
            perform_waiting_actions $wait_duration
            
            # 在APP内进行多次随机测试（10-20次）
            extra_actions=$(random_range 10 20)
            perform_random_actions $extra_actions
            
            echo "[$(get_timestamp)] [打开APP] 完成"
            ;;
            
        4)
            # 返回桌面
            echo "[$(get_timestamp)] [返回桌面] 返回主界面..."
            miniapp_cli start $DESKTOP_APP_ID || true
            
            # 返回桌面后等待加载（15-40秒），期间执行随机操作
            wait_duration=$(random_range 15 40)
            echo "[$(get_timestamp)] [返回桌面] 等待桌面加载 (${wait_duration}秒)..."
            perform_waiting_actions $wait_duration
            
            # 在桌面上进行多次随机测试（8-12次）
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
