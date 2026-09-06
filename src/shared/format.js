// タイムコード・ファイル名・fps・ホットキーの純粋関数。
// ブラウザ (content script) と Node (テスト) の両方から読めるよう UMD 風に書く。
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    (root.ZSS = root.ZSS || {}).format = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FALLBACK_NAME = 'z-an';
  const TITLE_SUFFIX = / - Z-aN$/;
  // ファイル名に使えない文字と制御文字
  const FORBIDDEN_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;
  const MAX_FILENAME_LENGTH = 120;
  const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  // 最近傍の候補との相対差がこれを超える実測値は信用しない
  const FPS_TOLERANCE = 0.1;

  const KEY_LABELS = {
    ArrowRight: '→',
    ArrowLeft: '←',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
  };

  function pad(value, width) {
    return String(value).padStart(width, '0');
  }

  function formatTimecode(seconds) {
    const sec = Number(seconds);
    const safe = Number.isFinite(sec) && sec > 0 ? sec : 0;
    // floor だと 59.9996 が 59.999 秒になるため四捨五入する
    const total = Math.round(safe * 1000);
    const ms = total % 1000;
    const s = Math.floor(total / 1000) % 60;
    const m = Math.floor(total / 60000) % 60;
    const h = Math.floor(total / 3600000);
    return `${pad(h, 2)}-${pad(m, 2)}-${pad(s, 2)}.${pad(ms, 3)}`;
  }

  function sanitizeTitle(title) {
    const cleaned = String(title == null ? '' : title)
      .replace(TITLE_SUFFIX, '')
      .replace(FORBIDDEN_CHARS, '')
      .trim();
    return cleaned || FALLBACK_NAME;
  }

  function buildFilename(title, seconds, subdir) {
    const dir =
      String(subdir == null ? '' : subdir).replace(FORBIDDEN_CHARS, '').trim() || FALLBACK_NAME;
    const prefix = `${dir}/`;
    const tail = `_${formatTimecode(seconds)}.png`;
    const budget = MAX_FILENAME_LENGTH - prefix.length - tail.length;
    if (budget < 1) {
      // サブフォルダ名が異常に長い場合。タイムコードは必ず残す
      return `${prefix}${FALLBACK_NAME}${tail}`;
    }
    let name = sanitizeTitle(title);
    if (name.length > budget) name = name.slice(0, budget);
    return `${prefix}${name}${tail}`;
  }

  function snapFps(measured) {
    const fps = Number(measured);
    if (!Number.isFinite(fps) || fps <= 0) return null;
    let best = null;
    let bestDiff = Infinity;
    for (const candidate of COMMON_FPS) {
      const diff = Math.abs(candidate - fps);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
    return bestDiff / best <= FPS_TOLERANCE ? best : null;
  }

  function matchesHotkey(event, hotkey) {
    if (!event || !hotkey || !hotkey.code) return false;
    return (
      event.code === hotkey.code &&
      Boolean(event.shiftKey) === Boolean(hotkey.shift) &&
      Boolean(event.ctrlKey) === Boolean(hotkey.ctrl) &&
      Boolean(event.altKey) === Boolean(hotkey.alt) &&
      Boolean(event.metaKey) === Boolean(hotkey.meta)
    );
  }

  function keyLabel(code) {
    if (KEY_LABELS[code]) return KEY_LABELS[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    return code;
  }

  function formatHotkey(hotkey) {
    if (!hotkey || !hotkey.code) return '';
    const parts = [];
    if (hotkey.ctrl) parts.push('Ctrl');
    if (hotkey.alt) parts.push('Alt');
    if (hotkey.shift) parts.push('Shift');
    if (hotkey.meta) parts.push('Cmd');
    parts.push(keyLabel(hotkey.code));
    return parts.join('+');
  }

  function hotkeyFromEvent(event) {
    return {
      code: event.code,
      shift: Boolean(event.shiftKey),
      ctrl: Boolean(event.ctrlKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
    };
  }

  return {
    formatTimecode,
    sanitizeTitle,
    buildFilename,
    snapFps,
    matchesHotkey,
    formatHotkey,
    hotkeyFromEvent,
  };
});
