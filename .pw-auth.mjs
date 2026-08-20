import { chromium } from 'playwright-core';
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1400,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:4174/crypto-lab-fte/',{waitUntil:'load'}); await p.waitForTimeout(1000);

console.log('=== budget table ===');
console.log(await p.$$eval('#budget-body tr', rs=>rs.map(r=>Array.from(r.children).map(c=>c.textContent.trim().padEnd(14)).join('')).join('\n')));
console.log('note:', (await p.textContent('#budget-note')).slice(0,150));

console.log('\n=== seal on phone (should refuse) ===');
await p.fill('#auth-passphrase','correct horse battery staple');
await p.click('#auth-seal');
await p.waitForFunction(()=>!document.querySelector('#auth-status').classList.contains('is-working'),{timeout:120000});
console.log((await p.textContent('#auth-status-text')).slice(0,180));

console.log('\n=== switch to base64 and seal ===');
await p.selectOption('#preset','base64'); await p.waitForTimeout(600);
await p.selectOption('#auth-tag','16'); await p.waitForTimeout(200);
const t0=Date.now();
await p.click('#auth-seal');
await p.waitForFunction(()=>!document.querySelector('#auth-status').classList.contains('is-working'),{timeout:120000});
console.log('first seal ms (includes PBKDF2):', Date.now()-t0);
console.log('sealed :', (await p.textContent('#auth-out')).slice(0,70));
console.log('status :', (await p.textContent('#auth-status-text')).slice(0,150));

console.log('\n=== second seal (HKDF only, no PBKDF2) ===');
await p.fill('#auth-counter','7');
const t1=Date.now();
await p.click('#auth-seal');
await p.waitForFunction(()=>!document.querySelector('#auth-status').classList.contains('is-working'),{timeout:120000});
console.log('second seal ms:', Date.now()-t1);
console.log('status :', (await p.textContent('#auth-status-text')).slice(0,140));

console.log('\n=== open (resync from 0) ===');
await p.click('#auth-open');
await p.waitForFunction(()=>!document.querySelector('#auth-status').classList.contains('is-working'),{timeout:120000});
console.log((await p.textContent('#auth-status-text')).slice(0,200));

console.log('\n=== attack the sealed string ===');
await p.click('#auth-attack');
await p.waitForFunction(()=>!document.querySelector('#auth-status').classList.contains('is-working'),{timeout:180000});
console.log('status :', await p.textContent('#auth-status-text'));
console.log('verdict:', (await p.textContent('#auth-verdict')).slice(0,260));

console.log('\n=== fixed wire length across message sizes ===');
const lens=new Set();
for (const m of ['a','hello','x'.repeat(25)]) {
  await p.fill('#auth-message', m);
  await p.click('#auth-seal');
  await p.waitForFunction(()=>!document.querySelector('#auth-status').classList.contains('is-working'),{timeout:120000});
  lens.add((await p.textContent('#auth-out')).length);
}
console.log('distinct wire lengths:', [...lens].join(','), lens.size===1?'✓ constant':'✗ leaks');
console.log('\nerrors:', errs.join('\n')||'(none)');
await b.close();
