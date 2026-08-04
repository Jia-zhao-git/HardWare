"""OCR-based visual assertions for DictPen UI automation.

Uses EasyOCR (pip install easyocr) for Chinese+English recognition.
The Reader is lazily instantiated and cached as a module-level singleton
so the ~0.5s model-load cost is paid only once per Python process.

Public API
----------
ocr_read(path)                  -> list of OcrWord
ocr_text(path)                  -> plain string of all detected text
contains_text(path, texts, ...)  -> True/False
find_text(path, text, ...)       -> first matching OcrWord or None
check_error_words(path, words)   -> list of found error words
available()                     -> bool  (True when easyocr installed)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Lazy singleton reader
# ---------------------------------------------------------------------------
_reader = None
_reader_error: Optional[str] = None


def _get_reader():
    global _reader, _reader_error
    if _reader is not None:
        return _reader
    if _reader_error is not None:
        raise RuntimeError(_reader_error)
    try:
        import easyocr  # type: ignore
    except ImportError:
        _reader_error = "easyocr not installed; run: pip install easyocr"
        raise RuntimeError(_reader_error)
    try:
        # lang list: simplified Chinese + English
        # gpu=False: CPU inference, safe on all machines
        _reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
    except Exception as exc:
        _reader_error = f"easyocr Reader init failed: {exc}"
        raise RuntimeError(_reader_error)
    return _reader


def available() -> bool:
    """True if easyocr is importable (model download not required for this check)."""
    try:
        import importlib.util
        return importlib.util.find_spec("easyocr") is not None
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Data type
# ---------------------------------------------------------------------------
@dataclass
class OcrWord:
    text: str
    confidence: float
    # bounding box: [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]  (image pixel coords)
    bbox: list

    @property
    def center_x(self) -> int:
        xs = [p[0] for p in self.bbox]
        return int((min(xs) + max(xs)) / 2)

    @property
    def center_y(self) -> int:
        ys = [p[1] for p in self.bbox]
        return int((min(ys) + max(ys)) / 2)

    @property
    def top_left(self) -> tuple[int, int]:
        return int(self.bbox[0][0]), int(self.bbox[0][1])

    @property
    def bottom_right(self) -> tuple[int, int]:
        return int(self.bbox[2][0]), int(self.bbox[2][1])


# ---------------------------------------------------------------------------
# Core read
# ---------------------------------------------------------------------------
def ocr_read(path: Path, min_confidence: float = 0.2) -> list[OcrWord]:
    """Run EasyOCR on the image and return all detected words above threshold."""
    reader = _get_reader()
    raw = reader.readtext(str(path), detail=1)
    result = []
    for bbox, text, conf in raw:
        if conf >= min_confidence and text.strip():
            result.append(OcrWord(text=text.strip(), confidence=round(conf, 3), bbox=bbox))
    return result


def ocr_text(path: Path, min_confidence: float = 0.2) -> str:
    """Return all detected text joined by spaces."""
    return " ".join(w.text for w in ocr_read(path, min_confidence))


# ---------------------------------------------------------------------------
# Text search helpers
# ---------------------------------------------------------------------------
def _match(word_text: str, query: str, fuzzy: bool = False) -> bool:
    if fuzzy:
        return query in word_text
    return word_text == query


def find_text(path: Path, text: str, fuzzy: bool = True,
              min_confidence: float = 0.3) -> Optional[OcrWord]:
    """Return the first OcrWord whose text matches `text`, or None."""
    for w in ocr_read(path, min_confidence):
        if _match(w.text, text, fuzzy):
            return w
    return None


def contains_text(path: Path, text: str, fuzzy: bool = True,
                  min_confidence: float = 0.3) -> bool:
    return find_text(path, text, fuzzy=fuzzy, min_confidence=min_confidence) is not None


def find_all_text(path: Path, texts: list[str], fuzzy: bool = True,
                  min_confidence: float = 0.3) -> list[str]:
    """Return subset of `texts` that were found in the image."""
    words = ocr_read(path, min_confidence)
    found = []
    for query in texts:
        for w in words:
            if _match(w.text, query, fuzzy):
                found.append(query)
                break
    return found


def check_error_words(path: Path,
                      error_words: Optional[list[str]] = None,
                      min_confidence: float = 0.3) -> list[str]:
    """Return list of error keywords found in the screenshot.

    Default error_words covers common Chinese app error messages.
    """
    if error_words is None:
        error_words = DEFAULT_ERROR_WORDS
    all_text = ocr_text(path, min_confidence)
    return [w for w in error_words if w in all_text]


# Default Chinese error keyword list for dictionary-pen apps
DEFAULT_ERROR_WORDS: list[str] = [
    "错误", "失败", "异常", "崩溃", "闪退",
    "无响应", "已停止", "网络错误", "加载失败", "连接失败",
    "服务不可用", "请重试", "出错了", "不可用",
]
