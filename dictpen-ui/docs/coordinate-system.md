# DictPen 坐标系统自动适配方案

## 目标

自动从设备读取屏幕配置（`cfg.json`），根据不同的 direction/tp_direction 自动推导：
1. 截图尺寸（screenshot frame）
2. 截图坐标→物理触摸坐标的映射函数
3. 安全交互区域（避开无法触摸的边缘）
4. 上下左右滑动手势的物理坐标生成

## 信息来源

从每台设备的 `/etc/miniapp/resources/cfg.json` 读取：

```json
{
  "screen": {
    "width": 280,        // 物理 framebuffer 宽（旋转前）
    "height": 936,       // 物理 framebuffer 高（旋转前）
    "direction": 270,    // 屏幕渲染方向（0/90/180/270）
    "tp_direction": 270, // 触摸面板方向
    "tp_xoffset": 0,     // 触摸 X 偏移
    "tp_yoffset": 0      // 触摸 Y 偏移
  }
}
```

## 已知 SKU 分类

根据 `sku-coordinates.md` 参考和实测：

| direction | tp_direction | SKU 示例 | 截图尺寸 | 映射公式 |
|-----------|-------------|----------|---------|---------|
| 0 | 0 | Y15C | phys_w × phys_h | `(sx, sy)` |
| 180 | 180 | Y07 | phys_w × phys_h | `(W-1-sx, H-1-sy)` |
| 90 | 90 | — | phys_h × phys_w | `(sy, W-1-sx)` |
| 270 | 270 | Y18/Y18P/Y01/S61/P5/P6/X5/X62/D3/X3S/Y02/A61 | phys_h × phys_w | `(W-1-sy, sx)` |
| 270 | 270+offset107 | S61/X62/P6/X5/X3S等 | phys_h × phys_w | `(W-1-sy+107, sx)` |

## 核心映射函数

### screenshot_to_touch(sx, sy) → (tx, ty)

对于 `direction=270`（已验证生效）：

```
tx = phys_w - 1 - sy + tp_xoffset
ty = sx + tp_yoffset
```

对于其他 direction 按表格类推。

### 截图尺寸

```python
if direction in (90, 270):
    ss_w, ss_h = phys_h, phys_w   # 横屏截图
else:
    ss_w, ss_h = phys_w, phys_h   # 竖屏截图
```

## 交互区域计算（安全边距策略）

**经验法则：远离屏幕物理边缘 15% 以上。** 实测发现物理坐标靠近 0 或边界时，`send_event` 可能不触发滑动。

```
screenshot 安全区域（占截图尺寸的百分比）：
  cx = ss_w * 50%           # 水平中心
  cy_mid = ss_h * 50%       # 垂直中心
  safe_l = ss_w * 25%        # 左 25%
  safe_r = ss_w * 75%        # 右 75%
  safe_t = ss_h * 25%        # 上 25%
  safe_b = ss_h * 75%        # 下 75%
```

然后全部通过 `screenshot_to_touch()` 转为物理坐标。

## 滑动手势生成

**正确格式**（多步 slip，无 sleep）：

```
send_event touch press <start_phys_x> <start_phys_y>;
send_event touch slip <step1_x> <step1_y>;
send_event touch slip <step2_x> <step2_y>;
... (4-5 steps total)
send_event touch slip <end_phys_x> <end_phys_y>;
send_event touch release
```

**向下滑动**（在截图视角，内容往上走——物理 X 从小→大）：
```
起点: (safe_t 的物理 X, 中心 Y)
终点: (safe_b 的物理 X, 中心 Y)
```

**向上滑动**：起点和终点互换。

**向左滑动**（物理 Y 从大→小）：
```
起点: (中心 X, safe_r 的物理 Y)
终点: (中心 X, safe_l 的物理 Y)
```

**向右滑动**：起点和终点互换。

## 实现（CoordinateAdapter）

已在 `dictpen_ui/input.py` 中实现，runner 初始化时自动传入屏幕参数。

## 校准命令（未来扩展）

对于未知 SKU 或边缘异常的设备，提供交互式校准：

```bash
dictpen-ui calibrate --serial <serial>
```

流程：
1. 读取 cfg.json，按默认公式计算
2. 截当前桌面
3. 依次生成 9 个物理点（3×3 网格），每次点一下,截图对比
4. 标记哪些点产生了 UI 变化
5. 用结果修正映射公式的偏移量
6. 保存到 `ui-map/<sku>.yaml`
