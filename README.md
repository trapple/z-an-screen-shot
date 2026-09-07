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

再生中の `←` / `→` は奪わないので、z-an 本来の 10 秒送り / 戻しはそのまま使える。

## インストール

Chrome ウェブストアには登録していないため、ZIP をダウンロードして手動で読み込む。

### 1. ダウンロード

[Releases](https://github.com/trapple/z-an-screen-shot/releases) から最新の
`z-an-screenshot-x.y.z.zip` をダウンロードする。

### 2. 解凍して、置き場所を決める

> [!IMPORTANT]
> **解凍したフォルダは、消したり移動したりしないこと。**
> Chrome は拡張の中身をコピーせず、このフォルダを参照し続ける。消すと拡張も動かなくなる。

ダウンロードフォルダは整理のときに消しやすいので、`書類` など普段触らない場所に
置いておくとよい。

### 3. Chrome に読み込む

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 左上に出る「パッケージ化されていない拡張機能を読み込む」を押す
4. 解凍したフォルダ (`manifest.json` が直接入っているフォルダ) を選ぶ

z-an の再生ページを開けば使える。

### 更新するには

**自動更新はされない。** 新しいバージョンが出たら:

1. 新しい ZIP をダウンロードして解凍する
2. 手順 2 で決めた場所のフォルダを、新しいものに置き換える
3. `chrome://extensions` で、この拡張の再読み込みボタン (⟳) を押す

### 困ったときは

**Chrome を起動するたびに「デベロッパー モードの拡張機能を無効にする」と警告が出る**

ウェブストア以外から入れた拡張に対する Chrome の仕様。閉じれば拡張はそのまま動く。

**拡張が急に消えた / 動かなくなった**

解凍したフォルダを消したか移動した可能性が高い。手順 1 からやり直す。

**再生ページで何も起こらない**

対応しているのは URL に `/live/play/` を含む再生ページだけ。トップページや
番組一覧では動作しない (意図した仕様)。

## 対応サイト

`https://www.zan-live.com/*` のみ。他のサイトでは一切動作しない。

さらに、z-an の中でも **再生ページ (`/live/play/` を含む URL) 以外では何もしない**。
トップページや番組一覧ではキー入力の監視すら行わない。

## 開発

ビルドは不要。

```bash
git clone git@github.com:trapple/z-an-screen-shot.git
```

クローンしたディレクトリをそのまま「パッケージ化されていない拡張機能を読み込む」で
選べば動く。コードを変更したら `chrome://extensions` で拡張を再読み込みし、
z-an のページもリロードする。

### リリース

`manifest.json` の `version` を上げてからタグを push すると、GitHub Actions が
配布用 ZIP を作って Release に添付する。

```bash
git tag v0.2.0
git push origin v0.2.0
```

タグと `manifest.json` の `version` が食い違っているとワークフローが失敗する
(ユーザーの手元の拡張のバージョン表示と Release がずれると、更新すべきか
判断できなくなるため)。

ZIP をローカルで作るだけなら:

```bash
./scripts/build-zip.sh
```

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

設計の背景と判断の記録は
`.claude/specs/2026-09-07-z-an-screenshot-extension-design.md` にある。

### 実装上の注意

- **ボタンバーは `#player-con` 直下に置き、`z-index: 1000000` を与えている。**
  `.cover-controls` の中に入れると、`.boxLayer` (z-index 999999) の下に隠れて
  クリックが届かず、かつ `.cover-controls` 自身のクリックで再生が再開してしまう
- **ポインタ系イベントは capture フェーズで `stopImmediatePropagation` まで行う。**
  z-an は `pointerdown` 段階で再生/停止を処理するため、`click` だけを止めても
  間に合わない
- content script は **isolated world** で動くため、DevTools の Console から
  `ZSS` を直接叩くと `ReferenceError` になる。Console 上部の実行コンテキストを
  `z-an Screenshot` に切り替える必要がある
- 再生ページでは `JSON.parse` が 16382 バイト目で失敗する `SyntaxError` が
  Console に出るが、これは z-an 側の問題であり本拡張とは無関係。動画の再生にも
  影響しない
