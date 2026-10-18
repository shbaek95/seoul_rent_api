const $=id=>document.getElementById(id);
const years=[2022,2023,2024,2025,2026];
const colors=['#2869b0','#8bb9df','#eee9e3','#ed9b83','#c43736'];
let regions=[], geo, controller, version=0, activeMap=new Map();
const memo=new Map(), archives=new Map();
const amount=n=>n==null?'자료 없음':n>=10000?`${(n/10000).toLocaleString('ko-KR',{maximumFractionDigits:2})}억 원`:`${n.toLocaleString('ko-KR',{maximumFractionDigits:0})}만 원`;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function selection(){return {year:$('year').value,district:$('district').value,dong:$('dong').value,type:$('type').value};}
function invalidate(){controller?.abort();version++;$('average').textContent='—';$('count').textContent='—';$('stamp').textContent='새 조건으로 조회해 주세요.';$('selection').textContent='조회 대기';$('history').replaceChildren();$('chart').replaceChildren();status('조건을 변경했습니다. 조회 버튼을 눌러 주세요.');}
async function json(url,signal){const r=await fetch(url,{signal});let data;try{data=await r.json();}catch{throw Error('응답을 읽을 수 없습니다. 다시 조회해 주세요.');}if(!r.ok)throw Error(data.error||'자료를 불러올 수 없습니다.');return data;}
async function getRent(q,signal){
  const key=new URLSearchParams(q).toString(), cached=memo.get(key);
  if(cached && Date.now()-cached.time<3600000)return cached.value;
  let value;
  if(Number(q.year)<=2023){
    if(!archives.has(q.year))archives.set(q.year,await json(`/data/history-${q.year}.json`,signal));
    const data=archives.get(q.year), group=data.groups[q.district+q.dong+'|'+q.type];
    value={...q,sum:group?.sum||0,count:group?.count||0,average:group?group.sum/group.count:null,complete:true,source:'공식 CSV',retrievedAt:data.retrievedAt};
  }else value=await json('/api/rent?'+key,signal);
  if(value.complete!==true)throw Error('전체 집계가 끝나지 않은 응답입니다.');
  memo.set(key,{value,time:Date.now()});return value;
}
// 동시에 두 요청만 처리해 서울 API의 과도한 병렬 호출을 방지한다.
async function pool(items,fn,signal){let next=0;await Promise.all([0,1].map(async()=>{while(next<items.length&&!signal.aborted){const item=items[next++];await fn(item);}}));}
function updateDongs(){
  const district=regions.find(r=>r.code===$('district').value);
  $('dong').replaceChildren(...district.dongs.map(d=>new Option(d.name,d.code)));
  activeMap=new Map();renderMap(selection());
}
function card(q,data){
  const district=regions.find(r=>r.code===q.district),dong=district.dongs.find(d=>d.code===q.dong);
  $('selection').textContent=`${q.year}년 · ${district.name} ${dong.name} · ${q.type}`;
  $('average').textContent=amount(data.average);
  $('count').textContent=data.count?`${data.count.toLocaleString()}건`:'자료 없음';
  $('stamp').textContent=`${data.source} · 조회 ${new Date(data.retrievedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)`;
}
function svgEl(tag,attrs={}){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;}
function renderMap(q){
  if(!geo)return;
  const features=geo.features.filter(f=>f.properties.district===q.district);
  const all=features.flatMap(f=>f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2));
  const xs=all.map(p=>p[0]*Math.cos(37.55*Math.PI/180)),ys=all.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min(720/(maxX-minX),410/(maxY-minY));
  const project=p=>[(p[0]*Math.cos(37.55*Math.PI/180)-minX)*scale+40,(maxY-p[1])*scale+25];
  const valid=[...activeMap.values()].filter(d=>d.average!=null&&!d.error).map(d=>d.average);
  const min=valid.length?Math.min(...valid):0,max=valid.length?Math.max(...valid):0;
  const color=v=>v==null?'#d3d7dc':colors[max===min?2:Math.min(4,Math.floor((v-min)/(max-min)*5))];
  const svg=svgEl('svg',{viewBox:`0 0 ${(maxX-minX)*scale+80} ${(maxY-minY)*scale+50}`,role:'group','aria-label':'선택 자치구의 실제 법정동 경계'});
  const table=document.createElement('table');
  for(const f of features){
    const p=f.properties,data=activeMap.get(p.dong),label=`${p.name}: ${data?.error?'조회 실패':data?amount(data.average):'조회 전'}`;
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    const pathData=polygons.map(poly=>poly.map(ring=>'M'+ring.map(pt=>project(pt).join(',')).join('L')+'Z').join('')).join('');
    const path=svgEl('path',{d:pathData,fill:color(data?.average), 'fill-rule':'evenodd',tabindex:0,role:'button','aria-label':label,class:p.dong===q.dong?'selected':''});
    const title=svgEl('title');title.textContent=label;path.append(title);
    function choose(){ $('dong').value=p.dong;run(); }
    path.addEventListener('click',choose);path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});svg.append(path);
    // 라벨은 실제 경계의 외곽 좌표 중심에 배치한다. 경계 자체는 변형하지 않는다.
    const pts=polygons.flatMap(poly=>poly[0]).map(project),px=pts.map(a=>a[0]),py=pts.map(a=>a[1]);
    if(features.length<30){const text=svgEl('text',{x:(Math.min(...px)+Math.max(...px))/2,y:(Math.min(...py)+Math.max(...py))/2,'text-anchor':'middle'});text.textContent=p.name;svg.append(text);}
    const tr=document.createElement('tr'),td=document.createElement('td'),btn=document.createElement('button');btn.className='dong-button';btn.textContent=p.name;btn.onclick=choose;td.append(btn);tr.append(td);
    const val=document.createElement('td');val.textContent=data?.error?'조회 실패':data?amount(data.average):'조회 전';tr.append(val);table.append(tr);
  }
  $('map').replaceChildren(svg);$('dong-table').replaceChildren(table);
  $('legend').replaceChildren();
  const prefix=document.createElement('span');prefix.textContent=`${q.year}년 · ${regions.find(r=>r.code===q.district)?.name} · ${q.type} 비교 | `;$('legend').append(prefix);
  if(valid.length){for(let i=0;i<5;i++){if(max===min&&i!==2)continue;const span=document.createElement('span'),chip=document.createElement('i');chip.className='legend-chip';chip.style.background=colors[i];span.append(chip,document.createTextNode(max===min?amount(min):`${amount(min+(max-min)*i/5)}–${amount(min+(max-min)*(i+1)/5)} `));$('legend').append(span);}}
  $('legend').append(document.createTextNode(' 회색: 자료 없음 / 조회 전 / 실패 (동을 눌러 확인)'));
}
function renderHistory(results){
  $('history').replaceChildren();
  for(const year of years){const d=results.get(year),tr=document.createElement('tr');for(const text of [year+(year===2026?' (누적)':''),d?.error?'확인 불가':d?amount(d.average):'조회 중',d?.error?'—':d?d.count?d.count.toLocaleString()+'건':'자료 없음':'—',d?.error||d?.source||'조회 중']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('history').append(tr);}
  const svg=svgEl('svg',{viewBox:'0 0 900 230',role:'img','aria-label':'주황 막대: 평균 전세가, 파란 막대: 거래 건수. 정확한 값은 아래 표 참조.'});
  const valid=[...results.values()].filter(d=>!d.error&&d.count>0),maxAvg=Math.max(1,...valid.map(d=>d.average)),maxCount=Math.max(1,...valid.map(d=>d.count));
  for(const [i,year] of years.entries()){const d=results.get(year),x=50+i*175;for(const [offset,value,max,fill] of [[0,d?.average,maxAvg,'#df621e'],[48,d?.count,maxCount,'#3c79ae']]){if(d&&!d.error&&d.count>0){const h=value/max*145;svg.append(svgEl('rect',{x:x+offset,y:175-h,width:36,height:h,rx:3,fill}));}}const label=svgEl('text',{x:x+35,y:200,'text-anchor':'middle',fill:'#58616c','font-size':13});label.textContent=String(year);svg.append(label);}
  const legend=svgEl('text',{x:20,y:20,'font-size':12,fill:'#58616c'});legend.textContent='주황: 평균 전세가 / 파랑: 거래 건수 (각 항목의 5년 최댓값 대비 높이)';svg.append(legend);$('chart').replaceChildren(svg);
}
async function run(event){
  event?.preventDefault();controller?.abort();controller=new AbortController();const signal=controller.signal,id=++version,q=selection();
  if(!q.district||!q.dong||!q.type){status('자치구·동·주택유형을 모두 선택해 주세요.',true);return;}
  $('average').textContent='조회 중';$('count').textContent='조회 중';$('stamp').textContent='모든 페이지를 확인하고 있습니다.';$('selection').textContent=`${q.year}년 · ${$('district').selectedOptions[0].textContent} ${$('dong').selectedOptions[0].textContent} · ${q.type}`;
  status('전세 거래의 전체 페이지를 집계하고 있습니다.');
  activeMap=new Map();renderMap(q);$('map-status').textContent='선택 동과 연도별 자료 확인 후 구 전체 동을 조회합니다.';const history=new Map();renderHistory(history);
  try{const data=await getRent(q,signal);if(id!==version)return;card(q,data);activeMap.set(q.dong,data);status(data.count?'전체 페이지 집계를 완료했습니다. 지도와 과거 자료를 이어서 확인합니다.':'선택한 조건의 유효한 전세 거래가 없습니다.');}
  catch(e){if(signal.aborted)return;$('average').textContent='확인 불가';$('count').textContent='—';$('stamp').textContent='조회 버튼으로 다시 시도할 수 있습니다.';status(e.message,true);activeMap.set(q.dong,{error:e.message});}
  if(signal.aborted)return;
  // 선택 지역 5년 추이를 먼저 확보한 뒤, 동일 구의 동별 지도를 조회한다.
  await pool(years,async year=>{try{const d=await getRent({...q,year:String(year)},signal);if(id===version)history.set(year,d);}catch(e){if(!signal.aborted)history.set(year,{error:e.message});}if(id===version)renderHistory(history);},signal);
  if(signal.aborted)return;
  const dongs=regions.find(r=>r.code===q.district).dongs;
  let done=0,failed=0;
  await pool(dongs,async dong=>{try{const d=await getRent({...q,dong:dong.code},signal);if(id===version)activeMap.set(dong.code,d);}catch(e){if(!signal.aborted){failed++;activeMap.set(dong.code,{error:e.message});}}if(id===version){done++;$('map-status').textContent=`동별 조회 ${done}/${dongs.length} 완료 · 실패 ${failed}곳${done<dongs.length?' · 부분 조회 중 (색상 범위가 바뀔 수 있습니다)':''}`;renderMap(q);}},signal);
  if(id===version&&!$('status').classList.contains('error'))status(failed?'선택 지역 집계 완료. 지도 일부 동은 조회에 실패했습니다.':'선택 지역과 지도 조회를 완료했습니다. 연도별 자료 상태는 아래 표를 확인하세요.');
}
async function init(){try{[regions,geo]=await Promise.all([json('/data/regions.json'),json('/data/seoul.geojson')]);$('district').replaceChildren(...regions.map(r=>new Option(r.name,r.code)));$('district').value='11680';updateDongs();status('조건을 선택하고 전세가 조회를 눌러 주세요.');}catch(e){status('지역·지도 파일을 불러오지 못했습니다. 페이지를 새로고침해 주세요.',true);}}
$('filters').addEventListener('submit',run);
$('district').addEventListener('change',()=>{invalidate();updateDongs();});
for(const key of ['year','type'])$(key).addEventListener('change',()=>{invalidate();activeMap=new Map();renderMap(selection());$('map-status').textContent='새 조건으로 조회해 주세요.';});
$('dong').addEventListener('change',run);
init();
