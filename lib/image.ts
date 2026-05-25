// Client-side image compression. Resizes oversized photos (modern phones
// shoot at 12–48 MP) down to a sane web ceiling and re-encodes as JPEG —
// drops a typical 4–8 MB iPhone capture to 300–800 KB with no visible
// quality loss. Also handles HEIC inputs by going through the browser's
// native image decoder (Safari decodes HEIC natively; Chrome/Firefox
// can't, in which case we fall back to passing the original blob through
// untouched so the upload doesn't fail — Convex storage accepts any
// MIME type).
//
// Pure browser APIs: createImageBitmap, OffscreenCanvas, HTMLCanvasElement.
// No npm deps.

const MAX_DIMENSION = 2000; // px — the long edge after resize
const JPEG_QUALITY = 0.85;  // visually transparent for photos
// Files smaller than this are passed through unchanged — re-encoding a
// tiny image only wastes CPU and can actually make it bigger.
const PASSTHROUGH_THRESHOLD_BYTES = 500_000;

export type CompressionResult = {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  passthrough: boolean;
};

export async function compressImage(file: File): Promise<CompressionResult> {
  // 0. Cheap escape for already-small images.
  if (file.size < PASSTHROUGH_THRESHOLD_BYTES) {
    return {
      blob: file,
      width: 0,
      height: 0,
      originalBytes: file.size,
      compressedBytes: file.size,
      passthrough: true,
    };
  }

  // 1. Decode the file into a bitmap. createImageBitmap is the fastest
  //    path on modern browsers (does decoding off the main thread) and
  //    handles JPEG / PNG / WebP natively; on Safari it also handles
  //    HEIC. If decoding fails (e.g. HEIC on Chrome), fall through to
  //    passthrough so the upload still succeeds.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return {
      blob: file,
      width: 0,
      height: 0,
      originalBytes: file.size,
      compressedBytes: file.size,
      passthrough: true,
    };
  }

  // 2. Compute target dimensions — long edge capped at MAX_DIMENSION,
  //    aspect ratio preserved.
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > MAX_DIMENSION ? MAX_DIMENSION / longEdge : 1;
  const targetW = Math.round(bitmap.width * scale);
  const targetH = Math.round(bitmap.height * scale);

  // 3. Draw to a canvas. Prefer OffscreenCanvas (no DOM round-trip) on
  //    browsers that support it; fall back to a detached <canvas>.
  let blob: Blob;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      throw new Error("Couldn't create canvas context");
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
    });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      throw new Error("Couldn't create canvas context");
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed"))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  }

  // 4. If the "compressed" blob ended up larger than the original (rare
  //    — small high-detail photos sometimes inflate), keep the original.
  if (blob.size >= file.size) {
    return {
      blob: file,
      width: bitmap.width,
      height: bitmap.height,
      originalBytes: file.size,
      compressedBytes: file.size,
      passthrough: true,
    };
  }

  return {
    blob,
    width: targetW,
    height: targetH,
    originalBytes: file.size,
    compressedBytes: blob.size,
    passthrough: false,
  };
}
