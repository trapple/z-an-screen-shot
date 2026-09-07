// 設定の読み書き。保存すると content script が chrome.storage.onChanged で
// 拾うため、z-an のページをリロードしなくても反映される。
(function () {
  'use strict';

  const ZSS = globalThis.ZSS;
  // OS の判定はここで一度だけ行う。format.js は純粋関数だけを持つ約束なので、
  // navigator を読むのはブラウザでしか動かない側の責務。
  const META_LABEL = ZSS.format.metaLabelForPlatform(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform
  );
  // ホットキーの設定は名前が Key で終わる、という defaults.js の並びに従う。
  // ここで再び列挙すると、ホットキーを増やしたときに直し忘れる箇所が 1 つ増える。
  const HOTKEY_FIELDS = Object.keys(ZSS.defaults).filter((key) => key.endsWith('Key'));
  // 修飾キー単独は割り当てさせない
  const MODIFIER_CODES = [
    'ShiftLeft',
    'ShiftRight',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
  ];

  let settings = Object.assign({}, ZSS.defaults);

  function showStatus(message, isError) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.classList.toggle('zss-error', Boolean(isError));
  }

  function render() {
    for (const key of HOTKEY_FIELDS) {
      document.getElementById(key).value = ZSS.format.formatHotkey(settings[key], META_LABEL);
    }
    document.getElementById('downloadSubdir').value = settings.downloadSubdir;
    document.getElementById('showButtons').checked = Boolean(settings.showButtons);
  }

  function save() {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        showStatus(`保存に失敗しました: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      showStatus('保存しました');
    });
  }

  function load() {
    chrome.storage.sync.get(ZSS.defaults, (stored) => {
      if (chrome.runtime.lastError) {
        showStatus(`設定の読み込みに失敗しました: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      settings = Object.assign({}, ZSS.defaults, stored);
      render();
    });
  }

  for (const key of HOTKEY_FIELDS) {
    const input = document.getElementById(key);
    input.addEventListener('keydown', (event) => {
      event.preventDefault();
      if (MODIFIER_CODES.includes(event.code)) return;
      settings[key] = ZSS.format.hotkeyFromEvent(event);
      render();
      save();
    });
  }

  document.getElementById('downloadSubdir').addEventListener('change', (event) => {
    settings.downloadSubdir = event.target.value.trim() || ZSS.defaults.downloadSubdir;
    render();
    save();
  });

  document.getElementById('showButtons').addEventListener('change', (event) => {
    settings.showButtons = event.target.checked;
    save();
  });

  document.getElementById('reset').addEventListener('click', () => {
    settings = Object.assign({}, ZSS.defaults);
    render();
    save();
  });

  load();
})();
