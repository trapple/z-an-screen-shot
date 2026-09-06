// 追加 UI (トースト / ボタンバー) の描画。
// z-an 既存の要素には append しかせず、属性・スタイル・クラスは書き換えない。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});

  const STYLE_ID = 'zss-style';
  const TOAST_DURATION_MS = 2000;

  // セレクタは全て zss- プレフィックス配下に限定し、z-an 側と衝突させない
  const STYLE_TEXT = `
.zss-toast {
  position: fixed;
  right: 24px;
  bottom: 80px;
  z-index: 2147483647;
  max-width: 60vw;
  padding: 8px 14px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.zss-toast.zss-visible { opacity: 1; }
.zss-toast.zss-error { background: rgba(178, 34, 34, 0.92); }
`;

  let toastTimer = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    document.head.appendChild(style);
  }

  // トーストは #player-con の子として置く。フルスクリーン時は
  // フルスクリーン要素のサブツリー内にないと表示されないため。
  function getToastHost() {
    return ZSS.player.getContainer() || document.body;
  }

  function showToast(message, isError) {
    injectStyles();
    const host = getToastHost();
    let toast = host.querySelector(':scope > .zss-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'zss-toast';
      host.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('zss-error', Boolean(isError));
    // 連続表示でもトランジションが効くよう、一度 reflow させる
    void toast.offsetWidth;
    toast.classList.add('zss-visible');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('zss-visible');
    }, TOAST_DURATION_MS);
  }

  ZSS.ui = { injectStyles, showToast };
})();
