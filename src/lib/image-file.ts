'use client';

const MAX_IMAGE_BYTES = 300 * 1024;

/** Reads an uploaded logo into a data URL, enforcing type and size (the API re-checks both). */
export function readImageFile(file: File, onLoad: (dataUrl: string) => void, onError: (message: string) => void) {
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) {
    onError('Use a PNG, JPEG, GIF, WebP or SVG image.');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    onError('Images must be under 300 KB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result));
  reader.onerror = () => onError('Could not read that file.');
  reader.readAsDataURL(file);
}
