// 使い方:
//   node 作り方一式/tools/check-headers.js index.html 作り方一式/仕様書.md sample/明細_見本_A社.csv
//   node 作り方一式/tools/check-headers.js index-mysoft.html - sample/mysoft見本.csv
// 引数: HTMLファイル、仕様書(使わないときは - )、見本のCSV(必ず渡す)、[見本と比べる定数の名前。省くと HDR_LINES]
// 仕様書を渡したときは、HTML の HDR_LINES・HDR_CUS・HDR_ITEM が、仕様書4.2〜4.4の行と1文字も違わないかを確かめます。
// 見本のCSVを渡したときは、その1行目と、定数が1文字も違わないかを確かめます。
// 見本が見つからないときは、飛ばさずに失敗にします。飛ばし(skipped)は、いつも0件です。
// 定数は、文字で探さず、その文だけを vm で動かして取り出します(空白・改行・引用符の書き方が違っても見つかります)。
const fs = require("node:fs");
const vm = require("node:vm");

const [htmlPath, specPath, samplePath, sampleConst = "HDR_LINES"] = process.argv.slice(2);
if (!htmlPath || !specPath || !samplePath) {
  console.log("使い方: node 作り方一式/tools/check-headers.js HTML 仕様書(使わないなら -) 見本のCSV [定数の名前]");
  process.exit(2);
}

// html の中から「const 名前 = [ … ];」の文を取り出して、vm で動かし、文字列の配列を返す
function extract(html, name) {
  const m = new RegExp("(?:const|let|var)\\s+" + name + "\\s*=\\s*\\[").exec(html);
  if (!m) return { error: "HTML に見つかりません" };
  let i = m.index + m[0].length - 1, depth = 0, q = null;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") q = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return { error: "配列が閉じていません" };
  const stmt = html.slice(m.index, i + 1);
  try {
    const arr = vm.runInNewContext("(()=>{" + stmt + ";return " + name + ";})()", Object.create(null), { timeout: 1000 });
    if (!Array.isArray(arr) || !arr.every(x => typeof x === "string")) return { error: "文字列の並びではありません" };
    return { arr };
  } catch (e) {
    return { error: "固定の文字列の並びではありません(部品をつなげて作っていませんか): " + e.message };
  }
}

let bad = 0, checked = 0;
const skipped = 0; // 飛ばしは作らない。条件が足りないときは失敗にする
const fail = msg => { console.log("失敗: " + msg); bad++; };

if (!fs.existsSync(htmlPath)) fail("HTMLが見つかりません: " + htmlPath);
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";

if (specPath !== "-") {
  if (!fs.existsSync(specPath)) fail("仕様書が見つかりません: " + specPath);
  else {
    const spec = fs.readFileSync(specPath, "utf8").split(/\r?\n/);
    for (const k of ["HDR_LINES", "HDR_CUS", "HDR_ITEM"]) {
      const r = extract(html, k);
      if (r.error) { fail(k + ": " + r.error); continue; }
      checked++;
      const ok = spec.includes(r.arr.join(","));
      console.log(k + ": " + (ok ? "仕様書の行と同じ" : "違います"));
      if (!ok) bad++;
    }
  }
}

if (!fs.existsSync(samplePath)) {
  fail("見本のCSVが見つかりません: " + samplePath + "(見本が無いときは、比べを飛ばさず失敗にします)");
} else {
  let text = null;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(samplePath)); } catch (e) { /* 下で失敗にする */ }
  if (text === null) fail("見本のCSVが UTF-8 として読めません。tools/read-sample-header.js で確かめてください");
  else {
    const first = text.replace(/^﻿/, "").split(/\r\n|\r|\n/)[0];
    const r = extract(html, sampleConst);
    if (r.error) fail(sampleConst + ": " + r.error);
    else {
      checked++;
      const joined = r.arr.join(",");
      const ok = first === joined && !r.arr.some(v => /["\r\n,]/.test(v));
      console.log(sampleConst + " と見本CSVの1行目: " + (ok ? "同じ" : "違います"));
      if (!ok) {
        bad++;
        let n = 0;
        while (n < joined.length && n < first.length && joined[n] === first[n]) n++;
        console.log("  最初に違う位置: " + (n + 1) + " 文字目(自分「" + (joined[n] ?? "(なし)") + "」/ 見本「" + (first[n] ?? "(なし)") + "」)");
      }
    }
  }
}

console.log("確かめた数: " + checked + " / 飛ばし(skipped): " + skipped + "件");
console.log(bad ? "失敗があります(" + bad + "件)" : "すべて同じです");
process.exit(bad ? 1 : 0);
