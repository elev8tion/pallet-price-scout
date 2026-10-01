#!/usr/bin/env python3
"""Normalize one validated raster image and emit JSON metadata."""
import json
import os
import sys
from PIL import Image, ImageOps

MAX_PIXELS = 60_000_000
MAX_EDGE = 12_000


def fail(message):
    print(json.dumps({"error": message}))
    raise SystemExit(1)


def main():
    if len(sys.argv) != 4:
        fail("usage: normalize_image.py input output preview")
    source, output, preview = sys.argv[1:]
    try:
        with Image.open(source) as original:
            if getattr(original, "n_frames", 1) != 1:
                fail("animated or multi-frame images are not supported")
            image = ImageOps.exif_transpose(original).convert("RGB")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                fail("decoded image exceeds the 60 megapixel limit")
            if max(width, height) > MAX_EDGE:
                scale = MAX_EDGE / max(width, height)
                image = image.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)
                width, height = image.size
            os.makedirs(os.path.dirname(output), exist_ok=True)
            image.save(output, "JPEG", quality=92, optimize=True)
            preview_image = image.copy()
            preview_image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            preview_image.save(preview, "JPEG", quality=84, optimize=True)
            print(json.dumps({"width": width, "height": height, "source_width": original.width, "source_height": original.height}))
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"could not decode image: {exc}")


if __name__ == "__main__":
    main()
