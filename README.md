# 서울 전세 한눈에 — 과제 2

서울시 자치구·법정동·주택유형을 선택하면 평균 전세 보증금과 거래 건수를 확인하는 앱입니다. 기본 접수연도는 **2026년**, 추이 비교는 **2022~2026년**입니다. 과제 1은 별도 명세가 없어 구현 대상에 포함하지 않았습니다.

## 실행·제출 상태

- GitHub: 아직 생성 전 (업로드 확인 후 갱신)
- Cloudflare Pages: 아직 배포 전 (실제 URL 확인 후 갱신)
- API 키는 별도 발급값이 필요합니다. 키가 없으면 오류 안내를 표시하며 가짜 결과로 대체하지 않습니다.

## 주요 기능과 구조

HTML/CSS/JavaScript와 Cloudflare Pages Functions를 사용합니다. React·Vue·프런트엔드 빌드가 없습니다. 실제 법정동 GeoJSON을 SVG로 그리므로 Leaflet·지도 타일·외부 폰트 의존성도 없습니다. SVG 막대그래프는 평균과 거래 건수를 함께 표현하며 각 지표 최댓값을 기준으로 높이를 정규화합니다. 정확한 수치는 표에 표시합니다.

```text
public/
  index.html            화면 구조와 집계 기준
  style.css             흰색·오렌지 반응형 디자인
  script.js             조회, 지도, 추이, 이전 요청 취소
  data/
    seoul.geojson       서울 467개 법정동 실제 경계
    regions.json        경계 코드 기반 자치구·동 목록
    history-2022.json   공식 CSV의 합계·건수 집계
    history-2023.json
    provenance.json    원본 해시·집계/제외 건수
functions/api/rent.js   서버 전용 서울 API 호출·전체 페이지 집계
scripts/prepare_data.py 공식 원본 다운로드·집계 재현
tests/rent.test.js      계산·페이지·오류 테스트
.dev.vars.example      빈 키 설정 예시
.gitignore             키·원본·로컬 실행 파일 제외
wrangler.toml          Pages 설정
```

실제 `.dev.vars`, `.local` 원본 ZIP, `node_modules`, `.wrangler`는 Git에서 제외합니다. 정적 공개 디렉터리는 `public`뿐입니다.

## 데이터 출처와 실제 확인한 명세

- [서울 열린데이터광장 서울시 부동산 전월세가 정보, OA-21276](https://data.seoul.go.kr/dataList/OA-21276/S/1/datasetView.do): 서울특별시, 공공누리 제1유형(출처표시).
- [공식 OpenAPI 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21276&srvType=A)
- 확인일: 2026-10-18 (한국시간). 서비스명 `tbLnOpendataRentV`.
- 공식 주소 형식: `http://openapi.seoul.go.kr:8088/{KEY}/json/tbLnOpendataRentV/{START}/{END}/{RCPT_YR}/{CGG_CD}/{CGG_NM}/{STDG_CD}/{LOTNO_SE}/{MNO}/{SNO}/{CTRT_DAY}/{BLDG_NM}/{BLDG_USG}`
- 연도·자치구코드·법정동코드·건물용도로 범위를 줄입니다. 사용하지 않는 선택 인자는 공백 한 칸을 URL 인코딩합니다. 전세 구분은 공식 요청 필터가 아니므로 서버에서 필터링합니다.
- `RCPT_YR`: **접수연도**, `CTRT_DAY`: 계약일. 두 기준을 혼합하지 않습니다.
- `CGG_CD`/`CGG_NM`: 5자리 자치구코드/명, `STDG_CD`/`STDG_NM`: 5자리 법정동코드/명.
- `RENT_SE`: 전월세 구분, `GRFE`: 보증금(만원), `RTFE`: 임대료(만원).
- `BLDG_USG`: 아파트 / 연립다세대 / 단독다가구 / 오피스텔.
- `list_total_count`: 해당 요청 조건의 전체 행 수. 일반 키 최대 1,000건/요청, sample 키 최대 5건.
- 실제 sample 전체 응답: 2,660,991행. 2026·강남구(11680)·역삼동(10100)·아파트 검색 응답: 1,623행. 이는 전월세 원본 건수이며 전세 유효 건수와 다릅니다. 수시로 바뀔 수 있습니다.
- 실제 2024 검색은 응답하며 2022·2023 검색은 `INFO-200`입니다. 공식 최근 3년 제공 안내와 일치합니다. 2024~2026은 API만 사용하고 CSV와 합산하지 않습니다.

### 계산과 예외 처리

`RENT_SE === '전세'`이며 보증금이 양의 안전한 정수이고 임대료가 정확히 0인 거래만 집계합니다. 숫자·정상 천 단위 쉼표를 허용하고 공란, 비숫자, 음수, 보증금 0, 전세인데 양의 임대료가 있는 모순 행은 제외합니다. 원자료는 만원, 10,000만원 = 1억원입니다. 평균 = 보증금 **합계 / 유효 거래 건수**이며 페이지별 평균을 다시 평균내지 않습니다. 소수 만원은 평균 계산에서 유지하고 화면에서만 반올림합니다.

공식 23개 출력 필드에 취소 식별 필드가 없어 취소를 추측하여 제외하지 않습니다. 서로 다른 정상 거래를 임의로 중복 제거하지 않습니다. 데이터·경계 코드 불일치나 필터 불일치는 숨기지 않고 집계 오류로 처리합니다. CSV는 제외 건수를 기록하며 이번 가공에서 경계 미일치 전세 행은 없었습니다. 거래 없음은 `average: null`이고 화면에서는 ‘자료 없음’입니다. API 오류는 ‘확인 불가’로 구분합니다.

각 동 단위로 전체 페이지를 가져옵니다. 외부 API 요청은 함수당 동시 2개, 브라우저에서도 동별 조회 동시 2개입니다. 최대 40,000행(40페이지)을 넘으면 실행 한도 보호를 위해 오류로 중단하고 부분 평균을 반환하지 않습니다. 모든 페이지의 총 건수·예상 행 수·조건을 검증합니다. 원본에 스냅샷/거래 고유 ID가 없어 조회 도중 건수 변화 없는 내용 수정까지 완전히 검출할 수는 없습니다. 성공 결과만 1시간 캐시하며 오류는 캐시하지 않습니다. 캐시는 지역별 조회 시간이 다를 수 있습니다.

### 최근 5년 자료

`scripts/prepare_data.py`는 공식 FILE 탭의 2022(seq=36)·2023(seq=38) ZIP을 다운로드하고 CSV의 필요한 항목만 합계·건수로 가공합니다. 2022는 CP949, 2023은 UTF-8 BOM을 인식합니다. 파일 이름이 아닌 `접수년도` 열로 해당 연도를 확인합니다.

| 자료 | 원본 행 | 유효 전세 | 제외 |
|---|---:|---:|---|
| 2022 ZIP | 560,665 | 277,600 | 다른 접수연도 6,424 / 전세 아님 276,568 / 금액 오류 73 |
| 2023 ZIP | 545,813 | 262,337 | 전세 아님 283,341 / 금액 오류 135 |

제외 사유는 우선순위에 따라 한 행당 하나로 기록합니다. 2022 ZIP에는 다른 접수연도 행이 포함되어 있어 제외했습니다. 연도별 공개 파일이 모든 추후 정정/지연 신고를 반영한다고 보장할 수 없습니다. 2026년은 조회 시점까지의 자료이므로 완결 연간 통계가 아닙니다. 과거 파일이 없거나 API가 실패한 연도는 추정하지 않습니다.

재현(프로젝트 루트에서 Python 표준 라이브러리만 사용):

```powershell
python scripts/prepare_data.py
```

원본은 `.local`에 캐시되며 원본 파일 해시는 `public/data/provenance.json`에 기록합니다. 경계 가공본을 변경해 다시 받으려면 해당 캐시 파일만 별도로 백업 후 제거합니다.

### 지도 출처와 연결

[KnellBalm/kr-admin-geojson](https://github.com/KnellBalm/kr-admin-geojson)의 `emd.geojson`. 원본은 국가공간정보포털(V-World) 법정동 경계(2023-07-29 배포), EPSG:5179에서 EPSG:4326으로 재투영하고 0.0005도 허용오차로 단순화한 자료입니다. 해당 저장소 README는 원본·가공본 모두 출처 표시 조건으로 자유 이용 가능하다고 명시합니다. 본 앱은 서울만 추출하고 속성을 정리하며 실제 경계를 새로 그려내거나 행정동 이름으로 연결하지 않습니다.

8자리 `EMD_CD`에 `00`을 붙인 10자리 법정동 코드 = `CGG_CD + STDG_CD`. 제공 자료의 `HJD_*` 행정동 속성은 사용하지 않습니다. 2023년 경계이므로 최신 변경을 완전히 반영하지 못할 수 있습니다. 과거 값도 같은 경계로 비교하며 지역 개편 시 재검토가 필요합니다. 지도 범례는 선택 구·접수연도·주택유형 안에서 유효 평균의 최솟값~최댓값을 5구간으로 나눕니다. 파랑은 낮음, 빨강은 높음, 회색은 자료 없음/조회 전/실패이며 상태는 툴팁·표로 구별합니다. 진행 중에는 부분 조회 상태를 명시합니다.

## 함수·조건문·반복문 설명

- `collect()`는 공식 API 페이지를 가져오는 함수, `aggregate()`는 전세 조건문과 `for...of` 반복문으로 합계·건수를 계산하는 함수입니다.
- `run()`은 조회 흐름을 실행하고 `AbortController` 및 요청 번호로 오래된 응답의 화면 덮어쓰기를 방지합니다.
- `renderMap()`은 GeoJSON 반복문으로 SVG 경계를 만들고 조건문으로 가격 색상과 자료 없음 상태를 나눕니다. 클릭 시 동 선택·카드·추이를 함께 갱신합니다.
- `renderHistory()`는 5개 연도를 반복해 표와 SVG 그래프를 만듭니다. `status()`는 한국어 오류/상태를 표시합니다.

## 로컬 실행과 키

Node.js 22 이상, Python 3, npm을 사용합니다. Windows 실행 정책이 `npm.ps1`을 차단하면 아래처럼 `npm.cmd`를 사용하세요.

```powershell
cd seoul_rent_api
npm.cmd ci
# .dev.vars가 없을 때만 예시를 복사합니다. 기존 키 파일을 덮어쓰지 마세요.
Copy-Item .dev.vars.example .dev.vars
# VS Code에서 .dev.vars에 SEOUL_API_KEY=발급받은키 입력
npm.cmd run dev
```

터미널의 로컬 주소(기본 `http://localhost:8788`)로 접속합니다. 서버는 `context.env.SEOUL_API_KEY`로만 키를 읽고 브라우저는 같은 사이트 `/api/rent`만 호출합니다. 키·키 포함 URL·원본 오류는 응답이나 로그에 출력하지 않습니다. 키를 입력/변경했다면 로컬 서버를 재시작하세요. 실제 키를 README·커밋·채팅에 붙여 넣지 마세요.

## 검증

```powershell
npm.cmd test
npm.cmd run check
```

테스트 데이터는 `tests`에만 있고 공개 결과로 제공하지 않습니다. 수작업 계산(10,000+30,000+10,000)/3, 월세 제외, 잘못된 금액, 동일 금액 거래 보존, 1,003건 다중 페이지 가중 평균, 페이지 누락, 자료 없음, 필터 불일치, 키 미설정, 인증 실패, 요청 제한, 잘못된 JSON, 키 없는 오류 메시지를 검증합니다.

## GitHub 업로드

기존 상위 `rainfall-analyzer` 저장소와 별도로 이 폴더만 Git 저장소로 관리합니다. 원본 ZIP이나 다른 수업 자료를 추가하지 않습니다. 저장소 이름은 `seoul_rent_api`, 첫 커밋 메시지는 `Initial commit: Seoul rent analyzer`입니다. 같은 저장소가 이미 있으면 생성/강제 push를 중단해야 합니다.

```powershell
git init -b main
git add .
git status --short
git commit -m "Initial commit: Seoul rent analyzer"
gh repo create seoul_rent_api --public --source . --remote origin --push
```

## Cloudflare Pages (GitHub 연결 우선)

[공식 정적 HTML 안내](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/), [GitHub 연결](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/), [Secret 바인딩](https://developers.cloudflare.com/pages/functions/bindings/).

1. Cloudflare 대시보드 → Workers & Pages → Create application → Pages → Import an existing Git repository.
2. GitHub 계정 연결 권한이 필요하면 본인이 승인하고 `seoul_rent_api` 선택.
3. 이름 `seoul-rent-api`, production branch `main`, Framework preset `None`.
4. Build command `exit 0`, Build output directory `public`, Root directory는 **비워 둠(저장소 루트)**. 저장소 자체가 분리 프로젝트이므로 `seoul_rent_api`를 다시 입력하지 않습니다.
5. 프로젝트 Settings → Variables and Secrets에서 `SEOUL_API_KEY`를 **Secret**으로 등록(Production, 필요 시 Preview에도 등록). 저장 후 재배포.
6. 실제 생성된 URL에서 2026년 API 조회·지도·추이를 확인합니다. 서울 API 관리 화면에 URL을 입력해야 한다면 이 실제 배포 URL을 사용합니다.

`functions`는 `public` 밖의 저장소 루트에 있어 Pages가 서버 코드로 빌드합니다. `wrangler.toml`의 출력 디렉터리는 `public`입니다. 대시보드 업로드로 정적 파일만 올리면 Functions가 누락될 수 있으므로 Git 연동을 사용하세요. Git 연동을 마치면 main에 push할 때 자동 배포됩니다. 추가 결제·권한 승인 단계는 계정 소유자가 직접 처리합니다.

## 교수님께 설명할 과제 소개

서울 열린데이터광장의 전월세 자료를 이용해 서울 법정동별 평균 전세 보증금을 조회하는 앱을 만들었습니다. 전세 거래만 골라 보증금 합계를 거래 건수로 나누며, API의 모든 페이지를 확인합니다. 실제 법정동 경계 지도에서 가격이 높은 곳은 빨강, 낮은 곳은 파랑으로 표시하고 동을 클릭하면 선택 지역과 그래프가 바뀝니다. 최근 5년 중 API가 제공하지 않는 2022·2023년은 같은 공식 데이터셋의 CSV를 집계했습니다. API 키는 Cloudflare 서버의 Secret에만 저장하고, 접수연도와 계약연도가 다르다는 한계를 화면에 설명했습니다.
