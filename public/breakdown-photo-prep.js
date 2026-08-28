(function () {
  'use strict';

  if (typeof window === 'undefined' || window.location.pathname !== '/report-breakdown') return;

  var MAX_EDGE = 1600;
  var TARGET_BYTES = 700000;
  var MIN_EDGE = 900;

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Photo could not be prepared.'));
      };
      image.src = url;
    });
  }

  function canvasBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Photo could not be compressed.'));
      }, 'image/jpeg', quality);
    });
  }

  function outputName(name) {
    var cleaned = String(name || 'breakdown-photo').replace(/\.[^.]+$/, '');
    return (cleaned || 'breakdown-photo') + '.jpg';
  }

  async function preparePhoto(file) {
    if (!(file instanceof File) || !String(file.type || '').toLowerCase().startsWith('image/')) return file;
    if (file.size <= TARGET_BYTES && !/hei[cf]/i.test(file.type || '')) return file;

    var image = await loadImage(file);
    var sourceWidth = image.naturalWidth || image.width;
    var sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) return file;

    var longest = Math.max(sourceWidth, sourceHeight);
    var scale = Math.min(1, MAX_EDGE / longest);
    var quality = 0.82;
    var bestBlob = null;

    for (var attempt = 0; attempt < 6; attempt += 1) {
      var width = Math.max(1, Math.round(sourceWidth * scale));
      var height = Math.max(1, Math.round(sourceHeight * scale));
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext('2d', { alpha: false });
      if (!context) return file;
      context.drawImage(image, 0, 0, width, height);
      bestBlob = await canvasBlob(canvas, quality);
      canvas.width = 1;
      canvas.height = 1;

      if (bestBlob.size <= TARGET_BYTES) break;
      if (Math.max(width, height) <= MIN_EDGE) break;
      scale *= 0.82;
      quality = Math.max(0.62, quality - 0.06);
    }

    if (!bestBlob) return file;
    return new File([bestBlob], outputName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now(),
    });
  }

  function setSubmitBusy(input, busy) {
    var form = input.form;
    if (!form) return;
    var buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    buttons.forEach(function (button) {
      if (!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement)) return;
      if (busy) {
        button.dataset.photoPrepWasDisabled = button.disabled ? '1' : '0';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      } else {
        if (button.dataset.photoPrepWasDisabled !== '1') button.disabled = false;
        delete button.dataset.photoPrepWasDisabled;
        button.removeAttribute('aria-busy');
      }
    });
  }

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'file' || input.name !== 'photos') return;
    var selected = Array.from(input.files || []).slice(0, 6);
    if (!selected.length) return;

    var runId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    input.dataset.photoPrepRun = runId;
    input.dataset.photoPrep = 'working';
    setSubmitBusy(input, true);

    void Promise.all(selected.map(function (file) {
      return preparePhoto(file).catch(function () { return file; });
    })).then(function (prepared) {
      if (input.dataset.photoPrepRun !== runId) return;
      var transfer = new DataTransfer();
      prepared.forEach(function (file) { transfer.items.add(file); });
      input.files = transfer.files;
      input.dataset.photoPrep = 'ready';
    }).catch(function () {
      if (input.dataset.photoPrepRun === runId) input.dataset.photoPrep = 'failed';
    }).finally(function () {
      if (input.dataset.photoPrepRun === runId) setSubmitBusy(input, false);
    });
  }, true);
})();
