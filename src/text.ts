import { mergeBBoxes } from "./geometry.js";
import type { Char, SearchMatch, Word } from "./types.js";

const DEFAULT_X_TOLERANCE = 3;
const DEFAULT_Y_TOLERANCE = 3;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clusterWordsByLine(words: Word[], yTolerance: number): Word[][] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const lines: Word[][] = [];
  for (const word of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= yTolerance);
    if (line) {
      line.push(word);
    } else {
      lines.push([word]);
    }
  }
  for (const line of lines) {
    line.sort((a, b) => a.x0 - b.x0);
  }
  return lines;
}

export function extractText(chars: Char[], xTolerance = DEFAULT_X_TOLERANCE, yTolerance = DEFAULT_Y_TOLERANCE): string {
  const words = extractWords(chars, xTolerance, yTolerance);
  const lines = clusterWordsByLine(words, yTolerance);
  return lines.map((line) => line.map((word) => word.text).join(" ")).join("\n");
}

export function extractWords(chars: Char[], xTolerance = DEFAULT_X_TOLERANCE, yTolerance = DEFAULT_Y_TOLERANCE): Word[] {
  const sorted = [...chars].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const words: Word[] = [];
  let current: Char[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const bbox = mergeBBoxes(current);
    words.push({
      text: current.map((char) => char.text).join(""),
      chars: current,
      object_type: "word",
      page_number: current[0].page_number,
      x0: bbox[0],
      top: bbox[1],
      x1: bbox[2],
      bottom: bbox[3],
      width: bbox[2] - bbox[0],
      height: bbox[3] - bbox[1],
      doctop: current[0].doctop,
      y0: current[0].y0,
      y1: current[0].y1,
    });
    current = [];
  };

  for (const char of sorted) {
    if (/\s/.test(char.text)) {
      flush();
      continue;
    }
    if (current.length === 0) {
      current.push(char);
      continue;
    }
    const prev = current[current.length - 1];
    const sameLine = Math.abs(prev.top - char.top) <= yTolerance;
    const gap = char.x0 - prev.x1;
    if (!sameLine || gap > xTolerance) {
      flush();
    }
    current.push(char);
  }
  flush();
  return words;
}

export function search(
  chars: Char[],
  pattern: string | RegExp,
  regex = true,
  caseSensitive = true,
): SearchMatch[] {
  const sourceText = chars.map((char) => char.text).join("");
  const compiled =
    pattern instanceof RegExp
      ? pattern
      : new RegExp(regex ? pattern : escapeRegex(pattern), caseSensitive ? "g" : "gi");
  const matches: SearchMatch[] = [];

  for (const match of sourceText.matchAll(compiled)) {
    if (!match[0] || !match[0].trim()) {
      continue;
    }
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const matchedChars = chars.slice(start, end);
    if (matchedChars.length === 0) {
      continue;
    }
    const bbox = mergeBBoxes(matchedChars);
    matches.push({
      text: match[0],
      x0: bbox[0],
      top: bbox[1],
      x1: bbox[2],
      bottom: bbox[3],
      chars: matchedChars,
      groups: match.slice(1),
    });
  }
  return matches;
}
