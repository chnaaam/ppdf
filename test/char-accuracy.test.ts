import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { PPDF } from "../src/index.js";

type ReferenceChar = {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  fontname: string;
  size: number;
};

type ReferencePage = ReferenceChar[];
type SampleFile = {
  path: string;
  allowCidFallback?: boolean;
};

const sampleFiles: SampleFile[] = [
  { path: "/Users/chnaaam/Projects/chnam/ppdf/reference_pdf/ref_pdf1.pdf" },
  { path: "/Users/chnaaam/Projects/chnam/ppdf/reference_pdf/ref_pdf2.pdf", allowCidFallback: true },
];

function isCidFallback(text: string): boolean {
  return /^\(cid:\d+\)$/.test(text);
}

function loadReferencePages(pdfPath: string): ReferencePage[] {
  const script = `
import sys, json
sys.path.insert(0, 'reference/pdfplumber')
import pdfplumber

pdf = pdfplumber.open(${JSON.stringify(pdfPath)})
pages = [
    [
        {k: c[k] for k in ('text', 'x0', 'x1', 'top', 'bottom', 'fontname', 'size')}
        for c in page.chars
    ]
    for page in pdf.pages
]
pdf.close()
print(json.dumps(pages))
`.trim();
  return JSON.parse(
    execFileSync("python3", ["-c", script], {
      cwd: "/Users/chnaaam/Projects/chnam/ppdf",
      encoding: "utf8",
      maxBuffer: 80_000_000,
    }),
  ) as ReferencePage[];
}

describe("character extraction accuracy", () => {
  for (const sample of sampleFiles) {
    test(`matches pdfplumber for ${sample.path.split("/").at(-1)}`, async () => {
      const expectedPages = loadReferencePages(sample.path);
      const pdf = await PPDF.open(sample.path);
      const pages = await pdf.getPages();

      expect(pages).toHaveLength(expectedPages.length);

      let totalCount = 0;
      let sumX0 = 0;
      let sumX1 = 0;
      let sumTop = 0;
      let sumBottom = 0;
      let maxDelta = 0;

      for (let pageIndex = 0; pageIndex < expectedPages.length; pageIndex += 1) {
        const expected = expectedPages[pageIndex]!;
        const actual = await pages[pageIndex]!.getChars();

        expect(actual).toHaveLength(expected.length);

        for (let i = 0; i < expected.length; i += 1) {
          const exp = expected[i]!;
          const act = actual[i]!;
          if (!(sample.allowCidFallback && isCidFallback(exp.text))) {
            expect(act.text).toBe(exp.text);
          }
          expect(act.fontname).toBe(exp.fontname);

          const dx0 = Math.abs(act.x0 - exp.x0);
          const dx1 = Math.abs(act.x1 - exp.x1);
          const dTop = Math.abs(act.top - exp.top);
          const dBottom = Math.abs(act.bottom - exp.bottom);

          sumX0 += dx0;
          sumX1 += dx1;
          sumTop += dTop;
          sumBottom += dBottom;
          maxDelta = Math.max(maxDelta, dx0, dx1, dTop, dBottom);
          totalCount += 1;
        }
      }

      expect(sumX0 / totalCount).toBeLessThan(0.1);
      expect(sumX1 / totalCount).toBeLessThan(0.1);
      expect(sumTop / totalCount).toBeLessThan(0.1);
      expect(sumBottom / totalCount).toBeLessThan(0.1);
      expect(maxDelta).toBeLessThan(0.1);

      await pdf.close();
    }, 30_000);
  }
});
