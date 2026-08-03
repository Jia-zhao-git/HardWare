from __future__ import annotations

import hashlib
import struct
from pathlib import Path
from typing import Optional

from .adb import Adb

PNG_SIG = b"\x89PNG\r\n\x1a\n"


class ScreenshotDriver:
    def __init__(self, adb: Adb):
        self.adb = adb

    def capture(self, local_path: Path, remote_path: str = "/tmp/dictpen_ui_screen.png") -> Path:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        self.adb.shell(f"miniapp_cli capture {remote_path}", timeout=30)
        self.adb.pull(remote_path, local_path, timeout=60)
        return local_path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def png_size(path: Path) -> Optional[tuple[int, int]]:
    try:
        with path.open("rb") as f:
            sig = f.read(8)
            if sig != PNG_SIG:
                return None
            length = struct.unpack(">I", f.read(4))[0]
            ctype = f.read(4)
            if ctype != b"IHDR" or length < 8:
                return None
            width, height = struct.unpack(">II", f.read(8))
            return width, height
    except Exception:
        return None


def files_differ(path_a: Path, path_b: Path) -> bool:
    if not path_a.exists() or not path_b.exists():
        return True
    if path_a.stat().st_size != path_b.stat().st_size:
        return True
    return sha256_file(path_a) != sha256_file(path_b)
