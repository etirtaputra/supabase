/**
 * Shrink a phone photo before it is uploaded to the Inbox (owner, 2026-11-22:
 * "do the photo shrinking"). A camera photo is 2–4 MB at 4000 px; the reader
 * (Claude) looks at about 1568 px on the long edge anyway, so 1600 px JPEG
 * keeps every word legible at ~0.2–0.5 MB — the free plan's 1 GB lasts ~10×
 * longer. Browser-only (canvas). PDFs, small images and anything the browser
 * cannot decode go up untouched — the server still checks the type.
 */
export const PHOTO_MAX_EDGE = 1600;
const QUALITY = 0.85;

/** The size a photo is drawn at: long edge PHOTO_MAX_EDGE, never enlarged. Pure. */
export function shrunkSize(w: number, h: number, max = PHOTO_MAX_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    // from-image: an iPhone photo's EXIF rotation is applied before drawing.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { w, h } = shrunkSize(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff';             // a transparent PNG becomes white paper, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
