#!/usr/bin/env bash
# 配布用 ZIP を作る。
# 拡張の動作に必要なファイルだけを入れ、開発用のもの (.claude/ test/ scripts/
# .github/) は含めない。Chrome は ZIP の中身をそのまま拡張として読み込むため、
# 余計なファイルがあるとユーザーの手元に不要なものが展開される。
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT_DIR="dist"
OUT="${OUT_DIR}/z-an-screenshot-${VERSION}.zip"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# LICENSE は MIT がライセンス文の同梱を求めているため配布物に含める
zip -r -q "$OUT" \
  manifest.json \
  src \
  README.md \
  LICENSE \
  -x '*.DS_Store'

echo "$OUT"
unzip -l "$OUT"
