import { cropToBBox, outsideBBox, validateBBox, withinBBox } from "./geometry.js";
import { extractText, extractWords, search } from "./text.js";
import type {
  Annotation,
  BBox,
  Char,
  Curve,
  ImageObject,
  Line,
  ObjectMap,
  PdfObject,
  Rect,
  SearchMatch,
  Word,
} from "./types.js";
import type { PPDF } from "./pdf.js";

type CropFn = <T extends PdfObject>(objects: T[], bbox: BBox) => T[];
type Matrix = [number, number, number, number, number, number];

interface TextStyle {
  ascent?: number;
  descent?: number;
  fontFamily?: string;
}

interface TextItem {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: Matrix;
  fontName: string;
}

interface TextContent {
  items: Array<TextItem | { type: string }>;
  styles: Record<string, TextStyle>;
}

function toHexColor(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length >= 3 && raw.every((value) => typeof value === "number")) {
    const [r, g, b] = raw as number[];
    return `#${[r, g, b]
      .map((value) => Math.max(0, Math.min(255, value <= 1 ? Math.round(value * 255) : Math.round(value))))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return null;
}

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function translationMatrix(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

function normalizeRect(points: Array<[number, number]>, pageHeight: number) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const top = pageHeight - y1;
  const bottom = pageHeight - y0;
  return { x0, x1, y0, y1, top, bottom, width: x1 - x0, height: bottom - top };
}

function normalizeVector(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return [0, 0];
  }
  return [x / length, y / length];
}

function isTextItem(item: TextContent["items"][number]): item is TextItem {
  return "str" in item;
}

export class Page {
  protected parsedObjects?: ObjectMap;
  protected parsedAnnots?: Annotation[];

  constructor(
    public readonly pdf: PPDF,
    public readonly pageNumber: number,
    protected readonly pageProxy: any,
    public readonly initialDoctop: number,
    public readonly rotation: number,
    public readonly mediabox: BBox,
    public readonly cropbox: BBox,
    public readonly bbox: BBox,
  ) {}

  get width(): number {
    return this.bbox[2] - this.bbox[0];
  }

  get height(): number {
    return this.bbox[3] - this.bbox[1];
  }

  async getObjects(): Promise<ObjectMap> {
    if (!this.parsedObjects) {
      this.parsedObjects = await this.parseObjects();
    }
    return this.parsedObjects;
  }

  async getChars(): Promise<Char[]> {
    return ((await this.getObjects()).char as Char[]) ?? [];
  }

  async getLines(): Promise<Line[]> {
    return ((await this.getObjects()).line as Line[]) ?? [];
  }

  async getRects(): Promise<Rect[]> {
    return ((await this.getObjects()).rect as Rect[]) ?? [];
  }

  async getCurves(): Promise<Curve[]> {
    return ((await this.getObjects()).curve as Curve[]) ?? [];
  }

  async getImages(): Promise<ImageObject[]> {
    return ((await this.getObjects()).image as ImageObject[]) ?? [];
  }

  async getAnnotations(): Promise<Annotation[]> {
    if (!this.parsedAnnots) {
      this.parsedAnnots = await this.parseAnnotations();
    }
    return this.parsedAnnots;
  }

  async getHyperlinks(): Promise<Annotation[]> {
    return (await this.getAnnotations()).filter((annot) => Boolean(annot.uri));
  }

  async extractText(): Promise<string> {
    return extractText(await this.getChars());
  }

  async extractWords(): Promise<Word[]> {
    return extractWords(await this.getChars());
  }

  async search(
    pattern: string | RegExp,
    options?: { regex?: boolean; caseSensitive?: boolean },
  ): Promise<SearchMatch[]> {
    return search(await this.getChars(), pattern, options?.regex ?? true, options?.caseSensitive ?? true);
  }

  crop(bbox: BBox, relative = false, strict = true): Page {
    return new CroppedPage(this, bbox, cropToBBox, relative, strict);
  }

  withinBBox(bbox: BBox, relative = false, strict = true): Page {
    return new CroppedPage(this, bbox, withinBBox, relative, strict);
  }

  outsideBBox(bbox: BBox, relative = false, strict = true): Page {
    return new CroppedPage(this, bbox, outsideBBox, relative, strict);
  }

  filter(test: (obj: PdfObject) => boolean): Page {
    return new FilteredPage(this, test);
  }

  protected async parseObjects(): Promise<ObjectMap> {
    const operatorList = await this.pageProxy.getOperatorList();
    return {
      char: this.parseChars(operatorList),
      ...this.parseDrawnObjects(operatorList),
    };
  }

  protected parseChars(operatorList: any): Char[] {
    const chars: Char[] = [];
    const { OPS } = this.pdf.pdfjs;
    const pageHeight = this.pdf.heightOf(this);
    let graphicsCtm: Matrix = [1, 0, 0, 1, 0, 0];
    const graphicsStack: Matrix[] = [];
    let currentFont: any = null;
    let currentFontSize = 0;
    let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
    let textLineMatrix: Matrix = [1, 0, 0, 1, 0, 0];
    let textLeading = 0;
    let pendingMoveLeading = 0;
    let charSpacing = 0;
    let wordSpacing = 0;
    let horizontalScale = 1;
    let textRise = 0;

    for (let i = 0; i < operatorList.fnArray.length; i += 1) {
      const fn = operatorList.fnArray[i];
      const args = operatorList.argsArray[i];

      if (fn === OPS.save) {
        graphicsStack.push([...graphicsCtm] as Matrix);
        continue;
      }
      if (fn === OPS.restore) {
        graphicsCtm = graphicsStack.pop() ?? graphicsCtm;
        continue;
      }
      if (fn === OPS.transform) {
        graphicsCtm = multiply(graphicsCtm, args as Matrix);
        continue;
      }
      if (fn === OPS.beginText) {
        textMatrix = [1, 0, 0, 1, 0, 0];
        textLineMatrix = [1, 0, 0, 1, 0, 0];
        pendingMoveLeading = 0;
        continue;
      }
      if (fn === OPS.setFont) {
        currentFont = this.pageProxy.commonObjs?.get(args[0]);
        currentFontSize = Number(args[1] ?? 0);
        continue;
      }
      if (fn === OPS.setTextMatrix) {
        textMatrix = Array.from(args[0]) as Matrix;
        textLineMatrix = [...textMatrix] as Matrix;
        pendingMoveLeading = 0;
        continue;
      }
      if (fn === OPS.moveText) {
        const tx = Number(args[0] ?? 0);
        const ty = Number(args[1] ?? 0);
        textLineMatrix = multiply(textLineMatrix, translationMatrix(tx, ty));
        textMatrix = [...textLineMatrix] as Matrix;
        pendingMoveLeading =
          ty !== 0 &&
          Math.abs(ty) <= (currentFontSize || 0) * 1.5 &&
          Math.abs(tx) >= (currentFontSize || 0) * 10
            ? -ty
            : 0;
        continue;
      }
      if (fn === OPS.setLeading) {
        textLeading = Number(args[0] ?? 0);
        pendingMoveLeading = 0;
        continue;
      }
      if (fn === OPS.setLeadingMoveText) {
        textLeading = -Number(args[1] ?? 0);
        textLineMatrix = multiply(textLineMatrix, translationMatrix(Number(args[0] ?? 0), Number(args[1] ?? 0)));
        textMatrix = [...textLineMatrix] as Matrix;
        pendingMoveLeading = 0;
        continue;
      }
      if (fn === OPS.nextLine) {
        const defaultLeading = currentFontSize > 0 ? currentFontSize * 1.2 : 0;
        const lineAdvance = textLeading !== 0 ? textLeading : pendingMoveLeading || defaultLeading;
        textLineMatrix = multiply(textLineMatrix, translationMatrix(0, -lineAdvance));
        textMatrix = [...textLineMatrix] as Matrix;
        pendingMoveLeading = 0;
        continue;
      }
      if (fn === OPS.setCharSpacing) {
        charSpacing = Number(args[0] ?? 0);
        continue;
      }
      if (fn === OPS.setWordSpacing) {
        wordSpacing = Number(args[0] ?? 0);
        continue;
      }
      if (fn === OPS.setHScale) {
        horizontalScale = Number(args[0] ?? 100) / 100;
        continue;
      }
      if (fn === OPS.setTextRise) {
        textRise = Number(args[0] ?? 0);
        continue;
      }
      if ((fn !== OPS.showText && fn !== OPS.showSpacedText) || !currentFont) {
        continue;
      }

      const effectiveTextMatrix = multiply(graphicsCtm, textMatrix);
      const scaleBaseX = Math.hypot(effectiveTextMatrix[0], effectiveTextMatrix[1]);
      const scaleBaseY = Math.hypot(effectiveTextMatrix[2], effectiveTextMatrix[3]) || scaleBaseX;
      const scaleX = scaleBaseX * (currentFontSize || 1);
      const scaleY = scaleBaseY * (currentFontSize || 1);
      const fontSize = scaleY;
      const descent = typeof currentFont.descent === "number" ? currentFont.descent : -0.2;
      const xAxis: [number, number] = [
        effectiveTextMatrix[0] * (currentFontSize || 1) * horizontalScale,
        effectiveTextMatrix[1] * (currentFontSize || 1) * horizontalScale,
      ];
      const fallbackYAxis = normalizeVector(-xAxis[1], xAxis[0]);
      const rawYAxis: [number, number] = [
        effectiveTextMatrix[2] * (currentFontSize || 1),
        effectiveTextMatrix[3] * (currentFontSize || 1),
      ];
      const yAxis: [number, number] =
        Math.hypot(rawYAxis[0], rawYAxis[1]) > 0
          ? rawYAxis
          : [fallbackYAxis[0] * fontSize, fallbackYAxis[1] * fontSize];
      const yUnit = normalizeVector(yAxis[0], yAxis[1]);
      const riseVector: [number, number] = [yUnit[0] * textRise, yUnit[1] * textRise];
      let origin: [number, number] = [effectiveTextMatrix[4], effectiveTextMatrix[5]];

      for (const part of args[0] as Array<number | { unicode?: string; width?: number; isSpace?: boolean }>) {
        if (typeof part === "number") {
          const delta = (part / 1000) * (currentFontSize || 1) * horizontalScale;
          textMatrix = multiply(textMatrix, translationMatrix(-delta, 0));
          const movedMatrix = multiply(graphicsCtm, textMatrix);
          origin = [movedMatrix[4], movedMatrix[5]];
          continue;
        }
        const text = part.unicode ?? "";
        if (text.length === 0) {
          continue;
        }
        const advanceScale = (part.width ?? 0) / 1000;
        const advanceVector: [number, number] = [xAxis[0] * advanceScale, xAxis[1] * advanceScale];
        const quad = [
          [origin[0] + riseVector[0] + yAxis[0] * descent, origin[1] + riseVector[1] + yAxis[1] * descent],
          [
            origin[0] + riseVector[0] + yAxis[0] * descent + advanceVector[0],
            origin[1] + riseVector[1] + yAxis[1] * descent + advanceVector[1],
          ],
          [
            origin[0] + riseVector[0] + yAxis[0] * (descent + 1) + advanceVector[0],
            origin[1] + riseVector[1] + yAxis[1] * (descent + 1) + advanceVector[1],
          ],
          [origin[0] + riseVector[0] + yAxis[0] * (descent + 1), origin[1] + riseVector[1] + yAxis[1] * (descent + 1)],
        ] as Array<[number, number]>;
        const box = normalizeRect(quad, pageHeight);
        const advance = Math.hypot(advanceVector[0], advanceVector[1]);
        chars.push({
          object_type: "char",
          page_number: this.pageNumber,
          text,
          fontname: currentFont.name ?? currentFont.loadedName ?? "unknown",
          size: fontSize,
          adv: advance,
          upright: Math.abs(xAxis[0]) >= Math.abs(xAxis[1]),
          matrix: textMatrix,
          x0: box.x0,
          x1: box.x1,
          top: box.top,
          bottom: box.bottom,
          doctop: this.initialDoctop + box.top,
          width: box.width,
          height: box.height,
          y0: box.y0,
          y1: box.y1,
          stroking_color: null,
          non_stroking_color: null,
          dir: Math.abs(xAxis[0]) >= Math.abs(xAxis[1]) ? "ltr" : "ttb",
        });
        const delta = ((part.width ?? 0) / 1000) * (currentFontSize || 1) * horizontalScale
          + (charSpacing + (part.isSpace ? wordSpacing : 0));
        textMatrix = multiply(textMatrix, translationMatrix(delta, 0));
        const movedMatrix = multiply(graphicsCtm, textMatrix);
        origin = [movedMatrix[4], movedMatrix[5]];
      }
    }
    return chars;
  }

  protected parseDrawnObjects(operatorList: any): ObjectMap {
    const { OPS } = this.pdf.pdfjs;
    const objects: ObjectMap = { line: [], rect: [], curve: [], image: [] };
    type GraphicsState = {
      ctm: Matrix;
      lineWidth: number;
      strokeColor: string | null;
      fillColor: string | null;
    };
    let state: GraphicsState = {
      ctm: [1, 0, 0, 1, 0, 0],
      lineWidth: 1,
      strokeColor: null,
      fillColor: null,
    };
    const stack: GraphicsState[] = [];
    const pageHeight = this.pdf.heightOf(this);

    for (let i = 0; i < operatorList.fnArray.length; i += 1) {
      const fn = operatorList.fnArray[i];
      const args = operatorList.argsArray[i];
      if (fn === OPS.save) {
        stack.push({ ...state, ctm: [...state.ctm] as Matrix });
        continue;
      }
      if (fn === OPS.restore) {
        state = stack.pop() ?? state;
        continue;
      }
      if (fn === OPS.transform) {
        state.ctm = multiply(state.ctm, args as Matrix);
        continue;
      }
      if (fn === OPS.setLineWidth) {
        state.lineWidth = Number(args[0] ?? 1);
        continue;
      }
      if (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeColorN) {
        state.strokeColor = toHexColor(args);
        continue;
      }
      if (fn === OPS.setFillRGBColor || fn === OPS.setFillColorN) {
        state.fillColor = toHexColor(args);
        continue;
      }
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const box = normalizeRect(
          [
            applyMatrix(state.ctm, 0, 0),
            applyMatrix(state.ctm, 1, 0),
            applyMatrix(state.ctm, 1, 1),
            applyMatrix(state.ctm, 0, 1),
          ],
          pageHeight,
        );
        (objects.image as ImageObject[]).push({
          object_type: "image",
          page_number: this.pageNumber,
          name: typeof args?.[0] === "string" ? args[0] : undefined,
          x0: box.x0,
          x1: box.x1,
          top: box.top,
          bottom: box.bottom,
          doctop: this.initialDoctop + box.top,
          width: box.width,
          height: box.height,
          y0: box.y0,
          y1: box.y1,
        });
        continue;
      }
      if (fn !== OPS.constructPath) {
        continue;
      }

      const paintOp = args[0];
      const pathData = Array.isArray(args?.[1]) ? (args[1][0] as ArrayLike<number> | null) : ((args?.[1] ?? null) as ArrayLike<number> | null);
      const bboxValues = Array.isArray(args?.[2]) ? Array.from(args[2] as ArrayLike<number>) : [];
      const rawPathNumbers = pathData ? Array.from(pathData) : [];
      const rawPoints: Array<[number, number]> = [];
      for (let j = 1; j < rawPathNumbers.length - 1; j += 3) {
        const x = rawPathNumbers[j];
        const y = rawPathNumbers[j + 1];
        if (typeof x === "number" && typeof y === "number") {
          rawPoints.push(applyMatrix(state.ctm, x, y));
        }
      }
      const box = bboxValues.length >= 4
        ? normalizeRect(
            [
              applyMatrix(state.ctm, bboxValues[0] ?? 0, bboxValues[1] ?? 0),
              applyMatrix(state.ctm, bboxValues[2] ?? 0, bboxValues[1] ?? 0),
              applyMatrix(state.ctm, bboxValues[2] ?? 0, bboxValues[3] ?? 0),
              applyMatrix(state.ctm, bboxValues[0] ?? 0, bboxValues[3] ?? 0),
            ],
            pageHeight,
          )
        : normalizeRect(rawPoints.length > 0 ? rawPoints : [[0, 0]], pageHeight);
      const base = {
        page_number: this.pageNumber,
        x0: box.x0,
        x1: box.x1,
        top: box.top,
        bottom: box.bottom,
        doctop: this.initialDoctop + box.top,
        width: box.width,
        height: box.height,
        y0: box.y0,
        y1: box.y1,
        linewidth: state.lineWidth,
        stroking_color: state.strokeColor,
        non_stroking_color: state.fillColor,
      };
      const looksRect =
        rawPoints.length === 4 &&
        rawPathNumbers[rawPathNumbers.length - 1] === 4 &&
        box.width > 0 &&
        box.height > 0;
      const looksLine = box.width === 0 || box.height === 0;

      if (looksRect && paintOp !== OPS.stroke) {
        (objects.rect as Rect[]).push({ object_type: "rect", ...base });
      } else if (looksLine || paintOp === OPS.stroke) {
        (objects.line as Line[]).push({ object_type: "line", ...base });
      } else {
        (objects.curve as Curve[]).push({ object_type: "curve", ...base, pts: rawPoints });
      }
    }
    return objects;
  }

  protected async parseAnnotations(): Promise<Annotation[]> {
    const annotations = await this.pageProxy.getAnnotations({ intent: "display" });
    const pageHeight = this.pdf.heightOf(this);
    return annotations.flatMap((annot: any) => {
      if (!Array.isArray(annot.rect) || annot.rect.length < 4) {
        return [];
      }
      const x0 = Math.min(annot.rect[0], annot.rect[2]);
      const x1 = Math.max(annot.rect[0], annot.rect[2]);
      const y0 = Math.min(annot.rect[1], annot.rect[3]);
      const y1 = Math.max(annot.rect[1], annot.rect[3]);
      const top = pageHeight - y1;
      const bottom = pageHeight - y0;
      return [
        {
          object_type: "annot",
          page_number: this.pageNumber,
          x0,
          x1,
          top,
          bottom,
          doctop: this.initialDoctop + top,
          width: x1 - x0,
          height: bottom - top,
          y0,
          y1,
          uri: annot.url ?? annot.unsafeUrl ?? null,
          title: annot.titleObj?.str ?? annot.fieldName ?? null,
          contents: annot.contentsObj?.str ?? annot.contents ?? null,
          subtype: annot.subtype ?? null,
        },
      ];
    });
  }
}

class DerivedPage extends Page {
  constructor(protected readonly parentPage: Page, bbox: BBox) {
    super(
      parentPage.pdf,
      parentPage.pageNumber,
      (parentPage as any).pageProxy,
      parentPage.initialDoctop,
      parentPage.rotation,
      parentPage.mediabox,
      parentPage.cropbox,
      bbox,
    );
  }
}

class CroppedPage extends DerivedPage {
  private readonly sourceBBox: BBox;

  constructor(parentPage: Page, bbox: BBox, private readonly cropFn: CropFn, relative: boolean, strict: boolean) {
    const normalized = relative
      ? ([bbox[0] + parentPage.bbox[0], bbox[1] + parentPage.bbox[1], bbox[2] + parentPage.bbox[0], bbox[3] + parentPage.bbox[1]] as BBox)
      : bbox;
    if (strict) {
      validateBBox(normalized, parentPage.bbox);
    }
    super(parentPage, cropFn === outsideBBox ? parentPage.bbox : normalized);
    this.sourceBBox = normalized;
  }

  protected override async parseObjects(): Promise<ObjectMap> {
    const parentObjects = await this.parentPage.getObjects();
    const next: ObjectMap = {};
    for (const [kind, values] of Object.entries(parentObjects)) {
      next[kind as keyof ObjectMap] = this.cropFn(values as PdfObject[], this.sourceBBox);
    }
    return next;
  }

  protected override async parseAnnotations(): Promise<Annotation[]> {
    return this.cropFn(await this.parentPage.getAnnotations(), this.sourceBBox) as Annotation[];
  }
}

class FilteredPage extends DerivedPage {
  constructor(parentPage: Page, private readonly predicate: (obj: PdfObject) => boolean) {
    super(parentPage, parentPage.bbox);
  }

  protected override async parseObjects(): Promise<ObjectMap> {
    const parentObjects = await this.parentPage.getObjects();
    const next: ObjectMap = {};
    for (const [kind, values] of Object.entries(parentObjects)) {
      next[kind as keyof ObjectMap] = (values as PdfObject[]).filter(this.predicate);
    }
    return next;
  }

  protected override async parseAnnotations(): Promise<Annotation[]> {
    return (await this.parentPage.getAnnotations()).filter(this.predicate as (obj: Annotation) => boolean);
  }
}
