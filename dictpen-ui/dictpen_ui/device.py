from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict, field
from typing import Any, Optional

from .adb import Adb


@dataclass
class ScreenConfig:
    width: Optional[int] = None
    height: Optional[int] = None
    direction: Optional[int] = None
    tp_direction: Optional[int] = None
    tp_xoffset: int = 0
    tp_yoffset: int = 0


@dataclass
class DeviceInfo:
    serial: str
    sku: str = "unknown"
    dev_sn: str = ""
    hostname: str = ""
    kernel: str = ""
    os_release: str = ""
    screen: ScreenConfig = field(default_factory=ScreenConfig)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return data


def _first_match(pattern: str, text: str, default: str = "") -> str:
    m = re.search(pattern, text, re.MULTILINE)
    return m.group(1).strip() if m else default


class DictPenDevice:
    def __init__(self, adb: Adb):
        self.adb = adb
        self.serial = adb.serial or ""

    def read_info(self) -> DeviceInfo:
        sys_config = self.adb.shell("cat /data/cfg/sys_config.conf 2>/dev/null || true", check=False)
        cfg_json_text = self.adb.shell("cat /etc/miniapp/resources/cfg.json 2>/dev/null || true", check=False)
        hostname = self.adb.shell("hostname 2>/dev/null || true", check=False).strip()
        kernel = self.adb.shell("uname -a 2>/dev/null || true", check=False).strip()
        os_release = self.adb.shell("cat /etc/os-release 2>/dev/null | head -20 || true", check=False).strip()

        sku = _first_match(r"^sku=(.*)$", sys_config, "unknown")
        dev_sn = _first_match(r"^dev_sn=(.*)$", sys_config, self.serial)

        screen = ScreenConfig()
        try:
            cfg = json.loads(cfg_json_text)
            s = cfg.get("screen", {})
            screen = ScreenConfig(
                width=s.get("width"),
                height=s.get("height"),
                direction=s.get("direction"),
                tp_direction=s.get("tp_direction"),
                tp_xoffset=s.get("tp_xoffset", 0),
                tp_yoffset=s.get("tp_yoffset", 0),
            )
        except Exception:
            pass

        return DeviceInfo(
            serial=self.serial or dev_sn,
            sku=sku,
            dev_sn=dev_sn,
            hostname=hostname,
            kernel=kernel,
            os_release=os_release,
            screen=screen,
        )

    def memory(self) -> str:
        return self.adb.shell("miniapp_cli memoryApp 2>&1 || cat /proc/meminfo | head -30", check=False)

    def disk(self) -> str:
        return self.adb.shell("df -h", check=False)
