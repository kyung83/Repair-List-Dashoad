(function () {
  'use strict';

  if (typeof window === 'undefined' || window.location.pathname !== '/report-breakdown') return;

  var MAX_PHOTOS = 6;
  var MAX_EDGE = 1600;
  var TARGET_BYTES = 700000;
  var MIN_EDGE = 900;
  var photoState = new WeakMap();
  var previewUrls = new WeakMap();

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

  function fileKey(file) {
    return [file.name || '', file.size || 0, file.lastModified || 0, file.type || ''].join('|');
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

  function syncInputFiles(input, items) {
    var transfer = new DataTransfer();
    items.forEach(function (item) { transfer.items.add(item.file); });
    input.files = transfer.files;
  }

  function clearPreviewUrls(input) {
    var urls = previewUrls.get(input) || [];
    urls.forEach(function (url) { URL.revokeObjectURL(url); });
    previewUrls.set(input, []);
  }

  function managerFor(input) {
    var label = input.closest('label');
    if (!label) return null;
    var next = label.nextElementSibling;
    if (next && next.classList.contains('breakdown-photo-manager')) return next;

    var manager = document.createElement('div');
    manager.className = 'breakdown-photo-manager';
    manager.style.marginTop = '10px';
    manager.style.padding = '12px';
    manager.style.border = '1px solid #d7e0e7';
    manager.style.borderRadius = '12px';
    manager.style.background = '#f8fafc';
    label.insertAdjacentElement('afterend', manager);
    return manager;
  }

  function renderManager(input, items, note) {
    var manager = managerFor(input);
    if (!manager) return;

    clearPreviewUrls(input);
    manager.replaceChildren();

    var header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '10px';

    var title = document.createElement('strong');
    title.textContent = items.length + ' of ' + MAX_PHOTOS + ' photos attached';
    title.style.color = '#172033';
    title.style.fontSize = '14px';
    header.appendChild(title);

    if (items.length) {
      var clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.textContent = 'Remove all';
      clearButton.style.border = '0';
      clearButton.style.background = 'transparent';
      clearButton.style.color = '#9a3412';
      clearButton.style.fontWeight = '850';
      clearButton.style.cursor = 'pointer';
      clearButton.disabled = input.dataset.photoPrep === 'working';
      clearButton.addEventListener('click', function () {
        photoState.set(input, []);
        syncInputFiles(input, []);
        renderManager(input, [], 'Photos cleared.');
      });
      header.appendChild(clearButton);
    }

    manager.appendChild(header);

    if (items.length) {
      var grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fit,minmax(105px,1fr))';
      grid.style.gap = '10px';
      grid.style.marginTop = '10px';

      var urls = [];
      items.forEach(function (item, index) {
        var card = document.createElement('div');
        card.style.position = 'relative';
        card.style.overflow = 'hidden';
        card.style.border = '1px solid #cbd5e1';
        card.style.borderRadius = '10px';
        card.style.background = '#fff';

        var image = document.createElement('img');
        var url = URL.createObjectURL(item.file);
        urls.push(url);
        image.src = url;
        image.alt = 'Breakdown photo ' + (index + 1);
        image.style.display = 'block';
        image.style.width = '100%';
        image.style.height = '96px';
        image.style.objectFit = 'cover';
        card.appendChild(image);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', 'Remove breakdown photo ' + (index + 1));
        remove.style.width = '100%';
        remove.style.minHeight = '34px';
        remove.style.border = '0';
        remove.style.borderTop = '1px solid #e2e8f0';
        remove.style.background = '#fff';
        remove.style.color = '#9a3412';
        remove.style.fontWeight = '850';
        remove.style.cursor = 'pointer';
        remove.disabled = input.dataset.photoPrep === 'working';
        remove.addEventListener('click', function () {
          var current = photoState.get(input) || [];
          var nextItems = current.filter(function (candidate) { return candidate.key !== item.key; });
          photoState.set(input, nextItems);
          syncInputFiles(input, nextItems);
          renderManager(input, nextItems, 'Photo removed.');
        });
        card.appendChild(remove);
        grid.appendChild(card);
      });
      previewUrls.set(input, urls);
      manager.appendChild(grid);
    }

    var help = document.createElement('div');
    help.style.marginTop = '10px';
    help.style.color = '#64748b';
    help.style.fontSize = '12px';
    help.style.lineHeight = '1.4';
    help.textContent = items.length >= MAX_PHOTOS
      ? 'Maximum of 6 photos reached. Remove one above if you need to replace it.'
      : 'Tap the photo picker above again to add another photo. New photos are added to the ones already attached.';
    manager.appendChild(help);

    if (note) {
      var message = document.createElement('div');
      message.style.marginTop = '6px';
      message.style.color = '#475569';
      message.style.fontSize = '12px';
      message.textContent = note;
      manager.appendChild(message);
    }
  }

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'file' || input.name !== 'photos') return;

    var selected = Array.from(input.files || []);
    if (!selected.length) return;

    var previous = photoState.get(input) || [];
    var existingKeys = new Set(previous.map(function (item) { return item.key; }));
    var remaining = Math.max(0, MAX_PHOTOS - previous.length);
    var additions = [];

    selected.forEach(function (file) {
      var key = fileKey(file);
      if (!existingKeys.has(key) && additions.length < remaining) {
        existingKeys.add(key);
        additions.push({ key: key, file: file });
      }
    });

    if (!additions.length) {
      syncInputFiles(input, previous);
      renderManager(input, previous, previous.length >= MAX_PHOTOS ? 'Maximum of 6 photos reached.' : 'That photo is already attached.');
      return;
    }

    var runId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    input.dataset.photoPrepRun = runId;
    input.dataset.photoPrep = 'working';
    input.disabled = true;
    setSubmitBusy(input, true);
    renderManager(input, previous, 'Preparing ' + additions.length + ' new photo' + (additions.length === 1 ? '' : 's') + '...');

    void Promise.all(additions.map(function (item) {
      return preparePhoto(item.file)
        .catch(function () { return item.file; })
        .then(function (prepared) { return { key: item.key, file: prepared }; });
    })).then(function (preparedAdditions) {
      if (input.dataset.photoPrepRun !== runId) return;
      var current = photoState.get(input) || previous;
      var currentKeys = new Set(current.map(function (item) { return item.key; }));
      var nextItems = current.slice();
      preparedAdditions.forEach(function (item) {
        if (!currentKeys.has(item.key) && nextItems.length < MAX_PHOTOS) {
          currentKeys.add(item.key);
          nextItems.push(item);
        }
      });
      photoState.set(input, nextItems);
      syncInputFiles(input, nextItems);
      input.dataset.photoPrep = 'ready';
      var clipped = selected.length > additions.length && nextItems.length >= MAX_PHOTOS;
      renderManager(input, nextItems, clipped ? 'Only the first 6 photos are kept.' : 'Photo' + (preparedAdditions.length === 1 ? '' : 's') + ' added.');
    }).catch(function () {
      if (input.dataset.photoPrepRun === runId) {
        input.dataset.photoPrep = 'failed';
        syncInputFiles(input, previous);
        renderManager(input, previous, 'A photo could not be prepared. Try adding it again.');
      }
    }).finally(function () {
      if (input.dataset.photoPrepRun === runId) {
        input.disabled = false;
        setSubmitBusy(input, false);
      }
    });
  }, true);
})();
