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
