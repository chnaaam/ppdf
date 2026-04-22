# ppdf

`ppdf` is a TypeScript PDF extraction library inspired by `pdfplumber`.

It is built for Node.js and focuses on:

- page access
- character-level extraction
- text, word, and search helpers
- lines, rects, curves, images, and annotations
- top-left coordinate handling like `pdfplumber`
- bbox-based page filtering

## Install

```bash
yarn add @chnaaam/ppdf
```

## Quick Start

```ts
import { PPDF } from "@chnaaam/ppdf";

const pdf = await PPDF.open("./sample.pdf");
const page = await pdf.getPage(1);

const text = await page.extractText();
const chars = await page.getChars();
const words = await page.extractWords();
const links = await page.getHyperlinks();

console.log({
  pageCount: pdf.pageCount,
  text,
  firstChar: chars[0],
  firstWord: words[0],
  links,
});

await pdf.close();
```

## Open A PDF

You can open a PDF from a file path, `Uint8Array`, or `ArrayBuffer`.

```ts
import { PPDF } from "@chnaaam/ppdf";

const fromPath = await PPDF.open("./document.pdf");
const fromBytes = await PPDF.open(bytes);
const fromBuffer = await PPDF.open(arrayBuffer);

await fromPath.close();
await fromBytes.close();
await fromBuffer.close();
```

Optional open options:

```ts
const pdf = await PPDF.open("./protected.pdf", {
  password: "secret",
  stopAtErrors: false,
});
```

## Read Pages

```ts
const pdf = await PPDF.open("./document.pdf");

console.log(pdf.pageCount);

const page1 = await pdf.getPage(1);
const pages = await pdf.getPages();

console.log(page1.width, page1.height);
console.log(pages.length);

await pdf.close();
```

## Extract Text

### Plain text

```ts
const text = await page.extractText();
console.log(text);
```

### Characters

```ts
const chars = await page.getChars();

for (const char of chars.slice(0, 5)) {
  console.log(char.text, char.x0, char.top, char.x1, char.bottom);
}
```

Each `char` includes:

- `text`
- `fontname`
- `size`
- `matrix`
- `x0`, `top`, `x1`, `bottom`
- `width`, `height`
- `page_number`, `doctop`

### Words

```ts
const words = await page.extractWords();

for (const word of words.slice(0, 5)) {
  console.log(word.text, word.x0, word.top, word.x1, word.bottom);
}
```

### Search

Literal search:

```ts
const matches = await page.search("invoice", { regex: false });
```

Regex search:

```ts
const matches = await page.search(/total:\s+\$?\d+(?:\.\d+)?/i);
```

## Extract Shapes And Other Objects

```ts
const lines = await page.getLines();
const rects = await page.getRects();
const curves = await page.getCurves();
const images = await page.getImages();
const annotations = await page.getAnnotations();
const hyperlinks = await page.getHyperlinks();
```

You can also collect everything in one call:

```ts
const objects = await page.getObjects();
```

Or across the whole document:

```ts
const allObjects = await pdf.getObjects();
```

## Crop And Filter By Bounding Box

Bounding boxes use `pdfplumber`-style top-left coordinates:

```ts
type BBox = [x0, top, x1, bottom];
```

### Crop to a region

```ts
const region = page.crop([50, 100, 300, 220]);
const regionChars = await region.getChars();
```

### Keep only objects fully within a region

```ts
const inner = page.withinBBox([50, 100, 300, 220]);
```

### Exclude a region

```ts
const outer = page.outsideBBox([50, 100, 300, 220]);
```

### Filter with a predicate

```ts
const boldishChars = page.filter(
  (obj) => obj.object_type === "char" && "fontname" in obj && obj.fontname.includes("Bold"),
);
```

## Coordinate System

`ppdf` normalizes coordinates to a top-left origin, matching `pdfplumber`.

That means:

- `x0` / `x1` grow from left to right
- `top` / `bottom` grow from top to bottom
- `doctop` is the top offset in document space across pages

## End-To-End Example

```ts
import { PPDF } from "@chnaaam/ppdf";

const pdf = await PPDF.open("./report.pdf");

for (const page of await pdf.getPages()) {
  const words = await page.extractWords();
  const links = await page.getHyperlinks();

  console.log(`page ${page.pageNumber}`);
  console.log(`words: ${words.length}`);
  console.log(`links: ${links.length}`);
}

await pdf.close();
```

## Local Development

Install dependencies:

```bash
yarn
```

Type-check:

```bash
yarn run check
```

Build:

```bash
yarn build
```

Run tests:

```bash
yarn test
```

Run the character-accuracy comparison test:

```bash
yarn vitest run test/char-accuracy.test.ts
```

Render character bounding boxes over page images:

```bash
node --import tsx ./test/render-char-bboxes.ts ./reference_pdf/ref_pdf1.pdf ./tmp/ref1-compare 2 compare
```

## Notes

- `ppdf` is currently aimed at machine-generated PDFs.
- Character geometry is designed to be close to `pdfplumber`, but full feature parity is not finished yet.
- Some PDFs may still differ in font fallback behavior or CID text decoding because `ppdf` uses PDF.js internally.
