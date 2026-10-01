#!/usr/bin/env python3
"""Generate crop data URIs for findings items and write them back into items.json."""
import sys
import os
import json
import base64
from io import BytesIO
from PIL import Image, ImageOps


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "usage: generate_crops.py image_path items_json_path"}))
        sys.exit(1)
    image_path, items_path = sys.argv[1], sys.argv[2]
    if not os.path.exists(image_path) or not os.path.exists(items_path):
        print(json.dumps({"error": "input file not found"}))
        sys.exit(1)

    with open(items_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("items", [])
    coord_scale_w = data.get("coord_scale_w", 0)
    coord_scale_h = data.get("coord_scale_h", 0)

    im = Image.open(image_path)
    im = ImageOps.exif_transpose(im)
    img_w, img_h = im.size

    scale_x = img_w / float(coord_scale_w) if coord_scale_w else 1.0
    scale_y = img_h / float(coord_scale_h) if coord_scale_h else 1.0

    for item in items:
        coords = item.get("coords")
        if not coords or len(coords) != 4:
            item["image_b64"] = ""
            continue
        x1, y1, x2, y2 = coords
        bx1 = max(0, int(x1 * scale_x))
        by1 = max(0, int(y1 * scale_y))
        bx2 = min(img_w, int(x2 * scale_x))
        by2 = min(img_h, int(y2 * scale_y))
        if bx2 <= bx1 or by2 <= by1:
            item["image_b64"] = ""
            continue
        crop = im.crop((bx1, by1, bx2, by2))
        max_dim = 650
        if max(crop.size) > max_dim:
            ratio = max_dim / float(max(crop.size))
            new_size = (int(crop.size[0] * ratio), int(crop.size[1] * ratio))
            crop = crop.resize(new_size, Image.Resampling.LANCZOS)
        buf = BytesIO()
        crop.save(buf, format="JPEG", quality=85)
        item["image_b64"] = f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"

    with open(items_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(json.dumps({"crops": len(items)}))


if __name__ == "__main__":
    main()
