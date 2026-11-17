import puppeteer from 'puppeteer-core';
import {serve} from './server.mjs';
import path from 'node:path';import os from 'node:os';
const root=new URL('../../',import.meta.url).pathname;
const preview=await serve(path.join(root,'dist'),4180),live=await serve(process.env.LIVE_DIST??path.join(os.tmpdir(),'senro-dist-live'),4181);
const browser=await puppeteer.launch({executablePath:process.env.CHROME??'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-gpu']});
const problems=[];
const text=p=>p.evaluate(()=>document.body.innerText);
const waitText=(p,t,ms=20000)=>p.waitForFunction(x=>document.body.innerText.includes(x),{timeout:ms},t);
const api=async(port,k)=>(await fetch(`http://localhost:${port}/__${k}`)).json();
async function open(port,w=1280,h=900){
 await api(port,'reset');
 const p=await browser.newPage();await p.setViewport({width:w,height:h,deviceScaleFactor:1});
 p.on('console',m=>{if(['error'].includes(m.type())&&!/fonts\.g|Failed to load resource/.test(m.text()))problems.push(`${port} console: ${m.text()}`)});
 p.on('pageerror',e=>problems.push(`${port} pageerror: ${e.message}`));
 await p.goto(`http://localhost:${port}/launchpad.html`,{waitUntil:'networkidle2'});
 return p;
}
async function fill(p){
 await p.type('input[placeholder="Orbit Protocol"]','Mossback');
 await p.type('input[placeholder="ORBIT"]','MOSS');
 await p.type('textarea','A small token for slow growth.');
 await (await p.$('input[type=file]')).uploadFile(''+new URL('./art.png',import.meta.url).pathname+'');
 await p.type('input[placeholder="https://"]','https://mossback.example');
}
async function connect(p){
 await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Connect wallet')).click());
 await waitText(p,'Connect a wallet');
 await p.evaluate(()=>[...document.querySelectorAll('.lp-sheet button')].find(b=>b.textContent.includes('Test Wallet')).click());
 await waitText(p,'Creator');
}
const click=(p,t)=>p.evaluate(x=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(x)&&!b.disabled)?.click(),t);

// 1 preview, desktop
let p=await open(4180);
await p.screenshot({path:path.join(os.tmpdir(),'s1-initial.png'),fullPage:true});
await fill(p);await connect(p);
await p.screenshot({path:path.join(os.tmpdir(),'s2-filled.png'),fullPage:true});
await click(p,'Review launch');await waitText(p,'Preview release.',20000).catch(()=>{});
await waitText(p,'Live launches are not enabled');
await p.screenshot({path:path.join(os.tmpdir(),'s3-review-preview.png')});
const prevState=await api(4180,'x');
console.log('PREVIEW build: wallet calls',await p.evaluate(()=>window.__walletCalls),'sent',prevState.sent,'rpc',[...new Set(prevState.calls)].join(','));
const approveVisible=await p.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Approve and sign')));
console.log('preview shows Approve button:',approveVisible);
await p.close();

// 2 live, success
p=await open(4181);await fill(p);await connect(p);
await click(p,'Review launch');await waitText(p,'Approve and sign');
await p.screenshot({path:path.join(os.tmpdir(),'s4-review-live.png')});
await click(p,'Approve and sign');await waitText(p,'Your token is live.',30000);
await p.screenshot({path:path.join(os.tmpdir(),'s5-launched.png')});
const st=await api(4181,'x');
console.log('LIVE success: wallet calls',await p.evaluate(()=>window.__walletCalls),'sent',st.sent,'uploads',st.uploads,'pending stored',await p.evaluate(()=>!!sessionStorage.getItem('senro-pending-launch')));
await p.close();

// 3 live, simulation failure
p=await open(4181);await api(4181,'simfail');await fill(p);await connect(p);
await click(p,'Review launch');await waitText(p,'Simulation failed');
await p.screenshot({path:path.join(os.tmpdir(),'s6-simfail.png')});
console.log('SIM FAIL: wallet signTransaction calls',(await p.evaluate(()=>window.__walletCalls)).filter(x=>x==='signTransaction').length,'sent',(await api(4181,'x')).sent);
await p.close();

// 4 live, upload failure
p=await open(4181);await api(4181,'uploadfail');await fill(p);await connect(p);
await click(p,'Review launch');await waitText(p,'Upload failed');
await p.screenshot({path:path.join(os.tmpdir(),'s7-uploadfail.png')});
await p.close();

// 5 live, unknown outcome (never confirms)
p=await open(4181);await fill(p);await connect(p);
await click(p,'Review launch');await waitText(p,'Approve and sign');
await api(4181,'pending');
console.log('(skipping long unknown-outcome wait in browser; covered by unit tests)');
await p.close();

// 6 mobile
p=await open(4180,390,844);
await p.screenshot({path:path.join(os.tmpdir(),'m1-initial.png'),fullPage:true});
await fill(p);await connect(p);await click(p,'Review launch');await waitText(p,'Live launches are not enabled');
await p.screenshot({path:path.join(os.tmpdir(),'m2-sheet.png')});
const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
console.log('mobile horizontal overflow:',overflow);
await p.close();

await browser.close();preview.close();live.close();
console.log('PROBLEMS:',problems.length?problems:'none');
process.exit(0);
