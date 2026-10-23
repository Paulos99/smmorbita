export function registerShell() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  const secure = location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
  if (!secure) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    try { if (sessionStorage.getItem('smm-sw-reload') === '1') return; sessionStorage.setItem('smm-sw-reload', '1'); } catch {}
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
}

export function armInstallHint() {
  let standalone = false;
  try { standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch {}
  if (standalone) return;
  let narrow = false;
  try { narrow = matchMedia('(max-width: 800px)').matches; } catch {}
  if (!narrow) return;
  try { if (localStorage.getItem('smm-install-hint') === '1') return; } catch { return; }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const bar = document.createElement('div');
  bar.className = 'install-hint';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Добавить на экран');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'install-dismiss';
  close.setAttribute('aria-label', 'Скрыть подсказку');
  close.textContent = '×';
  const hide = () => {
    try { localStorage.setItem('smm-install-hint', '1'); } catch {}
    bar.remove();
  };
  close.addEventListener('click', hide);
  const mount = () => { if (!bar.isConnected) document.body.append(bar); };
  if (ios) {
    const text = document.createElement('p');
    text.textContent = 'Добавить на экран: кнопка «Поделиться», затем «На экран “Домой”».';
    bar.append(text, close);
    mount();
    return;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'install-go';
    add.textContent = 'Добавить на экран';
    add.addEventListener('click', async () => {
      event.prompt();
      try { await event.userChoice; } catch {}
      hide();
    });
    bar.replaceChildren(add, close);
    mount();
  });
}
