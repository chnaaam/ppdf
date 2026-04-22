import { describe, expect, test } from "vitest";
import { PDF } from "../src/index.js";

const samplePdf = "/Users/chnaaam/Projects/chnam/ppdf/reference/pdfplumber/tests/pdfs/nics-background-checks-2015-11.pdf";
const annotPdf = "/Users/chnaaam/Projects/chnam/ppdf/reference/pdfplumber/tests/pdfs/pdffill-demo.pdf";

describe("ppdf", () => {
  test("opens a PDF and exposes page metadata", async () => {
    const pdf = await PDF.open(samplePdf);
    const pages = await pdf.getPages();
    expect(pdf.pageCount).toBe(1);
    expect(typeof pdf.metadata.Producer).toBe("string");
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages[0]?.width).toBeGreaterThan(1000);
    await pdf.close();
  });

  test("extracts text and chars", async () => {
    const pdf = await PDF.open(samplePdf);
    const page = await pdf.getPage(1);
    const chars = await page.getChars();
    const text = await page.extractText();
    expect(chars.length).toBeGreaterThan(1000);
    expect(text).toContain("State / Territory");
    await pdf.close();
  });

  test("extracts vector objects and hyperlinks", async () => {
    const pdf = await PDF.open(annotPdf);
    const page = await pdf.getPage(1);
    expect((await page.getLines()).length).toBeGreaterThan(0);
    expect((await page.getRects()).length).toBeGreaterThan(0);
    expect((await page.getAnnotations()).length).toBeGreaterThan(0);
    expect((await page.getHyperlinks()).length).toBeGreaterThan(0);
    await pdf.close();
  });

  test("supports crop and filter", async () => {
    const pdf = await PDF.open(samplePdf);
    const page = await pdf.getPage(1);
    const cropped = page.crop([0, 0, 200, 200]);
    const within = page.withinBBox([0, 0, 200, 200]);
    const filtered = page.filter((obj) => obj.object_type === "char");
    expect((await cropped.getChars()).length).toBeGreaterThan(0);
    expect((await cropped.getChars()).length).toBeLessThan((await page.getChars()).length);
    expect((await within.getChars()).length).toBeLessThan((await cropped.getChars()).length);
    expect((await filtered.getRects()).length).toBe(0);
    await pdf.close();
  });
});
