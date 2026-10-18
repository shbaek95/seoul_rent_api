// 실행: npm.cmd install --no-save --package-lock=false playwright 후 node scripts/browser_check.mjs
// 테스트는 별도 headless Edge 프로필을 사용하며 사용자의 로그인 브라우저를 건드리지 않는다.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:8788');
  await page.waitForFunction(()=>document.querySelectorAll('#dong option').length>0&&document.querySelector('#district').value==='11680');
  assert.equal(await page.locator('#map path').count(),14);
  await page.selectOption('#year','2022');
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#map-status').textContent.includes('14/14'),{},{timeout:30000});
  assert.match(await page.locator('#average').innerText(),/억 원|만 원/);
  assert.equal(await page.locator('#history tr').count(),5);
  assert.match(await page.locator('#history').innerText(),/SEOUL_API_KEY|OpenAPI|열린데이터/);
  await page.screenshot({path:'.local/desktop.png',fullPage:true});
  await page.locator('#map path').nth(1).click();
  const selected=await page.locator('#dong').inputValue();
  await page.waitForFunction(()=>/억 원|만 원|자료 없음/.test(document.querySelector('#average').textContent));
  assert.notEqual(selected,'10100');
  await page.selectOption('#district','11110');
  assert.equal(await page.locator('#average').innerText(),'—');
  assert.equal(await page.locator('#map path').count(),87);
  await page.selectOption('#year','2023');
  await page.locator('button[type=submit]').click();
  await page.selectOption('#year','2022');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#average').innerText(),'—');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'.local/mobile.png',fullPage:true});
  const bad=await page.request.get('http://127.0.0.1:8788/api/rent');assert.equal(bad.status(),400);
  for(const path of ['/.dev.vars','/README.md','/functions/api/rent.js']){const r=await page.request.get('http://127.0.0.1:8788'+path);assert.ok(!(await r.text()).includes('SEOUL_API_KEY='));}
  assert.deepEqual(errors,[]);
  console.log('PASS: 실제 CSV 조회 / 지도 클릭 / 구 변경 / 빠른 조건 변경 / 추이 / 390px 모바일 / JS 오류 없음 / 비밀파일 미노출');
} finally {await browser.close();}
