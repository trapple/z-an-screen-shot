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

.zss-bar {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, calc(-50% + 72px));
  /* .boxLayer が z-index 999999 で全面を覆っているため、その上に出す。
     下にあるとクリックが .boxLayer に吸われて一時停止が解除されるだけになる */
  z-index: 1000000;
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
}
.zss-bar.zss-hidden { display: none; }
.zss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  cursor: pointer;
  transition: background 0.12s ease;
}
.zss-btn:hover { background: rgba(255, 255, 255, 0.18); }
.zss-btn:active { background: rgba(255, 255, 255, 0.3); }
.zss-btn svg { width: 26px; height: 26px; fill: currentColor; pointer-events: none; }
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

  // アイコンはインライン SVG で描く。絵文字はフォント依存でサイズとベースラインが
  // 環境ごとにずれ、既存ボタンと並べたときに揃わないため使わない。
  const ICONS = {
    back:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.2v14H6z"/><path d="M20 5v14L9.2 12z"/></svg>',
    shoot:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill-rule="evenodd">' +
      '<path d="M20 5h-3.2l-1.4-2H8.6L7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-8 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>',
    forward:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 5H18v14h-2.2z"/><path d="M4 5v14l10.8-7z"/></svg>',
  };

  const BUTTON_SPECS = [
    { action: 'back', icon: ICONS.back, label: '1 コマ戻す', settingKey: 'stepBackKey' },
    { action: 'shoot', icon: ICONS.shoot, label: '撮影', settingKey: 'captureKey' },
    { action: 'forward', icon: ICONS.forward, label: '1 コマ送る', settingKey: 'stepForwardKey' },
  ];

  let barHandlers = null;
  let barEnabled = true;

  function getBar() {
    return document.querySelector('.zss-bar');
  }

  // z-an は pointerdown 段階で再生/一時停止を切り替えるため、click だけを
  // 止めても間に合わない。ポインタ系イベントを全て capture フェーズで捕まえ、
  // バーの外へ一切漏らさない。
  const SWALLOWED_EVENTS = [
    'pointerdown',
    'mousedown',
    'pointerup',
    'mouseup',
    'click',
    'dblclick',
  ];

  function swallow(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function onBarClick(event) {
    const button = event.target.closest('.zss-btn');
    if (!button || !barHandlers) return;
    const action = button.dataset.zssAction;
    if (action === 'back') barHandlers.onStepBack();
    else if (action === 'forward') barHandlers.onStepForward();
    else if (action === 'shoot') barHandlers.onShoot();
  }

  function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'zss-bar zss-hidden';
    for (const spec of BUTTON_SPECS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'zss-btn';
      button.dataset.zssAction = spec.action;
      button.innerHTML = spec.icon;
      bar.appendChild(button);
    }
    for (const type of SWALLOWED_EVENTS) {
      bar.addEventListener(
        type,
        (event) => {
          swallow(event);
          if (type === 'click') onBarClick(event);
        },
        true
      );
    }
    return bar;
  }

  function updateButtonLabels(settings) {
    const bar = getBar();
    if (!bar) return;
    const current = settings || ZSS.settings || {};
    for (const spec of BUTTON_SPECS) {
      const button = bar.querySelector(`[data-zss-action="${spec.action}"]`);
      if (!button) continue;
      const hotkey = ZSS.format.formatHotkey(current[spec.settingKey]);
      const text = hotkey ? `${spec.label} (${hotkey})` : spec.label;
      button.title = text;
      button.setAttribute('aria-label', text);
    }
  }

  function setButtonsVisible(visible) {
    const bar = getBar();
    if (!bar) return;
    bar.classList.toggle('zss-hidden', !(visible && barEnabled));
  }

  // バーは #player-con 直下に置く。.cover-controls の中に入れると
  // (1) .boxLayer (z-index 999999) の下に隠れてクリックが届かず、
  // (2) .cover-controls 自身のクリックで再生が再開してしまう。
  // #player-con はフルスクリーン対象要素そのものなので、全画面でも表示される。
  function attachBar(settings) {
    if (!barEnabled) return;
    const host = ZSS.player.getContainer();
    if (!host) return;
    if (host.querySelector(':scope > .zss-bar')) return;
    host.appendChild(buildBar());
    updateButtonLabels(settings);
    setButtonsVisible(ZSS.player.isPaused());
  }

  function mountButtons(handlers, settings) {
    barHandlers = handlers;
    injectStyles();
    attachBar(settings);
    ZSS.player.onControlHostChange(() => attachBar(settings));
    ZSS.player.onPauseStateChange((paused) => setButtonsVisible(paused));
  }

  function setButtonsEnabled(enabled) {
    barEnabled = Boolean(enabled);
    if (!barEnabled) {
      const bar = getBar();
      if (bar) bar.remove();
      return;
    }
    attachBar();
  }

  ZSS.ui = {
    injectStyles,
    showToast,
    mountButtons,
    setButtonsEnabled,
    updateButtonLabels,
  };
})();
