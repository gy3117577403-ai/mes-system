export type ReadyFlagInput = {
  drawing?: unknown;
  materials?: unknown;
  isDrawingReady?: unknown;
  isMaterialReady?: unknown;
};

export type NormalizedReadyFlags = {
  drawing?: string;
  materials?: string;
  isDrawingReady?: boolean;
  isMaterialReady?: boolean;
};

const DRAWING_READY_TEXTS = ['已发', '已发图', '图纸已发', '已下发', '图纸已下发', '已提供图纸', '图纸齐全'];
const DRAWING_NOT_READY_TEXTS = ['未发图', '未下发', '待发图', '缺图纸', '无图纸'];
const MATERIAL_READY_TEXTS = ['料齐', '已配料', '已齐套', '齐套', '物料齐', '物料已齐', '配料完成'];
const MATERIAL_NOT_READY_TEXTS = ['未配料', '缺料', '待配料', '物料不足', '欠料'];

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function textMatches(value: unknown, positive: string[], negative: string[]): boolean {
  const text = cleanText(value);
  if (!text) return false;
  if (negative.some((keyword) => text.includes(keyword))) return false;
  return positive.some((keyword) => text.includes(keyword));
}

function textExplicitlyNotReady(value: unknown, negative: string[]): boolean {
  const text = cleanText(value);
  if (!text) return false;
  return negative.some((keyword) => text.includes(keyword));
}

export function isDrawingTextReady(text: unknown): boolean {
  return textMatches(text, DRAWING_READY_TEXTS, DRAWING_NOT_READY_TEXTS);
}

export function isMaterialTextReady(text: unknown): boolean {
  return textMatches(text, MATERIAL_READY_TEXTS, MATERIAL_NOT_READY_TEXTS);
}

export function normalizeReadyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (value === 1) return true;
  if (value === 0) return false;
  const text = cleanText(value).toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return false;
}

function hasExplicitFlag(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function normalizeOrderReadyFlags(input: ReadyFlagInput): NormalizedReadyFlags {
  const output: NormalizedReadyFlags = {};

  if (input.drawing !== undefined) {
    output.drawing = cleanText(input.drawing);
  }
  if (input.materials !== undefined) {
    output.materials = cleanText(input.materials);
  }

  if (hasExplicitFlag(input.isDrawingReady)) {
    output.isDrawingReady = normalizeReadyFlag(input.isDrawingReady);
  } else if (input.drawing !== undefined) {
    if (isDrawingTextReady(input.drawing)) {
      output.isDrawingReady = true;
    } else if (textExplicitlyNotReady(input.drawing, DRAWING_NOT_READY_TEXTS)) {
      output.isDrawingReady = false;
    }
  }

  if (hasExplicitFlag(input.isMaterialReady)) {
    output.isMaterialReady = normalizeReadyFlag(input.isMaterialReady);
  } else if (input.materials !== undefined) {
    if (isMaterialTextReady(input.materials)) {
      output.isMaterialReady = true;
    } else if (textExplicitlyNotReady(input.materials, MATERIAL_NOT_READY_TEXTS)) {
      output.isMaterialReady = false;
    }
  }

  return output;
}

