import json
import sys

sys.path.insert(0, "reference/pdfplumber")
import pdfplumber


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 test/extract-pdfplumber-char-bboxes.py <input.pdf>", file=sys.stderr)
        return 1

    input_path = sys.argv[1]

    with pdfplumber.open(input_path) as pdf:
      pages = []
      for page in pdf.pages:
          pages.append(
              {
                  "page_number": page.page_number,
                  "width": page.width,
                  "height": page.height,
                  "chars": [
                      {
                          "text": char["text"],
                          "x0": char["x0"],
                          "x1": char["x1"],
                          "top": char["top"],
                          "bottom": char["bottom"],
                      }
                      for char in page.chars
                  ],
              }
          )

    print(json.dumps(pages))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
