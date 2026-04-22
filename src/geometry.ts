import type { BBox, PdfObject } from "./types.js";

export function objToBBox(obj: Pick<PdfObject, "x0" | "top" | "x1" | "bottom">): BBox {
  return [obj.x0, obj.top, obj.x1, obj.bottom];
}

export function bboxOverlap(a: BBox, b: BBox): BBox | null {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  if (right <= left || bottom <= top) {
    return null;
  }
  return [left, top, right, bottom];
}

export function bboxArea(bbox: BBox): number {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  if (width < 0 || height < 0) {
    throw new Error(`Invalid bbox: ${bbox.join(", ")}`);
  }
  return width * height;
}

export function withinBBox<T extends PdfObject>(objects: T[], bbox: BBox): T[] {
  return objects.filter((obj) => {
    const overlap = bboxOverlap(objToBBox(obj), bbox);
    return (
      overlap !== null &&
      overlap[0] === obj.x0 &&
      overlap[1] === obj.top &&
      overlap[2] === obj.x1 &&
      overlap[3] === obj.bottom
    );
  });
}

export function outsideBBox<T extends PdfObject>(objects: T[], bbox: BBox): T[] {
  return objects.filter((obj) => bboxOverlap(objToBBox(obj), bbox) === null);
}

export function cropToBBox<T extends PdfObject>(objects: T[], bbox: BBox): T[] {
  return objects.flatMap((obj) => {
    const overlap = bboxOverlap(objToBBox(obj), bbox);
    if (!overlap) {
      return [];
    }
    const topDelta = overlap[1] - obj.top;
    return [
      {
        ...obj,
        x0: overlap[0],
        top: overlap[1],
        x1: overlap[2],
        bottom: overlap[3],
        width: overlap[2] - overlap[0],
        height: overlap[3] - overlap[1],
        doctop: obj.doctop + topDelta,
      },
    ] as T[];
  });
}

export function mergeBBoxes(
  objects: Array<Pick<PdfObject, "x0" | "top" | "x1" | "bottom">>,
): BBox {
  const x0 = Math.min(...objects.map((obj) => obj.x0));
  const top = Math.min(...objects.map((obj) => obj.top));
  const x1 = Math.max(...objects.map((obj) => obj.x1));
  const bottom = Math.max(...objects.map((obj) => obj.bottom));
  return [x0, top, x1, bottom];
}

export function validateBBox(bbox: BBox, parentBBox: BBox): void {
  if (bboxArea(bbox) === 0) {
    throw new Error(`Bounding box ${bbox.join(", ")} has zero area.`);
  }
  const overlap = bboxOverlap(bbox, parentBBox);
  if (!overlap) {
    throw new Error(`Bounding box ${bbox.join(", ")} is outside parent bbox.`);
  }
  if (bboxArea(overlap) < bboxArea(bbox)) {
    throw new Error(`Bounding box ${bbox.join(", ")} must be fully inside parent bbox.`);
  }
}
