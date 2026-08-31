(() => {
  const DECORATED = 'data-driver-directory-ready';
  const SEARCH_DELAY_MS = 180;

  function el(tag, props = {}, text = '') {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (text) node.textContent = text;
    return node;
  }

  function decorate(input) {
    if (!(input instanceof HTMLInputElement) || input.getAttribute(DECORATED) === '1') return;
    const form = input.form;
    if (!form) return;
    input.setAttribute(DECORATED, '1');
    input.autocomplete = 'off';
    input.placeholder = 'Start typing driver first or last name';

    let driverId = form.querySelector('input[name="driverDirectoryId"]');
    if (!driverId) {
      driverId = el('input', { type: 'hidden', name: 'driverDirectoryId', value: '' });
      form.appendChild(driverId);
    }
    let notListed = form.querySelector('input[name="driverNotListed"]');
    if (!notListed) {
      notListed = el('input', { type: 'hidden', name: 'driverNotListed', value: '0' });
      form.appendChild(notListed);
    }

    const box = el('div');
    box.style.cssText = 'display:grid;gap:8px;margin-top:8px;';
    const status = el('div');
    status.style.cssText = 'font-size:12px;color:#64748b;font-weight:700;';
    const results = el('div');
    results.style.cssText = 'display:grid;gap:7px;';
    const controls = el('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
    const clearButton = el('button', { type: 'button' }, 'Change driver');
    clearButton.style.cssText = 'display:none;min-height:38px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#172033;font-weight:800;cursor:pointer;';
    const manualButton = el('button', { type: 'button' }, 'Driver not listed');
    manualButton.style.cssText = 'min-height:38px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#172033;font-weight:800;cursor:pointer;';
    controls.append(clearButton, manualButton);
    box.append(status, results, controls);
    input.insertAdjacentElement('afterend', box);

    let timer = 0;
    let controller = null;
    let selected = false;
    let manual = false;

    function resetSelection() {
      selected = false;
      manual = false;
      driverId.value = '';
      notListed.value = '0';
      input.readOnly = false;
      clearButton.style.display = 'none';
      manualButton.textContent = 'Driver not listed';
      status.textContent = '';
      results.replaceChildren();
    }

    function chooseDriver(driver) {
      selected = true;
      manual = false;
      driverId.value = String(driver.id || '');
      notListed.value = '0';
      input.value = String(driver.name || '');
      input.readOnly = true;
      results.replaceChildren();
      status.textContent = `Selected from Recruiting · phone ending ${driver.phoneLast4 || '----'}`;
      clearButton.style.display = '';
      manualButton.textContent = 'Driver not listed';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function enableManual() {
      if (controller) controller.abort();
      window.clearTimeout(timer);
      selected = false;
      manual = true;
      driverId.value = '';
      notListed.value = '1';
      input.readOnly = false;
      input.value = '';
      results.replaceChildren();
      status.textContent = 'Emergency manual entry enabled. Type the driver name exactly.';
      clearButton.style.display = '';
      manualButton.textContent = 'Manual entry enabled';
      input.focus();
    }

    async function search(query) {
      if (controller) controller.abort();
      controller = new AbortController();
      status.textContent = 'Searching driver directory...';
      results.replaceChildren();
      try {
        const params = new URLSearchParams({ q: query });
        const response = await fetch(`/api/breakdowns/driver-search?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error('Driver search failed.');
        const drivers = Array.isArray(payload.drivers) ? payload.drivers : [];
        if (!drivers.length) {
          status.textContent = 'No matching drivers found. Try more of the name or use Driver not listed.';
          return;
        }
        status.textContent = 'Tap the correct driver:';
        for (const driver of drivers) {
          const button = el('button', { type: 'button' });
          button.style.cssText = 'text-align:left;min-height:46px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#172033;cursor:pointer;';
          const name = el('strong', {}, String(driver.name || ''));
          name.style.cssText = 'display:block;font-size:15px;';
          const phone = el('span', {}, `Phone ending ${driver.phoneLast4 || '----'}`);
          phone.style.cssText = 'display:block;margin-top:2px;font-size:12px;color:#64748b;';
          button.append(name, phone);
          button.addEventListener('click', () => chooseDriver(driver));
          results.appendChild(button);
        }
      } catch (error) {
        if (controller?.signal.aborted) return;
        status.textContent = 'Driver directory is temporarily unavailable. Use Driver not listed only if needed.';
      }
    }

    input.addEventListener('input', () => {
      if (selected || manual) return;
      driverId.value = '';
      notListed.value = '0';
      const query = input.value.trim();
      window.clearTimeout(timer);
      if (controller) controller.abort();
      results.replaceChildren();
      if (query.length < 2) {
        status.textContent = query ? 'Type at least 2 letters.' : '';
        return;
      }
      timer = window.setTimeout(() => search(query), SEARCH_DELAY_MS);
    });

    clearButton.addEventListener('click', () => {
      resetSelection();
      input.value = '';
      input.focus();
    });
    manualButton.addEventListener('click', enableManual);

    if (input.value.trim()) input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function scan() {
    document.querySelectorAll('input[name="driverName"]').forEach(decorate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
