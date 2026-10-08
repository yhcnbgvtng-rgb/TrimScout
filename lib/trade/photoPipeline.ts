"use client";
/**
 * Browser-only glue for one trade photo: type/size check → HEIC→JPEG → quality check on the ORIGINAL pixels
 * (so "too small" means what the camera produced) → resize to ≤2048 px long edge → canvas re-encode, which
 * drops every EXIF tag including GPS. The capture timestamp is read first and carried alongside.
 */
import { analyzePixels, fitWithin, judgeFile, judgePhoto, readExifCaptureTime } from "./photoQuality";

export type ProcessedPhoto = { ok: true; blob: Blob; width: number; height: number; capturedAt: string | null } | { ok: false; message: string };

async function toJpegBlob(file: File): Promise<Blob> {
  const isHeic = /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}

export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const fileVerdict = judgeFile(file);
  if (!fileVerdict.ok) return { ok: false, message: fileVerdict.message };
  let source: Blob;
  try { source = await toJpegBlob(file); } catch { return { ok: false, message: "That HEIC photo couldn't be read. Retake it or share it as a JPEG." }; }
  // Read the timestamp from the original bytes (a HEIC's converted JPEG keeps none we can trust).
  let capturedAt: string | null = null;
  try { capturedAt = readExifCaptureTime(new Uint8Array(await file.slice(0, 131072).arrayBuffer())); } catch { /* optional */ }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(source, { imageOrientation: "from-image" }); } catch { return { ok: false, message: "That image couldn't be opened. Try another photo." }; }

  // Quality: judge the camera's own pixels, analysed on a small copy.
  const small = fitWithin(bitmap.width, bitmap.height, 320);
  const probe = document.createElement("canvas");
  probe.width = small.width; probe.height = small.height;
  const pctx = probe.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(bitmap, 0, 0, small.width, small.height);
  const stats = analyzePixels(pctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
  const verdict = judgePhoto({ width: bitmap.width, height: bitmap.height }, stats);
  if (!verdict.ok) { bitmap.close?.(); return { ok: false, message: verdict.message }; }

  const target = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = target.width; canvas.height = target.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) return { ok: false, message: "Couldn't prepare that photo. Try again." };
  return { ok: true, blob, width: target.width, height: target.height, capturedAt };
}
