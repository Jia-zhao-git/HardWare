#!/bin/sh
# 随机Monkey测试脚本 - 优化版
# 功能：随机扫描、点击、滑动、打开APP等操作，并在关键操作后添加额外随机测试
# 坐标范围：X: 1-630, Y: 1-170

# 设置错误处理：忽略错误继续执行
set +e

# APP ID 列表（使用空格分隔）
APP_IDS="8001650599023931 8001666679481944 8001670668055425 8001671616562847 8001707294117702 8080212246010681 8080212335092787 8080222437664451 8080222501178405 8080232418330628 8080252464522508 8080262605498742 8080272425914438 8080282263329158 8080282888534774 8080292001695606 8080292157485624"

# 计算APP数量
APP_COUNT=0
for app in $APP_IDS; do
    APP_COUNT=$((APP_COUNT + 1))
done

echo "=========================================="
echo "开始随机Monkey测试（优化版）"
echo "APP数量: $APP_COUNT"
echo "坐标范围: X(1-630), Y(1-170)"
echo "=========================================="

# 生成随机数函数
random_range() {
    min=$1
    max=$2
    echo $(( (RANDOM % (max - min + 1)) + min ))
}

# 随机延迟函数（秒）
random_delay() {
    min=$1
    max=$2
    delay=$(random_range $min $max)
    echo "等待 ${delay} 秒..."
    sleep $delay
}

# 获取随机APP ID
get_random_app() {
    index=$(random_range 1 $APP_COUNT)
    echo "$APP_IDS" | cut -d' ' -f$index
}

# 执行随机点击
random_click() {
    x=$(random_range 1 630)
    y=$(random_range 1 170)
    echo "  [随机点击] ($x, $y)"
    send_event touch press $x $y || true
    sleep 0.1 || true
    send_event touch release || true
    sleep 0.5 || true
}

# 执行随机滑动
random_swipe() {
    x1=$(random_range 1 630)
    y1=$(random_range 1 170)
    x2=$(random_range 1 630)
    y2=$(random_range 1 170)
    echo "  [随机滑动] ($x1,$y1) -> ($x2,$y2)"
    send_event touch press $x1 $y1 || true
    sleep 0.05 || true
    send_event touch slip $x2 $y2 || true
    sleep 0.1 || true
    send_event touch release || true
    sleep 0.5 || true
}

# 在页面上执行多次随机操作（用于扫描后、打开APP后等场景）
perform_random_actions() {
    count=$1
    echo "  执行 $count 次随机操作..."
    i=0
    while [ $i -lt $count ]; do
        action=$(random_range 0 1)
        if [ $action -eq 0 ]; then
            random_click
        else
            random_swipe
        fi
        i=$((i + 1))
    done
}

# 操作计数器
operation_count=0

# 无限循环执行随机操作
while true; do
    operation_count=$((operation_count + 1))
    echo ""
    echo "========== 第 $operation_count 次主操作 =========="
    
    # 随机选择操作类型 (0:扫描, 1:点击, 2:滑动, 3:打开APP, 4:返回桌面)
    action_type=$(random_range 0 4)
    
    case $action_type in
        0)
            # 扫描操作（使用触控笔）
            echo "[扫描] 执行扫描操作..."
            send_event camera press || true
            sleep 3 || true
            send_event camera release || true
            
            # 扫描后等待释义出现（8-15秒）
            echo "[扫描] 等待释义加载..."
            random_delay 8 15
            
            # 在扫描结果页进行多次随机测试（5-8次）
            extra_actions=$(random_range 5 8)
            perform_random_actions $extra_actions
            
            echo "[扫描] 完成"
            ;;
            
        1)
            # 随机点击操作
            x=$(random_range 1 630)
            y=$(random_range 1 170)
            echo "[点击] 点击坐标: ($x, $y)"
            
            send_event touch press $x $y || true
            sleep 0.1 || true
            send_event touch release || true
            
            # 点击后短暂延迟（1-3秒）
            random_delay 1 3
            echo "[点击] 完成"
            ;;
            
        2)
            # 随机滑动操作
            x1=$(random_range 1 630)
            y1=$(random_range 1 170)
            x2=$(random_range 1 630)
            y2=$(random_range 1 170)
            echo "[滑动] 从 ($x1, $y1) 滑动到 ($x2, $y2)"
            
            send_event touch press $x1 $y1 || true
            sleep 0.05 || true
            send_event touch slip $x2 $y2 || true
            sleep 0.1 || true
            send_event touch release || true
            
            # 滑动后短暂延迟（1-2秒）
            random_delay 1 2
            echo "[滑动] 完成"
            ;;
            
        3)
            # 随机打开APP
            app_id=$(get_random_app)
            echo "[打开APP] 打开APP ID: $app_id"
            miniapp_cli start $app_id || true
            
            # 打开APP后等待加载（5-8秒）
            echo "[打开APP] 等待APP加载..."
            random_delay 5 8
            
            # 在APP内进行多次随机测试（6-10次）
            extra_actions=$(random_range 6 10)
            perform_random_actions $extra_actions
            
            echo "[打开APP] 完成"
            ;;
            
        4)
            # 返回桌面
            echo "[返回桌面] 返回主界面..."
            miniapp_cli start 8080222437664451 || true
            
            # 等待桌面加载（3-5秒）
            echo "[返回桌面] 等待桌面加载..."
            random_delay 3 5
            
            # 在桌面上进行多次随机测试（4-6次）
            extra_actions=$(random_range 4 6)
            perform_random_actions $extra_actions
            
            echo "[返回桌面] 完成"
            ;;
    esac
    
    # 每次主操作后额外延迟（避免操作过快）
    sleep 2
    
done

echo "测试结束"
