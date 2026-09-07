// 追加 UI (トースト / ボタンバー) の描画。
// z-an 既存の要素には append しかせず、属性・スタイル・クラスは書き換えない。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});

  // OS の判定はここで一度だけ行う。format.js は純粋関数だけを持つ約束なので、
  // navigator を読むのはブラウザでしか動かない側の責務。
  const META_LABEL = ZSS.format.metaLabelForPlatform(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform
  );

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
  /* mac 系のフォントだけを並べると Windows で全て外れて素の sans-serif に落ちるため、
     両 OS の UI フォントと日本語フォントを順に並べる */
  font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
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
  // コマ送りは「棒 + 三角」、1 秒送りは「三角 2 つ」で描き分ける。
  // 粒度の違いが一目で分かるよう、形そのものを変えている。
  const ICONS = {
    seekBack:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 5v14l-9.5-7z"/><path d="M11.5 5v14L2 12z"/></svg>',
    stepBack:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.2v14H6z"/><path d="M20 5v14L9.2 12z"/></svg>',
    shoot:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill-rule="evenodd">' +
      '<path d="M20 5h-3.2l-1.4-2H8.6L7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-8 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>',
    stepForward:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 5H18v14h-2.2z"/><path d="M4 5v14l10.8-7z"/></svg>',
    seekForward:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5v14l9.5-7z"/><path d="M12.5 5v14L22 12z"/></svg>',
  };

  // action は mountButtons に渡されるハンドラのキーと対応する
  const BUTTON_SPECS = [
    { action: 'seekBack', icon: ICONS.seekBack, label: '1 秒戻す', settingKey: 'seekBackKey' },
    { action: 'stepBack', icon: ICONS.stepBack, label: '1 コマ戻す', settingKey: 'stepBackKey' },
    { action: 'shoot', icon: ICONS.shoot, label: '撮影', settingKey: 'captureKey' },
    {
      action: 'stepForward',
      icon: ICONS.stepForward,
      label: '1 コマ送る',
      settingKey: 'stepForwardKey',
    },
    {
      action: 'seekForward',
      icon: ICONS.seekForward,
      label: '1 秒送る',
      settingKey: 'seekForwardKey',
    },
  ];

  let barHandlers = null;
  let barEnabled = true;

  // 万一バーが複数できていても取りこぼさないよう全件を対象にする
  function getBars() {
    return document.querySelectorAll('.zss-bar');
  }

  // バーの表示可否は「設定で有効か」と「一時停止中か」の論理積だけで決まる。
  // 設定 OFF で DOM から削除する方式にすると、MutationObserver による再挿入と
  // 競合して状態が二重管理になるため、常に DOM に置いたまま CSS で切り替える。
  function syncBarVisibility() {
    const visible = barEnabled && ZSS.player.isPaused();
    for (const bar of getBars()) {
      bar.classList.toggle('zss-hidden', !visible);
    }
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
    const handler = barHandlers[button.dataset.zssAction];
    if (handler) handler();
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

  // ZSS.settings を優先して読む。mountButtons に渡された settings は
  // 起動時のオブジェクトで、設定変更後は古くなっているため。
  function updateButtonLabels(settings) {
    const current = ZSS.settings || settings || {};
    for (const bar of getBars()) {
      for (const spec of BUTTON_SPECS) {
        const button = bar.querySelector(`[data-zss-action="${spec.action}"]`);
        if (!button) continue;
        const hotkey = ZSS.format.formatHotkey(current[spec.settingKey], META_LABEL);
        const text = hotkey ? `${spec.label} (${hotkey})` : spec.label;
        button.title = text;
        button.setAttribute('aria-label', text);
      }
    }
  }

  // バーは #player-con 直下に置く。.cover-controls の中に入れると
  // (1) .boxLayer (z-index 999999) の下に隠れてクリックが届かず、
  // (2) .cover-controls 自身のクリックで再生が再開してしまう。
  // #player-con はフルスクリーン対象要素そのものなので、全画面でも表示される。
  //
  // barEnabled が false でもバーは作る。表示可否は syncBarVisibility に
  // 一本化されており、ここで作らない判断を混ぜると状態が二重管理になる。
  function attachBar(settings) {
    const host = ZSS.player.getContainer();
    if (!host) return;
    if (!host.querySelector(':scope > .zss-bar')) {
      host.appendChild(buildBar());
      updateButtonLabels(settings);
    }
    syncBarVisibility();
  }

  function mountButtons(handlers, settings) {
    barHandlers = handlers;
    injectStyles();
    attachBar(settings);
    ZSS.player.onControlHostChange(() => attachBar(settings));
    ZSS.player.onPauseStateChange(() => syncBarVisibility());
  }

  function setButtonsEnabled(enabled) {
    barEnabled = Boolean(enabled);
    syncBarVisibility();
  }

  ZSS.ui = {
    injectStyles,
    showToast,
    mountButtons,
    setButtonsEnabled,
    updateButtonLabels,
  };
})();
