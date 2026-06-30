/**
 * 리서치보드 시세 중계 서버 (Cloudflare Workers) — 야후 파이낸스 버전
 * ---------------------------------------------------------------
 * 야후 파이낸스에서 지수/원자재/환율 시세를 읽어와
 * 앱(브라우저)에 CORS 허용 헤더와 함께 JSON으로 돌려줍니다.
 *
 * 배포 후 사용 예:
 *   https://내주소.workers.dev/?symbol=^KS11       (코스피)
 *   https://내주소.workers.dev/?symbol=^KQ11       (코스닥)
 *   https://내주소.workers.dev/?symbol=^GSPC       (S&P500)
 *   https://내주소.workers.dev/?symbol=GC=F        (금)
 *
 * 여러 개 한 번에:
 *   https://내주소.workers.dev/?symbols=^KS11,^KQ11,^GSPC
 *
 * 응답 예(단일):
 *   {"ok":true,"symbol":"^KS11","name":"KOSPI","price":8801.49,
 *    "change":13.11,"rate":0.15}
 * 응답 예(복수): {"ok":true,"items":[ {...}, {...} ]}
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    // 공유 자료 저장/불러오기 (Cloudflare KV)
    const dataKey = url.searchParams.get("data");
    if (dataKey) return await handleData(request, env, dataKey);
    // 기업명/코드 검색 → 종목코드 (네이버 자동완성)
    const find = url.searchParams.get("find");
    if (find) return json(await naverFind(find), 200);
    // 목표주가(컨센서스) 조회 - 단일(디버그 raw 지원) / 배치
    const tgt = url.searchParams.get("target");
    if (tgt) return json(await naverTarget(tgt, url.searchParams.get("raw")), 200);
    const tgts = url.searchParams.get("targets");
    if (tgts) {
      const codes = tgts.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 40);
      const items = await Promise.all(codes.map(c => naverTarget(c)));
      return json({ ok: true, items }, 200);
    }
    // 코스피 시총상위 N개 종목코드(투자종목 스크리너)
    const kospiN = url.searchParams.get("kospi");
    if (kospiN) return json(await marketCapTop("KOSPI", parseInt(kospiN) || 100, url.searchParams.get("raw")), 200);
    const roe1 = url.searchParams.get("roe");
    if (roe1) return json(await naverRoe(roe1, url.searchParams.get("raw")), 200);
    const roesP = url.searchParams.get("roes");
    if (roesP) {
      const codes = roesP.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 40);
      const items = await Promise.all(codes.map(c => naverRoe(c)));
      return json({ ok: true, items }, 200);
    }
    // 외국인 순매매(최근 5거래일) - 종목분석 리포트 라우트 옆
    const frgn1 = url.searchParams.get("frgn");
    if (frgn1) return json(await naverForeign(frgn1, url.searchParams.get("raw")), 200);
    const frgnsP = url.searchParams.get("frgns");
    if (frgnsP) {
      const codes = frgnsP.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 30);
      const items = await Promise.all(codes.map(c => naverForeign(c)));
      return json({ ok: true, items }, 200);
    }
    // 종목분석 리포트(네이버) - 최근 1건
    const rep1 = url.searchParams.get("report");
    if (rep1) return json(await naverReport(rep1, url.searchParams.get("raw")), 200);
    const repsP = url.searchParams.get("reports");
    if (repsP) {
      const codes = repsP.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 30);
      const items = await Promise.all(codes.map(c => naverReport(c)));
      return json({ ok: true, items }, 200);
    }
    // 미국 목표주가(네이버 월드스톡 컨센서스)
    const ustgt = url.searchParams.get("ustarget");
    if (ustgt) return json(await usTarget(ustgt, url.searchParams.get("raw")), 200);
    const ustgts = url.searchParams.get("ustargets");
    if (ustgts) {
      const syms = ustgts.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
      const items = await Promise.all(syms.map(s => usTarget(s)));
      return json({ ok: true, items }, 200);
    }
    // 티커 → 네이버 월드스톡 페이지 주소 변환 (예: QQQ → worldstock/etf/QQQ.O/total)
    const nvlink = url.searchParams.get("nvlink");
    if (nvlink) return json(await naverWorldUrl(nvlink, url.searchParams.get("raw")), 200);
    const multi = url.searchParams.get("symbols");
    if (multi) {
      const syms = multi.split(",").map(s => s.trim()).filter(Boolean);
      // 종목을 병렬로 동시 조회 (순차 대비 훨씬 빠름 — 주식 탭처럼 종목이 많을 때 효과적)
      const items = await Promise.all(syms.map(sym => one(sym)));
      return json({ ok: true, items }, 200);
    }
    const symbol = url.searchParams.get("symbol") || "^KS11";
    if (url.searchParams.get("raw")) {
      const NVraw = { "KFUT": "FUT", "^KS11": "KOSPI", "^KQ11": "KOSDAQ", "^KS200": "KPI200" };
      if (NVraw[symbol]) return json(await naverFut(NVraw[symbol], symbol, true), 200);
    }
    const hist = url.searchParams.get("history");
    if (hist) return json(await history(symbol, url.searchParams.get("range") || "3mo"), 200);
    return json(await one(symbol), 200);
  },
};

async function history(symbol, range) {
  if (symbol === "FNG") return { ok: false, symbol, error: "no history" };
  const api = "https://query1.finance.yahoo.com/v8/finance/chart/" +
              encodeURIComponent(symbol) + "?interval=1d&range=" + encodeURIComponent(range);
  try {
    const res = await fetch(api, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: 300 },
    });
    if (!res.ok) return { ok: false, symbol, error: "yahoo " + res.status };
    const d = await res.json();
    const r = d?.chart?.result?.[0];
    const closes = r?.indicators?.quote?.[0]?.close;
    const ts = r?.timestamp;
    if (!closes || !ts) return { ok: false, symbol, error: "no data" };
    const pts = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null) pts.push({ t: ts[i], c: round(closes[i], 2) });
    }
    // 카드(현재가)와 차트 끝점을 일치시킴: 마지막 점을 실시간 현재가로 보정
    const cur = r?.meta?.regularMarketPrice;
    if (cur != null && pts.length) pts[pts.length - 1].c = round(cur, 2);
    return { ok: true, symbol, name: r?.meta?.shortName || symbol, points: pts };
  } catch (e) {
    return { ok: false, symbol, error: String(e) };
  }
}

async function one(symbol) {
  // 특수 심볼: CNN Fear & Greed 지수
  if (symbol === "FNG") return await fearGreed();
  // 네이버에서 가져오는 한국 지수 (카드값을 네이버 실시간과 일치)
  const NV = { "KFUT": "FUT", "^KS11": "KOSPI", "^KQ11": "KOSDAQ", "^KS200": "KPI200" };
  if (NV[symbol]) return await naverFut(NV[symbol], symbol);
  // 네이버 개별 종목 시세: STK:종목코드 (아카이브 현재가용)
  if (symbol.startsWith("STK:")) return await naverStock(symbol.slice(4));
  // 미국채 2년물: 야후 수익률 선물(2YY=F) 우선, 실패 시 네이버 채권으로 폴백
  if (symbol === "UST2Y") {
    const y = await yahoo("2YY=F", "UST2Y");
    if (y.ok && y.price != null) return y;
    return await naverBond("US2YT=RR", "UST2Y");
  }
  // 달러인덱스: 야후(DX-Y.NYB) 우선, 실패 시 네이버 환율로 폴백
  if (symbol === "DX-Y.NYB") {
    const y = await yahoo("DX-Y.NYB", "DX-Y.NYB");
    if (y.ok && y.price != null) return y;
    return await naverFx(".DXY", "DX-Y.NYB");
  }

  return await yahoo(symbol, symbol);
}

// 야후 차트 API에서 현재가를 가져옴 (ticker=야후심볼, symbol=응답에 표기할 심볼)
async function yahoo(ticker, symbol) {
  const api = "https://query1.finance.yahoo.com/v8/finance/chart/" +
              encodeURIComponent(ticker) + "?interval=1d&range=1d";
  try {
    const res = await fetch(api, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: 5 },
    });
    if (!res.ok) return { ok: false, symbol, error: "yahoo " + res.status };
    const d = await res.json();
    const m = d?.chart?.result?.[0]?.meta;
    if (!m || m.regularMarketPrice == null) return { ok: false, symbol, error: "no price" };
    const price = m.regularMarketPrice;
    const prev = m.chartPreviousClose ?? m.previousClose ?? price;
    const change = price - prev;
    const rate = prev ? (change / prev * 100) : 0;
    return {
      ok: true,
      symbol,
      name: m.shortName || m.symbol || symbol,
      price,
      change: round(change, 2),
      rate: round(rate, 2),
      currency: m.currency || "",
      high52: m.fiftyTwoWeekHigh ?? null,
    };
  } catch (e) {
    return { ok: false, symbol, error: String(e) };
  }
}

async function fearGreed() {
  const url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: 300 },
    });
    if (!res.ok) return { ok: false, symbol: "FNG", error: "cnn " + res.status };
    const d = await res.json();
    const fg = d?.fear_and_greed;
    if (!fg || fg.score == null) return { ok: false, symbol: "FNG", error: "no score" };
    const score = Math.round(fg.score);
    const prev = fg.previous_close != null ? fg.previous_close : score;
    const change = score - prev;
    const rate = prev ? (change / prev * 100) : 0;
    return {
      ok: true,
      symbol: "FNG",
      name: "Fear & Greed (" + (fg.rating || "") + ")",
      price: score,
      change: round(change, 2),
      rate: round(rate, 2),
      currency: "",
    };
  } catch (e) {
    return { ok: false, symbol: "FNG", error: String(e) };
  }
}

async function naverFx(code, symbol) {
  const urls = [
    "https://m.stock.naver.com/api/marketindex/exchange/" + code + "/basic",
    "https://m.stock.naver.com/api/marketindex/exchange/" + code,
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: {
          "User-Agent": UA, "Accept": "application/json",
          "Referer": "https://m.stock.naver.com/marketindex/exchange/" + code,
        },
        cf: { cacheTtl: 30 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.price ?? d.value;
      const changeRaw = d.compareToPreviousClosePrice ?? d.changeVal ?? d.change;
      const price = num(priceRaw);
      const change = num(changeRaw);
      let rate = num(d.fluctuationsRatio ?? d.changeRate ?? d.rate);
      if (price == null) continue;
      const prev = price - (change ?? 0);
      if (rate == null) rate = prev ? ((change ?? 0) / prev * 100) : 0;
      return {
        ok: true, symbol, name: d.stockName || d.indexName || symbol,
        price: round(price, 2), change: round(change ?? 0, 2), rate: round(rate, 2),
        priceStr: priceRaw != null ? String(priceRaw) : null,
        changeStr: changeRaw != null ? String(changeRaw).replace(/^[-+]/, "") : null,
        currency: "",
      };
    } catch (e) { /* 다음 후보 */ }
  }
  return { ok: false, symbol, error: "fx fail" };
}

async function naverBond(code, symbol) {
  const urls = [
    "https://m.stock.naver.com/api/marketindex/bond/" + code + "/basic",
    "https://m.stock.naver.com/api/marketindex/bond/" + code,
    "https://api.stock.naver.com/marketindex/bond/" + code + "/basic",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: {
          "User-Agent": UA, "Accept": "application/json",
          "Referer": "https://m.stock.naver.com/marketindex/bond/" + code,
        },
        cf: { cacheTtl: 30 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.price ?? d.value;
      const changeRaw = d.compareToPreviousClosePrice ?? d.changeVal ?? d.change;
      const price = num(priceRaw);
      const change = num(changeRaw);
      let rate = num(d.fluctuationsRatio ?? d.changeRate ?? d.rate);
      if (price == null) continue;
      const prev = price - (change ?? 0);
      if (rate == null) rate = prev ? ((change ?? 0) / prev * 100) : 0;
      return {
        ok: true, symbol, name: d.stockName || d.indexName || symbol,
        price: round(price, 2), change: round(change ?? 0, 2), rate: round(rate, 2),
        priceStr: priceRaw != null ? String(priceRaw) : null,
        changeStr: changeRaw != null ? String(changeRaw).replace(/^[-+]/, "") : null,
        currency: "",
      };
    } catch (e) { /* 다음 후보 */ }
  }
  return { ok: false, symbol, error: "bond fail" };
}

async function naverStock(code) {
  const u = "https://m.stock.naver.com/api/stock/" + code + "/basic";
  try {
    const res = await fetch(u, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total",
      },
      cf: { cacheTtl: 30 },
    });
    if (!res.ok) return { ok: false, symbol: "STK:" + code, error: "naver " + res.status };
    const d = await res.json();
    const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.tradePrice;
    const price = num(priceRaw);
    if (price == null) return { ok: false, symbol: "STK:" + code, error: "no price" };
    // 전일대비 등락률: fluctuationsRatio(부호 없을 수 있음) + 방향코드로 보정
    let rate = num(d.fluctuationsRatio ?? d.changeRate ?? d.rate);
    const cp = d.compareToPreviousPrice || {};
    const dir = String(cp.code || "") + "|" + String(cp.name || "");
    if (rate != null) {
      rate = Math.abs(rate);
      if (/[45]/.test(String(cp.code || "")) || /FALL|LOWER|DOWN/i.test(dir)) rate = -rate;
    }
    return {
      ok: true,
      symbol: "STK:" + code,
      name: d.stockName || code,
      price: round(price, 2),
      priceStr: priceRaw != null ? String(priceRaw) : null,
      rate: rate != null ? round(rate, 2) : null,
      currency: "KRW",
    };
  } catch (e) {
    return { ok: false, symbol: "STK:" + code, error: String(e) };
  }
}

async function naverTarget(code, raw) {
  const u = "https://m.stock.naver.com/api/stock/" + code + "/integration";
  try {
    const res = await fetch(u, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total",
      },
      cf: { cacheTtl: 300 },
    });
    if (!res.ok) return { ok: false, symbol: "STK:" + code, error: "naver " + res.status };
    const d = await res.json();
    if (raw) return { ok: true, raw: d };
    // 목표주가를 다양한 형태에서 탐색 (한글 라벨 '목표주가' / 영문 target price 키)
    let tp = null;
    const grab = (v) => { const n = num(String(v).replace(/[^0-9.]/g, "")); return (n != null && n > 0) ? n : null; };
    const scan = (o) => {
      if (tp != null || o == null) return;
      if (Array.isArray(o)) { for (const x of o) scan(x); return; }
      if (typeof o === "object") {
        const label = String(o.key || o.title || o.name || o.itemName || o.krName || "");
        if (label.indexOf("목표주가") >= 0) { const g = grab(o.value ?? o.val ?? o.data ?? o.price); if (g != null) { tp = g; return; } }
        for (const k of Object.keys(o)) {
          if (/target.*price|priceTarget|goalPrice/i.test(k)) { const g = grab(o[k]); if (g != null) { tp = g; return; } }
        }
        for (const k of Object.keys(o)) scan(o[k]);
      }
    };
    scan(d);
    // 52주 최고가 탐색 (한글 라벨 '52주최고' / 영문 high52 키)
    let hi = null;
    const scanHi = (o) => {
      if (hi != null || o == null) return;
      if (Array.isArray(o)) { for (const x of o) scanHi(x); return; }
      if (typeof o === "object") {
        const label = String(o.key || o.title || o.name || o.itemName || o.krName || "").replace(/\s/g, "");
        if (label.indexOf("52주최고") >= 0 || label.indexOf("최고52") >= 0) { const g = grab(o.value ?? o.val ?? o.data ?? o.price); if (g != null) { hi = g; return; } }
        for (const k of Object.keys(o)) {
          if (/(52.*high|high.*52|highPriceOf52|week52High|fiftyTwoWeekHigh)/i.test(k)) { const g = grab(o[k]); if (g != null) { hi = g; return; } }
        }
        for (const k of Object.keys(o)) scanHi(o[k]);
      }
    };
    scanHi(d);
    return { ok: true, symbol: "STK:" + code, target: tp, targetStr: tp != null ? String(tp) : null, high52: hi, high52Str: hi != null ? String(hi) : null };
  } catch (e) {
    return { ok: false, symbol: "STK:" + code, error: String(e) };
  }
}

async function naverFut(code, symbol, raw) {
  const urls = [
    "https://m.stock.naver.com/api/index/" + code + "/basic",
    "https://m.stock.naver.com/api/index/" + code + "/integration",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
          "Referer": "https://m.stock.naver.com/domestic/index/" + code + "/total",
        },
        cf: { cacheTtl: 10 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (raw) return { ok: true, source: u, data: d };  // 디버그: 원본 그대로
      const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.tradePrice ?? d.price;
      const changeRaw = d.compareToPreviousClosePrice ?? d.changeVal ?? d.change;
      const price = num(priceRaw);
      const change = num(changeRaw);
      let rate = num(d.fluctuationsRatio ?? d.changeRate ?? d.rate);
      if (price == null) continue;
      const prev = price - (change ?? 0);
      if (rate == null) rate = prev ? ((change ?? 0) / prev * 100) : 0;
      return {
        ok: true,
        symbol: symbol,
        name: d.stockName || d.indexName || symbol,
        price: round(price, 2),
        change: round(change ?? 0, 2),
        rate: round(rate, 2),
        priceStr: priceRaw != null ? String(priceRaw) : null,   // 원본 자릿수 유지
        changeStr: changeRaw != null ? String(changeRaw).replace(/^[-+]/, "") : null,
        currency: "",
      };
    } catch (e) { /* 다음 후보 시도 */ }
  }
  return { ok: false, symbol: symbol, error: "naver fail" };
}
// 티커로 네이버 검색 → 미국 월드스톡 페이지 주소를 만들어 돌려줌
// 응답: {ok:true, url:"https://m.stock.naver.com/worldstock/etf/QQQ.O/total", reutersCode, stockType}
// 디버그: ?nvlink=QQQ&raw=1 → 네이버 검색 원본 JSON 그대로
// 코스피 시가총액 상위 N개 → [{code,name}]
async function marketCapTop(market, n, raw) {
  n = Math.max(1, Math.min(n || 100, 100));
  const urls = [
    "https://m.stock.naver.com/api/stocks/marketValue/" + market + "?page=1&pageSize=" + n,
    "https://m.stock.naver.com/api/stocks/" + market + "/marketValue?page=1&pageSize=" + n,
  ];
  let d = null, used = null;
  for (const u of urls) {
    try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/" } }); if (r.ok) { d = await r.json(); used = u; break; } } catch (e) {}
  }
  if (!d) return { ok: false, error: "no data" };
  if (raw) return { ok: true, source: used, raw: d };
  const out = [];
  const dig = o => {
    if (!o || out.length >= n) return;
    if (Array.isArray(o)) { for (const x of o) dig(x); return; }
    if (typeof o === "object") {
      const code = o.itemCode || o.code || o.cd || o.symbolCode;
      const name = o.stockName || o.name || o.nm || o.itemName;
      if (/^\d{6}$/.test(String(code || "")) && name && !out.find(z => z.code === String(code))) out.push({ code: String(code), name: String(name) });
      for (const k of Object.keys(o)) dig(o[k]);
    }
  };
  dig(d);
  return { ok: true, market, count: out.length, items: out.slice(0, n) };
}
// 네이버 재무 → 최근 분기 ROE + 기간(예: 2026.03)
async function naverRoe(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  const urls = [
    "https://m.stock.naver.com/api/stock/" + code + "/finance/quarter",
    "https://m.stock.naver.com/api/stock/" + code + "/finance/annual",
  ];
  let d = null, used = null;
  for (const u of urls) {
    try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/" } }); if (r.ok) { d = await r.json(); used = u; break; } } catch (e) {}
  }
  if (!d) return { ok: false, code, error: "no data" };
  if (raw) return { ok: true, code, source: used, raw: d };
  const fi = d.financeInfo || d.financeData || d.result || d;
  let periods = [];
  const tt = fi.trTitleList || fi.titleList || fi.periodList || fi.columns;
  if (Array.isArray(tt)) periods = tt.map(x => (typeof x === "string" ? x : (x.key || x.title || x.value || x.yymm))).filter(Boolean);
  const numf = v => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : null; };
  let series = [];
  const findRoe = arr => {
    for (const row of (arr || [])) {
      if (!row || typeof row !== "object") continue;
      const t = String(row.title || row.titleKor || row.name || row.acctNm || "").replace(/\s/g, "").toUpperCase();
      if (t === "ROE" || (t.indexOf("ROE") >= 0 && t.length <= 8)) {
        const cols = row.columns || row.column || row.values || row.valueList || row.data;
        if (cols && !Array.isArray(cols)) {
          const keys = periods.length ? periods : Object.keys(cols);
          for (let i = 0; i < keys.length; i++) { const c = cols[keys[i]]; const v = numf(c && (c.value != null ? c.value : c)); if (v != null) series.push({ period: keys[i], value: v }); }
        } else if (Array.isArray(cols)) {
          for (let i = 0; i < cols.length; i++) { const c = cols[i]; const v = numf(c && typeof c === "object" ? (c.value != null ? c.value : c.v) : c); if (v != null) series.push({ period: periods[i] || (c && (c.key || c.yymm)) || null, value: v }); }
        }
        if (series.length) return true;
      }
      if (row.children && findRoe(row.children)) return true;
    }
    return false;
  };
  findRoe(fi.rowList || fi.rows || fi.list || []);
  const last = series[series.length - 1] || null;
  const prev = series[series.length - 2] || null;
  return { ok: true, code, roe: last ? last.value : null, period: last ? last.period : null, prevRoe: prev ? prev.value : null, prevPeriod: prev ? prev.period : null };
}
// 외국인 순매매: finance.naver.com/item/frgn.naver 파싱 → 최근 5거래일 매수여부(과거→최근)
async function naverForeign(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  const u = "https://finance.naver.com/item/frgn.naver?code=" + code;
  let html = null;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/item/frgn.naver?code=" + code } });
    if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
  } catch (e) {}
  if (!html) return { ok: false, code, error: "no data" };
  if (raw) return { ok: true, code, raw: html.slice(0, 5500) };
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rm;
  while ((rm = rowRe.exec(html)) !== null) {
    const rh = rm[1];
    const dm = rh.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!dm) continue;
    const tds = [...rh.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
    if (tds.length < 7) continue;
    const cell = tds[6]; // 외국인 순매매량
    const cls = ((cell.match(/class="([^"]*)"/) || [])[1] || "");
    const txt = cell.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
    const num = parseInt(txt.replace(/[^0-9]/g, ""), 10) || 0;
    let buy;
    if (/-|–|−/.test(txt)) buy = false;
    else if (/red/.test(cls)) buy = true;
    else if (/nv|blue/.test(cls)) buy = false;
    else buy = num > 0;
    rows.push({ date: dm[0], buy: !!(buy && num > 0) });
    if (rows.length >= 5) break;
  }
  const last5 = rows.slice(0, 5).reverse(); // 과거→최근
  const seq = last5.map(d => d.buy);
  return { ok: true, code, seq, days: last5, count: seq.filter(Boolean).length };
}
// 네이버 종목분석 리포트 → 최근 1건 {title, date(M.D), ymd}
function decodeEnt(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}
async function naverReport(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  // 종목 필터: searchType=itemCode 가 있어야 해당 종목 리포트만 나옴 (없으면 전체 최신 1건이 모든 종목에 동일하게 잡힘)
  const u = "https://finance.naver.com/research/company_list.naver?searchType=itemCode&itemCode=" + code + "&page=1";
  let html = null;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/research/company_list.naver" } });
    if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
  } catch (e) {}
  if (!html) return { ok: false, code, error: "no data" };
  if (raw) return { ok: true, code, url: u, raw: html.slice(0, 4500) };
  let title = null, date = null, ymd = null, broker = null, nid = null, pdf = null;
  // company_read 링크에 itemCode 파라미터가 있는 행만(=해당 종목 리포트) 매칭
  const re = /company_read\.naver\?nid=(\d+)[^"']*itemCode=(\d{6})[^"']*["'][^>]*>\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[2] === code) {
      nid = m[1];
      title = decodeEnt(m[3].trim());
      const idx = m.index;
      const rowEnd = html.indexOf("</tr>", idx);
      const row = (rowEnd > idx && rowEnd - idx < 2000) ? html.slice(idx, rowEnd) : html.slice(idx, idx + 1200);
      const bm = row.match(/<td[^>]*>\s*([가-힣A-Za-z0-9·.&;\s]*?증권)\s*<\/td>/);
      if (bm) broker = decodeEnt(bm[1].trim());
      const dm = row.match(/(\d{2})\.(\d{2})\.(\d{2})/);
      if (dm) { ymd = dm[0]; date = parseInt(dm[2], 10) + "." + parseInt(dm[3], 10); }
      const pm = row.match(/href=["']([^"']+\.pdf[^"']*)["']/i);
      if (pm) pdf = pm[1];
      break;
    }
  }
  // 위 매칭이 실패하면(링크에 itemCode 없을 때) 첫 리포트로 폴백
  if (!title) {
    const tm = html.match(/company_read\.naver\?nid=(\d+)[^"']*["'][^>]*>\s*([^<]+?)\s*</);
    if (tm) {
      nid = tm[1];
      title = decodeEnt(tm[2].trim());
      const idx = html.indexOf(tm[0]);
      const rowEnd = html.indexOf("</tr>", idx);
      const row = (rowEnd > idx && rowEnd - idx < 2000) ? html.slice(idx, rowEnd) : html.slice(idx, idx + 1200);
      const dm = row.match(/(\d{2})\.(\d{2})\.(\d{2})/);
      if (dm) { ymd = dm[0]; date = parseInt(dm[2], 10) + "." + parseInt(dm[3], 10); }
      const pm = row.match(/href=["']([^"']+\.pdf[^"']*)["']/i);
      if (pm) pdf = pm[1];
    }
  }
  const link = pdf ? (pdf.indexOf("http") === 0 ? pdf : ("https://finance.naver.com" + pdf)) : (nid ? ("https://finance.naver.com/research/company_read.naver?nid=" + nid + "&page=1") : null);
  return { ok: true, code, title, date, ymd, broker, nid, link, pdf: !!pdf };
}
// 미국 종목 목표주가: 티커 → reutersCode 해석 → 네이버 월드스톡 통합정보에서 목표주가 추출
async function usTarget(ticker, raw) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  try {
    const link = await naverWorldUrl(ticker, null);
    const code = link && link.ok ? link.reutersCode : null;
    if (!code) return { ok: false, ticker, error: "no reutersCode" };
    const endpoints = [
      "https://api.stock.naver.com/stock/" + encodeURIComponent(code) + "/integration",
      "https://m.stock.naver.com/api/stock/worldstock/" + encodeURIComponent(code) + "/integration",
      "https://api.stock.naver.com/stock/" + encodeURIComponent(code) + "/basic",
    ];
    let d = null, used = null;
    for (const u of endpoints) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/" } });
        if (!r.ok) continue;
        d = await r.json(); used = u; break;
      } catch (e) {}
    }
    if (!d) return { ok: false, ticker, reutersCode: code, error: "no data" };
    if (raw) return { ok: true, ticker, reutersCode: code, source: used, raw: d };
    const grab = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) && n > 0 ? n : null; };
    let tp = null;
    const scanC = o => {
      if (tp != null || o == null || typeof o !== "object") return;
      if (o.priceTargetMean != null) { const g = grab(o.priceTargetMean); if (g != null) { tp = g; return; } }
      for (const k of Object.keys(o)) scanC(o[k]);
    };
    scanC(d);
    if (tp == null) {
      const scanL = o => {
        if (tp != null || o == null) return;
        if (Array.isArray(o)) { for (const x of o) scanL(x); return; }
        if (typeof o === "object") {
          const label = String(o.key || o.title || o.name || "").replace(/\s/g, "");
          if (label.indexOf("목표주가") >= 0) { const g = grab(o.value ?? o.val ?? o.data); if (g != null) { tp = g; return; } }
          for (const k of Object.keys(o)) { if (/(targetPrice|priceTarget|targetMean)/i.test(k)) { const g = grab(o[k]); if (g != null) { tp = g; return; } } }
          for (const k of Object.keys(o)) scanL(o[k]);
        }
      };
      scanL(d);
    }
    return { ok: true, ticker, reutersCode: code, target: tp, targetStr: tp != null ? String(tp) : null };
  } catch (e) {
    return { ok: false, ticker, error: String(e) };
  }
}
// 네이버 자동검색이 엉뚱하게 잡는 티커: 월드스톡 자동선택을 건너뛰고
// 클라이언트의 네이버 검색(정확한 금융 카드)으로 떨어지게 한다.
const NV_SEARCH = new Set([]);
// 정확한 reutersCode를 아는 경우 직접 지정 (예: {"SPY":"SPY.K"})
const NV_OVERRIDE = {};
async function naverWorldUrl(ticker, raw) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  if (!raw && NV_OVERRIDE[ticker]) {
    const code = NV_OVERRIDE[ticker];
    return { ok: true, ticker, url: "https://m.stock.naver.com/worldstock/etf/" + code + "/total", reutersCode: code, stockType: "etf" };
  }
  if (!raw && NV_SEARCH.has(ticker)) return { ok: false, ticker, error: "search-fallback" };
  const q = encodeURIComponent(ticker);
  const urls = [
    "https://m.stock.naver.com/front-api/search/autoComplete?query=" + q + "&target=stock,etf,index",
    "https://api.stock.naver.com/front-api/search/autoComplete?query=" + q + "&target=stock,etf,index",
    "https://m.stock.naver.com/api/search/all?query=" + q,
    "https://api.stock.naver.com/search/all?query=" + q,
    "https://m.stock.naver.com/api/search/searchList?query=" + q,
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: {
          "User-Agent": UA, "Accept": "application/json",
          "Referer": "https://m.stock.naver.com/",
        },
        cf: { cacheTtl: 3600 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (raw) return { ok: true, source: u, data: d };  // 디버그: 원본 그대로

      // 검색 결과가 어디에 담겨 오든 모두 모음
      const bucket = [];
      const push = a => { if (Array.isArray(a)) bucket.push(...a); };
      const dig = o => { if (!o || typeof o !== "object") return;
        push(o.stocks); push(o.etfs); push(o.items); push(o.list);
        push(o.searchResultList); push(o.searchList); push(o.results); };
      dig(d); dig(d.result); dig(d.data);
      if (d.result) dig(d.result.result);

      const ricOf = x => String((x && (x.reutersCode || x.ric || x.code || x.symbolCode)) || "");
      const symOf = x => String((x && (x.code || x.symbolCode || x.itemCode || x.symbol)) || "").toUpperCase();
      const isUSA = x => { const n = String((x && x.nationCode) || "").toUpperCase(); return n === "" || n === "USA"; };
      const notKR6 = x => !/^\d{6}$/.test(ricOf(x)); // 한국 6자리 코드 제외

      const pool = bucket.filter(x => isUSA(x) && notKR6(x));
      const list = pool.length ? pool : bucket.filter(notKR6);
      const pick =
        list.find(x => symOf(x) === ticker) ||                                  // 코드 정확 일치 (예: SPY, V)
        list.find(x => ricOf(x).split(".")[0].toUpperCase() === ticker) ||      // RIC 접두 일치 (예: QQQ.O)
        list.find(x => x.url) ||
        list[0];
      if (!pick) continue;

      // 네이버가 항목마다 주는 url을 그대로 사용 (가장 정확). 없으면 reutersCode로 구성
      let path = String(pick.url || "");
      if (path) {
        if (!/\/total$/.test(path)) path += "/total";
        const full = /^https?:/.test(path) ? path : "https://m.stock.naver.com" + path;
        return { ok: true, ticker, url: full, reutersCode: ricOf(pick), stockType: /\/etf\//.test(path) ? "etf" : "stock" };
      }
      const code = ricOf(pick);
      let type = String((pick.stockType || pick.type || pick.typeCode || pick.stockEndType || "")).toLowerCase();
      type = type.includes("etf") ? "etf" : "stock";
      return {
        ok: true, ticker,
        url: "https://m.stock.naver.com/worldstock/" + type + "/" + code + "/total",
        reutersCode: code, stockType: type,
      };
    } catch (e) { /* 다음 후보 */ }
  }
  return { ok: false, ticker, error: "not found" };
}
function num(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function round(n, p) {
  const f = Math.pow(10, p);
  return Math.round(n * f) / f;
}
// 기업명/코드 → 종목코드 후보 (네이버 자동완성 중계, 두 엔드포인트 시도)
async function naverFind(q) {
  const urls = [
    "https://m.stock.naver.com/front-api/search/autoComplete?query=" + encodeURIComponent(q) + "&target=stock,index,etf",
    "https://ac.stock.naver.com/ac?q=" + encodeURIComponent(q) + "&target=stock,etf",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" },
        cf: { cacheTtl: 60 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      const items = (d && d.result && d.result.items) || (d && d.items) || [];
      const out = [];
      for (const it of items) {
        let rawCode, name;
        if (Array.isArray(it)) {            // ac.stock 형식: [[code],[name],...]
          rawCode = Array.isArray(it[0]) ? it[0][0] : it[0];
          name = Array.isArray(it[1]) ? it[1][0] : it[1];
        } else {                            // front-api 형식: {code, name}
          rawCode = it.code || it.cd || it.itemCode || it.reutersCode;
          name = it.name || it.nm || it.korNm || it.itemName;
        }
        const c = String(rawCode || "").replace(/[^0-9]/g, "");
        const nm = String(name || "").replace(/<[^>]*>/g, "").trim();
        if (c.length === 6 && nm) out.push({ code: c, name: nm });
        if (out.length >= 8) break;
      }
      if (out.length) return { ok: true, items: out };
    } catch (e) { /* 다음 후보 */ }
  }
  return { ok: true, items: [] };
}
// 공유 자료 저장/불러오기 (Cloudflare KV). GET=읽기, POST=쓰기
const ALLOWED_KEYS = new Set(["val_us", "val_usetf", "val_kretf", "val_kr", "val_kr2", "reports", "watch"]);
async function handleData(request, env, key) {
  if (!ALLOWED_KEYS.has(key)) return json({ ok: false, error: "bad key" }, 400);
  if (!env || !env.KV) return json({ ok: false, error: "no kv binding" }, 500);
  try {
    if (request.method === "POST" || request.method === "PUT") {
      const body = await request.text();
      if (body.length > 2000000) return json({ ok: false, error: "too large" }, 413);
      await env.KV.put(key, body);
      return json({ ok: true }, 200);
    }
    const value = await env.KV.get(key);
    return json({ ok: true, value }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}
