// 실제 키는 로컬 비밀 파일에서 읽으며 키 또는 키 포함 URL을 출력하지 않는다.
import fs from 'node:fs/promises';
import { collect } from '../functions/api/rent.js';
const raw=await fs.readFile('.dev.vars','utf8');
const key=(raw.match(/^SEOUL_API_KEY\s*=\s*(.*)$/m)?.[1]||'').trim().replace(/^['"]|['"]$/g,'');
if(!key){console.error('SEOUL_API_KEY 미설정: .dev.vars에 입력 후 다시 실행하세요.');process.exitCode=1;}
else {
  try {
    const result=await collect({year:'2026',district:'11680',dong:'10100',type:'아파트'},key);
    console.log(JSON.stringify(result,null,2));
  } catch {console.error('실제 API 검증 실패: 인증/네트워크/응답 상태를 확인하세요. 비밀 URL은 출력하지 않습니다.');process.exitCode=1;}
}
