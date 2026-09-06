# z-an スクリーンショット拡張 設計

- 状態: 承認待ち
- 日付: 2026-09-07
- 対象: Chrome 拡張機能 (Manifest V3)

## 1. 背景と目的

z-an (https://www.zan-live.com) のアーカイブ動画で、任意のコマを綺麗に静止画として保存したい。

現状の問題は 2 つある。

1. 一時停止すると再生コントロール UI が動画の上に被さり、OS のスクリーンショットでは UI ごと写り込む
2. 一時停止の位置を細かく調整する手段がない (既存 UI は 10 秒送り / 10 秒戻しのみ)

本拡張はこの 2 つを解決する。

## 2. 事前調査の結果 (実測)

対象ページ (`https://www.zan-live.com/ja/live/play/6803/4204`) を DevTools で実測した結果:

```
player:  1920x1080 / duration 15762 秒 / readyState 4
DRM:     hasMediaKeys=false, keySystem=null
capture: canvas.drawImage + getImageData 成功, maxLuma=255
```

判明した事実:

| 項目 | 内容 |
|---|---|
| プレイヤー | Shaka Player v4.16.9z0 (カスタムビルド) |
| video 要素 | `<video id="video" autoplay playsinline crossorigin data-shaka-player>` |
| ソース | `blob:` (MSE 経由でセグメント供給) |
| DRM | **なし** (EME 未使用) |
| canvas 取得 | **可能** (CORS tainted にならない。`crossorigin` 属性が付与されている) |
| ソース解像度 | 1920x1080 |

**この調査結果が設計の根幹を決めている。** `canvas.drawImage(video)` が
デコード済みフレームそのものを取得できるため、動画の上に重なっている DOM
(一時停止 UI、コントロールバー、広告スキップ表示) は原理的に写り込まない。

したがって当初検討していた「撮影前に CSS で UI を隠す」処理は**不要**であり、
`chrome.tabs.captureVisibleTab` (表示ピクセル依存・UI が写る) も採用しない。
表示サイズ (例: 840x473) ではなくソース解像度 1920x1080 の等倍で撮影できる。

### 既知の環境依存メモ

再生ページを開くと、ページ埋め込み JSON の `JSON.parse` が 16382 バイト目で失敗し、
jQuery の ready ハンドラ内で `SyntaxError` が出る。

```
Uncaught SyntaxError: Expected ',' or '}' after property value in JSON at position 16382
    at HTMLDocument.<anonymous> (…/live/play/6803/4204:2504:34)
```

これは **通常の Chrome でも発生する z-an 側の問題**であり、動画の再生自体には影響しない
(この例外が出ている状態でも video は正常に再生され、fps の実測も成功する)。
本拡張とは無関係なので対処しない。

当初この現象を「Claude in Chrome (MCP) 経由でのみ起きる、拡張のサニタイズによる切断」と
推測して spec に記載していたが、実機確認により誤りと判明したため訂正した。

ただし MCP 経由でページを開いた場合、この例外に加えて **動画がまったく再生されない**
(`readyState` が 0 のまま) という別の現象が起きる。原因は未特定。自動化ツール経由での
動作確認は当てにならないため、手動確認は通常の Chrome ウィンドウで行うこと。

## 3. スコープ

### やること

- z-an の再生ページで、ホットキーによる任意タイミングのフレーム撮影
- 一時停止中の 1 フレーム単位のコマ送り / コマ戻し
- 一時停止 UI へのコマ送り・撮影ボタンの追加
- 撮影した PNG の自動ダウンロード
- ホットキーのカスタマイズ (オプションページ)
- フルスクリーン再生時の全機能動作

### やらないこと (YAGNI)

- z-an 以外のサイトへの対応 (`matches` は `www.zan-live.com` に限定)
- z-an の再生ページ以外での動作 (トップページや番組一覧では何もしない。後述)
- 動画の録画・連続キャプチャの自動化
- 画像の編集・トリミング・注釈
- クリップボードへのコピー (将来必要になれば追加する)
- 撮影モードの ON/OFF 状態管理 (常時有効とする。後述)

### 設計判断の記録

| 論点 | 決定 | 理由 |
|---|---|---|
| 撮影方式 | canvas 直採り | DRM なしで取得可能と実測済み。UI 退避が不要になり、ソース解像度で撮れる |
| スクショモード | **なし・常時有効** | UI 退避が不要になったことでモードを分ける必然性が消えた。状態管理・状態表示・トグル処理がまるごと不要になる |
| 撮影ホットキー | `Shift+S` | 当初案の `Ctrl+Space` は macOS の「前の入力ソースを選択」と競合する。z-an 再生ページにテキスト入力欄がないため単純な修飾キー + 英字で安全 |
| コマ送りキー | `←` / `→` (一時停止中のみ) | 再生中は z-an 本来の 10 秒送り / 戻しを尊重する |
| 保存先 | 自動ダウンロード (PNG) | 連写して後から Finder で選別する使い方に合う。PNG は無劣化 (綺麗なコマを残すのが目的なので JPEG の圧縮ノイズは本末転倒) |
| 適用範囲 | z-an 専用 | 権限最小。他サイトの キー操作を奪わない。対象を広げるのは後からでも容易 |
| ビルド | なし | manifest の js 配列で複数ファイルを注入し `globalThis.ZSS` で繋ぐ。npm 依存なしで、クローンして即読み込める |

## 4. アーキテクチャ

```
┌─ content script (www.zan-live.com/*) ────────────────┐
│                                                       │
│  player.js   z-an DOM アダプタ (セレクタを全て集約)     │
│  stepper.js  コマ送り (requestVideoFrameCallback)      │
│  capture.js  canvas 撮影 → PNG Blob                    │
│  ui.js       ボタン挿入 / トースト                      │
│  index.js    キー待受・全体の配線                        │
└───────────────────┬───────────────────────────────────┘
                    │ chrome.runtime.sendMessage
                    │   { type: 'save', blobUrl, filename }
┌───────────────────▼───────────────────────────────────┐
│  service worker : chrome.downloads.download()          │
│  → ~/Downloads/z-an/<タイトル>_<タイムコード>.png       │
└───────────────────────────────────────────────────────┘

┌─ options page : ホットキー設定 (chrome.storage.sync) ──┐
```

### 責務分離の要点

**z-an 固有の DOM 知識は `player.js` に閉じ込める。** z-an 側が DOM 構造を変更したとき、
修正箇所が 1 ファイルで済む。他のモジュールは以下の抽象だけを見る:

```js
ZSS.player = {
  getVideo(),        // HTMLVideoElement を返す (見つからなければ null)
  isPaused(),        // 一時停止中か
  getTitle(),        // 番組タイトル (ファイル名用)
  getControlHost(),  // 追加ボタンを挿す親要素
  onPauseStateChange(cb),  // 一時停止状態の変化を通知
}
```

各モジュールは IIFE で `globalThis.ZSS` 名前空間に登録する。

## 5. z-an DOM セレクタ一覧 (実測値)

```
#lBoxInner.aspect.playerSticky
└ #playerArea
  └ .playerParent.horizontal
    └ #player-con.inner-layout                 ← フルスクリーン対象要素
      ├ .boxLayer.mobileScale        z=999999  ← 全面を覆いクリックを受ける
      ├ .questionnaireLayer          z=10
      └ div
        ├ video#video                          ← 撮影対象 (1920x1080)
        ├ canvas.shaka-canvas-container
        ├ .cover-controls[.paused]             ← 一時停止時に paused が付く (クリックで再生/停止)
        │ └ .control-list.absolute-center      588x82
        │   ├ .time-back        71x71          10 秒戻し (既存)
        │   ├ .play-pause       82x82          再生/一時停止 (既存)
        │   └ .time-forward     71x71          10 秒送り (既存)
        └ .shaka-scrim-container               下部バー
          ├ .shaka-resolution-button
          ├ .shaka-fullscreen-button
          ├ .volume-button
          └ .time-bothsides (.current-time / .duration)
```

| 用途 | セレクタ | 備考 |
|---|---|---|
| 動画 | `#player-con video` | `#video` は id 依存が強いので子孫セレクタで冗長性を持たせる |
| 一時停止判定 | `video.paused` | DOM クラスではなく video 要素の状態を正とする |
| 一時停止 UI | `.cover-controls` | 要素の生成・差し替えを MutationObserver で監視 (状態判定には使わない) |
| ボタン挿入先 | `#player-con` | 直下に append する。`.cover-controls` の中には入れない (後述) |
| タイトル | `document.title` | `" - Z-aN"` サフィックスを除去 |

## 6. 機能仕様

### 6.1 撮影

トリガー: `Shift+S` (デフォルト、変更可) または UI の撮影ボタン。
**再生中・一時停止中のどちらでも動作する。**

```
Shift+S
  → player.getVideo()
  → canvas(videoWidth × videoHeight) に drawImage(video)
  → canvas.toBlob('image/png')
  → URL.createObjectURL(blob)
  → service worker へ { blobUrl, filename }
  → chrome.downloads.download({ url: blobUrl, filename })
  → URL.revokeObjectURL / トースト表示
```

canvas は毎回生成せず、モジュール内に 1 枚保持して使い回す (連写時の GC 負荷を避ける)。
`video.videoWidth` が変化した場合のみリサイズする。

#### ファイル名

```
z-an/KAMITSUBAKI FES '26 FIELD OF RESONANCE アーカイブ_03-13-23.456.png
     └─ document.title から生成 ─────────────────┘ └ 再生位置 HH-MM-SS.mmm ┘
```

- タイムコードは `video.currentTime` (動画先頭からの経過秒) を `HH-MM-SS.mmm` に整形。
  実時刻ではないのでタイムゾーンの考慮は不要
- ミリ秒まで含めるため、連写しても衝突せず Finder のファイル名順が時系列順になる
- ファイル名に使えない文字 (`/ \ : * ? " < > |`) と制御文字は除去する
- タイトルが空、または除去後に空文字になった場合は `z-an` を使う
- 全体が 120 文字を超える場合はタイトル部分を切り詰める (タイムコードは必ず残す)

#### 保存の実装方針

`chrome.downloads` は content script から直接呼べないため service worker を経由する。
content script から service worker へは **data URL** (`canvas.toDataURL('image/png')`)
を渡す。

Blob URL を渡す方式は採用しない。Blob URL は生成元のオリジン
(`https://www.zan-live.com`) に紐づいており、拡張の service worker はそのオリジンの
blob ストレージにアクセスできないため、`chrome.downloads.download` が `Invalid URL`
で失敗する。MV3 の service worker では `URL.createObjectURL` も使えないため、
service worker 側で Blob を作り直すこともできない。

data URL は base64 で元データの約 1.33 倍になる (1920x1080 の PNG で概ね 3〜7MB) が、
`chrome.runtime.sendMessage` のペイロード上限には十分収まり、ローカル処理のため
連写しても実用上の遅延にならない。

保存完了は `chrome.downloads.download` のコールバックで確認し、`downloadId` が
`undefined` の場合は `chrome.runtime.lastError` を伴うエラーとして扱う。
成否は content script に返し、トーストに反映する。

### 6.2 コマ送り

トリガー: `←` / `→` (一時停止中のみ) または UI のコマ送りボタン。

```
← / →
  → video.paused でなければ何もしない (z-an の 10 秒送りに委ねる)
  → e.preventDefault() + e.stopPropagation()   ← z-an のハンドラより先に奪う
  → video.currentTime ±= 1 / fps
  → requestVideoFrameCallback で新フレームの描画完了を待つ
  → 完了 (この待機中に来たキー入力は無視して多重シークを防ぐ)
```

キーイベントは `document` に **capture フェーズ**で登録し、z-an 側のハンドラより先に
受け取る。

#### fps の決定

再生中に `requestVideoFrameCallback` を数フレーム分回し、コールバック引数の
`presentedFrames` と `mediaTime` の差分から実 fps を算出する:

```
fps = (presentedFrames_end - presentedFrames_start)
    / (mediaTime_end - mediaTime_start)
```

得られた値は最も近い一般的な fps (23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60) に
スナップする。測定は動画ごとに一度だけ行い、キャッシュする。

測定できなかった場合は 30fps にフォールバックするが、**その旨をコンソールに明示的に
警告する**。黙って 30 と決め打ちして「コマ送りの粒度がおかしい」という不可解な挙動に
させない。

#### 精度に関する既知の制約

MSE + シークのため、`currentTime` に代入した値と実際に表示されるフレームが厳密に
一致しない場合がある (特に後方シーク)。1 フレーム単位の厳密性より「UI で見ながら
狙ったコマに寄せられること」を優先する。ズレが実用上問題になった場合は、
`requestVideoFrameCallback` が返す `mediaTime` を次回シークの基準に使う方式へ変更する。

### 6.3 一時停止中の UI

既存の `.control-list.absolute-center` は 588x82 に 3 ボタンが並んでおり、ここに
さらに 3 つ足すと窮屈になる。**既存の行には手を触れず、その下に独自の行を追加する。**

```
      ┌──────────────────────────────────┐
      │      ⟲10s    ▶❙❙    10s⟳         │  ← 既存 (無改変)
      │                                   │
      │      ◀❙      📷      ❙▶           │  ← 追加 (.zss-bar)
      │     1コマ戻  撮影   1コマ送        │
      └──────────────────────────────────┘
```

- 挿入先は **`#player-con` の直下**。フルスクリーン対象要素そのものなので、
  フルスクリーン時もそのまま表示される (フルスクリーン要素のサブツリー内にあるため)
- **`.cover-controls` の中には入れない。** 当初はそこに入れたが、クリックが一切
  ボタンに届かず一時停止が解除されるだけになった。原因は 2 つある:
  1. `.boxLayer` が `z-index: 999999` でプレイヤー全面を覆っており、`z-index: auto` の
     `.cover-controls` 配下に置いたボタンはその下に隠れる。クリックは `.boxLayer` に吸われる
  2. `.cover-controls` 自身がクリックで再生/一時停止を切り替えるため、その子孫に置くと
     ボタン操作のたびに再生が再開する
- したがってバーは `z-index: 1000000` (`.boxLayer` の 999999 より上) を持たせ、
  `#player-con` 直下に置く
- バー上のポインタ系イベント (`pointerdown` / `mousedown` / `pointerup` / `mouseup` /
  `click` / `dblclick`) は capture フェーズで捕まえ、`stopPropagation` と
  `stopImmediatePropagation` で確実に止める。`click` だけを止めても、z-an 側が
  `pointerdown` 段階で再生/停止を処理していると間に合わないため
- 追加する要素・クラスは全て `zss-` プレフィックスを付ける
- 既存 DOM への操作は **append のみ**。既存要素の属性・スタイル・クラスは書き換えない
- ボタンバーの表示/非表示は **`video.paused` に連動**させる (`play` / `pause` イベントを
  購読)。z-an 側の `paused` クラスは監視しない。状態判定の根拠を video 要素に一本化し、
  DOM クラスの命名変更に影響されないようにするため
- MutationObserver は `.cover-controls` 要素そのものの生成・差し替えを検知して
  **ボタンを挿し直す**ためだけに使う (状態判定には使わない)
- スタイルは content script から `<style>` を注入する (CSS ファイルを manifest で
  読み込むと z-an 側のスタイルと衝突しやすいため、`.zss-` 配下に限定したセレクタで書く)
- ボタンには `title` 属性でホットキーを併記する (例: 「1 コマ送る (→)」)
- アイコンは**インライン SVG** で描く。絵文字 (📷 など) はフォント依存でサイズと
  ベースラインが環境ごとにずれ、既存ボタンと並べたときに揃わないため使わない
- ボタンサイズは既存の `.time-back` (71x71) に合わせ、フルスクリーン時のスケールにも
  追従するよう固定 px ではなく既存ボタンの実寸を基準にする

### 6.4 トースト

撮影の成否を画面右下に 2 秒表示する。

- 成功: 「保存しました: <ファイル名>」
- 失敗: 赤背景でエラー内容を表示

トーストは `#player-con` 配下に置き、フルスクリーン時も見えるようにする。
**撮影した画像には写り込まない** (canvas は video から直接取得するため)。

### 6.5 オプションページ

`chrome.storage.sync` に保存する設定:

| キー | 既定値 | 説明 |
|---|---|---|
| `captureKey` | `Shift+S` | 撮影ホットキー |
| `stepForwardKey` | `ArrowRight` | コマ送り |
| `stepBackKey` | `ArrowLeft` | コマ戻し |
| `downloadSubdir` | `z-an` | ダウンロード先サブフォルダ |
| `showButtons` | `true` | 一時停止 UI にボタンを追加するか |

ホットキーは入力欄にフォーカスして実際にキーを押すと記録される方式にする
(文字列を手で打たせない)。設定変更は content script に即時反映する
(`chrome.storage.onChanged` を購読)。

#### ホットキーの内部表現

保存形式は文字列ではなくオブジェクトとする。文字列だと表記ゆれ (`"Shift+S"` /
`"shift+s"` / `"S+Shift"`) のパースが必要になり、判定が曖昧になるため:

```js
{ code: 'KeyS', shift: true, ctrl: false, alt: false, meta: false }
```

- キーの識別には `KeyboardEvent.code` を使う (`key` はキーボードレイアウトと
  修飾キーの影響を受ける。`Shift+S` を押すと `key` は `'S'`、`code` は常に `'KeyS'`)
- 一致判定は 5 つのフィールドの完全一致とする。修飾キーが余分に押されている場合は
  一致とみなさない (`Ctrl+Shift+S` は `Shift+S` として発火しない)
- 表示用の文字列 (`Shift+S`) はこのオブジェクトから生成する。逆変換は行わない
- 表示文字列を組み立てる関数は `shared/format.js` に置き、テスト対象に含める

### 6.6 起動条件

content script は `www.zan-live.com` の**全ページ**に注入されるが、
**再生ページ以外では何もせずに終了する**。

```js
location.pathname に /live/play/ を含むか
  → 含まない: 即座に return (キーリスナーも張らず、ログも出さない)
  → 含む:     通常どおり起動し、セレクタ検証を行う
```

この判定を URL で行うのは、**「再生ページなのに要素が無い」= z-an の DOM 構造が
変わった、という Fail Fast を成立させるため**である。DOM の有無 (`#player-con` が
あるか) で判定してしまうと、トップページと「構造が変わって要素が消えた再生ページ」を
区別できず、セレクタ検証の警告が意味を失う。

再生ページ以外で早期 return する理由:

- トップページや番組一覧でセレクタ検証の警告が出るのはノイズでしかない
  (プレイヤーが無いのは当然であり、異常の兆候ではない)
- 再生と無関係なページでキー入力を監視する必要がない

`matches` を `/*/live/play/*` のような URL パターンで絞る方式は採らない。z-an が
URL 構造を変えた場合に content script が注入されなくなり、**何も起きない**という
最も気付きにくい壊れ方をするため。全ページに注入したうえで自分で判定すれば、
判定条件が古くなったことをコード上で追える。

## 7. エラーハンドリング方針

**Fail Fast。silent skip をしない。**

| 事象 | 対応 |
|---|---|
| video が見つからない | コンソールに明示的なエラーを出し、トーストで通知。キー操作は無視 |
| `videoWidth` が 0 (未ロード) | 「動画がまだ読み込まれていません」とトースト表示 |
| canvas が tainted (CORS) | 例外を握りつぶさず、原因を明示してトースト表示 (仕様変更の検知になる) |
| `toBlob` が null を返す | エラーとして扱いトースト表示 |
| ダウンロード失敗 | `chrome.runtime.lastError` の内容をトーストに出す |
| fps 測定失敗 | 30fps にフォールバックし**警告をコンソールに出す** |
| セレクタが見つからない (z-an の DOM 変更) | **再生ページでのみ**起動時に検証し、欠けていればコンソールに具体的なセレクタ名付きで警告。再生ページ以外では検証も警告もしない |

## 8. ファイル構成

```
manifest.json
src/
  content/
    player.js      z-an DOM アダプタ (セレクタ集約)
    stepper.js     コマ送り + fps 実測
    capture.js     canvas 撮影
    ui.js          ボタン挿入 / トースト / スタイル注入
    index.js       キー待受・配線 (manifest の js 配列で最後に読み込む)
  background/
    index.js       chrome.downloads
  options/
    options.html
    options.js
  shared/
    format.js      タイムコード整形・ファイル名生成 (純粋関数、テスト対象)
    defaults.js    既定設定値
test/
  format.test.js   node:test
docs/
  README.md        インストール手順と使い方
```

`manifest.json` の content_scripts:

```json
{
  "matches": ["https://www.zan-live.com/*"],
  "js": [
    "src/shared/defaults.js",
    "src/shared/format.js",
    "src/content/player.js",
    "src/content/capture.js",
    "src/content/stepper.js",
    "src/content/ui.js",
    "src/content/index.js"
  ],
  "run_at": "document_idle",
  "all_frames": false
}
```

権限は `downloads` と `storage` のみ。`host_permissions` は content_scripts の
`matches` で足りるため指定しない。

`src/shared/format.js` は UMD 風に書き、ブラウザからは `globalThis.ZSS.format`、
Node のテストからは `require` で読めるようにする:

```js
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ZSS = root.ZSS || {}).format = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /* ... */
});
```

## 9. テスト方針

Chrome 拡張の E2E 自動テストは労力に見合わないため、以下の 2 層で担保する。

### 自動テスト (node:test、依存パッケージなし)

`src/shared/format.js` の純粋関数を対象にする:

- `formatTimecode(seconds)` — `0` → `00-00-00.000`、`11603.693` → `03-13-23.693`、
  小数点以下の丸め、負値・NaN・Infinity の扱い
- `buildFilename(title, seconds, subdir)` — 禁止文字の除去、空タイトルのフォールバック、
  120 文字超過時の切り詰め、拡張子の付与
- `snapFps(measured)` — `29.7` → `29.97`、`59.9` → `59.94`、範囲外の値の扱い

実行: `node --test test/`

### 手動テスト手順 (README に記載)

1. 再生中に `Shift+S` → `~/Downloads/z-an/` に 1920x1080 の PNG が保存される
2. 保存された PNG に UI が写り込んでいない
3. 一時停止 → 追加ボタン (◀❙ 📷 ❙▶) が表示される
4. `→` / `←` で 1 フレームずつ動く (`.current-time` の表示と映像の変化で確認)
5. 再生中に `←` を押すと z-an 本来の 10 秒戻しが働く (奪わない)
6. フルスクリーンにして 1〜5 が全て動作する
7. オプションでホットキーを変更 → ページをリロードせずに反映される
8. 連写 (`Shift+S` を素早く 5 回) してもファイル名が衝突しない

## 10. 受け入れ条件

- [ ] 再生中・一時停止中のどちらでもホットキーで撮影でき、1920x1080 の PNG が保存される
- [ ] 保存された画像に一時停止 UI・コントロールバー・広告表示が写り込まない
- [ ] 一時停止中に `←` / `→` で 1 フレーム単位のコマ送りができる
- [ ] 再生中の `←` / `→` は z-an 本来の動作を妨げない
- [ ] 一時停止中に既存 UI を壊さずコマ送り・撮影ボタンが追加表示される
- [ ] フルスクリーン再生中に全機能が動作する
- [ ] ホットキーをオプションページで変更でき、即座に反映される
- [ ] ファイル名が `<タイトル>_<HH-MM-SS.mmm>.png` 形式で、連写しても衝突しない
- [ ] オプションでボタン表示を OFF にすると、一時停止 UI が z-an 本来の状態に戻る
- [ ] z-an 以外のサイトでは一切動作しない (キー入力を奪わない)
- [ ] エラー時に silent に失敗せず、トーストとコンソールで原因が分かる
- [ ] `node --test test/` が通る
- [ ] npm install なしで「パッケージ化されていない拡張機能を読み込む」から即動作する
