// 見本の CSV の1行目を、そのまま読む道具
// 使い方: node 作り方一式/tools/read-sample-header.js 見本のCSV [定数の名前]
//   定数の名前を省くと HDR_LINES になります
// 見本は、開かずに(Excel などで開いて保存し直さずに)渡してください。
// 出力のうち、「const …」の行を、そのまま index-mysoft.html に写します。
// 部品をつなげて見出しを作ってはいけません(1文字でも違うと、取りこみで断られます)。
const fs = require("node:fs");

const [file, name = "HDR_LINES"] = process.argv.slice(2);
if (!file) {
  console.log("使い方: node 作り方一式/tools/read-sample-header.js 見本のCSV [定数の名前]");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.log("見本のファイルが見つかりません: " + file);
  process.exit(1);
}
const buf = fs.readFileSync(file);

// 1. BOM(先頭の目印)
let bom = "なし", skip = 0;
if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { bom = "あり(UTF-8)"; skip = 3; }
else if (buf[0] === 0xff && buf[1] === 0xfe) { bom = "あり(UTF-16 LE)"; skip = 2; }
else if (buf[0] === 0xfe && buf[1] === 0xff) { bom = "あり(UTF-16 BE)"; skip = 2; }

// 2. 文字コード
let enc = "UTF-8", text, note = "";
if (bom.includes("UTF-16")) {
  enc = "UTF-16";
  text = new TextDecoder(bom.includes("LE") ? "utf-16le" : "utf-16be").decode(buf.subarray(skip));
  note = "UTF-16 です。このアプリはブラウザで UTF-8 の CSV を作ります。変換が必要です。AI に相談してください。";
} else {
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(skip));
  } catch (e) {
    enc = "UTF-8 ではありません(Shift-JIS の可能性)";
    try { text = new TextDecoder("shift_jis").decode(buf.subarray(skip)); } catch (e2) { text = buf.subarray(skip).toString("latin1"); }
    note = "UTF-8 として読めませんでした。Shift-JIS の可能性があります。ブラウザだけでは作りにくいので、AI に相談してください。以下は Shift-JIS として読んだ結果です。";
  }
}

// 3. 改行(ファイル全体を数える)
const crlf = (text.match(/\r\n/g) || []).length;
const lf = (text.match(/(?<!\r)\n/g) || []).length;
const cr = (text.match(/\r(?!\n)/g) || []).length;
let eol = "改行なし";
if (crlf && !lf && !cr) eol = "CRLF";
else if (lf && !crlf && !cr) eol = "LF";
else if (cr && !crlf && !lf) eol = "CR";
else if (crlf || lf || cr) eol = "まざっています(CRLF " + crlf + " / LF " + lf + " / CR " + cr + ")";
const endsNl = /[\r\n]$/.test(text);

// 4. 1行目を、引用符を守って列に分ける
const row = [];
{
  let c = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { c += '"'; i++; }
      else if (ch === '"') q = false;
      else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(c); c = ""; }
    else if (ch === "\r" || ch === "\n") break;
    else c += ch;
  }
  row.push(c);
}

console.log("ファイル: " + file + " (" + buf.length + " バイト)");
console.log("BOM(先頭の目印): " + bom);
console.log("文字コード: " + enc);
console.log("改行: " + eol + " / 最後の行のあとの改行: " + (endsNl ? "あり" : "なし"));
console.log("列の数: " + row.length);
if (note) console.log("注意: " + note);
const odd = row.map((v, i) => [i + 1, v]).filter(([, v]) => v !== v.trim() || /　/.test(v) || v === "");
if (odd.length) console.log("注意: 空・前後に空白・全角の空白がある列があります: " + odd.map(([n]) => n + "列目").join("、") + "(そのまま写します。直さないでください)");
console.log("");
console.log("次の行を、そのまま index-mysoft.html に貼ってください(直さない・並べ替えない・つなげない):");
console.log("");
console.log("const " + name + "=[" + row.map(v => JSON.stringify(v)).join(",") + "];");
