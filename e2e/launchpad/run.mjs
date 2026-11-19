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
// 2b registry: the confirmed launch is listed, survives a reload, reconciles, and deep-links into the studio
await p.keyboard.press('Escape');
await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Close'))?.click());
await waitText(p,'Your launches');
const listed=await text(p);
console.log('REGISTRY listed:',listed.includes('Mossback')&&listed.includes('Live on Pump'));
const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('senro-launches-v1')));
console.log('REGISTRY stored records:',stored.records.length,'slot',stored.records[0].slot,'pending cleared',await p.evaluate(()=>!sessionStorage.getItem('senro-pending-launch')));
await p.reload({waitUntil:'networkidle2'});await waitText(p,'Your launches');
console.log('REGISTRY survives reload:',(await text(p)).includes('Mossback'));
await click(p,'Check all on-chain');await waitText(p,'Live on Pump');
await connect(p);await waitText(p,'to graduation',15000).catch(()=>{});
await p.screenshot({path:path.join(os.tmpdir(),'s10-analytics.png'),fullPage:true});
const analytics=await text(p);
console.log('P5 analytics shown:',analytics.includes('to graduation')&&analytics.includes('Market cap'),'| vault shows 0.0123 SOL:',analytics.includes('0.0123 SOL'),'| rules note:',analytics.includes('Anyone can still trade your token directly on Pump'));
await p.screenshot({path:path.join(os.tmpdir(),'s8-launches.png'),fullPage:true});
const mint=stored.records[0].mint;
const studio=await browser.newPage();await studio.setViewport({width:1280,height:900});
await studio.goto(`http://localhost:4181/?mint=${mint}#studio`,{waitUntil:'networkidle2'});
await studio.waitForSelector('#live-mint',{timeout:15000}).catch(()=>{});
console.log('STUDIO deep link prefilled:',await studio.evaluate(()=>document.getElementById('live-mint')?.value??'no field')===mint);
await studio.goto('http://localhost:4181/?mint=not-a-mint#studio',{waitUntil:'networkidle2'});
console.log('STUDIO bad mint ignored:',await studio.evaluate(()=>document.getElementById('live-mint')?.value??'no field'));
await studio.close();
// landing entry
const landing=await browser.newPage();await landing.setViewport({width:1280,height:900});
await landing.goto('http://localhost:4181/',{waitUntil:'networkidle2'});
console.log('LANDING header button visible:',await landing.$eval('.landing-header-launch',a=>{const r=a.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.width>0}));
await landing.screenshot({path:path.join(os.tmpdir(),'s11-landing-top.png')});
const phone=await browser.newPage();await phone.setViewport({width:390,height:844,isMobile:true});await phone.goto('http://localhost:4181/',{waitUntil:'networkidle2'});
console.log('LANDING phone button visible:',await phone.$eval('.landing-header-launch',a=>{const r=a.getBoundingClientRect();return r.top>=0&&r.right<=innerWidth&&r.width>0}),'| overflow:',await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1));
await phone.screenshot({path:path.join(os.tmpdir(),'m4-landing-top.png')});await phone.close();
console.log('LANDING links to launchpad:',await landing.$$eval('a[href="/launchpad.html"]',a=>a.length));
await landing.evaluate(()=>document.getElementById('launchpad')?.scrollIntoView());await new Promise(r=>setTimeout(r,600));
await landing.screenshot({path:path.join(os.tmpdir(),'s9-landing-launchpad.png')});
await landing.close();
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

// 5b phone browser with no wallet: offers open-in-wallet links back to the launchpad
p=await browser.newPage();await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
await p.goto('http://localhost:4180/launchpad.html?nowallet',{waitUntil:'networkidle2'});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Connect wallet')).click());
await waitText(p,'Open in Phantom');
const links=await p.$$eval('.lp-sheet a',a=>a.map(x=>x.href));
console.log('PHONE links:',links.map(h=>decodeURIComponent(h).replace(/\?ref=.*/,'')).join(' | '));
await p.screenshot({path:path.join(os.tmpdir(),'m3-phone-wallets.png')});
await p.close();
p=await browser.newPage();await p.goto('http://localhost:4180/launchpad.html?connectWallet=1',{waitUntil:'networkidle2'});
console.log('PHONE return opens picker:',(await text(p)).includes('Connect a wallet'),'| url cleaned:',await p.evaluate(()=>location.search===''));
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
