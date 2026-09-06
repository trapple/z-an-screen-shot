// video のデコード済みフレームを canvas 経由で取り出す。
// 動画の上に重なっている DOM は canvas には写らないため、
// 撮影のために UI を隠す必要はない。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});

  // 連写時に毎回生成すると GC 負荷が上がるため 1 枚を使い回す
  let canvas = null;

  function ensureCanvas(width, height) {
    if (!canvas) canvas = document.createElement('canvas');
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return canvas;
  }

  function grabDataUrl(video) {
    const target = video || ZSS.player.getVideo();
    if (!target) {
      throw new Error('動画要素が見つかりません (z-an の DOM 構造が変わった可能性があります)');
    }
    if (!target.videoWidth || !target.videoHeight) {
      throw new Error('動画がまだ読み込まれていません');
    }
    const surface = ensureCanvas(target.videoWidth, target.videoHeight);
    const context = surface.getContext('2d');
    context.drawImage(target, 0, 0, surface.width, surface.height);
    try {
      return surface.toDataURL('image/png');
    } catch (error) {
      // tainted canvas。z-an が video の crossorigin 属性を外した場合などに起きる
      throw new Error(`canvas から画像を取り出せません (CORS 制約): ${error.message}`);
    }
  }

  async function shoot(subdir) {
    const video = ZSS.player.getVideo();
    if (!video) {
      throw new Error('動画要素が見つかりません (z-an の DOM 構造が変わった可能性があります)');
    }
    // data URL の生成より先に読む。再生中は生成中にも時刻が進むため
    const currentTime = video.currentTime;
    const dataUrl = grabDataUrl(video);
    const filename = ZSS.format.buildFilename(ZSS.player.getTitle(), currentTime, subdir);

    const response = await chrome.runtime.sendMessage({ type: 'zss-save', dataUrl, filename });
    if (!response || !response.ok) {
      throw new Error(
        (response && response.error) || '保存に失敗しました (service worker から応答がありません)'
      );
    }
    return filename;
  }

  ZSS.capture = { grabDataUrl, shoot };
})();
