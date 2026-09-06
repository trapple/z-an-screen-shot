# z-an スクリーンショット拡張 実装プラン

> **実装者向け:** このプランは subagent-driven-development (推奨) または手動実行で消化する。step は `- [ ]` チェックボックスで track する。

**Goal:** z-an のアーカイブ動画で、ホットキーとボタンから UI の写り込みなしに 1920x1080 の PNG を保存でき、一時停止中に 1 フレーム単位のコマ送りができる Chrome 拡張を作る。

**Architecture:** Manifest V3。content script (z-an ページ限定) が `<video>` から canvas 経由でフレームを取得し、data URL にして service worker へ渡す。service worker が `chrome.downloads` で保存する。z-an 固有の DOM 知識は `src/content/player.js` に集約し、他モジュールは抽象化された interface だけを見る。

**Tech Stack:** 素の JavaScript (ビルドなし) / Manifest V3 / `requestVideoFrameCallback` / `node:test` (依存パッケージなし)

## Global Constraints

### Spec 由来 (spec から逐語コピー)

spec: `.claude/specs/2026-09-07-z-an-screenshot-extension-design.md`

- **撮影方式**: 「`canvas.drawImage(video)` が デコード済みフレームそのものを取得できるため、動画の上に重なっている DOM (一時停止 UI、コントロールバー、広告スキップ表示) は原理的に写り込まない。」`chrome.tabs.captureVisibleTab` は採用しない
- **保存方式**: 「content script から service worker へは **data URL** (`canvas.toDataURL('image/png')`) を渡す。」Blob URL 方式は MV3 で動作しないため採用しない
- **適用範囲**: `matches` は `https://www.zan-live.com/*` に限定。`permissions` は `downloads` と `storage` のみ。`host_permissions` は指定しない
- **一時停止の判定**: 「DOM クラスではなく video 要素の状態を正とする」= `video.paused` に一本化する
- **既存 DOM への操作**: 「**append のみ**。既存要素の属性・スタイル・クラスは書き換えない」
- **ホットキーの内部表現**: `{ code: 'KeyS', shift: true, ctrl: false, alt: false, meta: false }`。「キーの識別には `KeyboardEvent.code` を使う」「修飾キーが余分に押されている場合は一致とみなさない」
- **アイコン**: 「インライン SVG で描く。絵文字 (📷 など) はフォント依存でサイズとベースラインが環境ごとにずれ、既存ボタンと並べたときに揃わないため使わない」
- **fps 測定失敗時**: 「30fps にフォールバックするが、**その旨をコンソールに明示的に警告する**」
- **ファイル名**: `<subdir>/<タイトル>_<HH-MM-SS.mmm>.png`。「全体が 120 文字を超える場合はタイトル部分を切り詰める (タイムコードは必ず残す)」

### PJ 恒久ルール (CLAUDE.md / `.claude/rules/` 由来)

- **言語**: コメント・ドキュメント・コミットメッセージは日本語で書く
- **Git 操作**: `cd <dir> && git ...` ではなく `git -C <dir> ...` を使う
- **ドキュメント優先**: ドキュメントとコード両方に修正がある場合、先にドキュメント (spec) を修正してからコードに着手する
- **Fail Fast**: silent skip をしない。エラーは握りつぶさず、原因が分かる形で表面化させる (spec セクション 7 の表に準拠)
- **応答待ちにタイムアウト**: 外部プロセスに限らず、応答を待つ処理には必ずタイムアウトを設ける。本 plan では `requestVideoFrameCallback` / `seeked` イベント待ちが該当する (コールバックが来ないまま固まるのを防ぐ)
- **小さくイテレーションを回す**: 各タスクの完了時に Chrome で実機確認してから次に進む。まとめて実装して最後に確認する進め方をしない
- **タイムゾーン**: 本プランで扱う時刻は全て「動画先頭からの経過秒」であり実時刻ではない。JST/UTC の考慮は不要 (ファイル名にも実日時は含めない)

### 運用前提 (brainstorming で確定した実装方式)

- **隔離方式**: branch のみ (worktree なし)。ブランチ名 `feat/screenshot-extension` (作成済み)
- **並列方式**: 直列。このセッションで Task 1 から順に消化する
- **main 直コミット禁止**。既に `feat/screenshot-extension` 上で作業中
- spec は commit 済み (`ee35a6a`, `246e763`)

### 検証方法についての注記

Chrome 拡張の DOM 操作・キー入力・ダウンロードは自動テストの費用対効果が低いため、
**純粋関数のみ `node:test` で自動テストし、それ以外は各タスクの手動確認 step で担保する**。
手動確認 step には「何を実行し、何が起きれば PASS か」を具体的に書いてあるので、
その通りに確認してから commit すること。確認せずに次のタスクへ進まない。

自動テストは `node --test` (引数なし) で実行する。cwd 配下の `*.test.js` を自動検出する。
`node --test test/` のようにディレクトリを渡す形は、この環境の nodenv shim 経由では
`Cannot find module .../test` で失敗するため使わない。

**Claude in Chrome (MCP) 経由では z-an のプレイヤーが初期化されない** (ページ埋め込み
JSON が 16382 バイト目で切断され `JSON.parse` が失敗する) ため、手動確認は
**通常の Chrome ウィンドウ**で行うこと。

---

## ファイル構造

| パス | 責務 | 作成タスク |
|---|---|---|
| `manifest.json` | 拡張の宣言。content script の読み込み順もここで決まる | Task 1 (以降のタスクで js 配列に追記) |
| `README.md` | インストール手順と使い方 | Task 1 / Task 10 |
| `src/content/index.js` | エントリ。キー待受と全体の配線 | Task 1 (骨格) / Task 6 (撮影) / Task 7 (コマ送り) |
| `src/shared/defaults.js` | 既定設定値 | Task 2 |
| `src/shared/format.js` | タイムコード・ファイル名・fps・ホットキーの純粋関数 | Task 2 |
| `src/content/player.js` | z-an DOM アダプタ。**セレクタはこのファイルにのみ書く** | Task 3 |
| `src/content/ui.js` | スタイル注入・トースト・ボタンバー | Task 4 (トースト) / Task 8 (ボタン) |
| `src/content/capture.js` | canvas 撮影 → data URL | Task 5 |
| `src/background/index.js` | `chrome.downloads` での保存 | Task 5 |
| `src/content/stepper.js` | fps 実測とコマ送り | Task 7 |
| `src/options/options.html` | 設定画面のマークアップ | Task 9 |
| `src/options/options.js` | 設定の読み書きとホットキー記録 | Task 9 |
| `test/format.test.js` | `src/shared/format.js` の自動テスト | Task 2 |

**モジュール間の約束:** 各ファイルは IIFE で `globalThis.ZSS` 名前空間に自分を登録する。
`manifest.json` の `js` 配列の順序が依存関係の順序になる (依存される側を先に置く)。

---

## Task 1: 拡張のスケルトンと読み込み確認

**Goal:** Chrome に読み込むと z-an の再生ページでだけ content script が動くことを確認できる状態にする。

**Files:**
- Create: `manifest.json`
- Create: `src/content/index.js`
- Create: `README.md`
- Create: `.gitignore`

**Interfaces:**
- Produces: `globalThis.ZSS` 名前空間 (以降の全モジュールがここに登録する)

- [ ] **Step 1: `manifest.json` を作る**

```json
{
  "manifest_version": 3,
  "name": "z-an Screenshot",
  "version": "0.1.0",
  "description": "z-an のアーカイブ動画から UI の写り込みなしにフレームを保存する",
  "permissions": ["downloads", "storage"],
  "content_scripts": [
    {
      "matches": ["https://www.zan-live.com/*"],
      "js": ["src/content/index.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ]
}
```

`permissions` は `downloads` (保存) と `storage` (設定) のみ。`host_permissions` は
`content_scripts.matches` で足りるので指定しない (権限を最小に保つ)。

- [ ] **Step 2: `src/content/index.js` を作る**

```javascript
// エントリポイント。以降のタスクでキー待受と各機能の配線を足していく。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});
  ZSS.version = '0.1.0';

  console.info('[z-an Screenshot] content script を読み込みました', ZSS.version);
})();
```

- [ ] **Step 3: `.gitignore` を作る**

```gitignore
.DS_Store
node_modules/
```

- [ ] **Step 4: `README.md` を作る**

```markdown
# z-an Screenshot

z-an (https://www.zan-live.com) のアーカイブ動画から、再生 UI の写り込みなしに
1920x1080 の PNG を保存する Chrome 拡張。

## できること

- 再生中でも一時停止中でも、ホットキーでその瞬間のフレームを PNG 保存
- 一時停止中に 1 フレーム単位のコマ送り / コマ戻し
- 一時停止 UI にコマ送り・撮影ボタンを追加
- フルスクリーン再生中も全機能が動作

保存される画像は video のデコード済みフレームそのものなので、上に重なっている
再生コントロールやオーバーレイは写り込まない。

## インストール

ビルドは不要。

1. このリポジトリをクローンする
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を ON にする
4. 「パッケージ化されていない拡張機能を読み込む」でこのディレクトリを選ぶ

コードを変更したときは `chrome://extensions` の再読み込みボタンを押し、
z-an のページもリロードする。

## 対応サイト

`https://www.zan-live.com/*` のみ。他のサイトでは一切動作しない。
```

- [ ] **Step 5: Chrome に読み込んで動作を確認する (手動)**

1. `chrome://extensions` でデベロッパーモードを ON にし、このディレクトリを読み込む
2. エラーバッジが出ていないことを確認する
3. z-an の再生ページ (`https://www.zan-live.com/ja/live/play/6803/4204`) を開く
4. DevTools の Console を開く

期待: `[z-an Screenshot] content script を読み込みました 0.1.0` が出力される

5. 適当な別サイト (例: `https://www.google.com`) を開いて Console を確認する

期待: 上記のログが**出力されない** (対象サイト限定が効いている)

- [ ] **Step 6: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add manifest.json src/content/index.js README.md .gitignore
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: 拡張のスケルトンを追加

Manifest V3 の宣言と content script のエントリポイントを作る。
対象は www.zan-live.com のみに限定し、権限は downloads と storage
だけを要求する。"
```

---

## Task 2: 純粋関数と既定設定 (自動テストあり)

**Goal:** タイムコード整形・ファイル名生成・fps スナップ・ホットキー判定を、Chrome なしでテストできる純粋関数として実装する。

**Files:**
- Create: `src/shared/format.js`
- Create: `src/shared/defaults.js`
- Create: `test/format.test.js`
- Modify: `manifest.json` (js 配列に 2 ファイルを追加)

**Interfaces:**
- Produces:
  - `ZSS.format.formatTimecode(seconds: number): string` — `'03-13-23.693'`
  - `ZSS.format.sanitizeTitle(title: string): string`
  - `ZSS.format.buildFilename(title: string, seconds: number, subdir: string): string`
  - `ZSS.format.snapFps(measured: number): number | null` — 一般的な fps にスナップ。信頼できなければ `null`
  - `ZSS.format.matchesHotkey(event: KeyboardEvent, hotkey: Hotkey): boolean`
  - `ZSS.format.formatHotkey(hotkey: Hotkey): string` — `'Shift+S'`
  - `ZSS.format.hotkeyFromEvent(event: KeyboardEvent): Hotkey`
  - `ZSS.defaults` — 既定設定オブジェクト
  - `Hotkey = { code: string, shift: boolean, ctrl: boolean, alt: boolean, meta: boolean }`

- [ ] **Step 1: 失敗するテストを書く**

`test/format.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const format = require('../src/shared/format.js');

test('formatTimecode: 先頭からの経過秒を HH-MM-SS.mmm に整形する', () => {
  assert.equal(format.formatTimecode(0), '00-00-00.000');
  assert.equal(format.formatTimecode(11603.693), '03-13-23.693');
  assert.equal(format.formatTimecode(3600), '01-00-00.000');
  assert.equal(format.formatTimecode(59.999), '00-00-59.999');
});

test('formatTimecode: ミリ秒は四捨五入し、繰り上がりを正しく扱う', () => {
  // 59.9996 * 1000 を floor すると 59999ms になり 59.999 秒と表示されてしまう
  assert.equal(format.formatTimecode(59.9996), '00-01-00.000');
});

test('formatTimecode: 不正な値は 0 として扱う', () => {
  assert.equal(format.formatTimecode(-5), '00-00-00.000');
  assert.equal(format.formatTimecode(NaN), '00-00-00.000');
  assert.equal(format.formatTimecode(Infinity), '00-00-00.000');
  assert.equal(format.formatTimecode(undefined), '00-00-00.000');
});

test('sanitizeTitle: サイト名サフィックスとファイル名に使えない文字を除去する', () => {
  assert.equal(
    format.sanitizeTitle("KAMITSUBAKI FES '26 アーカイブ - Z-aN"),
    "KAMITSUBAKI FES '26 アーカイブ"
  );
  assert.equal(format.sanitizeTitle('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
});

test('sanitizeTitle: 空になる場合は既定名にフォールバックする', () => {
  assert.equal(format.sanitizeTitle(''), 'z-an');
  assert.equal(format.sanitizeTitle('   '), 'z-an');
  assert.equal(format.sanitizeTitle('///'), 'z-an');
  assert.equal(format.sanitizeTitle(null), 'z-an');
});

test('buildFilename: サブフォルダ付きの相対パスを組み立てる', () => {
  assert.equal(
    format.buildFilename('ライブ映像 - Z-aN', 11603.693, 'z-an'),
    'z-an/ライブ映像_03-13-23.693.png'
  );
});

test('buildFilename: 全体が 120 文字を超える場合はタイトルを切り詰める', () => {
  const longTitle = 'あ'.repeat(200);
  const result = format.buildFilename(longTitle, 61.5, 'z-an');
  assert.ok(result.length <= 120, `長さが 120 を超えた: ${result.length}`);
  // タイムコードは必ず残る
  assert.ok(result.endsWith('_00-01-01.500.png'), `末尾が不正: ${result}`);
  assert.ok(result.startsWith('z-an/'), `先頭が不正: ${result}`);
});

test('snapFps: 実測値を一般的な fps にスナップする', () => {
  assert.equal(format.snapFps(29.7), 29.97);
  assert.equal(format.snapFps(30.02), 30);
  assert.equal(format.snapFps(59.9), 59.94);
  assert.equal(format.snapFps(23.9), 23.976);
});

test('snapFps: 信頼できない実測値は null を返す', () => {
  assert.equal(format.snapFps(200), null);
  assert.equal(format.snapFps(0), null);
  assert.equal(format.snapFps(-5), null);
  assert.equal(format.snapFps(NaN), null);
  assert.equal(format.snapFps(Infinity), null);
});

test('matchesHotkey: code と 4 つの修飾キーが完全一致したときだけ true', () => {
  const hotkey = { code: 'KeyS', shift: true, ctrl: false, alt: false, meta: false };
  assert.equal(
    format.matchesHotkey({ code: 'KeyS', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }, hotkey),
    true
  );
  // 修飾キーが余分に押されている場合は一致とみなさない
  assert.equal(
    format.matchesHotkey({ code: 'KeyS', shiftKey: true, ctrlKey: true, altKey: false, metaKey: false }, hotkey),
    false
  );
  // 修飾キーが足りない
  assert.equal(
    format.matchesHotkey({ code: 'KeyS', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, hotkey),
    false
  );
  // 別のキー
  assert.equal(
    format.matchesHotkey({ code: 'KeyA', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }, hotkey),
    false
  );
});

test('formatHotkey: 表示用の文字列を組み立てる', () => {
  assert.equal(format.formatHotkey({ code: 'KeyS', shift: true }), 'Shift+S');
  assert.equal(format.formatHotkey({ code: 'ArrowRight' }), '→');
  assert.equal(format.formatHotkey({ code: 'ArrowLeft' }), '←');
  assert.equal(format.formatHotkey({ code: 'KeyS', ctrl: true, shift: true }), 'Ctrl+Shift+S');
  assert.equal(format.formatHotkey({ code: 'Digit1', alt: true }), 'Alt+1');
  assert.equal(format.formatHotkey(null), '');
});

test('hotkeyFromEvent: KeyboardEvent から保存形式に変換する', () => {
  assert.deepEqual(
    format.hotkeyFromEvent({ code: 'KeyS', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }),
    { code: 'KeyS', shift: true, ctrl: false, alt: false, meta: false }
  );
});
```

- [ ] **Step 2: 実行して失敗を確認**

実行: `node --test`

期待: FAIL (`Cannot find module '../src/shared/format.js'`)

- [ ] **Step 3: `src/shared/format.js` を実装**

```javascript
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
```

- [ ] **Step 4: 実行して通過を確認**

実行: `node --test`

期待: PASS (12 tests, 0 fail)

- [ ] **Step 5: `src/shared/defaults.js` を実装**

```javascript
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
    downloadSubdir: 'z-an',
    showButtons: true,
  };
});
```

- [ ] **Step 6: `manifest.json` の js 配列を更新**

`content_scripts[0].js` を以下に差し替える (依存される側を先に読み込む):

```json
      "js": [
        "src/shared/defaults.js",
        "src/shared/format.js",
        "src/content/index.js"
      ],
```

- [ ] **Step 7: Chrome で読み込みを確認 (手動)**

1. `chrome://extensions` で拡張を再読み込みする
2. z-an の再生ページをリロードして DevTools の Console を開く
3. Console で以下を実行する

```javascript
ZSS.format.buildFilename(document.title, 11603.693, 'z-an')
```

期待: `"z-an/KAMITSUBAKI FES '26 FIELD OF RESONANCE アーカイブ_03-13-23.693.png"` のような文字列が返る (タイトル末尾の ` - Z-aN` が除去されている)

4. Console で `ZSS.defaults.captureKey` を実行する

期待: `{code: 'KeyS', shift: true, ctrl: false, alt: false, meta: false}`

- [ ] **Step 8: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/shared/ test/ manifest.json
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: タイムコードとファイル名の純粋関数を追加

ブラウザと Node の双方から読めるよう UMD 風に書き、node:test で
テストする。ミリ秒は floor ではなく四捨五入する。floor だと
59.9996 秒が 59.999 秒になり、実際の表示位置とずれるため。

fps のスナップは最近傍候補との相対差が 10% を超える実測値を
null として棄却する。異常値を無理に一般 fps に寄せると、コマ送りの
粒度が静かに壊れるため。"
```


---

## Task 3: z-an DOM アダプタ

**Goal:** z-an 固有のセレクタを 1 ファイルに封じ込め、他モジュールが DOM 構造を知らずに済むようにする。

**Files:**
- Create: `src/content/player.js`
- Modify: `manifest.json` (js 配列に追加)

**Interfaces:**
- Consumes: なし (このファイルは DOM だけに依存する)
- Produces:
  - `ZSS.player.getContainer(): HTMLElement | null` — `#player-con`
  - `ZSS.player.getVideo(): HTMLVideoElement | null`
  - `ZSS.player.getControlHost(): HTMLElement | null` — ボタンバーを挿す親 (`.cover-controls`)
  - `ZSS.player.isPaused(): boolean`
  - `ZSS.player.getTitle(): string`
  - `ZSS.player.verifySelectors(): string[]` — 見つからなかったセレクタの説明の配列
  - `ZSS.player.onPauseStateChange(cb: (paused: boolean) => void): void`
  - `ZSS.player.onControlHostChange(cb: (host: HTMLElement | null) => void): MutationObserver`

- [ ] **Step 1: `src/content/player.js` を実装**

```javascript
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
```

- [ ] **Step 2: `manifest.json` の js 配列を更新**

`content_scripts[0].js` を以下に差し替える:

```json
      "js": [
        "src/shared/defaults.js",
        "src/shared/format.js",
        "src/content/player.js",
        "src/content/index.js"
      ],
```

- [ ] **Step 3: 動作を確認 (手動)**

1. `chrome://extensions` で拡張を再読み込みし、z-an の再生ページをリロードする
2. **動画を再生してから**、DevTools の Console で以下を順に実行する

```javascript
ZSS.player.verifySelectors()
```

期待: `[]` (空配列。全セレクタが見つかっている)

```javascript
const v = ZSS.player.getVideo();
[v.videoWidth, v.videoHeight, v.paused]
```

期待: `[1920, 1080, false]`

```javascript
ZSS.player.getContainer().id
```

期待: `'player-con'`

3. 動画を一時停止して以下を実行する

```javascript
[ZSS.player.isPaused(), ZSS.player.getControlHost()?.className]
```

期待: `[true, 'cover-controls paused']` のように `isPaused` が `true` を返し、`.cover-controls` が取得できる

4. 一時停止状態の追従を確認する

```javascript
ZSS.player.onPauseStateChange((paused) => console.log('paused =', paused));
```

実行後に再生 / 一時停止を切り替える

期待: 切り替えるたびに `paused = false` / `paused = true` が出力される

- [ ] **Step 4: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/content/player.js manifest.json
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: z-an の DOM アダプタを追加

セレクタを 1 ファイルに集約し、z-an 側の構造変更で直す箇所を
限定する。一時停止の判定は DOM クラスではなく video.paused を
正とし、クラス名の変更に影響されないようにする。

MutationObserver の監視範囲は #playerArea に限定した。document
全体を subtree 監視すると時刻表示の更新まで拾ってしまうため。"
```

---

## Task 4: スタイル注入とトースト

**Goal:** 撮影の成否をその場で伝えられるようにする。以降のタスクのフィードバック手段になる。

**Files:**
- Create: `src/content/ui.js`
- Modify: `manifest.json` (js 配列に追加)

**Interfaces:**
- Consumes: `ZSS.player.getContainer()`
- Produces:
  - `ZSS.ui.injectStyles(): void`
  - `ZSS.ui.showToast(message: string, isError?: boolean): void`

- [ ] **Step 1: `src/content/ui.js` を実装**

```javascript
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
```

- [ ] **Step 2: `manifest.json` の js 配列を更新**

```json
      "js": [
        "src/shared/defaults.js",
        "src/shared/format.js",
        "src/content/player.js",
        "src/content/ui.js",
        "src/content/index.js"
      ],
```

- [ ] **Step 3: 動作を確認 (手動)**

1. 拡張を再読み込みし、z-an の再生ページをリロードする
2. Console で以下を実行する

```javascript
ZSS.ui.showToast('保存しました: z-an/テスト_00-00-00.000.png')
```

期待: 画面右下に黒い半透明のトーストが表示され、約 2 秒後に消える

```javascript
ZSS.ui.showToast('動画がまだ読み込まれていません', true)
```

期待: 赤いトーストが表示される

3. フルスクリーンボタンでフルスクリーンにしてから、再度 `ZSS.ui.showToast('フルスクリーン確認')` を実行する

期待: フルスクリーン表示中でもトーストが見える

- [ ] **Step 4: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/content/ui.js manifest.json
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: トースト表示を追加

撮影の成否をその場で伝える。トーストは #player-con の子として
置く。フルスクリーン時はフルスクリーン要素のサブツリー内に
ないと表示されないため。

スタイルは zss- プレフィックス配下に限定し、z-an 側の既存要素の
スタイルには一切触れない。"
```

---

## Task 5: 撮影と保存

**Goal:** Console から `ZSS.capture.shoot('z-an')` を呼ぶと、UI の写り込みがない 1920x1080 の PNG が `~/Downloads/z-an/` に保存される状態にする。

**Files:**
- Create: `src/content/capture.js`
- Create: `src/background/index.js`
- Modify: `manifest.json` (js 配列と `background` の追加)

**Interfaces:**
- Consumes: `ZSS.player.getVideo()`, `ZSS.player.getTitle()`, `ZSS.format.buildFilename()`
- Produces:
  - `ZSS.capture.grabDataUrl(video?: HTMLVideoElement): string` — PNG の data URL
  - `ZSS.capture.shoot(subdir: string): Promise<string>` — 保存したファイル名を返す
  - service worker のメッセージ契約: `{ type: 'zss-save', dataUrl: string, filename: string }` → `{ ok: true, downloadId: number }` または `{ ok: false, error: string }`

- [ ] **Step 1: `src/content/capture.js` を実装**

```javascript
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
      throw new Error((response && response.error) || '保存に失敗しました (service worker から応答がありません)');
    }
    return filename;
  }

  ZSS.capture = { grabDataUrl, shoot };
})();
```

- [ ] **Step 2: `src/background/index.js` を実装**

```javascript
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
```

- [ ] **Step 3: `manifest.json` に background と capture.js を追加**

`manifest.json` 全体を以下にする:

```json
{
  "manifest_version": 3,
  "name": "z-an Screenshot",
  "version": "0.1.0",
  "description": "z-an のアーカイブ動画から UI の写り込みなしにフレームを保存する",
  "permissions": ["downloads", "storage"],
  "background": {
    "service_worker": "src/background/index.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.zan-live.com/*"],
      "js": [
        "src/shared/defaults.js",
        "src/shared/format.js",
        "src/content/player.js",
        "src/content/ui.js",
        "src/content/capture.js",
        "src/content/index.js"
      ],
      "run_at": "document_idle",
      "all_frames": false
    }
  ]
}
```

- [ ] **Step 4: 動作を確認 (手動)**

1. 拡張を再読み込みし、z-an の再生ページをリロードする
2. 動画を再生し、**一時停止 UI が出ている状態**にする (UI が写り込まないことを確認するため)
3. Console で以下を実行する

```javascript
await ZSS.capture.shoot('z-an')
```

期待: `'z-an/<タイトル>_HH-MM-SS.mmm.png'` が返り、`~/Downloads/z-an/` に PNG が保存される

4. 保存された PNG を開いて確認する

期待:
- 画像サイズが **1920x1080** (プレイヤーの表示サイズではない)
- 一時停止 UI・コントロールバー・時刻表示が **写り込んでいない**
- ファイル名のタイムコードが、一時停止した位置と一致している

5. エラー時の挙動を確認する

```javascript
await ZSS.capture.shoot('')
```

期待: サブフォルダが空でも `z-an/` にフォールバックして保存される

- [ ] **Step 5: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/content/capture.js src/background/index.js manifest.json
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: canvas 撮影と PNG 保存を追加

video のデコード済みフレームを canvas 経由で取り出すため、上に
重なっている再生 UI は写り込まない。表示サイズではなくソース
解像度 1920x1080 で保存される。

service worker には data URL を渡す。Blob URL は生成元オリジンに
紐づいており拡張の service worker からは解決できず、
downloads.download が Invalid URL で失敗するため。

canvas は 1 枚を使い回す。連写のたびに生成すると GC 負荷が上がる。"
```

---

## Task 6: 撮影ホットキー

**Goal:** z-an の再生ページで `Shift+S` を押すと撮影・保存され、トーストで結果が出る。

**Files:**
- Modify: `src/content/index.js` (全面的に書き換え)

**Interfaces:**
- Consumes: `ZSS.defaults`, `ZSS.format.matchesHotkey()`, `ZSS.capture.shoot()`, `ZSS.ui.showToast()`, `ZSS.player.verifySelectors()`
- Produces: `ZSS.settings` (現在の設定。以降のタスクから参照する)

- [ ] **Step 1: `src/content/index.js` を書き換える**

```javascript
// エントリポイント。設定の読み込みとキー入力の配線を担う。
(function () {
  'use strict';

  const ZSS = (globalThis.ZSS = globalThis.ZSS || {});
  ZSS.version = '0.1.0';

  let settings = Object.assign({}, ZSS.defaults);
  ZSS.settings = settings;

  function loadSettings() {
    chrome.storage.sync.get(ZSS.defaults, (stored) => {
      if (chrome.runtime.lastError) {
        console.error(
          '[z-an Screenshot] 設定の読み込みに失敗しました:',
          chrome.runtime.lastError.message
        );
        return;
      }
      settings = Object.assign({}, ZSS.defaults, stored);
      ZSS.settings = settings;
    });
  }

  // オプションページでの変更を、ページをリロードせずに反映する
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      settings[key] = change.newValue;
    }
  });

  // 入力欄にフォーカスがあるときはホットキーを奪わない
  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
  }

  async function doCapture() {
    try {
      const filename = await ZSS.capture.shoot(settings.downloadSubdir);
      ZSS.ui.showToast(`保存しました: ${filename}`);
    } catch (error) {
      console.error('[z-an Screenshot] 撮影に失敗しました:', error);
      ZSS.ui.showToast(error.message, true);
    }
  }

  // capture フェーズで受け取り、z-an 側のハンドラより先に判定する
  function onKeyDown(event) {
    if (isTypingTarget(event.target)) return;

    if (ZSS.format.matchesHotkey(event, settings.captureKey)) {
      event.preventDefault();
      event.stopPropagation();
      doCapture();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  loadSettings();

  // 想定した要素が無ければ警告する。silent に動かなくなるのを防ぐ
  const missing = ZSS.player.verifySelectors();
  if (missing.length > 0) {
    console.warn(
      '[z-an Screenshot] 想定した要素が見つかりません。z-an の DOM 構造が変わった可能性があります:',
      missing
    );
  }

  console.info('[z-an Screenshot] content script を読み込みました', ZSS.version);
})();
```

- [ ] **Step 2: 動作を確認 (手動)**

1. 拡張を再読み込みし、z-an の再生ページをリロードする
2. 動画を再生する
3. **再生中に** `Shift+S` を押す

期待: 「保存しました: z-an/...png」のトーストが出て、`~/Downloads/z-an/` に PNG が保存される

4. 一時停止して `Shift+S` を押す

期待: 同様に保存される。保存された画像に一時停止 UI が写っていない

5. `Shift+S` を素早く 5 回押す

期待: 5 枚保存され、**ファイル名が衝突しない** (タイムコードのミリ秒が異なる)

6. フルスクリーンにして `Shift+S` を押す

期待: フルスクリーン中も保存され、トーストが見える

7. 動画を読み込む前 (ページを開いた直後) に `Shift+S` を押す

期待: 赤いトーストで「動画がまだ読み込まれていません」と表示される (silent に失敗しない)

- [ ] **Step 3: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/content/index.js
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: 撮影ホットキーを追加

Shift+S で撮影する。keydown は capture フェーズで受け取り、
z-an 側のハンドラより先に判定する。入力欄にフォーカスがある
ときはキーを奪わない。

設定は chrome.storage.onChanged を購読して反映するため、
オプションページでの変更にページのリロードなしで追従する。"
```

---

## Task 7: fps 実測とコマ送り

**Goal:** 一時停止中に `←` / `→` で 1 フレームずつ移動でき、再生中は z-an 本来の 10 秒送りを妨げない。

**Files:**
- Create: `src/content/stepper.js`
- Modify: `src/content/index.js` (矢印キーの配線を追加)
- Modify: `manifest.json` (js 配列に追加)

**Interfaces:**
- Consumes: `ZSS.player.getVideo()`, `ZSS.player.onPauseStateChange()`, `ZSS.format.snapFps()`
- Produces:
  - `ZSS.stepper.step(direction: 1 | -1): Promise<boolean>` — 実際に動いたら `true`
  - `ZSS.stepper.getFps(): number` — 実測値、またはフォールバックの 30
  - `ZSS.stepper.getMeasuredFps(): number | null` — 実測できていなければ `null`
  - `ZSS.stepper.ensureFps(): Promise<number | null>`

- [ ] **Step 1: `src/content/stepper.js` を実装**

```javascript
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
```

- [ ] **Step 2: `manifest.json` の js 配列を更新**

`src/content/ui.js` と `src/content/capture.js` の間に `src/content/stepper.js` を入れる
(stepper は player に依存し、index から使われる):

```json
      "js": [
        "src/shared/defaults.js",
        "src/shared/format.js",
        "src/content/player.js",
        "src/content/ui.js",
        "src/content/stepper.js",
        "src/content/capture.js",
        "src/content/index.js"
      ],
```

- [ ] **Step 3: `src/content/index.js` に矢印キーの配線を追加**

既存の `onKeyDown` 関数を削除し、以下の 2 つの関数 (`doStep` は新規、`onKeyDown` は
差し替え) をその位置に置く。`doStep` は Task 8 のボタンからも呼ぶため、
`doCapture` と並ぶ位置に定義する:

```javascript
  async function doStep(direction) {
    try {
      await ZSS.stepper.step(direction);
    } catch (error) {
      console.error('[z-an Screenshot] コマ送りに失敗しました:', error);
      ZSS.ui.showToast(error.message, true);
    }
  }

  // capture フェーズで受け取り、z-an 側のハンドラより先に判定する
  function onKeyDown(event) {
    if (isTypingTarget(event.target)) return;

    if (ZSS.format.matchesHotkey(event, settings.captureKey)) {
      event.preventDefault();
      event.stopPropagation();
      doCapture();
      return;
    }

    // コマ送りは一時停止中のみ。再生中は z-an 本来の 10 秒送りを妨げない
    if (!ZSS.player.isPaused()) return;

    if (ZSS.format.matchesHotkey(event, settings.stepForwardKey)) {
      event.preventDefault();
      event.stopPropagation();
      doStep(1);
      return;
    }
    if (ZSS.format.matchesHotkey(event, settings.stepBackKey)) {
      event.preventDefault();
      event.stopPropagation();
      doStep(-1);
    }
  }
```

- [ ] **Step 4: 動作を確認 (手動)**

1. 拡張を再読み込みし、z-an の再生ページをリロードする
2. 動画を数秒**再生**する
3. Console を確認する

期待: `[z-an Screenshot] fps を実測しました: 30 (生の測定値: 29.99...)` のようなログが出る
(値は配信によって 30 / 60 などになる)

```javascript
ZSS.stepper.getMeasuredFps()
```

期待: `30` または `60` など。`null` ではない

4. 一時停止して、Console に現在時刻を表示させてから `→` を押す

```javascript
ZSS.player.getVideo().currentTime
```

`→` を 1 回押した後にもう一度実行する

期待: 差分が `1/fps` (30fps なら約 0.0333) 秒になっている。映像も 1 コマ進んでいる

5. `←` を押して 1 コマ戻ることを確認する

期待: 映像が 1 コマ戻り、`currentTime` が約 `1/fps` 減る

6. `→` を 10 回連打する

期待: 10 コマ進む。連打してもシークが破綻しない

7. **再生中に** `←` / `→` を押す

期待: z-an 本来の 10 秒戻し / 10 秒送りが動作する (拡張がキーを奪っていない)

8. 動画の先頭 (`currentTime = 0`) で `←` を押す

期待: エラーにならず、0 秒のまま留まる

- [ ] **Step 5: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/content/stepper.js src/content/index.js manifest.json
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: 1 フレーム単位のコマ送りを追加

fps は requestVideoFrameCallback の presentedFrames と mediaTime の
差分から実測し、一般的な fps にスナップする。測定できない場合は
30fps にフォールバックするが、粒度がずれることを必ず警告する。

コマ送りは一時停止中のみ有効にし、再生中は z-an 本来の 10 秒送りを
妨げない。シーク後の描画待ちには seeked と rVFC の両方を張り、
どちらも来ない場合に備えて 1 秒のタイムアウトも置く。"
```

---

## Task 8: 一時停止 UI へのボタン追加

**Goal:** 一時停止すると既存 UI の下にコマ戻し・撮影・コマ送りのボタンが現れ、クリックで動作する。

**Files:**
- Modify: `src/content/ui.js` (ボタンバーを追加)
- Modify: `src/content/index.js` (ボタンの配線)

**Interfaces:**
- Consumes: `ZSS.player.getControlHost()`, `ZSS.player.onControlHostChange()`, `ZSS.player.onPauseStateChange()`, `ZSS.format.formatHotkey()`
- Produces:
  - `ZSS.ui.mountButtons(handlers: { onStepBack, onStepForward, onShoot }, settings): void`
  - `ZSS.ui.setButtonsEnabled(enabled: boolean): void`
  - `ZSS.ui.updateButtonLabels(settings): void`

- [ ] **Step 1: `src/content/ui.js` の `STYLE_TEXT` にボタンのスタイルを追記**

`STYLE_TEXT` の末尾 (バッククォートの手前) に以下を追加する:

```css
.zss-bar {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, calc(-50% + 72px));
  z-index: 2;
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
```

- [ ] **Step 2: `src/content/ui.js` にボタンバーの実装を追加**

Task 4 で書いた末尾の 1 行 `ZSS.ui = { injectStyles, showToast };` を**削除し**、
その位置に以下をまるごと置く (末尾に新しい `ZSS.ui = {...}` が含まれている):

```javascript
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

  function onBarClick(event) {
    const button = event.target.closest('.zss-btn');
    if (!button || !barHandlers) return;
    // .cover-controls はクリックで再生/一時停止するため、伝播を必ず止める
    event.preventDefault();
    event.stopPropagation();
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
    bar.addEventListener('click', onBarClick);
    return bar;
  }

  function updateButtonLabels(settings) {
    const bar = getBar();
    if (!bar) return;
    for (const spec of BUTTON_SPECS) {
      const button = bar.querySelector(`[data-zss-action="${spec.action}"]`);
      if (!button) continue;
      const hotkey = ZSS.format.formatHotkey(settings[spec.settingKey]);
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

  // .cover-controls は差し替えられることがあるため、無ければ挿し直す
  function attachBar(settings) {
    if (!barEnabled) return;
    const host = ZSS.player.getControlHost();
    if (!host) return;
    if (host.querySelector(':scope > .zss-bar')) return;
    host.appendChild(buildBar());
    updateButtonLabels(settings || ZSS.settings || {});
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
```

- [ ] **Step 3: `src/content/index.js` でボタンを配線する**

`document.addEventListener('keydown', onKeyDown, true);` の**直前**に以下を挿入する:

```javascript
  ZSS.ui.mountButtons(
    {
      onStepBack: () => doStep(-1),
      onStepForward: () => doStep(1),
      onShoot: () => doCapture(),
    },
    settings
  );
```

さらに `chrome.storage.onChanged` のリスナー内、`for` ループの**直後**に以下を追加して、
設定変更をボタンに反映する:

```javascript
    ZSS.ui.setButtonsEnabled(settings.showButtons);
    ZSS.ui.updateButtonLabels(settings);
```

`loadSettings` の `settings = Object.assign(...)` の**直後**にも同じ 2 行を追加する
(初回読み込み時にも反映するため):

```javascript
      ZSS.ui.setButtonsEnabled(settings.showButtons);
      ZSS.ui.updateButtonLabels(settings);
```

- [ ] **Step 4: 動作を確認 (手動)**

1. 拡張を再読み込みし、z-an の再生ページをリロードして再生する
2. 一時停止する

期待: 既存の「10秒戻し / 再生 / 10秒送り」の下に、丸いボタンが 3 つ横並びで現れる

3. 各ボタンにマウスを乗せる

期待: ツールチップに「1 コマ戻す (←)」「撮影 (Shift+S)」「1 コマ送る (→)」と表示される

4. コマ送りボタンをクリックする

期待: **再生が再開されず**、1 コマだけ進む (`.cover-controls` のクリックが発火していない)

5. 撮影ボタンをクリックする

期待: PNG が保存され、トーストが出る。再生は再開されない

6. 再生を再開する

期待: ボタンバーが消える

7. フルスクリーンにして一時停止する

期待: フルスクリーン中もボタンバーが表示され、クリックで動作する

8. 保存した PNG を開く

期待: 追加したボタンバーもトーストも**写り込んでいない**

- [ ] **Step 5: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/content/ui.js src/content/index.js
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: 一時停止 UI にコマ送り・撮影ボタンを追加

既存の control-list には手を触れず、その下に独自の行を append する。
挿入先は #player-con 配下なのでフルスクリーン時も表示される。

cover-controls はクリックで再生/一時停止するため、ボタンの
クリックは伝播を止める。止めないとコマ送りのたびに再生が再開する。

アイコンはインライン SVG で描く。絵文字はフォント依存でサイズと
ベースラインがずれ、既存ボタンと並べたときに揃わないため。"
```

---

## Task 9: オプションページ

**Goal:** ホットキー・保存先サブフォルダ・ボタン表示を設定でき、ページをリロードせずに反映される。

**Files:**
- Create: `src/options/options.html`
- Create: `src/options/options.js`
- Modify: `manifest.json` (`options_page` を追加)

**Interfaces:**
- Consumes: `ZSS.defaults`, `ZSS.format.formatHotkey()`, `ZSS.format.hotkeyFromEvent()`
- Produces: `chrome.storage.sync` に保存される設定 (content script が `onChanged` で購読する)

- [ ] **Step 1: `src/options/options.html` を作る**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>z-an Screenshot の設定</title>
<style>
  body {
    margin: 0;
    padding: 24px;
    max-width: 560px;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
    font-size: 14px;
    line-height: 1.7;
    color: #1c1c1e;
  }
  h1 { font-size: 18px; margin: 0 0 20px; }
  h2 { font-size: 14px; margin: 24px 0 8px; color: #6b6b70; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
  .row label { width: 140px; flex: none; }
  input[type="text"] {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid #c7c7cc;
    border-radius: 6px;
    font: inherit;
  }
  input[readonly] { background: #f2f2f7; cursor: pointer; }
  input[readonly]:focus { border-color: #0a84ff; background: #fff; outline: none; }
  .hint { margin: 4px 0 0; font-size: 12px; color: #8e8e93; }
  button {
    margin-top: 20px;
    padding: 7px 14px;
    border: 1px solid #c7c7cc;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  #status { min-height: 1.7em; margin: 12px 0 0; font-size: 12px; color: #34c759; }
  #status.zss-error { color: #ff3b30; }
</style>
</head>
<body>
  <h1>z-an Screenshot の設定</h1>

  <h2>ホットキー</h2>
  <p class="hint">入力欄をクリックしてから、割り当てたいキーを押してください。修飾キー単独は登録できません。</p>
  <div class="row">
    <label for="captureKey">撮影</label>
    <input id="captureKey" type="text" readonly data-hotkey="captureKey">
  </div>
  <div class="row">
    <label for="stepForwardKey">1 コマ送る</label>
    <input id="stepForwardKey" type="text" readonly data-hotkey="stepForwardKey">
  </div>
  <div class="row">
    <label for="stepBackKey">1 コマ戻す</label>
    <input id="stepBackKey" type="text" readonly data-hotkey="stepBackKey">
  </div>
  <p class="hint">コマ送りは一時停止中のみ動作します。再生中は z-an 本来の 10 秒送りが働きます。</p>

  <h2>保存</h2>
  <div class="row">
    <label for="downloadSubdir">サブフォルダ</label>
    <input id="downloadSubdir" type="text">
  </div>
  <p class="hint">ダウンロードフォルダ内のこのフォルダに保存します。空にすると z-an を使います。</p>

  <h2>表示</h2>
  <label>
    <input id="showButtons" type="checkbox">
    一時停止中にコマ送り・撮影ボタンを表示する
  </label>

  <button id="reset" type="button">既定値に戻す</button>
  <p id="status" role="status"></p>

  <script src="../shared/defaults.js"></script>
  <script src="../shared/format.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: `src/options/options.js` を作る**

```javascript
// 設定の読み書き。保存すると content script が chrome.storage.onChanged で
// 拾うため、z-an のページをリロードしなくても反映される。
(function () {
  'use strict';

  const ZSS = globalThis.ZSS;
  const HOTKEY_FIELDS = ['captureKey', 'stepForwardKey', 'stepBackKey'];
  // 修飾キー単独は割り当てさせない
  const MODIFIER_CODES = [
    'ShiftLeft', 'ShiftRight',
    'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight',
    'MetaLeft', 'MetaRight',
  ];

  let settings = Object.assign({}, ZSS.defaults);

  function showStatus(message, isError) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.classList.toggle('zss-error', Boolean(isError));
  }

  function render() {
    for (const key of HOTKEY_FIELDS) {
      document.getElementById(key).value = ZSS.format.formatHotkey(settings[key]);
    }
    document.getElementById('downloadSubdir').value = settings.downloadSubdir;
    document.getElementById('showButtons').checked = Boolean(settings.showButtons);
  }

  function save() {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        showStatus(`保存に失敗しました: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      showStatus('保存しました');
    });
  }

  function load() {
    chrome.storage.sync.get(ZSS.defaults, (stored) => {
      if (chrome.runtime.lastError) {
        showStatus(`設定の読み込みに失敗しました: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      settings = Object.assign({}, ZSS.defaults, stored);
      render();
    });
  }

  for (const key of HOTKEY_FIELDS) {
    const input = document.getElementById(key);
    input.addEventListener('keydown', (event) => {
      event.preventDefault();
      if (MODIFIER_CODES.includes(event.code)) return;
      settings[key] = ZSS.format.hotkeyFromEvent(event);
      render();
      save();
    });
  }

  document.getElementById('downloadSubdir').addEventListener('change', (event) => {
    settings.downloadSubdir = event.target.value.trim() || ZSS.defaults.downloadSubdir;
    render();
    save();
  });

  document.getElementById('showButtons').addEventListener('change', (event) => {
    settings.showButtons = event.target.checked;
    save();
  });

  document.getElementById('reset').addEventListener('click', () => {
    settings = Object.assign({}, ZSS.defaults);
    render();
    save();
  });

  load();
})();
```

- [ ] **Step 3: `manifest.json` に `options_page` を追加**

`"background"` の直後に以下を追加する:

```json
  "options_page": "src/options/options.html",
```

- [ ] **Step 4: 動作を確認 (手動)**

1. 拡張を再読み込みする
2. `chrome://extensions` の拡張カードから「詳細」→「拡張機能のオプション」を開く

期待: 設定画面が表示され、撮影に `Shift+S`、コマ送りに `→`、コマ戻しに `←` が入っている

3. 「撮影」の入力欄をクリックし、`Ctrl+Shift+C` を押す

期待: 表示が `Ctrl+Shift+C` に変わり、「保存しました」と出る

4. 入力欄をクリックして `Shift` キーだけを押す

期待: 表示が変わらない (修飾キー単独は登録されない)

5. **z-an のページをリロードせずに** タブを切り替え、`Ctrl+Shift+C` を押す

期待: 撮影される (設定変更がリロードなしで反映されている)

6. 一時停止してボタンにマウスを乗せる

期待: ツールチップが「撮影 (Ctrl+Shift+C)」に更新されている

7. オプションで「既定値に戻す」を押し、z-an のページで `Shift+S` を押す

期待: 撮影される

8. オプションで「一時停止中にコマ送り・撮影ボタンを表示する」のチェックを外す

期待: z-an のページで一時停止してもボタンバーが出ない。ホットキーでの撮影は引き続き動作する

9. サブフォルダを `z-an/shots` に変えて撮影する

期待: `~/Downloads/z-an/shots/` に保存される

- [ ] **Step 5: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add src/options/ manifest.json
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "feat: オプションページを追加

ホットキーは文字列を手で打たせず、入力欄で実際にキーを押して
記録する。修飾キー単独は登録させない。

保存は chrome.storage.sync に書くだけで、content script 側が
onChanged で拾うため z-an のページをリロードしなくても反映される。"
```

---

## Task 10: 受け入れ条件の確認と README 仕上げ

**Goal:** spec の受け入れ条件 12 項目を全て確認し、README を使える状態にする。

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 自動テストを実行**

```bash
node --test
```

期待: PASS (12 tests, 0 fail)

- [ ] **Step 2: spec の受け入れ条件を順に確認 (手動)**

z-an の再生ページを**通常の Chrome ウィンドウ**で開き、以下を上から順に確認する。
1 つでも失敗したら、その機能のタスクに戻って直してから再開する。

| # | 確認内容 | 期待 |
|---|---|---|
| 1 | 再生中に `Shift+S` | 1920x1080 の PNG が `~/Downloads/z-an/` に保存される |
| 2 | 一時停止中に `Shift+S` | 同上。UI・コントロールバー・広告表示が写り込んでいない |
| 3 | 一時停止中に `→` `←` | 1 フレームずつ動く (`currentTime` の差分が `1/fps`) |
| 4 | 再生中に `→` `←` | z-an 本来の 10 秒送り / 戻しが働く |
| 5 | 一時停止 | 既存 UI を壊さずボタンバーが表示される |
| 6 | フルスクリーンで 1〜5 | 全て動作する |
| 7 | オプションでホットキー変更 | リロードなしで反映される |
| 8 | `Shift+S` を素早く 5 回 | 5 枚保存され、ファイル名が衝突しない |
| 9 | 別サイト (google.com など) で `Shift+S` | 何も起きない。Console にログも出ない |
| 10 | 動画未ロード時に `Shift+S` | 赤いトーストでエラーが出る (silent に失敗しない) |
| 11 | Console の警告 | z-an の DOM が想定通りなら警告が出ていない |
| 12 | オプションでボタン表示 OFF | 一時停止 UI が z-an 本来の状態に戻る |

- [ ] **Step 3: `README.md` に使い方を追記**

`## インストール` セクションの**手前**に以下を挿入する:

```markdown
## 使い方

| 操作 | キー | 備考 |
|---|---|---|
| 撮影 | `Shift+S` | 再生中でも一時停止中でも使える |
| 1 コマ送る | `→` | 一時停止中のみ |
| 1 コマ戻す | `←` | 一時停止中のみ |

一時停止すると、既存の再生コントロールの下にコマ送り・撮影ボタンが表示される。

保存先は `~/Downloads/z-an/<番組タイトル>_<再生位置>.png`。再生位置は
`HH-MM-SS.mmm` 形式なので、連写してもファイル名が衝突せず、
ファイル名順に並べると時系列順になる。

ホットキーと保存先は `chrome://extensions` の「拡張機能のオプション」から変更できる。

### 仕組み

`<video>` のデコード済みフレームを canvas 経由で取り出しているため、
画面に重なっている再生 UI は原理的に写り込まない。また、プレイヤーの
表示サイズではなく配信のソース解像度 (1920x1080) で保存される。

コマ送りの粒度は `requestVideoFrameCallback` で実測した fps に基づく。
30fps 配信でも 60fps 配信でも自動で追従する。
```

`## 対応サイト` セクションの**後**に以下を追記する:

```markdown
## 開発

ビルドは不要。コードを変更したら `chrome://extensions` で拡張を再読み込みし、
z-an のページもリロードする。

純粋関数のテスト:

```bash
node --test
```

DOM 操作・キー入力・ダウンロードは自動テストの費用対効果が低いため、
`.claude/plans/2026-09-07-z-an-screenshot-extension.md` の各タスクにある
手動確認手順で担保している。

### 構成

| パス | 責務 |
|---|---|
| `src/content/player.js` | z-an 固有の DOM セレクタ。**構造が変わったらここだけ直す** |
| `src/content/capture.js` | canvas 撮影 → data URL |
| `src/content/stepper.js` | fps 実測とコマ送り |
| `src/content/ui.js` | ボタンバーとトースト |
| `src/content/index.js` | キー待受と配線 |
| `src/background/index.js` | `chrome.downloads` での保存 |
| `src/shared/format.js` | タイムコード・ファイル名・fps・ホットキーの純粋関数 |
```

- [ ] **Step 4: commit**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot add README.md
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot commit -m "docs: README に使い方と開発手順を追記

受け入れ条件 12 項目を確認済み。"
```

- [ ] **Step 5: 全体の差分を確認**

```bash
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot log --oneline
git -C /Users/trapple/repos/github.com/trapple/z-an-screen-shot status --short
```

期待: 各タスクが 1 コミットずつ積まれており、作業ツリーがクリーン
