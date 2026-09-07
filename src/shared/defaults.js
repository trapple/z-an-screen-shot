// 既定設定値。オプションページで変更された値は chrome.storage.sync に保存され、
// このオブジェクトの各キーを上書きする。
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    (root.ZSS = root.ZSS || {}).defaults = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    // Ctrl+Space は macOS の「前の入力ソースを選択」と競合するため Shift+S を既定にする
    captureKey: { code: 'KeyS', shift: true, ctrl: false, alt: false, meta: false },
    stepForwardKey: { code: 'ArrowRight', shift: false, ctrl: false, alt: false, meta: false },
    stepBackKey: { code: 'ArrowLeft', shift: false, ctrl: false, alt: false, meta: false },
    // z-an が使うのは修飾キーなしの ←/→ だけなので、Shift 付きは奪っても衝突しない
    seekForwardKey: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, meta: false },
    seekBackKey: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, meta: false },
    downloadSubdir: 'z-an',
    showButtons: true,
  };
});
