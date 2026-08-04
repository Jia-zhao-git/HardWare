"""Image-based visual assertions for DictPen UI automation.

Pure-Pillow (no OCR) checks that turn "blind screenshot" runs into
runs that can actually detect visual defects:

- blank / white / black / solid-color screen detection
- frozen (identical / near-identical) screen detection between two frames
- generic "how different are two frames" ratio for smarter change assertions

All functions degrade gracefully: if Pillow is unavailable they raise a
clear RuntimeError so the caller can mark the step warned instead of crashing.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

try:
    from PIL import Image  # type: ignore
    _PIL_OK = True
except Exception:  # pragma: no cover
    _PIL_OK = False


# Downscale target for fast pixel math. Small screens (e.g. 560x170) stay
# well above this, so we cap the long edge to keep analysis O(1)-ish.
_SAMPLE_MAX_EDGE = 160


def _require_pil() -> None:
    if not _PIL_OK:
        raise RuntimeError("Pillow (PIL) not installed; run: pip install pillow")


def _load_gray_small(path: Path) -> "Image.Image":
    im = Image.open(path).convert("L")
    w, h = im.size
    long_edge = max(w, h)
    if long_edge > _SAMPLE_MAX_EDGE:
        scale = _SAMPLE_MAX_EDGE / long_edge
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    return im


def _stats_gray(im: "Image.Image") -> tuple[float, float, int, int]:
    """Return (mean, stddev, min, max) of an 8-bit grayscale image."""
    hist = im.histogram()  # 256 buckets
    total = sum(hist)
    if total == 0:
        return 0.0, 0.0, 0, 0
    mean = sum(i * c for i, c in enumerate(hist)) / total
    var = sum(((i - mean) ** 2) * c for i, c in enumerate(hist)) / total
    std = var ** 0.5
    vmin = next((i for i, c in enumerate(hist) if c), 0)
    vmax = next((i for i in range(255, -1, -1) if hist[i]), 255)
    return mean, std, vmin, vmax


def analyze_screen(path: Path,
                   solid_std_max: float = 4.0,
                   white_mean_min: float = 245.0,
                   black_mean_max: float = 10.0) -> dict:
    """Classify a single screenshot.

    Returns dict with:
      ok: bool                (True = looks like a normal, content-bearing screen)
      kind: str               one of normal|white|black|solid|error
      mean, std, min, max     grayscale stats
      message: str            human-readable summary
    """
    _require_pil()
    try:
        im = _load_gray_small(path)
    except Exception as exc:
        return {"ok": False, "kind": "error", "mean": 0, "std": 0,
                "min": 0, "max": 0, "message": f"cannot read image: {exc}"}

    mean, std, vmin, vmax = _stats_gray(im)
    kind = "normal"
    ok = True
    msg = f"mean={mean:.1f} std={std:.1f} range={vmin}-{vmax}"

    if std <= solid_std_max:
        # almost no variation -> solid color of some sort
        if mean >= white_mean_min:
            kind, ok = "white", False
            msg = f"white/blank screen (mean={mean:.1f} std={std:.1f})"
        elif mean <= black_mean_max:
            kind, ok = "black", False
            msg = f"black screen (mean={mean:.1f} std={std:.1f})"
        else:
            kind, ok = "solid", False
            msg = f"solid-color screen (mean={mean:.1f} std={std:.1f})"
    return {"ok": ok, "kind": kind, "mean": round(mean, 1),
            "std": round(std, 1), "min": vmin, "max": vmax, "message": msg}


def diff_ratio(path_a: Path, path_b: Path, pixel_thresh: int = 12) -> float:
    """Fraction of pixels that changed meaningfully between two frames (0.0-1.0).

    Uses grayscale + downscale so it is robust to tiny compression noise.
    pixel_thresh: per-pixel abs difference below which pixels are 'unchanged'.
    """
    _require_pil()
    a = _load_gray_small(path_a)
    b = _load_gray_small(path_b)
    if a.size != b.size:
        b = b.resize(a.size)
    pa = a.load()
    pb = b.load()
    w, h = a.size
    changed = 0
    total = w * h
    for y in range(h):
        for x in range(w):
            if abs(pa[x, y] - pb[x, y]) > pixel_thresh:
                changed += 1
    return changed / total if total else 0.0


def is_frozen(path_a: Path, path_b: Path,
              min_change_ratio: float = 0.005,
              pixel_thresh: int = 12) -> bool:
    """True if two frames are effectively identical (screen frozen / no response)."""
    return diff_ratio(path_a, path_b, pixel_thresh=pixel_thresh) < min_change_ratio


def pil_available() -> bool:
    return _PIL_OK
