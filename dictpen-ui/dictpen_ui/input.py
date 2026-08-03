"""ADB input driver using the coordinate adapter."""

from __future__ import annotations

from .adb import Adb
from .coordinates import CoordinateAdapter, Point


class InputDriver:
    def __init__(self, adb: Adb, coords: CoordinateAdapter):
        self.adb = adb
        self.coords = coords

    def tap(self, x: int, y: int, duration_ms: int = 150) -> None:
        """Tap at screenshot coordinates (sx, sy)."""
        p = self.coords.screenshot_to_touch(x, y)
        cmd = self.coords.tap_command(p, duration_ms)
        self.adb.shell(cmd, timeout=10)

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> None:
        """Swipe from (sx1,sy1) to (sx2,sy2) in screenshot space."""
        # Convert to physical and use multi-step slip for reliable gesture
        p1 = self.coords.screenshot_to_touch(x1, y1)
        p2 = self.coords.screenshot_to_touch(x2, y2)
        steps = 5
        dx = (p2.x - p1.x) // (steps - 1)
        dy = (p2.y - p1.y) // (steps - 1)
        parts = [f"send_event touch press {p1.x} {p1.y}"]
        for i in range(1, steps):
            parts.append(f"send_event touch slip {p1.x + dx * i} {p1.y + dy * i}")
        parts.append("send_event touch release")
        self.adb.shell("; ".join(parts), timeout=10, check=False)

    def press_key(self, key: str, duration_ms: int = 120) -> None:
        seconds = max(duration_ms, 1) / 1000.0
        self.adb.shell(
            f"send_event {key} press; sleep {seconds:.3f}; send_event {key} release",
            timeout=10,
        )
