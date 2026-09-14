/* ══════════════════════════════════════════════════════════════════════
   worker.js 고칠 곳 — 2026-09-15
   네이버가 finance.naver.com 구형 표를 걷어내고 stock.naver.com 새 화면으로
   옮기면서, HTML 표를 긁던 세 함수가 모두 빈 손으로 돌아오고 있었습니다.

   고치는 순서: 1 → 2 → 3 → 4
   ══════════════════════════════════════════════════════════════════════ */


/* ──────────────────────────────────────────────────────────────────────
   【 고치기 1 】 naverForeign 통째로 교체

   Cloudflare 편집기에서 Ctrl+F 로 아래 줄을 찾습니다.

       async function naverForeign(code, raw) {

   그 줄부터, 함수가 끝나는

       return { ok: true, code, seq, net, amt, ratio, days: last10, count: seq.filter(Boolean).length };
     }

   까지(닫는 중괄호 포함)를 지우고, 아래 ▼▼▼ 사이의 내용을 그 자리에 붙입니다.
   ────────────────────────────────────────────────────────────────────── */

// ▼▼▼ 여기서부터 ▼▼▼

// ══════════════════════════════════════
// 외국인·기관 일별 매매동향 (새 네이버 증권 JSON)
//  2026-09 네이버가 finance.naver.com/item/frgn.naver 표를 걷어내고
//  stock.naver.com 새 화면으로 옮겼다. 새 화면은 표를 HTML 로 주지 않고
//  아래 JSON 을 준다. 옛 표의 열이 그대로 대응된다.
//    bizdate=날짜 · closePrice=종가 · prevChangePrice=전일비 · tradeVolume=거래량
//    organPureBuyQuant=기관 순매매량 · foreignerPureBuyQuant=외국인 순매매량
//    frgnStock=외국인 보유주수 · frgnHoldRatio=외국인 보유율
//  주의 ① 최신 날짜가 먼저 온다 — 앱은 과거→최근 순서를 기대하므로 뒤집는다
//  주의 ② frgnHoldRatio 가 7.050000190734863 처럼 오므로 반올림한다
//  주의 ③ 순매수 '금액' 열은 새 API 에도 없다(옛 표에도 없었다) → 수량×종가
// ══════════════════════════════════════
const NV_TREND_URL = (code, idx, size) =>
  "https://stock.naver.com/api/domestic/detail/" + code +
  "/trend?tradeType=KRX&startIdx=" + idx + "&pageSize=" + size;

const NV_TREND_H = code => ({
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Referer": "https://stock.naver.com/domestic/stock/" + code + "/investmentinfo",
});

// 한 번 받아 배열로 돌려준다. 응답은 배열 그 자체지만 감싸 오는 경우도 대비
async function nvTrendFetch(code, idx, size) {
  const u = NV_TREND_URL(code, idx, size);
  try {
    const r = await fetch(u, { headers: NV_TREND_H(code), cf: { cacheTtl: 0 } });
    if (!r.ok) return { ok: false, status: r.status, url: u };
    const j = await r.json();
    const arr = Array.isArray(j) ? j
              : (j && Array.isArray(j.result)) ? j.result
              : (j && Array.isArray(j.items)) ? j.items : null;
    if (!arr) return { ok: false, status: 200, url: u, error: "shape" };
    return { ok: true, url: u, arr };
  } catch (e) { return { ok: false, status: 0, url: u, error: String(e).slice(0, 80) }; }
}

function nvTrendRow(o) {
  if (!o || typeof o !== "object") return null;
  const nf = v => { const n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? n : null; };
  const bd = String(o.bizdate || "").replace(/[^0-9]/g, "");
  if (bd.length !== 8) return null;
  const date = bd.slice(0, 4) + "-" + bd.slice(4, 6) + "-" + bd.slice(6, 8);
  const qty = nf(o.foreignerPureBuyQuant) || 0;      // 음수면 순매도
  const close = nf(o.closePrice) || 0;
  const inst = nf(o.organPureBuyQuant) || 0;
  const hold = nf(o.frgnStock) || 0;
  const rr = nf(o.frgnHoldRatio);
  const ratio = rr == null ? 0 : Math.round(rr * 100) / 100;
  return { date, buy: qty > 0, qty, close, amt: qty * close, ratio, inst, hold };
}

// 최근 10거래일 — 포트 표의 외국인 막대·지분율·연속 순매수일
async function naverForeign(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  const got = await nvTrendFetch(code, 0, 10);
  if (!got.ok) return { ok: false, code, error: "naver " + got.status };
  if (raw) return { ok: true, code, url: got.url, sample: (got.arr || []).slice(0, 3) };
  const rows = (got.arr || []).map(nvTrendRow).filter(Boolean);
  // 빈 응답을 ok 로 돌려주면 '자료 없음'이 캐시에 굳는다 → 실패로 알린다
  if (!rows.length) return { ok: false, code, error: "no rows" };
  const last10 = rows.slice(0, 10).reverse();        // 최신순 → 과거순
  return {
    ok: true, code,
    seq: last10.map(d => d.buy),
    net: last10.map(d => d.qty),
    amt: last10.map(d => d.amt),
    ratio: last10.map(d => d.ratio),
    days: last10,
    count: last10.filter(d => d.buy).length,
  };
}

// ══════════════════════════════════════
// 증시자금동향 새 주소 찾기 (?depprobe=1)
//  옛 sise_deposit.naver 가 stock.naver.com/market/stock/kr/deposit 으로
//  바뀌었는데 표를 채우는 API 주소를 아직 모른다. 라우트 청크에서 /api/
//  문자열을 훑고, 이름 규칙으로 짐작한 후보도 직접 불러 상태를 함께 본다.
// ══════════════════════════════════════
async function depProbe() {
  const CDN = "https://ssl.pstatic.net/imgstock/fn/real/pc";
  const pageUrl = "https://stock.naver.com/market/stock/kr/deposit";
  const out = { pageUrl };
  let html = "";
  try {
    const r = await fetch(pageUrl, {
      headers: { "User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "ko-KR,ko;q=0.9", "Referer": "https://stock.naver.com/" },
      cf: { cacheTtl: 0 }
    });
    out.pageStatus = r.status;
    html = await r.text();
  } catch (e) { out.pageError = String(e).slice(0, 100); }

  // ① 스크립트 청크에서 주소 문자열 찾기
  const srcs = [...new Set((html.match(/<script[^>]+src="([^"]+)"/g) || [])
    .map(t => (t.match(/src="([^"]+)"/) || [])[1]).filter(Boolean))];
  const abs = u => u.startsWith("http") ? u
                 : (u.startsWith("/_next") ? CDN + u : CDN + "/" + u.replace(/^\//, ""));
  const rank = u => /deposit/.test(u) ? 0 : (/app\//.test(u) ? 1 : 2);
  const ordered = srcs.slice().sort((a, b) => rank(a) - rank(b));
  out.chunks = [];
  for (const u of ordered.slice(0, 12)) {
    try {
      const r = await fetch(abs(u), { headers: { "User-Agent": UA, "Referer": pageUrl } });
      if (!r.ok) { out.chunks.push({ src: u.slice(-48), status: r.status }); continue; }
      const t = await r.text();
      const hits = new Set();
      let m;
      const re1 = /["'`](\/api\/[^"'`\s\\]{2,120})["'`]/g;
      while ((m = re1.exec(t)) !== null) hits.add(m[1]);
      const re2 = /["'`]([^"'`\s\\]{0,50}(?:deposit|credit|fundTrend|balance)[^"'`\s\\]{0,80})["'`]/gi;
      while ((m = re2.exec(t)) !== null) hits.add(m[1]);
      if (hits.size) out.chunks.push({ src: u.slice(-48), len: t.length, hits: [...hits].slice(0, 30) });
    } catch (e) { out.chunks.push({ src: u.slice(-48), error: String(e).slice(0, 60) }); }
    await usSleep(80);
  }

  // ② 이름 규칙으로 짐작한 후보 직접 호출
  const AH = { "User-Agent": UA, "Accept": "application/json, text/plain, */*",
               "Accept-Language": "ko-KR,ko;q=0.9", "Referer": pageUrl };
  const B = "https://stock.naver.com/api/domestic/market/";
  const cands = [
    B + "deposit?startIdx=0&pageSize=10",
    B + "deposit",
    B + "trend/deposit?startIdx=0&pageSize=10",
    B + "stock/kr/deposit",
    B + "depositTrend?startIdx=0&pageSize=10",
    B + "fundTrend?startIdx=0&pageSize=10",
  ];
  out.api = [];
  for (const u of cands) {
    try {
      const r = await fetch(u, { headers: AH, cf: { cacheTtl: 0 } });
      const t = await r.text();
      out.api.push({ u: u.replace("https://stock.naver.com", ""), status: r.status, body: t.slice(0, 300) });
    } catch (e) { out.api.push({ u: u.replace("https://stock.naver.com", ""), error: String(e).slice(0, 80) }); }
    await usSleep(100);
  }
  return { ok: true, out };
}

// ▲▲▲ 여기까지 ▲▲▲


/* ──────────────────────────────────────────────────────────────────────
   【 고치기 2 】 naverForeignDaily 통째로 교체

   Ctrl+F 로 아래 줄을 찾습니다.

       async function naverForeignDaily(code, days, raw) {

   그 줄부터, 함수 끝인

       return { ok: true, code, data: arr.map(([date, v]) => ({ date, net: v.net, amt: v.amt, inst: v.inst || 0, hold: v.hold || 0, ratio: v.ratio || 0 })) };
     }

   까지를 지우고 아래 ▼▼▼ 사이의 내용을 붙입니다.
   ────────────────────────────────────────────────────────────────────── */

// ▼▼▼ 여기서부터 ▼▼▼

// 긴 기간 (차트 외국인 보조지표용)
async function naverForeignDaily(code, days, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  days = Math.max(20, Math.min(days || 120, 500));
  const PAGE = 100;
  const seen = new Set();
  const rows = [];
  let idx = 0;
  for (let guard = 0; guard < 12 && rows.length < days; guard++) {
    const got = await nvTrendFetch(code, idx, PAGE);
    if (!got.ok || !got.arr.length) break;
    let added = 0;
    for (const o of got.arr) {
      const v = nvTrendRow(o);
      if (!v || seen.has(v.date)) continue;
      seen.add(v.date); rows.push(v); added++;
    }
    idx += got.arr.length;      // 서버가 pageSize 를 줄여 줄 수 있어 실제 개수로 넘긴다
    if (!added || got.arr.length < 2) break;
    await usSleep(120);
  }
  if (!rows.length) return { ok: false, code, error: "no rows" };
  rows.sort((a, b) => a.date < b.date ? -1 : 1);     // 과거 → 최근
  const arr = rows.slice(-days);
  if (raw) return { ok: true, code, count: arr.length, sample: arr.slice(-3) };
  return {
    ok: true, code,
    data: arr.map(v => ({ date: v.date, net: v.qty, amt: v.amt, inst: v.inst, hold: v.hold, ratio: v.ratio })),
  };
}

// ▲▲▲ 여기까지 ▲▲▲


/* ──────────────────────────────────────────────────────────────────────
   【 고치기 3 】 KV 캐시 이름 올리기 — 네 군데

   지금 캐시에는 '자료 없음'이 굳어 있습니다. 이름을 바꾸지 않으면 코드를
   고쳐도 최대 6시간 동안 옛 빈 자료가 그대로 나옵니다.
   Ctrl+F 로 찾아 숫자 2 를 붙이기만 하면 됩니다.

       "frgn:" + cd          →   "frgn2:" + cd          (2군데)
       "frgnD:" + frgnDaily  →   "frgnD2:" + frgnDaily  (2군데)

   찾기 쉽게 원문을 적어둡니다.

     const cached = await kvGet(env, "frgn:" + cd);
     if (fresh && fresh.ok) await kvSet(env, "frgn:" + cd, fresh);
     const cached = await kvGet(env, "frgnD:" + frgnDaily);
     if (!raw && result && result.ok) await kvSet(env, "frgnD:" + frgnDaily, result);
   ────────────────────────────────────────────────────────────────────── */


/* ──────────────────────────────────────────────────────────────────────
   【 고치기 4 】 진단 경로 한 줄 추가

   Ctrl+F 로 아래 두 줄을 찾습니다.

       const frgnCode = url.searchParams.get("frgnprobe");
       if (frgnCode) return json(await frgnProbe(frgnCode), 200);

   그 바로 아래에 이 두 줄을 끼워 넣습니다.
   ────────────────────────────────────────────────────────────────────── */

// ▼▼▼ 여기서부터 ▼▼▼

    // 증시자금동향 새 주소 찾기
    if (url.searchParams.get("depprobe")) return json(await depProbe(), 200);

// ▲▲▲ 여기까지 ▲▲▲
