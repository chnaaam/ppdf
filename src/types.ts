export type BBox = [x0: number, top: number, x1: number, bottom: number];

export interface BasePdfObject {
  object_type: string;
  page_number: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  doctop: number;
  y0?: number;
  y1?: number;
}

export interface Char extends BasePdfObject {
  object_type: "char";
  text: string;
  fontname: string;
  size: number;
  adv: number;
  upright: boolean;
  matrix: [number, number, number, number, number, number];
  stroking_color?: string | null;
  non_stroking_color?: string | null;
  dir?: string;
}

export interface Line extends BasePdfObject {
  object_type: "line";
  linewidth: number;
  stroking_color?: string | null;
  non_stroking_color?: string | null;
}

export interface Rect extends BasePdfObject {
  object_type: "rect";
  linewidth: number;
  stroking_color?: string | null;
  non_stroking_color?: string | null;
}

export interface Curve extends BasePdfObject {
  object_type: "curve";
  linewidth: number;
  stroking_color?: string | null;
  non_stroking_color?: string | null;
  pts: Array<[number, number]>;
}

export interface ImageObject extends BasePdfObject {
  object_type: "image";
  name?: string;
}

export interface Annotation extends BasePdfObject {
  object_type: "annot";
  uri?: string | null;
  title?: string | null;
  contents?: string | null;
  subtype?: string | null;
}

export type PdfObject = Char | Line | Rect | Curve | ImageObject | Annotation;
export type ObjectMap = Partial<Record<PdfObject["object_type"], PdfObject[]>>;

export interface SearchMatch {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  chars: Char[];
  groups?: string[];
}

export interface Word extends BasePdfObject {
  text: string;
  chars: Char[];
}

export interface OpenOptions {
  password?: string;
  stopAtErrors?: boolean;
}
