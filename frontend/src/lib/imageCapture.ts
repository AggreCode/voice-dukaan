/**
 * Photo preparation on the phone, before anything is uploaded.
 *
 * A modern phone camera produces 4-12 MB per shot. Sending that over shop mobile data is the slowest
 * part of the whole scan, and the free server instance has 512 MB of RAM and no business resizing
 * images. So the browser does it: one long edge of 1600 px at JPEG 0.82 keeps handwriting legible
 * (the reader needs strokes, not megapixels) and lands around 250-450 KB.
 */

export const MAX_LONG_EDGE = 1600;
export const JPEG_QUALITY = 0.82;
export const MAX_PHOTOS = 3;
/** Matches MAX_IMAGE_BYTES on the server. A photo over this after downscaling is rejected here,
 *  with an explanation, rather than after a long upload. */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export type PreparedPhotoError = 'not_an_image' | 'too_large' | 'unreadable';

export class PhotoError extends Error {
  kind: PreparedPhotoError;
  constructor(kind: PreparedPhotoError, message: string) {
    super(message);
    this.name = 'PhotoError';
    this.kind = kind;
  }
}

export interface PreparedPhoto {
  /** Downscaled JPEG, ready to upload. */
  blob: Blob;
  /** Object URL for the thumbnail. Call releasePhoto() when the photo is dropped. */
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  name: string;
}

function loadImage(file: Blob): Promise<HTMLImageElement | ImageBitmap> {
  // createImageBitmap handles EXIF orientation and HEIC where the browser supports it, and avoids a
  // decode on the main thread. Safari needs the <img> path.
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file as Blob).catch(() => loadViaImgTag(file));
  }
  return loadViaImgTag(file);
}

function loadViaImgTag(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoError('unreadable', 'That photo could not be opened. Take it again.'));
    };
    img.src = url;
  });
}

function fit(w: number, h: number, longEdge: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= longEdge) return { w, h };
  const scale = longEdge / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new PhotoError('unreadable', 'Could not process that photo.'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Downscale and re-encode one camera file. Throws PhotoError with a message fit to show as-is. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new PhotoError('not_an_image', 'That file is not a photo.');
  }
  const src = await loadImage(file);
  const sw = 'width' in src ? src.width : 0;
  const sh = 'height' in src ? src.height : 0;
  if (!sw || !sh) throw new PhotoError('unreadable', 'That photo could not be read. Take it again.');

  const { w, h } = fit(sw, sh, MAX_LONG_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('unreadable', 'This browser cannot process photos.');
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  if ('close' in src && typeof src.close === 'function') src.close();

  let blob = await toBlob(canvas, JPEG_QUALITY);
  // A dense, noisy photo can still come out big. Step the quality down before giving up.
  for (const q of [0.7, 0.6]) {
    if (blob.size <= MAX_UPLOAD_BYTES) break;
    blob = await toBlob(canvas, q);
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new PhotoError('too_large', 'That photo is too big even after shrinking. Take it a bit further back.');
  }
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: w,
    height: h,
    bytes: blob.size,
    originalBytes: file.size,
    name: file.name || 'list.jpg',
  };
}

export function releasePhoto(p: PreparedPhoto | null | undefined) {
  if (p?.previewUrl) {
    try {
      URL.revokeObjectURL(p.previewUrl);
    } catch {
      /* ignore */
    }
  }
}

export function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
