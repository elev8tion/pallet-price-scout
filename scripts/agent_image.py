#!/usr/bin/env python3
"""Write a downscaled JPEG copy of the canonical image for model input and emit its size as JSON."""
import json
import os
import sys
from PIL import Image


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: agent_image.py input output max_edge")
    source, output, max_edge = sys.argv[1], sys.argv[2], int(sys.argv[3])
    with Image.open(source) as original:
        image = original.convert("RGB")
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    temporary = f"{output}.tmp"
    image.save(temporary, "JPEG", quality=85, optimize=True)
    os.replace(temporary, output)
    print(json.dumps({"width": image.width, "height": image.height}))


if __name__ == "__main__":
    main()
