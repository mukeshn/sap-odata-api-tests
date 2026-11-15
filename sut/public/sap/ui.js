// Fiori-like helpers: OData access with CSRF, busy indicator, message toast.
// window.__pendingRequests mirrors what test tools poll for in real UI5 apps.
window.__pendingRequests = 0;
const SRV = '/sap/opu/odata/sap';
let csrfToken;

function busy(delta) {
  window.__pendingRequests += delta;
  document.getElementById('sapUiBusyIndicator')?.classList.toggle('hidden', window.__pendingRequests === 0);
  document.body.setAttribute('aria-busy', String(window.__pendingRequests > 0));
}

export async function odata(path, { method = 'GET', body, delay = 250 } = {}) {
  busy(1);
  try {
    await new Promise((r) => setTimeout(r, delay));
    if (method !== 'GET' && !csrfToken) {
      const h = await fetch(`${SRV}/API_SALES_ORDER_SRV/`, { headers: { 'x-csrf-token': 'Fetch' }, credentials: 'include' });
      csrfToken = h.headers.get('x-csrf-token');
    }
    const res = await fetch(SRV + path, { method, credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json', ...(csrfToken && method !== 'GET' ? { 'x-csrf-token': csrfToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { location.href = '/sap/login.html'; return; }
    const text = await res.text();
    const data = text && text.trim().startsWith('{') ? JSON.parse(text) : text;
    if (!res.ok) throw Object.assign(new Error(data?.error?.message?.value || text), { status: res.status, data, sapMessage: res.headers.get('sap-message') });
    return { data, sapMessage: res.headers.get('sap-message') ? JSON.parse(res.headers.get('sap-message')) : null };
  } finally { busy(-1); }
}

export const sapDate = (d) => new Date(Number(/\d+/.exec(d)[0])).toLocaleDateString('de-DE');
export const amount = (v, cur = 'EUR') => new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(Number(v));
export const STATUS = { A: 'Not Yet Processed', B: 'Partially Processed', C: 'Completely Processed' };

export function toast(msg) {
  let t = document.querySelector('.sapMMessageToast');
  if (!t) { t = document.createElement('div'); t.className = 'sapMMessageToast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3000);
}

export function shell(title, back) {
  document.body.insertAdjacentHTML('afterbegin', `
    <header id="shell-header" class="sapUshellShellHead" role="banner">
      ${back ? `<button id="backBtn" class="sapUshellShellHeadItm" title="Back" aria-label="Back">‹</button>` : ''}
      <a href="/sap/flp.html#Shell-home" id="shellAppTitle" class="sapUshellAppTitle">${title}</a>
      <span style="flex:1"></span><span id="meAreaHeaderButton" title="QA Tester (S/4)">QT</span>
    </header>
    <div id="sapUiBusyIndicator" class="hidden sapUiLocalBusyIndicator" role="progressbar" aria-label="Please wait"><span class="spinner"></span></div>`);
  document.getElementById('backBtn')?.addEventListener('click', () => history.back());
}

export async function valueHelp(targetInput) {
  const { data } = await odata('/API_BUSINESS_PARTNER/A_BusinessPartner?$select=BusinessPartner,BusinessPartnerFullName,CityName,Country&$format=json');
  const dlg = document.createElement('dialog');
  dlg.id = 'soldToPartyValueHelp';
  dlg.innerHTML = `<h2>Select: Sold-To Party</h2><input id="soldToPartyValueHelp-searchField" placeholder="Search" aria-label="Search">
    <table id="soldToPartyValueHelp-table"><thead><tr><th>Customer</th><th>Name</th><th>City</th></tr></thead><tbody>
    ${data.d.results.map((p) => `<tr class="sapMListTblRow" tabindex="0" data-key="${p.BusinessPartner}"><td>${p.BusinessPartner}</td><td>${p.BusinessPartnerFullName}</td><td>${p.CityName}, ${p.Country}</td></tr>`).join('')}
    </tbody></table><p><button class="btn secondary" id="soldToPartyValueHelp-cancel">Cancel</button></p>`;
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('input').addEventListener('input', (e) => dlg.querySelectorAll('tbody tr').forEach((tr) => (tr.hidden = !tr.textContent.toLowerCase().includes(e.target.value.toLowerCase()))));
  return new Promise((resolve) => {
    dlg.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-key]');
      if (tr) { targetInput.value = tr.dataset.key; targetInput.dispatchEvent(new Event('change', { bubbles: true })); dlg.close(); dlg.remove(); resolve(tr.dataset.key); }
      if (e.target.id === 'soldToPartyValueHelp-cancel') { dlg.close(); dlg.remove(); resolve(null); }
    });
  });
}
