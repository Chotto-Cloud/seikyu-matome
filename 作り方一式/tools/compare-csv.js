// 使い方: node 作り方一式/tools/compare-csv.js 自分で保存したCSV 見本のCSV [--lines=4] [--allow=13,14]
//  --lines: 先頭からこの行数だけを比べる(見出しの1行を含む)
//  --allow: 違ってよい列の番号(1から数える)
// どちらかのファイルが見つからないときは、失敗にします。
const fs = require("node:fs");
const args = process.argv.slice(2);
const [a, b] = args.filter(x => !x.startsWith("--"));
const linesArg = args.find(x => x.startsWith("--lines="));
const allowArg = args.find(x => x.startsWith("--allow="));
const allow = new Set(allowArg ? allowArg.slice(8).split(",").map(Number) : []);
if (!a || !b) { console.log("使い方: node 作り方一式/tools/compare-csv.js 自分のCSV 見本のCSV [--lines=4] [--allow=13,14]"); process.exit(2); }
for (const f of [a, b]) if (!fs.existsSync(f)) { console.log("失敗: ファイルが見つかりません: " + f); process.exit(1); }
const take = t => linesArg ? t.split("\r\n").slice(0, Number(linesArg.slice(8))).join("\r\n") + "\r\n" : t;
const mine = take(fs.readFileSync(a, "utf8")), sample = take(fs.readFileSync(b, "utf8"));
if (mine === sample) { console.log("1文字も違いません(同じです)"); process.exit(0); }
console.log("文字が違います。");
console.log("バイト数: 自分 " + Buffer.byteLength(mine) + " / 見本 " + Buffer.byteLength(sample));
console.log("BOM(先頭の目印): 自分 " + mine.startsWith("﻿") + " / 見本 " + sample.startsWith("﻿"));
console.log("改行がCRLF: 自分 " + mine.includes("\r\n") + " / 見本 " + sample.includes("\r\n"));
const rows = t => t.split(/\r?\n/).map(l => {
  const r = []; let c = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { r.push(c); c = ""; } else c += ch;
  }
  r.push(c); return r;
});
const A = rows(mine), B = rows(sample);
let bad = 0;
for (let i = 0; i < Math.max(A.length, B.length); i++) {
  const x = A[i] || [], y = B[i] || [];
  if (x.length !== y.length) { console.log((i + 1) + "行目: 列の数が違います(自分 " + x.length + " / 見本 " + y.length + ")"); bad++; }
  for (let j = 0; j < Math.max(x.length, y.length); j++) {
    if (x[j] !== y[j]) {
      const ok = allow.has(j + 1);
      console.log((i + 1) + "行目 " + (j + 1) + "列目: 自分「" + (x[j] ?? "(なし)") + "」/ 見本「" + (y[j] ?? "(なし)") + "」" + (ok ? "(許した違い)" : ""));
      if (!ok) bad++;
    }
  }
}
console.log(bad ? "許していない違いが " + bad + " 件あります" : "違いは、許した列だけです");
process.exit(bad ? 1 : 0);
