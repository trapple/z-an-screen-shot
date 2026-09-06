// エントリポイント。以降のタスクでキー待受と各機能の配線を足していく。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});
  ZSS.version = '0.1.0';

  console.info('[z-an Screenshot] content script を読み込みました', ZSS.version);
})();
