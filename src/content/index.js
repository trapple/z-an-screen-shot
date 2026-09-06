// エントリポイント。設定の読み込みとキー入力の配線を担う。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});
  ZSS.version = '0.1.0';

  let settings = Object.assign({}, ZSS.defaults);
  ZSS.settings = settings;

  function loadSettings() {
    chrome.storage.sync.get(ZSS.defaults, (stored) => {
      if (chrome.runtime.lastError) {
        console.error(
          '[z-an Screenshot] 設定の読み込みに失敗しました:',
          chrome.runtime.lastError.message
        );
        return;
      }
      settings = Object.assign({}, ZSS.defaults, stored);
      ZSS.settings = settings;
    });
  }

  // オプションページでの変更を、ページをリロードせずに反映する
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      settings[key] = change.newValue;
    }
  });

  // 入力欄にフォーカスがあるときはホットキーを奪わない
  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
    );
  }

  async function doCapture() {
    try {
      const filename = await ZSS.capture.shoot(settings.downloadSubdir);
      ZSS.ui.showToast(`保存しました: ${filename}`);
    } catch (error) {
      console.error('[z-an Screenshot] 撮影に失敗しました:', error);
      ZSS.ui.showToast(error.message, true);
    }
  }

  // capture フェーズで受け取り、z-an 側のハンドラより先に判定する
  function onKeyDown(event) {
    if (isTypingTarget(event.target)) return;

    if (ZSS.format.matchesHotkey(event, settings.captureKey)) {
      event.preventDefault();
      event.stopPropagation();
      doCapture();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  loadSettings();

  // 想定した要素が無ければ警告する。silent に動かなくなるのを防ぐ
  const missing = ZSS.player.verifySelectors();
  if (missing.length > 0) {
    console.warn(
      '[z-an Screenshot] 想定した要素が見つかりません。z-an の DOM 構造が変わった可能性があります:',
      missing
    );
  }

  console.info('[z-an Screenshot] content script を読み込みました', ZSS.version);
})();
