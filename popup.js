// The account list behind the address-bar button (see background.js).
'use strict';

const list = document.getElementById('accounts');

function el(tag, props, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

async function render() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const here = tab ? tab.cookieStoreId : null;
  const after = tab ? { windowId: tab.windowId, index: tab.index } : null;
  const { accounts, containers } = await browser.runtime.sendMessage({ type: 'list' });

  list.replaceChildren(...accounts.map((a) => {
    const name = a.username ? '@' + a.username : `Account ${a.userId}`;
    const pic = a.pic
      ? el('img', { className: 'pic', src: a.pic, alt: '' })
      : el('span', { className: 'pic' });
    const where = el('span', { className: 'where' },
      a.container ? el('span', { className: 'dot' }) : null,
      a.container || 'No container',
      a.storeId === here ? ' · this tab' : null);
    if (a.colorCode) where.style.setProperty('--dot', a.colorCode);
    const btn = el('button', { type: 'button', title: `Open a new tab as ${name}` },
      pic, el('span', { className: 'text' }, el('span', { className: 'name' }, name), where));
    btn.addEventListener('click', async () => {
      await browser.runtime.sendMessage({ type: 'open', storeId: a.storeId, after });
      window.close();
    });
    return el('li', {}, btn);
  }));

  document.getElementById('hint').hidden = !containers;
  document.getElementById('off').hidden = containers;
}

// Temporary: the switch log (see background.js), for bug reports.
document.getElementById('diag').addEventListener('click', async (e) => {
  const log = await browser.runtime.sendMessage({ type: 'log' });
  await navigator.clipboard.writeText(JSON.stringify(log, null, 1));
  e.target.textContent = `Copied ${log.length} entries`;
});

render();
