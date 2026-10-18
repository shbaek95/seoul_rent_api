"""공식 과거 CSV와 법정동 GeoJSON을 재현 가능하게 가공한다. 원본은 .local에만 저장."""
import csv, io, json, zipfile, urllib.request, hashlib
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local'
OUT = ROOT / 'public/data'
CACHE.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)

def download(url, path):
    if not path.exists():
        urllib.request.urlretrieve(url, path)

boundary_url = 'https://raw.githubusercontent.com/KnellBalm/kr-admin-geojson/3a859f2a45be8acf8237d9eefd9565f99cc603da/emd.geojson'
download(boundary_url, CACHE / 'emd.geojson')
geo = json.loads((CACHE / 'emd.geojson').read_text(encoding='utf-8'))
features, districts = [], {}
for feature in geo['features']:
    p = feature['properties']
    if not p['EMD_CD'].startswith('11'):
        continue
    code = p['EMD_CD'] + '00'  # 8자리 읍면동 경계코드 → 10자리 법정동 코드
    district = p['SIG_CD']
    feature['properties'] = dict(code=code, dong=code[5:], name=p['EMD_KOR_NM'], district=district, districtName=p['SGG_NM'])
    features.append(feature)
    districts.setdefault(district, dict(code=district, name=p['SGG_NM'], dongs=[]))['dongs'].append(dict(code=code[5:], name=p['EMD_KOR_NM']))
(OUT / 'seoul.geojson').write_text(json.dumps(dict(type='FeatureCollection', features=features), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(OUT / 'regions.json').write_text(json.dumps(sorted(districts.values(), key=lambda d:d['name']), ensure_ascii=False), encoding='utf-8')
known = {f['properties']['code'] for f in features}
report = {'boundarySource':boundary_url, 'boundaryFeatures':len(features), 'archives':{}}
for year, seq in [(2022,36),(2023,38)]:
    url = f'https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?infId=OA-21276&infSeq=3&seq={seq}&useCache=false'
    path = CACHE / f'{year}.zip'
    download(url,path)
    groups, reasons, total = {}, {}, 0
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith('.csv'))
        with z.open(name) as sample:
            prefix = sample.read(3)
        encoding = 'utf-8-sig' if prefix == b'\xef\xbb\xbf' else 'cp949'
        rows = csv.DictReader(io.TextIOWrapper(z.open(name), encoding=encoding, newline=''))
        required = ['접수년도','자치구코드','법정동코드','전월세구분','보증금(만원)','임대료(만원)','건물용도']
        assert all(k in rows.fieldnames for k in required), '공식 CSV 스키마 변경'
        for row in rows:
            total += 1
            reason = None
            if row['접수년도'] != str(year): reason = 'wrongYear'
            elif row['전월세구분'] != '전세': reason = 'notJeonse'
            try:
                # 빈칸·비숫자·음수·0원 및 월 임대료가 있는 모순 행 제외
                deposit = int(row['보증금(만원)'].replace(',',''))
                rent = int(row['임대료(만원)'].replace(',',''))
                if deposit <= 0 or rent != 0: reason = reason or 'invalidMoney'
            except ValueError: reason = reason or 'invalidMoney'
            code = row['자치구코드'].zfill(5) + row['법정동코드'].zfill(5)
            if code not in known: reason = reason or 'unmatchedBoundary'
            if reason:
                reasons[reason] = reasons.get(reason,0)+1
                continue
            key = code + '|' + row['건물용도']
            group = groups.setdefault(key,dict(sum=0,count=0))
            group['sum'] += deposit
            group['count'] += 1
    result = dict(year=year, basis='접수연도', unit='만원', source=url, retrievedAt=datetime.now(timezone.utc).isoformat(), totalRows=total, excluded=reasons, groups=groups)
    (OUT / f'history-{year}.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    report['archives'][year] = dict(total=total,accepted=sum(g['count'] for g in groups.values()),excluded=reasons,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
(OUT / 'provenance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
