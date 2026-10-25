// 請求まとめ(試作品)の自動テスト。index.html の中のスクリプトを、見かけだけの画面部品で動かして確かめる。
// 実行: node --test tests/app.test.js      (Node 20 以上。フォルダーではなくファイルを渡す)
// 実用版(index.html)と、デモ版(docs/index.html。node tools/build-demo.js で作る)の両方に、同じテストを走らせる。
// 日付の確かめが、動かすPCの地域設定に左右されないよう、日本時間に固定する。
// 環境変数 APP_HTML で、調べる HTML を1つだけに差し替えられる(わざと壊した版で落ちるかの確認用)。
process.env.TZ = "Asia/Tokyo";
const baseTest = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BUILDS = process.env.APP_HTML
  ? [["[指定]", process.env.APP_HTML]]
  : [["[実用版]", path.join(__dirname, "..", "index.html")], ["[デモ版]", path.join(__dirname, "..", "docs", "index.html")]];

// 以下は1つの版ぶんのテスト一式(中身は字下げせずに、そのまま並べている)
function defineSuite(LABEL, HTML) {
const test = (name, fn, opt = {}) => baseTest(LABEL + " " + name, opt, fn);
assert.ok(fs.existsSync(HTML), HTML + " がありません(デモ版は node tools/build-demo.js で作ります)");
const html = fs.readFileSync(HTML, "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length >= 1, "index.html に <script> がありません");
const SOURCE = scripts[scripts.length - 1][1];
const DEMO = /const DEMO=true;/.test(SOURCE);
const SK = DEMO ? "seikyu-matome-demo-v1" : "seikyu-matome-v1", CK = DEMO ? "seikyu-matome-demo-settings-v1" : "seikyu-matome-settings-v1";
const BANK = "架空銀行 サンプル支店 普通 0000000";

// ---- 見かけだけの画面部品 ----
function fake(tag = "div") {
  const t = {
    tagName: tag, value: "", checked: false, disabled: false, textContent: "", className: "", innerHTML: "",
    style: {}, dataset: {}, children: [], files: [], _ev: {}, _a: {},
    // addEventListener で付けた処理を覚えておき、fire で動かせる。append / replaceChildren で入れた子も覚える
    addEventListener(type, f) { (t._ev[type] ??= []).push(f); },
    append(...c) { t.children.push(...c); },
    replaceChildren(...c) { t.children = c; },
    setAttribute(k, v) { t._a[k] = v; }, removeAttribute(k) { delete t._a[k]; }, click() {}, select() {}, open: false, showModal() { t.open = true; }, close() { t.open = false; },
    querySelector() { return fake(); }, querySelectorAll() { return []; }
  };
  return new Proxy(t, { get(o, k) { return k in o ? o[k] : (typeof k === "string" ? () => fake() : undefined); }, set(o, k, v) { o[k] = v; return true; } });
}
// 子をたどって、条件に合う部品を集める(表の中の入力欄やボタンを探すため)
function findAll(el, pred, out = []) {
  for (const c of el.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}
const textOf = el => (el.textContent || "") + (el.children || []).map(textOf).join("");
// storage: 保存してある中身を最初から入れておく。now: 「いまの時刻」を固定する(この PC の地域設定での時刻のミリ秒)。省略すると本物の時計
function makeApp({ now = null, storage: pre = null } = {}) {
  const els = {};
  const storage = pre ? { ...pre } : {}; // pre: 前の画面が保存した中身を引き継ぐ(開き直しのまね)
  const handlers = {};
  const confirms = []; let answer = true; // confirm に出た文と、返す答え
  let failing = false; // true の間、保存に失敗する
  const ctx = vm.createContext({
    window: { addEventListener: (t, f) => { (handlers[t] ??= []).push(f); } },
    document: { documentElement: fake("html"), getElementById: id => (els[id] ??= fake()), createElement: tag => fake(tag), querySelectorAll: () => [] },
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { if (failing) throw new Error("quota"); storage[k] = String(v); } },
    confirm: m => { confirms.push(m); return answer; }, prompt: () => null, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} }, Blob: class {},
    console
  });
  if (now != null) vm.runInContext("(()=>{const D=Date,N=" + now + ";globalThis.Date=class extends D{constructor(...a){if(a.length)super(...a);else super(N)}static now(){return N}}})()", ctx);
  vm.runInContext(SOURCE, ctx);
  return {
    els, storage, handlers, confirms, root: () => vm.runInContext("document.documentElement", ctx), answer: v => { answer = v; }, failStorage: v => { failing = v; },
    run: code => vm.runInContext(code, ctx),
    // 画面の部品に、本物のブラウザと同じように出来事(submit / change / input / click)を起こす
    fire(id, type, extra = {}) {
      const el = els[id], ev = { type, target: el, preventDefault() {}, ...extra };
      for (const f of el._ev[type] || []) f(ev);
      if (Object.prototype.hasOwnProperty.call(el, "on" + type) && typeof el["on" + type] === "function") return el["on" + type](ev);
    },
    // 状態を作る: rows と設定、画面の値
    setup({ rows = [], clients = {}, prices = {}, bank = "架空銀行 サンプル支店 普通 0000000", month = "2026-10", withPlan = false }) {
      vm.runInContext(`rows=${JSON.stringify(rows)}; cfg.clients=${JSON.stringify(clients)}; cfg.prices=${JSON.stringify(prices)}; cfg.priceHist={}; cfg.bank=${JSON.stringify(bank)};`, ctx);
      els["month"].value = month; els["withPlan"].checked = withPlan;
      vm.runInContext("setDates(); render();", ctx);
    }
  };
}
// 取引先の連絡先などが空のときの形
const BLANKC = { regNo: "", dept: "", person: "", mail: "", zip: "", addr: "", bldg: "", tel: "", fax: "" };
const R = (date, client, service, hours, kind = "act") => ({ id: Math.random(), date, client, service, hours, kind });
const A = { code: "A001", hon: "御中", reg: false }, B = { code: "A002", hon: "御中", reg: false };
const PRICES = { "作業サービス": 3000, "相談サービス": 4000 };
const demoRows = () => [
  R("2026-10-03", "A社", "作業サービス", 1.5), R("2026-10-10", "A社", "作業サービス", 2), R("2026-10-17", "A社", "相談サービス", 1),
  R("2026-10-05", "B社", "作業サービス", 1), R("2026-10-12", "B社", "作業サービス", 1.5, "plan")
];
// CSV の1行を列に分ける(引用符に対応)
function parseCsvLine(l) {
  const r = []; let c = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { r.push(c); c = ""; } else c += ch;
  }
  r.push(c); return r;
}

// ---- 明細CSV ----
const LINE_HDR = ["請求書番号", "発行日", "支払期限", "取引先コード", "取引先", "敬称", "件名", "振込先", "日付", "サービス", "数量", "単位", "開始", "終了", "単価", "金額(単価×数量・目安)", "税区分", "源泉徴収", "消費税の表示", "端数処理", "種類(予定/実績)"];
test("明細CSV: 見本のファイル(sample/明細_見本_A社.csv。デモ版のダミーで作った物)と、1文字も違わない", () => {
  const app = makeApp();
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": A }, prices: PRICES });
  let expected = fs.readFileSync(path.join(__dirname, "..", "sample", "明細_見本_A社.csv"), "utf8");
  assert.ok(expected.startsWith("﻿"));
  // 実用版は、件名の先頭の「【デモ】」と、デモ版の取引先コード DEMO1 だけが違う。それ以外は1文字も違わない
  if (!DEMO) expected = expected.replaceAll("【デモ】", "").replaceAll("DEMO1", "A001");
  assert.equal(app.run("invoiceCsv()"), expected);
});
test("明細CSV: 1行目は決まった列名と同じ(21列)", () => {
  const app = makeApp();
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": A }, prices: PRICES });
  const first = app.run("invoiceCsv()").split("\r\n")[0];
  assert.equal(first, "﻿" + LINE_HDR.join(","));
  assert.deepEqual(parseCsvLine(first.slice(1)), LINE_HDR);
});
test("明細CSV: 1記録=1行。予定は入らない。「予定も含める」で入る", () => {
  const app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": A, "B社": B }, prices: PRICES });
  let lines = app.run("invoiceCsv()").split("\r\n");
  assert.equal(lines.length, 6, "見出し+A社3行+B社1行+末尾の改行");
  const b = parseCsvLine(lines[4]);
  assert.equal(b[4], "B社"); assert.equal(b[8], "2026-10-05"); assert.equal(b[20], "実績");
  app.setup({ rows: demoRows(), clients: { "A社": A, "B社": B }, prices: PRICES, withPlan: true });
  lines = app.run("invoiceCsv()").split("\r\n");
  assert.equal(lines.length, 7);
  const p = parseCsvLine(lines[5]);
  assert.equal(p[8], "2026-10-12"); assert.equal(p[20], "予定");
});
test("明細CSV: 請求書番号は 年月-取引先コード、日付は月末と翌月末。行は請求書ごと・日付の順", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-17", "A社", "相談サービス", 1), R("2026-10-03", "A社", "作業サービス", 1.5)], clients: { "A社": A }, prices: PRICES });
  const L = app.run("invoiceCsv()").split("\r\n");
  const c = parseCsvLine(L[1]);
  assert.equal(c[0], "202610-A001"); assert.equal(c[1], "2026-10-31"); assert.equal(c[2], "2026-11-30"); assert.equal(c[3], "A001"); assert.equal(c[5], "御中");
  assert.equal(c[8], "2026-10-03"); assert.equal(parseCsvLine(L[2])[8], "2026-10-17");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("明細CSV: 別の月の行は入らない", () => {
  const app = makeApp();
  app.setup({ rows: [...demoRows().slice(0, 3), R("2026-09-30", "A社", "作業サービス", 5), R("2026-11-01", "A社", "作業サービス", 5)], clients: { "A社": A }, prices: PRICES });
  const L = app.run("invoiceCsv()").split("\r\n");
  assert.equal(L.length, 5);
  assert.deepEqual(L.slice(1, 4).map(x => parseCsvLine(x)[8]), ["2026-10-03", "2026-10-10", "2026-10-17"]);
});
test("明細CSV: 明細が何行でも、列は21列のまま(行ごとに1行)", () => {
  const app = makeApp();
  const rows = []; for (let d = 1; d <= 12; d++) rows.push(R("2026-10-" + String(d).padStart(2, "0"), "C社", "作業サービス", 1));
  app.setup({ rows: [...rows, R("2026-10-05", "A社", "作業サービス", 1)], clients: { "C社": { code: "A003", hon: "御中", reg: false }, "A社": A }, prices: PRICES });
  const L = app.run("invoiceCsv()").split("\r\n").filter(Boolean);
  assert.equal(L.length, 1 + 13);
  assert.ok(L.every(x => parseCsvLine(x).length === 21));
});
test("明細CSV: コンマ・引用符を含む名前も、読み戻して同じになる", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", 'X,Y "社"', "作業サービス", 1)], clients: { 'X,Y "社"': { code: "A009", hon: "御中", reg: false } }, prices: PRICES, bank: '架空銀行,支店 "普通"' });
  const c = parseCsvLine(app.run("invoiceCsv()").split("\r\n")[1]);
  assert.equal(c[7], '架空銀行,支店 "普通"'); assert.equal(c[3], "A009"); assert.equal(c[4], 'X,Y "社"');
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("明細CSV: 数量は小数のまま(1.25、0.5)。小計は 単価×数量の円未満を四捨五入", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1.25), R("2026-10-04", "A社", "作業サービス", 0.5), R("2026-10-05", "A社", "相談サービス", 0.33)], clients: { "A社": A }, prices: PRICES });
  const L = app.run("invoiceCsv()").split("\r\n");
  const c = parseCsvLine(L[1]), d = parseCsvLine(L[2]), e = parseCsvLine(L[3]);
  assert.equal(c[10], "1.25"); assert.equal(c[14], "3000"); assert.equal(c[15], "3750");
  assert.equal(d[10], "0.5"); assert.equal(d[15], "1500");
  assert.equal(e[10], "0.33"); assert.equal(e[15], "1320");
});
test("明細CSV: 品目の税区分・源泉徴収、取引先の消費税の表示・端数処理が、行ごとに出る。税の金額は出さない", () => {
  const app = makeApp();
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": { ...A, taxMode: "内税(税込)", round: "四捨五入" } }, prices: PRICES });
  app.run(`cfg.itemTax["作業サービス"]={kubun:"8%(軽減)",wh:"10%"}; cfg.itemTax["相談サービス"]={kubun:"非課税",wh:"なし"};`);
  const L = app.run("invoiceCsv()").split("\r\n");
  assert.deepEqual(parseCsvLine(L[1]).slice(16, 20), ["8%(軽減)", "10%", "内税(税込)", "四捨五入"]);
  assert.deepEqual(parseCsvLine(L[3]).slice(16, 20), ["非課税", "なし", "内税(税込)", "四捨五入"]);
  assert.ok(!/4950|6600|4400/.test(L.join("\n")), "税込や源泉の金額は出さない");
});
test("明細CSV: 開始・終了があれば出る", () => {
  const app = makeApp();
  app.setup({ rows: [{ ...R("2026-10-03", "A社", "作業サービス", 1.5), start: "09:00", end: "10:30" }], clients: { "A社": A }, prices: PRICES });
  const c = parseCsvLine(app.run("invoiceCsv()").split("\r\n")[1]);
  assert.equal(c[12], "09:00"); assert.equal(c[13], "10:30");
});
test("明細CSV: UTF-8でBOMつき、改行はCRLF、小計のほかの金額の計算はしない", () => {
  const app = makeApp();
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": A }, prices: PRICES });
  const s = app.run("invoiceCsv()");
  assert.ok(s.startsWith("﻿")); assert.ok(s.endsWith("\r\n")); assert.ok(!/(?<!\r)\n/.test(s), "改行はすべてCRLF");
  assert.ok(!/14500/.test(s), "請求書の合計金額は出さない");
});
test("書き出し: ファイル名は 明細_月.csv・取引先_月.csv・品目_月.csv", () => {
  assert.match(SOURCE, /"明細_"\+\$\("month"\)\.value\+"\.csv"/);
  assert.match(SOURCE, /"取引先_"\+\$\("month"\)\.value\+"\.csv"/);
  assert.match(SOURCE, /"品目_"\+\$\("month"\)\.value\+"\.csv"/);
});
test("名前: index.html・docs/index.html・tests に、特定の請求書ソフトの名前が無い", () => {
  const re = new RegExp("\u0049\u004e\u0056\u004f\u0059|\u30a4\u30f3\u30dc\u30a4", "i"); // 書かれていない語を、そのまま書かずに表す
  for (const f of ["index.html", "docs/index.html", "tests/app.test.js"]) assert.ok(!re.test(fs.readFileSync(path.join(__dirname, "..", f), "utf8")), f);
});

// ---- 取引先CSV ----
test("取引先CSV: 14列の決まった見出し。登録済みは入らない。BOMつき・CRLF", () => {
  const app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": { ...A, reg: true }, "B社": B }, prices: PRICES });
  const s = app.run("customerCsv()");
  const L = s.split("\r\n");
  assert.equal(L[0], "﻿取引先コード,取引先,敬称,消費税の表示,端数処理,登録番号,担当者,部署,メール,TEL,FAX,郵便番号,住所,建物名");
  assert.equal(L.length, 3, "見出し+B社のみ+末尾の改行"); assert.deepEqual(parseCsvLine(L[1]), ["A002", "B社", "御中", "外税(税別)", "切り捨て", "", "", "", "", "", "", "", "", ""]);
  assert.ok(!s.includes("A社"));
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("取引先CSV: 全員が登録済みなら、保存ボタンは使えない", () => {
  const app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": { ...A, reg: true }, "B社": { ...B, reg: true } }, prices: PRICES });
  assert.equal(app.els["dlCus"].disabled, true);
});

// ---- 警告と、ボタンを止める条件 ----
test("警告: 単価が未設定なら、明細CSVのボタンを止める", () => {
  const app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": A, "B社": B }, prices: { "作業サービス": 3000, "相談サービス": "" } });
  assert.equal(app.els["dlInv"].disabled, true);
  assert.ok(app.run("problems()").some(x => x.includes("単価が未設定") && x.includes("相談サービス")));
});
test("警告: 振込先が空・取引先コードの重複は、ボタンを止める", () => {
  let app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": A, "B社": B }, prices: PRICES, bank: "" });
  assert.equal(app.els["dlInv"].disabled, true);
  app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": A, "B社": { ...B, code: "A001" } }, prices: PRICES });
  assert.equal(app.els["dlInv"].disabled, true);
  assert.ok(app.run("problems()").some(x => x.includes("重複")));
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("警告: 未登録の取引先は注意だけで、ボタンは止めない", () => {
  const app = makeApp();
  // 実用版は、架空の振込先のままだと止まる(別の確かめ)ので、ここでは本物らしい振込先を入れる
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": A }, prices: PRICES, bank: "テスト銀行 本店 普通 1111111" });
  assert.equal(app.els["dlInv"].disabled, false);
  assert.ok(app.run("problems()").some(x => x.startsWith("※") && x.includes("未登録")));
});
test("警告: その月に出せる行が無ければ、ボタンを止める", () => {
  const app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": A, "B社": B }, prices: PRICES, month: "2026-08" });
  assert.equal(app.els["dlInv"].disabled, true);
});

// ---- 日付 ----
test("発行日と期限: 月末と翌月末(閏年・年またぎ)", () => {
  const app = makeApp();
  for (const [m, i, d] of [["2028-02", "2028-02-29", "2028-03-31"], ["2026-12", "2026-12-31", "2027-01-31"], ["2026-10", "2026-10-31", "2026-11-30"]]) {
    app.els["month"].value = m; app.run("setDates()");
    assert.equal(app.els["issue"].value, i); assert.equal(app.els["due"].value, d);
  }
});

// ---- 取引先コードの自動採番 ----
test("取引先コード: 新しい取引先に A001, A002… と重ならずに付く", () => {
  const app = makeApp();
  app.run(`rows=${JSON.stringify([R("2026-10-01", "P社", "作業サービス", 1), R("2026-10-02", "Q社", "作業サービス", 1), R("2026-10-03", "P社", "作業サービス", 1)])}; ensureClients();`);
  assert.deepEqual(JSON.parse(app.run("JSON.stringify([cfg.clients['P社'].code, cfg.clients['Q社'].code])")), ["A001", "A002"]);
});

// ---- 控え(バックアップ) ----
test("控え: 保存して読み戻すと、行も設定も同じ", () => {
  const app = makeApp();
  app.setup({ rows: demoRows(), clients: { "A社": { ...A, reg: true }, "B社": B }, prices: PRICES });
  const back = app.run("parseBackup(buildBackup())");
  const strip = r => r.map(x => [x.date, x.client, x.service, x.hours, x.kind].join("|")).join(";");
  assert.equal(strip(back.rows), strip(demoRows()));
  assert.equal(back.cfg.clients["A社"].reg, true); assert.equal(back.cfg.prices["相談サービス"], 4000); assert.equal(back.cfg.bank, "架空銀行 サンプル支店 普通 0000000");
});
test("控え: 壊れたファイル・別のアプリのファイル・不正な行は断る", () => {
  const app = makeApp();
  const ok = rows => JSON.stringify({ app: "seikyu-matome", version: 1, rows, cfg: {} });
  const bad = [
    "", "abc", "{}", "[]", JSON.stringify({ app: "other", version: 1, rows: [], cfg: {} }),
    JSON.stringify({ app: "seikyu-matome", version: 2, rows: [], cfg: {} }),
    ok([{ date: "x", client: "A", service: "s", hours: 1, kind: "act" }]),
    ok([{ date: "2026-10-01", client: "A", service: "s", hours: "1", kind: "act" }]),
    ok([{ date: "2026-10-01", client: "A", service: "s", hours: -1, kind: "act" }]),
    ok([{ date: "2026-10-01", client: "A", service: "s", hours: 1, kind: "zzz" }]),
    ok([{ date: "2026-10-01", client: " ", service: "s", hours: 1, kind: "act" }]),
    ok([null])
  ];
  for (const t of bad) assert.throws(() => app.run(`parseBackup(${JSON.stringify(t)})`), undefined, "断るべき: " + t.slice(0, 40));
  assert.doesNotThrow(() => app.run(`parseBackup(${JSON.stringify(ok([]))})`));
});
test("控え: 戻すときに、知らない項目や不正な敬称は取り込まない", () => {
  const app = makeApp();
  const t = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg: { clients: { Z: { code: "A5", hon: "殿", reg: 1, extra: "x" } }, prices: { s: {} }, bank: 5 } });
  const b = app.run(`parseBackup(${JSON.stringify(t)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(b.cfg.clients.Z)), { code: "A5", hon: "御中", reg: true, taxMode: "外税(税別)", round: "切り捨て", ...BLANKC });
  assert.equal(b.cfg.prices.s, ""); assert.equal(b.cfg.bank, "");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

// ---- 名前の表記ゆれ ----
test("名前: 全角半角・前後や連続する空白は、同じ取引先・サービスとして扱う", () => {
  const app = makeApp();
  // デモ版は決まったサービス名しか受け付けないので、空白の入れ方だけで試す
  const [s1, s2] = DEMO ? [" 作業サービス", "作業サービス  "] : ["作業　サービス", "作業 サービス"];
  app.run(`addRow({date:"2026-10-01",client:"Ａ社 ",service:${JSON.stringify(s1)},hours:1,kind:"act"}); addRow({date:"2026-10-02",client:" A社",service:${JSON.stringify(s2)},hours:1,kind:"act"}); ensureClients();`);
  assert.deepEqual(JSON.parse(app.run("JSON.stringify([...new Set(rows.map(r=>r.client))])")), ["A社"]);
  assert.deepEqual(JSON.parse(app.run("JSON.stringify([...new Set(rows.map(r=>r.service))])")), [DEMO ? "作業サービス" : "作業 サービス"]);
  assert.equal(app.run("Object.keys(cfg.clients).length"), 1);
});
test("名前: 保存ずみの古いデータ(ゆれたまま)も、読み込むときにそろえ、設定は先のものを残す", () => {
  const app = makeApp();
  app.storage[SK] = JSON.stringify([R("2026-10-01", "Ａ社", "作業", 1), R("2026-10-02", "A社 ", "作業", 1)]);
  app.storage[CK] = JSON.stringify({ clients: { "Ａ社": { code: "A001", hon: "様", reg: true }, "A社 ": { code: "A099", hon: "御中", reg: false } }, prices: { "作業": 100 }, bank: "b" });
  app.run("loadState()");
  assert.equal(app.run("Object.keys(cfg.clients).length"), 1);
  assert.equal(app.run("cfg.clients['A社'].code"), "A001");
  assert.equal(app.run("new Set(rows.map(r=>r.client)).size"), 1);
});
test("名前: 控えを戻すときも、そろえる", () => {
  const app = makeApp();
  // デモ版は決まったサービス名しか受け付けないので、デモ版の一覧にある名前で試す(実用版も同じ名前で問題ない)
  const t = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [{ date: "2026-10-01", client: "Ｂ社 ", service: "相談サービス ", hours: 1, kind: "act" }], cfg: { clients: { "Ｂ社 ": { code: "A002" } } } });
  const b = app.run(`parseBackup(${JSON.stringify(t)})`);
  assert.equal(b.rows[0].client, "B社"); assert.deepEqual(Object.keys(b.cfg.clients), ["B社"]);
});

// ---- 別のタブで保存されたとき ----
test("別のタブ: 保存の変更を検知して、読み直す(自分の古い内容で上書きしない)", () => {
  const app = makeApp();
  app.run(`rows=[]; cfg.bank="古い"`);
  assert.ok(app.handlers.storage && app.handlers.storage.length === 1, "storage イベントを受けていません");
  app.storage[SK] = JSON.stringify([R("2026-10-01", "A社", "作業", 1)]);
  app.storage[CK] = JSON.stringify({ clients: {}, prices: {}, bank: "新しい" });
  app.handlers.storage[0]({ key: SK });
  assert.equal(app.run("rows.length"), 1); assert.equal(app.run("cfg.bank"), DEMO ? BANK : "新しい", "デモ版は振込先が固定");
  app.storage[SK] = "[]";
  app.handlers.storage[0]({ key: "他のサイトのキー" });
  assert.equal(app.run("rows.length"), 1, "関係ないキーでは読み直さない");
});

// ---- 画面の案内 ----
test("画面: 書き出しの案内が出る(請求書ソフトにCSVの取りこみがあれば、見本の形に合わせて変える)。ほかのファイルへのリンクは作らない", () => {
  const m = html.match(/<p class="note" id="csvGuide">([\s\S]*?)<\/p>/);
  assert.ok(m, "案内がある");
  assert.equal(m[1], "お使いの請求書ソフトに CSV の取りこみがあれば、その見本の形に合わせて変えると、請求書の下書きまで自動で作れます。変え方は『作り方一式』にあります。");
  assert.ok(html.indexOf('id="csvGuide"') > html.indexOf("<h2>CSVに書き出す(くわしく)</h2>"), "「CSVに書き出す(くわしく)」の中");
});

// ---- 外へ出さない(基準1) ----
test("基準1: ブラウザに通信を禁止させている(CSP)。公開時のヘッダーとも一致する", () => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(m, "CSP の meta がありません");
  const dir = Object.fromEntries(m[1].split(";").map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir["default-src"], ["'none'"], "既定は全て禁止");
  assert.ok(!("connect-src" in dir), "connect-src を足すなら、送信先と理由をここで見直すこと");
  assert.ok(!m[1].includes("unsafe-eval") && !/https?:|\*/.test(m[1]), "外部の許可や eval があってはいけない");
  assert.deepEqual(dir["form-action"], ["'none'"]);
  const hdr = fs.readFileSync(path.join(__dirname, "..", "_headers"), "utf8");
  for (const d of m[1].split(";").map(s => s.trim())) assert.ok(hdr.includes(d), "_headers に無い: " + d);
  assert.ok(hdr.includes("frame-ancestors 'none'"));
});
test("基準1: コードに、外へ送る処理(fetch など)も、外部の読み込みも無い", () => {
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|importScripts/.test(SOURCE), "外へ送る処理が見つかりました");
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|@import|https?:\/\//.test(html), "外部の読み込みまたはURLが見つかりました");
});

// ================= ブラッシュアップ(2026-10-18)で足した分 =================
const C3 = { code: "A003", hon: "御中", reg: false };
const octRows = () => [R("2026-10-03", "A社", "作業サービス", 1.5), R("2026-10-10", "A社", "作業サービス", 2), R("2026-10-17", "A社", "相談サービス", 1)];
// 画面の外の世界(vm)の値を、ふつうの値にして取り出す
const J = (app, code) => JSON.parse(app.run("JSON.stringify(" + code + ")"));
const csvCol = (app, line, col) => parseCsvLine(app.run("invoiceCsv()").split("\r\n")[line])[col];
const gotoMonth = (app, m) => { app.els["month"].value = m; app.run("setDates(); render()"); };
const keep = (app) => JSON.stringify([J(app, "rows"), J(app, "cfg")]);

// ---- 3. 行の編集 ----
test("編集: 更新で行が置き換わる(id はそのまま、名前はそろえる、行の数は変わらない)", () => {
  const app = makeApp();
  const rs = octRows();
  app.setup({ rows: rs, clients: { "A社": A }, prices: PRICES });
  const id = rs[1].id;
  const r = J(app, `updateRow(${id}, {date:"2026-10-11",client:"Ａ社 ",service:"相談サービス",hours:3,kind:"plan"})`);
  assert.equal(app.run("rows.length"), 3);
  assert.deepEqual(r, { id, date: "2026-10-11", client: "A社", service: "相談サービス", hours: 3, kind: "plan" });
  assert.deepEqual(J(app, "rows[1]"), r, "同じ位置の行が置き換わる");
  assert.deepEqual(J(app, "[rows[0].hours, rows[2].hours]"), [1.5, 1], "ほかの行は変わらない");
  assert.equal(JSON.parse(app.storage[SK])[1].hours, 3, "保存もされる");
  assert.equal(app.run(`updateRow(0.123, {date:"2026-10-11",client:"A社",service:"相談サービス",hours:3,kind:"plan"})`), null, "無い行は更新できない");
});
test("編集: 「直す」で欄に入り、ボタンが「直した内容で保存する」になる。「直すのをやめる」で空の追加の状態に戻り、行は変わらない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const before = keep(app);
  app.run("startEdit(rows[1])");
  assert.equal(app.els["client"].value, "A社"); assert.equal(app.els["service"].value, "作業サービス"); assert.equal(app.els["hours"].value, 2); assert.equal(app.els["date"].value, "2026-10-10");
  assert.equal(app.els["submitBtn"].textContent, "直した内容で保存する"); assert.equal(app.els["cancelEdit"].hidden, false);
  assert.equal(app.run("editId"), J(app, "rows[1].id"));
  app.els["cancelEdit"].onclick();
  assert.equal(app.run("editId"), null); assert.equal(app.els["submitBtn"].textContent, "追加する"); assert.equal(app.els["cancelEdit"].hidden, true);
  assert.equal(app.els["client"].value, ""); assert.equal(app.els["service"].value, ""); assert.equal(app.els["hours"].value, "");
  assert.equal(keep(app), before);
});
test("編集: 編集中にその行が削除されたら(別のタブなど)、編集をやめる", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  app.run("startEdit(rows[1])");
  app.storage[SK] = JSON.stringify(octRows().slice(0, 1)); // 別のタブで、その行が消えた
  app.handlers.storage[0]({ key: SK });
  assert.equal(app.run("editId"), null); assert.equal(app.els["submitBtn"].textContent, "追加する"); assert.equal(app.els["cancelEdit"].hidden, true);
});

// ---- 12. 単価を「いつから」で持つ ----
test("単価の履歴: 10月3,000円→12月3,500円なら、11月のCSVは3,000円、12月は3,500円。履歴の文も出る", () => {
  const app = makeApp();
  app.setup({ rows: ["2026-09-03", "2026-10-03", "2026-11-03", "2026-12-03"].map(d => R(d, "A社", "作業サービス", 1)), clients: { "A社": A } });
  app.run(`setPrice("作業サービス","2026-10",3000); setPrice("作業サービス","2026-12",3500);`);
  const price = m => { gotoMonth(app, m); return csvCol(app, 1, 14); };
  assert.equal(price("2026-10"), "3000"); assert.equal(price("2026-11"), "3000"); assert.equal(price("2026-12"), "3500");
  assert.ok(app.els["out"].value.includes("3,500"), "画面の見出しの単価もその月のもの");
  assert.equal(app.run('histText("作業サービス")'), "2026年10月〜 3,000円 / 2026年12月〜 3,500円");
  assert.equal(app.run('jaMonth("2026-10")'), "2026年10月");
  gotoMonth(app, "2026-09"); // 9月は単価が無い(未設定)
  assert.equal(app.els["dlInv"].disabled, true);
  assert.ok(app.run("problems()").some(x => x.includes("単価が未設定") && x.includes("作業サービス")));
  app.run('cfg.prices["作業サービス"]=9999'); // 互換のための写しは、計算に使わない
  assert.equal(price("2026-11"), "3000");
});
test("単価の履歴: 同じ月は上書き、前と同じ値なら履歴を増やさない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A } });
  const len = () => app.run('cfg.priceHist["作業サービス"].length');
  app.run('setPrice("作業サービス","2026-10",3000)'); assert.equal(len(), 1);
  app.run('setPrice("作業サービス","2026-11",3000)'); assert.equal(len(), 1, "前の月と同じ値は足さない");
  app.run('setPrice("作業サービス","2026-12",3500)'); assert.equal(len(), 2);
  app.run('setPrice("作業サービス","2026-12",3600)'); assert.equal(len(), 2, "同じ月は上書き");
  assert.equal(app.run('priceFor("作業サービス","2026-12")'), 3600);
  app.run('setPrice("作業サービス","2026-12",3000)'); assert.equal(len(), 1, "前と同じ値に戻したら、行は要らない");
  assert.equal(app.run('priceFor("作業サービス","2027-03")'), 3000);
  app.run('setPrice("作業サービス","2026-10","")'); assert.equal(app.run('priceFor("作業サービス","2026-10")'), "", "空にすると未設定");
  assert.equal(len(), 0, "未設定に戻したら履歴も空");
});
test("単価の履歴: 古い保存データ(priceHist なし)は prices から引っ越す。CSVの単価は変わらない", () => {
  const app = makeApp();
  app.storage[SK] = JSON.stringify([R("2026-10-01", "A社", "作業", 1)]);
  app.storage[CK] = JSON.stringify({ clients: { "A社": A }, prices: { "作業": "3000", "相談": 4000, "未": "" }, bank: "b" });
  app.run("loadState()");
  assert.deepEqual(J(app, "cfg.priceHist"), { "作業": [{ from: "0000-00", price: 3000 }], "相談": [{ from: "0000-00", price: 4000 }], "未": [{ from: "0000-00", price: "" }] });
  assert.equal(app.run('priceFor("作業","1999-01")'), 3000);
  assert.equal(app.run('histText("作業")'), "最初から 3,000円");
  gotoMonth(app, "2026-10");
  assert.equal(csvCol(app, 1, 14), "3000");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("単価の履歴: 控えにも入り、戻せる。古い控え(priceHist なし)は引っ越す。不正な行は取り込まない", () => {
  const app = makeApp();
  const mk = cfg => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg });
  let b = J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "作業": 3000 } }))})`);
  assert.deepEqual(b.cfg.priceHist, { "作業": [{ from: "0000-00", price: 3000 }] });
  app.setup({ rows: octRows(), clients: { "A社": A } });
  app.run(`setPrice("作業サービス","2026-10",3000); setPrice("作業サービス","2026-12",3500);`);
  b = J(app, "parseBackup(buildBackup())");
  assert.deepEqual(b.cfg.priceHist["作業サービス"], [{ from: "2026-10", price: 3000 }, { from: "2026-12", price: 3500 }]);
  assert.equal(JSON.parse(app.run("buildBackup()")).version, 1, "控えの version は 1 のまま");
  const bad = [{ from: "2026-12", price: 3500 }, { from: "2026-1", price: 1 }, { from: "2026-10", price: "3000" }, { from: "2026-09", price: -5 }, { from: "2026-08", price: null }, null, { from: "2026-10", price: 3000 }, { from: "2026-10", price: 111 }, { from: "2026-07", price: "" }];
  b = J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: {}, priceHist: { "作業": bad, "相談": "x" } }))})`);
  assert.deepEqual(b.cfg.priceHist, { "作業": [{ from: "2026-07", price: "" }, { from: "2026-10", price: 3000 }, { from: "2026-12", price: 3500 }] });
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

// ---- 11. 取引先・サービスの名前の変更と削除 ----
test("名前の変更: 行と設定(取引先・単価・履歴)がすべて付け替わり、候補にも出る", () => {
  const app = makeApp();
  app.setup({ rows: [...octRows(), R("2026-10-05", "B社", "作業サービス", 1)], clients: { "A社": A, "B社": B }, prices: PRICES });
  app.run('setPrice("作業サービス","2026-10",3100)');
  let res = J(app, 'renameName("client","A社","  Ｃ社 ")');
  assert.equal(res.ok, true);
  assert.deepEqual(J(app, "[...new Set(rows.map(r=>r.client))]"), ["C社", "B社"]);
  assert.deepEqual(J(app, "Object.keys(cfg.clients)"), ["C社", "B社"], "並び順も保つ");
  assert.equal(app.run('cfg.clients["C社"].code'), "A001");
  res = J(app, 'renameName("service","作業サービス","作業")');
  assert.equal(res.ok, true);
  assert.ok(J(app, "rows").every(r => r.service !== "作業サービス"));
  assert.deepEqual(J(app, "Object.keys(cfg.prices)"), ["作業", "相談サービス"]);
  assert.deepEqual(J(app, "Object.keys(cfg.priceHist)"), ["作業", "相談サービス"]);
  assert.deepEqual(J(app, 'cfg.priceHist["作業"]'), [{ from: "0000-00", price: 3000 }, { from: "2026-10", price: 3100 }]);
  const cand = J(app, "candidates()");
  assert.ok(cand.cl.includes("C社") && !cand.cl.includes("A社")); assert.ok(cand.sv.includes("作業") && !cand.sv.includes("作業サービス"));
  assert.equal(JSON.parse(app.storage[SK])[0].client, "C社"); assert.ok("作業" in JSON.parse(app.storage[CK]).priceHist);
  gotoMonth(app, "2026-10");
  assert.equal(csvCol(app, 1, 9), "作業", "CSVのサービス名も新しい名前");
}, { skip: DEMO });
test("名前の変更: 既にある名前・空・同じ名前は、何も変えない(合体はしない)", () => {
  const app = makeApp();
  app.setup({ rows: [...octRows(), R("2026-10-05", "B社", "作業サービス", 1)], clients: { "A社": A, "B社": B, "Z社": C3 }, prices: PRICES });
  const before = keep(app);
  let res = J(app, 'renameName("client","A社","B社")');
  assert.equal(res.ok, false); assert.ok(res.msg.includes("すでにあります"));
  res = J(app, 'renameName("client","A社"," Ｂ社 ")'); assert.equal(res.ok, false, "そろえてから比べる");
  res = J(app, 'renameName("client","A社","Z社")'); assert.equal(res.ok, false, "設定にだけある名前とも重ならない");
  res = J(app, 'renameName("service","作業サービス","相談サービス")'); assert.equal(res.ok, false);
  for (const v of ["", "   ", "A社", " Ａ社"]) { res = J(app, `renameName("client","A社",${JSON.stringify(v)})`); assert.equal(res.ok, false); assert.equal(res.msg, ""); }
  assert.equal(keep(app), before);
}, { skip: DEMO });
test("削除: 使っている行があれば削除できない。使っていなければ、確かめてから消える", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A, "C社": C3 }, prices: { ...PRICES, "未使用": 500 } });
  const before = keep(app);
  let res = J(app, 'deleteName("client","A社")');
  assert.equal(res.ok, false); assert.ok(res.msg.includes("3行")); assert.equal(app.confirms.length, 0, "押せないときは確認も出さない");
  res = J(app, 'deleteName("service","作業サービス")'); assert.equal(res.ok, false);
  assert.equal(keep(app), before);
  app.answer(false);
  assert.equal(J(app, 'deleteName("client","C社")').ok, false); assert.equal(app.confirms.length, 1, "確認が出る");
  assert.equal(keep(app), before, "やめたら消えない");
  app.answer(true);
  assert.equal(J(app, 'deleteName("client","C社")').ok, true);
  assert.equal(J(app, 'deleteName("service","未使用")').ok, true);
  assert.deepEqual(J(app, "Object.keys(cfg.clients)"), ["A社"]);
  assert.ok(!("未使用" in J(app, "cfg.prices")) && !("未使用" in J(app, "cfg.priceHist")));
  assert.ok(!("C社" in JSON.parse(app.storage[CK]).clients), "保存もされる");
  if (!DEMO) assert.ok(!J(app, "candidates()").cl.includes("C社"), "候補からも消える(デモ版の候補は固定)");
});

// ---- 1. 予定をまとめて実績にする ----
test("一括で実績: 確認の文に件数が出て、その月の予定だけが実績になる。元に戻せる", () => {
  const app = makeApp();
  const rs = [R("2026-10-03", "A社", "作業サービス", 1, "plan"), R("2026-10-04", "A社", "作業サービス", 1, "plan"), R("2026-10-05", "A社", "作業サービス", 1), R("2026-11-02", "A社", "作業サービス", 1, "plan")];
  app.setup({ rows: rs, clients: { "A社": A }, prices: PRICES });
  assert.equal(app.els["bulkAct"].disabled, false); assert.equal(app.els["undoBtn"].hidden, true);
  const before = keep(app);
  app.answer(false);
  assert.equal(app.run("actAll()"), 0); assert.equal(keep(app), before, "やめたら変わらない");
  assert.equal(app.run("undo"), null);
  app.answer(true);
  assert.equal(app.run("actAll()"), 2);
  assert.ok(app.confirms.at(-1).includes("2件の予定を実績にします") && app.confirms.at(-1).includes("行っていない日が入っていないか"));
  assert.deepEqual(J(app, "rows.map(r=>r.kind)"), ["act", "act", "act", "plan"], "ほかの月は変わらない");
  assert.deepEqual(JSON.parse(app.storage[SK]).map(r => r.kind), ["act", "act", "act", "plan"]);
  app.run("render()");
  assert.equal(app.els["undoBtn"].hidden, false); assert.equal(app.els["bulkAct"].disabled, true, "予定が0件なら押せない");
  const n = app.confirms.length;
  assert.equal(app.run("actAll()"), 0, "0件なら何もしない"); assert.equal(app.confirms.length, n, "確認も出ない");
  assert.equal(app.run("undoLast()"), true);
  assert.equal(JSON.stringify(J(app, "rows")), JSON.stringify(rs), "全部元どおり");
  assert.deepEqual(JSON.parse(app.storage[SK]).map(r => r.kind), ["plan", "plan", "act", "plan"], "保存も元どおり");
  assert.equal(app.run("undo"), null); assert.equal(app.run("undoLast()"), false);
});
test("一括操作の「元に戻す」は、ほかの変更をしたら消える", () => {
  const mkApp = () => {
    const a = makeApp();
    a.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1, "plan"), R("2026-10-04", "A社", "作業サービス", 1, "plan")], clients: { "A社": A }, prices: PRICES });
    a.run("actAll()"); assert.notEqual(a.run("undo"), null); return a;
  };
  for (const change of [`addRow({date:"2026-10-09",client:"A社",service:"作業サービス",hours:1,kind:"act"})`, `updateRow(rows[0].id,{date:"2026-10-03",client:"A社",service:"作業サービス",hours:2,kind:"act"})`, `saveRows()`]) {
    const a = mkApp(); a.run(change); assert.equal(a.run("undo"), null, change);
  }
  const a = mkApp(); a.storage[SK] = "[]"; a.handlers.storage[0]({ key: SK }); assert.equal(a.run("undo"), null, "別のタブの変更");
});

// ---- 2. 前の月の予定を写す ----
test("前の月を写す: 第n週の同じ曜日に、すべて予定として写す。第5週は写さず、件数を知らせる", () => {
  const app = makeApp();
  // 2026年9月は 1日が火曜。10月は 1日が木曜(第1火曜=6日、第2火曜=13日、第4木曜=22日)
  const rs = [R("2026-09-01", "A社", "作業サービス", 1.5), R("2026-09-08", "B社", "相談サービス", 2, "plan"), R("2026-09-24", "A社", "相談サービス", 1), R("2026-09-29", "A社", "作業サービス", 1), R("2026-09-30", "A社", "作業サービス", 1), R("2026-10-01", "A社", "作業サービス", 4)];
  app.setup({ rows: rs, clients: { "A社": A, "B社": B }, prices: PRICES });
  assert.equal(app.els["copyPrev"].disabled, false);
  app.answer(false);
  assert.equal(app.run("copyPrev()"), 0); assert.equal(app.run("rows.length"), 6, "やめたら増えない");
  assert.equal(app.confirms.at(-1), "3件を写します(写せない日 2件)。この月にはすでに 1件あります");
  app.answer(true);
  assert.equal(app.run("copyPrev()"), 3);
  const added = J(app, "rows.slice(6)");
  assert.deepEqual(added.map(r => [r.date, r.client, r.service, r.hours, r.kind]), [
    ["2026-10-06", "A社", "作業サービス", 1.5, "plan"], ["2026-10-13", "B社", "相談サービス", 2, "plan"], ["2026-10-22", "A社", "相談サービス", 1, "plan"]]);
  assert.equal(new Set(added.map(r => r.id)).size, 3, "idは重ならない");
  assert.equal(app.run("rows.length"), 9); assert.equal(JSON.parse(app.storage[SK]).length, 9);
  assert.equal(app.run("rows[0].kind"), "act", "前の月の行は変わらない");
  assert.equal(app.run("undoLast()"), true); assert.equal(app.run("rows.length"), 6, "元に戻る");
});
test("控え: デモ版は、ダミー以外の名前を含む控えを断る(実用版は受け付ける)", () => {
  const app = makeApp();
  const t = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [{ date: "2026-10-01", client: "実在の会社", service: "作業サービス", hours: 1, kind: "act" }], cfg: {} });
  if (DEMO) assert.throws(() => app.run(`parseBackup(${JSON.stringify(t)})`), /デモ版/);
  else assert.doesNotThrow(() => app.run(`parseBackup(${JSON.stringify(t)})`));
});
test("前の月を写す: 7の倍数の日(第n週の最後の日)も、同じ第n週の曜日に写る", () => {
  const app = makeApp();
  // 2026-09-07(月)=第1月曜、09-14(月)=第2月曜、09-28(月)=第4月曜 → 10月の第1・第2・第4月曜は 10/5・10/12・10/26
  app.setup({ rows: [R("2026-09-07", "A社", "作業サービス", 1), R("2026-09-14", "A社", "作業サービス", 1), R("2026-09-28", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: PRICES });
  app.answer(true);
  assert.equal(app.run("copyPrev()"), 3);
  assert.deepEqual(J(app, "rows.slice(3)").map(r => r.date), ["2026-10-05", "2026-10-12", "2026-10-26"]);
});
test("前の月を写す: 写せる行が無ければ何もしない。前の月が空ならボタンは押せない", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-09-29", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: PRICES });
  assert.equal(app.run("copyPrev()"), 0); assert.equal(app.run("rows.length"), 1); assert.equal(app.confirms.length, 0);
  assert.ok(app.els["toastMsg"].textContent.includes("写せる行がありません"));
  gotoMonth(app, "2026-08"); assert.equal(app.els["copyPrev"].disabled, true);
  gotoMonth(app, "2026-10"); assert.equal(app.els["copyPrev"].disabled, false);
});

// ---- 4. 月の切り替え ----
test("月の切り替え: 前の月・次の月(年またぎ)。発行日と期限も変わる", () => {
  const app = makeApp();
  app.els["month"].value = "2026-01"; app.run("shiftMonth(-1)");
  assert.equal(app.els["month"].value, "2025-12"); assert.equal(app.els["issue"].value, "2025-12-31"); assert.equal(app.els["due"].value, "2026-01-31");
  app.run("shiftMonth(1)"); app.run("shiftMonth(1)");
  assert.equal(app.els["month"].value, "2026-02"); assert.equal(app.els["issue"].value, "2026-02-28"); assert.equal(app.els["due"].value, "2026-03-31");
  assert.equal(app.run('prevMonth("2026-03")'), "2026-02");
  assert.equal(typeof app.els["prevMonth"].onclick, "function"); assert.equal(typeof app.els["nextMonth"].onclick, "function");
});

// ---- 5. 一覧に合計 ----
test("合計: 取引先ごとに、実績と予定を分けて出す。ほかの月は入らない", () => {
  const app = makeApp();
  app.setup({ rows: [...demoRows(), R("2026-10-20", "B社", "作業サービス", 0.25), R("2026-11-01", "A社", "作業サービス", 9)], clients: { "A社": A, "B社": B }, prices: PRICES });
  const t = J(app, "totals()");
  assert.deepEqual(t.map(x => [x.client, x.act, x.plan]), [["A社", 4.5, 0], ["B社", 1.25, 1.5]]);
  assert.equal(app.run("totalText(totals()[0])"), "実績 4.5時間 / 予定 0時間");
  assert.equal(app.run("totalText(totals()[1])"), "実績 1.25時間 / 予定 1.5時間");
  gotoMonth(app, "2026-08"); assert.deepEqual(J(app, "totals()"), []);
});

// ---- 10. デモ版 ----
test("デモ版: 決まった取引先・サービス以外は受け付けない(追加・編集・名前の変更)", () => {
  const app = makeApp();
  const add = (c, s) => app.run(`addRow({date:"2026-10-01",client:${JSON.stringify(c)},service:${JSON.stringify(s)},hours:1,kind:"act"})`);
  assert.equal(add("Ｂ社 ", "相談サービス").client, "B社");
  assert.equal(add("X社", "作業サービス"), null); assert.equal(add("A社", "未知のサービス"), null);
  assert.equal(app.run("rows.length"), 1);
  const id = app.run("rows[0].id");
  assert.equal(app.run(`updateRow(${id},{date:"2026-10-01",client:"X社",service:"相談サービス",hours:1,kind:"act"})`), null);
  assert.equal(app.run("rows[0].client"), "B社", "断った編集は行を変えない");
  assert.equal(app.run(`updateRow(${id},{date:"2026-10-01",client:"C社",service:"作業サービス",hours:2,kind:"act"})`).client, "C社");
  const res = J(app, 'renameName("client","C社","D社")');
  assert.equal(res.ok, false); assert.equal(app.run("rows[0].client"), "C社");
  assert.deepEqual(J(app, "candidates()"), { cl: ["A社", "B社", "C社"], sv: ["作業サービス", "相談サービス"] });
}, { skip: !DEMO });
test("デモ版: 注意書き、読み取り専用の欄、振込先の固定、件名の【デモ】、別の保存キー", async () => {
  const app = makeApp();
  assert.equal(app.els["demoBanner"].hidden, false);
  for (const id of ["client", "service", "bank"]) assert.equal(app.els[id].readOnly, true, id);
  assert.match(html, /これはデモ版です。取引先・サービスは決まったダミーから選ぶだけです。自分の仕事で使いたいときは、作り方一式で自分用に作ってください/);
  // 保存されていた振込先が別でも、固定のものになる
  app.storage[CK] = JSON.stringify({ clients: {}, prices: {}, bank: "他の銀行", subject: "{y}年{m}月分 業務委託料" });
  app.run("loadState()"); assert.equal(app.run("cfg.bank"), BANK);
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  assert.ok(csvCol(app, 1, 6).startsWith("【デモ】2026年10月分"));
  app.run('addRow({date:"2026-10-20",client:"A社",service:"作業サービス",hours:1,kind:"act"})');
  assert.ok(Object.keys(app.storage).length > 0 && Object.keys(app.storage).every(k => k.startsWith("seikyu-matome-demo-")), "実用版のキーに書かない");
  assert.equal(app.run("SKEY"), "seikyu-matome-demo-v1"); assert.equal(app.run("CKEY"), "seikyu-matome-demo-settings-v1");
  // 控えから戻しても、振込先は固定
  const t = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg: { clients: {}, prices: {}, bank: "他の銀行" } });
  await app.els["restore"].onchange({ target: { files: [{ text: async () => t }], value: "x" } });
  assert.equal(app.run("cfg.bank"), BANK);
}, { skip: !DEMO });
test("実用版: デモの注意書きは出ず、振込先は自由で、件名に【デモ】は付かず、保存キーは従来どおり", async () => {
  const app = makeApp();
  assert.equal(app.els["demoBanner"], undefined, "実用版はデモの注意書きに触らない");
  assert.equal(app.run("DEMO"), false);
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: "A銀行" });
  assert.ok(!csvCol(app, 1, 6).includes("デモ")); assert.equal(csvCol(app, 1, 7), "A銀行");
  app.run('addRow({date:"2026-10-20",client:"X社",service:"自由なサービス",hours:1,kind:"act"})');
  assert.equal(app.run("rows.length"), 4, "自由な名前も入れられる");
  assert.ok(Object.keys(app.storage).every(k => k.startsWith("seikyu-matome-")));
  const t = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg: { clients: {}, prices: {}, bank: "他の銀行" } });
  await app.els["restore"].onchange({ target: { files: [{ text: async () => t }], value: "x" } });
  assert.equal(app.run("cfg.bank"), "他の銀行");
}, { skip: DEMO });

// ---- 9. スマホ / 7. はじめての手順 ----
test("スマホ: 表は横にはみ出さない入れ物に入れる", () => {
  assert.match(html, /\.scroll\{overflow-x:auto/);
  assert.match(html, /@media \(max-width:480px\)/);
  assert.ok((SOURCE.match(/scroll\(t\)/g) || []).length >= 2, "設定の表を入れ物に入れている");
});
test("はじめての手順と、元に戻す方法が画面にある(注意の枠の下、1. の上)", () => {
  assert.match(html, /<h2>はじめての手順<\/h2>[\s\S]*ダミーを入れて試す[\s\S]*「3 書き出す」のCSVを保存して[\s\S]*<summary>元に戻す方法<\/summary>[\s\S]*カードの「削除」/);
  assert.ok(html.indexOf("<h2>はじめての手順</h2>") > html.indexOf('class="badge"') && html.indexOf("<h2>はじめての手順</h2>") < html.indexOf('<h2 id="addTitle">'));
});

// ================= 品目の先登録と、品目CSV =================
const HDR_ITEM_TEXT = "品目,単価(この月),単位,税区分,源泉徴収";

test("品目の先登録: 名前をそろえて足し、いま選んでいる月から先の単価になる。候補と設定にすぐ出る", () => {
  const app = makeApp();
  app.setup({ rows: [], month: "2026-10" });
  assert.deepEqual(J(app, "candidates().sv"), []);
  const res = J(app, 'addItem("  作業　準備 ", "3000")');
  assert.equal(res.ok, true);
  assert.deepEqual(J(app, 'cfg.priceHist["作業 準備"]'), [{ from: "2026-10", price: 3000 }]);
  assert.equal(app.run('cfg.prices["作業 準備"]'), 3000);
  assert.deepEqual(J(app, "candidates().sv"), ["作業 準備"], "行が無くても候補に出る");
  assert.ok("作業 準備" in JSON.parse(app.storage[CK]).priceHist, "保存もされる");
  app.run("render()");
  assert.deepEqual(J(app, "Object.keys(cfg.priceHist)"), ["作業 準備"], "描き直しても残る(設定の表に出る)");
  gotoMonth(app, "2026-12");
  assert.equal(J(app, 'addItem("相談", "500")').ok, true);
  assert.equal(app.run('priceFor("相談","2026-11")'), "", "選んでいる月より前は未設定");
  assert.equal(app.run('priceFor("相談","2026-12")'), 500);
  assert.equal(app.run('priceFor("作業 準備","2026-12")'), 3000);
  assert.equal(J(app, 'addItem("単価なし", "")').ok, true, "単価が空でもよい");
  assert.equal(app.run('histText("単価なし")'), "未設定"); assert.equal(app.run('priceFor("単価なし","2026-12")'), "");
  assert.deepEqual(J(app, "candidates().sv"), ["作業 準備", "相談", "単価なし"]);
}, { skip: DEMO });
test("品目の先登録: 名前が空・既にある名前・不正な単価は、何も変えない(単価も上書きしない)", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const before = keep(app);
  let res = J(app, 'addItem("  ", "100")'); assert.equal(res.ok, false); assert.ok(res.msg.includes("品目名"));
  res = J(app, 'addItem("作業サービス", "9999")'); assert.equal(res.ok, false); assert.ok(res.msg.includes("すでにあります"));
  res = J(app, 'addItem(" 作業サービス ", "")'); assert.equal(res.ok, false, "そろえてから比べる");
  res = J(app, 'addItem("新品目", "-5")'); assert.equal(res.ok, false);
  res = J(app, 'addItem("新品目", "abc")'); assert.equal(res.ok, false);
  assert.equal(keep(app), before);
  assert.equal(app.run('priceFor("作業サービス","2026-10")'), 3000);
}, { skip: DEMO });
test("品目の先登録(デモ版): 登録は断り、「登録」ボタンは使えない。編集では名前は変えられない(単価などは変えられる)", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const before = keep(app);
  const res = J(app, 'addItem("新品目", "100")');
  assert.equal(res.ok, false); assert.ok(res.msg.includes("デモ版"));
  assert.equal(keep(app), before);
  for (const id of ["clientNew", "itemNew"]) assert.equal(app.els[id].disabled, true, id);
  assert.ok(app.els["imsg"].textContent.includes("デモ版"));
  assert.equal(J(app, 'saveItem(null,{name:"新品目",price:"1"})').ok, false); assert.equal(J(app, 'saveClient(null,{name:"X社",code:"A9"})').ok, false);
  app.run('openItemDialog("作業サービス")');
  assert.equal($e(app, "itName").readOnly, true);
  assert.equal(J(app, 'saveItem("作業サービス",{name:"別名",price:"3000",unit:"時間",kubun:"",wh:"なし"})').ok, false, "名前は変えられない");
  assert.equal(J(app, 'saveItem("作業サービス",{name:"作業サービス",price:"3100",unit:"時間",kubun:"8%(軽減)",wh:"なし",reg:true})').ok, true);
  assert.equal(app.run('priceFor("作業サービス","2026-10")'), 3100);
  assert.equal(JSON.stringify(J(app, "rows")), JSON.stringify(JSON.parse(before)[0]), "行は変わらない");
}, { skip: !DEMO });

test("品目CSV: 見出しは決まった列名、BOMつき、改行はCRLF。単価・単位・税区分10%・源泉なし", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const s = app.run("itemCsv()");
  assert.deepEqual(J(app, "HDR_ITEM"), HDR_ITEM_TEXT.split(","));
  const L = s.split("\r\n");
  assert.equal(L[0], "\ufeff" + HDR_ITEM_TEXT); assert.equal(parseCsvLine(L[0].slice(1)).length, 5);
  assert.deepEqual(L.slice(1), ["作業サービス,3000,時間,10%,なし", "相談サービス,4000,時間,10%,なし", ""]);
  assert.ok(s.startsWith("\ufeff")); assert.ok(s.endsWith("\r\n")); assert.ok(!/(?<!\r)\n/.test(s));
});
test("品目CSV: 登録済みは入らない。使っていない月でも、すべてのサービスが入る。出すものが無ければボタンは使えない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, month: "2026-08" });
  assert.equal(app.els["dlItem"].disabled, false);
  assert.equal(app.run("itemCsv()").split("\r\n").length, 4, "8月に行が無くても2件入る");
  app.run('cfg.itemReg["作業サービス"]=true; render()');
  assert.deepEqual(app.run("itemCsv()").split("\r\n").slice(1), ["相談サービス,4000,時間,10%,なし", ""]);
  app.run('cfg.itemReg["相談サービス"]=true; render()');
  assert.equal(app.els["dlItem"].disabled, true);
  assert.equal(app.run("itemCsv()"), "\ufeff" + HDR_ITEM_TEXT + "\r\n");
  app.run('cfg.itemReg["相談サービス"]=false; render()');
  assert.equal(app.els["dlItem"].disabled, false);
});
test("品目CSV: 単価はいま選んでいる月の単価(履歴どおり)。未設定なら空。コンマや引用符はくくる", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: {} });
  app.run(`setPrice("作業サービス","2026-10",3000); setPrice("作業サービス","2026-12",3500);`);
  app.run(`cfg.priceHist['X,"Y"']=[]; cfg.prices['X,"Y"']=""; cfg.priceHist["新品目"]=[]; cfg.prices["新品目"]=""; render()`);
  const rowFor = m => { gotoMonth(app, m); return app.run("itemCsv()").split("\r\n").slice(1, -1); };
  assert.equal(rowFor("2026-09")[0], "作業サービス,,時間,10%,なし", "9月はまだ未設定");
  assert.equal(rowFor("2026-10")[0], "作業サービス,3000,時間,10%,なし");
  assert.equal(rowFor("2026-11")[0], "作業サービス,3000,時間,10%,なし");
  const r12 = rowFor("2026-12");
  assert.equal(r12[0], "作業サービス,3500,時間,10%,なし");
  assert.equal(r12[1], '相談サービス,,時間,10%,なし');
  assert.ok(r12.includes('"X,""Y""",,時間,10%,なし'));
  assert.ok(r12.includes("新品目,,時間,10%,なし"));
  assert.deepEqual(parseCsvLine(r12.find(x => x.startsWith('"X'))), ['X,"Y"', "", "時間", "10%", "なし"]);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("品目CSV: 保存ボタンの処理が動き、案内が出る。画面に手順の案内とボタンがある", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  app.els["dlItem"].onclick();
  assert.ok(app.els["msg"].textContent.includes("品目CSVの保存を始めました") && app.els["msg"].textContent.includes("請求書ソフトに登録済み"));
  assert.match(html, /id="dlItem"[^>]*>品目CSVを保存</);
  assert.match(html, /品目CSVは任意です。「請求書ソフトに登録済み」にチェックを付けた品目は、CSVに入りません/);
  assert.ok(html.indexOf('id="dlCus"') < html.indexOf('id="dlItem"'));
  assert.match(SOURCE, /"品目_"\+\$\("month"\)\.value\+"\.csv"/);
});
test("品目CSV: 明細CSV・取引先CSVの中身は変わらない(品目の登録状態に左右されない)", () => {
  const app = makeApp();
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": A }, prices: PRICES });
  const inv = app.run("invoiceCsv()"), cus = app.run("customerCsv()");
  app.run('cfg.itemReg["作業サービス"]=true; cfg.itemReg["相談サービス"]=true; render()');
  assert.equal(app.run("invoiceCsv()"), inv); assert.equal(app.run("customerCsv()"), cus);
});

test("品目の登録済み(itemReg): 古い保存データでは空で始まる。真偽以外とサービスに無い名前は捨てる", () => {
  const app = makeApp();
  app.storage[SK] = JSON.stringify([R("2026-10-01", "A社", "作業", 1)]);
  app.storage[CK] = JSON.stringify({ clients: { "A社": A }, prices: { "作業": 100, "相談": 200 }, bank: "b" });
  app.run("loadState()");
  assert.deepEqual(J(app, "cfg.itemReg"), {});
  app.storage[CK] = JSON.stringify({ clients: {}, prices: { "作業": 100, "相談": 200, "休み": 1 }, itemReg: { "作業": true, "相談 ": false, "休み": "yes", "ゴースト": true, "Ｘ": 1 }, bank: "b" });
  app.run("loadState()");
  assert.deepEqual(J(app, "cfg.itemReg"), { "作業": true, "相談": false });
  app.storage[CK] = JSON.stringify({ clients: {}, prices: {}, itemReg: [true], bank: "b" });
  app.run("loadState()"); assert.deepEqual(J(app, "cfg.itemReg"), {});
});
test("品目の登録済み(itemReg): 控えに入り、戻せる。古い控えは空で始まる。不正な値は取り込まない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  app.run('cfg.itemReg["作業サービス"]=true; cfg.itemReg["相談サービス"]=false;');
  assert.equal(JSON.parse(app.run("buildBackup()")).version, 1);
  let b = J(app, "parseBackup(buildBackup())");
  assert.deepEqual(b.cfg.itemReg, { "作業サービス": true, "相談サービス": false });
  const mk = cfg => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg });
  b = J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "作業": 1 } }))})`);
  assert.deepEqual(b.cfg.itemReg, {}, "古い控え");
  b = J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "作業": 1 }, itemReg: { "作業": "true", "未知": true, "Ｙ": 0 } }))})`);
  assert.deepEqual(b.cfg.itemReg, {}, "真偽でない値・サービスに無い名前は取り込まない");
  b = J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "作業": 1 }, itemReg: { "作業": true, "未知": true } }))})`);
  assert.deepEqual(b.cfg.itemReg, { "作業": true });
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("品目の登録済み(itemReg): サービスの名前を変えると付いて行き、削除すると消える", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: { ...PRICES, "未使用": 5 } });
  app.run('cfg.itemReg["作業サービス"]=true; cfg.itemReg["未使用"]=true; render()');
  if (!DEMO) {
    assert.equal(J(app, 'renameName("service","作業サービス","作業")').ok, true);
    assert.deepEqual(J(app, "cfg.itemReg"), { "作業": true, "未使用": true });
    assert.ok(JSON.parse(app.storage[CK]).itemReg["作業"] === true);
    assert.ok(!app.run("itemCsv()").includes("作業,"), "登録済みのままCSVに入らない");
  }
  assert.equal(J(app, 'deleteName("service","未使用")').ok, true);
  assert.ok(!("未使用" in J(app, "cfg.itemReg")));
  assert.ok(!("未使用" in JSON.parse(app.storage[CK]).itemReg));
});

// ================= レビューで見つけた物の修正 =================
// ダミーの名前: 実用版は本物と混ざらない専用の名前。デモ版は決まった名前そのもの
const DN = DEMO ? { c1: "A社", c2: "B社", v1: "作業サービス", v2: "相談サービス" } : { c1: "ダミーA社", c2: "ダミーB社", v1: "ダミー作業", v2: "ダミー相談" };
const dummyOct = () => [R("2026-10-03", DN.c1, DN.v1, 1.5), R("2026-10-10", DN.c1, DN.v1, 2), R("2026-10-17", DN.c1, DN.v2, 1)];
const DUMMY_CONFIRM = "今の入力に、ダミーの行(" + DN.c1 + "・" + DN.c2 + ")を足します。振込先・取引先コード・単価など、今の設定は変えません。よろしいですか?";

test("ダミー: 今のデータがあれば確かめてから、足す。振込先・取引先コード・単価は変えない。同じ行は足さない", () => {
  const app = makeApp();
  const real = { code: "Z9", hon: "様", reg: true, taxMode: "外税(税別)", round: "切り捨て", ...BLANKC };
  app.setup({ rows: dummyOct(), clients: { [DN.c1]: real }, prices: { [DN.v1]: 5000 }, bank: "本物の銀行 本店 普通 1234567", month: "2026-10" });
  app.answer(false);
  const before = keep(app);
  app.els["loadSample"].onclick();
  assert.equal(app.confirms.at(-1), DUMMY_CONFIRM);
  assert.equal(keep(app), before, "やめたら何も変わらない");
  assert.equal(app.run("undo"), null);
  app.answer(true);
  assert.equal(app.run("loadDummy()"), 2, "同じ3行は足さず、2社目の2行だけ足す");
  assert.equal(app.confirms.length, 2);
  assert.equal(app.run("cfg.bank"), "本物の銀行 本店 普通 1234567", "振込先は変えない");
  assert.deepEqual(J(app, "cfg.clients[" + JSON.stringify(DN.c1) + "]"), real, "すでにある取引先の設定はそのまま");
  assert.equal(app.run("cfg.clients[" + JSON.stringify(DN.c2) + "].code"), "DEMO2");
  assert.equal(app.run("priceFor(" + JSON.stringify(DN.v1) + ",'2026-10')"), 5000, "単価は変えない");
  assert.equal(app.run("cfg.priceHist[" + JSON.stringify(DN.v1) + "].length"), 1);
  assert.equal(app.run("priceFor(" + JSON.stringify(DN.v2) + ",'2026-10')"), 4000, "単価の履歴が無いサービスだけ設定する");
  assert.equal(app.run("rows.length"), 5);
  assert.ok(app.els["toastMsg"].textContent.includes("2件"));
  assert.equal(app.run("undoLast()"), true); assert.equal(app.run("rows.length"), 3, "行が元に戻る");
  assert.equal(app.run("cfg.bank"), "本物の銀行 本店 普通 1234567");
  assert.equal(app.run(JSON.stringify(DN.c2) + " in cfg.clients"), false, "足した取引先の設定も消える");
  assert.deepEqual(J(app, "cfg.clients[" + JSON.stringify(DN.c1) + "]"), real);
  assert.equal(app.run("cfg.priceHist[" + JSON.stringify(DN.v2) + "].length"), 0, "足した単価も消える");
  assert.equal(app.run("priceFor(" + JSON.stringify(DN.v1) + ",'2026-10')"), 5000);
});
test("ダミー: データが何も無ければ確認なしで、行と設定を入れる。2回目は確かめてから、足すものが無いと知らせる。元に戻せる", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10"; app.run("setDates()");
  const bank0 = app.run("cfg.bank");
  app.els["loadSample"].onclick();
  assert.equal(app.confirms.length, 0, "何も無ければ確認しない");
  assert.equal(app.run("rows.length"), 5);
  assert.equal(app.run("cfg.bank"), BANK);
  assert.deepEqual(J(app, "[cfg.clients[" + JSON.stringify(DN.c1) + "].code, cfg.clients[" + JSON.stringify(DN.c2) + "].code]"), ["DEMO1", "DEMO2"]);
  assert.deepEqual(J(app, "[priceFor(" + JSON.stringify(DN.v1) + ",'2026-10'), priceFor(" + JSON.stringify(DN.v2) + ",'2026-10')]"), [3000, 4000]);
  assert.equal(app.run("undo.label"), "ダミーを入れた");
  app.run("render()"); assert.equal(app.els["undoBtn"].hidden, false);
  const first = keep(app);
  app.els["loadSample"].onclick();
  assert.equal(app.confirms.length, 1, "2回目は確かめる");
  assert.equal(app.run("rows.length"), 5, "二重に足さない");
  assert.equal(keep(app), first);
  assert.ok(app.els["toastMsg"].textContent.includes("ダミーはもう入っています"));
  assert.equal(app.run("undoLast()"), true); assert.equal(app.run("rows.length"), 0);
  // 元に戻すと、振込先・取引先コード・単価も、ダミーを入れる前に戻る
  assert.equal(app.run("cfg.bank"), bank0); assert.equal(app.els["bank"].value, bank0, "振込先の入力欄も戻る");
  assert.deepEqual(J(app, "Object.keys(cfg.clients)"), []); assert.deepEqual(J(app, "Object.keys(cfg.priceHist)"), []);
  assert.equal(app.run("undo"), null);
});
test("ダミー: 取引先コードは DEMO1・DEMO2 で、本物の A001 形式と重ならない。ボタンは「はじめての手順」にあり、板(予定・実績・書き出す)には無い", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-02", "X社", "作業サービス", 1)], clients: { "X社": { code: "A001", hon: "御中", reg: false } }, prices: { "作業サービス": 100 }, month: "2026-10" });
  app.run("loadDummy()");
  assert.deepEqual(J(app, "[cfg.clients[" + JSON.stringify(DN.c1) + "].code, cfg.clients[" + JSON.stringify(DN.c2) + "].code]"), ["DEMO1", "DEMO2"]);
  assert.equal(new Set(J(app, "Object.values(cfg.clients).map(c=>c.code)")).size, 3);
  const guide = html.slice(html.indexOf('<section id="guide">'), html.indexOf("</section>", html.indexOf('<section id="guide">')));
  assert.ok(guide.includes('id="loadSample"'));
  const sec2 = html.slice(html.indexOf('id="sec-list"'), html.indexOf('<section id="sec-out"'));
  assert.ok(!sec2.includes("loadSample") && !sec2.includes("ダミー"));
});

test("行の削除: 別窓で確かめてから消え、お知らせの「元に戻す」で戻る。開いただけ・やめるでは消えない", () => {
  const app = makeApp();
  const rs = octRows();
  app.setup({ rows: rs, clients: { "A社": A }, prices: PRICES });
  // 開いただけでは消えない
  assert.equal(app.run(`askDelete(${rs[1].id})`), true);
  assert.equal($e(app, "dlgDel").open, true); assert.equal(app.run("rows.length"), 3); assert.equal(app.run("undo"), null);
  assert.ok(textOf($e(app, "delBody")).includes("10/10 A社") && textOf($e(app, "delBody")).includes("削除した後も、すぐなら「元に戻す」で戻せます。"), textOf($e(app, "delBody")));
  assert.equal(app.confirms.length, 0, "confirm は使わない");
  // やめる
  app.fire("delCancel", "click");
  assert.equal($e(app, "dlgDel").open, false); assert.equal(app.run("rows.length"), 3); assert.equal(app.run("undo"), null);
  // 削除する
  app.run(`askDelete(${rs[1].id})`); app.fire("delOk", "click");
  assert.equal($e(app, "dlgDel").open, false);
  assert.equal(app.run("rows.length"), 2); assert.equal(JSON.parse(app.storage[SK]).length, 2);
  assert.ok($e(app, "toastMsg").textContent.includes("10/10 A社 を削除しました"));
  assert.equal($e(app, "toast").hidden, false); assert.equal($e(app, "undoBtn").hidden, false);
  assert.equal(app.confirms.length, 0);
  // 元に戻す
  app.fire("undoBtn", "click");
  assert.equal(JSON.stringify(J(app, "rows")), JSON.stringify(rs), "同じ行が同じ位置に戻る");
  assert.equal(JSON.parse(app.storage[SK]).length, 3);
  assert.equal($e(app, "toastMsg").textContent, "元に戻しました。"); assert.equal($e(app, "undoBtn").hidden, true);
  assert.equal(app.run("deleteRow(0.5)"), false, "無い行は消せない"); assert.equal(app.run("askDelete(0.5)"), false);
});

test("単価の変更: 見出しに「○年○月から先」。変更の文に、あとの月の単価は変わらないと出る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A } });
  app.run(`setPrice("作業サービス","2026-10",3000); setPrice("作業サービス","2026-12",3500);`);
  assert.equal(app.run('priceHead("2026-11")'), "単価(2026年11月から先・円/時間)");
  assert.equal(app.run('priceChange("作業サービス","2026-11",3200)'), "作業サービス: 2026年11月から 3,200円にしました。2026年12月からは 3,500円のままです。");
  assert.equal(app.run('priceFor("作業サービス","2026-12")'), 3500); assert.equal(app.run('priceFor("作業サービス","2026-11")'), 3200);
  assert.equal(app.run('priceChange("作業サービス","2026-12",3600)'), "作業サービス: 2026年12月から 3,600円にしました。", "あとの月が無ければ付けない");
  assert.equal(app.run('priceChange("作業サービス","2026-10","")'), "作業サービス: 2026年10月から 未設定にしました。2026年11月からは 3,200円のままです。");
  assert.equal(app.run('priceHead("")'), "単価(円/時間)");
});

test("設定の説明と、頭の月の切りかえ・板のボタンの並び", () => {
  assert.match(html, /<summary>「取引先コード」と「請求書ソフトに登録済み」とは<\/summary>[\s\S]*請求書ソフトの取引先と同じ記号[\s\S]*請求書と取引先をつなぐ印[\s\S]*チェックすると、取引先CSV・品目CSVには入りません[\s\S]*二重に登録/);
  const head = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert.ok(head.indexOf('id="prevMonth"') < head.indexOf('id="nextMonth"') && head.indexOf('id="nextMonth"') < head.indexOf('id="thisMonthBtn"') && head.indexOf('id="thisMonthBtn"') < head.indexOf('id="month"'), "月の切りかえは頭にある");
  assert.match(head, /<input type="month" id="month" aria-label="月を選ぶ">/);
  const board = html.slice(html.indexOf('id="sec-list"'), html.indexOf('<section id="sec-out"'));
  assert.ok(board.indexOf('id="bulkAct"') < board.indexOf('id="planList"') && board.indexOf('id="planList"') < board.indexOf('id="copyPrev"') && board.indexOf('id="copyPrev"') < board.indexOf('id="colAct"'), "一括は予定の列の右上、写すは予定の列の下");
  assert.ok(board.includes('id="undoBtn"') === false, "元に戻すは板の中ではなく、お知らせの帯にある");
  assert.ok(html.indexOf('id="toast"') < html.indexOf('id="undoBtn"') && html.indexOf('id="undoBtn"') < html.indexOf('id="toastClose"'));
});

// ================= 批判的レビューの指摘への修正(2026-10-19) =================
const $e = (app, id) => app.run("$(" + JSON.stringify(id) + ")"); // 画面の部品を取り出す(まだ触っていないものも)
const lis = app => app.els["warn"].children.map(x => x.textContent);
const GOOD_BANK = "テスト銀行 本店 普通 1111111";

// ---- 11. 画面の操作を実際に起こすテスト(偽の画面部品が、出来事を動かす) ----
test("画面の操作: 追加(submit)で、時間は小数(1.5)のまま保存され、月が変わる", () => {
  const app = makeApp();
  app.setup({ rows: [], month: "2026-10" });
  for (const [id, v] of [["date", "2026-11-03"], ["client", "A社"], ["service", "作業サービス"], ["hours", "1.5"], ["kind", "act"]]) $e(app, id).value = v;
  app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1); assert.equal(app.run("rows[0].hours"), 1.5, "parseInt だと 1 になってしまう");
  assert.equal(JSON.parse(app.storage[SK])[0].hours, 1.5);
  assert.equal(app.els["month"].value, "2026-11"); assert.equal($e(app, "hours").value, "");
  assert.equal(app.els["fmsg"].textContent, "");
});
test("画面の操作: 編集中の行を更新(submit)すると、置き換わって追加の状態に戻る", () => {
  const app = makeApp();
  const rs = octRows();
  app.setup({ rows: rs, clients: { "A社": A }, prices: PRICES });
  app.run("startEdit(rows[1])");
  $e(app, "hours").value = "2.25";
  app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 3); assert.equal(app.run("rows[1].hours"), 2.25);
  assert.equal(app.run("editId"), null); assert.equal(app.els["submitBtn"].textContent, "追加する");
});
test("画面の操作: 品目の「編集」の画面で単価を入れると、いま選んでいる月から先の単価になる(ほかの月は変わらない)", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-11-03", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: {}, month: "2026-11" });
  const ed = findAll(app.els["cfgPrices"], c => c.tagName === "button" && c.textContent === "編集");
  assert.equal(ed.length, 1);
  ed[0].onclick();
  assert.equal($e(app, "dlgItem").open, true); assert.equal($e(app, "itTitle").textContent, "品目を編集"); assert.equal($e(app, "itSave").textContent, "保存");
  assert.equal($e(app, "itName").value, "作業サービス");
  assert.ok($e(app, "itNote").textContent.startsWith("2026年11月から"));
  $e(app, "itPrice").value = "3200"; app.fire("itSave", "click");
  assert.equal($e(app, "dlgItem").open, false, "保存すると閉じる");
  assert.equal(app.run('priceFor("作業サービス","2026-11")'), 3200);
  assert.equal(app.run('priceFor("作業サービス","2026-10")'), "", "前の月は変わらない");
  assert.deepEqual(JSON.parse(app.storage[CK]).priceHist["作業サービス"], [{ from: "2026-11", price: 3200 }]);
  assert.equal(app.els["out"].value.includes("3,200"), true, "画面の見出しにも出る");
  assert.ok(textOf(app.els["cfgPrices"]).includes("3,200円"));
});
test("画面の操作: 予定のカードの「実績にする」・実績のカードの「予定に戻す」で切り替わり、保存され、お知らせから元に戻せる", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1, "act")], clients: { "A社": A }, prices: PRICES });
  const bt = (box, t) => findAll(app.els[box], c => c.tagName === "button" && c.textContent === t);
  assert.equal(findAll(app.els["actList"], c => c.tagName === "article").length, 1); assert.equal(findAll(app.els["planList"], c => c.tagName === "article").length, 0);
  assert.equal(bt("actList", "予定に戻す").length, 1);
  bt("actList", "予定に戻す")[0].onclick();
  assert.equal(app.run("rows[0].kind"), "plan"); assert.equal(JSON.parse(app.storage[SK])[0].kind, "plan", "保存もされる");
  assert.equal(app.els["toastMsg"].textContent, "10/3 A社 を予定に戻しました。"); assert.equal(app.els["undoBtn"].hidden, false);
  assert.equal(findAll(app.els["planList"], c => c.tagName === "article").length, 1, "描き直される");
  assert.equal(String(findAll(app.els["planList"], c => c.tagName === "article")[0].className), "card card-plan", "予定は点線のカード");
  bt("planList", "実績にする")[0].onclick();
  assert.equal(app.run("rows[0].kind"), "act"); assert.equal(app.els["toastMsg"].textContent, "10/3 A社 を実績にしました。");
  app.fire("undoBtn", "click");
  assert.equal(app.run("rows[0].kind"), "plan", "元に戻す"); assert.equal(JSON.parse(app.storage[SK])[0].kind, "plan");
  assert.equal(app.els["undoBtn"].hidden, true);
});
test("画面の操作: 明細が何行でも、品目11以降の案内は出さず、止めない", () => {
  const app = makeApp();
  const rs = []; for (let d = 1; d <= 11; d++) rs.push(R("2026-10-" + String(d).padStart(2, "0"), "A社", "作業サービス", 1));
  app.setup({ rows: rs, clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  assert.ok(!lis(app).some(x => x.includes("明細が11行")));
  assert.equal(app.els["dlInv"].disabled, false);
});
test("画面の操作: 月の入力・◀▶ボタン・設定の入力欄の出来事が動く", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  $e(app, "month").value = "2026-12"; app.fire("month", "change");
  assert.equal(app.els["issue"].value, "2026-12-31");
  app.fire("prevMonth", "click"); assert.equal(app.els["month"].value, "2026-11");
  app.fire("nextMonth", "click"); app.fire("nextMonth", "click"); assert.equal(app.els["month"].value, "2027-01");
  $e(app, "subject").value = "{y}-{m}"; app.fire("subject", "input"); assert.equal(app.run("cfg.subject"), "{y}-{m}");
  $e(app, "bank").value = "別の銀行"; app.fire("bank", "input");
  assert.equal(app.run("cfg.bank"), DEMO ? GOOD_BANK : "別の銀行", "デモ版は振込先の欄が読み取り専用なので、入力は効かない");
  assert.equal(JSON.parse(app.storage[CK]).subject, "{y}-{m}");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

// ---- 2. 今日・今月は、この端末の時刻 ----
test("日付: 日本時間の午前0時台でも、今日・今月は日本の日付(前の月にならない)", () => {
  const app = makeApp({ now: new Date(2026, 10, 1, 0, 30).getTime() }); // 日本時間 2026-11-01 00:30(協定世界時では 10-31)
  assert.equal(app.els["month"].value, "2026-11");
  assert.equal(app.els["date"].value, "2026-11-01");
  assert.equal(app.els["issue"].value, "2026-11-30");
  app.els["month"].value = ""; // 月が空のときの代わりも、日本の今月
  app.run("shiftMonth(1)"); assert.equal(app.els["month"].value, "2026-12");
  app.els["month"].value = "";
  app.run("loadDummy()"); assert.ok(app.run("rows.every(r=>r.date.startsWith('2026-11-'))"));
});

// ---- 3. 発行日・期限は、月が変わったときだけ戻す ----
test("発行日・期限: 同じ月の中で行を足しても変えない。月が変わったときだけ月末にし直し、知らせる", () => {
  const app = makeApp();
  app.setup({ rows: [], month: "2026-10" });
  app.els["issue"].value = "2026-11-05"; app.els["due"].value = "2026-11-25";
  const add = (d) => { for (const [id, v] of [["date", d], ["client", "A社"], ["service", "作業サービス"], ["hours", "1"], ["kind", "act"]]) $e(app, id).value = v; app.fire("f", "submit"); };
  add("2026-10-20");
  assert.equal(app.els["issue"].value, "2026-11-05"); assert.equal(app.els["due"].value, "2026-11-25"); assert.equal($e(app, "dnote").textContent, "");
  app.run("updateRow(rows[0].id,{date:'2026-10-21',client:'A社',service:'作業サービス',hours:2,kind:'act'}); render()");
  app.run("deleteRow(rows[0].id); render()");
  assert.equal(app.els["issue"].value, "2026-11-05", "更新・削除でも変えない");
  add("2026-12-02"); // 月が変わる
  assert.equal(app.els["month"].value, "2026-12");
  assert.equal(app.els["issue"].value, "2026-12-31"); assert.equal(app.els["due"].value, "2027-01-31");
  assert.ok($e(app, "dnote").textContent.includes("月が変わった"));
  app.els["issue"].value = "2027-01-02"; app.fire("issue", "change");
  assert.equal($e(app, "dnote").textContent, "", "手で直したらお知らせは消す");
  app.run("shiftMonth(1)"); assert.equal(app.els["issue"].value, "2027-01-31");
});

// ---- 4. 前の月を写す: 二重に写さない ----
test("前の月を写す: 2回押しても二重にならない。すでにある行の数を知らせる。重なる行は警告", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-09-01", "A社", "作業サービス", 1.5), R("2026-09-08", "B社", "相談サービス", 2), R("2026-09-24", "A社", "相談サービス", 1)], clients: { "A社": A, "B社": B }, prices: PRICES, bank: GOOD_BANK });
  assert.equal(app.run("copyPrev()"), 3);
  const once = app.run("rows.length");
  assert.equal(app.run("copyPrev()"), 0);
  assert.equal(app.run("rows.length"), once, "二重に増えない");
  assert.ok(app.els["toastMsg"].textContent.includes("写せる行がありません") && app.els["toastMsg"].textContent.includes("すでにある行 3件"), app.els["toastMsg"].textContent);
  // 一部だけ重なるとき
  app.run("rows=rows.filter(r=>r.date!=='2026-10-13')");
  app.run("copyPrev()");
  assert.equal(app.confirms.at(-1), "1件を写します(写せない日 0件・この月にすでにある行 2件)。この月にはすでに 2件あります");
  assert.equal(app.run("rows.length"), once);
  // 同じ日・取引先・サービスが重なっているとき(予定も含める)
  app.run("rows.push({id:0.5,date:'2026-10-06',client:'A社',service:'作業サービス',hours:1,kind:'plan'})");
  $e(app, "withPlan").checked = true; app.run("render()");
  assert.ok(lis(app).some(x => x.startsWith("※") && x.includes("同じ日・取引先・サービスの行が重なっています") && x.includes("A社 10/6 作業サービス")));
});

// ---- 5. 予定は請求書に入る ----
test("予定: 出せる行が無いときは、実績への切り替えを案内する。予定が入るときは目立つ警告を出す", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1, "plan")], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  const h = app.run("problems()")[0];
  assert.ok(h.includes("出せる行がありません") && h.includes("「実績にする」を押して"), h);
  assert.ok(!h.includes("予定も含める"), "予定を含めることを勧めない");
  assert.equal(app.els["dlInv"].disabled, true);
  assert.match(html, /予定も含める\(まだ行っていない日も請求されます\)/);
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1, "plan"), R("2026-10-04", "A社", "作業サービス", 1, "plan"), R("2026-10-05", "A社", "作業サービス", 1, "act")], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK, withPlan: true });
  const w = app.run("problems()").find(x => x.includes("予定の行が"));
  assert.ok(w.startsWith("※") && w.includes("予定の行が2件、請求書に入ります"), w);
  assert.equal(app.els["warn"].children.find(x => x.textContent === w).className, "strong", "目立つ表示");
  assert.equal(app.els["dlInv"].disabled, false, "止めない警告");
  assert.equal(parseCsvLine(app.run("invoiceCsv()").split("\r\n")[1])[9], "作業サービス", "サービス名は変えない");
  app.setup({ rows: [R("2026-10-05", "A社", "作業サービス", 1, "act")], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK, withPlan: true });
  assert.ok(!app.run("problems()").some(x => x.includes("予定の行が")));
});

// ---- 6. 取引先コード ----
test("取引先コード: 削除しても番号を使い回さない。古い保存データは、いちばん大きい番号の次から", () => {
  const app = makeApp();
  app.run(`rows=${JSON.stringify([R("2026-10-01", "P社", "作業サービス", 1), R("2026-10-02", "Q社", "作業サービス", 1)])}; ensureClients();`);
  assert.equal(app.run("cfg.codeSeq"), 2);
  app.run("rows=rows.filter(r=>r.client!=='Q社')");
  assert.equal(J(app, 'deleteName("client","Q社")').ok, true);
  app.run(`rows.push(${JSON.stringify(R("2026-10-03", "R社", "作業サービス", 1))}); ensureClients();`);
  assert.equal(app.run("cfg.clients['R社'].code"), "A003", "Q社の A002 は使い回さない");
  assert.equal(JSON.parse(app.storage[CK]).codeSeq, 3, "通し番号も保存される");
  // 古い保存データ(codeSeq なし)
  const old = makeApp();
  old.storage[SK] = JSON.stringify([R("2026-10-01", "Z社", "作業", 1)]);
  old.storage[CK] = JSON.stringify({ clients: { "X社": { code: "A005", hon: "御中", reg: false }, "Y社": { code: "B7", hon: "御中", reg: false } }, prices: {}, bank: "b" });
  old.run("loadState()");
  assert.equal(old.run("cfg.codeSeq"), 5);
  old.run("ensureClients()"); assert.equal(old.run("cfg.clients['Z社'].code"), "A006");
});
test("取引先コード: 控えにも通し番号が入る。古い控えは、コードから決める", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  app.run("cfg.codeSeq=9");
  assert.equal(J(app, "parseBackup(buildBackup())").cfg.codeSeq, 9);
  const mk = cfg => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg });
  assert.equal(J(app, `parseBackup(${JSON.stringify(mk({ clients: { "A社": { code: "A004" } }, prices: {} }))})`).cfg.codeSeq, 4);
  assert.equal(J(app, `parseBackup(${JSON.stringify(mk({ clients: { "A社": { code: "A004" } }, prices: {}, codeSeq: "x" }))})`).cfg.codeSeq, 4);
  assert.equal(J(app, `parseBackup(${JSON.stringify(mk({ clients: { "A社": { code: "A004" } }, prices: {}, codeSeq: 12 }))})`).cfg.codeSeq, 12);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("取引先コード: 今月の請求に入らない取引先とも重ならないよう、設定の全員で重なりを調べる(止める)", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1)], clients: { "A社": A, "休眠社": { code: "A001", hon: "御中", reg: true } }, prices: PRICES, bank: GOOD_BANK });
  const w = app.run("problems()").find(x => x.includes("重複"));
  assert.ok(w && w.includes("A001") && w.includes("A社") && w.includes("休眠社"), w);
  assert.equal(app.els["dlInv"].disabled, true);
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 1)], clients: { "A社": A, "休眠社": { code: "A777", hon: "御中", reg: true } }, prices: PRICES, bank: GOOD_BANK });
  assert.equal(app.els["dlInv"].disabled, false);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("ダミーの取引先コードは DEMO1・DEMO2。デモ版では C社は DEMO3(実用版の A001 と重ならない)", () => {
  const app = makeApp();
  app.run(`rows=${JSON.stringify([R("2026-10-01", "A社", "作業サービス", 1), R("2026-10-02", "B社", "作業サービス", 1), R("2026-10-03", "C社", "作業サービス", 1)])}; ensureClients();`);
  if (DEMO) assert.deepEqual(J(app, "['A社','B社','C社'].map(n=>cfg.clients[n].code)"), ["DEMO1", "DEMO2", "DEMO3"]);
  else assert.deepEqual(J(app, "['A社','B社','C社'].map(n=>cfg.clients[n].code)"), ["A001", "A002", "A003"], "実用版の本物の取引先は A### で振る");
  const d = makeApp(); d.run("loadDummy()");
  assert.deepEqual(J(d, "[cfg.clients[" + JSON.stringify(DN.c1) + "].code, cfg.clients[" + JSON.stringify(DN.c2) + "].code]"), ["DEMO1", "DEMO2"]);
});

// ---- 1. ダミーを元に戻す / 架空の振込先 ----
test("架空の振込先のままでは、実用版は明細CSVを止める(デモ版は止めない)。本物に変えれば通る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: BANK });
  const w = app.run("problems()").find(x => x.includes("架空"));
  if (DEMO) { assert.equal(w, undefined); assert.equal(app.els["dlInv"].disabled, false); }
  else {
    assert.equal(w, "振込先が架空(ダミー)のままです。本物の振込先に変えてください");
    assert.equal(app.els["dlInv"].disabled, true);
    app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
    assert.equal(app.els["dlInv"].disabled, false);
  }
});
test("ダミーを入れたあと設定を変えたら、設定ごとの「元に戻す」は消える(あとの変更を巻き戻さない)", () => {
  const app = makeApp();
  app.run("loadDummy()"); assert.notEqual(app.run("undo"), null); assert.notEqual(app.run("undo.cfg"), null);
  $e(app, "subject").value = "変えた件名"; app.fire("subject", "input");
  assert.equal(app.run("undo"), null);
  app.run("loadDummy(); render()"); assert.notEqual(app.run("undo"), null);
  app.run("openItemDialog(Object.keys(cfg.priceHist)[0])"); // 先の品目の税区分を、編集の画面で変える
  $e(app, "itKubun").value = "8%(軽減)"; app.fire("itSave", "click");
  assert.equal(app.run("undo"), null);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

// ---- 10. 振込先の確かめ ----
test("明細CSVの保存: 振込先が前回と違うときは確かめる。画面の上に、振込先・発行日・期限が出る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  const out = app.els["out"].value;
  assert.ok(out.startsWith("振込先: " + GOOD_BANK + "\n発行日: 2026-10-31  支払期限: 2026-11-30\n\n■ "), out);
  assert.equal(app.run("saveInvoice()"), true); assert.equal(app.confirms.length, 0, "初めては聞かない");
  assert.equal(app.run("cfg.lastBank"), GOOD_BANK); assert.equal(JSON.parse(app.storage[CK]).lastBank, GOOD_BANK);
  assert.equal(app.run("saveInvoice()"), true); assert.equal(app.confirms.length, 0, "同じ振込先なら聞かない");
  app.run("cfg.bank='別の口座 本店 普通 9999999'");
  app.answer(false);
  $e(app, "msg").textContent = "";
  assert.equal(app.els["dlInv"].onclick(), false);
  assert.equal(app.confirms.at(-1), "振込先が前回(" + GOOD_BANK + ")から変わっています。このまま保存しますか?");
  assert.equal(app.run("cfg.lastBank"), GOOD_BANK, "やめたら前回のまま"); assert.equal($e(app, "msg").textContent, "");
  app.answer(true);
  assert.equal(app.run("saveInvoice()"), true); assert.equal(app.run("cfg.lastBank"), "別の口座 本店 普通 9999999");
  assert.match(html, /書きかえることもできます/);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

// ---- 12. 名前 / 13. 件名 / 14. 0時間 ----
test("名前が constructor や __proto__ でも、取引先・サービス・単価・CSVが壊れない。保存して読み直しても同じ", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "constructor", "__proto__", 1), R("2026-10-04", "__proto__", "toString", 2), R("2026-10-05", "hasOwnProperty", "__proto__", 1)], clients: {}, prices: {}, bank: GOOD_BANK });
  assert.deepEqual(J(app, "Object.keys(cfg.clients)").sort(), ["__proto__", "constructor", "hasOwnProperty"]);
  app.run('setPrice("__proto__","2026-10",700); setPrice("toString","2026-10",800); render()');
  const L = app.run("invoiceCsv()").split("\r\n");
  assert.equal(L.length, 5, "見出し+3社+末尾");
  assert.deepEqual(Object.keys(J(app, "groups()")).sort(), ["__proto__", "constructor", "hasOwnProperty"]);
  assert.ok(L[1].includes(",2026-10-03,__proto__,1,時間,,,700,700,") && L.some(l => l.includes(",2026-10-04,toString,2,時間,,,800,1600,")));
  assert.ok(app.run("problems()").every(x => !x.includes("未設定")));
  app.run("store(CKEY,cfg); store(SKEY,rows); loadState()");
  assert.equal(app.run('priceFor("__proto__","2026-10")'), 700); assert.equal(app.run('cfg.clients["__proto__"].code.length>0'), true);
  assert.equal(app.run("itemCsv()").split("\r\n").length, 4, "見出し+2サービス(__proto__ と toString)+末尾");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("件名: {y} {m} は、何か所あってもすべて置きかわる", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  app.run('cfg.subject="{y}年{m}月分({y}/{m}) 請求"');
  assert.equal(csvCol(app, 1, 6), (DEMO ? "【デモ】" : "") + "2026年10月分(2026/10) 請求");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("0時間の行・時間が数でない行が請求に入るときは、止めない警告を出す", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 0), R("2026-10-04", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  const w = app.run("problems()").find(x => x.includes("時間が0の行"));
  assert.ok(w && w.startsWith("※") && w.includes("1件"), w);
  assert.equal(app.els["dlInv"].disabled, false);
  app.setup({ rows: [R("2026-10-04", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  assert.ok(!app.run("problems()").some(x => x.includes("時間が0の行")));
});

// ---- 15. 控えから戻す ----
test("控えから戻す: 保存した日時と月の範囲を見せて確かめ、設定ごと「元に戻す」で戻せる", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  const text = JSON.stringify({ app: "seikyu-matome", version: 1, savedAt: "2026-09-30T03:30:00.000Z", rows: [R("2026-08-03", "B社", "相談サービス", 1), R("2026-09-04", "B社", "相談サービス", 2)], cfg: { clients: { "B社": { code: "B1", hon: "様", reg: false } }, prices: { "相談サービス": 100 }, bank: "控えの銀行 支店 普通 1", tax: { mode: "内税(税込)", rate: "8%", round: "切り上げ", wh: "なし" } } });
  app.answer(false);
  const before = keep(app);
  app.run(`applyBackup(parseBackup(${JSON.stringify(text)}))`);
  const m = app.confirms.at(-1);
  assert.ok(m.includes("2026-08〜2026-09の分") && m.includes("保存した日時 2026-09-30 12:30") && m.includes("2行"), m);
  assert.equal(keep(app), before, "やめたら変わらない");
  app.answer(true);
  assert.equal(app.run(`applyBackup(parseBackup(${JSON.stringify(text)}))`), true);
  assert.equal(app.run("rows.length"), 2); assert.equal(app.run("cfg.bank"), DEMO ? BANK : "控えの銀行 支店 普通 1");
  assert.equal(app.els["bank"].value, app.run("cfg.bank"));
  assert.deepEqual(J(app, "[cfg.clients['B社'].taxMode, cfg.clients['B社'].round]"), ["内税(税込)", "切り上げ"], "古い控えの全体の設定が取引先に写る");
  assert.equal(app.run("undo.label"), "控えから戻した");
  assert.equal(app.run("undoLast()"), true);
  assert.equal(keep(app), before, "行も設定も、戻す前と同じ");
  assert.equal(app.els["bank"].value, GOOD_BANK);
  assert.equal(JSON.parse(app.storage[CK]).bank, GOOD_BANK);
});
test("控えから戻す: 画面の操作(ファイルを選ぶ)でも動き、お知らせが出る", async () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const text = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [R("2026-10-03", "A社", "作業サービス", 1)], cfg: { clients: {}, prices: {} } });
  await app.fire("restore", "change", { target: { files: [{ text: async () => text }], value: "x" } });
  assert.equal(app.run("rows.length"), 1); assert.ok($e(app, "bmsg").textContent.includes("元に戻す"));
  app.run("undoLast()"); assert.equal(app.run("rows.length"), 3);
});

// ---- 16. 保存の失敗と、保存の案内 ----
test("保存に失敗したら、画面の上の専用の場所に出し、あとの案内で消えない。保存できたら消える", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  app.failStorage(true);
  app.run("saveRows()");
  assert.equal($e(app, "serr").hidden, false); assert.ok($e(app, "serr").textContent.includes("保存できませんでした"));
  const msg = $e(app, "serr").textContent;
  app.els["dlItem"].onclick(); app.els["dlCus"].onclick();
  assert.equal($e(app, "serr").textContent, msg, "ほかの案内で上書きされない");
  assert.ok(!$e(app, "msg").textContent.includes("保存できませんでした"));
  assert.match(html, /<p class="badge err" id="serr"[^>]*hidden>/);
  assert.ok(html.indexOf('id="serr"') < html.indexOf("<h2>はじめての手順</h2>"), "画面の上にある");
  app.failStorage(false); app.run("saveRows()");
  assert.equal($e(app, "serr").hidden, true);
});
test("保存の案内は「保存を始めました」(保存できたとは言わない)", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  for (const id of ["dlInv", "dlCus", "dlItem"]) {
    $e(app, "msg").textContent = ""; app.els[id].onclick();
    assert.ok($e(app, "msg").textContent.includes("の保存を始めました"), id); assert.ok(!$e(app, "msg").textContent.includes("保存しました"), id);
  }
  app.els["dlBackup"].onclick();
  assert.ok($e(app, "bmsg").textContent.includes("控えの保存を始めました")); assert.ok(!$e(app, "bmsg").textContent.includes("保存しました"));
});

// ================= 再確認での指摘への修正(ダミーの分離・発行日の記憶・控えの戻し) =================
const REAL = { c: "本物商事", v: "作業サービス" };
const sub = (app, id, v, type = "input") => { $e(app, id).value = v; app.fire(id, type); };
const addByForm = (app, d, c, v, h = "1", kind = "act") => { for (const [id, x] of [["date", d], ["client", c], ["service", v], ["hours", h], ["kind", kind]]) $e(app, id).value = x; app.fire("f", "submit"); };

test("ダミーの名前: 実用版は「ダミーA社・ダミーB社・ダミー作業・ダミー相談」。デモ版は決まった名前そのまま", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10";
  app.run("loadDummy()");
  const names = J(app, "[...new Set(rows.map(r=>r.client))].concat([...new Set(rows.map(r=>r.service))])").sort();
  if (DEMO) assert.deepEqual(names, ["A社", "B社", "作業サービス", "相談サービス"].sort());
  else {
    assert.deepEqual(names, ["ダミーA社", "ダミーB社", "ダミー作業", "ダミー相談"].sort());
    assert.deepEqual(J(app, "Object.keys(cfg.clients)"), ["ダミーA社", "ダミーB社"]);
    assert.deepEqual(J(app, "Object.keys(cfg.priceHist)").sort(), ["ダミー相談", "ダミー作業"].sort());
  }
});

test("ダミーを消す: ダミーの行と設定だけが消え、本物は変わらない。確認に件数が出る。元に戻すが使えなくても消せる", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-02", REAL.c, REAL.v, 3)], clients: { [REAL.c]: { code: "A010", hon: "様", reg: true } }, prices: { [REAL.v]: 5000 }, bank: GOOD_BANK, month: "2026-10" });
  const real = keep(app);
  app.run("loadDummy()");
  app.run("render()");
  assert.equal(app.run("rows.length"), 6); assert.equal(app.els["clearDummy"].disabled, false, "ダミーがあれば押せる");
  sub(app, "subject", "{y}年{m}月分 請求"); // 設定を変えて「元に戻す」が使えなくなる
  assert.equal(app.run("undo"), null);
  app.answer(false);
  assert.equal(app.run("clearDummy()"), 0); assert.equal(app.run("rows.length"), 6, "やめたら消えない");
  const m = app.confirms.at(-1);
  assert.ok(m.includes("行 5件") && m.includes("ダミーの設定 4件") && m.includes("ダミーA社") && !m.includes("振込先"), m);
  app.answer(true);
  assert.equal(app.run("clearDummy()"), 9);
  const [rs, c] = J(app, "[rows, cfg]");
  assert.deepEqual(rs.map(r => r.client), [REAL.c]);
  assert.deepEqual(Object.keys(c.clients), [REAL.c]); assert.deepEqual(Object.keys(c.priceHist), [REAL.v]);
  assert.deepEqual(Object.keys(c.prices), [REAL.v]); assert.deepEqual(c.itemReg, {});
  assert.equal(c.bank, GOOD_BANK, "本物の振込先はそのまま");
  assert.equal(JSON.stringify(J(app, "rows")), JSON.stringify(JSON.parse(real)[0]), "本物の行は同じ");
  assert.equal(JSON.stringify(c.clients), JSON.stringify(JSON.parse(real)[1].clients), "本物の取引先の設定は同じ");
  assert.equal(JSON.stringify(c.priceHist), JSON.stringify(JSON.parse(real)[1].priceHist), "本物の単価は同じ");
  app.run("render()"); assert.equal(app.els["clearDummy"].disabled, true, "もう無いので押せない");
  assert.equal(app.run("clearDummy()"), 0);
  assert.ok(app.els["toastMsg"].textContent.length > 0);
}, { skip: DEMO });
test("ダミーを消す: ダミーの振込先は空に戻る。行を手で消したあとに残った設定も消せる", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10";
  app.run("loadDummy()");
  assert.equal(app.run("cfg.bank"), BANK);
  app.run("rows=[]; render()"); // 行は手で消した。設定だけ残っている
  assert.equal(app.els["clearDummy"].disabled, false);
  assert.equal(app.run("clearDummy()"), 4);
  assert.ok(app.confirms.at(-1).includes("振込先もダミーのままなので、空にします"));
  assert.equal(app.run("cfg.bank"), ""); assert.equal(app.els["bank"].value, "");
  assert.deepEqual(J(app, "Object.keys(cfg.clients)"), []); assert.deepEqual(J(app, "Object.keys(cfg.priceHist)"), []);
  app.run("render()"); assert.equal(app.els["clearDummy"].disabled, true);
  assert.equal(JSON.parse(app.storage[CK]).bank, "", "保存もされる");
}, { skip: DEMO });
test("ダミーを消す(デモ版): ボタンを隠し、何も消さない", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10"; app.run("loadDummy()");
  assert.equal(app.els["clearDummy"].hidden, true); assert.equal(app.els["clearNote"].hidden, true);
  assert.equal(app.run("clearDummy()"), 0); assert.equal(app.run("rows.length"), 5);
}, { skip: !DEMO });

test("ダミーの単価が本物に漏れない: ダミー→振込先を本物に変更→ダミーの行を手で削除→本物の行を入れても、単価は未設定で止まる", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10"; app.run("setDates()");
  app.run("loadDummy()");
  sub(app, "bank", GOOD_BANK); // 警告のとおり、振込先を本物に変える(設定を変えたので、ダミーの「元に戻す」は消える)
  assert.equal(app.run("undo"), null);
  app.run("rows=[]; render()");
  addByForm(app, "2026-10-05", REAL.c, REAL.v, "2");
  assert.equal(app.run("priceFor(" + JSON.stringify(REAL.v) + ",'2026-10')"), "", "ダミーの3000円は使われない");
  assert.ok(app.run("problems()").some(x => x.includes("単価が未設定") && x.includes(REAL.v)));
  assert.equal(app.els["dlInv"].disabled, true);
  assert.equal(parseCsvLine(app.run("invoiceCsv()").split("\r\n")[1])[14], "", "CSVの単価も空");
}, { skip: DEMO });

test("架空の振込先: ダミーの行だけを出すときは通す。本物の行が1つでも入るなら止める", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10"; app.run("setDates()");
  app.run("loadDummy(); render()");
  assert.equal(app.run("cfg.bank"), BANK);
  assert.ok(!app.run("problems()").some(x => x.includes("架空")), "試すだけなら通す");
  assert.equal(app.els["dlInv"].disabled, false);
  // 本物の行を足す
  app.run("cfg.clients[" + JSON.stringify(REAL.c) + "]={code:'A010',hon:'御中',reg:true}; setPrice(" + JSON.stringify(REAL.v) + ",'2026-10',5000)");
  addByForm(app, "2026-10-06", REAL.c, REAL.v, "1");
  assert.ok(app.run("problems()").some(x => x.includes("振込先が架空(ダミー)のままです")));
  assert.equal(app.els["dlInv"].disabled, true);
  // 取引先だけ本物(サービスはダミー)の行も、本物とみなして止める
  app.run("rows=rows.filter(r=>r.client!==" + JSON.stringify(REAL.c) + ")");
  addByForm(app, "2026-10-07", REAL.c, "ダミー作業", "1");
  assert.equal(app.els["dlInv"].disabled, true);
  app.run("rows=rows.filter(r=>r.client!==" + JSON.stringify(REAL.c) + "); render()");
  assert.equal(app.els["dlInv"].disabled, false);
  assert.match(html, /試したあとは、<button[^>]*id="clearDummy"[^>]*>ダミーを消す<\/button>/);
}, { skip: DEMO });
test("架空の振込先(デモ版): 止めない", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10"; app.run("loadDummy()");
  assert.ok(!app.run("problems()").some(x => x.includes("架空")));
}, { skip: !DEMO });

// ---- 3. 発行日・期限を月ごとに覚える ----
test("発行日・期限: 手で直した値を、月ごとに覚える。ほかの月は月末のまま。開き直しても残る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK, month: "2026-10" });
  sub(app, "issue", "2026-11-05", "change"); sub(app, "due", "2026-11-25", "change");
  assert.deepEqual(J(app, 'cfg.dates["2026-10"]'), { issue: "2026-11-05", due: "2026-11-25" });
  assert.deepEqual(JSON.parse(app.storage[CK]).dates["2026-10"], { issue: "2026-11-05", due: "2026-11-25" }, "保存される");
  sub(app, "month", "2026-11", "change");
  assert.equal(app.els["issue"].value, "2026-11-30"); assert.equal(app.els["due"].value, "2026-12-31", "ほかの月は月末");
  assert.ok($e(app, "dnote").textContent.includes("月が変わった"));
  sub(app, "month", "2026-10", "change");
  assert.equal(app.els["issue"].value, "2026-11-05"); assert.equal(app.els["due"].value, "2026-11-25");
  assert.ok($e(app, "dnote").textContent.includes("前に直した"));
  assert.ok(csvCol(app, 1, 1) === "2026-11-05" && csvCol(app, 1, 2) === "2026-11-25", "CSVにも使われる");
  // 追加しても戻らない
  addByForm(app, "2026-10-20", "A社", "作業サービス");
  assert.equal(app.els["issue"].value, "2026-11-05");
  // 開き直し(同じ保存場所を読む別の画面)
  const app2 = makeApp({ storage: app.storage });
  app2.els["month"].value = "2026-10"; app2.fire("month", "change");
  assert.equal(app2.els["issue"].value, "2026-11-05"); assert.equal(app2.els["due"].value, "2026-11-25");
  // 空にしたら、その分は月末に戻る
  sub(app, "issue", "", "change");
  assert.equal(J(app, 'cfg.dates["2026-10"]').issue, undefined); assert.equal(J(app, 'cfg.dates["2026-10"]').due, "2026-11-25");
  sub(app, "due", "", "change");
  assert.equal(app.run('"2026-10" in cfg.dates'), false);
  sub(app, "month", "2026-09", "change"); sub(app, "month", "2026-10", "change");
  assert.equal(app.els["issue"].value, "2026-10-31");
});
test("発行日・期限: 控えに入って戻る。古い控え・保存データは空で始まる。不正な値は取り込まない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, month: "2026-10" });
  assert.deepEqual(J(app, "cfg.dates"), {});
  sub(app, "issue", "2026-11-03", "change");
  assert.deepEqual(J(app, "parseBackup(buildBackup())").cfg.dates, { "2026-10": { issue: "2026-11-03" } });
  const mk = cfg => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg });
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: {} }))})`).cfg.dates, {}, "古い控え");
  const bad = { "2026-1": { issue: "2026-01-01" }, "2026-12": { issue: "2026-12-31", due: "あした" }, "2027-01": "x", "2027-02": { issue: 5 }, "2027-03": { due: "2027-04-30" }, "2027-04": null };
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: {}, dates: bad }))})`).cfg.dates, { "2026-12": { issue: "2026-12-31" }, "2027-03": { due: "2027-04-30" } });
  app.storage[CK] = JSON.stringify({ clients: {}, prices: {}, bank: "b" }); app.run("loadState()");
  assert.deepEqual(J(app, "cfg.dates"), {}, "古い保存データ");
});

// ---- N3 / N4. 控えから戻す ----
test("控えから戻す: 取引先コードの通し番号は下がらない。確認の文は、戻せる条件を正しく伝える", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  app.run("cfg.codeSeq=9");
  const mk = (clients, extra = {}) => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg: { clients, prices: {}, ...extra } });
  assert.equal(app.run(`applyBackup(parseBackup(${JSON.stringify(mk({ "Q社": { code: "A003" } }, { codeSeq: 2 }))}))`), true);
  assert.equal(app.run("cfg.codeSeq"), 9, "控えの番号が小さくても、今の番号を保つ");
  const m = app.confirms.at(-1);
  assert.ok(m.includes("置き換えた直後なら「元に戻す」で戻せます(設定を変えたり、開き直したりすると戻せません)。念のため、先に今の内容を「控えを保存」で残してください。"), m);
  assert.ok(!m.includes("置き換えたあとも"));
  app.run("ensureClients(); rows.push(" + JSON.stringify(R("2026-10-01", "新社", "作業サービス", 1)) + "); ensureClients()");
  assert.equal(app.run("cfg.clients['新社'].code"), "A010", "次の番号は 9 の次");
  assert.equal(app.run(`applyBackup(parseBackup(${JSON.stringify(mk({ "Q社": { code: "A003" } }, { codeSeq: 20 }))}))`), true);
  assert.equal(app.run("cfg.codeSeq"), 20, "控えの番号が大きければそちら");
  assert.equal(app.run(`applyBackup(parseBackup(${JSON.stringify(mk({ "Q社": { code: "A031" } }))}))`), true);
  assert.equal(app.run("cfg.codeSeq"), 31, "控えのコードの中の最大も数える");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

// ================= 品目ごとの単位(時間 / 回)と、開始・終了の時刻 =================
const KAI = "相談サービス", JIKAN = "作業サービス"; // どちらの版でも使える名前。KAI のほうを「回」にして試す
const setKai = app => { app.run("cfg.units[" + JSON.stringify(KAI) + "]='回'; render()"); };
const kaiApp = (rowList = []) => { const app = makeApp(); app.setup({ rows: rowList, clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK, month: "2026-10" }); setKai(app); return app; };

test("単位: 古い保存データ・古い控えでは、すべて「時間」で始まる。正しくない値・サービスに無い名前は捨てる", () => {
  const app = makeApp();
  app.storage[SK] = JSON.stringify([R("2026-10-01", "A社", "作業", 1)]);
  app.storage[CK] = JSON.stringify({ clients: { "A社": A }, prices: { "作業": 100, "相談": 200 }, bank: "b" });
  app.run("loadState()");
  assert.deepEqual(J(app, "cfg.units"), { "作業": "時間", "相談": "時間" });
  app.storage[CK] = JSON.stringify({ clients: {}, prices: { "作業": 100, "相談": 200 }, units: { "作業": "回", "相談 ": "月", "ゴースト": "回", "Ｘ": "時間" }, bank: "b" });
  app.run("loadState()");
  assert.deepEqual(J(app, "cfg.units"), { "作業": "回", "相談": "時間" });
  const mk = cfg => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg });
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "作業": 1 } }))})`).cfg.units, { "作業": "時間" }, "古い控え");
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "作業": 1, "相談": 1 }, units: { "作業": "回", "相談": 3 } }))})`).cfg.units, { "作業": "回", "相談": "時間" });
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("単位: 控えに入って戻る。名前を変えると付いて行き、削除すると消える", () => {
  const app = kaiApp([R("2026-10-03", "A社", JIKAN, 1), R("2026-10-04", "A社", KAI, 2)]);
  assert.deepEqual(J(app, "parseBackup(buildBackup())").cfg.units, { [JIKAN]: "時間", [KAI]: "回" });
  app.run("saveCfg()");
  assert.equal(JSON.parse(app.storage[CK]).units[KAI], "回", "保存もされる");
  if (!DEMO) {
    app.run("rows=rows.filter(r=>r.service!==" + JSON.stringify(KAI) + ")");
    assert.equal(J(app, `renameName("service",${JSON.stringify(KAI)},"回の相談")`).ok, true);
    assert.deepEqual(J(app, "cfg.units"), { [JIKAN]: "時間", "回の相談": "回" });
    assert.equal(J(app, 'deleteName("service","回の相談")').ok, true);
    assert.deepEqual(J(app, "cfg.units"), { [JIKAN]: "時間" });
  } else {
    app.run("rows=rows.filter(r=>r.service!==" + JSON.stringify(KAI) + ")");
    assert.equal(J(app, `deleteName("service",${JSON.stringify(KAI)})`).ok, true);
    assert.ok(!(KAI in J(app, "cfg.units")));
  }
});

test("単位: 明細CSVの単位の列は品目の単位、数量はその数。見本のファイル(時間)は変わらない。品目CSVの単位も同じ", () => {
  const app = kaiApp([R("2026-10-03", "A社", JIKAN, 1.5), R("2026-10-17", "A社", KAI, 2)]);
  const L = app.run("invoiceCsv()").split("\r\n"), c = parseCsvLine(L[1]), d = parseCsvLine(L[2]);
  assert.deepEqual([c[8], c[9], c[10], c[11], c[14]], ["2026-10-03", JIKAN, "1.5", "時間", "3000"]);
  assert.deepEqual([d[8], d[9], d[10], d[11], d[14]], ["2026-10-17", KAI, "2", "回", "4000"]);
  const it = app.run("itemCsv()").split("\r\n");
  assert.deepEqual(parseCsvLine(it[1]), [JIKAN, "3000", "時間", "10%", "なし"]);
  assert.deepEqual(parseCsvLine(it[2]), [KAI, "4000", "回", "10%", "なし"]);
  assert.ok(app.els["out"].value.includes("2回") && app.els["out"].value.includes("1.5h"), "画面の見出しにも単位");
  assert.match(app.els["out"].value, /合計 1\.5 時間・2 回/);
});

test("回の入力: 1以上の整数だけ。時間は0以上の数。追加・更新・画面の追加ボタンで確かめる", () => {
  const app = kaiApp();
  const add = (h, s = KAI) => app.run("addRow({date:'2026-10-05',client:'A社',service:" + JSON.stringify(s) + ",hours:" + h + ",kind:'act'})");
  assert.equal(add(1.5), null); assert.equal(add(0), null); assert.equal(add(-1), null); assert.equal(add("NaN"), null);
  assert.equal(add(2).hours, 2);
  assert.equal(add(0.25, JIKAN).hours, 0.25, "時間は小数でよい"); assert.equal(add(0, JIKAN).hours, 0);
  assert.equal(app.run("updateRow(rows[0].id,{date:'2026-10-05',client:'A社',service:" + JSON.stringify(KAI) + ",hours:2.5,kind:'act'})"), null);
  assert.equal(app.run("rows.length"), 3);
  assert.equal(app.run("qtyError(" + JSON.stringify(KAI) + ",1)"), "");
  assert.equal(app.run("qtyError(" + JSON.stringify(KAI) + ",1.5)"), "回数は、1以上の整数で入れてください。");
  // 画面から
  for (const [id, v] of [["date", "2026-10-06"], ["client", "A社"], ["service", KAI], ["hours", "1.5"], ["kind", "act"]]) $e(app, id).value = v;
  app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 3); assert.equal($e(app, "fmsg").textContent, "回数は、1以上の整数で入れてください。");
  $e(app, "hours").value = "3"; app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 4); assert.equal(app.run("rows[3].hours"), 3);
  assert.equal($e(app, "hours").value, "1", "追加のあとは、回数の初めの値(1)に戻る");
});
test("回の入力: 回数が整数でない行は請求書を止める。0回は止めない警告", () => {
  const app = kaiApp([R("2026-10-05", "A社", KAI, 1.5), R("2026-10-06", "A社", JIKAN, 1)]);
  const w = app.run("problems()").find(x => x.includes("回数が整数でない"));
  assert.ok(w && !w.startsWith("※") && w.includes("1.5回"), w);
  assert.equal(app.els["dlInv"].disabled, true);
  app.setup({ rows: [R("2026-10-05", "A社", KAI, 0), R("2026-10-06", "A社", JIKAN, 0)], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  setKai(app);
  const P = app.run("problems()");
  assert.ok(P.some(x => x.startsWith("※") && x.includes("時間が0の行が1件")) && P.some(x => x.startsWith("※") && x.includes("回数が0の行が1件")));
  assert.equal(app.els["dlInv"].disabled, false);
});

test("入れる欄: サービスが「回」なら「回数」(初めは1・整数)、「時間」なら「時間(h)」に切り替わる。開始・終了は時間のときだけ", () => {
  const app = kaiApp();
  assert.equal($e(app, "qtyText").textContent, "時間(h)");
  $e(app, "service").value = KAI; app.fire("service", "input");
  assert.equal($e(app, "qtyText").textContent, "回数"); assert.equal($e(app, "hours").value, "1");
  assert.equal($e(app, "hours").step, "1"); assert.equal($e(app, "hours").min, "1");
  assert.equal($e(app, "tmStartL").hidden, true); assert.equal($e(app, "tmStart").disabled, true); assert.equal($e(app, "tmEnd").disabled, true);
  $e(app, "service").value = JIKAN; app.fire("service", "input");
  assert.equal($e(app, "qtyText").textContent, "時間(h)"); assert.equal($e(app, "hours").value, "", "自動で入れた1は消す");
  assert.equal($e(app, "hours").step, "any"); assert.equal($e(app, "hours").min, "0");
  assert.equal($e(app, "tmStartL").hidden, false); assert.equal($e(app, "tmStart").disabled, false);
  // 自分で入れた数は消さない
  $e(app, "service").value = KAI; app.fire("service", "input"); $e(app, "hours").value = "3"; app.fire("hours", "input");
  $e(app, "service").value = JIKAN; app.fire("service", "input");
  assert.equal($e(app, "hours").value, "3");
  // 候補の選択欄から選んだときも切り替わる
  $e(app, "servicePick").value = KAI; app.fire("servicePick", "change");
  assert.equal($e(app, "qtyText").textContent, "回数");
  assert.match(html, /<span id="qtyText">時間\(h\)<\/span>/);
});

test("一覧と合計: 数量に単位を付けて出す。合計は取引先ごとに、時間と回数を分ける", () => {
  const app = kaiApp([R("2026-10-03", "A社", JIKAN, 1.5), R("2026-10-04", "A社", JIKAN, 3), R("2026-10-05", "A社", KAI, 2), R("2026-10-06", "A社", KAI, 1), R("2026-10-07", "A社", KAI, 1, "plan"), R("2026-10-08", "B社", JIKAN, 1, "plan"), R("2026-10-09", "C社", KAI, 2, "plan")]);
  const t = J(app, "totals()");
  assert.deepEqual(t.map(x => [x.client, x.act, x.actN, x.plan, x.planN]), [["A社", 4.5, 3, 0, 1], ["B社", 0, 0, 1, 0], ["C社", 0, 0, 0, 2]]);
  assert.equal(app.run("totalText(totals()[0])"), "実績 4.5時間・3回 / 予定 1回");
  assert.equal(app.run("totalText(totals()[1])"), "実績 0時間 / 予定 1時間");
  assert.equal(app.run("totalText(totals()[2])"), "実績 0時間 / 予定 2回");
  assert.ok(textOf(app.els["totals"]).includes("A社: 実績 4.5時間・3回 / 予定 1回"));
  const list = textOf(app.els["planList"]) + textOf(app.els["actList"]);
  assert.ok(list.includes("1.5時間") && list.includes("2回"), list);
});

test("単位を変える: その品目を使っている行があれば、行数を見せて確かめる。使っていなければそのまま。設定の表の選択欄からも変えられる", () => {
  const app = kaiApp([R("2026-10-05", "A社", JIKAN, 1), R("2026-10-06", "A社", JIKAN, 2)]);
  app.answer(false);
  assert.equal(J(app, `setUnit(${JSON.stringify(JIKAN)},"回")`).ok, false);
  assert.equal(app.confirms.at(-1), "この品目の2行の数量の意味が変わります(たとえば 1.5時間 が 1.5回 になります)。よろしいですか?");
  assert.equal(app.run("unitOf(" + JSON.stringify(JIKAN) + ")"), "時間", "やめたら変わらない");
  app.answer(true);
  const r = J(app, `setUnit(${JSON.stringify(JIKAN)},"回")`);
  assert.equal(r.ok, true); assert.ok(r.msg.includes("2行"));
  assert.equal(app.run("unitOf(" + JSON.stringify(JIKAN) + ")"), "回"); assert.equal(JSON.parse(app.storage[CK]).units[JIKAN], "回");
  const n = app.confirms.length;
  app.run("rows=[]; render()");
  assert.equal(J(app, `setUnit(${JSON.stringify(JIKAN)},"時間")`).ok, true); assert.equal(app.confirms.length, n, "使っていなければ確認なし");
  assert.equal(J(app, `setUnit(${JSON.stringify(JIKAN)},"年")`).ok, false); assert.equal(J(app, `setUnit("無い品目","回")`).ok, false);
  // 編集の画面で単位を変える: 行があれば確かめる。やめれば、画面は開いたまま・変わらない
  const b2 = kaiApp([R("2026-10-05", "A社", JIKAN, 1), R("2026-10-06", "A社", JIKAN, 2)]);
  b2.run("openItemDialog(" + JSON.stringify(JIKAN) + ")");
  $e(b2, "itUnit").value = "回"; b2.answer(false); b2.fire("itSave", "click");
  assert.equal(b2.run("unitOf(" + JSON.stringify(JIKAN) + ")"), "時間"); assert.equal($e(b2, "dlgItem").open, true, "やめたら画面は開いたまま");
  assert.ok($e(b2, "itMsg").textContent.includes("単位は変えませんでした"));
  b2.answer(true); b2.fire("itSave", "click");
  assert.equal(b2.run("unitOf(" + JSON.stringify(JIKAN) + ")"), "回"); assert.equal($e(b2, "dlgItem").open, false);
  assert.ok(b2.confirms.at(-1).includes("この品目の2行の数量の意味が変わります"));
});
test("品目の先登録: 単位を選べる(初めは時間)。正しくない単位は時間にする", () => {
  const app = makeApp();
  app.setup({ rows: [], month: "2026-10" });
  assert.equal(J(app, 'addItem("通所","500","回")').ok, true);
  assert.equal(J(app, 'addItem("作業A","500")').ok, true);
  assert.equal(J(app, 'addItem("作業B","500","週")').ok, true);
  assert.deepEqual(J(app, "cfg.units"), { "通所": "回", "作業A": "時間", "作業B": "時間" });
  assert.match(html, /<select id="itUnit">/);
  assert.equal(parseCsvLine(app.run("itemCsv()").split("\r\n")[1])[2], "回");
}, { skip: DEMO });

test("開始・終了: 時間が出る(9:30〜11:15 は 1.75)。終了が開始より後でなければ入れない", () => {
  const app = kaiApp();
  assert.deepEqual(J(app, 'calcHours("09:30","11:15")'), { ok: true, hours: 1.75 });
  assert.equal(app.run('calcHours("09:00","09:40").hours'), 0.67, "小数2桁まで");
  for (const [a, b] of [["10:00", "09:00"], ["10:00", "10:00"]]) { const r = J(app, `calcHours("${a}","${b}")`); assert.equal(r.ok, false); assert.equal(r.msg, "終了は開始より後の時刻にしてください(日をまたぐ時間は、時間の欄に直接入れてください)"); }
  $e(app, "service").value = JIKAN; app.fire("service", "input");
  $e(app, "tmStart").value = "09:30"; app.fire("tmStart", "change");
  assert.equal($e(app, "hours").value, "", "片方だけでは入れない");
  $e(app, "tmEnd").value = "11:15"; app.fire("tmEnd", "change");
  assert.equal($e(app, "hours").value, "1.75"); assert.equal($e(app, "fmsg").textContent, "");
  $e(app, "hours").value = ""; $e(app, "tmEnd").value = "09:00"; app.fire("tmEnd", "change");
  assert.equal($e(app, "hours").value, "", "入れない"); assert.equal($e(app, "fmsg").textContent, "終了は開始より後の時刻にしてください(日をまたぐ時間は、時間の欄に直接入れてください)");
});
test("開始・終了: 行に保存され、一覧と画面の見出しに出る。編集で戻り、直せる。回の品目には付かない。明細CSVには出る", () => {
  const app = kaiApp();
  const fill = (s, extra) => { for (const [id, v] of [["date", "2026-10-05"], ["client", "A社"], ["service", s], ["hours", ""], ["kind", "act"], ["tmStart", ""], ["tmEnd", ""], ...extra]) $e(app, id).value = v; app.fire("service", "input"); };
  fill(JIKAN, [["tmStart", "09:30"], ["tmEnd", "11:15"]]); app.fire("tmEnd", "change");
  app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1);
  assert.deepEqual(J(app, "[rows[0].hours, rows[0].start, rows[0].end]"), [1.75, "09:30", "11:15"]);
  assert.deepEqual(JSON.parse(app.storage[SK])[0].start, "09:30");
  const det = findAll(app.els["actList"], c => c.className === "cdetail").map(c => c.textContent);
  assert.equal(det[0], JIKAN + " ・ 9:30〜11:15(1.75時間)", "カードに時間帯と時間が出る");
  app.run("render()"); assert.ok(app.els["out"].value.includes("(9:30〜11:15)"), app.els["out"].value);
  // 編集で欄に戻る
  app.run("startEdit(rows[0])");
  assert.equal($e(app, "tmStart").value, "09:30"); assert.equal($e(app, "tmEnd").value, "11:15");
  $e(app, "tmEnd").value = "12:00"; app.fire("tmEnd", "change"); assert.equal($e(app, "hours").value, "2.5");
  app.fire("f", "submit");
  assert.deepEqual(J(app, "[rows[0].hours, rows[0].start, rows[0].end]"), [2.5, "09:30", "12:00"]);
  assert.equal($e(app, "tmStart").value, "", "更新のあとは欄を空にする");
  // 片方だけ・順番が逆は保存しない
  fill(JIKAN, [["hours", "1"], ["tmStart", "09:00"]]); app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1); assert.ok($e(app, "fmsg").textContent.includes("両方"));
  fill(JIKAN, [["hours", "1"], ["tmStart", "10:00"], ["tmEnd", "09:00"]]); app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1); assert.ok($e(app, "fmsg").textContent.startsWith("終了は開始より後"));
  // 回の品目には付かない
  fill(KAI, [["hours", "2"]]); app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 2); assert.equal(app.run("rows[1].start"), undefined);
  assert.equal(app.run("addRow({date:'2026-10-07',client:'A社',service:" + JSON.stringify(KAI) + ",hours:1,kind:'act',start:'09:00',end:'10:00'}).start"), undefined);
  // 明細CSVの 開始・終了 の列に出る(回の行は空)。品目CSVには入らない
  const cs = app.run("invoiceCsv()").split("\r\n").slice(1, 4).map(parseCsvLine);
  assert.deepEqual(cs.map(r => [r[9], r[12], r[13]]), [[JIKAN, "09:30", "12:00"], [KAI, "", ""], [KAI, "", ""]]);
  assert.ok(!app.run("itemCsv()").includes("09:30"));
});
test("開始・終了: 控えに入って戻る。正しくない時刻・片方だけ・順番が逆の控えは断る。無いのは問題ない", () => {
  const app = kaiApp([{ ...R("2026-10-05", "A社", JIKAN, 1.5), start: "09:30", end: "11:00" }, R("2026-10-06", "A社", JIKAN, 1)]);
  const b = J(app, "parseBackup(buildBackup())");
  assert.deepEqual([b.rows[0].start, b.rows[0].end, b.rows[1].start], ["09:30", "11:00", undefined]);
  const mk = rows => JSON.stringify({ app: "seikyu-matome", version: 1, rows, cfg: { clients: {}, prices: {} } });
  const row = extra => ({ date: "2026-10-05", client: "A社", service: JIKAN, hours: 1, kind: "act", ...extra });
  for (const bad of [{ start: "9:30", end: "11:00" }, { start: "09:30" }, { end: "11:00" }, { start: "11:00", end: "09:00" }, { start: "09:30", end: "25:00" }, { start: 930, end: 1100 }])
    assert.throws(() => app.run(`parseBackup(${JSON.stringify(mk([row(bad)]))})`), undefined, JSON.stringify(bad));
  assert.doesNotThrow(() => app.run(`parseBackup(${JSON.stringify(mk([row({}), row({ start: null, end: null })]))})`));
  // 画面の操作で戻す
  assert.equal(app.run(`applyBackup(parseBackup(${JSON.stringify(mk([row({ start: "08:00", end: "09:15" })]))}))`), true);
  assert.deepEqual(J(app, "[rows[0].start, rows[0].end]"), ["08:00", "09:15"]);
});

test("ダミー: 実用版のダミー相談は「回」(1回)、デモ版はどちらも時間。ダミーの先頭の行には開始・終了がある", () => {
  const app = makeApp();
  app.els["month"].value = "2026-10"; app.run("setDates()");
  app.run("loadDummy(); render()");
  const v2 = DEMO ? "相談サービス" : "ダミー相談", v1 = DEMO ? "作業サービス" : "ダミー作業";
  assert.equal(app.run("unitOf(" + JSON.stringify(v1) + ")"), "時間");
  assert.equal(app.run("unitOf(" + JSON.stringify(v2) + ")"), DEMO ? "時間" : "回");
  assert.deepEqual(J(app, "rows.filter(r=>r.service===" + JSON.stringify(v2) + ").map(r=>r.hours)"), [1]);
  assert.deepEqual(J(app, "[rows[0].start, rows[0].end]"), ["09:00", "10:30"]);
  const CL = app.run("invoiceCsv()").split("\r\n").slice(1, -1).map(parseCsvLine);
  assert.deepEqual([CL.find(r => r[9] === v1)[11], CL.find(r => r[9] === v2)[11]], ["時間", DEMO ? "時間" : "回"]);
  assert.deepEqual([CL[0][12], CL[0][13]], ["09:00", "10:30"], "開始・終了の列にも出る");
  assert.equal(app.run("undoLast()"), true); assert.deepEqual(J(app, "cfg.units"), {}, "元に戻すと単位の設定も戻る");
  assert.match(html, /版: 3\.0\.0\(2026-10-25\)/);
});

test("追加の入力が足りないとき、行は増えず、画面の文で理由が出る(ブラウザの吹き出しに頼らない)", () => {
  const app = makeApp();
  app.setup({ rows: [], clients: {}, prices: {} });
  const cases = [
    [{ date: "", client: "A社", service: "作業サービス", hours: "1" }, "日付を入れてください"],
    [{ date: "2026-10-01", client: " ", service: "作業サービス", hours: "1" }, "取引先を入れてください"],
    [{ date: "2026-10-01", client: "A社", service: "", hours: "1" }, "サービスを入れてください"],
    [{ date: "2026-10-01", client: "A社", service: "作業サービス", hours: "" }, "時間を入れてください"],
  ];
  for (const [v, msg] of cases) {
    for (const [id, val] of Object.entries(v)) $e(app, id).value = val;
    $e(app, "kind").value = "act";
    app.fire("f", "submit");
    assert.ok($e(app, "fmsg").textContent.includes(msg), msg + " が出ません: " + $e(app, "fmsg").textContent);
    assert.equal(app.run("rows.length"), 0, "行が増えてはいけない");
  }
});
test("保存してある行が壊れていても(null や日付なし)、読み込みで止まらず、壊れた行だけ捨てる", () => {
  const SK2 = SK;
  const app = makeApp({ storage: { [SK2]: JSON.stringify([null, {}, { id: 1, date: "2026-10-03", client: "A社", service: "作業サービス", hours: 1, kind: "act" }, { date: 5, client: "X", service: "Y" }]) } });
  assert.equal(app.run("rows.length"), 1);
});
test("選択欄: 候補が無いときは隠し(開いても何も出ない欄を見せない)、候補ができたら出す", () => {
  const app = makeApp();
  assert.equal(app.run('$("clientPick").hidden'), DEMO ? false : true);
  if (!DEMO) {
    assert.ok(textOf(app.run('$("pickHelp")')) !== undefined);
    app.setup({ rows: [R("2026-10-01", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: PRICES });
    assert.equal(app.run('$("clientPick").hidden'), false);
    assert.equal(app.run('$("servicePick").hidden'), false);
  }
});
// ================= 税区分・源泉徴収は品目ごと。消費税の表示・端数処理は取引先ごと(折りたたみ) =================
const WH10 = "10%", WH21 = "10.21%";
const TAXDEF = { taxMode: "外税(税別)", round: "切り捨て" };
const twoClients = (a, b) => {
  const app = makeApp();
  const rs = [R("2026-10-03", "A社", "作業サービス", 1.5), R("2026-10-03", "B社", "作業サービス", 1.5)];
  app.setup({ rows: rs, clients: { "A社": { ...A, ...a }, "B社": { ...B, ...b } }, prices: PRICES, bank: GOOD_BANK });
  return app;
};
const lines2 = app => app.run("invoiceCsv()").split("\r\n").slice(1, 3).map(parseCsvLine);
const setItemTax = (app, s, o) => app.run("Object.assign(cfg.itemTax[" + JSON.stringify(s) + "]," + JSON.stringify(o) + "); render()");
const itemCols = (row, k) => row.slice(23 + 7 * k, 23 + 7 * k + 7);

test("税の設定: 全体の選択欄は無い。取引先の表に税の選択欄は無い。選択肢は決まった3つずつ", () => {
  const app = twoClients({}, {});
  assert.ok(!/id="tax(Mode|Rate|Round|Wh)"/.test(html));
  assert.equal(app.run("typeof cfg.tax"), "undefined");
  const opt = J(app, "TAX_OPT");
  assert.deepEqual(Object.keys(opt), ["mode", "round", "wh"]);
  assert.deepEqual(opt.mode, ["外税(税別)", "内税(税込)", "内税(免税事業者)"]); assert.deepEqual(opt.round, ["切り捨て", "切り上げ", "四捨五入"]); assert.deepEqual(opt.wh, ["なし", "10%", "10.21%"]);
  assert.deepEqual(J(app, "KUBUN"), ["", "8%(軽減)", "非課税"]);
  assert.match(SOURCE, /標準は「10%」/);
  assert.equal(findAll(app.els["cfgClients"], c => c.tagName === "select" || c.tagName === "input").length, 0, "取引先の表は見るだけ");
  assert.ok(SOURCE.includes("<th>敬称</th><th>消費税の表示・端数処理</th><th>請求書ソフトに登録済み</th>"));
  assert.equal(app.run("'wh' in cfg.clients['A社']"), false, "取引先は源泉徴収を持たない");
});

test("引っ越し(源泉徴収): 古い版の取引先ごとの源泉徴収を、品目の源泉徴収に写す。決まりどおりに写り、何度読んでも同じ", () => {
  const app = makeApp();
  const row = (d, c, s) => R("2026-10-" + d, c, s, 1);
  app.storage[SK] = JSON.stringify([row("01", "B社", "s2"), row("02", "C社", "s2"), row("03", "B社", "s4"), row("04", "A社", "s5")]);
  app.storage[CK] = JSON.stringify({
    clients: { "A社": { code: "A001", hon: "御中", reg: false }, "B社": { code: "A002", hon: "御中", reg: false, wh: "なし" }, "C社": { code: "A003", hon: "御中", reg: false, wh: WH21 } },
    prices: { s1: 1, s2: 1, s3: 1, s4: 1, s5: 1, s6: 1 }, bank: "b", tax: { mode: "内税(税込)", rate: "10%", round: "切り上げ", wh: WH10 },
    itemTax: { s1: { kubun: "8%(軽減)", wh: "適用する" }, s2: { kubun: "", wh: "" }, s3: { kubun: "", wh: "適用しない" }, s4: { kubun: "非課税", wh: "" }, s6: { kubun: "", wh: "x" } }
  });
  // s1: 適用する → 古いデータで源泉ありだった最初の取引先(A社: 全体の設定を引き継いで 10%)の率
  // s2: 空欄 → 使う行のうち源泉ありの取引先の最初の行(C社 → 10.21%)。s3: 適用しない → なし。s4: 空欄で、使うのはなしの取引先だけ → なし
  // s5: 項目なし → 使うA社(10%)の率。s6: 正しくない値 → なし
  const want = { s1: { kubun: "8%(軽減)", wh: WH10 }, s2: { kubun: "", wh: WH21 }, s3: { kubun: "", wh: "なし" }, s4: { kubun: "非課税", wh: "なし" }, s5: { kubun: "", wh: WH10 }, s6: { kubun: "", wh: "なし" } };
  app.run("loadState()");
  assert.deepEqual(J(app, "cfg.itemTax"), want);
  assert.equal(app.run("typeof cfg.tax"), "undefined");
  assert.deepEqual(J(app, "Object.values(cfg.clients).map(c=>[c.taxMode,c.round,'wh' in c])"), [["内税(税込)", "切り上げ", false], ["内税(税込)", "切り上げ", false], ["内税(税込)", "切り上げ", false]]);
  app.run("store(CKEY,cfg); loadState()");
  assert.deepEqual(J(app, "cfg.itemTax"), want, "保存して読み直しても同じ(二重に引っ越さない)");
  // 全体の設定が無く、取引先だけが源泉ありだった古いデータ
  const b = makeApp();
  b.storage[SK] = JSON.stringify([row("01", "C社", "s1")]);
  b.storage[CK] = JSON.stringify({ clients: { "C社": { code: "A001", hon: "御中", reg: false, wh: WH21 } }, prices: { s1: 1, s2: 1 }, bank: "b", itemTax: { s1: { kubun: "", wh: "" }, s2: { kubun: "", wh: "適用する" } } });
  b.run("loadState()");
  assert.deepEqual(J(b, "cfg.itemTax"), { s1: { kubun: "", wh: WH21 }, s2: { kubun: "", wh: WH21 } });
  // 何も無い古いデータは、すべてなし
  const c = makeApp();
  c.storage[CK] = JSON.stringify({ clients: { "A社": { code: "A001", hon: "御中", reg: false } }, prices: { s1: 1 }, bank: "b" });
  c.run("loadState()");
  assert.deepEqual(J(c, "cfg.itemTax"), { s1: { kubun: "", wh: "なし" } });
  // 古い控えも同じ決まりで写る(行は控えの中の行を使う)
  const mk = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [R("2026-10-01", "C社", "作業サービス", 1)], cfg: { clients: { "C社": { code: "A1", wh: WH21 } }, prices: { "作業サービス": 1 }, itemTax: { "作業サービス": { kubun: "", wh: "" } } } });
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk)})`).cfg.itemTax, { "作業サービス": { kubun: "", wh: WH21 } });
});

test("明細CSVの源泉徴収: 行ごとに、その品目の源泉徴収(なし / あり…)。率が違う品目が混ざっても止めない", () => {
  const app = twoClients({}, {});
  assert.deepEqual(lines2(app).map(r => r[17]), ["なし", "なし"]);
  setItemTax(app, "作業サービス", { wh: WH10 });
  assert.deepEqual(lines2(app).map(r => r[17]), [WH10, WH10]);
  // A社だけ、率が違う品目を足す
  setItemTax(app, "相談サービス", { wh: WH21 });
  app.run("rows.push(" + JSON.stringify(R("2026-10-04", "A社", "相談サービス", 1)) + "); render()");
  const L = app.run("invoiceCsv()").split("\r\n").slice(1, 4).map(parseCsvLine);
  assert.deepEqual(L.map(r => [r[4], r[9], r[17]]), [["A社", "作業サービス", WH10], ["A社", "相談サービス", WH21], ["B社", "作業サービス", WH10]]);
  assert.ok(!app.run("problems()").some(x => x.includes("混ざって")));
  assert.equal(app.els["dlInv"].disabled, false, "止めない");
});
test("明細CSVの税区分と源泉徴収: 初めは 10% / なし。品目の設定が、そのまま行に出る", () => {
  const d = twoClients({}, {});
  for (const row of lines2(d)) assert.deepEqual(row.slice(16, 18), ["10%", "なし"]);
  const app = twoClients({}, {});
  app.run("rows.push(" + JSON.stringify(R("2026-10-04", "A社", "相談サービス", 1)) + "); render()");
  setItemTax(app, "作業サービス", { kubun: "8%(軽減)", wh: WH10 }); setItemTax(app, "相談サービス", { kubun: "非課税" });
  const L = app.run("invoiceCsv()").split("\r\n").slice(1, 4).map(parseCsvLine);
  assert.deepEqual(L.map(r => r.slice(16, 18)), [["8%(軽減)", WH10], ["非課税", "なし"], ["8%(軽減)", WH10]]);
});
test("警告: 軽減・非課税の品目があるときだけ、止めない注意が出る。源泉徴収なしの品目の注意は出さない", () => {
  const app = twoClients({}, {});
  app.run("rows.push(" + JSON.stringify(R("2026-10-04", "A社", "相談サービス", 1)) + "); render()");
  setItemTax(app, "作業サービス", { wh: WH10 });
  assert.ok(!app.run("problems()").some(x => x.includes("源泉徴収なしの品目")));
  assert.equal(app.els["dlInv"].disabled, false, "止めない");
  assert.ok(!app.run("problems()").some(x => x.includes("8%(軽減)・非課税")));
  setItemTax(app, "作業サービス", { kubun: "8%(軽減)" });
  assert.equal(app.run("problems()").find(x => x.includes("8%(軽減)・非課税")), "※ 8%(軽減)・非課税の品目があります。金額の目安は単価×数量で、税の金額は計算していません。税区分の列を見て、お使いの請求書ソフトや表計算で計算してください");
  setItemTax(app, "作業サービス", { kubun: "非課税" }); assert.ok(app.run("problems()").some(x => x.includes("8%(軽減)・非課税の品目")));
  assert.equal(app.els["dlInv"].disabled, false, "止めない");
  const unused = twoClients({}, {}); setItemTax(unused, "相談サービス", { kubun: "非課税" });
  assert.ok(!unused.run("problems()").some(x => x.includes("8%(軽減)・非課税")), "今月に出さない品目は載せない");
});

test("品目CSV: 税区分は 10% / 8%(軽減) / 非課税、源泉徴収は品目の設定(なし / 10% / 10.21%)のまま", () => {
  const app = makeApp();
  app.setup({ rows: [], prices: { a: 1, b: 2, c: 3, d: 4 }, clients: {}, bank: GOOD_BANK });
  setItemTax(app, "b", { kubun: "8%(軽減)", wh: WH10 }); setItemTax(app, "c", { kubun: "非課税", wh: WH21 });
  const it = app.run("itemCsv()").split("\r\n").slice(1, -1).map(parseCsvLine);
  assert.deepEqual(it.map(r => [r[0], r[3], r[4]]), [["a", "10%", "なし"], ["b", "8%(軽減)", WH10], ["c", "非課税", WH21], ["d", "10%", "なし"]]);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

test("取引先の「編集」の画面: 消費税の表示・端数処理・敬称・登録済み・コードを直せる。保存され、明細CSVに出る。「請求書の書き方」の欄は無い", () => {
  const app = twoClients({}, {});
  assert.ok(!html.includes("請求書の書き方(取引先ごと)") && !html.includes('id="cfgStyle"') && !html.includes('id="invStyle"'), "別の欄は無くした");
  assert.deepEqual(lines2(app).map(r => [r[18], r[19]]), [["外税(税別)", "切り捨て"], ["外税(税別)", "切り捨て"]]);
  const ed = findAll(app.els["cfgClients"], c => c.tagName === "button" && c.textContent === "編集");
  assert.equal(ed.length, 2);
  ed[1].onclick();
  assert.equal($e(app, "dlgClient").open, true); assert.equal($e(app, "cdTitle").textContent, "取引先を編集"); assert.equal($e(app, "cdSave").textContent, "保存");
  assert.deepEqual([$e(app, "cdName").value, $e(app, "cdCode").value, $e(app, "cdHon").value, $e(app, "cdMode").value, $e(app, "cdRound").value, $e(app, "cdReg").checked], ["B社", "A002", "御中", "外税(税別)", "切り捨て", false]);
  const opts = id => html.slice(html.indexOf('<select id="' + id + '">'), html.indexOf("</select>", html.indexOf('<select id="' + id + '">')));
  assert.ok(["外税(税別)", "内税(税込)", "内税(免税事業者)"].every(s => opts("cdMode").includes(s)) && ["切り捨て", "切り上げ", "四捨五入"].every(s => opts("cdRound").includes(s)));
  $e(app, "cdMode").value = "内税(免税事業者)"; $e(app, "cdRound").value = "四捨五入"; $e(app, "cdHon").value = "様"; $e(app, "cdReg").checked = true; $e(app, "cdCode").value = "A777";
  app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, false);
  assert.deepEqual(lines2(app).map(r => [r[18], r[19]]), [["外税(税別)", "切り捨て"], ["内税(免税事業者)", "四捨五入"]]);
  assert.deepEqual(J(app, "(({code,hon,reg,taxMode,round})=>({code,hon,reg,taxMode,round}))(cfg.clients['B社'])"), { code: "A777", hon: "様", reg: true, taxMode: "内税(免税事業者)", round: "四捨五入" });
  assert.deepEqual(JSON.parse(app.storage[CK]).clients["B社"].round, "四捨五入", "保存される");
  const mask = c => c.map((v, i) => ([0, 3, 4, 5, 18, 19].includes(i) ? "*" : v));
  assert.deepEqual(mask(lines2(app)[0]), mask(lines2(app)[1]), "ほかの列は同じ");
  const cells = textOf(app.els["cfgClients"]);
  assert.ok(cells.includes("内税(免税事業者)・四捨五入") && cells.includes("✓") && cells.includes("A777"));
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

test("画面の見出し: 取引先ごとの行に「消費税の表示・端数処理」(源泉は品目の行に出る)。標準でない品目は行に出す", () => {
  const app = twoClients({ taxMode: "内税(税込)", round: "切り上げ" }, {});
  setItemTax(app, "作業サービス", { kubun: "8%(軽減)", wh: WH10 });
  const out = app.els["out"].value, lines = out.split("\n");
  assert.ok(out.startsWith("振込先: " + GOOD_BANK + "\n発行日: 2026-10-31  支払期限: 2026-11-30\n\n■ "), out);
  assert.ok(lines.find(l => l.startsWith("■ A社")).endsWith("  内税(税込)・切り上げ"));
  assert.ok(lines.find(l => l.startsWith("■ B社")).endsWith("  外税(税別)・切り捨て"));
  assert.ok(lines.some(l => l.includes("作業サービス") && l.includes(" (8%(軽減)) (源泉10%)")), out);
  setItemTax(app, "作業サービス", { kubun: "非課税", wh: WH21 });
  assert.ok(app.els["out"].value.includes(" (非課税) (源泉10.21%)"));
  setItemTax(app, "作業サービス", { kubun: "", wh: "なし" });
  assert.ok(!app.els["out"].value.includes("(源泉") && !app.els["out"].value.includes("(軽減") && !app.els["out"].value.includes("(非課税"), "標準のときは何も付けない");
  assert.ok(app.els["out"].value.split("\n").find(l => l.startsWith("■ A社")).endsWith("  内税(税込)・切り上げ"));
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

test("品目の表は見るだけ。「品目を登録」「編集」の画面で、単価・単位・税区分・源泉徴収・登録済みを選ぶ。正しくない値は標準・なし", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-01", "A社", "作業サービス", 1), R("2026-10-02", "A社", "相談サービス", 1)], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  assert.equal(findAll(app.els["cfgPrices"], c => c.tagName === "select" || c.tagName === "input").length, 0, "表の中に入力欄・選択欄は無い");
  assert.ok(SOURCE.includes("<th>品目</th><th>単価(この月)</th><th>単位</th><th>税区分</th><th>源泉徴収</th><th>請求書ソフトに登録済み</th>"));
  const opts = id => html.slice(html.indexOf('<select id="' + id + '">'), html.indexOf("</select>", html.indexOf('<select id="' + id + '">')));
  assert.ok(["10%", "8%(軽減)", "非課税"].every(s => opts("itKubun").includes(s)));
  app.run('openItemDialog("作業サービス")');
  assert.ok(["なし", "10%", "10.21%"].every(s => opts("itWh").includes(s)));
  $e(app, "itKubun").value = "非課税"; $e(app, "itWh").value = WH21; $e(app, "itReg").checked = true;
  app.fire("itSave", "click");
  assert.deepEqual(J(app, "cfg.itemTax['作業サービス']"), { kubun: "非課税", wh: WH21 });
  assert.equal(app.run("cfg.itemReg['作業サービス']"), true);
  assert.deepEqual(JSON.parse(app.storage[CK]).itemTax["作業サービス"], { kubun: "非課税", wh: WH21 });
  assert.equal(lines2(app)[0][17], WH21);
  const txt = textOf(app.els["cfgPrices"]);
  assert.ok(txt.includes("非課税") && txt.includes(WH21) && txt.includes("✓"));
  if (!DEMO) {
    assert.equal(J(app, 'addItem("軽減の品","100","時間","8%(軽減)","10%")').ok, true);
    assert.equal(J(app, 'addItem("ふつうの品","100")').ok, true);
    assert.equal(J(app, 'addItem("へんな品","100","時間","高い","適用する")').ok, true);
    assert.deepEqual(J(app, "(({軽減の品,ふつうの品,へんな品})=>[軽減の品,ふつうの品,へんな品])(cfg.itemTax)"), [{ kubun: "8%(軽減)", wh: WH10 }, { kubun: "", wh: "なし" }, { kubun: "", wh: "なし" }]);
  }
});
test("品目の税: 名前を変えると付いて行き、削除すると消える。控えに入って戻る。正しくない値はなし", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-01", "A社", "作業サービス", 1)], clients: { "A社": A }, prices: { "作業サービス": 100, "相談サービス": 5 } });
  setItemTax(app, "作業サービス", { kubun: "8%(軽減)", wh: WH10 }); setItemTax(app, "相談サービス", { kubun: "非課税" });
  assert.deepEqual(J(app, "parseBackup(buildBackup())").cfg.itemTax, { "作業サービス": { kubun: "8%(軽減)", wh: WH10 }, "相談サービス": { kubun: "非課税", wh: "なし" } });
  const mk = cfg => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg });
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "品": 1 } }))})`).cfg.itemTax, { "品": { kubun: "", wh: "なし" } }, "古い控え");
  assert.deepEqual(J(app, `parseBackup(${JSON.stringify(mk({ clients: {}, prices: { "品": 1, "別": 1 }, itemTax: { "品": { kubun: "高い", wh: 5 }, "別": "x", "無い": { kubun: "非課税" } } }))})`).cfg.itemTax, { "品": { kubun: "", wh: "なし" }, "別": { kubun: "", wh: "なし" } });
  assert.equal(J(app, 'deleteName("service","相談サービス")').ok, true);
  assert.ok(!("相談サービス" in J(app, "cfg.itemTax")));
  if (!DEMO) {
    app.run("rows=[]; render()");
    assert.equal(J(app, 'renameName("service","作業サービス","新しい名前")').ok, true);
    assert.deepEqual(J(app, "cfg.itemTax"), { "新しい名前": { kubun: "8%(軽減)", wh: WH10 } });
  }
  // 請求書の書き方(取引先ごと)も控えに入って戻る
  const t = twoClients({ taxMode: "内税(税込)", round: "切り上げ" }, {});
  const cl = J(t, "parseBackup(buildBackup())").cfg.clients;
  assert.deepEqual([cl["A社"].taxMode, cl["A社"].round, cl["B社"].taxMode, cl["B社"].round], ["内税(税込)", "切り上げ", "外税(税別)", "切り捨て"]);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ

test("税の設定の説明: 品目ごとに選ぶ・源泉は品目の行に出る・消費税の表示と端数処理は取引先の登録/編集の画面。版は3.0.0", () => {
  assert.match(html, /税の設定のわけ方: 税区分と源泉徴収は、品目ごとに、品目の「登録」「編集」の画面で選びます。明細CSVの各行に、その品目の税区分と源泉徴収を書きます/);
  assert.match(html, /消費税の表示と端数処理は、取引先ごとに、取引先の「登録」「編集」の画面で選びます/);
  assert.match(html, /品目の源泉徴収: はじめは「なし」です。/);
  assert.match(html, /版: 3\.0\.0\(2026-10-25\)/);
  assert.match(html, /td select\{min-width:9em/, "選択欄が切れない幅");
});

// ================= 開始・終了と時間の食い違い / 品目の表の見た目 =================
test("時間を手で直したら、開始・終了を消して知らせる(編集でも追加でも)。自動で入れたときは消さない", () => {
  const app = makeApp();
  app.setup({ rows: [{ ...R("2026-10-05", "A社", "作業サービス", 1.5), start: "09:00", end: "10:30" }], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  app.run("startEdit(rows[0])");
  assert.equal($e(app, "tmStart").value, "09:00");
  $e(app, "hours").value = "2.5"; app.fire("hours", "input");
  assert.equal($e(app, "tmStart").value, ""); assert.equal($e(app, "tmEnd").value, "");
  assert.equal($e(app, "fmsg").textContent, "時間を直接入れたので、開始・終了を消しました。");
  app.fire("f", "submit");
  assert.deepEqual(J(app, "[rows[0].hours, rows[0].start, rows[0].end]"), [2.5, null, null], "食い違ったまま保存されない");
  // 自動で入れる(開始・終了を入れる)ときは、消えない
  $e(app, "service").value = "作業サービス"; app.fire("service", "input");
  $e(app, "tmStart").value = "09:30"; app.fire("tmStart", "change"); $e(app, "tmEnd").value = "11:15"; app.fire("tmEnd", "change");
  assert.equal($e(app, "hours").value, "1.75"); assert.equal($e(app, "tmStart").value, "09:30");
  assert.equal($e(app, "fmsg").textContent, "");
});
test("開始・終了と時間が合わないときは、追加も更新も断る", () => {
  const app = makeApp();
  app.setup({ rows: [], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  const fill = (h) => { for (const [id, v] of [["date", "2026-10-05"], ["client", "A社"], ["service", "作業サービス"], ["hours", h], ["kind", "act"], ["tmStart", "09:00"], ["tmEnd", "10:30"]]) $e(app, id).value = v; };
  fill("2"); app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 0); assert.equal($e(app, "fmsg").textContent, "時間と、開始・終了が合いません。どちらかを直してください。");
  fill("1.5"); app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1);
  app.run("startEdit(rows[0])"); $e(app, "tmEnd").value = "11:00"; // 時間は 1.5 のまま
  app.fire("f", "submit");
  assert.equal($e(app, "fmsg").textContent, "時間と、開始・終了が合いません。どちらかを直してください。");
  assert.equal(app.run("rows[0].end"), "10:30", "更新されない");
  assert.equal(app.run("addRow({date:'2026-10-06',client:'A社',service:'作業サービス',hours:2,kind:'act',start:'09:00',end:'10:30'})"), null);
  assert.equal(app.run("updateRow(rows[0].id,{date:'2026-10-05',client:'A社',service:'作業サービス',hours:3,kind:'act',start:'09:00',end:'10:30'})"), null);
});
test("品目の表・取引先の表の見た目: 名前の列と操作ボタンは折り返さない。小さな画面(dialog)の見た目の規則がある", () => {
  assert.match(html, /\.scroll td:first-child\{white-space:nowrap;min-width:6em\}/);
  assert.match(html, /\.scroll td button\{white-space:nowrap\}/);
  assert.match(html, /dialog\{[^}]*width:min\(560px,94vw\)/);
  assert.match(html, /dialog::backdrop/);
});

// ================= 取引先・品目の登録と編集は、小さな画面(dialog)で =================
const clientForm = (app, o) => { for (const [id, k] of [["cdName", "name"], ["cdCode", "code"], ["cdHon", "hon"], ["cdMode", "mode"], ["cdRound", "round"]]) if (k in o) $e(app, id).value = o[k]; if ("reg" in o) $e(app, "cdReg").checked = o.reg; };
test("小さな画面: 「取引先を登録」「品目を登録」で開き、「やめる」で閉じる(何も変わらない)。表にはボタンしかない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  assert.match(html, /<dialog id="dlgClient">[\s\S]*<dialog id="dlgItem">/);
  assert.ok(html.indexOf(">取引先を登録<") > 0 && html.indexOf(">品目を登録<") > 0);
  assert.ok(!/id="(itemName|itemPrice|itemAdd|itemUnit)"/.test(html), "ページ上の入力欄は無くした");
  const before = keep(app);
  app.fire("clientNew", "click");
  assert.equal($e(app, "dlgClient").open, true); assert.equal($e(app, "cdTitle").textContent, "取引先を登録"); assert.equal($e(app, "cdSave").textContent, "登録");
  assert.equal($e(app, "cdCode").value, "A002", "新しいコードの案内(A001の次)");
  app.fire("cdCancel", "click"); assert.equal($e(app, "dlgClient").open, false);
  app.fire("itemNew", "click");
  assert.equal($e(app, "dlgItem").open, true); assert.equal($e(app, "itTitle").textContent, "品目を登録"); assert.equal($e(app, "itSave").textContent, "登録");
  assert.equal($e(app, "itName").value, ""); assert.equal($e(app, "itUnit").value, "時間");
  app.fire("itCancel", "click"); assert.equal($e(app, "dlgItem").open, false);
  assert.equal(keep(app), before, "やめたら何も変わらない");
  for (const id of ["cfgClients", "cfgPrices"]) {
    assert.equal(findAll(app.els[id], c => c.tagName === "input" || c.tagName === "select").length, 0, id + " は見るだけ");
    assert.ok(findAll(app.els[id], c => c.tagName === "button").every(b => ["編集", "削除"].includes(b.textContent)), "ボタンは編集と削除だけ");
  }
  // showModal が無い環境では open 属性で開く
  assert.equal(app.run("(()=>{const l=[];const d={setAttribute:(k)=>l.push('s'+k),removeAttribute:(k)=>l.push('r'+k)};showDlg(d);hideDlg(d);return l.join()})()"), "sopen,ropen");
});
test("取引先を登録: 行が無くても登録できる。名前の重複・コードの重複は、画面の中で断る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  app.fire("clientNew", "click");
  clientForm(app, { name: "  新Ｚ社 ", code: "Z-9", hon: "様", mode: "内税(税込)", round: "切り上げ", reg: true });
  app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, false);
  assert.deepEqual(J(app, "(({code,hon,reg,taxMode,round})=>({code,hon,reg,taxMode,round}))(cfg.clients['新Z社'])"), { code: "Z-9", hon: "様", reg: true, taxMode: "内税(税込)", round: "切り上げ" });
  assert.equal(app.run("rows.some(r=>r.client==='新Z社')"), false, "行は無くてよい");
  assert.ok(JSON.parse(app.storage[CK]).clients["新Z社"], "保存される");
  assert.ok(textOf(app.els["cfgClients"]).includes("新Z社"));
  assert.ok(J(app, "candidates().cl").includes("新Z社"), "入れる欄の候補にも出る");
  app.fire("clientNew", "click"); clientForm(app, { name: "Ａ社", code: "Q1" }); app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, true); assert.equal($e(app, "cdMsg").textContent, "「A社」はすでにあります。");
  clientForm(app, { name: "Y社", code: "A001" }); app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, true); assert.ok($e(app, "cdMsg").textContent.includes("コード「A001」は、ほかの取引先「A社」が使っています"));
  assert.equal(app.run("'Y社' in cfg.clients"), false);
  clientForm(app, { name: " ", code: "Q" }); app.fire("cdSave", "click"); assert.equal($e(app, "cdMsg").textContent, "取引先名を入れてください。");
  clientForm(app, { name: "Y社", code: " " }); app.fire("cdSave", "click"); assert.equal($e(app, "cdMsg").textContent, "取引先コードを入れてください。");
  app.fire("cdCancel", "click");
  app.fire("clientNew", "click"); assert.equal($e(app, "cdCode").value, "A002");
}, { skip: DEMO });
test("取引先の編集で名前を変える: 行も設定も付いて行く(名前を変えるボタンは無い)。重複は断る。削除は表に残る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A, "B社": B }, prices: PRICES, bank: GOOD_BANK });
  app.run('openClientDialog("A社")');
  assert.equal($e(app, "cdName").value, "A社"); assert.equal($e(app, "cdName").readOnly, false);
  clientForm(app, { name: "B社" }); app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, true); assert.ok($e(app, "cdMsg").textContent.includes("すでにあります"));
  clientForm(app, { name: "新A社", reg: true }); app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, false);
  assert.equal(app.run("rows.filter(r=>r.client==='新A社').length"), 3); assert.equal(app.run("rows.some(r=>r.client==='A社')"), false);
  assert.deepEqual(J(app, "Object.keys(cfg.clients)"), ["新A社", "B社"]);
  assert.equal(app.run("cfg.clients['新A社'].code"), "A001"); assert.equal(app.run("cfg.clients['新A社'].reg"), true);
  assert.ok(app.els["cmsg"].textContent.includes("「A社」を「新A社」に変えました"));
  assert.equal(lines2(app)[0][3], "A001");
  const del = findAll(app.els["cfgClients"], c => c.tagName === "button" && c.textContent === "削除");
  assert.equal(del.length, 2); assert.equal(del[0].disabled, true, "使っている行があれば削除できない"); assert.equal(del[1].disabled, false, "行が無ければ削除できる");
}, { skip: DEMO });
test("取引先の編集(デモ版でも): コード・敬称・税・登録済みは直せる。デモ版では名前は変えられない", () => {
  const app = twoClients({}, {});
  app.run('openClientDialog("A社")');
  assert.equal($e(app, "cdName").readOnly, DEMO);
  clientForm(app, { code: "Z1", hon: "様" }); app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, false); assert.equal(app.run("cfg.clients['A社'].code"), "Z1");
  if (DEMO) {
    app.run('openClientDialog("A社")'); clientForm(app, { name: "D社" }); app.fire("cdSave", "click");
    assert.equal($e(app, "dlgClient").open, true); assert.ok($e(app, "cdMsg").textContent.includes("デモ版"));
  }
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("品目を登録: 単価はいま選んでいる月から先。単位・税区分・源泉徴収・登録済みも選べる。重複は画面の中で断る", () => {
  const app = makeApp();
  app.setup({ rows: [], clients: {}, prices: {}, month: "2026-11" });
  app.fire("itemNew", "click");
  assert.ok($e(app, "itNote").textContent.startsWith("2026年11月から"));
  const f = o => { for (const [id, k] of [["itName", "name"], ["itPrice", "price"], ["itUnit", "unit"], ["itKubun", "kubun"], ["itWh", "wh"]]) if (k in o) $e(app, id).value = o[k]; if ("reg" in o) $e(app, "itReg").checked = o.reg; };
  f({ name: " 新ＳＶ ", price: "1200", unit: "回", kubun: "8%(軽減)", wh: WH10, reg: true });
  app.fire("itSave", "click");
  assert.equal($e(app, "dlgItem").open, false);
  assert.deepEqual(J(app, "cfg.priceHist['新SV']"), [{ from: "2026-11", price: 1200 }]);
  assert.equal(app.run("priceFor('新SV','2026-10')"), "", "前の月は未設定");
  assert.deepEqual([app.run("unitOf('新SV')"), J(app, "cfg.itemTax['新SV']"), app.run("cfg.itemReg['新SV']")], ["回", { kubun: "8%(軽減)", wh: WH10 }, true]);
  assert.equal(app.run("itemList().includes('新SV')"), false, "登録済みなら品目CSVに入らない");
  assert.ok(J(app, "candidates().sv").includes("新SV"));
  const txt = textOf(app.els["cfgPrices"]); assert.ok(txt.includes("1,200円") && txt.includes("回") && txt.includes("8%(軽減)") && txt.includes(WH10) && txt.includes("✓"));
  app.fire("itemNew", "click"); f({ name: "新ＳＶ", price: "1" }); app.fire("itSave", "click");
  assert.equal($e(app, "dlgItem").open, true); assert.equal($e(app, "itMsg").textContent, "「新SV」はすでにあります。");
  f({ name: "別SV", price: "-5" }); app.fire("itSave", "click"); assert.equal($e(app, "itMsg").textContent, "単価は、0以上の数で入れてください。");
  f({ name: "", price: "" }); app.fire("itSave", "click"); assert.equal($e(app, "itMsg").textContent, "品目名を入れてください。");
  f({ name: "別SV", price: "" }); app.fire("itSave", "click");
  assert.equal($e(app, "dlgItem").open, false); assert.equal(app.run("priceFor('別SV','2026-11')"), "", "単価は空でも登録できる");
}, { skip: DEMO });
test("品目の編集で名前を変える: 行・単価・単位・税が付いて行く。単価の変更は選んでいる月から先で、あとの月は変わらない", () => {
  const app = makeApp();
  app.setup({ rows: [R("2026-10-03", "A社", "作業サービス", 2)], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  app.run('setPrice("作業サービス","2026-12",3500); render()');
  app.run('openItemDialog("作業サービス")');
  assert.equal($e(app, "itPrice").value, 3000); assert.ok($e(app, "itHist").textContent.includes("2026年12月〜 3,500円"));
  $e(app, "itPrice").value = "3200"; app.fire("itSave", "click");
  assert.equal(app.run('priceFor("作業サービス","2026-10")'), 3200); assert.equal(app.run('priceFor("作業サービス","2026-12")'), 3500, "あとの月は変わらない");
  if (!DEMO) {
    app.run('openItemDialog("作業サービス")'); $e(app, "itName").value = "新作業"; app.fire("itSave", "click");
    assert.equal($e(app, "dlgItem").open, false);
    assert.equal(app.run("rows[0].service"), "新作業"); assert.equal(app.run('priceFor("新作業","2026-12")'), 3500);
    assert.equal(app.run('"作業サービス" in cfg.priceHist'), false);
    app.run('openItemDialog("新作業")'); $e(app, "itName").value = "相談サービス"; app.fire("itSave", "click");
    assert.equal($e(app, "dlgItem").open, true); assert.ok($e(app, "itMsg").textContent.includes("すでにあります"));
  }
});

// ================= 取引先CSVのすべての列を、取引先の画面で =================
const FULL = { regNo: "T1234567890123", dept: "総務部", person: "山田 太郎", mail: "a@example.com", zip: "123-4567", addr: "東京都千代田区1-1", bldg: "サンプルビル3階", tel: "03-1234-5678", fax: "03-1234-5679" };
const CIDS = { regNo: "cdRegNo", dept: "cdDept", person: "cdPerson", mail: "cdMail", zip: "cdZip", addr: "cdAddr", bldg: "cdBldg", tel: "cdTel", fax: "cdFax" };
const fillContact = (app, o) => { for (const [k, v] of Object.entries(o)) { $e(app, CIDS[k]).value = v; app.fire(CIDS[k], "input"); } };
const custLine = (app, i = 1) => parseCsvLine(app.run("customerCsv()").split("\r\n")[i]);

test("取引先の画面: 取引先CSVの全部の列の欄がある(基本・連絡先・請求書の書き方に分かれ、連絡先の注意書きがある)", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const dlg = html.slice(html.indexOf('<dialog id="dlgClient">'), html.indexOf("</dialog>"));
  for (const id of ["cdName", "cdCode", "cdRegNo", "cdHon", "cdDept", "cdPerson", "cdMail", "cdZip", "cdAddr", "cdBldg", "cdTel", "cdFax", "cdMode", "cdRound", "cdReg"]) assert.ok(dlg.includes('id="' + id + '"'), id);
  assert.ok(dlg.indexOf("<h4>基本</h4>") < dlg.indexOf("<h4>連絡先</h4>") && dlg.indexOf("<h4>連絡先</h4>") < dlg.indexOf("<h4>請求書の書き方</h4>"));
  assert.ok(dlg.includes("住所・電話・メールなどは、このブラウザの中にそのまま保存されます。共用のパソコンでは入れないでください。手元のファイルで使う場合、同じブラウザで開いた他のHTMLファイルからも読めます。"));
  assert.match(html, /max-height:90vh;overflow:auto/);
  assert.ok(html.includes("控えのファイルには、取引先の住所や連絡先も入ります"));
  assert.ok(html.includes("取引先の住所・電話・メールアドレスなどを入れた場合は、このブラウザの中にそのまま保存されます。共用のパソコンでは入れないでください。"));
  assert.ok(html.includes("請求書の件名({y}は年、{m}は月に置き換わります)"));
  assert.ok(!html.includes("件名({y}=年 {m}=月)"));
});
test("取引先: 連絡先などを全部登録でき、画面に戻って見え、取引先CSVの正しい列に出る(見出しは変わらない)。取引先名以外は空でよい", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": { ...A, reg: false } }, prices: PRICES, bank: GOOD_BANK });
  app.run('openClientDialog("A社")');
  fillContact(app, FULL); $e(app, "cdHon").value = "様";
  app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, false);
  const c = J(app, "cfg.clients['A社']");
  for (const [k, v] of Object.entries(FULL)) assert.equal(c[k], v, k);
  app.run('openClientDialog("A社")');
  for (const [k, id] of Object.entries(CIDS)) assert.equal($e(app, id).value, FULL[k], k + " が画面に戻る");
  app.fire("cdCancel", "click");
  const hdr = app.run("customerCsv()").split("\r\n")[0].slice(1);
  assert.equal(hdr, app.run("HDR_CUS.map(q).join(',')"), "見出しは変わらない");
  assert.deepEqual(custLine(app), ["A001", "A社", "様", "外税(税別)", "切り捨て", "T1234567890123", "山田 太郎", "総務部", "a@example.com", "03-1234-5678", "03-1234-5679", "123-4567", "東京都千代田区1-1", "サンプルビル3階"]);
  assert.ok(textOf(app.els["cfgClients"]).includes("連絡先あり"));
  assert.equal(JSON.parse(app.storage[CK]).clients["A社"].tel, "03-1234-5678", "保存される");
  // 空にもできる(前後の空白は取る)
  app.run('openClientDialog("A社")'); fillContact(app, { regNo: "  ", mail: " x@y " }); app.fire("cdSave", "click");
  const c2 = custLine(app); assert.equal(c2[5], ""); assert.equal(c2[8], "x@y");
  // 取引先名だけで登録できる
  if (!DEMO) {
    app.fire("clientNew", "click"); $e(app, "cdName").value = "名前だけ社"; $e(app, "cdCode").value = "N1"; app.fire("cdSave", "click");
    assert.equal($e(app, "dlgClient").open, false);
    assert.deepEqual(J(app, "(({regNo,dept,person,mail,zip,addr,bldg,tel,fax})=>[regNo,dept,person,mail,zip,addr,bldg,tel,fax])(cfg.clients['名前だけ社'])"), ["", "", "", "", "", "", "", "", ""]);
    assert.ok(!('deptPrint' in J(app, "cfg.clients['名前だけ社']")) && !('personPrint' in J(app, "cfg.clients['名前だけ社']")), '古い版の項目は作らない');
  }
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("取引先の連絡先: 入れ方がおかしいときは画面の中で知らせる(保存はできる)", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  app.run('openClientDialog("A社")');
  assert.equal($e(app, "cdWarn").textContent, "");
  fillContact(app, { regNo: "1234", zip: "12-34", mail: "abc", tel: "03(1234)5678", fax: "ab" });
  const w = $e(app, "cdWarn").textContent;
  for (const s of ["登録番号は、T と13桁の数字です", "郵便番号は、123-4567 の形で入れてください", "メールアドレスに @ がありません", "TELは、数字とハイフンだけで入れてください", "FAXは、数字とハイフンだけで入れてください"]) assert.ok(w.includes(s), s);
  app.fire("cdSave", "click");
  assert.equal($e(app, "dlgClient").open, false, "保存できる");
  assert.equal(app.run("cfg.clients['A社'].mail"), "abc");
  assert.ok(app.els["cmsg"].textContent.includes("確かめてください") && app.els["cmsg"].textContent.includes("@ がありません"));
  app.run('openClientDialog("A社")'); fillContact(app, { regNo: "T0000000000000", zip: "1234567", mail: "a@b", tel: "03-1", fax: "0312" });
  assert.equal($e(app, "cdWarn").textContent, "", "正しい形なら何も出ない");
  assert.deepEqual(J(app, "contactWarnings({})"), []);
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("取引先の連絡先: 名前を変えても付いて行く。控えに入って戻る。正しくない型・長すぎる値は取り込まない。古いデータは空で始まる。ダミーは空", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": { ...A, ...FULL } }, prices: PRICES, bank: GOOD_BANK });
  const b = J(app, "parseBackup(buildBackup())").cfg.clients["A社"];
  for (const [k, v] of Object.entries(FULL)) assert.equal(b[k], v, k);
  if (!DEMO) {
    assert.equal(J(app, 'renameName("client","A社","新A社")').ok, true);
    assert.equal(app.run("cfg.clients['新A社'].addr"), "東京都千代田区1-1"); assert.equal(custLine(app)[12], "東京都千代田区1-1");
  }
  const mk = clients => JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg: { clients, prices: {} } });
  const bad = J(app, `parseBackup(${JSON.stringify(mk({ "X社": { code: "A1", mail: 5, tel: { a: 1 }, addr: "あ".repeat(201), zip: "123-4567", deptPrint: "たぶん", personPrint: "する" }, "Y社": { code: "A2", addr: "あ".repeat(200) } }))})`).cfg.clients;
  assert.deepEqual([bad["X社"].mail, bad["X社"].tel, bad["X社"].addr, bad["X社"].zip], ["", "", "", "123-4567"]);
  assert.ok(!("deptPrint" in bad["X社"]) && !("personPrint" in bad["X社"]), "古い版の項目は無視する");
  assert.equal(bad["Y社"].addr.length, 200, "200字までは取り込む");
  // 古い保存データ
  const old = makeApp();
  old.storage[CK] = JSON.stringify({ clients: { "A社": { code: "A001", hon: "御中", reg: false } }, prices: {}, bank: "b" });
  old.run("loadState()");
  assert.deepEqual(J(old, "(({regNo,dept,person,mail,zip,addr,bldg,tel,fax})=>({regNo,dept,person,mail,zip,addr,bldg,tel,fax}))(cfg.clients['A社'])"), { regNo: "", dept: "", person: "", mail: "", zip: "", addr: "", bldg: "", tel: "", fax: "" });
  // ダミーは空のまま(作り話は入れない)
  const d = makeApp(); d.els["month"].value = "2026-10"; d.run("loadDummy(); render()");
  for (const n of J(d, "Object.keys(cfg.clients)")) assert.deepEqual(J(d, "CFIELDS.map(k=>cfg.clients[" + JSON.stringify(n) + "][k])"), ["", "", "", "", "", "", "", "", ""], n);
  assert.ok(!textOf(d.els["cfgClients"]).includes("連絡先あり"));
  const dl = custLine(d); assert.deepEqual([5, 6, 7, 8, 9, 10, 11, 12, 13].map(k => dl[k]), Array(9).fill(""), "ダミーの取引先CSVの連絡先の列は空欄");
}, { skip: DEMO }); // デモ版は、CSVにダミーの中身しか出さないので、自由な名前・コード・連絡先・件名・振込先を使うこの確かめは、実用版だけ
test("請求書の件名の欄の表示", () => {
  assert.match(html, /<label[^>]*>請求書の件名\(\{y\}は年、\{m\}は月に置き換わります\)<input id="subject">/);
});

test("取引先CSV: 行がまだ無い、先に登録しただけの取引先も入る(登録済みは入らない)", () => {
  if (DEMO) return;
  const app = makeApp();
  app.setup({ rows: [], clients: { "先登録社": { code: "A050", hon: "御中", reg: false }, "済み社": { code: "A051", hon: "御中", reg: true } }, prices: {} });
  const L = app.run("customerCsv()").split("\r\n").filter(Boolean);
  assert.equal(L.length, 2, "見出し+先登録社の1行");
  assert.ok(L[1].startsWith("A050,先登録社,御中"));
  assert.equal(app.run('$("dlCus").disabled'), false, "保存ボタンが押せる");
});
// ================= デザインの型(色・ボタン・サイドメニュー) =================
const sectionChunk = id => { const i = html.indexOf('<section id="' + id + '"'); return html.slice(i, html.indexOf("</section>", i)); };
test("見た目: デザインの型の色の名前・ライトとダーク・ボタンの種類がある。外のファイルを読まない", () => {
  for (const v of ["--bg", "--surface", "--surface-2", "--text", "--text-sub", "--border", "--border-sub", "--primary", "--primary-hover", "--primary-active", "--on-primary", "--primary-soft", "--danger", "--danger-soft", "--success", "--warning", "--focus", "--sp-4", "--radius", "--tap", "--out", "--out-line", "--toast-btn", "--toast-hover", "--c1", "--c2", "--c3", "--c4", "--scrim"])
    assert.ok(html.includes(v + ":"), v);
  assert.ok(html.includes("--bg: #FFFFFF;") && html.includes("--bg: #111318;"), "ライトは白い背景、ダークは別の値(黒地・黄緑)");
  assert.ok(html.includes("--primary: #C8F25A;"), "ダークの主色は黄緑");
  assert.match(html, /@media \(prefers-color-scheme: dark\)/); assert.match(html, /:root\[data-theme="dark"\]/);
  for (const c of [".btn-primary", ".btn-secondary", ".btn-danger", ".btn-sm", ".notice-error"]) assert.ok(html.includes(c), c);
  assert.match(html, /\.btn:focus-visible/); assert.match(html, /cursor: pointer/); assert.match(html, /translateY\(1px\)/); assert.match(html, /cursor: not-allowed/);
  assert.ok(!/<link\b|@import|url\(/.test(html), "外のファイルを読まない");
});
test("ボタン: 主ボタンは1つのまとまりに1つ(入れる=追加、3 書き出す=明細CSV、別窓=登録/保存/この日に追加)。削除とダミーを消すは危険ボタン", () => {
  const one = (chunk, id) => { const m = chunk.match(/class="[^"]*btn-primary[^"]*"/g) || []; assert.equal(m.length, 1, id); };
  one(sectionChunk("sec-enter"), "記録を入れる"); assert.match(sectionChunk("sec-enter"), /btn btn-primary" id="submitBtn"/);
  const board = html.slice(html.indexOf('id="sec-list"'), html.indexOf('<section id="sec-out"'));
  assert.equal((board.match(/btn-primary/g) || []).length, 0, "板の中の主ボタンは、動きで決める(初めは副)");
  assert.match(board, /id="dlInv"/); assert.match(board, /class="btn btn-secondary btn-block" id="dlInv"/);
  for (const id of ["guide", "sec-out", "sec-settings", "sec-backup"]) assert.equal((sectionChunk(id).match(/btn-primary/g) || []).length, 0, id + " に主ボタンは無い");
  for (const d of ["dlgClient", "dlgItem"]) { const i = html.indexOf('<dialog id="' + d + '"'); const c = html.slice(i, html.indexOf("</dialog>", i)); assert.equal((c.match(/btn-primary/g) || []).length, 1, d); assert.ok(c.indexOf("やめる") < c.indexOf('btn btn-primary"'), "やめるが左、登録/保存が右"); }
  { const i = html.indexOf('<dialog id="dlgCal"'); const c = html.slice(i, html.indexOf("</dialog>", i)); assert.equal((c.match(/btn-primary/g) || []).length, 1, "dlgCal"); assert.match(c, /btn btn-primary" id="calAddDay"/); }
  { const i = html.indexOf('<dialog id="dlgDel"'); const c = html.slice(i, html.indexOf("</dialog>", i)); assert.equal((c.match(/btn-primary/g) || []).length, 0, "dlgDel に主ボタンは無い"); assert.ok(c.indexOf("やめる") < c.indexOf("削除する"), "やめるが左、削除するが右"); assert.match(c, /btn btn-danger" type="button">削除する/); assert.match(c, /id="delCancel"[^>]*\bautofocus\b/, "最初に選ばれるのはやめる"); }
  assert.match(html, /id="clearDummy"/); assert.match(html, /class="btn btn-danger btn-sm" id="clearDummy"/);
  for (const id of ["clientNew", "itemNew", "dlCus", "dlItem", "dlBackup"]) assert.match(html, new RegExp('id="' + id + '" class="btn btn-secondary"'));
  const app = makeApp();
  app.setup({ rows: octRows().map((r, i) => i === 2 ? { ...r, kind: "plan" } : r), clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  for (const id of ["planList", "actList", "cfgClients", "cfgPrices"]) {
    const del = findAll(app.els[id], c => c.tagName === "button" && c.textContent === "削除");
    assert.ok(del.length > 0 && del.every(b => String(b.className).includes(id.startsWith("cfg") ? "btn-danger" : "btn-text-del")), id + " の削除は赤");
  }
  for (const id of ["cfgClients", "cfgPrices"]) {
    const ed = findAll(app.els[id], c => c.tagName === "button" && c.textContent === "編集");
    assert.ok(ed.every(b => String(b.className).includes("btn-secondary") && String(b.className).includes("btn-sm")));
  }
  const go = findAll(app.els["planList"], c => c.tagName === "button" && c.textContent === "実績にする");
  assert.ok(go.length === 1 && String(go[0].className).includes("btn-secondary"), "枠つきのボタンは「実績にする」だけ");
  for (const t of ["直す", "削除", "予定に戻す"]) for (const b of findAll(app.els["actList"], c => c.tagName === "button" && c.textContent === t)) assert.ok(String(b.className).includes("btn-text"), t + " は文字だけのボタン");
});
test("表示の色: ライト/ダーク/端末に合わせるを選べる。専用の保存場所だけに覚え、アプリのデータには触らない", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const keysBefore = Object.keys(app.storage).filter(k => k !== "seikyu-matome-theme-v1");
  const dataBefore = keep(app);
  app.fire("themeDark", "click");
  assert.equal(app.storage["seikyu-matome-theme-v1"], "dark");
  assert.equal(app.root()._a["data-theme"], "dark");
  assert.equal(app.els["themeDark"]._a["aria-pressed"], "true"); assert.equal(app.els["themeLight"]._a["aria-pressed"], "false");
  app.fire("themeLight", "click"); assert.equal(app.storage["seikyu-matome-theme-v1"], "light"); assert.equal(app.root()._a["data-theme"], "light");
  app.fire("themeAuto", "click"); assert.equal(app.storage["seikyu-matome-theme-v1"], "auto"); assert.equal(app.root()._a["data-theme"], undefined);
  assert.deepEqual(Object.keys(app.storage).filter(k => k !== "seikyu-matome-theme-v1"), keysBefore, "アプリのデータの保存場所は増えも変わりもしない");
  assert.equal(keep(app), dataBefore);
  // 開き直すと、覚えた色になる。保存できなくても壊れない
  app.fire("themeDark", "click");
  const again = makeApp({ storage: app.storage });
  assert.equal(again.root()._a["data-theme"], "dark");
  const bad = makeApp(); bad.failStorage(true);
  assert.doesNotThrow(() => bad.fire("themeLight", "click")); assert.equal(bad.root()._a["data-theme"], "light");
  assert.equal(bad.els["serr"] === undefined || bad.els["serr"].hidden !== false, true, "色の保存の失敗は、アプリの保存の失敗として出さない");
});
test("作り: サイドメニューは無く、頭のメニューから設定・控えへ行ける。区画の見出しの横に短い説明がある。練習作品の表示がある", () => {
  assert.ok(!/<aside class="sidebar">|class="app-shell"|id="sideNav"|id="nav-/.test(html), "サイドメニューは無い");
  const head = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert.match(head, /<nav aria-label="メニュー"/);
  assert.match(head, /id="openCal"[^>]*>[\s\S]*カレンダーで見る/);
  assert.match(head, /<a class="btn btn-secondary" href="#sec-settings">設定<\/a>/); assert.match(head, /<a class="btn btn-secondary" href="#sec-backup">控え\(バックアップ\)<\/a>/);
  for (const id of ["sec-settings", "sec-backup", "sec-out", "sec-enter", "guide"]) assert.equal((html.match(new RegExp('<section id="' + id + '"', "g")) || []).length, 1, id + " の区画は1つ");
  assert.equal((html.match(/id="sec-list"/g) || []).length, 1);
  assert.match(head, /請求まとめ ・ 練習作品/);
  const expl = { "sec-settings": "取引先と品目を登録しておくと、入力で選べます。", "sec-backup": "入力と設定を、ファイルに控えます。" };
  for (const [id, s] of Object.entries(expl)) assert.ok(sectionChunk(id).includes('<span class="sub">' + s + "</span>"), id);
  const out = sectionChunk("sec-out");
  assert.ok(out.indexOf('id="dlCus"') < out.indexOf('id="dlItem"') && !out.includes('id="dlInv"'), "明細CSVのボタンは板の中だけ");
  assert.match(out, /<div class="actions actions-end">\s*<button id="dlCus"/);
  assert.ok(html.indexOf('id="themeAuto"') > html.indexOf('id="sec-backup"') && html.indexOf('id="themeAuto"') < html.indexOf("<summary>このアプリについて</summary>"), "表示の色はページの下、「このアプリについて」の上");
  assert.match(sectionChunk("sec-enter"), /<button type="submit" class="btn btn-primary" id="submitBtn">追加する<\/button>\s*<button type="button" class="btn btn-secondary" id="cancelEdit" hidden>直すのをやめる<\/button>/);
  assert.ok(!html.includes("twocol"), "左右に並べない");
  assert.match(html, /\.steps li::before\{content:counter\(s\)/);
});

// ================= 表の読みやすさ・時間帯の列・取引先と品目は別々のカード =================
test("カード: 予定は点線・実績は塗り。日付・取引先(色の点つき)・サービスと時間帯・数量が文字で出る。時間帯が無い行は数量だけ", () => {
  const app = makeApp();
  app.setup({ rows: [{ ...R("2026-10-05", "A社", "作業サービス", 1.5), start: "09:00", end: "10:30" }, R("2026-10-06", "A社", "作業サービス", 2), R("2026-10-07", "A社", "相談サービス", 1), R("2026-10-08", "A社", "作業サービス", 1, "plan")], clients: { "A社": A }, prices: PRICES, bank: GOOD_BANK });
  app.run('cfg.units["相談サービス"]="回"; render()');
  const cards = box => findAll(app.els[box], c => c.tagName === "article");
  assert.equal(cards("actList").length, 3); assert.equal(cards("planList").length, 1);
  const det = findAll(app.els["actList"], c => c.className === "cdetail").map(c => c.textContent);
  assert.deepEqual(det, ["作業サービス ・ 9:00〜10:30(1.5時間)", "作業サービス ・ 2時間", "相談サービス ・ 1回"]);
  assert.equal(String(cards("planList")[0].className), "card card-plan"); assert.equal(String(cards("actList")[0].className), "card");
  const kick = findAll(app.els["actList"], c => c.className === "kicker").map(c => c.textContent);
  assert.deepEqual(kick, ["10/5(月)", "10/6(火)", "10/7(水)"]);
  const names = findAll(app.els["actList"], c => c.className === "cname").map(textOf);
  assert.deepEqual(names, ["A社", "A社", "A社"], "取引先の名前は必ず文字で出る");
  assert.ok(findAll(app.els["actList"], c => String(c.className).startsWith("who c1")).length === 3, "色の点は class で決める");
  assert.equal(app.els["planCount"].textContent, "1件"); assert.equal(app.els["actCount"].textContent, "3件");
  // 読み上げ用の名前
  const ed = findAll(app.els["actList"], c => c.tagName === "button" && c.textContent === "直す")[0];
  assert.equal(ed._a["aria-label"], "10/5 A社 を直す");
  const dl = findAll(app.els["actList"], c => c.tagName === "button" && c.textContent === "削除")[0];
  assert.equal(dl._a["aria-label"], "10/5 A社 を削除");
  // 空のとき
  app.setup({ rows: [], clients: { "A社": A }, prices: PRICES });
  assert.equal(textOf(app.els["planList"]), "予定はありません。先の日付を入れると、ここに予定として入ります。"); assert.equal(textOf(app.els["actList"]), "まだ実績はありません。");
  assert.equal(app.els["bulkAct"].hidden, true);
});
test("表の文字: 本文は16px、見出しは14pxの太字、名前は読みやすい色。使用中の注記は1行で、表は折り返さず幅いっぱいに積む", () => {
  assert.match(html, /table\{width:100%;border-collapse:collapse;font-size:var\(--fs-body\)\}/);
  assert.match(html, /th\{font-size:var\(--fs-sub\);font-weight:700;/);
  assert.match(html, /\.scroll td\{color:var\(--text\);font-weight:400\}/);
  assert.match(html, /\.scroll td \.hint\{white-space:nowrap/);
  assert.match(html, /\.scroll th,\.scroll td\{white-space:nowrap\}/);
});
test("設定: 取引先と品目は、別々のカード(見出し・短い説明・右に登録ボタン・全幅の表)で上下に並ぶ。振込先と件名は小さなカード", () => {
  const s = html.slice(html.indexOf('<section id="sec-settings"'), html.indexOf("</section>", html.indexOf('<section id="sec-settings"')));
  const ia = s.indexOf('id="cardClients"'), ib = s.indexOf('id="cardItems"'), ic = s.indexOf('id="cardBank"');
  assert.ok(ia > 0 && ia < ib && ib < ic, "取引先 → 品目 → 振込先");
  const A1 = s.slice(ia, ib), B1 = s.slice(ib, ic), C1 = s.slice(ic);
  assert.ok(A1.includes("<h3>取引先</h3>") && A1.includes('class="sub"') && A1.includes('id="clientNew"') && A1.includes('id="cfgClients"') && !A1.includes("cfgPrices"));
  assert.ok(B1.includes("<h3>品目</h3>") && B1.includes('class="sub"') && B1.includes('id="itemNew"') && B1.includes('id="cfgPrices"') && !B1.includes("cfgClients"));
  assert.ok(C1.includes('id="bank"') && C1.includes('id="subject"'));
  assert.ok(A1.indexOf("<h3>取引先</h3>") < A1.indexOf('id="clientNew"'), "登録ボタンは見出しの右");
  assert.ok(!html.includes("twocol") && !/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(html), "左右に並べる指定は無い");
  assert.match(html, /\.subcard\{border:1px solid var\(--border-sub\)/);
});

// ================= 新しい画面「C+B」(版 2.0.0。2026-10-21) =================
// ダミーの名前: ダミーA社・ダミーB社・作業サービス(時間)・点検サービス(回)。デモ版は決まった名前(A社・B社・作業サービス・相談サービス)で同じことを確かめる
const NM = DEMO ? { c1: "A社", c2: "B社", s1: "作業サービス", s2: "相談サービス" } : { c1: "ダミーA社", c2: "ダミーB社", s1: "作業サービス", s2: "点検サービス" };
const SH = DEMO ? { c1: "A", c2: "B", s1: "作業", s2: "相談" } : { c1: "A", c2: "B", s1: "作業", s2: "点検" };
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime(); // 2026-10-21 12:00(日本時間)
const lineApp = (rowList = [], { month = "2026-10", now = NOW, prices = { [NM.s1]: 3000, [NM.s2]: 5000 }, withPlan = false } = {}) => {
  const app = makeApp({ now });
  app.setup({ rows: rowList, clients: { [NM.c1]: A, [NM.c2]: B }, prices, bank: GOOD_BANK, month, withPlan });
  app.run(`cfg.units[${JSON.stringify(NM.s2)}]="回"; render()`);
  return app;
};
const PL = (app, text, mo = "2026-10") => J(app, `parseLine(${JSON.stringify(text)}, ${JSON.stringify(mo)})`);
const rowOf = (date, c, s, h, kind = "act", extra = {}) => ({ id: Math.random(), date, client: c, service: s, hours: h, kind, ...extra });
const stripId = r => { const { id, ...x } = r; return x; };
const btnsOf = (app, box, t) => findAll(app.els[box], c => c.tagName === "button" && c.textContent === t);

test("1行(新1): 全角でも読める(日付・取引先・サービス・09:00/11:00・2時間)", () => {
  const app = lineApp();
  const p = PL(app, "１０/２１ Ａ 作業 ９:００-１１:００");
  assert.equal(p.ok, true, JSON.stringify(p.miss));
  assert.deepEqual(p.v, { date: "2026-10-21", client: NM.c1, service: NM.s1, hours: 2, kind: "act", start: "09:00", end: "11:00" });
  const q = PL(app, "10月21日 b 作業 9-11");
  assert.equal(q.v.client, NM.c2); assert.equal(q.v.start, "09:00"); assert.equal(q.v.end, "11:00");
  assert.equal(PL(app, "2026/10/21 A 作業 1.5h").v.date, "2026-10-21");
  assert.equal(PL(app, "10/21 A 作業 9～11").ok, true, "全角のなみ線も読める");
  assert.equal(PL(app, "10/21　A　作業　9〜11").ok, true, "全角の空白で区切ってもよい");
});
test("1行(新2): 名前の当て方。法人格とダミーを外して比べ、ぴったり同じが1つならそれ、2つ以上なら止めて候補を出す", () => {
  const app = lineApp();
  assert.deepEqual(J(app, 'matchNames(["ダミーA社","ダミーB社"],"ダミー")'), ["ダミーA社", "ダミーB社"]);
  assert.deepEqual(J(app, 'matchNames(["A社","A社東"],"A社")'), ["A社"], "ぴったり同じが1つならそれ");
  assert.deepEqual(J(app, 'matchNames(["A社","A社東"],"A")'), ["A社", "A社東"]);
  assert.deepEqual(J(app, 'matchNames(["株式会社テスト","テスト商会"],"テスト")'), ["株式会社テスト"], "法人格を外して比べ、ぴったり同じ");
  assert.deepEqual(J(app, 'matchNames(["株式会社テスト","有限会社テスト"],"テスト")'), ["株式会社テスト", "有限会社テスト"], "同じものが2つなら止める");
  assert.deepEqual(J(app, 'matchNames(["Ａ社"],"a")'), ["Ａ社"], "全角半角・大文字小文字は区別しない");
  assert.deepEqual(J(app, 'matchNames(["ダミーA社"],"ほげ")'), []);
  if (!DEMO) {
    const before = keep(app);
    const p = PL(app, "10/21 ダミー 作業 2h");
    assert.equal(p.ok, false);
    assert.ok(p.parts.some(x => x.t === "取引先の候補: ダミーA社 / ダミーB社" && x.cls === "chip-miss"), JSON.stringify(p.parts));
    assert.ok(p.miss.some(x => x.includes("候補が2つ")));
    app.fire("modeLine", "click"); $e(app, "q").value = "10/21 ダミー 作業 2h"; app.fire("f", "submit");
    assert.equal(keep(app), before, "止まり、行は増えない");
    assert.ok($e(app, "fmsg").textContent.startsWith("エラー: ") && $e(app, "fmsg").textContent.endsWith("を直してから押してください。"), $e(app, "fmsg").textContent);
    assert.equal($e(app, "q")._a["aria-invalid"], "true");
  }
});
test("1行(新3): 読めない言葉・ない日付・終了が開始より前は止める。9:10-10:00 は 0.83 時間で保存できる", () => {
  const app = lineApp();
  let p = PL(app, "10/21 A 作業 2h ほげ");
  assert.equal(p.ok, false); assert.ok(p.parts.some(x => x.t === "「ほげ」は読めません" && x.cls === "chip-miss")); assert.ok(p.miss.includes("読めない言葉「ほげ」"));
  p = PL(app, "2/30 A 作業 2h"); assert.equal(p.ok, false); assert.ok(p.parts.some(x => x.t.startsWith("「2/30」は読めません")));
  p = PL(app, "10/21 A 作業 11-9"); assert.equal(p.ok, false); assert.ok(p.parts.some(x => x.t.includes("終了は開始より後に")), JSON.stringify(p.parts));
  p = PL(app, "10/21 A 作業 25:00-26:00"); assert.equal(p.ok, false);
  p = PL(app, "10/21 10/22 A 作業 2h"); assert.equal(p.ok, false); assert.ok(p.miss.some(x => x.includes("10/22")), "2つ目の日付は読めない言葉");
  p = PL(app, "10-21 A 作業 2h"); assert.equal(p.ok, false); assert.ok(p.miss.includes("日付(例 10/21)"), "「10-21」は日付として受けない");
  p = PL(app, "10/21 A 作業 9:10-10:00"); assert.equal(p.ok, true); assert.deepEqual([p.v.hours, p.v.start, p.v.end], [0.83, "09:10", "10:00"]);
  app.fire("modeLine", "click"); $e(app, "q").value = "10/21 A 作業 9:10-10:00"; app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1); assert.deepEqual(J(app, "[rows[0].hours,rows[0].start,rows[0].end]"), [0.83, "09:10", "10:00"]);
  $e(app, "q").value = "10/21 A 作業 2h ほげ"; app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 1, "読めない言葉があると、行は増えない");
  assert.equal($e(app, "q")._a["aria-invalid"], "true"); assert.ok($e(app, "fmsg").textContent.startsWith("エラー: "));
  assert.equal(String($e(app, "fmsg").className), "note err", "赤い太字");
  $e(app, "q").value = "10/21 A 作業 2h"; app.fire("q", "input");
  assert.equal($e(app, "q")._a["aria-invalid"], undefined, "直したら印は消える"); assert.equal($e(app, "fmsg").textContent, "Enterキーでも追加できます。");
});
test("1行(新4): 回のサービスは時間なしで1回、「2回」で2回。時間のサービスで時間なしは止まる。「1.5h」は通る", () => {
  const app = lineApp();
  let p = PL(app, `10/21 ${SH.c2} ${SH.s2}`);
  assert.equal(p.ok, true); assert.deepEqual([p.v.service, p.v.hours, p.v.start, p.v.end], [NM.s2, 1, "", ""]);
  p = PL(app, `10/21 ${SH.c2} ${SH.s2} 2回`); assert.equal(p.v.hours, 2);
  p = PL(app, `10/21 ${SH.c2} ${SH.s2} 9:00-10:00`); assert.equal(p.ok, true); assert.deepEqual([p.v.hours, p.v.start], [1, ""], "時間帯は記録しない");
  assert.ok(p.parts.some(x => x.t === "時間帯は記録しません"));
  p = PL(app, `10/21 ${SH.c2} ${SH.s2} 1.5h`); assert.equal(p.ok, false, "回に「1.5h」は読めない");
  p = PL(app, `10/21 ${SH.c2} ${SH.s2} 0回`); assert.equal(p.ok, false);
  p = PL(app, `10/21 ${SH.c1} ${SH.s1}`); assert.equal(p.ok, false); assert.ok(p.miss.includes("時間(例 9:00-11:00)"));
  p = PL(app, `10/21 ${SH.c1} ${SH.s1} 1.5h`); assert.equal(p.ok, true); assert.deepEqual([p.v.hours, p.v.start], [1.5, ""]);
  p = PL(app, `10/21 ${SH.c1} ${SH.s1} 1.5時間`); assert.equal(p.v.hours, 1.5);
  p = PL(app, `10/21 ${SH.c1} ${SH.s1} 2回`); assert.equal(p.ok, false);
  p = PL(app, `10/21 ${SH.c1} ${SH.s1} 10:00-12:00 3h`); assert.equal(p.ok, false); assert.ok(p.miss.includes("時間と、開始・終了が合いません"));
  p = PL(app, `10/21 ${SH.c1} ${SH.s1} 10:00-12:00 2h`); assert.equal(p.ok, true);
  p = PL(app, "10/21 ほげ"); assert.equal(p.ok, false);
});
test("1行(新5): 今日(2026-10-21)までは実績、先は予定。「予定」「実績」の言葉が勝つ", () => {
  const app = lineApp();
  const k = t => PL(app, `${t} ${SH.c1} ${SH.s1} 1h`).v.kind;
  assert.equal(k("10/20"), "act"); assert.equal(k("10/21"), "act"); assert.equal(k("10/22"), "plan");
  assert.equal(k("10/21 予定"), "plan"); assert.equal(k("10/22 実績"), "act");
  assert.equal(app.run('kindFor("2026-10-21")'), "act"); assert.equal(app.run('kindFor("2026-10-22")'), "plan");
  // 欄の「日付で決める」も同じ決まり
  for (const [id, v] of [["date", "2026-10-22"], ["client", NM.c1], ["service", NM.s1], ["hours", "1"], ["kind", "auto"]]) $e(app, id).value = v;
  app.fire("f", "submit"); assert.equal(app.run("rows[0].kind"), "plan");
  for (const [id, v] of [["date", "2026-10-22"], ["hours", "1"], ["kind", "act"]]) $e(app, id).value = v;
  app.fire("f", "submit"); assert.equal(app.run("rows[1].kind"), "act", "欄で「実績」を選べば実績");
});
test("1行(新6): 年は表示中の月の年。6か月を超えて離れるなら、前の年・次の年", () => {
  const app = lineApp();
  assert.equal(PL(app, `1/5 ${SH.c1} ${SH.s1} 1h`, "2026-12").v.date, "2027-01-05");
  assert.equal(PL(app, `12/28 ${SH.c1} ${SH.s1} 1h`, "2027-01").v.date, "2026-12-28");
  assert.equal(PL(app, `4/1 ${SH.c1} ${SH.s1} 1h`).v.date, "2026-04-01", "ちょうど6か月前は同じ年");
  assert.equal(PL(app, `3/31 ${SH.c1} ${SH.s1} 1h`).v.date, "2027-03-31", "7か月前なら次の年");
  assert.equal(PL(app, `2024/2/29 ${SH.c1} ${SH.s1} 1h`).v.date, "2024-02-29", "年つきはそのまま");
  assert.equal(PL(app, `2/29 ${SH.c1} ${SH.s1} 1h`, "2028-02").v.date, "2028-02-29", "うるう日");
  assert.equal(PL(app, `2/29 ${SH.c1} ${SH.s1} 1h`, "2026-10").ok, false, "2027年にずれて、ない日付になる");
  const p = PL(app, `11/3 ${SH.c1} ${SH.s1} 1h`);
  assert.ok(p.parts[0].t.includes("※11月に入ります"), p.parts[0].t);
});
test("1行(新7): 1行と欄で同じ形の行が入る。札・足りないものの文・帯・元に戻す", () => {
  const app = lineApp();
  assert.equal(app.run("mode"), "form");
  for (const [id, v] of [["date", "2026-10-21"], ["client", NM.c1], ["service", NM.s1], ["hours", "2"], ["tmStart", "09:00"], ["tmEnd", "11:00"], ["kind", "auto"]]) $e(app, id).value = v;
  app.fire("f", "submit");
  app.fire("modeLine", "click");
  // 札と文
  $e(app, "q").value = "10/21"; app.fire("q", "input");
  assert.equal($e(app, "fmsg").textContent, "まだ足りないもの: 取引先、サービス");
  assert.equal(String($e(app, "fmsg").className), "note");
  assert.deepEqual($e(app, "qRead").children.map(c => c.textContent), ["読み取り:", "10/21(水)", "取引先が分かりません", "サービスが分かりません", "実績として"]);
  assert.equal($e(app, "qRead").children[2].className, "chip-miss"); assert.equal($e(app, "qRead").children[1].className, "chip-ok");
  $e(app, "q").value = `10/21 ${SH.c1} ${SH.s1} 9:00-11:00`; app.fire("q", "input");
  assert.equal($e(app, "fmsg").textContent, "Enterキーでも追加できます。");
  app.fire("f", "submit");
  const [a, b] = J(app, "rows");
  assert.deepEqual(stripId(a), stripId(b), "欄と1行で同じ形");
  assert.deepEqual(stripId(a), { date: "2026-10-21", client: NM.c1, service: NM.s1, hours: 2, kind: "act", start: "09:00", end: "11:00" });
  assert.equal(JSON.parse(app.storage[SK]).length, 2);
  assert.equal($e(app, "toastMsg").textContent, `10/21 ${NM.c1} を実績に追加しました。`);
  assert.equal($e(app, "toast").hidden, false); assert.equal($e(app, "undoBtn").hidden, false);
  assert.equal($e(app, "q").value, "", "追加したら1行の欄は空になる");
  app.fire("undoBtn", "click");
  assert.equal(app.run("rows.length"), 1); assert.equal($e(app, "toastMsg").textContent, "元に戻しました。"); assert.equal($e(app, "undoBtn").hidden, true);
  // 別の月の日付を入れたら、その月へ移る
  $e(app, "q").value = `11/3 ${SH.c1} ${SH.s1} 1h`; app.fire("f", "submit");
  assert.equal(app.els["month"].value, "2026-11"); assert.ok($e(app, "toastMsg").textContent.includes("(11月に移りました)"), $e(app, "toastMsg").textContent);
  assert.equal($e(app, "monthNum").textContent, "11");
  // 直す: 1行に中身が入り、直した内容で保存できる
  gotoMonth(app, "2026-10");
  app.run("startEdit(rows[0])");
  assert.equal($e(app, "addTitle").textContent, "記録を直す"); assert.equal($e(app, "editing").hidden, false);
  assert.equal($e(app, "q").value, `2026/10/21 ${NM.c1} ${NM.s1} 09:00-11:00 実績`);
  assert.equal($e(app, "date").value, "2026-10-21"); assert.equal($e(app, "hours").value, 2, "欄にも入る");
  assert.equal($e(app, "submitBtn").textContent, "直した内容で保存する");
  const id0 = app.run("rows[0].id");
  $e(app, "q").value = $e(app, "q").value.replace("09:00-11:00", "13:00-15:30"); app.fire("f", "submit");
  assert.equal(app.run("rows.length"), 2); assert.equal(app.run("rows[0].id"), id0);
  assert.deepEqual(J(app, "[rows[0].hours,rows[0].start,rows[0].end]"), [2.5, "13:00", "15:30"]);
  assert.equal($e(app, "toastMsg").textContent, `10/21 ${NM.c1} を直しました。`);
  assert.equal(app.run("editId"), null); assert.equal($e(app, "addTitle").textContent, "記録を入れる"); assert.equal($e(app, "editing").hidden, true);
  // 「押すと欄に入ります」
  const pc = findAll(app.els["pickClients"], c => c.tagName === "button");
  assert.ok(pc.length >= 2); $e(app, "q").value = ""; pc[0].onclick();
  assert.equal($e(app, "q").value, NM.c1.toUpperCase() + " ", "名前を差しこむ");
  const ps = findAll(app.els["pickServices"], c => c.tagName === "button"); ps[0].onclick();
  assert.ok($e(app, "q").value.startsWith(NM.c1.toUpperCase() + " ") && $e(app, "q").value.endsWith(" "));
  assert.equal(PL(app, `10/21 ${$e(app, "q").value}1h`).ok, true, "差しこんだ名前は、そのまま読める");
});
test("1行(新8): 行を1行の文にして読み戻すと、同じ中身になる(時間帯あり・なし、2回)", () => {
  const rs = [rowOf("2026-10-02", NM.c1, NM.s1, 2, "act", { start: "09:00", end: "11:00" }), rowOf("2026-10-03", NM.c1, NM.s1, 1.5, "plan"), rowOf("2026-10-07", NM.c2, NM.s2, 1, "act"), rowOf("2026-10-09", NM.c2, NM.s2, 2, "plan"), rowOf("2026-10-10", NM.c1, NM.s1, 0.83, "act", { start: "09:10", end: "10:00" })];
  const app = lineApp(rs);
  for (const r of rs) {
    const line = J(app, `lineOf(${JSON.stringify(r)})`), p = PL(app, line);
    assert.equal(p.ok, true, line + " " + JSON.stringify(p.miss));
    assert.deepEqual(p.v, { date: r.date, client: r.client, service: r.service, hours: r.hours, kind: r.kind, start: r.start || "", end: r.end || "" }, line);
  }
  const L = i => J(app, `lineOf(${JSON.stringify(rs[i])})`);
  assert.equal(L(0), `2026/10/2 ${NM.c1} ${NM.s1} 09:00-11:00 実績`); assert.equal(L(1), `2026/10/3 ${NM.c1} ${NM.s1} 1.5時間 予定`);
  assert.equal(L(2), `2026/10/7 ${NM.c2} ${NM.s2} 実績`); assert.equal(L(3), `2026/10/9 ${NM.c2} ${NM.s2} 2回 予定`);
  // 時間数だけの行を直す: 欄にも1行にも入って、そのまま保存できる
  app.run("startEdit(rows[1])");
  assert.equal($e(app, "q").value, L(1)); assert.equal($e(app, "hours").value, 1.5);
  app.fire("modeLine", "click"); app.fire("f", "submit");
  assert.equal(app.run("rows[1].hours"), 1.5); assert.equal(app.run("rows[1].start"), undefined);
  // 名前に空白がある取引先も、空白を除いた形で往復できる
  const sp = lineApp([rowOf("2026-10-02", "株式会社 テスト", NM.s1, 1, "act")]);
  const rr = J(sp, "rows[0]"), ln = J(sp, `lineOf(${JSON.stringify(rr)})`);
  if (!DEMO) { const pp = PL(sp, ln); assert.equal(pp.ok, true, ln); assert.equal(pp.v.client, "株式会社 テスト"); }
});
test("入れ方(新9): 初めは欄。1行に切りかえると覚え、開き直しても1行。保存できなくても壊れない。アプリのデータの保存場所は増えない", () => {
  const app = makeApp();
  assert.equal(app.run("mode"), "form"); assert.equal($e(app, "lineBox").hidden, true); assert.equal($e(app, "formBox").hidden, false);
  assert.equal($e(app, "modeForm")._a["aria-pressed"], "true"); assert.equal($e(app, "modeLine")._a["aria-pressed"], "false");
  const keys0 = Object.keys(app.storage);
  app.fire("modeLine", "click");
  assert.equal(app.storage["seikyu-matome-input-v1"], "line"); assert.equal($e(app, "lineBox").hidden, false); assert.equal($e(app, "formBox").hidden, true);
  assert.equal($e(app, "modeLine")._a["aria-pressed"], "true");
  assert.deepEqual(Object.keys(app.storage).filter(k => k !== "seikyu-matome-input-v1"), keys0, "アプリのデータの保存場所は増えない");
  const again = makeApp({ storage: app.storage });
  assert.equal(again.run("mode"), "line"); assert.equal(again.els["lineBox"].hidden, false); assert.equal(again.els["formBox"].hidden, true);
  app.fire("modeForm", "click"); assert.equal(app.storage["seikyu-matome-input-v1"], "form");
  assert.equal(makeApp({ storage: app.storage }).run("mode"), "form");
  const bad = makeApp(); bad.failStorage(true);
  assert.doesNotThrow(() => bad.fire("modeLine", "click")); assert.equal(bad.run("mode"), "line");
  assert.equal(bad.els["serr"] === undefined || bad.els["serr"].hidden !== false, true, "入れ方の保存の失敗は、アプリの保存の失敗として出さない");
  // 欄 → 1行 → 欄 の切りかえで、入れかけの中身を引き継ぐ
  const c = lineApp();
  for (const [id, v] of [["date", "2026-10-21"], ["client", NM.c1], ["service", NM.s1], ["hours", "2"], ["tmStart", "09:00"], ["tmEnd", "11:00"]]) $e(c, id).value = v;
  c.fire("modeLine", "click"); assert.equal($e(c, "q").value, `2026/10/21 ${NM.c1} ${NM.s1} 09:00-11:00 実績`);
  $e(c, "q").value = `10/22 ${SH.c2} ${SH.s1} 1.5h`; c.fire("modeForm", "click");
  assert.deepEqual(["date", "client", "service", "hours", "kind"].map(id => $e(c, id).value), ["2026-10-22", NM.c2, NM.s1, 1.5, "plan"]);
});
test("お知らせの帯(新11): 初めは隠れ、自動では消えない。×で閉じる。保存の変更・別のタブで「元に戻す」が隠れる", () => {
  assert.match(html, /<div class="toast" id="toast" role="status" hidden>/);
  assert.match(html, /id="toastClose" aria-label="お知らせを閉じる">×<\/button>/);
  assert.ok(!/setTimeout\s*\(|setInterval\s*\(/.test(SOURCE), "帯を消す時計仕掛けは無い");
  const app = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "plan"), rowOf("2026-10-04", NM.c1, NM.s1, 1, "plan")]);
  assert.notEqual($e(app, "toast").hidden, false, "初めは隠れている(HTMLの hidden)");
  btnsOf(app, "planList", "実績にする")[0].onclick();
  assert.equal($e(app, "toast").hidden, false); assert.equal($e(app, "undoBtn").hidden, false);
  assert.equal($e(app, "toastMsg").textContent, `10/3 ${NM.c1} を実績にしました。`);
  assert.equal($e(app, "undoBtn")._a["aria-label"], "元に戻す(実績にした)");
  app.run("saveRows()");
  assert.equal($e(app, "undoBtn").hidden, true, "行を保存し直したら、元に戻すは隠れる"); assert.equal($e(app, "toast").hidden, false, "帯は残る");
  btnsOf(app, "actList", "予定に戻す")[0].onclick();
  assert.equal($e(app, "toastMsg").textContent, `10/3 ${NM.c1} を予定に戻しました。`); assert.equal($e(app, "undoBtn").hidden, false);
  app.storage[SK] = JSON.stringify([]); app.handlers.storage[0]({ key: SK });
  assert.equal(app.run("undo"), null); assert.equal($e(app, "undoBtn").hidden, true, "別のタブで変わったら戻せない");
  app.fire("toastClose", "click"); assert.equal($e(app, "toast").hidden, true);
  // 一括: 件数の文と、元に戻す
  const b = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "plan"), rowOf("2026-10-04", NM.c1, NM.s1, 1, "plan")]);
  assert.equal(b.els["bulkAct"].textContent, "2件とも実績にする");
  b.fire("bulkAct", "click"); assert.equal($e(b, "toastMsg").textContent, "2件を実績にしました。"); assert.equal($e(b, "undoBtn").hidden, false);
  assert.equal(b.els["bulkAct"].hidden, true, "予定が0件なら出ない");
  b.fire("undoBtn", "click"); assert.deepEqual(J(b, "rows.map(r=>r.kind)"), ["plan", "plan"]);
  const one = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "plan")]); assert.equal(one.els["bulkAct"].textContent, "1件を実績にする");
});
test("明細CSVのボタン(新12): 止める・予定が残る・予定も入る・すべて実績の4つの状態(class・disabled・理由の文)", () => {
  const rsAct = [rowOf("2026-10-03", NM.c1, NM.s1, 2, "act")], plan = rowOf("2026-10-04", NM.c1, NM.s1, 1, "plan");
  const cls = a => String(a.els["dlInv"].className), rs = a => a.els["csvReason"].textContent;
  // 初め(行なし): 止める
  let app = lineApp([]);
  assert.equal(app.els["dlInv"].disabled, true); assert.ok(cls(app).includes("btn-secondary") && !cls(app).includes("btn-primary"));
  assert.equal(rs(app), "記録を入れると、ここに請求書が出ます。"); assert.equal(String(app.els["csvReason"].className), "reason", "赤字のエラーにしない");
  // 予定だけで、出せる行が無い月は、エラーとして止める
  app = lineApp([rowOf("2026-10-04", NM.c1, NM.s1, 1, "plan")]);
  assert.ok(rs(app).startsWith("エラー: この月に出せる行がありません") && rs(app).endsWith("。下の『CSVに書き出す(くわしく)』で確かめてください"), rs(app));
  assert.equal(String(app.els["csvReason"].className), "reason-err");
  // 止める(単価なし)+ほかの件数
  app = lineApp(rsAct, { prices: {} });
  assert.equal(app.els["dlInv"].disabled, true); assert.ok(rs(app).startsWith("エラー: 単価が未設定: " + NM.s1), rs(app));
  app.run('cfg.bank=""; renderOut()'); // 振込先が空: DEMO版は固定なのでここは実用版だけ確かめる
  if (!DEMO) assert.ok(/\(ほか1件\)。下の『CSVに書き出す\(くわしく\)』で確かめてください$/.test(rs(app)), rs(app));
  // 予定が残る(含めない)
  app = lineApp([...rsAct, plan]);
  assert.equal(app.els["dlInv"].disabled, false); assert.ok(cls(app).includes("btn-secondary"));
  assert.equal(rs(app), "まだ予定が1件あります。実績にしてから保存するのがおすすめです(予定は入りません)。"); assert.equal(String(app.els["csvReason"].className), "reason-strong");
  // 予定も含める
  app = lineApp([...rsAct, plan], { withPlan: true });
  assert.equal(app.els["dlInv"].disabled, false); assert.ok(cls(app).includes("btn-secondary"));
  assert.equal(rs(app), "予定も1件、請求書に入ります。");
  // すべて実績
  app = lineApp(rsAct);
  assert.equal(app.els["dlInv"].disabled, false); assert.ok(cls(app).includes("btn-primary") && !cls(app).includes("btn-secondary"));
  assert.equal(rs(app), "予定がすべて実績になりました。保存できます。"); assert.equal(String(app.els["csvReason"].className), "reason");
  // 予定を実績にすると、主ボタンになる
  app = lineApp([...rsAct, plan]); btnsOf(app, "planList", "実績にする")[0].onclick();
  assert.ok(cls(app).includes("btn-primary")); assert.equal(rs(app), "予定がすべて実績になりました。保存できます。");
  // 押すと保存が始まる(今までどおり)
  app.fire("dlInv", "click"); assert.ok(app.els["msg"].textContent.includes("明細CSVの保存を始めました"));
});
test("金額の目安(新13): 単価の履歴に従う。未設定なら金額を出さない。CSVの金額の列は数字だけ(桁区切りなし)", () => {
  const rs = [rowOf("2026-12-03", NM.c1, NM.s1, 2, "act"), rowOf("2026-12-04", NM.c1, NM.s2, 1, "act"), rowOf("2026-12-05", NM.c2, NM.s1, 1.5, "act")];
  const app = lineApp(rs, { month: "2026-12" });
  app.run(`setPrice(${JSON.stringify(NM.s1)},"2026-12",3500); render()`);
  const bills = () => findAll(app.els["bills"], c => c.className === "bill").map(textOf);
  // A: 作業 2h×3,500 + 1回×5,000 = 12,000 / B: 1.5h×3,500 = 5,250
  assert.deepEqual(bills(), [`${NM.c1}12,000円2時間 + 1回`, `${NM.c2}5,250円1.5時間`]);
  assert.ok(textOf(app.els["bills"]).includes("金額の目安(単価×数量)"));
  assert.equal(app.els["outSummary"].textContent, "実績の3件を、取引先ごとに2枚の請求書にまとめます。予定は入りません。");
  assert.ok(html.includes("金額の目安は、単価×数量です。税の表示や端数処理の設定は反映しません。税は計算しません。お使いの請求書ソフトや表計算で行ってください。"));
  // 前の月の単価(最初の単価)
  gotoMonth(app, "2026-12"); app.run(`setPrice(${JSON.stringify(NM.s1)},"2026-11",3000); setPrice(${JSON.stringify(NM.s1)},"2026-12",3500); render()`);
  const csv12 = app.run("invoiceCsv()");
  assert.ok(!csv12.includes("12,000") && !csv12.includes("5,250"), "桁区切りの金額は入らない");
  const c12 = parseCsvLine(csv12.split("\r\n")[1]);
  assert.deepEqual([c12[14], c12[15]], ["3500", "7000"], "単価と、金額(単価×数量)");
  // 未設定の品目があれば、金額は出さない
  const u = lineApp(rs, { month: "2026-12", prices: { [NM.s1]: 3000, [NM.s2]: "" } });
  assert.ok(textOf(u.els["bills"]).includes("単価が未設定の品目があります"));
  assert.ok(!findAll(u.els["bills"], c => c.className === "bill").map(textOf)[0].includes("円"), "金額は出ない");
  assert.ok(findAll(u.els["bills"], c => c.className === "bill").map(textOf)[1].includes("4,500円"), "単価がそろう取引先は出る");
  assert.equal(u.els["dlInv"].disabled, true, "単価なしは今までどおり止める");
  // 予定も含める
  const w = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "act"), rowOf("2026-10-04", NM.c1, NM.s1, 1, "plan")], { withPlan: true });
  assert.ok(textOf(w.els["bills"]).includes("6,000円")); assert.ok(w.els["outSummary"].textContent.startsWith("実績の1件と予定の1件を"));
  // 円に丸める(0.83時間 × 3,333円 = 2,766.39 → 2,766円)
  const r = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 0.83, "act")], { prices: { [NM.s1]: 3333, [NM.s2]: 5000 } });
  assert.ok(textOf(r.els["bills"]).includes("2,766円"));
});
test("カレンダー(新14): 開く・日のマスはボタン・空きはボタンでない・今日の印・日を選ぶと一覧・この日に追加で窓が閉じ日付が入る", () => {
  const app = lineApp([rowOf("2026-10-05", NM.c1, NM.s1, 2, "act", { start: "09:00", end: "11:00" }), rowOf("2026-10-21", NM.c2, NM.s2, 1, "plan"), rowOf("2026-10-21", NM.c1, NM.s1, 1.5, "act"), rowOf("2026-11-02", NM.c1, NM.s1, 1, "act")]);
  assert.equal($e(app, "dlgCal").open, false);
  app.fire("openCal", "click");
  assert.equal($e(app, "dlgCal").open, true); assert.equal($e(app, "calTitle").textContent, "2026年10月");
  let grid = () => app.els["calGrid"].children;
  assert.equal(grid().filter(c => c.className === "wk").length, 7); assert.deepEqual(grid().filter(c => c.className === "wk").map(c => c.textContent), ["日", "月", "火", "水", "木", "金", "土"]);
  const blanks = grid().filter(c => c.className === "c-blank");
  assert.equal(blanks.length, 4, "2026年10月は木曜から"); assert.ok(blanks.every(c => c.tagName === "div" && c._a["aria-hidden"] === "true"), "空きのマスは押せない");
  const days = () => grid().filter(c => c.tagName === "button");
  assert.equal(days().length, 31);
  assert.equal(days()[20]._a["aria-label"], `10月21日 2件 ${NM.c2}、${NM.c1}`); assert.equal(days()[0]._a["aria-label"], "10月1日 記録なし"); assert.equal(days()[4]._a["aria-label"], `10月5日 1件 ${NM.c1}`);
  assert.ok(String(days()[20].className).includes("c-today"), "今日の印"); assert.ok(!String(days()[0].className).includes("c-today"));
  assert.equal(days()[20]._a["aria-current"], "date");
  assert.equal(days()[20]._a["aria-pressed"], "true", "開いたときは今日を選んでいる"); assert.equal($e(app, "calSelTitle").textContent, "10月21日(水)");
  assert.ok(textOf(app.els["calSelList"]).includes(NM.c2) && textOf(app.els["calSelList"]).includes(NM.c1));
  // 札の形: 塗り=実績 / 点線=予定
  const chips = findAll(days()[20], c => String(c.className).startsWith("cchip"));
  assert.deepEqual(chips.map(c => String(c.className)), ["cchip cchip-plan", "cchip"], "予定は点線、実績は塗り");
  assert.ok(textOf(days()[4]).includes("作業サービス 2時間"));
  assert.ok(textOf(app.els["calLegend"]).includes(NM.c1) && textOf(app.els["calLegend"]).includes(NM.c2), "取引先の色の見本に名前が出る");
  // 日を選ぶ
  days()[4].onclick();
  assert.equal(days()[4]._a["aria-pressed"], "true"); assert.equal(days()[20]._a["aria-pressed"], "false");
  assert.equal($e(app, "calSelTitle").textContent, "10月5日(月)"); assert.ok(textOf(app.els["calSelList"]).includes(`${NM.s1} ・ 9:00〜11:00(2時間) ・ 実績`), textOf(app.els["calSelList"]));
  days()[0].onclick(); assert.equal(textOf(app.els["calSelList"]), "この日の記録はありません。");
  // この日に追加する(欄)
  days()[6].onclick(); app.fire("calAddDay", "click");
  assert.equal($e(app, "dlgCal").open, false); assert.equal($e(app, "date").value, "2026-10-07");
  // この日に追加する(1行)
  app.fire("modeLine", "click"); app.fire("openCal", "click"); days()[8].onclick(); app.fire("calAddDay", "click");
  assert.equal($e(app, "dlgCal").open, false); assert.equal($e(app, "q").value, "10/9 ");
  // 月の切りかえは、頭の月も動かす
  app.fire("openCal", "click"); app.fire("calNext", "click");
  assert.equal($e(app, "calTitle").textContent, "2026年11月"); assert.equal(app.els["month"].value, "2026-11"); assert.equal($e(app, "monthNum").textContent, "11");
  assert.equal(grid().filter(c => c.className === "c-blank").length, 0, "2026年11月は日曜から"); assert.equal(days().length, 30);
  assert.equal($e(app, "calSelTitle").textContent, "11月1日(日)", "今月でなければ1日を選ぶ");
  app.fire("calPrev", "click"); app.fire("calPrev", "click"); assert.equal($e(app, "calTitle").textContent, "2026年9月");
  app.fire("calClose", "click"); assert.equal($e(app, "dlgCal").open, false);
  // 背景を押したら閉じる(窓そのものが押されたとき)
  app.fire("openCal", "click"); app.els["dlgCal"].getBoundingClientRect = () => ({ left: 100, right: 500, top: 50, bottom: 400 });
  app.els["dlgCal"]._ev.click[0]({ target: app.els["dlgCal"], clientX: 300, clientY: 200 }); assert.equal($e(app, "dlgCal").open, true, "窓の内側の余白を押しても閉じない");
  app.els["dlgCal"]._ev.click[0]({ target: app.els["dlgCal"], clientX: 20, clientY: 200 }); assert.equal($e(app, "dlgCal").open, false, "窓の外(背景)を押すと閉じる");
  app.fire("openCal", "click"); app.els["dlgCal"]._ev.click[0]({ target: app.els["calGrid"] }); assert.equal($e(app, "dlgCal").open, true, "中身を押しても閉じない");
});
test("頭(新15): 年・月の数字、‹ › の文字、今月に戻る、実績と予定の合計", () => {
  const app = lineApp([rowOf("2026-10-02", NM.c1, NM.s1, 2, "act", { start: "09:00", end: "11:00" }), rowOf("2026-10-03", NM.c1, NM.s1, 3, "act"), rowOf("2026-10-07", NM.c2, NM.s2, 1, "act"), rowOf("2026-10-28", NM.c2, NM.s2, 1, "plan")]);
  assert.equal($e(app, "yearLabel").textContent, "2026年"); assert.equal($e(app, "monthNum").textContent, "10");
  assert.equal($e(app, "prevMonth").textContent, "‹ 9月"); assert.equal($e(app, "nextMonth").textContent, "11月 ›");
  assert.equal($e(app, "thisMonthBtn").hidden, true, "今月では隠れる");
  assert.equal($e(app, "sumAct").textContent, "5時間 + 1回"); assert.equal($e(app, "sumPlan").textContent, "1回");
  gotoMonth(app, "2026-11");
  assert.equal($e(app, "monthNum").textContent, "11"); assert.equal($e(app, "prevMonth").textContent, "‹ 10月"); assert.equal($e(app, "nextMonth").textContent, "12月 ›");
  assert.equal($e(app, "thisMonthBtn").hidden, false); assert.equal($e(app, "sumAct").textContent, "なし"); assert.equal($e(app, "sumPlan").textContent, "なし");
  app.fire("thisMonthBtn", "click"); assert.equal(app.els["month"].value, "2026-10"); assert.equal($e(app, "thisMonthBtn").hidden, true);
  gotoMonth(app, "2026-12"); assert.equal($e(app, "nextMonth").textContent, "1月 ›"); assert.equal($e(app, "yearLabel").textContent, "2026年");
  app.fire("nextMonth", "click"); assert.equal($e(app, "yearLabel").textContent, "2027年"); assert.equal($e(app, "monthNum").textContent, "1");
  assert.equal($e(app, "prevMonth").textContent, "‹ 12月");
  assert.equal(app.els["month"].value, "2027-01", "月の状態は #month の1つ");
  assert.match(html, /<span class="yr" id="yearLabel">/); assert.match(html, /<span class="mn" id="monthNum">/); assert.match(html, /<span class="sr">の記録<\/span>/);
  assert.match(html, /\.mn\{font-size:56px\}/); assert.match(html, /\.yr\{display:block;font-size:var\(--fs-h1\)/);
});
test("作り(新16): 別窓・読み上げの領域・練習作品の表示。主ボタンの数、色は class で決める", () => {
  assert.match(html, /<dialog id="dlgDel"/); assert.match(html, /<dialog id="dlgCal"/);
  assert.ok(!/id="qRead"[^>]*aria-live/.test(html), "札は読み上げ領域にしない(文の方だけ)"); assert.match(html, /id="fmsg"[^>]*aria-live="polite"/);
  assert.match(html, /<div class="editing" id="editing" role="status" hidden>/);
  assert.ok(html.includes("練習作品") && html.includes("練習として作った、特定の請求書ソフトとは無関係の非公式な補助ツールです。無保証です。"));
  assert.match(html, /<label for="q" class="sr">/); assert.match(html, /aria-describedby="fmsg"/); assert.match(html, /id="dlInv" aria-describedby="csvReason"/);
  assert.match(html, /<section id="sec-enter"[^>]*aria-labelledby="addTitle">/);
  assert.match(html, /<nav aria-label="メニュー" class="topnav">/);
  assert.match(html, /@media \(max-width:480px\)/);
  assert.match(html, /#dlgCal\{width:min\(1080px,96vw\)\}/); assert.match(html, /#dlgDel\{width:min\(480px,94vw\)\}/);
  assert.match(html, /\.toast :focus-visible\{outline-color:var\(--bg\)\}/);
  assert.ok(!/style\.setProperty|classList|document\.addEventListener|document\.activeElement/.test(SOURCE), "作り物の画面部品にない書き方は使わない");
  assert.ok(!/confirm\("この1行を削除/.test(SOURCE), "削除の確かめは別窓");
  for (const t of ["一括", "写す", "ダミー", "単位", "控え", "振込先"]) assert.ok(/confirm\(/.test(SOURCE), t);
  // 取引先の色は class。5つ目以降は c1 に戻る(名前の文字で見分けられる)
  const app = lineApp();
  app.run('cfg.clients["C社"]={code:"A010",hon:"御中",reg:false}; cfg.clients["D社"]={code:"A011",hon:"御中",reg:false}; cfg.clients["E社"]={code:"A012",hon:"御中",reg:false}; fixCfg(cfg)');
  assert.deepEqual(J(app, 'Object.keys(cfg.clients).map(colorCls)'), ["c1", "c2", "c3", "c4", "c1"]);
});
test("禁止の言葉(新18): index.html に、職業や相談した人が分かる言葉が無い", () => {
  const re = /\u85ac|\u51e6\u65b9|\u60a3\u8005|\u4ecb\u8b77|\u8a2a\u554f|\u770b\u8b77|\u533b\u7642|\u4ecb\u52a9/;
  assert.ok(!re.test(html), "index.html に禁止の言葉がある: " + (html.match(re) || [""])[0]);
  assert.ok(!re.test(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")));
});

test("色の差(新17): ライト・ダークとも、文字は4.5以上、枠や点は3.0以上(check-contrast.js と同じ計算)。端末ダークと強制ダークの値は同じ", () => {
  const blockOf = name => { const m = html.match(new RegExp("/\\*" + name + "-START\\*/([\\s\\S]*?)/\\*" + name + "-END\\*/")); assert.ok(m, name); const v = {}; for (const x of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) v[x[1]] = x[2].toUpperCase(); return v; };
  const light = blockOf("LIGHT"), dark = blockOf("DARK"), media = blockOf("DARK-MEDIA");
  assert.deepEqual(media, dark, "端末ダークと強制ダークで、同じ値");
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const T = 4.5, N = 3;
  const pairs = [
    ["text", "bg", T], ["text", "surface", T], ["text", "surface-2", T], ["text-sub", "bg", T], ["text-sub", "surface", T], ["text-sub", "surface-2", T],
    ["on-primary", "primary", T], ["on-primary", "primary-hover", T], ["on-primary", "primary-active", T], ["primary", "bg", T], ["primary", "surface", T],
    ["link-strong", "primary-soft", T], ["link-strong", "primary-soft-active", T], ["text", "primary-soft", T], ["text", "primary-soft-active", T],
    ["danger", "surface", T], ["danger", "danger-soft", T], ["danger", "danger-soft-active", T], ["danger", "bg", T], ["danger", "surface-2", T], ["text", "danger-soft", T],
    ["success", "success-soft", T], ["text", "success-soft", T], ["warning", "warning-soft", T], ["text", "warning-soft", T],
    ["border", "bg", N], ["border", "surface", N], ["border", "surface-2", N], ["focus", "bg", N], ["focus", "surface", N], ["focus", "surface-2", N], ["primary", "bg", N], ["primary", "surface", N], ["danger", "surface", N], ["success", "success-soft", N], ["warning", "warning-soft", N],
    // 新しい画面で足した組み合わせ
    ["text", "out", T], ["text-sub", "out", T], ["primary", "out", T], ["danger", "out", T], ["text-sub", "primary-soft", T], ["bg", "text", T], ["toast-btn", "text", T], ["toast-btn", "toast-hover", T], ["primary", "surface-2", T],
    ["out-line", "out", N], ["out-line", "bg", N], ["border", "primary-soft", N], ["primary", "primary-soft", N], ["danger", "danger-soft", N], ["focus", "out", N], ["focus", "primary-soft", N], ["bg", "text", N],
    ...["c1", "c2", "c3", "c4"].flatMap(c => ["surface", "surface-2", "primary-soft"].map(b => [c, b, N])),
  ];
  for (const [theme, v] of [["ライト", light], ["ダーク", dark]]) for (const [f, b, need] of pairs) {
    assert.ok(v[f] && v[b], theme + " に --" + f + " / --" + b + " がありません");
    const r = ratio(v[f], v[b]);
    assert.ok(r >= need, theme + ": " + f + " " + v[f] + " / " + b + " " + v[b] + " = " + r.toFixed(2) + " (必要 " + need + ")");
  }
});

// ================= 批判的レビューの指摘への直し(2026-10-21) =================
test("見直し1: 1行で直している途中に月を7か月以上動かしても、行の日付は別の年へ移らない(1行の文は年つき)", () => {
  const app = lineApp([rowOf("2026-01-10", NM.c1, NM.s1, 2, "act", { start: "09:00", end: "11:00" })], { month: "2026-01" });
  app.fire("modeLine", "click");
  app.run("startEdit(rows[0])");
  assert.equal($e(app, "q").value, `2026/1/10 ${NM.c1} ${NM.s1} 09:00-11:00 実績`);
  for (let i = 0; i < 8; i++) app.fire("nextMonth", "click");
  assert.equal(app.els["month"].value, "2026-09");
  assert.equal($e(app, "q").value, `2026/1/10 ${NM.c1} ${NM.s1} 09:00-11:00 実績`, "月を動かしても1行の中身は変わらない");
  assert.equal(app.run("editId"), app.run("rows[0].id"));
  const p = PL(app, "2026/1/10 A 作業 9-11", "2026-09"); assert.equal(p.v.date, "2026-01-10", "年つきはそのまま使う");
  app.fire("f", "submit");
  assert.equal(app.run("rows[0].date"), "2026-01-10", "直して保存しても、別の年へ移らない");
  assert.equal(app.run("rows.length"), 1);
});
test("見直し2: 新しい名前で追加して元に戻すと、取引先の設定も戻る(取引先CSVに出ない・コードの番号も戻る)", () => {
  if (DEMO) return; // デモ版は決まった名前しか入れられない
  const app = lineApp();
  const seq = app.run("cfg.codeSeq"), keys = J(app, "Object.keys(cfg.clients)");
  for (const [id, v] of [["date", "2026-10-21"], ["client", "新しい社"], ["service", NM.s1], ["hours", "1"], ["kind", "auto"]]) $e(app, id).value = v;
  app.fire("f", "submit");
  assert.ok(J(app, "Object.keys(cfg.clients)").includes("新しい社")); assert.ok(app.run("customerCsv()").includes("新しい社"));
  app.fire("undoBtn", "click");
  assert.equal(app.run("rows.length"), 0); assert.deepEqual(J(app, "Object.keys(cfg.clients)"), keys, "設定の取引先も戻る");
  assert.ok(!app.run("customerCsv()").includes("新しい社")); assert.equal(app.run("cfg.codeSeq"), seq, "コードの番号も戻る");
  assert.ok(!JSON.parse(app.storage[CK]).clients["新しい社"], "保存も戻る");
});
test("見直し3: ぴったり同じ名前(A社)が先に選ばれる。ダミーA社があっても本物のA社を選べる", () => {
  const app = lineApp();
  assert.deepEqual(J(app, 'matchNames(["A社","ダミーA社"],"A社")'), ["A社"]);
  assert.deepEqual(J(app, 'matchNames(["ダミーA社","A社"],"a社")'), ["A社"]);
  assert.deepEqual(J(app, 'matchNames(["ダミーA社"],"A社")'), ["ダミーA社"], "ほかに無ければ、ダミーを外して当てる");
  assert.deepEqual(J(app, 'matchNames(["ダミーA社","ダミーB社"],"A")'), ["ダミーA社"]);
});
test("見直し4: 月の欄を空にしても、前の月に戻る(頭とカードが食い違わない)", () => {
  const app = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "act")]);
  $e(app, "month").value = ""; app.fire("month", "change");
  assert.equal(app.els["month"].value, "2026-10"); assert.equal($e(app, "monthNum").textContent, "10");
  assert.equal(findAll(app.els["actList"], c => c.tagName === "article").length, 1);
  assert.equal(String(app.els["csvReason"].className) !== "reason-err", true);
});
test("見直し5: ほかの年に入る日付は、札と帯に年が出る", () => {
  const app = lineApp();
  const p = PL(app, `2027/3/5 ${SH.c1} ${SH.s1} 1h`); assert.ok(p.parts[0].t.startsWith("2027年3/5(金)"), p.parts[0].t);
  assert.ok(!PL(app, `10/5 ${SH.c1} ${SH.s1} 1h`).parts[0].t.includes("年"));
  app.fire("modeLine", "click"); $e(app, "q").value = `2027/3/5 ${SH.c1} ${SH.s1} 1h`; app.fire("f", "submit");
  assert.ok($e(app, "toastMsg").textContent.startsWith(`2027年3/5 ${NM.c1}`), $e(app, "toastMsg").textContent);
});
test("見直し6: 頭で月を動かすと、欄の日付も合う(今月なら今日、ほかの月ならその月の1日)。直している間は変えない", () => {
  const app = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "act")]);
  app.fire("nextMonth", "click"); assert.equal($e(app, "date").value, "2026-11-01");
  for (const [id, v] of [["client", NM.c1], ["service", NM.s1], ["hours", "1"], ["kind", "auto"]]) $e(app, id).value = v;
  app.fire("f", "submit"); assert.equal(app.run("rows[1].date"), "2026-11-01", "11月表示で追加すると11月に入る");
  app.fire("prevMonth", "click"); assert.equal($e(app, "date").value, "2026-10-21", "今月なら今日");
  $e(app, "month").value = "2027-02"; app.fire("month", "change"); assert.equal($e(app, "date").value, "2027-02-01");
  app.fire("thisMonthBtn", "click"); assert.equal($e(app, "date").value, "2026-10-21");
  app.run("startEdit(rows[0])"); const d0 = $e(app, "date").value;
  app.fire("nextMonth", "click"); assert.equal($e(app, "date").value, d0, "直している間は変えない");
});
test("見直し7: 直している途中は、カレンダーの「この日に追加する」を押せない。理由が出る", () => {
  const app = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "act")]);
  app.fire("openCal", "click");
  assert.equal($e(app, "calAddDay").disabled, false); assert.equal($e(app, "calAddReason").hidden, true);
  app.fire("calClose", "click");
  app.run("startEdit(rows[0])"); const d0 = $e(app, "date").value, q0 = $e(app, "q").value;
  app.fire("openCal", "click");
  assert.equal($e(app, "calAddDay").disabled, true); assert.equal($e(app, "calAddReason").hidden, false);
  assert.match(html, /直している途中です。保存するか、やめてから使えます/); assert.match(html, /id="calAddDay" aria-describedby="calAddReason"/);
  assert.equal($e(app, "date").value, d0); assert.equal($e(app, "q").value, q0);
  app.fire("calClose", "click"); app.fire("cancelEdit", "click");
  app.fire("openCal", "click"); assert.equal($e(app, "calAddDay").disabled, false, "やめたら使える");
});
test("見直し8: 削除の窓を閉じたあとのフォーカス(やめる→押した削除ボタン、削除→隣のカード、最後の1枚→列の見出し)", () => {
  const app = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "act"), rowOf("2026-10-04", NM.c1, NM.s1, 1, "act")]);
  const focused = [];
  const track = el => { el.focus = () => { focused.push(el); }; return el; };
  let dels = btnsOf(app, "actList", "削除"); dels.forEach(track);
  dels[0].onclick(); assert.equal($e(app, "dlgDel").open, true);
  app.fire("delCancel", "click"); assert.equal(focused.at(-1), dels[0], "やめたら、押した削除ボタンへ戻る");
  focused.length = 0;
  dels[0].onclick(); app.fire("delOk", "click");
  assert.equal(app.run("rows.length"), 1);
  const card = findAll(app.els["actList"], c => c.tagName === "article")[0];
  assert.equal(card.dataset.rid, String(app.run("rows[0].id")));
  assert.equal(focused.length, 0, "ここまでは、まだ描き直したカードに移っていない(作り物は focus を記録しない)");
  // 最後の1枚を消すと、列の見出しへ
  const heads = []; $e(app, "actH").focus = () => heads.push("h");
  btnsOf(app, "actList", "削除")[0].onclick(); app.fire("delOk", "click");
  assert.equal(app.run("rows.length"), 0); assert.deepEqual(heads, ["h"]);
  assert.match(html, /<h2 id="actH" tabindex="-1">/); assert.match(html, /<h2 id="planH" tabindex="-1">/);
  // Esc(close の出来事): 削除ボタンへ戻る
  const app2 = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "act")]);
  const d2 = track(btnsOf(app2, "actList", "削除")[0]); focused.length = 0;
  d2.onclick(); app2.els["dlgDel"]._ev.close[0](); assert.equal(focused.at(-1), d2);
  assert.equal(app2.run("rows.length"), 1);
});
test("見直し9: 元に戻せる間は、別のお知らせが出ても「元に戻す」を出し続ける", () => {
  const app = lineApp([rowOf("2026-10-03", NM.c1, NM.s1, 1, "plan")]);
  btnsOf(app, "planList", "実績にする")[0].onclick();
  assert.equal($e(app, "undoBtn").hidden, false);
  app.run('notify("別のお知らせ")');
  assert.equal($e(app, "toastMsg").textContent, "別のお知らせ"); assert.equal($e(app, "undoBtn").hidden, false, "undo が残っている間は出す");
  app.fire("undoBtn", "click"); assert.equal(app.run("rows[0].kind"), "plan"); assert.equal($e(app, "undoBtn").hidden, true);
});
test("見直し10: 空白のある名前(山田 太郎)も、続く言葉をつないで1行で読める", () => {
  if (DEMO) return;
  const app = lineApp([rowOf("2026-10-02", "山田 太郎", NM.s1, 1, "act")]);
  let p = PL(app, "10/21 山田 太郎 作業 1h"); assert.equal(p.ok, true, JSON.stringify(p.miss)); assert.equal(p.v.client, "山田 太郎");
  p = PL(app, "10/21 山田 作業 1h"); assert.equal(p.v.client, "山田 太郎");
  p = PL(app, "10/21 作業 山田 太郎 1h"); assert.equal(p.v.client, "山田 太郎"); assert.equal(p.v.service, NM.s1);
  p = PL(app, "10/21 山田 太郎 作業 9:00-11:00"); assert.deepEqual([p.v.client, p.v.hours], ["山田 太郎", 2]);
});
test("見直し11〜12: 行が0件の月は赤字にしない。押せないボタンには、理由が出る", () => {
  const app = lineApp([]);
  assert.equal($e(app, "csvReason").textContent, "記録を入れると、ここに請求書が出ます。"); assert.ok(String($e(app, "dlInv").className).includes("btn-secondary")); assert.equal($e(app, "dlInv").disabled, true);
  assert.equal($e(app, "copyPrev").disabled, true); assert.equal($e(app, "copyPrevWhy").hidden, false); assert.equal($e(app, "copyPrevWhy").textContent, "前の月に行がないので、写せません。");
  if (!DEMO) { const blank = makeApp({ now: NOW }); assert.equal($e(blank, "clearDummy").disabled, true); assert.equal($e(blank, "clearWhy").hidden, false); assert.equal($e(blank, "clearWhy").textContent, "消せるダミーがありません。"); assert.equal($e(app, "clearWhy").hidden, true, "ダミーがあれば理由は出ない"); }
  app.run("for (const n in cfg.clients) cfg.clients[n].reg = true; for (const n in cfg.priceHist) cfg.itemReg[n] = true; render()");
  assert.equal($e(app, "dlCus").disabled, true); assert.equal($e(app, "dlItem").disabled, true);
  assert.equal($e(app, "outBtnWhy").hidden, false);
  assert.ok($e(app, "outBtnWhy").textContent.includes("取引先CSV: 請求書ソフトに未登録の取引先がないので、保存できません。") && $e(app, "outBtnWhy").textContent.includes("品目CSV: 請求書ソフトに未登録の品目がないので、保存できません。"));
  for (const id of ["copyPrev", "clearDummy", "dlCus", "dlItem"]) assert.match(html, new RegExp('id="' + id + '"[^>]*aria-describedby="'));
  const ok = lineApp([rowOf("2026-09-03", NM.c1, NM.s1, 1, "act")]); assert.equal($e(ok, "copyPrevWhy").hidden, true); assert.equal($e(ok, "outBtnWhy").hidden, true);
});
test("見直し14〜16: 1行から欄へ読めた所だけ入れる。「10-21」と「22-24」には理由を添える", () => {
  const app = lineApp();
  app.fire("modeLine", "click"); $e(app, "q").value = `10/22 ${SH.c1} ${SH.s1} ほげ`; app.fire("modeForm", "click");
  assert.deepEqual(["date", "client", "service"].map(id => $e(app, id).value), ["2026-10-22", NM.c1, NM.s1], "読めた所だけでも欄に入る");
  app.fire("modeLine", "click"); $e(app, "q").value = `${SH.c1} ${SH.s1} 9:00-11:00 予定 ほげ`; app.fire("modeForm", "click");
  assert.deepEqual([$e(app, "tmStart").value, $e(app, "tmEnd").value, $e(app, "kind").value, $e(app, "date").value], ["09:00", "11:00", "plan", "2026-10-22"], "読めなかった日付は、今の欄のまま");
  const p = PL(app, `10-21 ${SH.c1} ${SH.s1} 2h`); assert.ok(p.parts.some(x => x.t === "日付は 10/21 と書きます" && x.cls === "chip-miss"), JSON.stringify(p.parts));
  assert.ok(!PL(app, `10/21 ${SH.c1} ${SH.s1} 10-12`).parts.some(x => x.t.includes("日付は 10/21")), "日付があれば添えない");
  const q = PL(app, `10/21 ${SH.c1} ${SH.s1} 22-24`); assert.equal(q.ok, false); assert.ok(q.parts.some(x => x.t === "「22-24」は読めません(24時は使えません(23:59 まで))"), JSON.stringify(q.parts));
});

// ================= デモ版は、CSVにダミーの中身しか出さない(2026-10-21、本人「CSVはダミーしか出力できないようにして」) =================
test("デモ版CSV(1): 設定の連絡先・コード・件名・振込先を直接書きかえても、CSVに出ない", () => {
  const app = makeApp();
  app.setup({ rows: demoRows().slice(0, 3), clients: { "A社": A }, prices: PRICES });
  app.run(`Object.assign(cfg.clients["A社"], {regNo:"T1234567890123",dept:"本物部署",person:"本物太郎",mail:"real@example.com",zip:"123-4567",addr:"本物の住所",bldg:"本物ビル",tel:"03-1111-2222",fax:"03-3333-4444",deptPrint:"する",personPrint:"する",code:"A999"}); cfg.subject="本物の件名"; cfg.bank="本物銀行 本店 普通 9999999"; render()`);
  const cus = app.run("customerCsv()"), inv = app.run("invoiceCsv()");
  for (const bad of ["T1234567890123", "本物", "real@example.com", "123-4567", "03-1111-2222", "03-3333-4444", "A999"]) { assert.ok(!cus.includes(bad), "取引先CSVに " + bad); assert.ok(!inv.includes(bad), "明細CSVに " + bad); }
  const row = parseCsvLine(cus.split("\r\n")[1]);
  assert.deepEqual(row, ["DEMO1", "A社", "御中", "外税(税別)", "切り捨て", "", "", "", "", "", "", "", "", ""], "取引先CSVは、名前とコード(DEMO1)と敬称だけ");
  const c = parseCsvLine(inv.split("\r\n")[1]);
  assert.equal(c[0], "202610-DEMO1"); assert.equal(c[3], "DEMO1"); assert.equal(c[6], "【デモ】2026年10月分 業務委託料"); assert.equal(c[7], BANK);
  assert.ok(app.els["out"].value.includes("振込先: " + BANK) && !app.els["out"].value.includes("本物銀行"), "プレビューも同じ");
  // 件名の欄は入力できず、打ち込んでも変わらない
  assert.equal(app.els["subject"].readOnly, true); assert.equal(app.els["subject"].value, "{y}年{m}月分 業務委託料");
  app.els["subject"].value = "本物の件名"; app.fire("subject", "input");
  assert.ok(!app.run("invoiceCsv()").includes("本物の件名"));
  assert.equal(app.els["bank"].readOnly, true);
}, { skip: !DEMO });
test("デモ版CSV(2): 決まった名前以外の行・取引先・品目を入れても、CSVに出ない", () => {
  const app = makeApp();
  app.setup({ rows: [...demoRows().slice(0, 3), R("2026-10-04", "秘密商事", "秘密サービス", 2), R("2026-10-05", "秘密商事", "作業サービス", 1), R("2026-10-06", "A社", "秘密サービス", 1)], clients: { "A社": A, "秘密商事": { code: "Z001", hon: "様", reg: false } }, prices: { ...PRICES, "秘密サービス": 777 } });
  const inv = app.run("invoiceCsv()"), cus = app.run("customerCsv()"), itm = app.run("itemCsv()");
  for (const bad of ["秘密", "Z001", "777"]) { assert.ok(!inv.includes(bad), "明細CSVに " + bad); assert.ok(!cus.includes(bad), "取引先CSVに " + bad); assert.ok(!itm.includes(bad), "品目CSVに " + bad); }
  assert.equal(inv.split("\r\n").length, 5, "見出し+A社の3行+末尾(決まった名前の行だけ)");
  assert.equal(parseCsvLine(inv.split("\r\n")[1])[9], "作業サービス");
  assert.equal(cus.split("\r\n").length, 3, "見出し+A社+末尾"); assert.ok(cus.includes("A社"));
  assert.deepEqual(itm.split("\r\n").slice(1, -1).map(l => l.split(",")[0]).sort(), ["作業サービス", "相談サービス"].filter(x => app.run("cfg.priceHist")[x] || true).filter(x => itm.includes(x)).sort());
  assert.ok(!app.els["out"].value.includes("秘密"), "プレビューにも出ない");
  assert.ok(!app.els["bills"].children.map(textOf).join("").includes("秘密"));
}, { skip: !DEMO });
test("デモ版CSV(3): 決まった名前以外の行・取引先・品目を含む控えは断られる。連絡先は取りこまない", async () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  const before = keep(app);
  const mk = (rowsX, cfgX) => JSON.stringify({ app: "seikyu-matome", version: 1, rows: rowsX, cfg: { clients: { "A社": A }, prices: PRICES, bank: "x", ...cfgX } });
  const row = (c, s) => ({ date: "2026-10-03", client: c, service: s, hours: 1, kind: "act" });
  for (const [label, text] of [["行の取引先", mk([row("秘密商事", "作業サービス")], {})], ["行のサービス", mk([row("A社", "秘密サービス")], {})], ["設定の取引先", mk([], { clients: { "A社": A, "秘密商事": A } })], ["設定の単価", mk([], { prices: { "秘密サービス": 5 } })]]) {
    await app.els["restore"].onchange({ target: { files: [{ text: async () => text }], value: "x" } });
    assert.equal(keep(app), before, label + " を含む控えは断られ、今の入力は変わらない");
    assert.ok(app.els["bmsg"].textContent.startsWith("戻せませんでした: ") && app.els["bmsg"].textContent.includes("デモ版では") && app.els["bmsg"].textContent.includes("今の入力は変わっていません"), label + ": " + app.els["bmsg"].textContent);
  }
  // 決まった名前なら戻せる。ただし連絡先・コード・件名は取りこまない
  const ok = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [row("A社", "作業サービス")], cfg: { clients: { "A社": { ...A, code: "A999", regNo: "T1234567890123", mail: "real@example.com", deptPrint: "する" } }, prices: PRICES, bank: "本物銀行", subject: "本物の件名" } });
  await app.els["restore"].onchange({ target: { files: [{ text: async () => ok }], value: "x" } });
  assert.equal(app.run("rows.length"), 1);
  assert.deepEqual(J(app, 'CFIELDS.map(k=>cfg.clients["A社"][k])'), ["", "", "", "", "", "", "", "", ""]);
  assert.ok(!("deptPrint" in J(app, 'cfg.clients["A社"]'))); assert.equal(app.run('cfg.clients["A社"].code'), "DEMO1");
  assert.equal(app.run("cfg.subject"), "{y}年{m}月分 業務委託料"); assert.equal(app.run("cfg.bank"), BANK);
  assert.ok(!app.run("customerCsv()").includes("real@example.com") && !app.run("invoiceCsv()").includes("本物"));
}, { skip: !DEMO });
test("デモ版CSV(4): 取引先の窓は連絡先とコードを入れられない。保存しても空のまま。画面に1行の案内が出る", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": A }, prices: PRICES });
  assert.equal(app.els["demoCsvNote"].hidden, false);
  assert.ok(html.includes("デモ版のCSVは、架空の取引先・架空の振込先だけで作ります。"));
  assert.ok(html.indexOf('id="demoCsvNote"') > html.indexOf('id="colOut"') && html.indexOf('id="demoCsvNote"') < html.indexOf('id="dlInv"'), "「3 書き出す」のそば");
  app.run('openClientDialog("A社")');
  assert.equal($e(app, "cdDemoNote").hidden, false); assert.equal($e(app, "cdCode").readOnly, true); assert.equal($e(app, "cdCode").value, "DEMO1");
  for (const id of ["cdRegNo", "cdDept", "cdPerson", "cdMail", "cdZip", "cdAddr", "cdBldg", "cdTel", "cdFax"]) assert.equal($e(app, id).disabled, true, id);
  assert.ok(html.includes("デモ版では、架空の取引先だけを扱うので、連絡先は入れられません。"));
  // 無理に値を入れて保存しても、空のまま・コードは DEMO1 のまま
  for (const [id, v] of [["cdRegNo", "T1234567890123"], ["cdMail", "real@example.com"], ["cdCode", "A999"], ["cdAddr", "本物の住所"]]) $e(app, id).value = v;
  app.fire("cdSave", "click");
  assert.equal(app.run('cfg.clients["A社"].regNo'), ""); assert.equal(app.run('cfg.clients["A社"].mail'), ""); assert.equal(app.run('cfg.clients["A社"].addr'), "");
  assert.equal(app.run('outCode("A社")'), "DEMO1");
  assert.ok(!app.run("customerCsv()").includes("real@example.com") && !app.run("customerCsv()").includes("A999"));
}, { skip: !DEMO });
test("デモ版CSV(5): 実用版には、デモ版の制限も案内も出ない(連絡先・コード・件名は今のまま)", () => {
  const app = makeApp();
  app.setup({ rows: octRows(), clients: { "A社": { ...A, regNo: "T1234567890123", mail: "a@example.com" } }, prices: PRICES, bank: GOOD_BANK });
  app.run('cfg.subject="{y}/{m} 件名"; render()');
  assert.equal(app.els["demoCsvNote"], undefined, "実用版は案内に触らない");
  const row = parseCsvLine(app.run("customerCsv()").split("\r\n")[1]);
  assert.equal(row[5], "T1234567890123"); assert.equal(row[0], "A001"); assert.equal(row[8], "a@example.com");
  assert.equal(csvCol(app, 1, 6), "2026/10 件名"); assert.equal(csvCol(app, 1, 7), GOOD_BANK);
  app.run('openClientDialog("A社")'); assert.equal($e(app, "cdCode").value, "A001"); assert.equal($e(app, "cdRegNo").value, "T1234567890123");
}, { skip: DEMO });


// ================= 2026-10-25: ふつうの言い方への作り直し(元の保存データの置き換え・数式になる字の注意) =================
test("古い保存データ: 前の言い方の値(敬称・消費税の表示・端数処理・税区分・源泉徴収)は、読むときに今の言い方へ置き換わる。書類に載せるかどうかの項目は捨てる", () => {
  const app = makeApp();
  app.storage[CK] = JSON.stringify({
    clients: { "A社": { code: "A001", hon: "\u656c\u79f0\u306a\u3057", reg: false, taxMode: "\u7a0e\u8fbc\u8868\u793a(\u514d\u7a0e)", round: "\u5207\u4e0a\u3052", deptPrint: "する", personPrint: "する" }, "B社": { code: "A002", hon: "様", reg: false, taxMode: "\u7a0e\u5225\u8868\u793a", round: "\u5207\u6368\u3066" } },
    prices: { "作業サービス": 3000, "相談サービス": 4000 }, bank: "b",
    itemTax: { "作業サービス": { kubun: "軽減8%", wh: "\u3042\u308a(\u5fa9\u8208\u7a0e 10.21%)" }, "相談サービス": { kubun: "", wh: "\u3042\u308a(10%)" } }
  });
  app.run("loadState()");
  const c = J(app, "cfg.clients");
  assert.deepEqual([c["A社"].hon, c["A社"].taxMode, c["A社"].round, c["B社"].hon, c["B社"].taxMode, c["B社"].round], ["なし", "内税(免税事業者)", "切り上げ", "様", "外税(税別)", "切り捨て"]);
  assert.ok(!("deptPrint" in c["A社"]) && !("personPrint" in c["A社"]), "部署・担当者を書類に載せるかどうかの項目は捨てる");
  assert.deepEqual(J(app, "cfg.itemTax"), { "作業サービス": { kubun: "8%(軽減)", wh: "10.21%" }, "相談サービス": { kubun: "", wh: "10%" } });
  // 控え(バックアップ)の古い値も同じ
  const t = JSON.stringify({ app: "seikyu-matome", version: 1, rows: [], cfg: { clients: { "A社": { code: "A001", hon: "\u656c\u79f0\u306a\u3057", taxMode: "\u7a0e\u8fbc\u8868\u793a", round: "\u5207\u4e0a\u3052", wh: "\u3042\u308a(10%)", deptPrint: "する" } }, prices: { "作業サービス": 1 }, itemTax: { "作業サービス": { kubun: "軽減8%", wh: "\u3042\u308a(10%)" } } } });
  const b = J(app, `parseBackup(${JSON.stringify(t)})`).cfg;
  assert.deepEqual([b.clients["A社"].hon, b.clients["A社"].taxMode, b.clients["A社"].round], ["なし", "内税(税込)", "切り上げ"]);
  assert.ok(!("deptPrint" in b.clients["A社"]));
  assert.deepEqual(b.itemTax["作業サービス"], { kubun: "8%(軽減)", wh: "10%" });
});
test("控え: 別のアプリのファイル・JSONでないファイルには「このアプリの控えではありません」とだけ出す", () => {
  const app = makeApp();
  for (const t of ["これは文です", JSON.stringify({ app: "other", version: 1, rows: [], cfg: {} })]) assert.throws(() => app.run(`parseBackup(${JSON.stringify(t)})`), /^Error: このアプリの控えではありません$/);
});
test("数式になる字: 取引先・サービス・件名が = + - @ で始まるときだけ、止めない注意が出る", () => {
  const app = makeApp();
  const ok = twoClients({}, {});
  assert.ok(!ok.run("problems()").some(x => x.includes("数式として動くことがあります")), "ふつうの名前では出ない");
  app.setup({ rows: [R("2026-10-03", "=危険社", "@作業", 1), R("2026-10-04", "B社", "作業サービス", 1)], clients: { "=危険社": A, "B社": B }, prices: { "@作業": 3000, "作業サービス": 3000 }, bank: GOOD_BANK });
  app.run('cfg.subject="-件名 {m}月"; render()');
  const w = app.run("problems()").find(x => x.includes("数式として動くことがあります"));
  assert.ok(w && w.startsWith("※ ") && w.includes("=危険社") && w.includes("@作業") && w.includes("件名") && !w.includes("B社"), String(w));
  assert.equal(app.els["dlInv"].disabled, false, "注意だけで、止めない");
  assert.equal(JSON.stringify(app.run("blocking(problems())")), "[]");
  assert.ok(html.includes("= + - @"), "画面の文にも書く");
}, { skip: DEMO });
test("明細CSV・取引先CSV: 列の名前と並びが決まったとおり。金額の列は目安の名前", () => {
  const app = makeApp();
  assert.deepEqual(J(app, "HDR_CUS"), ["取引先コード", "取引先", "敬称", "消費税の表示", "端数処理", "登録番号", "担当者", "部署", "メール", "TEL", "FAX", "郵便番号", "住所", "建物名"]);
  assert.ok(J(app, "HDR_LINES").includes("金額(単価×数量・目安)") && !J(app, "HDR_LINES").some(s => s.startsWith("小計")));
  assert.deepEqual(J(app, "TAX_OPT"), { mode: ["外税(税別)", "内税(税込)", "内税(免税事業者)"], round: ["切り捨て", "切り上げ", "四捨五入"], wh: ["なし", "10%", "10.21%"] });
  assert.deepEqual(J(app, "HONS"), ["御中", "様", "なし"]);
  assert.equal(app.run("DEMO_SUBJECT"), "{y}年{m}月分 業務委託料");
});
}

for (const [label, file] of BUILDS) defineSuite(label, file);
// ---- 公開用の docs/ の作り方(1回だけ) ----
if (!process.env.APP_HTML) {
  baseTest("公開用 docs/: デモ版の index.html と _headers だけ。DEMO の置き換えはちょうど1回で、index.html から作ったもの", () => {
    const { buildDemo } = require("../tools/build-demo.js");
    const root = path.join(__dirname, "..");
    const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.equal(idx.split("const DEMO=false;").length - 1, 1, "index.html に DEMO の宣言が1か所");
    const d = buildDemo(idx);
    assert.equal(d.split("const DEMO=true;").length - 1, 1); assert.ok(!d.includes("const DEMO=false;"));
    assert.equal(d.replace("const DEMO=true;", "const DEMO=false;"), idx, "違うのは DEMO の1か所だけ");
    assert.deepEqual(fs.readdirSync(path.join(root, "docs")).sort(), ["_headers", "index.html"], "docs/ には2つだけ");
    assert.equal(fs.readFileSync(path.join(root, "docs", "index.html"), "utf8"), d, "docs/index.html が古い: node tools/build-demo.js を実行");
    assert.equal(fs.readFileSync(path.join(root, "docs", "_headers"), "utf8"), fs.readFileSync(path.join(root, "_headers"), "utf8"), "_headers は直下のものと同じ");
    assert.ok(!fs.existsSync(path.join(root, "demo")), "古い demo/ は無い");
    assert.throws(() => buildDemo(idx.replace("const DEMO=false;", "")), /0か所/);
    assert.throws(() => buildDemo(idx + " const DEMO=false;"), /2か所/);
  });
}

// ---- 隠した部品が本当に隠れること(2026-10-19: label{display:flex} が hidden を打ち消し、回の品目でも時刻欄が見えていた) ----
baseTest("画面: hidden 属性の部品は、CSS でも必ず隠れる(label の display:flex に負けない)", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(/\[hidden\]\{display:none !important\}/.test(h), "[hidden]{display:none !important} がありません");
});

// ---- 入力チェックの吹き出しを使わず、画面の文で知らせる(2026-10-19: ブラウザの吹き出しが見切れて見えなかった) ----
baseTest("画面: 追加の入力チェックは、ブラウザの吹き出しではなく画面の文で出す(novalidate)", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(/<form id="f"[^>]*\bnovalidate\b/.test(h), "追加のフォームに novalidate がありません");
});

baseTest("画面: 読み込み中の問題を、赤い枠で知らせる仕組みがある(原因を伝えやすくするため)", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(h.includes('window.addEventListener("error"') && h.includes('d.id="fatal"'), "error を受ける処理がありません");
});

// ---- 公開物(index.html と *.md)の言葉の守り。語はそのまま書かず、Unicode エスケープで表す ----
// *.md は、公開用のフォルダー(README.md がある所)でだけ調べる。作業の元には公開用の文書が無いので飛ばす
function publicFiles() {
  const root = path.join(__dirname, "..");
  const list = ["index.html", "docs/index.html"];
  if (fs.existsSync(path.join(root, "README.md"))) {
    for (const f of ["README.md", "使い方とテスト手順.md", "AIへの頼み方.md"]) if (fs.existsSync(path.join(root, f))) list.push(f);
    const dir = path.join(root, "作り方一式");
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".md")) list.push("作り方一式/" + f);
  }
  return list.map(f => [f, fs.readFileSync(path.join(root, f), "utf8")]);
}
baseTest("名前: 公開する文書(README・使い方・AIへの頼み方・作り方一式)にも、特定の請求書ソフトの名前が無い", () => {
  const re = new RegExp("\u0049\u004e\u0056\u004f\u0059|\u30a4\u30f3\u30dc\u30a4|\u30a4\u30f3\u30f4\u30a9\u30a4", "i");
  for (const [f, s] of publicFiles()) assert.ok(!re.test(s), f);
});
baseTest("言い回し: 特定のソフトに固有の言い方・前の版の話・書かない言葉が、index.html と公開する文書に無い", () => {
  const bans = [
    ["語1", "\u5370\u5b57"], ["語2", "\u30d3\u30eb\u540d/"], ["語3", "\u5fa9\u8208\u7a0e"], ["語4", "[(\uff08]\u514d\u7a0e[)\uff09]"], ["語5", "\u304a\u652f\u6255\u3044\u671f\u9650"],
    ["語6", "\u7a0e\u5225\u8868\u793a"], ["語7", "\u7a0e\u8fbc\u8868\u793a"], ["語8", "\u5207\u6368\u3066"], ["語9", "\u5f15\u304d\u7d99\u3052\u307e\u305b\u3093"],
    ["語10", "\u85ac|\u51e6\u65b9|\u60a3\u8005|\u4ecb\u8b77|\u8a2a\u554f|\u770b\u8b77|\u533b\u7642|\u4ecb\u52a9"]
  ];
  for (const [f, s] of publicFiles()) for (const [name, src] of bans) assert.ok(!new RegExp(src).test(s), f + " に「" + name + "」");
  // 個人のパス
  for (const [f, s] of publicFiles()) assert.ok(!new RegExp("C" + ":\\\\Users|\\/Users\\/|Des" + "ktop").test(s), f + " に個人のパス");
});
baseTest("作り方一式の仕様書: CSVの1行目(明細・取引先・品目)が、index.html の見出しと1文字も違わない", () => {
  const root = path.join(__dirname, "..");
  const spec = path.join(root, "作り方一式", "仕様書.md");
  if (!fs.existsSync(spec)) return; // 作業の元には無い
  const idx = fs.readFileSync(path.join(root, "index.html"), "utf8"), md = fs.readFileSync(spec, "utf8");
  const pick = name => vm.runInNewContext("[" + new RegExp("const " + name + "=\\[([^\\]]*)\\]").exec(idx)[1] + "]");
  for (const n of ["HDR_LINES", "HDR_CUS", "HDR_ITEM"]) assert.ok(md.includes(pick(n).join(",")), n + " の1行目が仕様書に無い");
});
