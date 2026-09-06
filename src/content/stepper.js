// 1 フレーム単位のコマ送り。fps は実測してから使う。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});

  const FALLBACK_FPS = 30;
  const MEASURE_FRAMES = 20;
  // コールバックが来ないまま固まらないよう、待ち受けには必ずタイムアウトを張る
  const MEASURE_TIMEOUT_MS = 5000;
  const FRAME_WAIT_TIMEOUT_MS = 1000;

  let fps = null;
  let measuring = false;
  let stepping = false;
  let warnedFallback = false;

  // 再生中に数フレーム分の presentedFrames と mediaTime を取り、実 fps を求める
  function measureFps(video) {
    return new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback !== 'function') {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);

      let first = null;
      let count = 0;
      const onFrame = (now, metadata) => {
        if (!first) first = metadata;
        count += 1;
        if (count < MEASURE_FRAMES) {
          video.requestVideoFrameCallback(onFrame);
          return;
        }
        clearTimeout(timer);
        const frames = metadata.presentedFrames - first.presentedFrames;
        const elapsed = metadata.mediaTime - first.mediaTime;
        finish(elapsed > 0 ? frames / elapsed : null);
      };
      video.requestVideoFrameCallback(onFrame);
    });
  }

  async function ensureFps() {
    if (fps !== null || measuring) return fps;
    const video = ZSS.player.getVideo();
    // 一時停止中はフレームが来ないため測定できない
    if (!video || video.paused) return fps;

    measuring = true;
    try {
      const measured = await measureFps(video);
      const snapped = ZSS.format.snapFps(measured);
      if (snapped !== null) {
        fps = snapped;
        console.info('[z-an Screenshot] fps を実測しました:', fps, `(生の測定値: ${measured})`);
      }
    } finally {
      measuring = false;
    }
    return fps;
  }

  function getFps() {
    if (fps !== null) return fps;
    // 黙って 30 と決め打ちすると「コマ送りの粒度がおかしい」という
    // 原因不明の挙動になるため、必ず警告を出す
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(
        `[z-an Screenshot] fps を測定できていないため ${FALLBACK_FPS}fps としてコマ送りします。` +
          '実際の fps と異なる場合、コマ送りの粒度がずれます。動画を再生すると測定を試みます。'
      );
    }
    return FALLBACK_FPS;
  }

  // シーク後に新しいフレームが描画されるまで待つ。
  // seeked と requestVideoFrameCallback のどちらが先に来ても良いようにし、
  // どちらも来ない場合に備えてタイムアウトも張る。
  function waitForFrame(video) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', finish);
        resolve();
      };
      video.addEventListener('seeked', finish, { once: true });
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(finish);
      }
      setTimeout(finish, FRAME_WAIT_TIMEOUT_MS);
    });
  }

  async function step(direction) {
    const video = ZSS.player.getVideo();
    if (!video) {
      throw new Error('動画要素が見つかりません (z-an の DOM 構造が変わった可能性があります)');
    }
    // 再生中は何もしない。z-an 本来の 10 秒送りに委ねる
    if (!video.paused) return false;
    // 前のシークの描画待ちが終わるまでは受け付けない (多重シークを防ぐ)
    if (stepping) return false;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('動画がまだ読み込まれていません');
    }

    stepping = true;
    try {
      const delta = direction / getFps();
      const target = Math.min(Math.max(video.currentTime + delta, 0), video.duration);
      video.currentTime = target;
      await waitForFrame(video);
    } finally {
      stepping = false;
    }
    return true;
  }

  // 再生が始まったタイミングで測定を試みる
  ZSS.player.onPauseStateChange((paused) => {
    if (!paused) ensureFps();
  });

  ZSS.stepper = {
    step,
    ensureFps,
    getFps,
    getMeasuredFps: () => fps,
  };
})();
