// chrome.downloads は content script から直接呼べないため service worker を経由する。
// content script からは data URL を受け取る。Blob URL は生成元オリジンに
// 紐づいており、service worker からは解決できないため使えない。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'zss-save') return false;

  chrome.downloads.download(
    { url: message.dataUrl, filename: message.filename, saveAs: false },
    (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        const reason = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : 'ダウンロードを開始できませんでした';
        console.error('[z-an Screenshot] 保存に失敗しました:', reason);
        sendResponse({ ok: false, error: reason });
        return;
      }
      sendResponse({ ok: true, downloadId });
    }
  );

  // 非同期で sendResponse を呼ぶため true を返してチャネルを開いたままにする
  return true;
});
