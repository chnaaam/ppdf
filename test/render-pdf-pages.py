import os
import sys

import fitz


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "Usage: python3 test/render-pdf-pages.py <input.pdf> <output-dir> <scale>",
            file=sys.stderr,
        )
        return 1

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    scale = float(sys.argv[3])

    os.makedirs(output_dir, exist_ok=True)

    doc = fitz.open(input_path)
    try:
        for page_index, page in enumerate(doc, start=1):
            matrix = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            output_path = os.path.join(output_dir, f"page-{page_index:03d}.png")
            pix.save(output_path)
            print(output_path)
    finally:
        doc.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
