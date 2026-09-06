// z-an 固有の DOM 知識はこのファイルにのみ置く。
// z-an 側の構造が変わったときは、ここだけを直せば他のモジュールは影響を受けない。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});

  const SELECTORS = {
    // フルスクリーンの対象になる要素。追加 UI はこの配下に置く
    container: '#player-con',
    // id 直指定 (#video) より子孫セレクタの方が id 変更に強い
    video: '#player-con video',
    // 一時停止時に前面に出るカバー。ボタンバーの挿入先
    coverControls: '.cover-controls',
    // 既存の 10 秒戻し / 再生 / 10 秒送りが並ぶ行 (参照のみ、変更しない)
    controlList: '.control-list',
  };

  // ボタンバー挿入位置の監視範囲。document 全体を監視すると
  // 時刻表示の更新まで拾ってしまうため、プレイヤー領域に限定する
  const OBSERVE_ROOT = '#playerArea';

  function getContainer() {
    return document.querySelector(SELECTORS.container);
  }

  function getVideo() {
    return document.querySelector(SELECTORS.video);
  }

  function getControlHost() {
    return document.querySelector(SELECTORS.coverControls);
  }

  // 一時停止の判定は DOM のクラスではなく video 要素の状態を正とする。
  // z-an 側のクラス名変更に影響されないようにするため。
  function isPaused() {
    const video = getVideo();
    return video ? video.paused : true;
  }

  function getTitle() {
    return document.title;
  }

  // 起動時に呼び、想定した要素が無ければ呼び出し側が警告を出す。
  // silent に動作しなくなるのを防ぐための Fail Fast。
  function verifySelectors() {
    const missing = [];
    for (const [name, selector] of Object.entries(SELECTORS)) {
      if (!document.querySelector(selector)) missing.push(`${name} (${selector})`);
    }
    return missing;
  }

  // video 要素は再生の過程で差し替えられる可能性があるため、
  // 個別の要素ではなく document で capture して拾う。
  function onPauseStateChange(callback) {
    const handler = (event) => {
      const target = event.target;
      if (target && target.tagName === 'VIDEO') callback(target.paused);
    };
    document.addEventListener('play', handler, true);
    document.addEventListener('pause', handler, true);
  }

  // .cover-controls 要素そのものの生成・差し替えを検知する。
  // 一時停止しているかどうかの判定には使わない (それは isPaused の責務)。
  function onControlHostChange(callback) {
    const root = document.querySelector(OBSERVE_ROOT) || document.body;
    const observer = new MutationObserver(() => {
      callback(getControlHost());
    });
    observer.observe(root, { childList: true, subtree: true });
    return observer;
  }

  ZSS.player = {
    SELECTORS,
    getContainer,
    getVideo,
    getControlHost,
    isPaused,
    getTitle,
    verifySelectors,
    onPauseStateChange,
    onControlHostChange,
  };
})();
