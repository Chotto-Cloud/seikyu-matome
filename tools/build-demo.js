// 公開用の docs/ を作る。docs/ には、デモ版の index.html と、_headers の写しの2つだけを置く(ほかは置かない)。
// デモ版は、index.html の `const DEMO=false;` を `const DEMO=true;` に置き換えたもの(ちょうど1回でなければ失敗して止まる)。
// 実用版(index.html)やメモ、テストは docs/ に入らないので、公開するのは docs/ だけにする。
// 実行: node tools/build-demo.js
const fs = require("node:fs");
const path = require("node:path");

const FROM = "const DEMO=false;", TO = "const DEMO=true;";

function buildDemo(html) {
  const n = html.split(FROM).length - 1;
  if (n !== 1) throw new Error("「" + FROM + "」が" + n + "か所あります(1か所のはずです)。デモ版を作れません");
  return html.replace(FROM, () => TO);
}

module.exports = { buildDemo };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const docs = path.join(root, "docs");
  const demo = buildDemo(fs.readFileSync(path.join(root, "index.html"), "utf8"));
  const headers = fs.readFileSync(path.join(root, "_headers"));
  fs.rmSync(docs, { recursive: true, force: true });
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, "index.html"), demo);
  fs.writeFileSync(path.join(docs, "_headers"), headers);
  console.log("作りました: " + docs + "(index.html と _headers だけ)");
}
