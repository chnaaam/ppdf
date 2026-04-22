import json
import sys

from PIL import Image, ImageDraw


def main() -> int:
    if len(sys.argv) < 4:
        print("Usage: python3 test/draw-char-bboxes.py <input.png> <boxes.json> <output.png>", file=sys.stderr)
        return 1

    input_path = sys.argv[1]
    boxes_path = sys.argv[2]
    output_path = sys.argv[3]

    with open(boxes_path, "r", encoding="utf-8") as f:
        boxes = json.load(f)

    image = Image.open(input_path).convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")

    for box in boxes:
        x0 = box["x0"]
        y0 = box["top"]
        x1 = box["x1"]
        y1 = box["bottom"]
        outline = tuple(box.get("outline", [220, 20, 20, 255]))
        fill = tuple(box.get("fill", [255, 0, 0, 0]))
        width = int(box.get("width", 2))
        draw.rectangle([x0, y0, x1, y1], fill=fill)
        draw.rectangle([x0, y0, x1, y1], outline=outline, width=width)

    image.save(output_path, format="PNG")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
