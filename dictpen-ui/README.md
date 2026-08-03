# DictPen UI Automation Tool

MVP for Youdao Dictionary Pen UI automation over ADB.

## Features

- Device discovery
- Device info collection
- Screenshot capture
- Tap / swipe / key injection
- YAML-based test runner
- UI map lookup
- HTML + JSON reports

## Quick Start

```bash
cd dictpen-ui
python -m dictpen_ui.cli devices
python -m dictpen_ui.cli info --serial 7G50900011900174
python -m dictpen_ui.cli screenshot --serial 7G50900011900174 --out runs/sample/home.png
python -m dictpen_ui.cli run tests/wordbook.yaml
```

## Notes

- Y18 uses a provisional manual coordinate map in `ui-map/y18.yaml`.
- The first release uses screenshot comparison and fixed points before OCR.
- Extend `ui-map/*.yaml` per SKU and firmware version as calibration improves.
