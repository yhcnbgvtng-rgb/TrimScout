/**
 * Browser-side photo preparation for the trade-in step.
 *
 * Phone photos are 3–12 MB each; five of them would be a 60 MB request and
 * a 60 MB row. Resizing to 1280px on the long edge and re-encoding as JPEG
 * brings a typical shot to 150–350 KB while keeping dents, curb rash and an
 * odometer readable — which is all the dealer needs to price it.
 *
 * Browser-only (canvas + Image). Never import from a server route.
 */

export const TRADE_IN_PHOTO_MAX_EDGE = 1280;
export const TRADE_IN_PHOTO_QUALITY = 0.82;
/** Guards the request body; the box independently caps each photo too. */
export const TRADE_IN_PHOTO_MAX_DATA_URL_CHARS = 2_000_000;

export async function compressPhotoForTradeIn(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file isn't an image.");
  }
  const bitmap = await loadImage(file);
  const scale = Math.min(1, TRADE_IN_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process the photo in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap && typeof (bitmap as ImageBitmap).close === "function") {
    (bitmap as ImageBitmap).close();
  }

  // Step quality down if a busy, high-detail shot still comes out large.
  let quality = TRADE_IN_PHOTO_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > TRADE_IN_PHOTO_MAX_DATA_URL_CHARS && quality > 0.5) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > TRADE_IN_PHOTO_MAX_DATA_URL_CHARS) {
    throw new Error("That photo is too detailed to send — try a different shot.");
  }
  return dataUrl;
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation in modern browsers, so a
  // portrait phone shot doesn't arrive sideways.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      // fall through to the <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image."));
    };
    img.src = url;
  });
}
