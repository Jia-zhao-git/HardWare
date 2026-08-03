from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def load_simple_yaml(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text)
    except Exception:
        return _parse_yaml_subset(text)


def _parse_scalar(value: str) -> Any:
    value = value.strip()
    if value == "":
        return ""
    if value in ("true", "True"):
        return True
    if value in ("false", "False"):
        return False
    if value in ("null", "None", "~"):
        return None
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(x.strip()) for x in inner.split(",")]
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?\d+\.\d+", value):
        return float(value)
    return value


def _clean_lines(text: str) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        line = raw.split(" #", 1)[0].rstrip()
        indent = len(line) - len(line.lstrip(" "))
        rows.append((indent, line.strip()))
    return rows


def _parse_yaml_subset(text: str) -> Any:
    rows = _clean_lines(text)
    if not rows:
        return {}
    value, idx = _parse_block(rows, 0, rows[0][0])
    if idx != len(rows):
        raise ValueError(f"Could not parse YAML near: {rows[idx]}")
    return value


def _parse_block(rows: list[tuple[int, str]], idx: int, indent: int) -> tuple[Any, int]:
    if idx >= len(rows):
        return {}, idx
    if rows[idx][1].startswith("- "):
        return _parse_list(rows, idx, indent)
    return _parse_dict(rows, idx, indent)


def _parse_dict(rows: list[tuple[int, str]], idx: int, indent: int) -> tuple[dict[str, Any], int]:
    out: dict[str, Any] = {}
    while idx < len(rows):
        cur_indent, text = rows[idx]
        if cur_indent < indent:
            break
        if cur_indent > indent:
            raise ValueError(f"Unexpected indentation: {text}")
        if text.startswith("- "):
            break
        if ":" not in text:
            raise ValueError(f"Expected key: value, got: {text}")
        key, rest = text.split(":", 1)
        key = key.strip()
        rest = rest.strip()
        idx += 1
        if rest:
            out[key] = _parse_scalar(rest)
        else:
            if idx < len(rows) and rows[idx][0] > cur_indent:
                out[key], idx = _parse_block(rows, idx, rows[idx][0])
            else:
                out[key] = {}
    return out, idx


def _parse_list(rows: list[tuple[int, str]], idx: int, indent: int) -> tuple[list[Any], int]:
    out: list[Any] = []
    while idx < len(rows):
        cur_indent, text = rows[idx]
        if cur_indent < indent:
            break
        if cur_indent > indent:
            raise ValueError(f"Unexpected indentation in list: {text}")
        if not text.startswith("- "):
            break
        item_text = text[2:].strip()
        idx += 1
        if not item_text:
            if idx < len(rows) and rows[idx][0] > cur_indent:
                item, idx = _parse_block(rows, idx, rows[idx][0])
            else:
                item = None
            out.append(item)
            continue
        if ":" in item_text:
            key, rest = item_text.split(":", 1)
            obj: dict[str, Any] = {}
            obj[key.strip()] = _parse_scalar(rest.strip()) if rest.strip() else {}
            if idx < len(rows) and rows[idx][0] > cur_indent:
                child, idx = _parse_dict(rows, idx, rows[idx][0])
                obj.update(child)
            out.append(obj)
        else:
            out.append(_parse_scalar(item_text))
    return out, idx


def dump_json(data: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
