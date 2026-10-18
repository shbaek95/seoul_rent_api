// 서버에서만 키를 사용한다. 원본 URL과 원본 오류 문자열은 응답·로그에 출력하지 않는다.
export const SERVICE = 'tbLnOpendataRentV';
export const TYPES = ['아파트', '연립다세대', '단독다가구', '오피스텔'];
const PAGE = 1000;
class PublicError extends Error { constructor(message, status=502) { super(message); this.status=status; } }
function money(value) {
  const s=String(value ?? '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) return null;
  const n=Number(s.replaceAll(',',''));
  return Number.isSafeInteger(n) ? n : null;
}
export function aggregate(rows, filter) {
  const result={sum:0,count:0,excluded:{notJeonse:0,invalidMoney:0}};
  // 반복문으로 개별 거래의 합계와 건수를 더한다. 같은 금액의 거래도 삭제하지 않는다.
  for (const row of rows) {
    if (String(row.RCPT_YR)!==filter.year || String(row.CGG_CD)!==filter.district || String(row.STDG_CD)!==filter.dong || row.BLDG_USG!==filter.type)
      throw new PublicError('API 검색 조건과 응답이 일치하지 않습니다. 집계를 중단했습니다.');
    if (row.RENT_SE!=='전세') { result.excluded.notJeonse++; continue; }
    const deposit=money(row.GRFE), rent=money(row.RTFE);
    if (deposit===null || deposit<=0 || rent!==0) { result.excluded.invalidMoney++; continue; }
    result.sum+=deposit; result.count++;
    if (!Number.isSafeInteger(result.sum)) throw new PublicError('금액 합계의 안전 범위를 초과했습니다.');
  }
  return result;
}
export async function collect(filter,key,fetcher=fetch) {
  async function page(start,end) {
    // 선택 인자 순서는 서울시 공식 명세 순서. 공란은 공백 한 칸으로 URL 인코딩한다.
    const args=[filter.year,filter.district,' ',filter.dong,' ',' ',' ',' ',' ',filter.type];
    const url=`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/${SERVICE}/${start}/${end}/${args.map(encodeURIComponent).join('/')}`;
    let response, body;
    try { response=await fetcher(url,{signal:AbortSignal.timeout(20000)}); }
    catch { throw new PublicError('서울 API 연결 실패 또는 시간 초과입니다. 다시 조회해 주세요.',504); }
    if (response.status===429) throw new PublicError('서울 API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',429);
    if (!response.ok) throw new PublicError('서울 API가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.');
    try { body=await response.json(); } catch { throw new PublicError('서울 API 응답 형식이 올바르지 않습니다.'); }
    const data=body[SERVICE], code=(data?.RESULT ?? body.RESULT)?.CODE;
    if (code==='INFO-200') return {rows:[],total:0};
    if (code==='INFO-100') throw new PublicError('서울 API 인증에 실패했습니다. 서버의 키 설정을 확인해 주세요.',503);
    if (code!=='INFO-000' || !Array.isArray(data?.row)) throw new PublicError('서울 API 오류 또는 예상하지 못한 응답입니다.');
    const total=Number(data.list_total_count);
    if (!Number.isSafeInteger(total) || total<0) throw new PublicError('API 전체 건수를 확인할 수 없습니다.');
    return {rows:data.row,total};
  }
  const first=await page(1,PAGE), total=first.total;
  // 한 요청의 외부 호출을 최대 40회로 제한. 초과 시 부분 평균을 반환하지 않는다.
  if (total>PAGE*40) throw new PublicError('해당 동의 거래가 실행 한도를 초과했습니다. 전체 집계를 제공할 수 없습니다.',422);
  let seen=0;
  const combined={sum:0,count:0,excluded:{notJeonse:0,invalidMoney:0}};
  function add(p,start) {
    if (p.total!==total || p.rows.length!==Math.min(PAGE,total-start+1)) throw new PublicError('조회 중 데이터 건수가 변경되었거나 일부 페이지가 누락됐습니다. 다시 조회해 주세요.',409);
    const a=aggregate(p.rows,filter);
    seen+=p.rows.length; combined.sum+=a.sum; combined.count+=a.count;
    for (const k of Object.keys(combined.excluded)) combined.excluded[k]+=a.excluded[k];
  }
  if(total) add(first,1);
  for(let start=PAGE+1;start<=total;start+=PAGE*2) {
    const starts=[start,start+PAGE].filter(n=>n<=total);
    const pages=await Promise.all(starts.map(n=>page(n,Math.min(n+PAGE-1,total))));
    pages.forEach((p,i)=>add(p,starts[i]));
  }
  if(seen!==total) throw new PublicError('전체 페이지를 가져오지 못했습니다.');
  return {...combined,average:combined.count?combined.sum/combined.count:null,totalRows:total,complete:true,...filter,source:'서울 열린데이터광장 OpenAPI',basis:'접수연도',unit:'만원',retrievedAt:new Date().toISOString()};
}
export async function onRequestGet(context) {
  const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  try {
    const params=new URL(context.request.url).searchParams;
    const filter=Object.fromEntries(['year','district','dong','type'].map(k=>[k,params.get(k)]));
    if (!/^(2024|2025|2026)$/.test(filter.year) || !/^11\d{3}$/.test(filter.district) || !/^\d{5}$/.test(filter.dong) || !TYPES.includes(filter.type)) return json({error:'접수연도(2024~2026), 자치구, 법정동, 주택유형을 선택해 주세요.'},400);
    if (!context.env.SEOUL_API_KEY?.trim()) return json({error:'서버에 SEOUL_API_KEY가 설정되지 않았습니다. 관리자가 키를 등록해야 합니다.'},503);
    const cache=globalThis.caches?.default;
    const cacheUrl=new URL(context.request.url); cacheUrl.search=new URLSearchParams(filter).toString();
    const cacheKey=new Request(cacheUrl);
    const cached=await cache?.match(cacheKey); if(cached) return cached;
    const result=await collect(filter,context.env.SEOUL_API_KEY.trim());
    const response=Response.json(result,{headers:{'Cache-Control':'public, max-age=3600'}});
    if(cache) context.waitUntil(cache.put(cacheKey,response.clone()));
    return response;
  } catch(error) { return json({error:error instanceof PublicError?error.message:'서버 처리 중 오류가 발생했습니다. 다시 시도해 주세요.'},error.status || 500); }
}
