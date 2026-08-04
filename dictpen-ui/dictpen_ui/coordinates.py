"""
Coordinate adapter for DictPen UI testing.

Automatically determines the mapping from screenshot coordinates to
physical touch coordinates based on the device's cfg.json parameters
and/or per-SKU calibration files (ui-map/<SKU>.json).

KEY DESIGN:
- When tp_direction == direction → simple direct mapping (e.g. Y18)
- When tp_direction != direction → two-step: screenshot→fb→touch (e.g. A62)
- Per-SKU calibration JSON files override cfg.json when available
- `from_sku(sku)` is the preferred factory method

Verified on:
  Y18 (dir=270, tp_dir=270): direct path ✓
  A62 (dir=270, tp_dir=0):   two-step path ✓
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Point:
    x: int
    y: int

    def __iter__(self):
        return iter((self.x, self.y))


@dataclass
class SwipeGesture:
    """A swipe gesture in physical touch coordinates, with multi-step waypoints."""
    start: Point
    end: Point
    steps: int = 5

    def to_shell_command(self) -> str:
        dx = (self.end.x - self.start.x) // (self.steps - 1)
        dy = (self.end.y - self.start.y) // (self.steps - 1)
        parts = [f"send_event touch press {self.start.x} {self.start.y}"]
        for i in range(1, self.steps):
            parts.append(f"send_event touch slip {self.start.x + dx * i} {self.start.y + dy * i}")
        parts.append("send_event touch release")
        return "; ".join(parts)

    def to_list(self) -> list[tuple[int, int]]:
        dx = (self.end.x - self.start.x) // (self.steps - 1)
        dy = (self.end.y - self.start.y) // (self.steps - 1)
        return [(self.start.x + dx * i, self.start.y + dy * i) for i in range(self.steps)]


class CoordinateAdapter:
    """
    Converts screenshot-space coordinates to physical touch-space for send_event.

    Call `from_sku(sku, cfg_dict)` for auto-detection with calibration file support.
    """

    SAFE_FRAC_LOW  = 0.20
    SAFE_FRAC_HIGH = 0.80

    # ── factories ─────────────────────────────────────────────────────

    @classmethod
    def from_sku(cls, sku: str, cfg: dict | None = None) -> "CoordinateAdapter":
        """
        Smart factory: try per-SKU calibration file first, then cfg.json, then defaults.
        Call this from anywhere that creates an adapter — it auto-detects the best config.
        """
        # 1. Try ui-map/<SKU>.json calibration file
        ui_map_dir = Path(__file__).resolve().parent.parent / "ui-map"
        calib_file = ui_map_dir / f"{sku}.json"
        if calib_file.exists():
            try:
                calib = json.loads(calib_file.read_text(encoding="utf-8"))
                if calib.get("calibrated"):
                    inst = cls(
                        phys_w=calib.get("phys_w", 560),
                        phys_h=calib.get("phys_h", 170),
                        direction=calib.get("direction", 0),
                        tp_direction=calib.get("tp_direction", 0),
                        tp_xoffset=calib.get("tp_xoffset", 0),
                        tp_yoffset=calib.get("tp_yoffset", 0),
                        sku=sku,
                    )
                    # Load empirical linear mapping if present
                    if "ss_to_touch" in calib:
                        inst._ss_to_touch_linear = calib["ss_to_touch"]
                    return inst
            except Exception:
                pass
        # 2. Try cfg.json
        if cfg:
            scr = cfg.get("screen", {})
            return cls(
                phys_w=scr.get("width", 280),
                phys_h=scr.get("height", 936),
                direction=scr.get("direction", 0),
                tp_direction=scr.get("tp_direction", 0),
                tp_xoffset=scr.get("tp_xoffset", 0),
                tp_yoffset=scr.get("tp_yoffset", 0),
                sku=sku,
            )
        # 3. Defaults
        return cls(sku=sku)

    # ── init ──────────────────────────────────────────────────────────

    def __init__(
        self,
        phys_w: int = 280,
        phys_h: int = 936,
        direction: int = 0,
        tp_direction: int = 0,
        tp_xoffset: int = 0,
        tp_yoffset: int = 0,
        sku: str = "unknown",
    ):
        self.phys_w = phys_w
        self.phys_h = phys_h
        self.direction = direction
        self.tp_direction = tp_direction
        self.tp_xoffset = tp_xoffset
        self.tp_yoffset = tp_yoffset
        self.sku = sku
        # Optional empirical linear mapping (from ss_to_touch in calibration file)
        # Format: {x_scale, x_offset, y_scale, y_offset}
        self._ss_to_touch_linear: dict | None = None

    # ── screenshot size ──────────────────────────────────────────────

    @property
    def screenshot_size(self) -> tuple[int, int]:
        if self.direction in (90, 270):
            return (self.phys_h, self.phys_w)
        return (self.phys_w, self.phys_h)

    @property
    def ss_w(self) -> int:
        return self.screenshot_size[0]

    @property
    def ss_h(self) -> int:
        return self.screenshot_size[1]

    # ── screenshot → touch ───────────────────────────────────────────

    def screenshot_to_touch(self, sx: int, sy: int) -> Point:
        # Use empirical linear mapping if available (highest priority)
        if self._ss_to_touch_linear:
            m = self._ss_to_touch_linear
            tx = int(m["x_scale"] * sx + m["x_offset"])
            ty = int(m["y_scale"] * sy + m["y_offset"])
            return Point(max(0, tx), max(0, ty))
        if self.tp_direction == self.direction:
            return self._direct_map(sx, sy, self.direction)
        else:
            fb_x, fb_y = self._ss_to_fb(sx, sy, self.direction)
            tx, ty = self._fb_to_touch(fb_x, fb_y, self.tp_direction)
            return Point(tx + self.tp_xoffset, ty + self.tp_yoffset)

    def _ss_to_fb(self, sx: int, sy: int, d: int) -> tuple[int, int]:
        if d == 0:       return (sx, sy)
        elif d == 90:    return (self.phys_w - 1 - sy, sx)
        elif d == 180:   return (self.phys_w - 1 - sx, self.phys_h - 1 - sy)
        elif d == 270:   return (sy, self.phys_h - 1 - sx)
        return (sx, sy)

    def _fb_to_touch(self, fb_x: int, fb_y: int, td: int) -> tuple[int, int]:
        if td == 0:      return (fb_x, fb_y)
        elif td == 90:   return (fb_y, self.phys_w - 1 - fb_x)
        elif td == 180:  return (self.phys_w - 1 - fb_x, self.phys_h - 1 - fb_y)
        elif td == 270:  return (self.phys_w - 1 - fb_y, fb_x)
        return (fb_x, fb_y)

    def _direct_map(self, sx: int, sy: int, d: int) -> Point:
        if d == 0:       tx, ty = sx, sy
        elif d == 90:    tx, ty = sy, self.phys_w - 1 - sx
        elif d == 180:   tx, ty = self.phys_w - 1 - sx, self.phys_h - 1 - sy
        elif d == 270:   tx, ty = self.phys_w - 1 - sy, sx
        else:            tx, ty = sx, sy
        return Point(tx + self.tp_xoffset, ty + self.tp_yoffset)

    def touch_to_screenshot(self, tx: int, ty: int) -> Point:
        ux = tx - self.tp_xoffset
        uy = ty - self.tp_yoffset
        if self.tp_direction == self.direction:
            d = self.direction
            if d == 0:     return Point(ux, uy)
            elif d == 180: return Point(self.phys_w - 1 - ux, self.phys_h - 1 - uy)
            elif d == 90:  return Point(self.phys_w - 1 - uy, ux)
            elif d == 270: return Point(uy, self.phys_w - 1 - ux)
        return Point(ux, uy)

    # ── tap command ─────────────────────────────────────────────────

    def tap_command(self, point: Point, duration_ms: int = 120) -> str:
        s = max(duration_ms, 1) / 1000.0
        return f"send_event touch press {point.x} {point.y}; sleep {s:.3f}; send_event touch release"

    # ── safe touch ranges ───────────────────────────────────────────

    def _safe_x_range(self) -> tuple[int, int]:
        return (int(self.phys_w * self.SAFE_FRAC_LOW),
                int(self.phys_w * self.SAFE_FRAC_HIGH))

    def _safe_y_range(self) -> tuple[int, int]:
        return (int(self.phys_h * self.SAFE_FRAC_LOW),
                int(self.phys_h * self.SAFE_FRAC_HIGH))

    # ── swipe generators (touch-frame coordinates) ───────────────────

    def swipe_down(self) -> SwipeGesture:
        if self.tp_direction == self.direction:
            x_lo, x_hi = self._safe_x_range()
            y_mid = self.phys_h // 2
            return SwipeGesture(Point(x_lo, y_mid), Point(x_hi, y_mid))
        else:
            y_lo, y_hi = self._safe_y_range()
            x_mid = self.phys_w // 2
            return SwipeGesture(Point(x_mid, y_lo), Point(x_mid, y_hi))

    def swipe_up(self) -> SwipeGesture:
        if self.tp_direction == self.direction:
            x_lo, x_hi = self._safe_x_range()
            y_mid = self.phys_h // 2
            return SwipeGesture(Point(x_hi, y_mid), Point(x_lo, y_mid))
        else:
            y_lo, y_hi = self._safe_y_range()
            x_mid = self.phys_w // 2
            return SwipeGesture(Point(x_mid, y_hi), Point(x_mid, y_lo))

    def swipe_left(self) -> SwipeGesture:
        if self.tp_direction == self.direction:
            y_lo, y_hi = self._safe_y_range()
            x_mid = self.phys_w // 2
            return SwipeGesture(Point(x_mid, y_hi), Point(x_mid, y_lo))
        else:
            x_lo, x_hi = self._safe_x_range()
            y_mid = self.phys_h // 2
            return SwipeGesture(Point(x_hi, y_mid), Point(x_lo, y_mid))

    def swipe_right(self) -> SwipeGesture:
        if self.tp_direction == self.direction:
            y_lo, y_hi = self._safe_y_range()
            x_mid = self.phys_w // 2
            return SwipeGesture(Point(x_mid, y_lo), Point(x_mid, y_hi))
        else:
            x_lo, x_hi = self._safe_x_range()
            y_mid = self.phys_h // 2
            return SwipeGesture(Point(x_lo, y_mid), Point(x_hi, y_mid))
