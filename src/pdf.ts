import { readFile } from "node:fs/promises";
import { Page } from "./page.js";
import type { BBox, ObjectMap, OpenOptions } from "./types.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

export class PDF {
  private constructor(
    public readonly pdfjs: PdfJsModule,
    private readonly documentProxy: any,
    public readonly metadata: Record<string, unknown>,
    public readonly path?: string,
  ) {}

  private pagesCache?: Page[];

  static async open(source: string | Uint8Array | ArrayBuffer, options: OpenOptions = {}): Promise<PDF> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data =
      typeof source === "string"
        ? new Uint8Array(await readFile(source))
        : source instanceof Uint8Array
          ? source
          : new Uint8Array(source);
    const standardFontDataUrl = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).href;
    const task = pdfjs.getDocument({
      data,
      password: options.password,
      stopAtErrors: options.stopAtErrors ?? false,
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl,
    });
    const documentProxy = await task.promise;
    const metadata = await documentProxy.getMetadata().catch(() => ({ info: {} }));
    return new PDF(pdfjs, documentProxy, { ...(metadata.info ?? {}) }, typeof source === "string" ? source : undefined);
  }

  get pageCount(): number {
    return this.documentProxy.numPages;
  }

  async getPages(): Promise<Page[]> {
    if (this.pagesCache) {
      return this.pagesCache;
    }
    const pages: Page[] = [];
    let doctop = 0;
    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
      const pageProxy = await this.documentProxy.getPage(pageNumber);
      const [x0, y0, x1, y1] = pageProxy.view as [number, number, number, number];
      const bbox = this.toTopLeftBBox([x0, y0, x1, y1], y1 - y0);
      const page = new Page(this, pageNumber, pageProxy, doctop, pageProxy.rotate ?? 0, bbox, bbox, bbox);
      pages.push(page);
      doctop += page.height;
    }
    this.pagesCache = pages;
    return pages;
  }

  async getPage(pageNumber: number): Promise<Page> {
    const pages = await this.getPages();
    const page = pages[pageNumber - 1];
    if (!page) {
      throw new Error(`Page ${pageNumber} does not exist.`);
    }
    return page;
  }

  async getObjects(): Promise<ObjectMap> {
    const merged: ObjectMap = {};
    for (const page of await this.getPages()) {
      const pageObjects = await page.getObjects();
      for (const [kind, values] of Object.entries(pageObjects)) {
        merged[kind as keyof ObjectMap] = [...
          (((merged[kind as keyof ObjectMap] ?? []) as unknown[])),
          ...((values ?? []) as unknown[]),
        ] as any;
      }
    }
    return merged;
  }

  async close(): Promise<void> {
    await this.documentProxy.destroy();
  }

  heightOf(page: Pick<Page, "mediabox">): number {
    return page.mediabox[3] - page.mediabox[1];
  }

  private toTopLeftBBox(box: [number, number, number, number], pageHeight: number): BBox {
    const x0 = Math.min(box[0], box[2]);
    const x1 = Math.max(box[0], box[2]);
    const y0 = Math.min(box[1], box[3]);
    const y1 = Math.max(box[1], box[3]);
    return [x0, pageHeight - y1, x1, pageHeight - y0];
  }
}
