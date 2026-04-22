import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDF } from "../src/index.js";

const execFileAsync = promisify(execFile);

type Engine = "ppdf" | "pdfplumber" | "compare";

async function renderPageImages(inputPath: string, tempDir: string, scale: number): Promise<string[]> {
  const scriptPath = path.resolve("test", "render-pdf-pages.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, inputPath, tempDir, String(scale)], {
    cwd: process.cwd(),
    maxBuffer: 20_000_000,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function extractPdfplumberBoxes(inputPath: string): Promise<
  Array<{
    page_number: number;
    width: number;
    height: number;
    chars: Array<{ text: string; x0: number; x1: number; top: number; bottom: number }>;
  }>
> {
  const scriptPath = path.resolve("test", "extract-pdfplumber-char-bboxes.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, inputPath], {
    cwd: process.cwd(),
    maxBuffer: 50_000_000,
  });
  return JSON.parse(stdout) as Array<{
    page_number: number;
    width: number;
    height: number;
    chars: Array<{ text: string; x0: number; x1: number; top: number; bottom: number }>;
  }>;
}

async function drawBoxesOnImage(inputPngPath: string, boxesJsonPath: string, outputPngPath: string): Promise<void> {
  const scriptPath = path.resolve("test", "draw-char-bboxes.py");
  await execFileAsync("python3", [scriptPath, inputPngPath, boxesJsonPath, outputPngPath], {
    cwd: process.cwd(),
    maxBuffer: 20_000_000,
  });
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputDirArg = process.argv[3];
  const scaleArg = process.argv[4];
  const engineArg = (process.argv[5] as Engine | undefined) ?? "compare";

  if (!inputPath) {
    console.error("Usage: node --import tsx test/render-char-bboxes.ts <input.pdf> [output-dir] [scale] [ppdf|pdfplumber|compare]");
    process.exitCode = 1;
    return;
  }

  const absoluteInputPath = path.resolve(inputPath);
  const baseName = path.basename(absoluteInputPath, path.extname(absoluteInputPath));
  const outputDir = outputDirArg
    ? path.resolve(outputDirArg)
    : path.resolve("tmp", `${baseName}-char-bboxes`);
  const scale = scaleArg ? Number(scaleArg) : 2;
  const engine: Engine = ["ppdf", "pdfplumber", "compare"].includes(engineArg) ? engineArg : "compare";

  await mkdir(outputDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ppdf-render-"));
  const pdf = await PDF.open(absoluteInputPath);

  try {
    const [pages, renderedImages, pdfplumberPages] = await Promise.all([
      pdf.getPages(),
      renderPageImages(absoluteInputPath, tempDir, scale),
      engine === "ppdf" ? Promise.resolve(null) : extractPdfplumberBoxes(absoluteInputPath),
    ]);

    for (const page of pages) {
      const chars = await page.getChars();
      const pageImagePath = renderedImages[page.pageNumber - 1];
      if (!pageImagePath) {
        throw new Error(`Missing rendered image for page ${page.pageNumber}`);
      }

      const basePageName = `page-${String(page.pageNumber).padStart(3, "0")}`;
      const jsonPath = path.join(outputDir, `${basePageName}.json`);
      const pngPath = path.join(outputDir, `${basePageName}.png`);
      const boxes: Array<{
        x0: number;
        x1: number;
        top: number;
        bottom: number;
        outline: [number, number, number, number];
        fill: [number, number, number, number];
        width: number;
      }> = [];

      if (engine === "ppdf" || engine === "compare") {
        boxes.push(
          ...chars.map((char) => ({
            x0: char.x0 * scale,
            x1: char.x1 * scale,
            top: char.top * scale,
            bottom: char.bottom * scale,
            outline: [220, 20, 20, 255] as [number, number, number, number],
            fill: [255, 0, 0, 0] as [number, number, number, number],
            width: 1,
          })),
        );
      }

      if ((engine === "pdfplumber" || engine === "compare") && pdfplumberPages) {
        const refPage = pdfplumberPages[page.pageNumber - 1];
        if (refPage) {
          boxes.push(
            ...refPage.chars.map((char) => ({
              x0: char.x0 * scale,
              x1: char.x1 * scale,
              top: char.top * scale,
              bottom: char.bottom * scale,
              outline: [30, 160, 60, 255] as [number, number, number, number],
              fill: [0, 255, 0, 0] as [number, number, number, number],
              width: 1,
            })),
          );
        }
      }

      await writeFile(jsonPath, JSON.stringify(boxes), "utf8");
      await drawBoxesOnImage(pageImagePath, jsonPath, pngPath);
      console.log(`wrote ${pngPath}`);
    }
  } finally {
    await pdf.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
