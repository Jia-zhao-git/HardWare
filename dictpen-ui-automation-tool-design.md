# 有道词典笔 UI 自动化测试工具设计

## 1. 目标

设计一个面向有道词典笔的 UI 自动化测试工具，通过 ADB 驱动设备完成页面导航、点击、滑动、截图、断言、日志采集和测试报告生成。

当前验证设备：

- ADB Serial: `7G50900011900174`
- SKU: `OVERHEAD_Y18_SKU_CHN_PLUS`
- 系统: Buildroot Linux
- 屏幕截图分辨率: `936 x 280`
- 触控设备: `sitronix_ts_spi`
- 可用能力: `send_event`, `miniapp_cli capture`, `miniapp_cli memoryApp`, `miniapp_cli start`, `miniapp_cli injectKey`

## 2. 核心原则

- 不依赖 Android UIAutomator，因为词典笔不是标准 Android UI 栈。
- 以截图、坐标、事件、日志为主，而不是 View 层级。
- 坐标系统必须按 SKU 适配，不能硬编码单一机型。
- 所有点击前都要先截图，所有关键操作后都要截图验证。
- 测试脚本要可读、可复用、可回放。
- 工具先保证稳定性，再逐步引入 OCR/图像识别。

## 3. 工具形态

建议做成一个 Python CLI 工具：`dictpen-ui`。

常用命令：

```bash
dictpen-ui devices
dictpen-ui info --serial 7G50900011900174
dictpen-ui screenshot --serial 7G50900011900174 --out out/home.png
dictpen-ui tap --serial 7G50900011900174 --x 468 --y 140
dictpen-ui swipe --serial 7G50900011900174 --from 800,140 --to 100,140 --ms 300
dictpen-ui run --serial 7G50900011900174 tests/wordbook.yaml
dictpen-ui report runs/20260728-1720
```

## 4. 总体架构

```text
┌────────────────────────────┐
│ CLI / Test Runner           │
│ dictpen-ui run xxx.yaml     │
└─────────────┬──────────────┘
              │
┌─────────────▼──────────────┐
│ Test DSL Engine             │
│ 解析 YAML / 执行动作 / 断言 │
└─────────────┬──────────────┘
              │
┌─────────────▼──────────────┐
│ Device Session              │
│ adb shell / adb pull / log  │
└──────┬───────────────┬─────┘
       │               │
┌──────▼──────┐  ┌─────▼────────┐
│ Input Driver │  │ Capture Driver │
│ send_event   │  │ miniapp_cli    │
└──────┬──────┘  └─────┬────────┘
       │               │
┌──────▼───────────────▼───────┐
│ Coordinate / Perception Layer │
│ SKU 映射 / OCR / 图像匹配     │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ Artifacts / Report            │
│ 截图、日志、步骤结果、HTML    │
└──────────────────────────────┘
```

## 5. 模块设计

### 5.1 Device Discovery

职责：发现设备、校验连接状态、读取基础信息。

实现：

- `adb devices -l`
- `cat /data/cfg/sys_config.conf`
- `cat /etc/miniapp/resources/cfg.json`
- `cat /proc/cpuinfo`
- `cat /proc/meminfo`
- `df -h`

输出结构：

```json
{
  "serial": "7G50900011900174",
  "sku": "OVERHEAD_Y18_SKU_CHN_PLUS",
  "screen": {
    "width": 280,
    "height": 936,
    "direction": 270,
    "tp_direction": 270
  },
  "screenshot": {
    "width": 936,
    "height": 280
  }
}
```

### 5.2 Input Driver

职责：封装触控、按键、滑动。

底层命令：

```bash
send_event touch press <x> <y>
send_event touch release
send_event touch slip <x1> <y1> <x2> <y2> <ms>
send_event asr press
send_event asr release
send_event camera press
send_event camera release
send_event menu press
send_event menu release
```

封装 API：

```python
tap(x, y, duration_ms=120)
swipe(x1, y1, x2, y2, duration_ms=300)
press_key("asr")
press_key("camera")
press_key("menu")
wake()
home()
```

### 5.3 Coordinate Adapter

职责：根据 SKU、截图方向、触控方向转换坐标。

核心问题：

- `cfg.json` 中屏幕为 `280 x 936`，方向 `270`。
- 实际截图为 `936 x 280`。
- Y18 的触控映射需要实测确认，不能直接套 Y15C。

建议坐标策略：

- 内部统一使用截图坐标：`screen_x, screen_y`，原点左上。
- 执行前转换为触控坐标：`touch_x, touch_y`。
- 为每个 SKU 单独维护映射函数。

接口：

```python
screen_to_touch(screen_x, screen_y) -> tuple[int, int]
touch_to_screen(touch_x, touch_y) -> tuple[int, int]
```

Y18 初始映射建议：

```python
# 初版：截图坐标直接传给 send_event。
# 已实测 x=468,y=140 可成功触发触控事件，但是否命中目标需继续确认。
def screen_to_touch_y18(x, y):
    return x, y
```

后续通过九宫格点击校准自动修正。

### 5.4 Screenshot Driver

职责：截图、拉取、保存、命名、对比。

底层命令：

```bash
miniapp_cli capture /tmp/screen.png
adb pull /tmp/screen.png runs/<run_id>/steps/001.png
```

截图命名：

```text
runs/20260728-172000/
  steps/
    001_before_home.png
    002_after_tap_wordbook.png
    003_assert_wordbook.png
```

### 5.5 Perception Layer

第一阶段不强依赖 OCR，先做三类断言：

- 截图变化断言：点击前后图片 hash/差异是否变化。
- 模板匹配断言：固定入口图标用小图模板匹配。
- 人工标注断言：允许维护 `ui-map.yaml`，记录入口坐标。

第二阶段再引入 OCR：

- 本地 OCR，如 PaddleOCR 或 Tesseract。
- 对中文 UI 文本识别：`单词本`、`设置`、`历史记录`。
- 找到文本后计算中心点并点击。

感知接口：

```python
find_text("单词本") -> Rect | None
find_template("wordbook_icon.png") -> Rect | None
assert_text_visible("单词本")
assert_screen_changed(before, after, threshold=0.02)
```

### 5.6 UI Map

为稳定入口建立页面地图。

示例：`ui-map/y18.yaml`

```yaml
sku: OVERHEAD_Y18_SKU_CHN_PLUS
screenshot_size: [936, 280]
coordinate_mode: screen
pages:
  home:
    entries:
      wordbook:
        label: 单词本
        point: [468, 140]
        confidence: manual
      settings:
        label: 设置
        point: [820, 140]
        confidence: manual
```

### 5.7 Test DSL

使用 YAML 描述测试用例，便于非开发同学维护。

示例：`tests/wordbook.yaml`

```yaml
name: wordbook_smoke
serial: auto
sku: OVERHEAD_Y18_SKU_CHN_PLUS
steps:
  - name: 回到桌面
    action: press_key
    key: asr
    wait: 1.0
    capture: home

  - name: 点击单词本
    action: tap_ui
    page: home
    target: wordbook
    wait: 1.0
    capture: after_tap_wordbook

  - name: 验证进入单词本
    action: assert
    any:
      - text_visible: 单词本
      - screen_changed_from: home
```

动作类型：

```yaml
- press_key
- tap
- tap_ui
- swipe
- wait
- screenshot
- assert
- shell
- start_app
- memory_check
```

### 5.8 Runner

执行流程：

1. 连接设备。
2. 读取 SKU 和屏幕配置。
3. 加载对应 UI Map。
4. 每一步执行前记录上下文。
5. 执行动作。
6. 等待稳定。
7. 截图。
8. 执行断言。
9. 出错时停止或按策略重试。
10. 生成报告。

失败处理策略：

```yaml
on_failure:
  capture: true
  collect_logs: true
  retry: 1
  stop: true
```

### 5.9 Report

输出 HTML + JSON 双格式。

报告内容：

- 设备信息
- SKU
- 测试用例
- 每一步命令
- 每一步截图
- 断言结果
- 失败原因
- 耗时
- 内存/磁盘信息

目录结构：

```text
runs/20260728-172000/
  run.json
  report.html
  device-info.json
  steps/
    001_home.png
    002_after_tap_wordbook.png
  logs/
    adb.log
    memory.txt
```

## 6. 关键流程：点击“单词本”

推荐流程：

```yaml
name: open_wordbook
steps:
  - name: 回桌面
    action: press_key
    key: asr
    wait: 1
    capture: home

  - name: 查找单词本入口
    action: locate
    strategy:
      - ui_map: wordbook
      - text: 单词本
      - template: wordbook_icon.png
    save_as: wordbook_rect

  - name: 点击单词本
    action: tap_rect_center
    target: wordbook_rect
    wait: 1
    capture: wordbook_page

  - name: 验证页面变化
    action: assert
    any:
      - text_visible: 单词本
      - screen_changed_from: home
```

## 7. 校准工具

Y18 当前最需要做的是触控坐标校准。

设计一个交互式命令：

```bash
dictpen-ui calibrate --serial 7G50900011900174 --grid 3x3
```

流程：

1. 截图。
2. 按九宫格依次点击。
3. 每次点击后截图。
4. 检测界面变化。
5. 用户可确认哪个点命中了哪个 UI。
6. 生成 `ui-map/y18.yaml`。

也可以支持非交互式扫描：

```bash
dictpen-ui scan-home --serial 7G50900011900174 --grid 5x2
```

输出：

```text
point [120,80] changed screen: false
point [300,80] changed screen: true
point [468,140] changed screen: true
```

## 8. MVP 实现范围

第一版只做必要能力：

- 设备发现
- 读取 SKU 和 cfg
- 截图
- 点击
- 滑动
- 按键
- YAML 用例执行
- UI Map 手工坐标点击
- 截图变化断言
- HTML 报告

暂不做：

- OCR
- 通用视觉识别
- 自动控件树
- 并发多设备
- 复杂录制回放

## 9. 推荐目录结构

```text
D:\ADB-TOOLS-V1.0\dictpen-ui\
  dictpen_ui\
    __init__.py
    cli.py
    adb.py
    device.py
    input.py
    screenshot.py
    coordinates.py
    perception.py
    runner.py
    report.py
  ui-map\
    y18.yaml
    y15c.yaml
  tests\
    wordbook.yaml
    smoke.yaml
  templates\
    wordbook_icon.png
  runs\
  README.md
  pyproject.toml
```

## 10. 里程碑

### M1：基础驱动

- `dictpen-ui devices`
- `dictpen-ui info`
- `dictpen-ui screenshot`
- `dictpen-ui tap`
- `dictpen-ui press-key`

验收标准：能稳定截图并点击指定坐标。

### M2：测试 DSL

- YAML 解析
- 顺序执行 steps
- 截图留档
- 失败停止

验收标准：能执行 `wordbook.yaml`。

### M3：页面地图

- `ui-map/y18.yaml`
- `tap_ui page target`
- 坐标映射函数

验收标准：能通过 `tap_ui home.wordbook` 进入单词本。

### M4：报告

- `run.json`
- `report.html`
- 截图索引

验收标准：每次执行后能打开报告看步骤和截图。

### M5：感知增强

- 图片差异断言
- 模板匹配
- 可选 OCR

验收标准：能自动判断是否进入目标页面。

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| Y18 坐标映射不确定 | 先做校准工具，生成 ui-map |
| 无标准 Android View 层级 | 使用截图 + 坐标 + OCR/模板 |
| 根分区 100% | 所有产物保存到 PC，本机 `/tmp` 只临时截图 |
| OCR 不稳定 | 第一版用手工 UI Map + 图片变化断言 |
| UI 改版导致坐标失效 | ui-map 按 SKU 和固件版本维护 |
| 点击后页面加载慢 | 每步支持 wait 和 retry |

## 12. 建议下一步

建议先实现 MVP：

1. 新建 `dictpen-ui` Python CLI。
2. 实现 ADB、截图、点击、按键四个底层能力。
3. 写 `ui-map/y18.yaml`，先人工配置“单词本”坐标。
4. 写 `tests/wordbook.yaml`。
5. 跑一次并生成报告。

第一版不用追求智能识别，先把“可重复执行、可留证据、可报告”跑通。
