/**
 * Client-side photo checks before a trade photo is accepted. Deliberately simple (no vision API):
 *  - the short edge must be at least 1024 px,
 *  - near-black frames are rejected,
 *  - heavily blurred frames are rejected (variance of the Laplacian on a downscaled grayscale copy).
 * The pixel math is pure so it is unit-tested with synthetic images; the browser glue is in photoPipeline.ts.
 */
export const MIN_SHORT_EDGE = 1024;
export const MAX_LONG_EDGE = 2048;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"] as const;
/** Mean luma (0–255) below this, or this share of near-black pixels, reads as a dark / covered lens. */
export const DARK_MEAN = 28;
export const DARK_SHARE = 0.85;
/** Laplacian variance (on a ≤320 px grayscale copy) below this reads as blurred. Tuned on synthetic sharp/blurred frames. */
export const BLUR_MIN = 18;

export interface PixelStats { meanLuma: number; darkShare: number; blurScore: number }

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** `rgba` is canvas ImageData.data, ideally already downscaled so the long edge is ≤ 320. */
export function analyzePixels(rgba: ArrayLike<number>, width: number, height: number): PixelStats {
  const n = width * height;
  const gray = new Float32Array(n);
  let sum = 0, dark = 0;
  for (let i = 0; i < n; i++) {
    const g = luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    gray[i] = g; sum += g;
    if (g < 20) dark++;
  }
  // 4-neighbour Laplacian variance.
  let m = 0, m2 = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      m += l; m2 += l * l; count++;
    }
  }
  const mean = count ? m / count : 0;
  return { meanLuma: n ? sum / n : 0, darkShare: n ? dark / n : 1, blurScore: count ? m2 / count - mean * mean : 0 };
}

export type PhotoVerdict = { ok: true } | { ok: false; reason: "type" | "too_big" | "too_small" | "too_dark" | "too_blurry"; message: string };

export function judgeFile(file: { type: string; size: number; name?: string }): PhotoVerdict {
  const t = (file.type || "").toLowerCase();
  const heicByName = /\.(heic|heif)$/i.test(file.name || "");
  if (!(ACCEPTED_TYPES as readonly string[]).includes(t) && !heicByName) return { ok: false, reason: "type", message: "Use a JPEG, PNG or HEIC photo." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "too_big", message: "That file is over 10 MB. Retake it or pick a smaller one." };
  return { ok: true };
}

export function judgePhoto(dims: { width: number; height: number }, stats: PixelStats): PhotoVerdict {
  if (Math.min(dims.width, dims.height) < MIN_SHORT_EDGE) {
    return { ok: false, reason: "too_small", message: `That photo is too small (${dims.width}×${dims.height}). Retake it with the camera at full size; the short side needs at least ${MIN_SHORT_EDGE}px.` };
  }
  if (stats.meanLuma < DARK_MEAN || stats.darkShare > DARK_SHARE) return { ok: false, reason: "too_dark", message: "That photo is too dark. Retake it with more light." };
  if (stats.blurScore < BLUR_MIN) return { ok: false, reason: "too_blurry", message: "That photo looks blurry. Hold steady and retake it." };
  return { ok: true };
}

/** Fit inside MAX_LONG_EDGE, never upscale. */
export function fitWithin(width: number, height: number, maxLong = MAX_LONG_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLong) return { width, height };
  const k = maxLong / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * EXIF DateTimeOriginal from a JPEG header as "YYYY-MM-DDTHH:MM:SS", or null. Location (GPS) data is never read:
 * the pipeline re-encodes through a canvas, which drops all EXIF, and the timestamp is carried separately.
 */
export function readExifCaptureTime(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (marker === 0xe1 && bytes[p + 4] === 0x45 && bytes[p + 5] === 0x78 && bytes[p + 6] === 0x69 && bytes[p + 7] === 0x66) {
      const seg = bytes.subarray(p + 10, p + 2 + len);
      const m = new TextDecoder("latin1").decode(seg).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
    }
    if (marker === 0xda) return null;
    p += 2 + len;
  }
  return null;
}
