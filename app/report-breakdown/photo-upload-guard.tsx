'use client';

import { useEffect } from 'react';

const TARGET_BYTES = 600_000;
const MAX_DIMENSION = 1600;
const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.44];

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not prepare the photo for upload.'));
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
      reject(new Error(`Could not read ${file.name || 'photo'}.`));
    };
    image.src = url;
  });
}

async function compressPhoto(file: File) {
  if (!file.type.startsWith('image/') || file.size <= TARGET_BYTES) return file;

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not prepare the photo for upload.');

  let best: Blob | null = null;
  for (let pass = 0; pass < 3; pass += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of QUALITIES) {
      const blob = await canvasBlob(canvas, quality);
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    if (best && best.size <= TARGET_BYTES) break;
    width = Math.max(900, Math.round(width * 0.82));
    height = Math.max(900, Math.round(height * 0.82));
  }

  if (!best) return file;
  const base = (file.name || 'breakdown-photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-');
  return new File([best], `${base || 'breakdown-photo'}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function prepareFiles(files: File[]) {
  const prepared: File[] = [];
  for (const file of files.slice(0, 6)) {
    try {
      prepared.push(await compressPhoto(file));
    } catch (error) {
      console.warn('breakdown_photo_compress_failed', error);
      prepared.push(file);
    }
  }
  return prepared;
}

export default function PhotoUploadGuard() {
  useEffect(() => {
    const preparedByForm = new WeakMap<HTMLFormElement, File[]>();
    const resubmitting = new WeakSet<HTMLFormElement>();

    const onFormData = (event: Event) => {
      const formEvent = event as FormDataEvent;
      const form = formEvent.target instanceof HTMLFormElement ? formEvent.target : null;
      if (!form) return;
      const prepared = preparedByForm.get(form);
      if (!prepared) return;

      formEvent.formData.delete('photos');
      for (const file of prepared) {
        formEvent.formData.append('photos', file, file.name);
      }
      preparedByForm.delete(form);
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;

      if (resubmitting.has(form)) {
        resubmitting.delete(form);
        return;
      }

      const input = form.querySelector<HTMLInputElement>('input[type="file"][name="photos"]');
      const files = Array.from(input?.files || []).slice(0, 6);
      if (!files.length) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      void prepareFiles(files).then((prepared) => {
        preparedByForm.set(form, prepared);
        resubmitting.add(form);
        form.requestSubmit();
      }).catch((error) => {
        console.warn('breakdown_photo_prepare_failed', error);
        preparedByForm.set(form, files);
        resubmitting.add(form);
        form.requestSubmit();
      });
    };

    document.addEventListener('formdata', onFormData, true);
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('formdata', onFormData, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  return null;
}
