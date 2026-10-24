const input = document.getElementById('vin');
const status = document.getElementById('status');
document.getElementById('fill').addEventListener('click', async () => {
  const raw = input.value.trim().toUpperCase();
  const chassis = raw.length === 17 ? raw.slice(-8) : raw;
  if (!/^[A-HJ-NPR-Z0-9]{8}$/.test(chassis)) { status.textContent = 'Enter an 8-character chassis or a full 17-character VIN.'; return; }
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const url = new URL(tab?.url || '');
    if (url.protocol !== 'https:' || url.hostname !== 'oecnpc.navistar.com' || !url.pathname.startsWith('/npc/')) {
      status.textContent = 'Open https://oecnpc.navistar.com/npc/myportal/ in this tab first.'; return;
    }
    const results = await chrome.scripting.executeScript({target:{tabId:tab.id},func:(v)=>{
      const fields = [...document.querySelectorAll('input')];
      const field = fields.find(e=>/enter chassis or vin/i.test(e.placeholder || '') || /chassis|vin/i.test(e.getAttribute('aria-label') || ''));
      if (!field) return 'Could not find the Chassis/VIN field. The Navistar interface may have changed.';
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(field,v);
      field.dispatchEvent(new Event('input',{bubbles:true}));
      field.dispatchEvent(new Event('change',{bubbles:true}));
      field.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',code:'Enter'}));
      field.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Enter',code:'Enter'}));
      return 'Filled the chassis field and attempted Enter. If results do not appear, choose the search suggestion manually.';
    },args:[chassis]});
    status.textContent = results?.[0]?.result || 'Search attempt sent.';
  } catch(err) {status.textContent = 'Unable to fill the page. Confirm Navistar is open and reload it, then retry.';}
});