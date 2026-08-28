'use client';

import { useEffect } from 'react';

const MAX_PHOTOS = 6;
const MAX_PER_PHOTO_BYTES = 700_000;
const TARGET_TOTAL_PHOTO_BYTES = 4_000_000;
const MAX_DIMENSION = 1600;
const MIN_DIMENSION = 720;
const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.44, 0.36];

function requestPath(input: RequestInfo | URL) {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href).pathname;
    if (input instanceof URL) return input.pathname;
    return new URL(input.url, window.location.href).pathname;
  } catch {
    return '';
  }
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The photo could not be resized.'));
    }, 'image/jpeg', quality);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`The phone could not prepare ${file.name || 'the selected photo'} for upload.`));
    };
    image.src = url;
  });
}

function safeBaseName(file: File) {
  const base = (file.name || 'breakdown-photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 120);
  return base || 'breakdown-photo';
}

async function compressPhoto(file: File, targetBytes: number) {
  if (!file.type.startsWith('image/') || file.size <= targetBytes) return file;

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error('The selected photo has no readable dimensions.');

  const initialScale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * initialScale));
  let height = Math.max(1, Math.round(sourceHeight * initialScale));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The phone could not prepare the selected photo for upload.');

  let best: Blob | null = null;
  for (let pass = 0; pass < 4; pass += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of JPEG_QUALITIES) {
      const blob = await canvasJpeg(canvas, quality);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= targetBytes) break;
    }

    if (best && best.size <= targetBytes) break;

    const longest = Math.max(width, height);
    if (longest <= MIN_DIMENSION) break;
    const nextScale = Math.max(MIN_DIMENSION / longest, 0.8);
    width = Math.max(1, Math.round(width * nextScale));
    height = Math.max(1, Math.round(height * nextScale));
  }

  if (!best) throw new Error('The selected photo could not be resized.');
  if (best.size >= file.size) return file;

  return new File([best], `${safeBaseName(file)}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function prepareBreakdownForm(form: FormData) {
  const photos = form
    .getAll('photos')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .slice(0, MAX_PHOTOS);

  if (!photos.length) return form;

  const targetPerPhoto = Math.min(
    MAX_PER_PHOTO_BYTES,
    Math.max(250_000, Math.floor(TARGET_TOTAL_PHOTO_BYTES / photos.length)),
  );

  const prepared: File[] = [];
  for (const photo of photos) {
    prepared.push(await compressPhoto(photo, targetPerPhoto));
  }

  const next = new FormData();
  for (const [name, value] of form.entries()) {
    if (name === 'photos') continue;
    if (value instanceof File) next.append(name, value, value.name);
    else next.append(name, value);
  }
  for (const photo of prepared) next.append('photos', photo, photo.name);
  return next;
}

function photoPreparationError(error: unknown) {
  const detail = error instanceof Error ? error.message : 'The selected photo could not be resized.';
  return new Response(JSON.stringify({
    error: `${detail} The breakdown was not submitted. Please try the photo again.`,
  }), {
    status: 413,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export default function BreakdownPhotoRequestCompressor() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    const compressedFetch: typeof window.fetch = async (input, init) => {
      if (
        requestPath(input) !== '/api/breakdowns'
        || String(init?.method || 'GET').toUpperCase() !== 'POST'
        || !(init?.body instanceof FormData)
      ) {
        return originalFetch(input, init);
      }

      const hasPhotos = init.body
        .getAll('photos')
        .some((entry) => entry instanceof File && entry.size > 0);
      if (!hasPhotos) return originalFetch(input, init);

      try {
        const body = await prepareBreakdownForm(init.body);
        return originalFetch(input, { ...init, body });
      } catch (error) {
        console.warn('breakdown_photo_request_prepare_failed', error);
        return photoPreparationError(error);
      }
    };

    window.fetch = compressedFetch;
    return () => {
      if (window.fetch === compressedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
