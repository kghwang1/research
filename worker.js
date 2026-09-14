/**
 * 리서치보드 시세 중계 서버 (Cloudflare Workers) — 야후 파이낸스 버전
 * ---------------------------------------------------------------
 * 챠트 OHLCV 엔드포인트 추가:
 *   ?yahooChart=^KS11&range=6mo   → 코스피 6개월 일봉
 *   ?yahooChart=005930.KS&range=3mo → 삼성전자 3개월 일봉
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

    // ── 챠트 OHLCV (신규 추가) ──────────────────────────────
    // ── KIS 챠트 OHLCV (한국 주식 전용) ─────────────────────
    const kisChart = url.searchParams.get("kisChart");
    if (kisChart) return json(await fetchKisOHLCV(kisChart, url.searchParams.get("range") || "6mo", env), 200);

    // ── 챠트 OHLCV (야후, 미국주식/지수) ────────────────────
    const yahooChart = url.searchParams.get("yahooChart");
    if (yahooChart) return json(await fetchOHLCV(yahooChart, url.searchParams.get("range") || "6mo", url.searchParams.get("interval") || "1d"), 200);

    // 미국/해외 종목 검색 (야후 검색 API)
    const ussearch = url.searchParams.get("ussearch");
    if (ussearch) return json(await yahooSearch(ussearch), 200);

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
    if (kospiN) return json(await marketCapTop("KOSPI", parseInt(kospiN) || 200, url.searchParams.get("raw")), 200);
    const kosdaqN = url.searchParams.get("kosdaq");
    if (kosdaqN) return json(await marketCapTop("KOSDAQ", parseInt(kosdaqN) || 100, url.searchParams.get("raw")), 200);
    const roe1 = url.searchParams.get("roe");
    if (roe1) return json(await naverRoe(roe1, url.searchParams.get("raw")), 200);
    const roesP = url.searchParams.get("roes");
    if (roesP) {
      const codes = roesP.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 40);
      const items = await Promise.all(codes.map(c => naverRoe(c)));
      return json({ ok: true, items }, 200);
    }
    // 프로그램매매(차익/비차익) 프로브
    if (url.searchParams.get("prog")) return json(await naverProgram(url.searchParams.get("raw")), 200);
    // 외국인 비차익 프로브
    if (url.searchParams.get("fprog")) return json(await naverForeignProgram(url.searchParams.get("raw")), 200);
    // 외국인 현물 순매수(투자자별 일별) 프로브/조회
    if (url.searchParams.get("finv")) return json(await naverInvestorDay(url.searchParams.get("raw"), url.searchParams.get("sosok")), 200);
    // 코스피200 야간선물 프로브
    if (url.searchParams.get("nfut")) return json(await nightFutProbe(url.searchParams.get("raw")), 200);
    // 야간선물 외부 소스 프로브(investing 등)
    if (url.searchParams.get("nfut2")) return json(await nightFutExt(url.searchParams.get("raw")), 200);
    // 다음금융 선물 투자자별 매매동향 프로브
    if (url.searchParams.get("daumfut")) return json(await daumFutProbe(url.searchParams.get("raw")), 200);
    // 외국인 선물 순매수(실시간, 다음금융)
    if (url.searchParams.get("ffut2")) return json(await daumForeignFutures(url.searchParams.get("raw")), 200);
    // 외국인 선물 순매수(네이버 선물 투자자별 매매동향)
    if (url.searchParams.get("futinv")) return json(await naverFutInvestor(url.searchParams.get("dbg")), 200);
    // 다음날 외국인 방향 신호(EWY·원달러·K200, 야후)
    if (url.searchParams.get("fdir")) return json(await foreignDir(url.searchParams.get("raw")), 200);
    // 외국인 선물 순매수(KRX, 최근 N거래일) - 방향 신호
    const ffut = url.searchParams.get("ffut");
    if (ffut) return json(await foreignFutures(parseInt(url.searchParams.get("days")) || 5, url.searchParams.get("raw")), 200);
    // 외국인 현물 누적 순매수·평균지수 추정(손익곡선)
    const fpos = url.searchParams.get("fpos");
    if (fpos) return json(await foreignSpotPos(parseInt(url.searchParams.get("days")) || 60, url.searchParams.get("raw")), 200);
    // 외국인 매매 추이(1년 일별 매수/매도/순매수) - 막대그래프용
    const ftrend = url.searchParams.get("ftrend");
    if (ftrend) return json(await foreignTrend(parseInt(url.searchParams.get("days")) || 250, url.searchParams.get("raw")), 200);
    // 외국인 순매수 상위 종목 (최근 5일 연속 순매수)
    const ftop = url.searchParams.get("ftop");
    if (ftop) return json(await foreignTopStocks(url.searchParams.get("raw"), url.searchParams.get("nocache")), 200);
    // 투자자별 순매수/순매도 상위 종목 — 자료 출처 탐색
    const trkp = url.searchParams.get("trankprobe");
    if (trkp) return json(await trankProbe(trkp), 200);
    // 외국인·기관 순매수/순매도 상위 종목 (일간)
    const trank = url.searchParams.get("trank");
    if (trank) return json(await trendRank(parseInt(url.searchParams.get("n")) || 10, env, url.searchParams.get("fresh")), 200);
    // investor_gubun 코드별 caption 확인 프로브
    if (url.searchParams.get("gubunprobe")) return json(await gubunProbe(), 200);
    // 코스닥 외국인 순매수 소스 프로브
    if (url.searchParams.get("kosdaqprobe")) return json(await kosdaqProbe(), 200);
    // frgn.naver 구조 확인 (특정 종목)
    const frgnCode = url.searchParams.get("frgnprobe");
    if (frgnCode) return json(await frgnProbe(frgnCode), 200);
    // 외국인 순매매(최근 5거래일) - 종목분석 리포트 라우트 옆
    const frgn1 = url.searchParams.get("frgn");
    if (frgn1) return json(await naverForeign(frgn1, url.searchParams.get("raw")), 200);
    const frgnsP = url.searchParams.get("frgns");
    if (frgnsP) {
      const codes = frgnsP.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 30);
      const items = await Promise.all(codes.map(async cd => {
        const cached = await kvGet(env, "frgn:" + cd);
        if (cached) return cached;
        const fresh = await naverForeign(cd);
        if (fresh && fresh.ok) await kvSet(env, "frgn:" + cd, fresh);
        return fresh;
      }));
      return json({ ok: true, items }, 200);
    }
    // 네이버 차트 데이터 (한국 종목 일봉/주봉/월봉)
    const naverChartCode = url.searchParams.get("naverChart");
    if (naverChartCode) {
      const tf = url.searchParams.get("timeframe") || "day";
      const raw = url.searchParams.get("raw");
      if (!raw) {
        const cached = await kvGet(env, "chart:" + naverChartCode + ":" + tf + ":" + kstYmd(0));
        if (cached) return json(cached, 200);
      }
      const result = await naverChartData(naverChartCode, tf, parseInt(url.searchParams.get("days")) || 300, raw);
      if (!raw && result && result.ok) await kvSet(env, "chart:" + naverChartCode + ":" + tf + ":" + kstYmd(0), result);
      return json(result, 200);
    }

    // 미국(해외) 종목 네이버 차트
    const nwChart = url.searchParams.get("naverWorldChart");
    if (nwChart) {
      const tf = url.searchParams.get("timeframe") || "day";
      const raw = url.searchParams.get("raw");
      const result = await naverWorldChart(nwChart, tf, parseInt(url.searchParams.get("days")) || 400, raw);
      return json(result, 200);
    }

    // 외국인 일별 순매수 수량(차트 보조지표용, 기간 지정 가능)
    const frgnDaily = url.searchParams.get("frgnDaily");
    if (frgnDaily) {
      const raw = url.searchParams.get("raw");
      if (!raw) {
        const cached = await kvGet(env, "frgnD:" + frgnDaily);
        if (cached) return json(cached, 200);
      }
      const result = await naverForeignDaily(frgnDaily, parseInt(url.searchParams.get("days")) || 120, raw);
      if (!raw && result && result.ok) await kvSet(env, "frgnD:" + frgnDaily, result);
      return json(result, 200);
    }
    // 공매도/대차잔고 (KRX 데이터)
    const shortCode = url.searchParams.get("short");
    if (shortCode) return json(await krxShortSelling(shortCode, parseInt(url.searchParams.get("days")) || 20, url.searchParams.get("raw")), 200);
    // 대차잔고 조회
    const lendCode = url.searchParams.get("lend");
    if (lendCode) return json(await krxLendBalance(lendCode, parseInt(url.searchParams.get("days")) || 20, url.searchParams.get("raw")), 200);
    // 공매도 배치 조회 (ISIN 직접 계산, finder 불필요)
    const shortsP = url.searchParams.get("shorts");
    if (shortsP) {
      const codes = shortsP.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(c => c.length === 6).slice(0, 30);
      const items = await Promise.allSettled(codes.map(async cd => {
        // KV 캐시 확인
        const cached = await kvGet(env, "short:" + cd);
        if (cached) return cached;
        const isin = codeToISIN(cd);
        try {
          const bp = new URLSearchParams({ bld:"dbms/MDC_OUT/STAT/srt/MDCSTAT30001_OUT", locale:"ko_KR", isuCd:isin, strtDd:kstYmd(20), endDd:kstYmd(0), share:"1", money:"1", csvxls_isNo:"false" });
          const r = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
            method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8", "User-Agent":"Mozilla/5.0", "Referer":"https://data.krx.co.kr/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT300&isuCd="+cd, "Origin":"https://data.krx.co.kr", "X-Requested-With":"XMLHttpRequest" },
            body:bp.toString()
          });
          if (!r.ok) return { ok:false, code:cd };
          const d = await r.json();
          const arr = d.OutBlock_1 || [];
          if (!arr.length) return { ok:false, code:cd };
          const result = { ok:true, code:cd, data: arr.slice(0,12).map(row => ({
            date: (row.TRD_DD||"").replace(/\//g,"-"),
            vol: parseInt(String(row.CVSRTSELL_TRDVOL||0).replace(/,/g,""),10)||0,
            bal: parseInt(String(row.STR_CONST_VAL1||"0").replace(/[^0-9]/g,""),10)||0,
          })) };
          await kvSet(env, "short:" + cd, result);
          return result;
        } catch(e) { return { ok:false, code:cd }; }
      }));
      return json({ ok:true, items: items.map(r=>r.status==='fulfilled'?r.value:{ok:false,error:'rejected'}) }, 200);
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
    if (ustgt) return json(await usTarget(ustgt, url.searchParams.get("raw"), env, url.searchParams.get("nocache")), 200);
    // 미국 종합정보(ROE·52주최고가·목표가·뉴스)
    const usinfo1 = url.searchParams.get("usinfo");
    if (usinfo1) return json(await usInfo(usinfo1, url.searchParams.get("raw"), env), 200);
    const usdiag1 = url.searchParams.get("usdiag");
    if (usdiag1) return json(await usDiag(usdiag1), 200);
    // 해외 종목페이지 필드 진단 프로브
    // FnGuide 재무제표에서 영업활동현금흐름 찾기
    const fnraw = url.searchParams.get("fnraw");
    if (fnraw) {
      const c = String(fnraw).replace(/[^0-9]/g, "");
      const H = { "User-Agent": UA, "Accept": "text/html,*/*",
                  "Referer": "https://comp.fnguide.com/" };
      const out = {};
      // NewMenuID: 103=재무제표, 104=재무비율, 108=컨센서스
      const urls = [
        ["재무제표", "https://comp.fnguide.com/SVO2/ASP/SVD_Finance.asp?pGB=1&gicode=A" + c + "&MenuYn=Y&NewMenuID=103&stkGb=701"],
        ["재무비율", "https://comp.fnguide.com/SVO2/ASP/SVD_FinanceRatio.asp?pGB=1&gicode=A" + c + "&MenuYn=Y&NewMenuID=104&stkGb=701"],
      ];
      for (const [nm, u] of urls) {
        try {
          const r = await fetch(u, { headers: H, cf: { cacheTtl: 600 } });
          if (!r.ok) { out[nm] = "HTTP " + r.status; continue; }
          const buf = await r.arrayBuffer();
          let html = new TextDecoder("euc-kr").decode(buf);
          if (!/[가-힣]/.test(html.slice(0, 4000))) html = new TextDecoder("utf-8").decode(buf);
          // 현금흐름 관련 행 제목만 추린다
          const rows = html.match(/<tr[\s\S]{0,400}?<\/tr>/g) || [];
          const hits = [];
          rows.forEach(tr => {
            const t = tr.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
            if (/현금흐름|영업활동|당기순이익/.test(t) && t.length < 220) hits.push(t.slice(0, 180));
          });
          // 표 제목(기간) 후보
          const ths = [...html.matchAll(/<th[^>]*>([\s\S]{0,60}?)<\/th>/g)]
            .map(m => m[1].replace(/<[^>]*>/g, "").trim())
            .filter(x => /^\d{4}\/\d{2}/.test(x)).slice(0, 12);
          out[nm] = { status: r.status, size: html.length, periods: ths, hits: hits.slice(0, 12),
                      head: html.replace(/\s+/g, " ").slice(0, 600) };
        } catch (e) { out[nm] = "ERR " + String(e).slice(0, 80); }
        await usSleep(200);
      }
      return json({ ok: true, code: c, out }, 200);
    }

    // 현금흐름표 원자료 확인 (영업활동현금흐름이 어디 있는지)
    const cfraw = url.searchParams.get("cfraw");
    if (cfraw) {
      const c = String(cfraw).replace(/[^0-9]/g, "");
      const H = { "User-Agent": UA, "Accept": "application/json",
                  "Referer": "https://m.stock.naver.com/domestic/stock/" + c + "/total" };
      const out = {};
      const urls = [
        ["cashflow_q", "https://m.stock.naver.com/api/stock/" + c + "/finance/cashflow/quarter"],
        ["cashflow_a", "https://m.stock.naver.com/api/stock/" + c + "/finance/cashflow/annual"],
        ["finsummary", "https://m.stock.naver.com/api/stock/" + c + "/finance/summary"],
        ["integration", "https://m.stock.naver.com/api/stock/" + c + "/integration"],
      ];
      for (const [nm, u] of urls) {
        try {
          const r = await fetch(u, { headers: H });
          if (!r.ok) { out[nm] = "HTTP " + r.status; continue; }
          const j = await r.json();
          // 항목명만 추려서 본다
          const titles = [];
          const dig = o => {
            if (o == null || titles.length > 60) return;
            if (Array.isArray(o)) { o.forEach(dig); return; }
            if (typeof o !== "object") return;
            const t = String(o.title || o.titleKor || o.name || o.acctNm || "").trim();
            if (t) titles.push(t);
            Object.keys(o).forEach(k => dig(o[k]));
          };
          dig(j);
          out[nm] = { topKeys: Object.keys(j).slice(0, 15), titles: [...new Set(titles)].slice(0, 40) };
        } catch (e) { out[nm] = "ERR " + String(e).slice(0, 60); }
        await usSleep(150);
      }
      return json({ ok: true, code: c, out }, 200);
    }

    // 재무 3지표 (매출증가율·ROE·부채비율) — 최근 분기들
    const fin3 = url.searchParams.get("fin3");
    if (fin3) return json(await naverFin3(fin3, url.searchParams.get("raw")), 200);

    // 국내 ETF 수익률 원자료 확인 (return1Month 등이 주가 기준인지 총수익 기준인지)
    const etfraw = url.searchParams.get("etfraw");
    if (etfraw) {
      const c = String(etfraw).replace(/[^0-9]/g, "");
      const H = { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/domestic/etf/" + c + "/total" };
      const out = {};
      for (const [nm, u] of [
        ["basic", "https://api.stock.naver.com/etf/" + c + "/basic"],
        ["integration", "https://api.stock.naver.com/etf/" + c + "/integration"],
      ]) {
        const j = await usFetchJson(u, H);
        if (!j) { out[nm] = null; continue; }
        // 수익률·배당 관련 항목만 추려서 보여준다
        const hits = [];
        const walk = (o, path) => {
          if (o == null || hits.length > 40) return;
          if (Array.isArray(o)) { o.slice(0, 30).forEach((x, i) => walk(x, path + "[" + i + "]")); return; }
          if (typeof o !== "object") return;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (v != null && typeof v !== "object") {
              const label = String(o.key || o.title || o.name || "");
              if (/return|yield|수익률|배당|nav/i.test(k) || /수익률|배당/.test(label)) {
                hits.push(path + "." + k + (label ? " [" + label + "]" : "") + " = " + String(v).slice(0, 30));
              }
            }
          }
          for (const k of Object.keys(o)) walk(o[k], path + "." + k);
        };
        walk(j, nm);
        out[nm] = { topKeys: Object.keys(j).slice(0, 20), hits };
      }
      return json({ ok: true, code: c, out }, 200);
    }

    // 증시자금동향 (네이버 금융) — 고객예탁금·신용잔고·펀드(주식형/혼합형/채권형)
    const dep = url.searchParams.get("deposit");
    if (dep) return json(await naverDeposit(parseInt(url.searchParams.get("pages")) || 9, url.searchParams.get("raw")), 200);

    // 풋콜 레이쇼 (KRX) — 후보 bld 를 훑어 어느 것이 응답하는지 확인
    const pcr = url.searchParams.get("pcratio");
    if (pcr) return json(await krxPutCall(pcr, url.searchParams.get("raw")), 200);

    const usraw1 = url.searchParams.get("usraw");
    if (usraw1) return json(await usProbe(usraw1, url.searchParams.get("dump")), 200);
    const usinfos = url.searchParams.get("usinfos");
    if (usinfos) {
      const syms = usinfos.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
      const items = await usSeq(syms, s => usInfo(s, null, env));
      return json({ ok: true, items }, 200);
    }
    // 국내 종목/ETF 배당수익률·수익률
    const krinfo1 = url.searchParams.get("krinfo");
    if (krinfo1) return json(await krInfo(krinfo1, url.searchParams.get("raw")), 200);
    const krinfos = url.searchParams.get("krinfos");
    if (krinfos) {
      const cs = krinfos.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(Boolean).slice(0, 20);
      const items = await Promise.all(cs.map(c => krInfo(c)));
      return json({ ok: true, items }, 200);
    }
    const ustgts = url.searchParams.get("ustargets");
    if (ustgts) {
      const syms = ustgts.split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
      const items = await usSeq(syms, s => usTarget(s, null, env));
      return json({ ok: true, items }, 200);
    }
    // 티커 → 네이버 월드스톡 페이지 주소 변환
    const nvlink = url.searchParams.get("nvlink");
    if (nvlink) return json(await naverWorldUrl(nvlink, url.searchParams.get("raw")), 200);
    // 진단: 후보 API 5곳 각각의 상태코드 확인
    const nvprobe = url.searchParams.get("nvprobe");
    if (nvprobe) return json(await naverWorldProbe(nvprobe), 200);
    const multi = url.searchParams.get("symbols");
    if (multi) {
      const fresh = url.searchParams.get("fresh") === "1";  // 캐시 우회
      const syms = multi.split(",").map(s => s.trim()).filter(Boolean);
      const items = await Promise.all(syms.map(sym => one(sym, fresh)));
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

// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// KIS OHLCV 함수 (한국투자증권 Open API)
// ══════════════════════════════════════════════════════

// KIS 액세스 토큰 발급 (24시간 유효)
async function getKisToken(env) {
  const res = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: env.KIS_APP_KEY,
      appsecret: env.KIS_APP_SECRET,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.access_token || null;
}

// KIS 일봉 OHLCV 조회
// range: "1mo" | "3mo" | "6mo" | "1y" | "2y"
async function fetchKisOHLCV(code, range, env) {
  try {
    const token = await getKisToken(env);
    if (!token) return { ok: false, code, error: "token fail" };

    // range → 시작일 계산
    const now = new Date();
    const endDt = now.toISOString().slice(0, 10).replace(/-/g, "");
    const monthMap = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "2y": 24 };
    const months = monthMap[range] || 6;
    const start = new Date(now);
    start.setMonth(start.getMonth() - months);
    const startDt = start.toISOString().slice(0, 10).replace(/-/g, "");

    // KIS 일봉 API (국내 주식)
    const params = new URLSearchParams({
      fid_cond_mrkt_div_code: "J",   // J=주식
      fid_input_iscd: code,           // 6자리 종목코드
      fid_input_date_1: startDt,      // 시작일 YYYYMMDD
      fid_input_date_2: endDt,        // 종료일 YYYYMMDD
      fid_period_div_code: "D",       // D=일봉
      fid_org_adj_prc: "1",           // 1=수정주가
    });

    const res = await fetch(
      "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?" + params,
      {
        headers: {
          "Content-Type": "application/json",
          "authorization": "Bearer " + token,
          "appkey": env.KIS_APP_KEY,
          "appsecret": env.KIS_APP_SECRET,
          "tr_id": "FHKST03010100",
          "custtype": "P",
        },
      }
    );

    if (!res.ok) return { ok: false, code, error: "kis " + res.status };
    const d = await res.json();

    if (d.rt_cd !== "0") return { ok: false, code, error: d.msg1 || "kis error" };

    const output = d.output2 || [];
    // KIS는 최신순 → 오래된 순으로 정렬
    const ohlcv = output
      .filter(r => r.stck_bsop_date && r.stck_clpr)
      .map(r => ({
        date: r.stck_bsop_date.slice(0,4) + "-" + r.stck_bsop_date.slice(4,6) + "-" + r.stck_bsop_date.slice(6,8),
        open:   Number(r.stck_oprc),
        high:   Number(r.stck_hgpr),
        low:    Number(r.stck_lwpr),
        close:  Number(r.stck_clpr),
        volume: Number(r.acml_vol),
      }))
      .reverse();  // 오래된 것부터

    // ── 당일 봉 보정: 네이버 현재가로 마지막 봉 갱신 ────────
    const today = now.toISOString().slice(0, 10).replace(/-/g, "");
    const lastDate = ohlcv.length ? ohlcv[ohlcv.length - 1].date.replace(/-/g, "") : "";
    const koreaHour = new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
    const isTradingTime = koreaHour >= 9 && koreaHour < 16;

    if (lastDate < today || isTradingTime) {
      try {
        const nvRes = await fetch(
          "https://m.stock.naver.com/api/stock/" + code + "/basic",
          {
            headers: {
              "User-Agent": UA,
              "Accept": "application/json",
              "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total",
            },
            cf: { cacheTtl: 0, cacheEverything: false },
          }
        );
        if (nvRes.ok) {
          const nd = await nvRes.json();
          const close = num(nd.closePrice ?? nd.nowVal ?? nd.currentPrice ?? nd.tradePrice);
          if (close != null) {
            const todayStr = today.slice(0,4) + "-" + today.slice(4,6) + "-" + today.slice(6,8);
            const todayCandle = {
              date:   todayStr,
              open:   num(nd.openPrice)  || close,
              high:   num(nd.highPrice)  || close,
              low:    num(nd.lowPrice)   || close,
              close:  close,
              volume: num(nd.accumulatedTradingVolume ?? nd.tradeVolume) || 0,
            };
            // 마지막 봉이 오늘이면 교체, 없으면 추가
            if (ohlcv.length && ohlcv[ohlcv.length - 1].date === todayStr) {
              ohlcv[ohlcv.length - 1] = todayCandle;
            } else {
              ohlcv.push(todayCandle);
            }
          }
        }
      } catch(e) { /* 네이버 보정 실패는 무시 */ }
    }

    return { ok: true, code, ohlcv };
  } catch (e) {
    return { ok: false, code, error: String(e) };
  }
}

// 챠트 OHLCV 함수 (신규 추가)
// ══════════════════════════════════════════════════════
async function fetchOHLCV(symbol, range, interval) {
  interval = interval || "1d";
  // 한국 종목: .KS(코스피)로 안 되면 .KQ(코스닥) 자동 재시도
  const result = await fetchOHLCVRaw(symbol, range, interval);
  if (result.ok && result.ohlcv && result.ohlcv.length >= 5) return result;
  // .KS 실패 → .KQ 시도 (또는 .KQ 실패 → .KS)
  if (/\.KS$/.test(symbol)) {
    const alt = await fetchOHLCVRaw(symbol.replace(/\.KS$/, ".KQ"), range, interval);
    if (alt.ok && alt.ohlcv && alt.ohlcv.length >= 5) return alt;
  } else if (/\.KQ$/.test(symbol)) {
    const alt = await fetchOHLCVRaw(symbol.replace(/\.KQ$/, ".KS"), range, interval);
    if (alt.ok && alt.ohlcv && alt.ohlcv.length >= 5) return alt;
  }
  return result;
}

async function fetchOHLCVRaw(symbol, range, interval) {
  interval = interval || "1d";
  const api = "https://query1.finance.yahoo.com/v8/finance/chart/" +
              encodeURIComponent(symbol) +
              "?interval=" + encodeURIComponent(interval) + "&range=" + encodeURIComponent(range);
  try {
    const res = await fetch(api, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return { ok: false, symbol, error: "yahoo " + res.status };
    const d = await res.json();
    const r = d?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    const ts = r?.timestamp;
    if (!q || !ts) return { ok: false, symbol, error: "no data" };

    const ohlcv = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open[i] == null || q.close[i] == null) continue;
      const date = new Date(ts[i] * 1000);
      const ymd = date.toISOString().slice(0, 10);
      ohlcv.push({
        date: ymd,
        open:   Math.round(q.open[i]   * 100) / 100,
        high:   Math.round(q.high[i]   * 100) / 100,
        low:    Math.round(q.low[i]    * 100) / 100,
        close:  Math.round(q.close[i]  * 100) / 100,
        volume: q.volume[i] || 0,
      });
    }
    // ── 이상 봉 감지: 마지막 봉이 직전 봉과 비정상적으로 차이나면 제거 ──
    //    (한국 주식 등락제한 ±30% → 그 이상은 야후 데이터 오류로 판단)
    while (ohlcv.length >= 2) {
      const last = ohlcv[ohlcv.length - 1];
      const prev = ohlcv[ohlcv.length - 2];
      if (!prev.close || !last.close) break;
      const ratio = last.close / prev.close;
      // 종가가 직전 대비 절반 이하이거나 2배 이상이면 이상값 → 마지막 봉 제거
      if (ratio < 0.5 || ratio > 2) {
        ohlcv.pop();
      } else {
        break;
      }
    }
    // 마지막 종가를 현재가로 보정 (단, 그 봉의 고저 범위·직전 종가를 크게 벗어나면 무시)
    const cur = r?.meta?.regularMarketPrice;
    if (cur != null && ohlcv.length >= 2) {
      const last = ohlcv[ohlcv.length - 1];
      const prev = ohlcv[ohlcv.length - 2];
      const lo = last.low, hi = last.high;
      const inBar = (lo != null && hi != null && cur >= lo * 0.5 && cur <= hi * 1.5);
      // 현재가가 직전 종가 대비 ±40% 이내이면서 봉 범위 안일 때만 보정
      const nearPrev = (prev.close && cur >= prev.close * 0.6 && cur <= prev.close * 1.4);
      if (inBar && nearPrev) {
        last.close = Math.round(cur * 100) / 100;
      }
    }
    const meta = r?.meta || {};
    // 야후가 인식한 실제 심볼 (요청과 다르면 티커 오류 가능성)
    const realSymbol = meta.symbol || symbol;
    const validSymbol = realSymbol.toUpperCase() === symbol.toUpperCase();
    return {
      ok: true,
      symbol,
      realSymbol,
      validSymbol,
      name: meta.longName || meta.shortName || symbol,
      shortName: meta.shortName || symbol,
      currency: meta.currency || '',
      exchange: meta.exchangeName || meta.fullExchangeName || '',
      ohlcv
    };
  } catch (e) {
    return { ok: false, symbol, error: String(e) };
  }
}

// 야후 종목 검색: 회사명/티커 → 후보 목록
async function yahooSearch(query) {
  const api = "https://query1.finance.yahoo.com/v1/finance/search?q=" +
              encodeURIComponent(query) + "&quotesCount=10&newsCount=0";
  try {
    const res = await fetch(api, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: 300 },
    });
    if (!res.ok) return { ok: false, error: "yahoo " + res.status };
    const d = await res.json();
    const quotes = d?.quotes || [];
    const items = [];
    for (const q of quotes) {
      // 주식/ETF만 (통화, 지수 제외 옵션)
      if (!q.symbol) continue;
      const type = q.quoteType || q.typeDisp || "";
      if (!/EQUITY|ETF|MUTUALFUND|INDEX/i.test(type)) continue;
      items.push({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange || "",
        type: type,
      });
      if (items.length >= 10) break;
    }
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ══════════════════════════════════════════════════════
// 기존 함수들 (변경 없음)
// ══════════════════════════════════════════════════════
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
    const cur = r?.meta?.regularMarketPrice;
    if (cur != null && pts.length) pts[pts.length - 1].c = round(cur, 2);
    return { ok: true, symbol, name: r?.meta?.shortName || symbol, points: pts };
  } catch (e) {
    return { ok: false, symbol, error: String(e) };
  }
}

async function one(symbol, fresh) {
  if (symbol === "FNG") return await fearGreed();
  const NV = { "KFUT": "FUT", "^KS11": "KOSPI", "^KQ11": "KOSDAQ", "^KS200": "KPI200" };
  if (NV[symbol]) return await naverFut(NV[symbol], symbol);
  if (symbol.startsWith("STK:")) return await naverStock(symbol.slice(4), fresh);
  if (symbol === "UST2Y") {
    const y = await yahoo("2YY=F", "UST2Y");
    if (y.ok && y.price != null) return y;
    return await naverBond("US2YT=RR", "UST2Y");
  }
  if (symbol === "DX-Y.NYB") {
    const y = await yahoo("DX-Y.NYB", "DX-Y.NYB");
    if (y.ok && y.price != null) return y;
    return await naverFx(".DXY", "DX-Y.NYB");
  }
  return await yahoo(symbol, symbol);
}

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
      ok: true, symbol, name: m.shortName || m.symbol || symbol,
      price, change: round(change, 2), rate: round(rate, 2),
      currency: m.currency || "", high52: m.fiftyTwoWeekHigh ?? null,
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
      ok: true, symbol: "FNG",
      name: "Fear & Greed (" + (fg.rating || "") + ")",
      price: score, change: round(change, 2), rate: round(rate, 2), currency: "",
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
        headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/marketindex/exchange/" + code },
        cf: { cacheTtl: 30 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.price ?? d.value;
      const changeRaw = d.compareToPreviousClosePrice ?? d.changeVal ?? d.change;
      const price = num(priceRaw), change = num(changeRaw);
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
    } catch (e) {}
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
        headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/marketindex/bond/" + code },
        cf: { cacheTtl: 30 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.price ?? d.value;
      const changeRaw = d.compareToPreviousClosePrice ?? d.changeVal ?? d.change;
      const price = num(priceRaw), change = num(changeRaw);
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
    } catch (e) {}
  }
  return { ok: false, symbol, error: "bond fail" };
}

// 국내 종목/ETF 배당수익률·수익률 (네이버 국내 API)
async function krInfo(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  const H = { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total" };
  const grab = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : null; };
  // 국내: m.stock.naver.com/api/stock/{code}/... (해외와 주소 다름)
  const urls = [
    "https://m.stock.naver.com/api/stock/" + code + "/integration",
    "https://m.stock.naver.com/api/stock/" + code + "/basic",
    "https://m.stock.naver.com/api/stock/" + code + "/etf/basic",
  ];
  let d = null, merged = {};
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: H, cf: { cacheTtl: 300 } });
      if (r.ok) { const j = await r.json(); if (j && Object.keys(j).length) { merged = Object.assign(merged, j); if (!d) d = j; } }
    } catch (e) {}
  }
  if (!Object.keys(merged).length) return { ok: false, code, error: "no data" };
  if (raw) return { ok: true, code, data: merged };
  let price = grab(merged.closePrice), rate = grab(merged.fluctuationsRatio);
  if (merged.compareToPreviousPrice && (merged.compareToPreviousPrice.code === "5" || merged.compareToPreviousPrice.code === "4") && rate != null) rate = -Math.abs(rate);
  // stockItemTotalInfos 또는 dealTrendInfos 등에서 수익률·배당 탐색
  let ret1 = null, ret3 = null, ret6 = null, ret12 = null, divYield = null, divAmt = null;
  const scan = o => {
    if (o == null || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) scan(x); return; }
    // {code, key, value} 패턴
    if (o.code && (o.value != null)) {
      const c = String(o.code), kk = String(o.key || "");
      if (/return1Month/i.test(c) || kk.includes("1개월")) { const g = grab(o.value); if (g != null) ret1 = ret1 ?? g; }
      if (/return3Month/i.test(c) || kk.includes("3개월")) { const g = grab(o.value); if (g != null) ret3 = ret3 ?? g; }
      if (/return6Month/i.test(c) || kk.includes("6개월")) { const g = grab(o.value); if (g != null) ret6 = ret6 ?? g; }
      if (/return1Year/i.test(c) || kk.includes("1년")) { const g = grab(o.value); if (g != null) ret12 = ret12 ?? g; }
      if (/dividend/i.test(c) && /yield|rate|ratio/i.test(c) || kk.includes("배당수익률") || kk.includes("분배율")) { const g = grab(o.value); if (g != null && g < 50) divYield = divYield ?? g; }
      if ((/^dividend$/i.test(c)) || kk.includes("배당금") || kk.includes("분배금")) { const g = grab(o.value); if (g != null) divAmt = divAmt ?? g; }
    }
    // 일반 필드
    for (const k of Object.keys(o)) {
      const kl = k.toLowerCase();
      if (divYield == null && /(dividendyieldratio|dividendyield|dividendrate)/i.test(kl)) { const g = grab(o[k]); if (g != null && g >= 0 && g < 50) divYield = g; }
    }
    for (const k of Object.keys(o)) if (typeof o[k] === "object") scan(o[k]);
  };
  scan(merged);
  return { ok: true, code, price, rate, ret1, ret3, ret6, ret12, divYield, divAmt };
}

async function krInfo_OLD(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  const H = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total" };
  const grab = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, "").replace(/[^0-9.\\-]/g, "")); return isFinite(n) ? n : null; };
  // 국내 ETF/종목: /etf/{code}/basic 우선 (수익률·배당수익률 포함), 실패 시 /stock/{code}/basic
  let d = null;
  for (const path of ["/etf/", "/stock/"]) {
    try {
      const r = await fetch("https://api.stock.naver.com" + path + code + "/basic", { headers: H, cf: { cacheTtl: 300 } });
      if (r.ok) { const j = await r.json(); if (j && (j.closePrice != null || (j.stockItemTotalInfos && j.stockItemTotalInfos.length))) { d = j; break; } }
    } catch (e) {}
  }
  if (!d) return { ok: false, code, error: "no data" };
  if (raw) return { ok: true, code, basic: d };
  let price = grab(d.closePrice), rate = grab(d.fluctuationsRatio);
  if (d.compareToPreviousPrice && (d.compareToPreviousPrice.code === "5" || d.compareToPreviousPrice.code === "4") && rate != null) rate = -Math.abs(rate);
  const infos = Array.isArray(d.stockItemTotalInfos) ? d.stockItemTotalInfos : [];
  const byCode = {}; const byKey = {};
  infos.forEach(it => { if (it && it.code) byCode[it.code] = it.value; if (it && it.key) byKey[it.key] = it.value; });
  const ret1 = grab(byCode.return1Month), ret3 = grab(byCode.return3Month), ret6 = grab(byCode.return6Month), ret12 = grab(byCode.return1Year);
  // 배당수익률: code 또는 한글 key(배당수익률/분배율)로 탐색
  let divYield = grab(byCode.dividendYieldRatio || byCode.dividendYield || byCode.dividendRate || byKey["배당수익률"] || byKey["분배율"] || byKey["배당률"]);
  const divAmt = grab(byCode.dividend || byKey["배당금"] || byKey["분배금"]);
  return { ok: true, code, price, rate, ret1, ret3, ret6, ret12, divYield, divAmt };
}

async function naverStock(code, fresh) {
  const u = "https://m.stock.naver.com/api/stock/" + code + "/basic";
  try {
    const res = await fetch(u, {
      headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total" },
      cf: fresh ? { cacheTtl: 0, cacheEverything: false } : { cacheTtl: 30 },
    });
    if (!res.ok) return { ok: false, symbol: "STK:" + code, error: "naver " + res.status };
    const d = await res.json();
    const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.tradePrice;
    const price = num(priceRaw);
    if (price == null) return { ok: false, symbol: "STK:" + code, error: "no price" };
    let rate = num(d.fluctuationsRatio ?? d.changeRate ?? d.rate);
    const cp = d.compareToPreviousPrice || {};
    const dir = String(cp.code || "") + "|" + String(cp.name || "");
    if (rate != null) {
      rate = Math.abs(rate);
      if (/[45]/.test(String(cp.code || "")) || /FALL|LOWER|DOWN/i.test(dir)) rate = -rate;
    }
    return {
      ok: true, symbol: "STK:" + code, name: d.stockName || code,
      price: round(price, 2), priceStr: priceRaw != null ? String(priceRaw) : null,
      rate: rate != null ? round(rate, 2) : null, currency: "KRW",
    };
  } catch (e) {
    return { ok: false, symbol: "STK:" + code, error: String(e) };
  }
}

async function naverTarget(code, raw) {
  const u = "https://m.stock.naver.com/api/stock/" + code + "/integration";
  try {
    const res = await fetch(u, {
      headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/domestic/stock/" + code + "/total" },
      cf: { cacheTtl: 300 },
    });
    if (!res.ok) return { ok: false, symbol: "STK:" + code, error: "naver " + res.status };
    const d = await res.json();
    if (raw) return { ok: true, raw: d };
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

    // 컨센서스 — 응답에 consensusInfo 가 따로 있다 (해외와 동일 구조)
    //   { createDate, recommMean:"4.04", priceTargetMean:"493,542" }
    const ci = d && d.consensusInfo ? d.consensusInfo : null;
    let cs = null;
    if (ci) {
      const rm = num(String(ci.recommMean ?? "").replace(/[^0-9.]/g, ""));
      if (rm != null && rm > 0 && rm <= 5) cs = rm;
      // 목표주가도 consensusInfo 쪽이 더 정확하므로 우선 사용
      const pt = num(String(ci.priceTargetMean ?? "").replace(/[^0-9.]/g, ""));
      if (pt != null && pt > 0) tp = pt;
    }
    const consOpinion = cs != null ? usOpinionFromScore(cs) : null;
    const consStr = cs != null ? (consOpinion + " " + cs.toFixed(2)) : null;
    const consDate = ci ? (ci.createDate || null) : null;

    return { ok: true, symbol: "STK:" + code, target: tp, targetStr: tp != null ? String(tp) : null,
             high52: hi, high52Str: hi != null ? String(hi) : null,
             consScore: cs, consOpinion, consStr, consDate };
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
        headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/domestic/index/" + code + "/total" },
        cf: { cacheTtl: 10 },
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (raw) return { ok: true, source: u, data: d };
      const priceRaw = d.closePrice ?? d.nowVal ?? d.currentPrice ?? d.tradePrice ?? d.price;
      const changeRaw = d.compareToPreviousClosePrice ?? d.changeVal ?? d.change;
      const price = num(priceRaw), change = num(changeRaw);
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
    } catch (e) {}
  }
  return { ok: false, symbol, error: "naver fail" };
}

async function marketCapTop(market, n, raw) {
  n = Math.max(1, Math.min(n || 100, 200));
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

// ══════════════════════════════════════
// 재무 3지표 — 매출증가율 · ROE · 부채비율 (최근 분기 순서대로)
//  naverRoe 와 같은 finance/quarter 응답을 쓰되 세 항목을 함께 뽑는다
// ══════════════════════════════════════
const FIN3_KEYS = [
  { k:'sales',  re:/(매출액|영업수익|매출)/,        exclude:/증가율|원가|총이익/ },
  { k:'roe',    re:/^ROE|자기자본이익률/i,          exclude:null },
  { k:'debt',   re:/(부채비율)/,                    exclude:null },
  // 저평가·현금창출력 판단용
  { k:'pbr',    re:/^PBR/i,                        exclude:null },
  { k:'per',    re:/^PER/i,                        exclude:/추정/ },
  { k:'profit', re:/(당기순이익)/,                  exclude:/지배|비지배/ },
  { k:'opm',    re:/(영업이익률)/,                  exclude:null },
  { k:'npm',    re:/(순이익률)/,                    exclude:null },
  { k:'quick',  re:/(당좌비율)/,                    exclude:null },
];

async function naverFin3(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok:false, error:"bad code" };
  const H = { "User-Agent": UA, "Accept":"application/json",
              "Referer":"https://m.stock.naver.com/domestic/stock/"+code+"/total" };
  let d = null, used = null;
  for (const u of ["https://m.stock.naver.com/api/stock/"+code+"/finance/quarter",
                   "https://m.stock.naver.com/api/stock/"+code+"/finance/annual"]) {
    try { const r = await fetch(u, { headers:H, cf:{cacheTtl:600} });
          if (r.ok) { const j = await r.json(); if (j && Object.keys(j).length) { d=j; used=u; break; } } } catch(e){}
  }
  if (!d) return { ok:false, code, error:"no data" };
  if (raw) return { ok:true, code, source:used, raw:d };

  const fi = d.financeInfo || d.financeData || d.result || d;
  const tt = fi.trTitleList || fi.titleList || fi.periodList || fi.columns;
  let periods = [];
  if (Array.isArray(tt)) periods = tt.map(x => (typeof x==="string" ? x : (x.key||x.title||x.value||x.yymm))).filter(Boolean);
  const numf = v => { const n = parseFloat(String(v==null?"":v).replace(/[^0-9.\-]/g,"")); return isFinite(n)?n:null; };

  // 행에서 값 배열 뽑기
  const seriesOf = (row) => {
    const cols = row.columns || row.column || row.values || row.valueList || row.data;
    const out = [];
    if (cols && !Array.isArray(cols)) {
      const keys = periods.length ? periods : Object.keys(cols);
      keys.forEach(k => { const c = cols[k]; out.push(numf(c && (c.value!=null ? c.value : c))); });
    } else if (Array.isArray(cols)) {
      cols.forEach(c => out.push(numf(c && typeof c==="object" ? (c.value!=null?c.value:c.val) : c)));
    }
    return out;
  };
  const rows = [];
  const dig = o => {
    if (o==null) return;
    if (Array.isArray(o)) { o.forEach(dig); return; }
    if (typeof o!=="object") return;
    const t = String(o.title||o.titleKor||o.name||o.acctNm||"").replace(/\s/g,"");
    if (t && (o.columns||o.values||o.valueList||o.data)) rows.push({ t, s:seriesOf(o) });
    Object.keys(o).forEach(k => dig(o[k]));
  };
  dig(fi);

  const pick = (spec) => {
    for (const r of rows) {
      if (spec.exclude && spec.exclude.test(r.t)) continue;
      if (spec.re.test(r.t) && r.s.some(v=>v!=null)) return r;
    }
    return null;
  };
  const got = {};
  FIN3_KEYS.forEach(spec => { const r = pick(spec); if (r) got[spec.k] = { title:r.t, series:r.s }; });

  // 매출은 증가율로 변환 (전기 대비 %)
  let salesGrowth = null;
  if (got.sales) {
    const a = got.sales.series;
    salesGrowth = a.map((v,i) => (i===0 || v==null || a[i-1]==null || a[i-1]===0) ? null
                                : Math.round(((v-a[i-1])/Math.abs(a[i-1]))*1000)/10);
  }
  return {
    ok: true, code, source: used, periods,
    salesTitle: got.sales ? got.sales.title : null,
    sales:      got.sales ? got.sales.series : null,
    salesGrowth,
    roe:    got.roe    ? got.roe.series    : null,
    debt:   got.debt   ? got.debt.series   : null,
    pbr:    got.pbr    ? got.pbr.series    : null,
    per:    got.per    ? got.per.series    : null,
    profit: got.profit ? got.profit.series : null,
    opm:    got.opm    ? got.opm.series    : null,
    npm:    got.npm    ? got.npm.series    : null,
    quick:  got.quick  ? got.quick.series  : null,
    rowTitles: rows.map(r=>r.t).slice(0, 30),
  };
}

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

async function naverFutInvestor(url_raw_dbg) {
  const u = "https://finance.naver.com/sise/sise_trans_style.naver?sosok=03";
  let html = null;
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://finance.naver.com/sise/" } });
    if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
  } catch (e) {}
  if (!html) return { ok: false, error: "no html" };
  const txt = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (url_raw_dbg) {
    const iF = txt.indexOf("외국인"), iT = txt.search(/\d{1,2}:\d{2}/), iS = txt.indexOf("시간별"), iG = txt.indexOf("개인");
    return { ok: true, len: html.length, txtLen: txt.length, idxForeign: iF, idxTime: iT, idxSiganbyeol: iS, idxGaein: iG, hasAjax: /ajax|investorJson|sise_trans|getJson|\.json/i.test(html), sliceForeign: iF >= 0 ? txt.slice(iF - 10, iF + 260) : null, sliceGaein: iG >= 0 ? txt.slice(iG - 10, iG + 260) : null };
  }
  const rowRe = /(\d{1,2}:\d{2})\s+([\-−]?[\d,]+)\s+([\-−]?[\d,]+)/g;
  let mm, first = null;
  while ((mm = rowRe.exec(txt)) !== null) { first = mm; break; }
  let foreign = null, gaein = null, time = null;
  if (first) { time = first[1]; gaein = parseInt(first[2].replace(/,/g, "").replace("−", "-")); foreign = parseInt(first[3].replace(/,/g, "").replace("−", "-")); }
  return { ok: true, time, gaein, foreign };
}

async function foreignDir(raw) {
  const [ewy, krw, k200] = await Promise.all([yahoo("EWY", "EWY"), yahoo("KRW=X", "USDKRW"), yahoo("^KS200", "^KS200")]);
  if (raw) return { ok: true, ewy, krw, k200 };
  const e = ewy && ewy.ok ? ewy.rate : null, w = krw && krw.ok ? krw.rate : null;
  let score = 0, parts = 0;
  if (e != null) { score += e; parts++; }
  if (w != null) { score += -0.5 * w; parts++; }
  const verdict = parts ? (score > 0.3 ? "up" : (score < -0.3 ? "down" : "flat")) : "na";
  return { ok: true, ewyRate: e, ewyPrice: ewy && ewy.ok ? ewy.price : null, ewyChange: ewy && ewy.ok ? ewy.change : null, krwRate: w, krwPrice: krw && krw.ok ? krw.price : null, krwChange: krw && krw.ok ? krw.change : null, k200: k200 && k200.ok ? k200.price : null, score: round(score, 2), verdict };
}

function kstYmd(off) {
  const n = new Date();
  const k = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 9 * 3600000);
  if (off) k.setDate(k.getDate() - off);
  return "" + k.getFullYear() + String(k.getMonth() + 1).padStart(2, "0") + String(k.getDate()).padStart(2, "0");
}

async function krxPost(bld, extra) {
  const params = new URLSearchParams(Object.assign({ bld: bld, locale: "ko_KR", csvxls_isNo: "false" }, extra || {}));
  try {
    const r = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
      method: "POST",
      headers: { "User-Agent": UA, "Referer": "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Accept": "application/json" },
      body: params.toString(),
    });
    if (r.ok) return await r.json();
  } catch (e) {}
  return null;
}

async function foreignFutures(days, raw) {
  const td = kstYmd(1);
  const cands = [
    { bld: "dbms/MDC/STAT/standard/MDCSTAT12701", extra: { trdDd: td, prodId: "KRDRVFUK2I" } },
    { bld: "dbms/MDC/STAT/standard/MDCSTAT12701", extra: { trdDd: td } },
    { bld: "dbms/MDC/STAT/standard/MDCSTAT12801", extra: { trdDd: td } },
    { bld: "dbms/MDC/STAT/standard/MDCSTAT13001", extra: { strtDd: kstYmd(12), endDd: td, prodId: "KRDRVFUK2I" } },
  ];
  const probe = [];
  for (const c of cands) {
    const j = await krxPost(c.bld, c.extra);
    const rows = j && (j.output || j.OutBlock_1 || j.block1 || j.list);
    probe.push({ bld: c.bld, extra: c.extra, keys: j ? Object.keys(j) : null, rows: rows ? rows.length : 0 });
    if (j && rows && rows.length) {
      if (raw) return { ok: true, hit: c.bld, extra: c.extra, sample: rows.slice(0, 6), allKeys: Object.keys(j) };
      return { ok: true, hit: c.bld, rowsCount: rows.length, note: "파싱 대기: ?ffut=1&raw=1 결과 확인 필요" };
    }
  }
  if (raw) return { ok: false, td: td, probe: probe };
  return { ok: false, error: "krx no data", td: td };
}

async function foreignSpotPos(days, raw) {
  let curK = null, src = null;
  try { const y = await yahoo("^KS200", "^KS200"); if (y && y.ok && y.price != null) { curK = round(y.price, 2); src = "yahoo:^KS200"; } } catch (e) {}
  if (curK == null) {
    try {
      const r = await fetch("https://finance.naver.com/sise/sise_index.naver?code=KPI200", { headers: { "User-Agent": UA, "Referer": "https://finance.naver.com/" } });
      if (r.ok) { const buf = await r.arrayBuffer(); let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } if (raw) return { ok: true, source: "naver", raw: html.slice(0, 3000) }; const m = html.match(/id="now_value"[^>]*>\s*([0-9,]+\.\d{2})/) || html.match(/(\d{3,4}\.\d{2})/); if (m) { curK = parseFloat(m[1].replace(/,/g, "")); src = "naver:KPI200"; } }
    } catch (e) {}
  }
  if (raw) return { ok: true, curK, src };
  return { ok: true, curK, source: src, netValue: null, avgK: null, note: "현물 누적순매수·평균지수는 KRX 투자자별 데이터가 필요해 수동 입력 권장(현재지수만 자동)" };
}

async function daumForeignFutures(raw) {
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", "Accept": "application/json, text/plain, */*", "Referer": "https://finance.daum.net/domestic/investors/DERIVATIVES" };
  // 누적(당일 합계) = days 우선 → 네이버 당일 누적과 일치
  const url2 = "https://finance.daum.net/api/investor/future/days?page=1&perPage=1&terms=days&pagination=true";
  let d2 = null, status2 = 0;
  try { const r2 = await fetch(url2, { headers, cf:{cacheTtl:0} }); status2 = r2.status; if (r2.ok) d2 = await r2.json(); } catch (e) { status2 = -1; }
  if (d2 && d2.data && d2.data[0]) {
    const row = d2.data[0];
    if (raw) return { ok: true, source: "days", status2, raw: d2 };
    return { ok: true, time: row.date, foreign: row.foreignSettlement, private: row.privateSettlement, institution: row.institutionalSettlement, source: "days(누적)" };
  }
  // days 실패 시 times(시각별 순간값)로 폴백
  const url1 = "https://finance.daum.net/api/investor/future/times?page=1&perPage=1&terms=times&pagination=true";
  let d = null, status = 0;
  try { const r = await fetch(url1, { headers, cf:{cacheTtl:0} }); status = r.status; if (r.ok) d = await r.json(); } catch (e) { status = -1; }
  if (raw) return { ok: !!d, status, status2, raw1: d, raw2: d2 };
  if (d && d.data && d.data[0]) {
    const row = d.data[0];
    return { ok: true, time: row.date, foreign: row.foreignSettlement, private: row.privateSettlement, institution: row.institutionalSettlement, source: "times(순간)" };
  }
  return { ok: false, status, status2, error: "no data" };
}

async function daumFutProbe(raw) {
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", "Accept": "application/json, text/plain, */*", "Referer": "https://finance.daum.net/domestic/investors/DERIVATIVES", "Origin": "https://finance.daum.net" };
  const url = "https://finance.daum.net/api/investor/future/times?page=1&perPage=10&terms=times&pagination=true";
  let status = 0, body = null, ctype = "";
  try { const r = await fetch(url, { headers }); status = r.status; ctype = r.headers.get("content-type") || ""; const t = await r.text(); try { body = JSON.parse(t); } catch (e) { body = t.slice(0, 500); } } catch (e) { status = -1; body = String(e).slice(0, 200); }
  if (raw) return { ok: true, url, status, ctype, body };
  return { ok: true, url, status, ctype, bodyPreview: (typeof body === "string") ? body : JSON.stringify(body).slice(0, 800) };
}

async function nightFutExt(raw) {
  const cands = [
    { url: "https://api.investing.com/api/financialdata/8873/historical/chart/?interval=PT1M&pointscount=60", tag: "investing-api-kospi200fut" },
    { url: "https://www.investing.com/indices/kospi-200-futures", tag: "investing-www" },
    { url: "https://kr.investing.com/indices/kospi-200-futures", tag: "investing-kr" },
    { url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EKS200?interval=1m&range=1d", tag: "yahoo-ks200" },
  ];
  const out = [];
  for (const c of cands) {
    let status = 0, len = 0, hasPrice = false, snippet = "", ctype = "";
    try {
      const r = await fetch(c.url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", "Accept": "text/html,application/json,*/*", "Accept-Language": "en-US,en;q=0.9" } });
      status = r.status; ctype = r.headers.get("content-type") || "";
      const t = await r.text(); len = t.length;
      hasPrice = /"last"|"price"|regularMarketPrice|"close"|data-test="instrument-price/i.test(t);
      const mi = t.search(/"last"|regularMarketPrice|instrument-price-last|"close"/i);
      snippet = mi >= 0 ? t.slice(Math.max(0, mi - 40), mi + 160).replace(/\s+/g, " ") : t.slice(0, 160).replace(/\s+/g, " ");
    } catch (e) { status = -1; snippet = String(e).slice(0, 120); }
    out.push({ tag: c.tag, status, ctype: ctype.slice(0, 40), len, hasPrice, snippet: snippet.slice(0, 220) });
  }
  return { ok: true, probes: out };
}

async function nightFutProbe(raw) {
  const api = c => "https://m.stock.naver.com/api/index/" + c + "/basic";
  const codes = ["FUT", "NFUT", "FUTN", "NKF", "KLF", "KPF", "K2F", "KPI200F", "CMEFUT", "KOSPI200F"];
  const out = [];
  for (const c of codes) {
    let d = null, status = 0;
    try { const r = await fetch(api(c), { headers: { "User-Agent": UA, "Accept": "application/json" }, cf: { cacheTtl: 5 } }); status = r.status; if (r.ok) d = await r.json(); } catch (e) { status = -1; }
    if (d && (d.closePrice != null || d.nowVal != null)) {
      out.push({ code: c, status, name: d.stockName || d.indexName || null, price: d.closePrice ?? d.nowVal ?? null, tradedAt: d.localTradedAt || d.tradeDate || d.tradeTime || null });
    } else { out.push({ code: c, status, name: null }); }
  }
  if (raw) {
    let basic = null, integ = null;
    try { const r = await fetch(api("FUT"), { headers: { "User-Agent": UA, "Accept": "application/json" } }); if (r.ok) basic = await r.json(); } catch (e) {}
    try { const r = await fetch("https://m.stock.naver.com/api/index/FUT/integration", { headers: { "User-Agent": UA, "Accept": "application/json" } }); if (r.ok) integ = await r.json(); } catch (e) {}
    const integStr = integ ? JSON.stringify(integ) : "";
    const nightIdx = integStr.search(/야간|night|Night/);
    return { ok: true, basicKeys: basic ? Object.keys(basic) : null, basic_name: basic ? (basic.stockName || basic.indexName) : null, basic_price: basic ? (basic.closePrice ?? basic.nowVal) : null, basic_tradedAt: basic ? (basic.localTradedAt || basic.tradeDate || basic.tradeTime || null) : null, integ_hasNight: nightIdx >= 0, integ_nightSnippet: nightIdx >= 0 ? integStr.slice(Math.max(0, nightIdx - 120), nightIdx + 200) : null, integKeys: integ ? Object.keys(integ) : null };
  }
  return { ok: true, probes: out };
}

async function naverInvestorDay(raw, sosok) {
  const ymd = kstYmd(0);
  const mk = (sosok === "02" || sosok === "kosdaq") ? "02" : "01";
  const url = "https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=" + ymd + "&sosok=" + mk;
  let html = null, status = 0;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/sise/investorDealTrend.naver" } });
    status = r.status;
    if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
  } catch (e) { status = -1; }
  if (raw) { let s = html ? html.search(/<table/) : -1; return { ok: !!html, url, raw: html ? html.slice(s < 0 ? 0 : s, (s < 0 ? 0 : s) + 6500) : null }; }
  if (!html) return { ok: false, status, error: "no data" };
  const rowRe = /<td class="date2?">(\d{2}\.\d{2}\.\d{2})<\/td>([\s\S]*?)(?=<td class="date2?">|<\/table>)/g;
  const parseNums = (chunk) => [...chunk.matchAll(/<td[^>]*>\s*([-−]?[\d,]+)\s*<\/td>/g)].map(m => parseInt(m[1].replace(/,/g, "").replace("−", "-"), 10)).filter(n => isFinite(n));
  let m, first = null;
  while ((m = rowRe.exec(html)) !== null) { const nums = parseNums(m[2]); if (nums.length >= 3) { first = { date: m[1], nums }; break; } }
  if (!first) return { ok: false, status, error: "parse fail" };
  const n = first.nums;
  return { ok: true, date: first.date, gaein: n[0], foreign: n[1], inst: n[2] };
}

async function naverForeignProgram(raw) {
  const ymd = kstYmd(0);
  const cands = [
    "https://finance.naver.com/sise/sise_trans_style.naver?sosok=01",
    "https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=" + ymd + "&sosok=01&investor=9000",
    "https://finance.naver.com/sise/programDealTrendDay.naver?bizdate=" + ymd + "&sosok=01&investor=9000",
    "https://finance.naver.com/sise/frgnEtc.naver",
  ];
  const out = [];
  for (const u of cands) {
    let html = null, status = 0;
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/sise/" } });
      status = r.status;
      if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
    } catch (e) { status = -1; }
    const has비차익 = html ? /비차익/.test(html) : false;
    const has외국인 = html ? /외국인/.test(html) : false;
    const hasAjax = html ? /ajax|\.json|XMLHttpRequest|idxTime/i.test(html) : false;
    let snippet = "";
    if (html) { const idx = has비차익 ? html.indexOf("비차익") : (has외국인 ? html.indexOf("외국인") : 0); snippet = html.slice(Math.max(0, idx - 100), idx + 400).replace(/\s+/g, " ").slice(0, 460); }
    out.push({ url: u, status, len: html ? html.length : 0, has외국인, has비차익, hasAjax, snippet });
    if (raw && html && has비차익 && has외국인) { let s = html.search(/<table/); return { ok: true, best: u, raw: html.slice(s < 0 ? 0 : s, (s < 0 ? 0 : s) + 6500) }; }
  }
  return { ok: true, ymd, probes: out };
}

async function naverProgram(raw) {
  const ymd = kstYmd(0);
  const url = "https://finance.naver.com/sise/programDealTrendDay.naver?bizdate=" + ymd + "&sosok=";
  let html = null, status = 0;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/sise/sise_program.naver" } });
    status = r.status;
    if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
  } catch (e) { status = -1; }
  if (raw) { let s = html ? html.search(/<table/) : -1; return { ok: !!html, url, raw: html ? html.slice(s < 0 ? 0 : s, (s < 0 ? 0 : s) + 6500) : null }; }
  if (!html) return { ok: false, status, error: "no data" };
  const rowRe = /<td class="date">(\d{2}\.\d{2}\.\d{2})<\/td>([\s\S]*?)(?=<td class="date">|<\/table>)/g;
  const parseNums = (chunk) => [...chunk.matchAll(/<td[^>]*>\s*([-−]?[\d,]+)\s*<\/td>/g)].map(m => parseInt(m[1].replace(/,/g, "").replace("−", "-"), 10)).filter(n => isFinite(n));
  let m, first = null;
  while ((m = rowRe.exec(html)) !== null) { const nums = parseNums(m[2]); if (nums.length >= 9) { first = { date: m[1], nums }; break; } }
  if (!first) return { ok: false, status, error: "parse fail" };
  const n = first.nums;
  return { ok: true, date: first.date, arbNet: n[2], nonArbNet: n[5], totalNet: n[8] };
}

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
    const closeTxt = (tds[1] || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
    const closePrice = parseInt(closeTxt.replace(/[^0-9]/g, ""), 10) || 0;
    const cell = tds[6];
    const cls = ((cell.match(/class="([^"]*)"/) || [])[1] || "");
    const txt = cell.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
    const n = parseInt(txt.replace(/[^0-9]/g, ""), 10) || 0;
    let buy;
    if (/-|–|−/.test(txt)) buy = false;
    else if (/red/.test(cls)) buy = true;
    else if (/nv|blue/.test(cls)) buy = false;
    else buy = n > 0;
    const isBuy = !!(buy && n > 0);
    const qty = isBuy ? n : -n;
    // 보유비율 (tds[8])
    const ratioTxt = (tds[8] || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|\s|,/g, "");
    const ratio = parseFloat(ratioTxt.replace(/[^0-9.]/g, "")) || 0;
    rows.push({ date: dm[0], buy: isBuy, qty, close: closePrice, amt: qty * closePrice, ratio });
    if (rows.length >= 10) break;
  }
  const last10 = rows.slice(0, 10).reverse();
  const seq = last10.map(d => d.buy);
  const net = last10.map(d => d.qty);
  const amt = last10.map(d => d.amt);
  const ratio = last10.map(d => d.ratio);
  return { ok: true, code, seq, net, amt, ratio, days: last10, count: seq.filter(Boolean).length };
}

// 외국인 일별 순매수 수량(차트 보조지표용) - finance.naver.com/item/frgn.naver 페이지네이션 순회

// 네이버 차트 데이터 (일봉/주봉/월봉)
// URL: https://api.finance.naver.com/siseJson.naver?symbol=CODE&requestType=1&startTime=FROM&endTime=TO&timeframe=day
// 미국(해외) 종목 네이버 차트: 티커 → reutersCode → 네이버 해외주식 차트 API
async function naverWorldChart(ticker, timeframe, days, raw) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  const link = await naverWorldUrl(ticker, null);
  let code = link && link.ok ? link.reutersCode : null;
  if (!code) return { ok: false, ticker, error: "no reutersCode" };
  const tf = { "1d": "day", "1wk": "week", "1mo": "month", "day": "day", "week": "week", "month": "month" }[timeframe] || "day";
  // 기간: days(거래일)에 여유 배수. 시작/종료일 명시해야 여러 날짜가 옴
  const now = new Date();
  const end = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
  const back = new Date(now.getTime() - (days || 400) * 1.6 * 86400000);  // 거래일→달력일 여유
  const start = back.getFullYear() + String(back.getMonth() + 1).padStart(2, "0") + String(back.getDate()).padStart(2, "0");
  const url = "https://api.stock.naver.com/chart/foreign/item/" + encodeURIComponent(code) + "/" + tf + "?startDateTime=" + start + "&endDateTime=" + end;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/worldstock/stock/" + code + "/total" }, cf: { cacheTtl: 300 } });
    if (!r.ok) return { ok: false, ticker, reutersCode: code, error: "chart " + r.status };
    const arr = await r.json();
    if (raw) return { ok: true, ticker, reutersCode: code, sample: JSON.stringify(arr).slice(0, 1000) };
    if (!Array.isArray(arr) || !arr.length) return { ok: false, ticker, reutersCode: code, error: "empty" };
    const data = [];
    arr.forEach(o => {
      if (!o || typeof o !== "object") return;
      const dr = String(o.localDate || "").replace(/[^0-9]/g, "");
      if (dr.length < 8) return;
      const date = dr.slice(0, 4) + "-" + dr.slice(4, 6) + "-" + dr.slice(6, 8);
      const open = parseFloat(o.openPrice), high = parseFloat(o.highPrice), low = parseFloat(o.lowPrice), close = parseFloat(o.closePrice);
      const vol = parseFloat(o.accumulatedTradingVolume) || 0;
      if (open > 0 && high > 0 && low > 0 && close > 0) data.push({ date, open, high, low, close, volume: vol });
    });
    if (data.length < 2) return { ok: false, ticker, reutersCode: code, error: "no valid rows" };
    data.sort((a, b) => a.date < b.date ? -1 : 1);
    const sliced = days ? data.slice(-days) : data;
    return { ok: true, data: sliced, reutersCode: code, source: "naver_world" };
  } catch (e) {
    return { ok: false, ticker, reutersCode: code, error: String(e) };
  }
}
// 네이버 siseJson 은 지수도 지원한다 (KOSPI / KOSDAQ / KPI200)
const NV_IDX_CHART = { "KOSPI": "KOSPI", "KOSDAQ": "KOSDAQ", "KPI200": "KPI200",
                       "^KS11": "KOSPI", "^KQ11": "KOSDAQ", "^KS200": "KPI200",
                       "FUT": "FUT", "KFUT": "FUT" };   // 코스피200 선물(연결)

async function naverChartData(code, timeframe, days, raw) {
  const up = String(code || "").trim().toUpperCase();
  if (NV_IDX_CHART[up]) {
    code = NV_IDX_CHART[up];                       // 지수는 문자 심볼 그대로
  } else {
    code = up.replace(/[^0-9]/g, "");
    if (code.length !== 6) return { ok: false, error: "bad code" };
  }
  const tf = { "1d": "day", "1wk": "week", "1mo": "month", "day": "day", "week": "week", "month": "month" }[timeframe] || "day";
  const mult = tf === "month" ? 30 : tf === "week" ? 7 : 1;
  const endDd = kstYmd(0);
  const startDd = kstYmd(Math.min(days * mult + 10, 3650));
  const url = "https://api.finance.naver.com/siseJson.naver?symbol=" + code + "&requestType=1&startTime=" + startDd + "&endTime=" + endDd + "&timeframe=" + tf;

  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/item/fchart.nhn?code=" + code }
    });
    if (!r.ok) return { ok: false, status: r.status };
    let text = await r.text();
    if (raw) return { ok: true, source: "naver_chart", url, sample: text.slice(0, 2000) };

    // 파싱: JavaScript 배열 형식 → JSON
    // 형식: [["날짜", "시가", "고가", "저가", "종가", "거래량", "외국인소진율"]\n,["20260710", 1584000, ...]\n, ...]
    text = text.replace(/'/g, '"').trim();
    if (text.endsWith(",")) text = text.slice(0, -1);
    if (!text.startsWith("[")) text = "[" + text + "]";
    // 각 행 파싱: ["20260710", 시가, 고가, 저가, 종가, 거래량, ...]
    // 날짜는 따옴표 유무 모두 허용, 숫자는 음수·소수 허용
    const rowRe = /\[\s*"?(\d{8})"?\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g;
    let m, data = [];
    while ((m = rowRe.exec(text)) !== null) {
      const dt = m[1];
      const o = parseFloat(m[2]), hi = parseFloat(m[3]), lo = parseFloat(m[4]), cl = parseFloat(m[5]);
      // 유효성: OHLC가 모두 양수여야 함
      if (!(o > 0 && hi > 0 && lo > 0 && cl > 0)) continue;
      const date = dt.slice(0,4) + "-" + dt.slice(4,6) + "-" + dt.slice(6,8);
      data.push({ date, open: o, high: hi, low: lo, close: cl, volume: parseFloat(m[6]) || 0 });
    }
    if (!data.length) return { ok: false, error: "no data parsed", sampleText: text.slice(0, 500) };
    // 날짜 오름차순 정렬 보장
    data.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return { ok: true, code, source: "naver", timeframe: tf, count: data.length, data };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  }
}

async function naverForeignDaily(code, days, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  days = Math.max(20, Math.min(days || 120, 500));
  const perPage = 10; // 네이버 frgn 페이지 1페이지당 약 10행
  const pages = Math.ceil(days / perPage) + 1;
  const out = new Map(); // date -> {net, amt}
  for (let p = 1; p <= pages; p++) {
    const u = "https://finance.naver.com/item/frgn.naver?code=" + code + "&page=" + p;
    let html = null;
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/item/frgn.naver?code=" + code } });
      if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
    } catch (e) {}
    if (!html) break;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rm, gotAny = false;
    while ((rm = rowRe.exec(html)) !== null) {
      const rh = rm[1];
      const dm = rh.match(/(\d{4})\.(\d{2})\.(\d{2})/);
      if (!dm) continue;
      const tds = [...rh.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
      if (tds.length < 7) continue;
      // raw 프로브
      if (raw) {
        if (out.size < 3) {
          const cleaned = tds.map((t,i) => i+':'+t.replace(/<[^>]*>/g,'').replace(/&nbsp;|\s/g,'').trim());
          out.set(dm[0].replace(/\./g,'-'), { raw: cleaned, tdCount: tds.length, html5: (tds[5]||'').slice(0,200), html7: (tds[7]||'').slice(0,200), html8: (tds[8]||'').slice(0,200) });
        }
        continue;
      }
      const closeTxt = (tds[1] || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
      const closePrice = parseInt(closeTxt.replace(/[^0-9]/g, ""), 10) || 0;
      const cell = tds[6]; // 외국인 순매매량 컬럼
      const cls = ((cell.match(/class="([^"]*)"/) || [])[1] || "");
      const txt = cell.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
      let n = parseInt(txt.replace(/[^0-9]/g, ""), 10) || 0;
      const isNeg = /-|–|−/.test(txt) || /nv|blue/.test(cls);
      if (isNeg) n = -n;
      // 기관 순매매 (tds[5])
      const instCell = tds[5] || "";
      const instCls = ((instCell.match(/class="([^"]*)"/) || [])[1] || "");
      const instTxt = instCell.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s|,/g, "");
      let instN = parseInt(instTxt.replace(/[^0-9]/g, ""), 10) || 0;
      if (/-|–|−/.test(instTxt) || /nv|blue|red/.test(instCls)) instN = -instN;
      // 외국인 보유주수 (tds[7]) + 보유율 (tds[8])
      const holdTxt = (tds[7] || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|\s|,/g, "");
      const hold = parseInt(holdTxt.replace(/[^0-9]/g, ""), 10) || 0;
      const ratioTxt = (tds[8] || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|\s|,/g, "");
      const ratio = parseFloat(ratioTxt.replace(/[^0-9.]/g, "")) || 0;
      const dateStr = dm[0].replace(/\./g, "-");
      if (!out.has(dateStr)) { out.set(dateStr, { net: n, amt: n * closePrice, inst: instN, hold, ratio }); gotAny = true; }
    }
    if (!gotAny) break; // 더 이상 데이터 없으면 중단
    if (out.size >= days) break;
  }
  // 날짜 오름차순 정렬
  const arr = [...out.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-days);
  if (raw) return { ok: true, code, source: "frgn_probe", data: arr.map(([date, v]) => ({ date, ...v })) };
  return { ok: true, code, data: arr.map(([date, v]) => ({ date, net: v.net, amt: v.amt, inst: v.inst || 0, hold: v.hold || 0, ratio: v.ratio || 0 })) };
}

function decodeEnt(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}

async function naverReport(code, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, error: "bad code" };
  const u = "https://finance.naver.com/research/company_list.naver?searchType=itemCode&itemCode=" + code + "&page=1";
  let html = null;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/research/company_list.naver" } });
    if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
  } catch (e) {}
  if (!html) return { ok: false, code, error: "no data" };
  if (raw) return { ok: true, code, url: u, raw: html.slice(0, 4500) };
  let title = null, date = null, ymd = null, broker = null, nid = null, pdf = null;
  const re = /company_read\.naver\?nid=(\d+)[^"']*itemCode=(\d{6})[^"']*["'][^>]*>\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[2] === code) {
      nid = m[1]; title = decodeEnt(m[3].trim());
      const idx = m.index, rowEnd = html.indexOf("</tr>", idx);
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
  if (!title) {
    const tm = html.match(/company_read\.naver\?nid=(\d+)[^"']*["'][^>]*>\s*([^<]+?)\s*</);
    if (tm) {
      nid = tm[1]; title = decodeEnt(tm[2].trim());
      const idx = html.indexOf(tm[0]), rowEnd = html.indexOf("</tr>", idx);
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

// 미국(해외) 종목 종합: ROE·52주최고가·목표가·뉴스
// 네이버 해외종목 API 진단 — 어느 주소에 시세·수익률이 있는지 찾기
async function usDiag(ticker) {
  ticker = String(ticker || "").trim().toUpperCase();
  const bare = ticker.split(".")[0];
  const link = await naverWorldUrl(ticker, null);
  const acCode = link && link.ok ? link.reutersCode : null;
  const out = { acReutersCode: acCode };
  // 접미사별로 basic·price·chart 테스트
  for (const suf of ["O", "K", "P", "A", "N"]) {
    const code = bare + "." + suf;
    const res = {};
    for (const [label, u] of [
      ["etfBasic", "https://api.stock.naver.com/etf/" + code + "/basic"],
      ["price", "https://api.stock.naver.com/stock/" + code + "/price"],
      ["chart", "https://api.stock.naver.com/chart/foreign/item/" + code + "/day?startDateTime=20260701&endDateTime=20260801"],
    ]) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" } });
        let bodyLen = 0, sample = null;
        if (r.ok) { const t = await r.text(); bodyLen = t.length; sample = t.slice(0, 120); }
        res[label] = { status: r.status, len: bodyLen, sample };
      } catch (e) { res[label] = { error: String(e).slice(0, 60) }; }
    }
    out[code] = res;
  }
  return { ok: true, ticker, results: out };
}

async function usDiag_OLD(ticker) {
  ticker = String(ticker || "").trim().toUpperCase();
  const link = await naverWorldUrl(ticker, null);
  const code = link && link.ok ? link.reutersCode : null;
  if (!code) return { ok: false, ticker, error: "no reutersCode" };
  const cands = [
    "https://api.stock.naver.com/etf/" + code + "/basic",
    "https://api.stock.naver.com/stock/" + code + "/basic",
    "https://api.stock.naver.com/stock/" + code + "/price",
    "https://polling.finance.naver.com/api/realtime/worldstock/stock/" + code,
  ];
  const out = {};
  for (const u of cands) {
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/worldstock/etf/" + code + "/total" } });
        if (r.status === 409 || r.status === 429) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; }
        out[u] = { status: r.status, attempts: attempt + 1, body: r.ok ? JSON.stringify(await r.json()).slice(0, 700) : null };
        done = true;
      } catch (e) { out[u] = { error: String(e) }; done = true; }
    }
    if (!done) out[u] = { status: 409, note: "409 persisted after retries" };
  }
  return { ok: true, ticker, reutersCode: code, results: out };
}

// 야후 기반 미국 ETF/종목 종합: 현재가·수익률·배당 (네이버에 없는 종목용)
async function usInfoYahoo(ticker) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  try {
    // 1년치 일봉 + 배당 이벤트
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?interval=1d&range=2y&events=div";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, cf: { cacheTtl: 3600 } });
    if (!r.ok) return { ok: false, ticker, error: "yahoo " + r.status };
    const j = await r.json();
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res) return { ok: false, ticker, error: "no result" };
    const ts = res.timestamp || [];
    const q = res.indicators && res.indicators.quote && res.indicators.quote[0];
    const adj = res.indicators && res.indicators.adjclose && res.indicators.adjclose[0];
    // 수익률은 '주가 수익률'이므로 실제 종가(q.close)를 쓴다.
    //  adjclose(수정주가)는 배당 지급 시 과거 가격을 소급 하향해서
    //  그대로 계산하면 배당수익률이 더해진 총수익률이 된다.
    const closes = (q && q.close) || (adj && adj.adjclose) || [];
    const meta = res.meta || {};
    // 유효 종가 배열 구성
    const data = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c != null && isFinite(c)) {
        const d = new Date(ts[i] * 1000);
        const date = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
        data.push({ date, close: c, open: q && q.open ? q.open[i] : c, high: q && q.high ? q.high[i] : c, low: q && q.low ? q.low[i] : c, volume: q && q.volume ? q.volume[i] : 0 });
      }
    }
    if (data.length < 2) return { ok: false, ticker, error: "no data" };
    const last = data[data.length - 1].close;
    const prev = meta.chartPreviousClose || meta.previousClose || (data.length >= 2 ? data[data.length - 2].close : last);
    const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : last;
    const rate = prev > 0 ? ((price - prev) / prev * 100) : null;
    const retAt = n => { const idx = data.length - 1 - n; if (idx < 0) return null; const p = data[idx].close; return p > 0 ? ((last - p) / p * 100) : null; };
    // 배당: 최근 1년(365일) 배당 합 / 현재가
    let divSum = 0;
    const events = res.events && res.events.dividends;
    const oneYearAgo = Math.floor(Date.now() / 1000) - 365 * 86400;
    if (events) { for (const k in events) { const ev = events[k]; if (ev && ev.amount && ev.date >= oneYearAgo) divSum += ev.amount; } }
    const divYield = (divSum > 0 && price > 0) ? (divSum / price * 100) : null;
    // 6개월 미니차트
    const chart = data.slice(-126).map(d => ({ date: d.date, close: d.close }));
    return { ok: true, ticker, price, rate, ret1: retAt(21), ret3: retAt(63), ret6: retAt(126), ret12: retAt(252), divYield, divAmt: divSum || null, chart, source: "yahoo" };
  } catch (e) {
    return { ok: false, ticker, error: String(e) };
  }
}

async function usInfo(ticker, raw, env) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  try {
    const rc = await usResolveCode(ticker, env);
    let code = rc ? rc.code : null;
    if (!code) return { ok: false, ticker, error: "no reutersCode" };
    const H = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/worldstock/etf/" + code + "/total" };
    const grab = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/,/g, "").replace(/[^0-9.\\-]/g, "")); return isFinite(n) ? n : null; };

    // 해외 ETF/종목 종합: /etf/{code}/basic 우선, 실패 시 /stock/{code}/basic
    let d = null;
    for (const path of ["/etf/", "/stock/"]) {
      for (let attempt = 0; attempt < 2 && !d; attempt++) {
        try {
          const r = await fetch("https://api.stock.naver.com" + path + code + "/basic", { headers: H, cf: { cacheTtl: 180 } });
          if (r.ok) { const j = await r.json(); if (j && (j.closePrice != null || (j.stockItemTotalInfos && j.stockItemTotalInfos.length))) { d = j; break; } }
          else if (r.status === 409 || r.status === 429) { await new Promise(res => setTimeout(res, 250 * (attempt + 1))); continue; }
          else break;
        } catch (e) {}
      }
      if (d) break;
    }
    if (!d) {
      // 네이버에 데이터 없음(VYM·VIG·HDV 등) → 야후로 대체
      const y = await usInfoYahoo(ticker);
      if (y && y.ok) return y;
      return { ok: false, ticker, reutersCode: code, error: "no basic" };
    }
    if (raw) return { ok: true, ticker, reutersCode: code, basic: d };

    // ── 네이버 종목페이지(integration): ROE·52주최고가·목표주가·컨센서스 ──
    const extra = await usPageDetail(code, H);

    // 현재가·등락률 (하락이면 음수)
    let price = grab(d.closePrice), rate = grab(d.fluctuationsRatio);
    if (d.compareToPreviousPrice && (d.compareToPreviousPrice.code === "5" || d.compareToPreviousPrice.code === "4") && rate != null) rate = -Math.abs(rate);

    // stockItemTotalInfos 배열에서 수익률·배당 추출 ({code, key, value})
    const infos = Array.isArray(d.stockItemTotalInfos) ? d.stockItemTotalInfos : [];
    const byCode = {};
    infos.forEach(it => { if (it && it.code) byCode[it.code] = it.value; });
    const ret1 = grab(byCode.return1Month);
    const ret3 = grab(byCode.return3Month);
    const ret6 = grab(byCode.return6Month);
    const ret12 = grab(byCode.return1Year);
    const divAmt = grab(byCode.dividend);
    const nav = grab(byCode.nav);
    const dividendDate = byCode.dividendDate || null;

    // 뉴스 (최신 1건)
    let newsTitle = null, newsLink = null, newsDate = null;
    try {
      const nr = await fetch("https://api.stock.naver.com/stock/" + code + "/news?pageSize=3&page=1", { headers: H, cf: { cacheTtl: 600 } });
      if (nr.ok) { const nd = await nr.json(); const arr = (nd && (nd.items || nd.newsList || (nd.result && nd.result.items))) || []; const first = Array.isArray(arr) ? arr[0] : null; if (first) { newsTitle = first.title || first.headline || null; newsDate = first.datetime || first.date || null; const oid = first.officeId, aid = first.articleId; if (oid && aid) newsLink = "https://n.news.naver.com/mnews/article/" + oid + "/" + aid; else if (first.linkUrl || first.link) newsLink = first.linkUrl || first.link; } }
    } catch (e) {}

    return {
      ok: true, ticker, reutersCode: code, price, rate, ret1, ret3, ret6, ret12,
      divAmt, nav, dividendDate, newsTitle, newsLink, newsDate,
      roe: extra.roe, high52: extra.high52, low52: extra.low52,
      target: extra.target, per: extra.per, eps: extra.eps,
      consOpinion: extra.consOpinion, consScore: extra.consScore,
      consCount: extra.consCount, consStr: extra.consStr
    };
  } catch (e) {
    return { ok: false, ticker, error: String(e) };
  }
}

// ══════════════════════════════════════
// 해외 종목: 네이버 종목페이지에서 ROE·52주최고가·목표주가·컨센서스
//  · basic      → stockItemTotalInfos (52주최고/최저·PER·EPS)
//  · consensus  → recommMean(투자의견) · priceTargetMean(목표주가)
//  · finance/annual → rowList 에서 ROE
// ══════════════════════════════════════

// recommMean 척도: true = 숫자가 클수록 매수(5점 만점). 네이버 표기와 다르면 이 값만 뒤집으면 됨
const RECOMM_HIGH_IS_BUY = true;

const usSleep = ms => new Promise(r => setTimeout(r, ms));

// 상태코드까지 돌려주는 조회. empty = 200인데 본문이 비어 있음
async function usFetchStat(u, H) {
  try {
    const r = await fetch(u, { headers: H || { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, cf: { cacheTtl: 300 } });
    if (!r.ok) return { status: r.status, json: null, empty: false };
    const txt = await r.text();
    if (!txt || !txt.trim()) return { status: 200, json: null, empty: true };
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { return { status: 200, json: null, empty: true }; }
    return { status: 200, json: (j && typeof j === "object") ? j : null, empty: false };
  } catch (e) { return { status: 0, json: null, empty: false }; }
}

// 네이버는 요청이 몰리면 409/429 로 막고, 200에 빈 본문을 주기도 한다 → 쉬었다 재시도
// 차단 신호: 재시도로 풀릴 수 있고, 이때의 결과는 캐시하면 안 된다
function usBlocked(r) { return r.status === 409 || r.status === 429 || r.status === 0 || r.status >= 500; }
// 재시도 대상: 차단 + 빈 응답 (빈 응답은 차단 중에도 나오고, 정말 자료가 없을 때도 나온다)
function usTransient(r) { return usBlocked(r) || r.empty; }

async function usFetchStatRetry(u, H, tries) {
  let last = { status: 0, json: null, empty: false };
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    last = await usFetchStat(u, H);
    if (last.json) return last;
    if (!usTransient(last)) return last;      // 404 등은 재시도해도 소용없음
    if (i < n - 1) await usSleep(400 * (i + 1));
  }
  return last;
}

async function usFetchJson(u, H) {
  const r = await usFetchStatRetry(u, H);
  return r.json;
}

function usNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}
function firstNum() {
  for (let i = 0; i < arguments.length; i++) { const n = usNum(arguments[i]); if (n != null) return n; }
  return null;
}

// finance/annual · rowList 에서 ROE 최신값
function usFinanceRoe(fin) {
  const rows = fin && Array.isArray(fin.rowList) ? fin.rowList : [];
  for (const row of rows) {
    const title = JSON.stringify(row && row.title || "").toUpperCase();
    if (title.indexOf("ROE") < 0) continue;
    // columns 안의 값들 중 마지막(최신) 유효 숫자
    const vals = [];
    const walk = o => {
      if (o == null) return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (typeof o === "object") { Object.keys(o).forEach(k => walk(o[k])); return; }
      const n = usNum(o); if (n != null) vals.push(n);
    };
    walk(row.columns != null ? row.columns : row);
    if (vals.length) return vals[vals.length - 1];
  }
  return null;
}

async function usPageDetail(code, H) {
  const res = { roe: null, high52: null, low52: null, target: null, targetHigh: null, targetLow: null,
                per: null, eps: null, divYield: null,
                consOpinion: null, consScore: null, consCount: null, consStr: null, consDate: null };
  const S = "https://api.stock.naver.com/stock/" + encodeURIComponent(code);
  const E = "https://api.stock.naver.com/etf/" + encodeURIComponent(code);
  let basic = null, cons = null, fin = null;
  try {
    const got = await Promise.all([
      usFetchJson(S + "/basic", H),
      usFetchJson(S + "/consensus", H),
      usFetchJson(S + "/finance/annual", H),
    ]);
    basic = got[0]; cons = got[1]; fin = got[2];
    // ETF는 /etf/ 경로 — 개별종목 경로가 비면 한 번 더 시도
    if (!basic) basic = await usFetchJson(E + "/basic", H);
    if (!cons) cons = await usFetchJson(E + "/consensus", H);
  } catch (e) { return res; }

  // ── 컨센서스 ──
  if (cons) {
    res.target = usNum(cons.priceTargetMean);
    res.targetHigh = usNum(cons.priceTargetHigh);
    res.targetLow = usNum(cons.priceTargetLow);
    res.consDate = cons.createDate || null;
    const rm = usNum(cons.recommMean);
    if (rm != null && rm > 0 && rm <= 5) {
      res.consScore = rm;
      res.consOpinion = usOpinionFromScore(rm);
    }
  }

  // ── basic: stockItemTotalInfos 라벨 배열 ──
  if (basic) {
    const infos = Array.isArray(basic.stockItemTotalInfos) ? basic.stockItemTotalInfos : [];
    const byLabel = re => {
      for (const it of infos) {
        const lb = String((it && (it.key || it.title || it.name)) || "").replace(/\s/g, "");
        if (lb && re.test(lb)) return it.value;
      }
      return null;
    };
    const byCode = re => {
      for (const it of infos) { if (it && it.code && re.test(String(it.code))) return it.value; }
      return null;
    };
    res.high52 = firstNum(byLabel(/52주최고|52주고가|연중최고/), byCode(/(high.*52|52.*high|highPriceOfYear)/i));
    res.low52  = firstNum(byLabel(/52주최저|52주저가|연중최저/), byCode(/(low.*52|52.*low|lowPriceOfYear)/i));
    res.per    = firstNum(byLabel(/^PER$|주가수익비율/i), byCode(/^per$/i));
    res.eps    = firstNum(byLabel(/^EPS$|주당순이익/i), byCode(/^eps$/i));
    res.roe    = firstNum(byLabel(/^ROE$|자기자본이익률/i), byCode(/^roe$/i));
    res.divYield = firstNum(byLabel(/배당수익률/), byCode(/dividendYield/i));
    if (res.high52 == null) res.high52 = usNum(basic.high52Price || basic.fiftyTwoWeekHigh);
    if (res.low52 == null) res.low52 = usNum(basic.low52Price || basic.fiftyTwoWeekLow);
  }

  // ── ROE: 재무제표에서 보완 ──
  if (res.roe == null && fin) res.roe = usFinanceRoe(fin);

  if (res.consOpinion || res.consScore != null) {
    res.consStr = ((res.consOpinion || "") + (res.consScore != null ? " " + res.consScore.toFixed(2) : "")).trim();
  }
  return res;
}

function usOpinionKo(s) {
  const t = String(s).toUpperCase().replace(/[\s_]/g, "");
  if (/STRONGBUY|적극매수/.test(t)) return "적극매수";
  if (/OUTPERFORM|OVERWEIGHT|BUY|매수/.test(t)) return "매수";
  if (/HOLD|NEUTRAL|MARKETPERFORM|중립|보유/.test(t)) return "중립";
  if (/UNDERPERFORM|UNDERWEIGHT|REDUCE/.test(t)) return "비중축소";
  if (/STRONGSELL|SELL|매도/.test(t)) return "매도";
  return String(s).trim();
}
// 투자의견 점수 → 문구 (5점 만점 기준. 척도가 반대면 RECOMM_HIGH_IS_BUY 를 false 로)
function usOpinionFromScore(n) {
  const v = RECOMM_HIGH_IS_BUY ? n : (6 - n);
  if (v >= 4.5) return "적극매수";
  if (v >= 3.5) return "매수";
  if (v >= 2.5) return "중립";
  if (v >= 1.5) return "비중축소";
  return "매도";
}

// ══════════════════════════════════════
// 해외 종목 필드 진단: 후보 엔드포인트별로 상태·최상위키·관심필드 위치를 보고
// ══════════════════════════════════════
const US_PROBE_URLS = code => [
  ["basic",       "https://api.stock.naver.com/stock/" + code + "/basic"],
  ["consensus",   "https://api.stock.naver.com/stock/" + code + "/consensus"],
  ["financeA",    "https://api.stock.naver.com/stock/" + code + "/finance/annual"],
  ["financeQ",    "https://api.stock.naver.com/stock/" + code + "/finance/quarter"],
  ["integration", "https://api.stock.naver.com/stock/" + code + "/integration"],
];

// 같은 응답 안의 '동종업계 다른 종목' 블록 — 값이 섞이지 않게 진단에서 제외
const US_SKIP_KEYS = /^(industryCompareInfo|globalStocks|compareStocks|relatedStocks|similarStocks|newsList)$/i;

// 관심 필드 이름 패턴
const US_FIELD_RE = /(roe|returnonequity|high|low|52|target|opinion|recomm|consensus|analyst|estimate|^per$|peratio|^eps$|earningspershare|pbr|dividend)/i;

// 트리를 훑어 관심 필드의 경로·값을 모은다 (동종업계 블록은 제외)
function collectFields(root, max) {
  const out = [];
  const walk = (o, path, depth) => {
    if (out.length >= (max || 200) || o == null || depth > 8) return;
    if (Array.isArray(o)) { o.slice(0, 60).forEach((x, i) => walk(x, path + "[" + i + "]", depth + 1)); return; }
    if (typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      const v = o[k], p = path ? path + "." + k : k;
      if (v == null) continue;
      if (typeof v !== "object") {
        if (US_FIELD_RE.test(k)) out.push(p + " = " + String(v).slice(0, 40));
        // {key/title/name, value} 라벨 형태
        else if (/^(value|val)$/i.test(k)) {
          const lb = String(o.key || o.title || o.name || o.itemName || "");
          if (lb) out.push(p + " [" + lb + "] = " + String(v).slice(0, 40));
        }
      }
    }
    for (const k of Object.keys(o)) {
      if (US_SKIP_KEYS.test(k)) continue;
      const v = o[k];
      if (v && typeof v === "object") walk(v, path ? path + "." + k : k, depth + 1);
    }
  };
  walk(root, "", 0);
  return out;
}

async function usProbe(ticker, dump) {
  const t = String(ticker || "").trim().toUpperCase();
  const link = await naverWorldUrl(t, null);
  const code = link && link.ok ? link.reutersCode : null;
  if (!code) return { ok: false, ticker: t, error: "no reutersCode" };
  const H = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/worldstock/stock/" + code + "/total" };
  const results = {};
  for (const [name, u] of US_PROBE_URLS(code)) {
    try {
      const r = await fetch(u, { headers: H, cf: { cacheTtl: 60 } });
      if (!r.ok) { results[name] = { status: r.status }; continue; }
      const j = await r.json();
      const entry = { status: 200, topKeys: (j && typeof j === "object") ? Object.keys(j).slice(0, 25) : typeof j };
      const f = collectFields(j, 200);
      if (f.length) entry.fields = f;
      if (dump && String(dump) === name) entry.dump = JSON.stringify(j).slice(0, 12000);
      results[name] = entry;
    } catch (e) { results[name] = { error: String(e).slice(0, 80) }; }
  }
  return { ok: true, ticker: t, reutersCode: code, results };
}

async function usInfo_OLD(ticker, raw) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  try {
    const link = await naverWorldUrl(ticker, null);
    const code = link && link.ok ? link.reutersCode : null;
    if (!code) return { ok: false, ticker, error: "no reutersCode" };
    const base = "https://api.stock.naver.com/stock/" + encodeURIComponent(code);
    // integration: 여러 API 경로 시도 (해외종목은 worldstock 경로가 정확)
    let integ = null, news = null;
    const integUrls = [
      "https://api.stock.naver.com/stock/" + encodeURIComponent(code) + "/integration",
      "https://m.stock.naver.com/api/stock/worldstock/" + encodeURIComponent(code) + "/integration",
      "https://api.stock.naver.com/stock/" + encodeURIComponent(code) + "/basic",
      "https://m.stock.naver.com/api/stock/" + encodeURIComponent(code) + "/integration",
    ];
    for (const u of integUrls) {
      try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/worldstock/stock/" + code + "/total" }, cf: { cacheTtl: 300 } }); if (r.ok) { const j = await r.json(); if (j && Object.keys(j).length) { integ = j; break; } } } catch (e) {}
    }
    if (raw) return { ok: true, ticker, reutersCode: code, integ };
    const grab = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : null; };
    // 목표가
    let tp = null;
    const scanTp = o => { if (tp != null || o == null || typeof o !== "object") return; if (o.priceTargetMean != null) { const g = grab(o.priceTargetMean); if (g != null && g > 0) { tp = g; return; } } for (const k of Object.keys(o)) scanTp(o[k]); };
    scanTp(integ);
    // 52주 최고가
    let hi = null;
    const scanHi = o => { if (hi != null || o == null) return; if (Array.isArray(o)) { for (const x of o) scanHi(x); return; } if (typeof o === "object") { for (const k of Object.keys(o)) { if (/(high52|52.*[Hh]igh|fiftyTwoWeekHigh|week52High)/.test(k)) { const g = grab(o[k]); if (g != null && g > 0) { hi = g; return; } } } for (const k of Object.keys(o)) scanHi(o[k]); } };
    scanHi(integ);
    // ROE (재무)
    let roe = null;
    const scanRoe = o => { if (roe != null || o == null) return; if (Array.isArray(o)) { for (const x of o) scanRoe(x); return; } if (typeof o === "object") { const label = String(o.key || o.title || o.name || "").toUpperCase(); if (label === "ROE" || label.indexOf("ROE") >= 0) { const g = grab(o.value ?? o.val ?? o.data); if (g != null) { roe = g; return; } } for (const k of Object.keys(o)) { if (/^roe$/i.test(k)) { const g = grab(o[k]); if (g != null) { roe = g; return; } } } for (const k of Object.keys(o)) scanRoe(o[k]); } };
    scanRoe(integ);
    // 뉴스 (최신 1건)
    let newsTitle = null, newsLink = null, newsDate = null;
    try {
      const nr = await fetch(base + "/news?pageSize=3&page=1", { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/" }, cf: { cacheTtl: 600 } });
      if (nr.ok) { const nd = await nr.json(); const arr = (nd && (nd.items || nd.newsList || (nd.result && nd.result.items))) || []; const first = Array.isArray(arr) ? arr[0] : null; if (first) { newsTitle = first.title || first.headline || null; newsDate = first.datetime || first.date || first.officeDateTime || null; const oid = first.officeId || first.officeid, aid = first.articleId || first.articleid; if (oid && aid) newsLink = "https://n.news.naver.com/mnews/article/" + oid + "/" + aid; else if (first.linkUrl || first.link) newsLink = first.linkUrl || first.link; } }
    } catch (e) {}
    // 현재가·등락률·수익률(1/3/6/12개월)·배당 — integration의 필드 스캔
    let price = null, rate = null, ret1 = null, ret3 = null, ret6 = null, ret12 = null, divYield = null, divAmt = null;
    const scanQuote = o => {
      if (o == null || typeof o !== "object") return;
      if (Array.isArray(o)) { for (const x of o) scanQuote(x); return; }
      for (const k of Object.keys(o)) {
        const kl = k.toLowerCase();
        if (price == null && /^(closeprice|currentprice|now|tradeprice|lastprice)$/i.test(k)) { const g = grab(o[k]); if (g != null && g > 0) price = g; }
        if (rate == null && /^(fluctuationsratio|compareratio|changerate|risefallratio)$/i.test(k)) { const g = grab(o[k]); if (g != null && Math.abs(g) < 100) rate = g; }
        // 수익률: 네이버는 accumulatedProfitRate + 기간, 또는 profitRate1M 등 다양
        if (ret1 == null && /(1month|month1|onemonth|profitrate.*1m|1m.*profit)/i.test(kl)) { const g = grab(o[k]); if (g != null) ret1 = g; }
        if (ret3 == null && /(3month|month3|threemonth|profitrate.*3m|3m.*profit)/i.test(kl)) { const g = grab(o[k]); if (g != null) ret3 = g; }
        if (ret6 == null && /(6month|month6|sixmonth|profitrate.*6m|6m.*profit)/i.test(kl)) { const g = grab(o[k]); if (g != null) ret6 = g; }
        if (ret12 == null && /(1year|year1|oneyear|12month|month12|twelvemonth|profitrate.*1y|1y.*profit)/i.test(kl)) { const g = grab(o[k]); if (g != null) ret12 = g; }
        if (divYield == null && /(dividendrate|dividendyield|divyield|dividendratio)/i.test(kl)) { const g = grab(o[k]); if (g != null && g >= 0 && g < 50) divYield = g; }
        if (divAmt == null && /^(dividend|dividendamount|dps)$/i.test(kl)) { const g = grab(o[k]); if (g != null && g >= 0) divAmt = g; }
      }
      for (const k of Object.keys(o)) scanQuote(o[k]);
    };
    scanQuote(integ);
    return { ok: true, ticker, reutersCode: code, roe, target: tp, high52: hi, newsTitle, newsLink, newsDate, price, rate, ret1, ret3, ret6, ret12, divYield, divAmt };
  } catch (e) {
    return { ok: false, ticker, error: String(e) };
  }
}

// ══════════════════════════════════════
// 증시자금동향 (finance.naver.com/sise/sise_deposit.naver)
//  표 한 줄 = 날짜 + (값,증감) × 5   → 고객예탁금·신용잔고·주식형·혼합형·채권형
//  단위: 억원. 페이지당 약 30영업일이라 9페이지면 1년 남짓
// ══════════════════════════════════════
async function naverDeposit(pages, raw) {
  const out = [];
  const seen = new Set();
  const tried = [];
  const P = Math.max(1, Math.min(14, pages || 9));
  for (let pg = 1; pg <= P; pg++) {
    const u = "https://finance.naver.com/sise/sise_deposit.naver?page=" + pg;
    let html = "";
    try {
      const r = await fetch(u, {
        headers: { "User-Agent": UA, "Referer": "https://finance.naver.com/sise/", "Accept": "text/html" },
        cf: { cacheTtl: 300 }
      });
      tried.push(pg + ":" + r.status);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      html = new TextDecoder("euc-kr").decode(buf);   // 네이버 금융은 EUC-KR
    } catch (e) { tried.push(pg + ":ERR"); continue; }

    const rows = html.match(/<tr[\s\S]*?<\/tr>/g) || [];
    for (const tr of rows) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map(m => m[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim());
      if (cells.length < 11) continue;
      const dt = cells[0];
      if (!/^\d{2}\.\d{2}\.\d{2}$/.test(dt)) continue;
      const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : null; };
      const rec = {
        date: "20" + dt.replace(/\./g, "-"),         // 26.08.06 → 2026-08-06
        deposit: num(cells[1]),                      // 고객예탁금
        credit: num(cells[3]),                       // 신용잔고
        stock: num(cells[5]),                        // 펀드 주식형
        mixed: num(cells[7]),                        // 펀드 혼합형
        bond: num(cells[9]),                         // 펀드 채권형
      };
      if (rec.deposit == null || seen.has(rec.date)) continue;
      seen.add(rec.date);
      out.push(rec);
    }
    await usSleep(120);   // 네이버 차단 방지
  }
  out.sort((a, b) => a.date < b.date ? -1 : 1);      // 오래된 것 → 최신
  if (raw) return { ok: true, tried, count: out.length, sample: out.slice(-3) };
  return { ok: true, count: out.length, rows: out };
}

// ══════════════════════════════════════
// 풋콜 레이쇼 (KRX 파생상품 통계)
//  KRX 는 getJsonData.cmd 에 bld 코드를 POST 하는 구조.
//  전용 P/C 통계 bld 를 모르므로 후보를 훑고,
//  옵션 전종목시세(콜·풋 따로)로 직접 합산하는 경로도 함께 시도한다.
// ══════════════════════════════════════
const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KRX_HDR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201050403",
  "Origin": "https://data.krx.co.kr",
};

async function krxPost2(params) {
  const body = new URLSearchParams(params).toString();
  try {
    const r = await fetch(KRX_URL, { method: "POST", headers: KRX_HDR, body });
    if (!r.ok) return { status: r.status, json: null };
    const t = await r.text();
    if (!t || !t.trim()) return { status: 200, json: null, empty: true };
    try { return { status: 200, json: JSON.parse(t) }; }
    catch (e) { return { status: 200, json: null, text: t.slice(0, 200) }; }
  } catch (e) { return { status: 0, error: String(e).slice(0, 80) }; }
}

// 응답에서 행 배열 꺼내기 (OutBlock_1 / output / block1 중 하나)
function krxRows(j) {
  if (!j) return null;
  for (const k of ["OutBlock_1", "output", "block1", "OutBlock_2"]) {
    if (Array.isArray(j[k])) return j[k];
  }
  return null;
}

// 후보 bld 목록 (전용 P/C 통계로 추정되는 것들)
const PCR_BLDS = [
  "dbms/MDC/STAT/standard/MDCSTAT13001",
  "dbms/MDC/STAT/standard/MDCSTAT13101",
  "dbms/MDC/STAT/standard/MDCSTAT12901",
  "dbms/MDC/STAT/standard/MDCSTAT12801",
  "dbms/MDC/STAT/standard/MDCSTAT13201",
];

async function krxPutCall(trdDd, raw) {
  const dd = String(trdDd).replace(/[^0-9]/g, "").slice(0, 8) || kstYmd(0);
  const out = { ok: true, trdDd: dd, tried: [] };

  // ① 전용 P/C 통계 후보
  for (const bld of PCR_BLDS) {
    const r = await krxPost2({ bld, trdDd: dd, strtDd: dd, endDd: dd, prodId: "KRDRVOPK2I", share: "1", money: "1", csvxls_isNo: "false" });
    const rows = krxRows(r.json);
    out.tried.push({ bld, status: r.status + (r.empty ? "(빈응답)" : ""), rows: rows ? rows.length : 0,
                     keys: r.json ? Object.keys(r.json).slice(0, 6) : null,
                     sample: rows && rows.length ? rows[0] : null });
    await usSleep(150);
  }

  // ② 옵션 전종목시세에서 콜·풋 거래량을 직접 합산
  const sumVol = async (rght) => {
    const r = await krxPost2({
      bld: "dbms/MDC/STAT/standard/MDCSTAT12502",
      trdDd: dd, prodId: "KRDRVOPK2I", ulyId: "KRDRVFUK2I",
      trdDdBox1: dd, trdDdBox2: dd, mktTpCd: "T", rghtTpCd: rght,
      share: "1", money: "1", csvxls_isNo: "false",
    });
    const rows = krxRows(r.json);
    if (!rows || !rows.length) return { ok: false, status: r.status + (r.empty ? "(빈응답)" : ""), keys: r.json ? Object.keys(r.json).slice(0, 6) : null };
    // 거래량으로 보이는 필드를 찾는다
    const cand = Object.keys(rows[0]).filter(k => /ACC_TRDVOL|TRDVOL|VOL/i.test(k));
    const field = cand[0] || null;
    let sum = 0;
    if (field) rows.forEach(x => { const n = usNum(x[field]); if (n != null) sum += n; });
    return { ok: true, rows: rows.length, field, volFields: cand, sum, sample: rows[0] };
  };
  out.call = await sumVol("C");
  await usSleep(200);
  out.put = await sumVol("P");
  if (out.call.ok && out.put.ok && out.call.sum > 0) {
    out.pcRatio = +(out.put.sum / out.call.sum).toFixed(3);
  }
  if (!raw) { out.tried = out.tried.filter(t => t.rows > 0); }
  return out;
}

// ══════════════════════════════════════
// 티커 → reutersCode 해석 (KV 30일 캐시)
//  네이버 자동완성은 동시 요청을 막으므로 캐시 + 순차 호출이 필수
// ══════════════════════════════════════
async function usResolveCode(ticker, env) {
  const t = String(ticker || "").trim().toUpperCase();
  if (!t) return null;
  // rcode2: 검증을 거친 코드만 저장한다 (예전 rcode: 는 미검증이라 폐기)
  const kvKey = "rcode3:" + t;   // rcode/rcode2 는 자동완성 파싱 오류로 잘못된 코드가 들어가 폐기
  if (env && env.KV) {
    try { const v = await env.KV.get(kvKey); if (v) { const o = JSON.parse(v); if (o && o.code) return o; } } catch (e) {}
  }
  const link = await naverWorldUrl(t, null);
  const hint = (link && link.ok && link.reutersCode) ? link.reutersCode : null;
  const type = (link && link.stockType) || "stock";
  // 자동완성이 준 코드가 정답이다. 못 받았을 때만 접미사를 훑는다(요청 절약)
  let code = hint;
  if (!code) { try { code = await resolveReutersCode(t, null); } catch (e) { code = null; } }
  if (!code) return null;
  const o = { code, type };
  if (env && env.KV) {
    try { await env.KV.put(kvKey, JSON.stringify(o), { expirationTtl: 60 * 60 * 24 * 30 }); } catch (e) {}
  }
  return o;
}

// 여러 티커를 순차 처리 (동시 호출로 인한 네이버 차단 방지)
async function usSeq(syms, fn) {
  const out = [];
  for (const s of syms) { try { out.push(await fn(s)); } catch (e) { out.push({ ok: false, ticker: s, error: String(e).slice(0, 80) }); } }
  return out;
}

// ══════════════════════════════════════
// 컨센서스 조회: 종목코드 접미사가 맞아야 응답한다
//  네이버 자동완성이 주는 코드(.K 등)로는 뉴욕거래소 종목이 404가 나므로
//  .N/.O/.K/.P/.A 를 훑어 되는 코드를 찾고 KV에 기억한다. ETF는 컨센서스가 없어 '없음'으로 캐시.
// ══════════════════════════════════════
async function usConsensus(ticker, rc, H, env, nocache) {
  const t = String(ticker || "").toUpperCase();
  const kvKey = "ccode3:" + t;          // ccode/ccode2 는 잘못된 코드로 '없음'을 캐시해 폐기
  const tried = [];
  let cached = null;
  if (!nocache && env && env.KV) { try { const v = await env.KV.get(kvKey); if (v) cached = JSON.parse(v); } catch (e) {} }
  if (cached && cached.none) return { cons: null, tried: ["cached:없음"] };

  const bare = String((rc && rc.code) || t).split(".")[0];
  const cands = [];
  if (cached && cached.code) cands.push(cached.code);
  if (rc && rc.code) cands.push(rc.code);
  ["N", "O", "K", "P", "A", "Z", "B"].forEach(x => cands.push(bare + "." + x));
  const seen = new Set();
  const list = cands.filter(c => c && !seen.has(c) && (seen.add(c), true)).slice(0, 8);

  let blocked = false;
  for (const c of list) {
    const u = "https://api.stock.naver.com/stock/" + c + "/consensus";
    const r = await usFetchStatRetry(u, H);
    const j = r.json;
    const hit = j && (j.priceTargetMean != null || j.recommMean != null);
    if (!hit && usBlocked(r)) blocked = true;
    tried.push(r.status + (r.empty ? "(빈응답)" : "") + (hit ? " ok " : " miss ") + c);
    if (hit) {
      if (env && env.KV) { try { await env.KV.put(kvKey, JSON.stringify({ code: c }), { expirationTtl: 60 * 60 * 24 * 30 }); } catch (e) {} }
      return { cons: j, code: c, tried };
    }
    await usSleep(120);                      // 네이버 차단 방지용 간격
  }
  // 차단이 한 번이라도 있었으면 '없음'으로 굳히지 않는다.
  // 전부 빈 응답이면 컨센서스 미제공(ETF 등)으로 보고 6시간만 기억한다.
  if (!blocked && env && env.KV) {
    try { await env.KV.put(kvKey, JSON.stringify({ none: true }), { expirationTtl: 60 * 60 * 6 }); } catch (e) {}
  }
  return { cons: null, tried, transient: blocked || undefined };
}

async function usTarget(ticker, raw, env, nocache) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  try {
    const rc = await usResolveCode(ticker, env);
    if (!rc) return { ok: false, ticker, error: "no reutersCode" };
    const code = rc.code;
    // ETF는 경로가 /etf/, 개별종목은 /stock/ — 둘 다 시도한다
    const kind = (rc.type === "etf") ? "etf" : "stock";
    const H = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://m.stock.naver.com/worldstock/" + kind + "/" + code + "/total" };
    const bases = [
      "https://api.stock.naver.com/stock/" + encodeURIComponent(code),
      "https://api.stock.naver.com/etf/" + encodeURIComponent(code),
    ];
    if (kind === "etf") bases.reverse();

    // 진단 모드 code: /basic 만 확인해 실제 존재하는 종목코드를 찾는다 (요청 7건, 간격 있음)
    if (raw === "code") {
      const bare = String(code).split(".")[0];
      const cands = [];
      [code].concat(["K", "N", "O", "P", "A"].map(x => bare + "." + x))
        .forEach(c => { if (c && cands.indexOf(c) < 0) cands.push(c); });
      const rows = [];
      for (const c of cands.slice(0, 6)) {
        const r = await usFetchStat("https://api.stock.naver.com/stock/" + c + "/basic", H);
        let nm = null;
        if (r.json) nm = r.json.stockName || r.json.stockNameEng || r.json.fundName || "(이름없음)";
        rows.push({ code: c, status: r.status + (r.empty ? "(빈응답)" : ""), name: nm });
        await usSleep(200);
      }
      // 검색 원문도 함께 (자동완성이 무엇을 주는지 확인)
      let ac = null;
      try { ac = await naverWorldUrl(ticker, "1"); } catch (e) {}
      return { ok: true, ticker, autocompleteCode: code, basic: rows, autocomplete: ac };
    }
    // 진단 모드 sweep: 후보 코드마다 각 엔드포인트의 HTTP 상태를 그대로 보고
    if (raw === "sweep") {
      const bare = String(code).split(".")[0];
      const cands = [];
      [code].concat(["N", "O", "K", "P", "A", "Z", "B"].map(x => bare + "." + x))
        .forEach(c => { if (c && cands.indexOf(c) < 0) cands.push(c); });
      const rows = [];
      for (const c of cands.slice(0, 8)) {
        const row = { code: c };
        for (const [name, u] of [["price", "/stock/" + c + "/price?pageSize=1"], ["basic", "/stock/" + c + "/basic"], ["consensus", "/stock/" + c + "/consensus"]]) {
          try {
            const r = await fetch("https://api.stock.naver.com" + u, { headers: H });
            let body = "";
            if (r.ok) { const txt = await r.text(); body = txt.slice(0, 160); }
            row[name] = r.status + (r.ok ? " " + body : "");
          } catch (e) { row[name] = "ERR " + String(e).slice(0, 40); }
        }
        rows.push(row);
      }
      return { ok: true, ticker, reutersCode: code, stockType: kind, sweep: rows };
    }
    const got = await usConsensus(ticker, rc, H, env, nocache);
    const cons = got.cons;
    const tried = got.tried;
    let ig = null;
    if (raw) return { ok: true, ticker, reutersCode: code, stockType: kind, consCode: got.code || null, tried, consensus: cons };

    let tp = null, score = null, opinion = null, cstr = null, thi = null, tlo = null;
    if (cons) {
      tp = usNum(cons.priceTargetMean);
      thi = usNum(cons.priceTargetHigh);
      tlo = usNum(cons.priceTargetLow);
      const rm = usNum(cons.recommMean);
      if (rm != null && rm > 0 && rm <= 5) {
        score = rm;
        opinion = usOpinionFromScore(rm);
        cstr = opinion + " " + rm.toFixed(2);
      }
    }
    // 목표가가 비면 integration 의 consensusInfo 로 보조 (ETF는 컨센서스가 없으므로 생략)
    if (tp == null && kind !== "etf") {
      for (const b of bases) {
        ig = await usFetchJson(b + "/integration", H);
        tried.push((ig ? "ok " : "miss ") + b + "/integration");
        if (ig) break;
      }
      if (ig && ig.consensusInfo) tp = usNum(ig.consensusInfo.priceTargetMean);
      if (tp == null && ig) {
        // consensusInfo 위치가 다를 때를 대비한 최소 탐색 (동종업계 블록은 제외)
        const scan = o => {
          if (tp != null || o == null || typeof o !== "object") return;
          if (Array.isArray(o)) { for (const x of o) scan(x); return; }
          if (o.priceTargetMean != null) { const g = usNum(o.priceTargetMean); if (g != null) { tp = g; return; } }
          for (const k of Object.keys(o)) { if (US_SKIP_KEYS.test(k)) continue; scan(o[k]); }
        };
        scan(ig);
      }
    }
    return {
      ok: true, ticker, reutersCode: code, stockType: kind,
      target: tp, targetStr: tp != null ? String(tp) : null,
      targetHigh: thi, targetLow: tlo,
      consScore: score, consOpinion: opinion, consStr: cstr,
      consDate: cons ? (cons.createDate || null) : null,
      transient: got.transient || undefined,
      tried: (tp == null && score == null) ? tried : undefined
    };
  } catch (e) {
    return { ok: false, ticker, error: String(e) };
  }
}

const NV_SEARCH = new Set([]);
const NV_OVERRIDE = {};

async function naverWorldProbe(ticker) {
  ticker = String(ticker || "").trim().toUpperCase();
  const q = encodeURIComponent(ticker);
  const urls = ["https://ac.stock.naver.com/ac?q=" + q + "&target=stock,index,marketindicator,coin", "https://m.stock.naver.com/front-api/search/autoComplete?query=" + q + "&target=stock,etf,index", "https://api.stock.naver.com/front-api/search/autoComplete?query=" + q + "&target=stock,etf,index", "https://m.stock.naver.com/api/search/all?query=" + q, "https://api.stock.naver.com/search/all?query=" + q, "https://m.stock.naver.com/api/search/searchList?query=" + q];
  const out = [];
  for (const u of urls) {
    let status = 0, len = 0, snippet = "";
    try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" } }); status = r.status; const t = await r.text(); len = t.length; snippet = t.slice(0, 200); } catch (e) { status = -1; snippet = String(e).slice(0, 150); }
    out.push({ url: u, status, len, snippet });
  }
  return { ok: true, ticker, probes: out };
}

// reutersCode 접미사 검증: 후보 접미사로 실제 API 호출해 작동하는 코드 찾기
// .O=나스닥, .K=NYSE, .P=NYSE Arca, .A=AMEX, .N=NYSE
async function resolveReutersCode(ticker, hint) {
  ticker = String(ticker || "").trim().toUpperCase();
  const bare = ticker.split(".")[0];
  const order = [];
  if (hint) order.push(hint);
  ["O", "K", "P", "A", "N"].forEach(s => { const c = bare + "." + s; if (!order.includes(c)) order.push(c); });
  for (const code of order) {
    try {
      const r = await fetch("https://api.stock.naver.com/stock/" + code + "/price", { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" }, cf: { cacheTtl: 3600 } });
      if (r.ok) { const j = await r.json(); const p = Array.isArray(j) ? j[0] : j; if (p && p.closePrice != null) return code; }
    } catch (e) {}
  }
  return hint || (bare + ".O");
}

async function naverWorldUrl(ticker, raw) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "no ticker" };
  if (!raw && NV_OVERRIDE[ticker]) {
    const code = NV_OVERRIDE[ticker];
    return { ok: true, ticker, url: "https://m.stock.naver.com/worldstock/etf/" + code + "/total", reutersCode: code, stockType: "etf" };
  }
  if (!raw && NV_SEARCH.has(ticker)) return { ok: false, ticker, error: "search-fallback" };
  try {
    const acUrl = "https://ac.stock.naver.com/ac?q=" + encodeURIComponent(ticker) + "&target=stock,index,marketindicator,coin,worldstock";
    const r = await fetch(acUrl, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" }, cf: { cacheTtl: 3600 } });
    if (r.ok) {
      const d = await r.json();
      if (raw) return { ok: true, source: acUrl, data: d };
      // items 는 두 형식이 모두 온다:
      //  ① [[코드, 이름, 타입, 거래소, ...], ...]  (예전 형식)
      //  ② [{code, name, typeCode, url, reutersCode, category}, ...]  (현재 형식)
      // ②를 못 읽으면 BLK(접미사 없음) 같은 종목이 엉뚱한 코드로 떨어진다
      let flat = [];
      if (d && Array.isArray(d.items)) {
        d.items.forEach(grp => {
          if (Array.isArray(grp)) flat.push(...grp);
          else if (grp && typeof grp === "object") flat.push(grp);
        });
      }
      const symOf = x => {
        if (Array.isArray(x)) return String(x[0] || "").split(".")[0].toUpperCase();
        if (x && typeof x === "object") return String(x.code || x.reutersCode || "").split(".")[0].toUpperCase();
        return "";
      };
      // 미국 종목 중 티커가 정확히 일치하는 것 우선
      const isUsa = x => !x || Array.isArray(x) ? true : (!x.nationCode || String(x.nationCode).toUpperCase() === "USA");
      const pick = flat.find(x => symOf(x) === ticker && isUsa(x)) || flat.find(x => symOf(x) === ticker) || flat[0];
      if (pick) {
        let code = null, type = "stock";
        if (Array.isArray(pick)) {
          code = pick[0] ? String(pick[0]) : null;
          if (/etf/i.test(String(pick[2] || pick[3] || ""))) type = "etf";
        } else {
          code = String(pick.reutersCode || pick.code || "") || null;
          const u = String(pick.url || "");
          if (/\/etf\//i.test(u) || /etf/i.test(String(pick.category || ""))) type = "etf";
        }
        if (code) {
          return { ok: true, ticker, url: "https://m.stock.naver.com/worldstock/" + type + "/" + code + "/total", reutersCode: code, stockType: type };
        }
      }
    }
  } catch (e) {}
  const q = encodeURIComponent(ticker);
  const urls = ["https://m.stock.naver.com/front-api/search/autoComplete?query=" + q + "&target=stock,etf,index", "https://api.stock.naver.com/front-api/search/autoComplete?query=" + q + "&target=stock,etf,index", "https://m.stock.naver.com/api/search/all?query=" + q, "https://api.stock.naver.com/search/all?query=" + q, "https://m.stock.naver.com/api/search/searchList?query=" + q];
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" }, cf: { cacheTtl: 3600 } });
      if (!res.ok) continue;
      const d = await res.json();
      if (raw) return { ok: true, source: u, data: d };
      const bucket = [];
      const push = a => { if (Array.isArray(a)) bucket.push(...a); };
      const dig = o => { if (!o || typeof o !== "object") return; push(o.stocks); push(o.etfs); push(o.items); push(o.list); push(o.searchResultList); push(o.searchList); push(o.results); };
      dig(d); dig(d.result); dig(d.data);
      if (d.result) dig(d.result.result);
      const ricOf = x => String((x && (x.reutersCode || x.ric || x.code || x.symbolCode)) || "");
      const symOf = x => String((x && (x.code || x.symbolCode || x.itemCode || x.symbol)) || "").toUpperCase();
      const isUSA = x => { const n = String((x && x.nationCode) || "").toUpperCase(); return n === "" || n === "USA"; };
      const notKR6 = x => !/^\d{6}$/.test(ricOf(x));
      const pool = bucket.filter(x => isUSA(x) && notKR6(x));
      const list = pool.length ? pool : bucket.filter(notKR6);
      const pick = list.find(x => symOf(x) === ticker) || list.find(x => ricOf(x).split(".")[0].toUpperCase() === ticker) || list.find(x => x.url) || list[0];
      if (!pick) continue;
      let path = String(pick.url || "");
      if (path) {
        if (!/\/total$/.test(path)) path += "/total";
        const full = /^https?:/.test(path) ? path : "https://m.stock.naver.com" + path;
        return { ok: true, ticker, url: full, reutersCode: ricOf(pick), stockType: /\/etf\//.test(path) ? "etf" : "stock" };
      }
      const code = ricOf(pick);
      let type = String((pick.stockType || pick.type || pick.typeCode || pick.stockEndType || "")).toLowerCase();
      type = type.includes("etf") ? "etf" : "stock";
      return { ok: true, ticker, url: "https://m.stock.naver.com/worldstock/" + type + "/" + code + "/total", reutersCode: code, stockType: type };
    } catch (e) {}
  }
  // 최후 수단: 야후로 거래소를 확인해 네이버 reuters 코드(티커.O/.K) 추정
  try {
    const yr = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?interval=1d&range=1d", { headers: { "User-Agent": UA, "Accept": "application/json" }, cf: { cacheTtl: 3600 } });
    if (yr.ok) {
      const yd = await yr.json();
      const ex = String(yd?.chart?.result?.[0]?.meta?.exchangeName || yd?.chart?.result?.[0]?.meta?.fullExchangeName || "").toUpperCase();
      // 나스닥 → .O, NYSE/기타 → .K
      const suffix = /NASDAQ|NMS|NGM|NCM/.test(ex) ? ".O" : ".K";
      const code = ticker + suffix;
      return { ok: true, ticker, url: "https://m.stock.naver.com/worldstock/stock/" + code + "/total", reutersCode: code, stockType: "stock", guessed: true };
    }
  } catch (e) {}
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

async function naverFind(q) {
  const urls = [
    "https://m.stock.naver.com/front-api/search/autoComplete?query=" + encodeURIComponent(q) + "&target=stock,index,etf,nvestor",
    "https://ac.stock.naver.com/ac?q=" + encodeURIComponent(q) + "&target=stock,etf,worldstock",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" }, cf: { cacheTtl: 60 } });
      if (!res.ok) continue;
      const d = await res.json();
      const items = (d && d.result && d.result.items) || (d && d.items) || [];
      const out = [];
      for (const it of items) {
        let rawCode, name, typeName;
        if (Array.isArray(it)) {
          rawCode = Array.isArray(it[0]) ? it[0][0] : it[0];
          name = Array.isArray(it[1]) ? it[1][0] : it[1];
          typeName = it[2];
        } else {
          rawCode = it.code || it.cd || it.itemCode || it.reutersCode || it.symbolCode;
          name = it.name || it.nm || it.korNm || it.itemName;
          typeName = it.typeName || it.nationType || it.nationCode || it.market;
        }
        const rc = String(rawCode || "").trim();
        const nm = String(name || "").replace(/<[^>]*>/g, "").trim();
        if (!nm) continue;
        const digits = rc.replace(/[^0-9]/g, "");
        if (digits.length === 6) {
          // 국내 종목
          out.push({ code: digits, name: nm, market: "KR" });
        } else if (/^[A-Za-z][A-Za-z.\-]*$/.test(rc)) {
          // 해외 종목 (티커: AAPL, MSFT, BRK.B 등)
          out.push({ code: rc.toUpperCase(), name: nm, market: "US", symbol: rc.toUpperCase() });
        }
        if (out.length >= 12) break;
      }
      if (out.length) return { ok: true, items: out };
    } catch (e) {}
  }
  return { ok: true, items: [] };
}


// ═══ KV 캐싱 헬퍼 (외국인·공매도 등 하루1회 데이터) ═══
const CACHE_TTL = 6 * 3600; // 6시간 (초)

// 항목별 캐시 유효시간 — 차트는 장중 오늘 봉이 계속 바뀌므로 짧게 잡는다
function cacheTtlFor(key){
  if (String(key).startsWith("chart:")) return 180;   // 3분
  if (String(key).startsWith("trank:")) return 600;   // 10분 (장중 잠정치가 바뀜)
  return CACHE_TTL;                                    // 그 외 6시간
}
async function kvGet(env, key) {
  if (!env || !env.KV) return null;
  try {
    const raw = await env.KV.get("cache:v2:" + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj._ts) return null;
    const age = (Date.now() - obj._ts) / 1000;
    if (age > cacheTtlFor(key)) return null; // 만료
    return obj.data;
  } catch(e) { return null; }
}

async function kvSet(env, key, data) {
  if (!env || !env.KV) return;
  try {
    await env.KV.put("cache:v2:" + key, JSON.stringify({ _ts: Date.now(), data }), { expirationTtl: cacheTtlFor(key) });
  } catch(e) {}
}

const ALLOWED_KEYS = new Set(["val_us", "val_usetf", "val_kretf", "val_kr", "val_kr2", "reports", "watch", "watch_portfolio", "invpf_portfolio", "score_rules", "selpf", "divpf", "snap_sel", "snap_div", "snap_usc"]);

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


// ══════════════════════════════════════
// 외국인 매매 추이 (1년 일별) - 막대그래프용
// ══════════════════════════════════════
async function foreignTrend(days, raw) {
  // 네이버 investorDealTrendDay: page=N 으로 페이지네이션 (한 페이지 약 10거래일)
  // sosok=01(코스피) / sosok=02(코스닥) 각각 조회
  const headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/sise/investorDealTrend.naver" };
  const bizdate = kstYmd(0);
  const parseNums = (chunk) => [...chunk.matchAll(/<td class="rate_(?:up|down)3">\s*([-−]?[\d,]+)\s*<\/td>/g)].map(m => parseInt(m[1].replace(/,/g, "").replace("−", "-"), 10)).filter(n => isFinite(n));

  async function fetchMarket(sosok) {
    let allRows = [];
    const maxPages = 7; // 약 10일 × 7 = 70거래일(약 3개월)
    for (let p = 1; p <= maxPages; p++) {
      const url = "https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=" + bizdate + "&sosok=" + sosok + "&page=" + p;
      let html = null;
      try {
        const r = await fetch(url, { headers, cf: { cacheTtl: 21600 } });
        if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); } }
      } catch (e) {}
      if (!html) break;
      const rowRe = /<td class="date2?">(\d{2}\.\d{2}\.\d{2})<\/td>([\s\S]*?)<\/tr>/g;
      let m, pageRows = [];
      while ((m = rowRe.exec(html)) !== null) {
        const nums = parseNums(m[2]);
        if (nums.length >= 3) {
          pageRows.push({ date: '20' + m[1].replace(/\./g, '-'), person: nums[0], foreign: nums[1], inst: nums[2] });
        }
      }
      if (!pageRows.length) break;
      allRows.push(...pageRows);
      if (allRows.length >= days) break;
    }
    return allRows;
  }

  const [kospiRows, kosdaqRows] = await Promise.all([fetchMarket("01"), fetchMarket("02")]);

  if (raw) return { ok: kospiRows.length > 0, kospiCount: kospiRows.length, kosdaqCount: kosdaqRows.length, kospiSample: kospiRows.slice(0,5), kosdaqSample: kosdaqRows.slice(0,5) };

  if (kospiRows.length || kosdaqRows.length) {
    const uniqBy = (arr) => { const seen = new Set(); return arr.filter(r => { if(seen.has(r.date)) return false; seen.add(r.date); return true; }); };
    const kU = uniqBy(kospiRows).slice(0, days);
    const qU = uniqBy(kosdaqRows).slice(0, days);
    const qMap2 = {}; qU.forEach(r => { qMap2[r.date] = r; });

    let rows = kU.map(r => {
      const q = qMap2[r.date];
      return {
        date: r.date,
        net: r.foreign,              // 외국인 순매수 (코스피, 기존 호환)
        person: r.person,
        inst: r.inst,
        buy: Math.max(r.foreign, 0),
        sell: Math.max(-r.foreign, 0),
        foreignKospi: r.foreign,     // 코스피 외국인 순매수
        foreignKosdaq: q ? q.foreign : null,  // 코스닥 외국인 순매수
        // 기관·개인도 시장별로 나눠 보낸다 (코스닥 볼 때 코스피 값이 섞이면 축이 왜곡됨)
        instKospi: r.inst,   personKospi: r.person,
        instKosdaq: q ? q.inst : null, personKosdaq: q ? q.person : null,
        kospi: null,
        kosdaq: null,
      };
    }).reverse(); // 과거→최근

    // 코스피·코스닥 종가 병합 (야후)
    try {
      const kospiData = await fetchOHLCV("^KS11", "6mo", "1d");
      const kosdaqData = await fetchOHLCV("^KQ11", "6mo", "1d");
      const kMap = {}, qMap = {};
      if (kospiData && kospiData.ohlcv) kospiData.ohlcv.forEach(o => { kMap[o.date] = o.close; });
      if (kosdaqData && kosdaqData.ohlcv) kosdaqData.ohlcv.forEach(o => { qMap[o.date] = o.close; });
      rows.forEach(r => {
        if (kMap[r.date] != null) r.kospi = Math.round(kMap[r.date] * 100) / 100;
        if (qMap[r.date] != null) r.kosdaq = Math.round(qMap[r.date] * 100) / 100;
      });
    } catch (e) {}

    return { ok: true, count: rows.length, rows };
  }
  return { ok: false, error: "no data" };
}

// ══════════════════════════════════════
// 외국인 순매수 상위 종목 (최근 5일 연속 순매수 일수)
// ══════════════════════════════════════
async function foreignTopStocks(raw, nocache) {
  const CT = nocache ? 0 : undefined;
  const headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/sise/" };
  const results = { kospi: [], kosdaq: [] };
  const debug = [];
  const today = kstYmd(0);

  // ── 코스피: 네이버 외국인 순매수 리스트(gubun=1000) ──
  {
    const url = "https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun=1000&type=buy&page=1&sosok=0";
    let html = null, status = 0;
    try {
      const r = await fetch(url, { headers, cf: { cacheTtl: CT != null ? CT : 3600 } });
      status = r.status;
      if (r.ok) { const buf = await r.arrayBuffer(); try { html = new TextDecoder("euc-kr").decode(buf); } catch(e) { html = new TextDecoder("utf-8").decode(buf); } }
    } catch (e) { status = -1; }
    if (raw) { let s = html ? html.search(/<table/) : -1; return { ok: !!html, url, status, raw: html ? html.slice(s<0?0:s, (s<0?0:s)+6000) : null }; }
    if (html) {
      const itemRe = /<a href="\/item\/main\.naver\?code=([0-9A-Z]{6})"[^>]*class="company"[^>]*>([^<]+)<\/a>/g;
      let m;
      while ((m = itemRe.exec(html)) !== null && results.kospi.length < 15) {
        if (!results.kospi.some(x => x.code === m[1])) results.kospi.push({ code: m[1], name: m[2].trim() });
      }
    }
    debug.push({ market: "kospi", count: results.kospi.length });
  }

  // ── 코스닥: 시총 상위 종목의 당일 외국인 순매수 조회 ──
  try {
    // 1) 코스닥 시총 상위 종목 코드 수집 (2페이지 = 약 100종목)
    const kosdaqCodes = [];
    for (let pg = 1; pg <= 2; pg++) {
      const su = "https://finance.naver.com/sise/sise_market_sum.naver?sosok=1&page=" + pg;
      const r = await fetch(su, { headers, cf: { cacheTtl: CT != null ? CT : 21600 } });
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch(e){ html = new TextDecoder("utf-8").decode(buf); }
      const re = /<a href="\/item\/main\.naver\?code=([0-9A-Z]{6})"[^>]*class="tltle"[^>]*>([^<]+)<\/a>/g;
      let m;
      while ((m = re.exec(html)) !== null) kosdaqCodes.push({ code: m[1], name: m[2].trim() });
    }
    debug.push({ kosdaqCodesFound: kosdaqCodes.length });

    // 2) 상위 40종목의 당일 외국인 순매수 확인 (frgn.naver)
    //    테이블 컬럼: 날짜|종가|전일비|등락률|거래량|기관순매매|외국인순매매|보유주수|보유율
    const topN = kosdaqCodes.slice(0, 40);
    for (const stk of topN) {
      if (results.kosdaq.length >= 15) break;
      try {
        const fu = "https://finance.naver.com/item/frgn.naver?code=" + stk.code;
        const r = await fetch(fu, { headers: {...headers, "Referer": fu}, cf: { cacheTtl: CT != null ? CT : 21600 } });
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch(e){ html = new TextDecoder("utf-8").decode(buf); }
        // "외국인 기관 순매매 거래량" 테이블만 추출
        const tblStart = html.indexOf('외국인 기관 순매매 거래량에 관한표');
        if (tblStart < 0) continue;
        const tblEnd = html.indexOf('</table>', tblStart);
        const tbl = html.slice(tblStart, tblEnd);
        // 첫 데이터 행: 날짜(YYYY.MM.DD)로 시작
        const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let rm, dataRow = null;
        while ((rm = rowRe.exec(tbl)) !== null) {
          if (/\d{4}\.\d{2}\.\d{2}/.test(rm[1])) { dataRow = rm[1]; break; }
        }
        if (!dataRow) continue;
        // 셀 값: [종가, 전일비, 거래량, 기관순매매, 외국인순매매, 보유주수]
        const cells = [...dataRow.matchAll(/<span[^>]*>\s*([+-]?[\d,]+)\s*<\/span>/g)].map(x=>parseInt(x[1].replace(/,/g,"")));
        // 외국인 순매매 = 뒤에서 2번째 (보유주수 앞)
        let frgnNet = null;
        if (cells.length >= 5) frgnNet = cells[cells.length - 2];
        if (frgnNet != null && frgnNet > 0) {
          results.kosdaq.push({ code: stk.code, name: stk.name, frgnNet });
        }
      } catch(e){}
    }
    // 외국인 순매수 큰 순 정렬
    results.kosdaq.sort((a,b) => (b.frgnNet||0) - (a.frgnNet||0));
    debug.push({ market: "kosdaq", count: results.kosdaq.length });
  } catch(e){ debug.push({ kosdaqError: String(e).slice(0,80) }); }

  return { ok: true, date: today, debug, kospi: results.kospi, kosdaq: results.kosdaq };
}

// sosok/page 조합 테스트 (코스닥·페이지네이션 확인)
async function gubunProbe() {
  const headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/sise/" };
  const out = [];
  // 코스닥 sosok 후보 + 페이지 테스트
  const combos = [
    { sosok: "0", page: "1", label: "코스피 p1" },
    { sosok: "1", page: "1", label: "코스닥 sosok1" },
    { sosok: "01", page: "1", label: "코스닥 sosok01" },
    { sosok: "2", page: "1", label: "코스닥 sosok2" },
    { sosok: "0", page: "2", label: "코스피 p2" },
  ];
  for (const c of combos) {
    const url = "https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun=1000&type=buy&page=" + c.page + "&sosok=" + c.sosok;
    try {
      const r = await fetch(url, { headers, cf: { cacheTtl: 0 } });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch(e) { html = new TextDecoder("utf-8").decode(buf); }
        const capM = html.match(/<caption>([^<]+)<\/caption>/);
        const items = [...html.matchAll(/code=([0-9A-Z]{6})"[^>]*class="company"[^>]*>([^<]+)</g)].map(m => m[2].trim());
        out.push({ label: c.label, caption: capM ? capM[1] : "(없음)", count: items.length, first3: items.slice(0,3) });
      } else {
        out.push({ label: c.label, status: r.status });
      }
    } catch (e) { out.push({ label: c.label, error: String(e).slice(0,50) }); }
  }
  return { ok: true, results: out };
}

// 코스닥 외국인 순매수 상위 소스 탐색
async function kosdaqProbe() {
  const headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json, text/plain, */*" };
  const out = [];

  // 1) 다음 금융 코스닥 외국인 매수 상위
  const daumUrls = [
    "https://finance.daum.net/api/trend/foreign?perPage=15&market=KOSDAQ&order=buy",
    "https://finance.daum.net/api/investors/trades?perPage=15&market=KOSDAQ&investor=foreign&order=buy",
  ];
  for (const u of daumUrls) {
    try {
      const r = await fetch(u, { headers: {...headers, "Referer":"https://finance.daum.net/domestic"}, cf:{cacheTtl:0} });
      const t = await r.text();
      out.push({ src: u.slice(30), status: r.status, sample: t.slice(0,200) });
    } catch(e){ out.push({ src: u.slice(30), error: String(e).slice(0,60) }); }
  }

  // 2) 네이버 외국인 매매 상위 페이지 (frgn.naver 시장 전체)
  const naverPages = [
    "https://finance.naver.com/sise/sise_deal_rank.naver?type=buy&sosok=1",
    "https://finance.naver.com/sise/sise_deal_rank.naver?type=buy&sosok=2",
    "https://finance.naver.com/sise/lastsearch2.naver",
  ];
  // KOSDAQ 대표 종목(에코프로 247540, 알테오젠 196170)이 나오는지로 판별
  for (const u of naverPages) {
    try {
      const r = await fetch(u, { headers:{"User-Agent":"Mozilla/5.0","Referer":"https://finance.naver.com/sise/"}, cf:{cacheTtl:0} });
      const buf = await r.arrayBuffer();
      let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch(e){ html = new TextDecoder("utf-8").decode(buf); }
      const cap = (html.match(/<caption>([^<]+)<\/caption>/)||[])[1] || "";
      const items = [...html.matchAll(/code=([0-9A-Z]{6})"[^>]*class="company"[^>]*>([^<]+)</g)].map(m=>({c:m[1],n:m[2].trim()}));
      out.push({ url: u.slice(35), caption: cap, count: items.length, first3: items.slice(0,3).map(x=>x.n) });
    } catch(e){ out.push({ url: u.slice(35), error: String(e).slice(0,60) }); }
  }

  // 3) 코스닥 시총 페이지에 외국인 순매수 정렬 옵션이 있는지 확인
  //    field=frgn_rate(외국인비율) 등으로 정렬 시도
  const kosdaqSise = "https://finance.naver.com/sise/sise_market_sum.naver?sosok=1&page=1";
  try {
    const r = await fetch(kosdaqSise, { headers:{"User-Agent":"Mozilla/5.0"}, cf:{cacheTtl:0} });
    const buf = await r.arrayBuffer();
    let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch(e){ html = new TextDecoder("utf-8").decode(buf); }
    // 헤더에 어떤 컬럼이 있는지 (외국인 관련)
    const headerMatch = html.match(/<thead[\s\S]*?<\/thead>/);
    const cols = headerMatch ? [...headerMatch[0].matchAll(/>([가-힣A-Za-z%]+)</g)].map(m=>m[1]).filter(x=>x.length>1) : [];
    out.push({ kosdaqSise: true, columns: cols.slice(0,20), htmlSample: html.slice(html.indexOf('<table'), html.indexOf('<table')+1500) });
  } catch(e){ out.push({ kosdaqSise: true, error: String(e).slice(0,60) }); }

  return { ok: true, results: out };
}

// 종목별 외국인 매매 페이지 구조 확인
async function frgnProbe(code) {
  const headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/item/frgn.naver?code=" + code };
  const url = "https://finance.naver.com/item/frgn.naver?code=" + code;
  try {
    const r = await fetch(url, { headers, cf:{cacheTtl:0} });
    const buf = await r.arrayBuffer();
    let html; try { html = new TextDecoder("euc-kr").decode(buf); } catch(e){ html = new TextDecoder("utf-8").decode(buf); }
    // 외국인 기관 순매매 테이블 첫 데이터 행 파싱
    const tblStart = html.indexOf('외국인 기관 순매매 거래량에 관한표');
    const tblEnd = html.indexOf('</table>', tblStart);
    const tbl = html.slice(tblStart, tblEnd);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rm, dataRow = null;
    while ((rm = rowRe.exec(tbl)) !== null) {
      if (/\d{4}\.\d{2}\.\d{2}/.test(rm[1])) { dataRow = rm[1]; break; }
    }
    const date = dataRow ? (dataRow.match(/(\d{4}\.\d{2}\.\d{2})/)||[])[1] : null;
    const cells = dataRow ? [...dataRow.matchAll(/<span[^>]*>\s*([+-]?[\d,]+(?:\.\d+)?)\s*<\/span>/g)].map(x=>x[1]) : [];
    return { ok:true, code, status:r.status, date, cells };
  } catch(e){ return { ok:false, error:String(e).slice(0,100) }; }
}

// ═══════════════════════════════════════════════════════════════
// 공매도/대차잔고 조회 (KRX 데이터 마켓플레이스 + 네이버 fallback)
// ═══════════════════════════════════════════════════════════════
function toISIN(code) {
  // 6자리 종목코드 → ISIN 코드 (KR7XXXXXX00C) 간이 변환
  // check digit 계산은 생략하고 여러 후보를 시도
  return "KR7" + code + "003";
}

async function krxLendBalance(code, days, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, code, error: "bad code" };

  const trdDd = kstYmd(0);
  const strtDd = kstYmd(30);
  const endDd = trdDd;
  const apiUrl = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
  const hdrs = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://data.krx.co.kr/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT300&isuCd=" + code,
    "Origin": "https://data.krx.co.kr",
    "X-Requested-With": "XMLHttpRequest",
  };

  const fullCode = codeToISIN(code);

  // 여러 bld + 파라미터 조합 시도
  const attempts = [
    // 개별종목 대차거래 (날짜 범위)
    { bld:"dbms/MDC_OUT/STAT/srt/MDCSTAT30001_OUT", isuCd:fullCode, strtDd, endDd },
    // 전체종목 대차잔고 (단일 날짜, KOSPI)
    { bld:"dbms/MDC/STAT/srt/MDCSTAT30501", searchType:"1", mktTpCd:"1", trdDd },
    // 전체종목 대차잔고 (단일 날짜, KOSDAQ)
    { bld:"dbms/MDC/STAT/srt/MDCSTAT30501", searchType:"1", mktTpCd:"2", trdDd },
    // 대차거래 추이 (전체 시장, 날짜 범위)
    { bld:"dbms/MDC/STAT/srt/MDCSTAT30801", strtDd, endDd },
    { bld:"dbms/MDC/STAT/srt/MDCSTAT30801", trdDd },
    { bld:"dbms/MDC/STAT/srt/MDCSTAT30801", searchType:"1", mktTpCd:"1", strtDd, endDd },
  ];

  const results = [];
  for (const params of attempts) {
    try {
      const body = new URLSearchParams(Object.assign({ locale:"ko_KR", share:"1", money:"1", csvxls_isNo:"false" }, params));
      const r = await fetch(apiUrl, { method:"POST", headers:hdrs, body:body.toString() });
      if (!r.ok) { results.push({ bld:params.bld, searchType:params.searchType, status:r.status }); continue; }
      const text = await r.text();
      if (text.startsWith("<!")) { results.push({ bld:params.bld, isHtml:true }); continue; }
      let d; try { d = JSON.parse(text); } catch(e) { results.push({ bld:params.bld, parseErr:true }); continue; }
      const arrKey = Object.keys(d).find(k => Array.isArray(d[k]));
      const arr = arrKey ? d[arrKey] : [];

      if (raw) {
        // 전체종목 데이터면 종목 매칭 시도
        let matched = null;
        if (arr.length > 10) {
          matched = arr.find(x => String(x.ISU_SRT_CD||x.ISU_CD||"").includes(code)) || null;
        }
        results.push({ bld:params.bld, searchType:params.searchType, count:arr.length, keys:arr.length?Object.keys(arr[0]):[], sample:arr.length?arr[0]:null, matched });
        if (matched || (arr.length > 0 && arr.length <= 60)) break;
        continue;
      }

      // 데이터 처리
      if (arr.length > 100) {
        // 전체종목 → 필터링
        const match = arr.find(x => String(x.ISU_SRT_CD||"").includes(code));
        if (match) return { ok:true, code, fullCode, source:"krx_lend", bld:params.bld, data:match };
      } else if (arr.length) {
        const parsed = arr.slice(0, days||20).map(row => {
          const o = {}; Object.keys(row).forEach(k => { o[k] = String(row[k]||"").replace(/,/g,""); }); return o;
        });
        return { ok:true, code, fullCode, source:"krx_lend", bld:params.bld, count:parsed.length, fields:Object.keys(arr[0]), data:parsed };
      }
    } catch(e) { results.push({ bld:params.bld, error:String(e).slice(0,100) }); }
  }
  if (raw) return { ok:true, source:"krx_lend_probe", code, fullCode, attempts:results };
  return { ok:false, code, error:"no lending data" };
}


async function krxShortSelling(code, days, raw) {
  code = String(code || "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, code, error: "bad code" };

  const endDd = kstYmd(0);
  const strtDd = kstYmd(Math.max(days || 20, 30) + 10); // 영업일 보정 여유
  const apiUrl = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
  const hdrs = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://data.krx.co.kr/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT300&isuCd=" + code,
    "Origin": "https://data.krx.co.kr",
    "X-Requested-With": "XMLHttpRequest",
  };

  const fullCode = codeToISIN(code);

  // 2단계: fullCode로 공매도 데이터 조회
  const attempts = [
    { bld: "dbms/MDC_OUT/STAT/srt/MDCSTAT30001_OUT", isuCd: fullCode, strtDd, endDd },
    { bld: "dbms/MDC/STAT/srt/MDCSTAT30101", searchType: "2", isuCd: fullCode, strtDd, endDd },
  ];

  for (const params of attempts) {
    try {
      const body = new URLSearchParams(Object.assign({ locale: "ko_KR", share: "1", money: "1", csvxls_isNo: "false" }, params));
      const r = await fetch(apiUrl, { method: "POST", headers: hdrs, body: body.toString() });
      if (!r.ok) continue;
      const d = await r.json();
      const arrKey = Object.keys(d).find(k => Array.isArray(d[k]) && d[k].length > 0);
      if (!arrKey) { if(raw) continue; continue; }
      const arr = d[arrKey].slice(0, days || 20);
      const parsed = arr.map(row => {
        const o = {}; Object.keys(row).forEach(k => { o[k] = String(row[k] || "").replace(/,/g, ""); }); return o;
      });
      return { ok: true, code, fullCode, source: "krx", bld: params.bld, count: parsed.length, fields: Object.keys(arr[0]), data: parsed };
    } catch(e) {}
  }
  if(raw) return { ok: false, code, fullCode, error: "data query failed - tried all blds" };
  return { ok: false, code, fullCode, error: "data query failed" };
}

// 종목코드 → ISIN 직접 변환 (Luhn 체크디짓 계산)
function codeToISIN(code) {
  const base = "KR7" + code + "00";
  let digits = "";
  for (const ch of base) {
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) digits += ch;
    else digits += (c - 55);
  }
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const pos = digits.length - i;
    let d = parseInt(digits[i]);
    if (pos % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return base + ((10 - (sum % 10)) % 10);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", ...CORS },
  });
}

// ══════════════════════════════════════
// 외국인·기관 순매수/순매도 상위 종목 (일간)
//   출처: stock.naver.com /api/domestic/market/trend/trendForeignOrg
//   investorType FOREIGNER|ORGANIZATION · marketType KOSPI|KOSDAQ
//   periodType DAY · tradeType KRX  → buyRankList + sellRankList 를 함께 준다
//   장중에는 estimated:true 이고 accTradeAmount 가 0 이라 수량×현재가로 대신한다
// ══════════════════════════════════════
async function trendRank(n, env, fresh) {
  n = Math.max(1, Math.min(n || 10, 20));
  const ckey = "trank:" + n;
  if (!fresh) {
    const cached = await kvGet(env, ckey);
    if (cached) return cached;
  }

  const pageUrl = "https://stock.naver.com/market/stock/kr/trend/foreigner";
  const H = { "User-Agent": UA, "Accept": "application/json, text/plain, */*",
              "Accept-Language": "ko-KR,ko;q=0.9", "Referer": pageUrl };
  const BASE = "https://stock.naver.com/api/domestic/market/trend/trendForeignOrg";
  const nf = v => { const x = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(x) ? x : null; };

  const mkRow = (o, sign) => {
    if (!o) return null;
    const code = String(o.itemcode || "").replace(/[^0-9]/g, "");
    if (code.length !== 6) return null;
    const vol = Math.abs(nf(o.accTradeVolume) || 0);
    const price = nf(o.nowPrice);
    let won = Math.abs(nf(o.accTradeAmount) || 0), est = false;
    if (!won) { won = price ? vol * price : 0; est = true; }   // 장중 잠정치 대체
    return {
      code, name: String(o.itemname || ""),
      amt: won ? Math.round(sign * won / 1e8) : null,          // 억원
      amtEst: est || undefined,
      vol: sign * vol,
      price, rate: nf(o.prevChangeRate),
      to: o.bizdateTo || null,
    };
  };

  // 장중 잠정치는 네이버가 수량 순으로 주므로, 넉넉히 받아 금액 순으로 다시 세운다
  const byAmt = (list, sign) => list.map(o => mkRow(o, sign)).filter(Boolean)
    .sort((a, b) => Math.abs(b.amt || 0) - Math.abs(a.amt || 0)).slice(0, n);

  const one = async (marketType, investorType) => {
    const q = new URLSearchParams({ investorType, tradeType: "KRX", marketType,
                                    startIdx: "0", pageSize: String(Math.min(50, n * 4)),
                                    periodType: "DAY" });
    try {
      const r = await fetch(BASE + "?" + q.toString(), { headers: H, cf: { cacheTtl: 0 } });
      if (!r.ok) return null;
      const j = await r.json();
      const sc = (j && j.sections) || {};
      const bl = Array.isArray(sc.buyRankList) ? sc.buyRankList : [];
      const sl = Array.isArray(sc.sellRankList) ? sc.sellRankList : [];
      const head = bl[0] || sl[0] || {};
      return {
        buy: byAmt(bl, 1),
        sell: byAmt(sl, -1),
        estimated: head.estimated === true,
        date: head.bizdateTo || null,
        rankedAt: head.toRankingAt || null,
      };
    } catch (e) { return null; }
  };

  const [kf, ki, qf, qi] = await Promise.all([
    one("KOSPI", "FOREIGNER"), one("KOSPI", "ORGANIZATION"),
    one("KOSDAQ", "FOREIGNER"), one("KOSDAQ", "ORGANIZATION"),
  ]);
  if (!kf && !ki && !qf && !qi) return { ok: false, error: "no data" };

  const pair = g => g ? { buy: g.buy, sell: g.sell, date: g.date || null,
                          estimated: !!g.estimated, rankedAt: g.rankedAt || null }
                     : { buy: [], sell: [], date: null, estimated: false, rankedAt: null };
  const d8 = (kf && kf.date) || (ki && ki.date) || (qf && qf.date) || (qi && qi.date) || null;
  const out = {
    ok: true,
    date: (d8 && /^\d{8}$/.test(d8)) ? (d8.slice(0, 4) + "-" + d8.slice(4, 6) + "-" + d8.slice(6, 8)) : d8,
    estimated: !!((kf && kf.estimated) || (qf && qf.estimated) || (ki && ki.estimated) || (qi && qi.estimated)),
    rankedAt: (kf && kf.rankedAt) || (qf && qf.rankedAt) || null,
    fetchedAt: new Date().toISOString(),
    kospi:  { frgn: pair(kf), inst: pair(ki) },
    kosdaq: { frgn: pair(qf), inst: pair(qi) },
  };
  await kvSet(env, ckey, out);
  return out;
}

// ══════════════════════════════════════
// 투자자별 순매수/순매도 상위 종목 — 자료 출처 탐색용 프로브
//   ?trankprobe=naver → 네이버 sise_deal_rank 의 investor_gubun 별 표 구조
//   ?trankprobe=krx   → KRX 후보 bld 별 응답
// ══════════════════════════════════════
async function trankProbe(mode) {
  // ── KRX: 400 응답 본문까지 찍어 필요한 파라미터를 확인 ──
  if (mode === "krx2") {
    const endDd = kstYmd(1), strtDd = kstYmd(8);
    const post = async (params) => {
      try {
        const r = await fetch(KRX_URL, { method: "POST", headers: KRX_HDR,
                                         body: new URLSearchParams(params).toString() });
        const t = await r.text();
        return { status: r.status, body: t.slice(0, 300) };
      } catch (e) { return { status: 0, body: String(e).slice(0, 120) }; }
    };
    const blds = [
      "dbms/MDC/STAT/standard/MDCSTAT02201","dbms/MDC/STAT/standard/MDCSTAT02202",
      "dbms/MDC/STAT/standard/MDCSTAT02203","dbms/MDC/STAT/standard/MDCSTAT02301",
      "dbms/MDC/STAT/standard/MDCSTAT02302","dbms/MDC/STAT/standard/MDCSTAT02401",
      "dbms/MDC/STAT/standard/MDCSTAT02501","dbms/MDC/STAT/standard/MDCSTAT02601",
      "dbms/MDC/STAT/standard/MDCSTAT02701","dbms/MDC/STAT/standard/MDCSTAT01602",
    ];
    const out = [];
    for (const bld of blds) {
      const full = await post({ bld, locale: "ko_KR", mktId: "STK", invstTpCd: "9000",
                                trdDd: endDd, strtDd, endDd, askBid: "3", detailView: "1",
                                share: "1", money: "1", csvxls_isNo: "false" });
      const bare = await post({ bld, locale: "ko_KR", trdDd: endDd });
      out.push({ bld: bld.slice(-11), full, bare });
      await usSleep(120);
    }
    return { ok: true, mode: "krx2", strtDd, endDd, results: out };
  }

  // ── trendForeignOrg 파라미터 값 확정 ──
  if (mode === "nvenum") {
    const pageUrl = "https://stock.naver.com/market/stock/kr/trend/foreigner";
    const AH = { "User-Agent": UA, "Accept": "application/json, text/plain, */*",
                 "Accept-Language": "ko-KR,ko;q=0.9", "Referer": pageUrl };
    const base = "https://stock.naver.com/api/domestic/market/trend/trendForeignOrg";
    const test = async (q) => {
      try {
        const r = await fetch(base + "?" + q, { headers: AH, cf: { cacheTtl: 0 } });
        const t = await r.text();
        if (r.status !== 200) {
          const d = (t.match(/detail\\?":\\?"([^"\\]{0,120})/) || [])[1] || t.slice(0, 150);
          return { q, status: r.status, detail: d };
        }
        let first = null, buyN = 0, sellN = 0;
        try {
          const j = JSON.parse(t);
          const sc = (j && j.sections) || {};
          buyN = (sc.buyRankList || []).length;
          sellN = (sc.sellRankList || []).length;
          first = (sc.buyRankList || [])[0] || null;
        } catch (e) {}
        return { q, status: 200, buyN, sellN, first };
      } catch (e) { return { q, error: String(e).slice(0, 80) }; }
    };
    const qs = [];
    ["FOREIGNER","ORGANIZATION","INSTITUTION"].forEach(v => qs.push("investorType=" + v));
    ["KOSPI","KOSDAQ","ALL"].forEach(v => qs.push("marketType=" + v));
    ["DAY","WEEK","MONTH","ONE_DAY","ONE_WEEK","ONE_MONTH","THREE_MONTH"].forEach(v => qs.push("periodType=" + v));
    ["KRX","NXT"].forEach(v => qs.push("tradeType=" + v));
    const out = [];
    for (const q of qs) { out.push(await test(q)); await usSleep(90); }
    return { ok: true, mode: "nvenum", results: out };
  }

  // ── trendForeignOrg API 파라미터 확인 ──
  if (mode === "nvapi") {
    const CDN = "https://ssl.pstatic.net/imgstock/fn/real/pc";
    const pageUrl = "https://stock.naver.com/market/stock/kr/trend/foreigner";
    const out = {};

    // (1) 라우트 청크에서 trendForeignOrg 앞뒤를 그대로 본다
    try {
      const ph = await (await fetch(pageUrl, {
        headers: { "User-Agent": UA, "Accept": "text/html,*/*", "Referer": "https://stock.naver.com/" }
      })).text();
      const src = ((ph.match(/<script[^>]+src="([^"]*trend\/foreigner\/page-[^"]+)"/) || [])[1]) || "";
      out.chunkSrc = src;
      if (src) {
        const u = src.startsWith("http") ? src : CDN + (src.startsWith("/") ? src : "/" + src);
        const t = await (await fetch(u, { headers: { "User-Agent": UA, "Referer": pageUrl } })).text();
        out.chunkLen = t.length;
        const slices = [];
        let i = -1;
        while ((i = t.indexOf("trendForeignOrg", i + 1)) >= 0 && slices.length < 3) {
          slices.push(t.slice(Math.max(0, i - 1200), i + 1500));
        }
        out.slices = slices;
      }
    } catch (e) { out.chunkError = String(e).slice(0, 100); }

    // (2) API 직접 호출 시도
    const AH = { "User-Agent": UA, "Accept": "application/json, text/plain, */*",
                 "Accept-Language": "ko-KR,ko;q=0.9", "Referer": pageUrl };
    const base = "https://stock.naver.com/api/domestic/market/trend/trendForeignOrg";
    const qs = [
      "",
      "?market=KOSPI&period=1D",
      "?marketType=KOSPI&periodType=DAY&investorType=FOREIGNER",
      "?market=KOSPI&periodCode=1D&investor=FOREIGNER",
      "?marketCode=KOSPI&periodType=1D&trendType=FOREIGNER&page=1&pageSize=10",
    ];
    out.api = [];
    for (const q of qs) {
      try {
        const r = await fetch(base + q, { headers: AH, cf: { cacheTtl: 0 } });
        const t = await r.text();
        out.api.push({ q: q || "(없음)", status: r.status, body: t.slice(0, 400) });
      } catch (e) { out.api.push({ q: q || "(없음)", error: String(e).slice(0, 80) }); }
      await usSleep(120);
    }
    return { ok: true, mode: "nvapi", out };
  }

  // ── 구 네이버 sise_deal_rank 표 구조 정밀 확인 ──
  if (mode === "rank2") {
    const H = { "User-Agent": UA, "Referer": "https://finance.naver.com/sise/" };
    const grab = async (label, u) => {
      try {
        const r = await fetch(u, { headers: H, cf: { cacheTtl: 0 } });
        if (!r.ok) return { label, status: r.status };
        const buf = await r.arrayBuffer();
        let html;
        try { html = new TextDecoder("euc-kr").decode(buf); }
        catch (e) { html = new TextDecoder("utf-8").decode(buf); }
        // 본문 표만 본다: class 에 type_ 이 들어간 표
        const tabs = [];
        const tRe = /<table[^>]*>[\s\S]*?<\/table>/g;
        let tm, idx = 0;
        while ((tm = tRe.exec(html)) !== null && tabs.length < 10) {
          const tb = tm[0];
          if (!/item\/main\.naver\?code=/.test(tb)) { idx++; continue; }
          // 표 바로 앞 600자에서 제목·날짜를 찾는다
          const before = html.slice(Math.max(0, tm.index - 700), tm.index)
            .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
          const th = [...tb.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
            .map(m => m[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim())
            .filter(Boolean).slice(0, 10);
          const rows = [];
          const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
          let rm;
          while ((rm = trRe.exec(tb)) !== null && rows.length < 4) {
            if (!/item\/main\.naver\?code=/.test(rm[1])) continue;
            const code = (rm[1].match(/code=([0-9A-Z]{6})/) || [])[1] || "";
            const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
              .map(x => x[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
            rows.push({ code, cells });
          }
          tabs.push({ i: idx, lead: before.slice(-160), th, rows });
          idx++;
        }
        return { label, status: 200, len: html.length, tableCount: tabs.length, tabs };
      } catch (e) { return { label, error: String(e).slice(0, 80) }; }
    };
    const B = "https://finance.naver.com/sise/sise_deal_rank.naver";
    const out = [];
    out.push(await grab("외국인·코스피", B + "?investor_gubun=9000"));
    await usSleep(200);
    out.push(await grab("기관·코스닥", B + "?sosok=02&investor_gubun=1000"));
    return { ok: true, mode: "rank2", results: out };
  }

  // ── 새 네이버 증권: 스크립트에서 /api/ 주소 찾기 (ssl.pstatic.net 경로 보정) ──
  if (mode === "nvnew3") {
    const CDN = "https://ssl.pstatic.net/imgstock/fn/real/pc";
    const pageUrl = "https://stock.naver.com/market/stock/kr/trend/foreigner";
    const H = { "User-Agent": UA, "Accept": "text/html,*/*",
                "Accept-Language": "ko-KR,ko;q=0.9", "Referer": "https://stock.naver.com/" };
    const out = {};
    let html = "";
    try {
      const r = await fetch(pageUrl, { headers: H, cf: { cacheTtl: 0 } });
      out.pageStatus = r.status;
      html = await r.text();
    } catch (e) { out.pageError = String(e).slice(0, 100); return { ok: true, mode: "nvnew3", out }; }

    const srcs = [...new Set((html.match(/<script[^>]+src="([^"]+)"/g) || [])
      .map(t => (t.match(/src="([^"]+)"/) || [])[1]).filter(Boolean))];
    const abs = u => u.startsWith("http") ? u
                   : (u.startsWith("/_next") ? CDN + u : CDN + "/" + u.replace(/^\//, ""));
    out.srcs = srcs.map(u => u.replace(CDN, "~"));

    // 라우트용 청크(app/) 를 먼저 본다
    const ordered = srcs.slice().sort((a, b) => {
      const A = /app\//.test(a) ? 0 : 1, B = /app\//.test(b) ? 0 : 1; return A - B;
    });
    const findApi = (t) => {
      const hits = new Set();
      let m;
      const re1 = /["'`](\/api\/[^"'`\s\\]{2,120})["'`]/g;
      while ((m = re1.exec(t)) !== null) hits.add(m[1]);
      const re2 = /["'`]([^"'`\s\\]{0,60}(?:foreigner|organization|investor|netPurchase|trend)[^"'`\s\\]{0,80})["'`]/gi;
      while ((m = re2.exec(t)) !== null) hits.add(m[1]);
      return [...hits];
    };
    out.chunks = [];
    for (const u of ordered.slice(0, 10)) {
      try {
        const r = await fetch(abs(u), { headers: { "User-Agent": UA, "Referer": pageUrl } });
        if (!r.ok) { out.chunks.push({ src: u.slice(-40), status: r.status }); continue; }
        const t = await r.text();
        const hits = findApi(t);
        if (hits.length) out.chunks.push({ src: u.slice(-40), len: t.length, hits: hits.slice(0, 30) });
        else out.chunks.push({ src: u.slice(-40), len: t.length, hits: [] });
      } catch (e) { out.chunks.push({ src: u.slice(-40), error: String(e).slice(0, 60) }); }
      await usSleep(80);
    }
    return { ok: true, mode: "nvnew3", out };
  }

  // ── 새 네이버 증권 페이지 HTML 안의 자료 모양 확인 ──
  if (mode === "nvnew2") {
    const H = { "User-Agent": UA, "Accept": "text/html,*/*",
                "Accept-Language": "ko-KR,ko;q=0.9", "Referer": "https://stock.naver.com/" };
    const grab = async (u) => {
      try {
        const r = await fetch(u, { headers: H, cf: { cacheTtl: 0 } });
        if (!r.ok) return { url: u, status: r.status };
        const t = await r.text();
        const marks = ["순매수", "netPurchase", "netBuy", "itemCode", "stockName", "amount"];
        const found = {};
        marks.forEach(k => { const i = t.indexOf(k); if (i >= 0) found[k] = i; });
        const first = Object.keys(found).length
          ? Math.min(...Object.keys(found).map(k => found[k])) : -1;
        return {
          url: u.replace("https://stock.naver.com", ""),
          status: r.status, len: t.length, found,
          slice: first >= 0 ? t.slice(Math.max(0, first - 300), first + 1700) : null,
        };
      } catch (e) { return { url: u, error: String(e).slice(0, 80) }; }
    };
    const base = "https://stock.naver.com/market/stock/kr/trend/foreigner";
    const out = [];
    out.push(await grab(base));
    await usSleep(150);
    out.push(await grab(base + "?market=KOSDAQ&period=1D"));
    return { ok: true, mode: "nvnew2", results: out };
  }

  // ── 새 네이버 증권(stock.naver.com) 투자자별 매매동향 API 찾기 ──
  if (mode === "nvnew") {
    const H = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*",
                "Accept-Language": "ko-KR,ko;q=0.9", "Referer": "https://stock.naver.com/" };
    const pageUrl = "https://stock.naver.com/market/stock/kr/trend/foreigner";
    const out = { pageUrl };
    let html = "";
    try {
      const r = await fetch(pageUrl, { headers: H, cf: { cacheTtl: 0 } });
      out.pageStatus = r.status;
      html = await r.text();
      out.pageLen = html.length;
    } catch (e) { out.pageError = String(e).slice(0, 100); return { ok: true, mode: "nvnew", out }; }

    const pick = (txt) => {
      const hits = new Set();
      const res = [
        /https?:\/\/[a-z0-9.\-]*stock\.naver\.com\/[^"'`\s\\]{3,140}/gi,
        /["'`](\/api\/[^"'`\s\\]{3,140})["'`]/g,
        /["'`]([^"'`\s\\]{0,40}\/(?:investor|foreigner|institution|trend)[^"'`\s\\]{0,100})["'`]/gi,
      ];
      res.forEach(re => {
        let m;
        while ((m = re.exec(txt)) !== null) {
          const v = (m[1] || m[0]);
          if (/investor|foreign|institution|trend|program|market/i.test(v)) hits.add(v);
        }
      });
      return [...hits];
    };

    out.fromHtml = pick(html).slice(0, 40);
    out.hasNextData = /__NEXT_DATA__|__NUXT__|window\.__/.test(html);

    // 스크립트 파일 몇 개를 열어 API 주소 문자열을 찾는다
    const srcs = [...new Set((html.match(/<script[^>]+src="([^"]+)"/g) || [])
      .map(t => (t.match(/src="([^"]+)"/) || [])[1]).filter(Boolean))];
    out.scriptCount = srcs.length;
    const abs = u => u.startsWith("http") ? u : ("https://stock.naver.com" + (u.startsWith("/") ? "" : "/") + u);
    const chunks = srcs.filter(u => /\.js(\?|$)/.test(u)).slice(0, 6);
    out.fromScripts = [];
    for (const u of chunks) {
      try {
        const r = await fetch(abs(u), { headers: { "User-Agent": UA, "Referer": pageUrl } });
        if (!r.ok) { out.fromScripts.push({ src: u.slice(-45), status: r.status }); continue; }
        const t = await r.text();
        const hits = pick(t).slice(0, 25);
        out.fromScripts.push({ src: u.slice(-45), len: t.length, hits });
      } catch (e) { out.fromScripts.push({ src: u.slice(-45), error: String(e).slice(0, 60) }); }
      await usSleep(100);
    }
    return { ok: true, mode: "nvnew", out };
  }

  // ── KRX: 세션 쿠키를 받아온 뒤 bld 훑기 ──
  if (mode === "krx3") {
    const endDd = kstYmd(1), strtDd = kstYmd(8);
    const pageUrl = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020103";
    let cookie = "", pageStatus = 0, blds = [];
    try {
      const pr = await fetch(pageUrl, { headers: { "User-Agent": UA, "Accept": "text/html" }, cf: { cacheTtl: 0 } });
      pageStatus = pr.status;
      const sc = pr.headers.get("set-cookie") || "";
      cookie = (sc.match(/(?:JSESSIONID|__smVisitorID|SCOUTER)=[^;,\s]+/g) || []).join("; ");
      const html = await pr.text();
      blds = [...new Set((html.match(/MDCSTAT\d{5}/g) || []))].slice(0, 20);
    } catch (e) { pageStatus = -1; }

    const H2 = Object.assign({}, KRX_HDR);
    if (cookie) H2["Cookie"] = cookie;
    const post = async (params) => {
      try {
        const r = await fetch(KRX_URL, { method: "POST", headers: H2,
                                         body: new URLSearchParams(params).toString() });
        const t = await r.text();
        let rows = 0;
        try { const j = JSON.parse(t); const a = krxRows(j); rows = a ? a.length : 0; } catch (e) {}
        return { status: r.status, rows, body: t.slice(0, 260) };
      } catch (e) { return { status: 0, body: String(e).slice(0, 120) }; }
    };

    const cands = [
      "dbms/MDC/STAT/standard/MDCSTAT01602",
      "dbms/MDC/STAT/standard/MDCSTAT02201","dbms/MDC/STAT/standard/MDCSTAT02202",
      "dbms/MDC/STAT/standard/MDCSTAT02203","dbms/MDC/STAT/standard/MDCSTAT02301",
      "dbms/MDC/STAT/standard/MDCSTAT02302","dbms/MDC/STAT/standard/MDCSTAT02303",
      "dbms/MDC/STAT/standard/MDCSTAT02401","dbms/MDC/STAT/standard/MDCSTAT02402",
      "dbms/MDC/STAT/standard/MDCSTAT02403","dbms/MDC/STAT/standard/MDCSTAT02501",
      "dbms/MDC/STAT/standard/MDCSTAT02502","dbms/MDC/STAT/standard/MDCSTAT02601",
    ];
    blds.forEach(b => { const f = "dbms/MDC/STAT/standard/" + b; if (!cands.includes(f)) cands.push(f); });

    const out = [];
    for (const bld of cands.slice(0, 16)) {
      const r = await post({ bld, locale: "ko_KR", mktId: "STK", invstTpCd: "9000",
                             trdDd: endDd, strtDd, endDd, inqTpCd: "1", trdVolVal: "2",
                             askBid: "3", detailView: "1", share: "1", money: "1",
                             csvxls_isNo: "false" });
      out.push({ bld: bld.slice(-11), status: r.status, rows: r.rows, body: r.body });
      await usSleep(120);
    }
    return { ok: true, mode: "krx3", pageStatus, cookie: cookie ? cookie.slice(0, 60) : "(없음)",
             bldsInPage: blds, strtDd, endDd, results: out };
  }

  // ── 네이버 sise_deal_rank 페이지 구조 통째로 보기 ──
  if (mode === "naverdump") {
    const H = { "User-Agent": UA, "Referer": "https://finance.naver.com/sise/" };
    const grab = async (gubun, sosok) => {
      const u = "https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun=" + gubun +
                "&type=buy&page=1&sosok=" + sosok;
      try {
        const r = await fetch(u, { headers: H, cf: { cacheTtl: 0 } });
        if (!r.ok) return { gubun, sosok, status: r.status };
        const buf = await r.arrayBuffer();
        let html;
        try { html = new TextDecoder("euc-kr").decode(buf); }
        catch (e) { html = new TextDecoder("utf-8").decode(buf); }
        const tables = [];
        const tRe = /<table[\s\S]*?<\/table>/g;
        let tm;
        while ((tm = tRe.exec(html)) !== null && tables.length < 8) {
          const tb = tm[0];
          const cap = ((tb.match(/<caption>([\s\S]*?)<\/caption>/) || [])[1] || "")
                        .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          const th = [...tb.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
                       .map(m => m[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim())
                       .filter(Boolean).slice(0, 12);
          const rows = [];
          const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
          let rm;
          while ((rm = trRe.exec(tb)) !== null && rows.length < 3) {
            const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
              .map(x => x[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
            if (cells.length >= 3) rows.push(cells);
          }
          if (cap || th.length || rows.length) tables.push({ caption: cap, th, rows });
        }
        return { gubun, sosok, status: 200, len: html.length, tables };
      } catch (e) { return { gubun, sosok, error: String(e).slice(0, 80) }; }
    };
    const out = [];
    for (const [g, sk] of [["1000","0"],["9000","0"],["1000","1"],["1000","01"],["1000","2"],["1000","02"],["1000",""]]) {
      out.push(await grab(g, sk));
      await usSleep(120);
    }
    return { ok: true, mode: "naverdump", results: out };
  }

  // ── 다음 금융 API 후보 훑기 ──
  if (mode === "daum") {
    const H = { "User-Agent": UA, "Accept": "application/json, text/plain, */*",
                "Referer": "https://finance.daum.net/domestic/investors" };
    const urls = [
      "https://finance.daum.net/api/investors/trades?page=1&perPage=10&market=KOSPI&investor=FOREIGN&order=buy&period=DAY",
      "https://finance.daum.net/api/investors/rank?market=KOSPI&investor=FOREIGN&order=buy&perPage=10",
      "https://finance.daum.net/api/investor/trades?page=1&perPage=10&market=KOSPI&investor=foreign",
      "https://finance.daum.net/api/trend/foreign?perPage=10&market=KOSPI&order=buy",
      "https://finance.daum.net/api/trend/institution?perPage=10&market=KOSPI&order=buy",
      "https://finance.daum.net/api/investor/stocks?market=KOSPI&investor=foreign&order=buy&perPage=10",
      "https://finance.daum.net/api/investor/days?page=1&perPage=3&terms=days&pagination=true",
      "https://finance.daum.net/api/quotes/investors?market=KOSPI&perPage=10",
    ];
    const out = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: H, cf: { cacheTtl: 0 } });
        const t = await r.text();
        out.push({ url: u.replace("https://finance.daum.net/api/", ""), status: r.status, body: t.slice(0, 280) });
      } catch (e) { out.push({ url: u.slice(30), error: String(e).slice(0, 80) }); }
      await usSleep(120);
    }
    return { ok: true, mode: "daum", results: out };
  }

  if (mode === "krx") {
    const endDd = kstYmd(1), strtDd = kstYmd(8);
    const blds = [
      "dbms/MDC/STAT/standard/MDCSTAT02201",
      "dbms/MDC/STAT/standard/MDCSTAT02203",
      "dbms/MDC/STAT/standard/MDCSTAT02301",
      "dbms/MDC/STAT/standard/MDCSTAT02302",
      "dbms/MDC/STAT/standard/MDCSTAT02303",
      "dbms/MDC/STAT/standard/MDCSTAT02401",
      "dbms/MDC/STAT/standard/MDCSTAT02402",
      "dbms/MDC/STAT/standard/MDCSTAT02403",
      "dbms/MDC/STAT/standard/MDCSTAT02501",
      "dbms/MDC/STAT/standard/MDCSTAT02502",
    ];
    const out = [];
    for (const bld of blds) {
      const r = await krxPost2({
        bld, mktId: "STK", invstTpCd: "9000", trdDd: endDd,
        strtDd, endDd, askBid: "3", detailView: "1",
        share: "1", money: "1", csvxls_isNo: "false",
      });
      const rows = krxRows(r.json);
      out.push({
        bld: bld.slice(-11),
        status: r.status + (r.empty ? "(빈응답)" : ""),
        keys: r.json ? Object.keys(r.json).slice(0, 6) : null,
        rows: rows ? rows.length : 0,
        first: rows && rows.length ? rows[0] : null,
      });
      await usSleep(120);
    }
    return { ok: true, mode: "krx", strtDd, endDd, results: out };
  }

  // ── 네이버 sise_deal_rank ──
  const headers = { "User-Agent": UA, "Referer": "https://finance.naver.com/sise/" };
  const read = async (gubun, sosok, type) => {
    const u = "https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun=" + gubun +
              "&type=" + type + "&page=1&sosok=" + sosok;
    try {
      const r = await fetch(u, { headers, cf: { cacheTtl: 0 } });
      if (!r.ok) return { gubun, sosok, type, status: r.status };
      const buf = await r.arrayBuffer();
      let html;
      try { html = new TextDecoder("euc-kr").decode(buf); }
      catch (e) { html = new TextDecoder("utf-8").decode(buf); }
      const cap = (html.match(/<caption>([\s\S]*?)<\/caption>/) || [])[1] || "";
      const head = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
        .map(m => m[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim())
        .filter(Boolean).slice(0, 12);
      const rows = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let m;
      while ((m = trRe.exec(html)) !== null && rows.length < 3) {
        if (!/item\/main\.naver\?code=/.test(m[1])) continue;
        const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
          .map(x => x[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
        rows.push(cells);
      }
      return { gubun, sosok, type, status: 200,
               caption: cap.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(), head, rows };
    } catch (e) { return { gubun, sosok, type, error: String(e).slice(0, 60) }; }
  };
  const out = [];
  for (const g of ["1000", "2000", "3000", "4000", "5000", "6000", "7000", "8000", "9000"]) {
    out.push(await read(g, "0", "buy"));
    await usSleep(100);
  }
  out.push(await read("1000", "1", "buy"));
  out.push(await read("1000", "0", "sell"));
  return { ok: true, mode: "naver", results: out };
}
