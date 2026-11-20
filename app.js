'use strict';
const $=id=>document.getElementById(id);
const KEY='tanaoroshi-pwa-v1';
let entries={};try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');if(x&&typeof x==='object'&&!Array.isArray(x))for(const [k,v] of Object.entries(x))if(/^\d+$/.test(k)&&Number.isSafeInteger(v)&&v>0)entries[k]=v;}catch{}
const normalize=s=>(String(s||'').match(/[0-9０-９]/g)||[]).map(c=>c>='０'&&c<='９'?String(c.charCodeAt(0)-65296):c).join('');
const compare=(a,b)=>{const x=a.replace(/^0+(?=\d)/,''),y=b.replace(/^0+(?=\d)/,'');return x.length-y.length|| (x<y?-1:x>y?1:0)||a.localeCompare(b,'en');};
const save=()=>{localStorage.setItem(KEY,JSON.stringify(entries));render();};
function register(raw){const n=normalize(raw);if(!n)return false;entries[n]=(entries[n]||0)+1;save();$('scanInfo').textContent=`登録：${n}（${entries[n]}点）`;if($('sound').checked&&navigator.vibrate)navigator.vibrate(90);return true;}
function render(){const keys=Object.keys(entries).sort(compare);if($('sort').value==='desc')keys.reverse();$('kinds').textContent=`${keys.length}種類`;$('total').textContent=`合計${Object.values(entries).reduce((a,b)=>a+b,0)}点`;const root=$('list');root.replaceChildren();if(!keys.length){const p=document.createElement('p');p.className='empty';p.textContent='まだ商品がありません';root.append(p);return;}for(const n of keys){const row=document.createElement('div');row.className='item';const code=document.createElement('span');code.className='code';code.textContent=n;const minus=document.createElement('button');minus.className='secondary';minus.textContent='−';minus.setAttribute('aria-label',n+'を1減らす');minus.onclick=()=>{if(entries[n]<=1){if(confirm(`${n} を削除しますか？`))delete entries[n];}else entries[n]--;save();};const count=document.createElement('span');count.className='qty';count.textContent=entries[n];const plus=document.createElement('button');plus.textContent='+';plus.setAttribute('aria-label',n+'を1増やす');plus.onclick=()=>register(n);row.append(code,minus,count,plus);root.append(row);}}
$('add').onclick=()=>{if(register($('manual').value))$('manual').value='';else alert('数字を入力してください');};$('manual').onkeydown=e=>{if(e.key==='Enter')$('add').click();};$('sort').onchange=render;
$('clear').onclick=()=>{if(confirm('すべての棚卸データを削除しますか？')){entries={};save();}};
$('export').onclick=()=>{const keys=Object.keys(entries).sort(compare);if($('sort').value==='desc')keys.reverse();const csv='\ufeff商品番号,数量\r\n'+keys.map(k=>`="${k}",${entries[k]}`).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`tanaoroshi-${new Date().toISOString().slice(0,10)}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);};
let stream=null,worker=null,active=false,busy=false,front=false,timer=null,previous='',stable=0,armed=true,missing=0,lastCode='';
function setStatus(s){$('status').textContent=s;}
function resetTracking(){previous='';stable=0;armed=true;missing=0;lastCode='';}
async function getWorker(){
 if(worker)return worker;
 if(!window.Tesseract)throw Error('OCRライブラリが読み込めません。通信状態を確認してください。');
 setStatus('OCR準備中…');
 worker=await Tesseract.createWorker('eng',1,{logger:()=>{}});
 await worker.setParameters({tessedit_char_whitelist:'0123456789-－ー− ',tessedit_pageseg_mode:'7'});
 return worker;
}
// CSS object-fit:cover の見た目と同じ位置から切り抜く。対象は中央の緑枠のみ。
function cropFrame(){
 const v=$('video');if(!v.videoWidth||!v.videoHeight)return null;
 const vw=v.videoWidth,vh=v.videoHeight,b=v.getBoundingClientRect();
 if(!b.width||!b.height)return null;
 const scale=Math.max(b.width/vw,b.height/vh),displayW=vw*scale,displayH=vh*scale;
 const offsetX=(displayW-b.width)/2,offsetY=(displayH-b.height)/2;
 const r=$('video').parentElement.querySelector('.roi').getBoundingClientRect();
 // ガイド枠の内側を切り抜き、枠線や周囲の文字を極力含めない。
 const insetX=r.width*0.025,insetY=r.height*0.08;
 const x=Math.max(0,(r.left+insetX-b.left+offsetX)/scale),y=Math.max(0,(r.top+insetY-b.top+offsetY)/scale);
 const cw=Math.min(vw-x,(r.width-2*insetX)/scale),ch=Math.min(vh-y,(r.height-2*insetY)/scale);
 if(cw<10||ch<10)return null;
 const c=document.createElement('canvas');const upscale=Math.min(1.8,850/cw);
 c.width=Math.round(cw*upscale);c.height=Math.round(ch*upscale);
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,x,y,cw,ch,0,0,c.width,c.height);
 // 明暗補正のみ。固定二値化は黄色ラベルの文字を消すことがあるため行わない。
 const img=ctx.getImageData(0,0,c.width,c.height);const d=img.data;
 let lo=255,hi=0;for(let i=0;i<d.length;i+=4){const g=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;lo=Math.min(lo,g);hi=Math.max(hi,g);}
 if(hi-lo>30){for(let i=0;i<d.length;i+=4){const g=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;const v=Math.max(0,Math.min(255,Math.round((g-lo)*255/(hi-lo))));d[i]=d[i+1]=d[i+2]=v;}ctx.putImageData(img,0,0);}
 return c;
}
// 四角枠内の数字のみ。ハイフンを許容し、英字混入を拒否する。
function extractCode(text){
 const rows=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const found=[];
 for(const row of rows){const compact=row.replace(/[\s　]/g,'').replace(/[０-９]/g,c=>String(c.charCodeAt(0)-65296));
  const match=compact.match(/^[|\[({]*([0-9]{2,8}(?:[-－ー−][0-9]{2,8})?)[|\])}]*$/);
  if(match){const n=normalize(match[1]);if(n.length>=4&&n.length<=14)found.push(n);}
 }
 return found.length===1?found[0]:'';
}
async function tick(){
 if(!active||busy||!worker)return;busy=true;
 try{const canvas=cropFrame();if(!canvas)return;
  const result=await worker.recognize(canvas);if(!active)return;
  const code=extractCode(result.data.text);const confidence=Number(result.data.confidence)||0;
  if(!code){missing++;stable=0;previous='';if(missing>=2)armed=true;setStatus('読み取り中');return;}
  missing=0;
  if(code===previous)stable++;else{previous=code;stable=1;}
  // 別番号を読んだら次の商品として受け付ける。同一番号は一度枠から外す。
  if(!armed&&code!==lastCode)armed=true;
  // 高信頼度なら1回で登録。低信頼度は2回一致を要求して誤登録を抑える。
  const required=confidence>=85?1:2;
  setStatus(armed?`認識：${code} (${Math.min(stable,required)}/${required})`:`登録済：${code}`);
  if(armed&&stable>=required){if(register(code)){armed=false;lastCode=code;setStatus(`登録完了：${code}`);}}
 }catch(e){setStatus('認識エラー');$('scanInfo').textContent='OCRエラー：'+String(e.message||e);}finally{busy=false;}
}
async function start(){
 if(active)return;
 $('start').disabled=true;setStatus('カメラ起動中…');$('scanInfo').textContent='カメラの準備をしています…';
 try{
  if(!window.isSecureContext)throw Error('HTTPSの公開URLをSafariで直接開いてください。');
  if(!navigator.mediaDevices?.getUserMedia)throw Error('このブラウザではカメラAPIを利用できません。');
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:front?'user':'environment'},width:{ideal:1280},height:{ideal:720}}});
  $('video').srcObject=stream;await $('video').play();active=true;
  $('stop').disabled=false;setStatus('OCR準備中…');$('scanInfo').textContent='カメラ起動成功。文字認識を準備しています…';
  await getWorker();if(!active)return;
  resetTracking();setStatus('読み取り中');$('scanInfo').textContent='四角い商品番号枠を緑のガイドに合わせてください。';
  // OCRが終わってから次の処理を予約し、端末負荷を抑える。
  const scanLoop=async()=>{if(!active)return;await tick();if(active)timer=setTimeout(scanLoop,Number($('interval').value));};
  scanLoop();
 }catch(e){const msg=String(e.message||e);stop();setStatus('開始エラー');$('scanInfo').textContent='カメラ/OCR起動エラー：'+msg;}
}
function stop(){active=false;clearTimeout(timer);timer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('video').srcObject=null;$('start').disabled=false;$('stop').disabled=true;setStatus('停止中');}
$('start').onclick=start;$('stop').onclick=stop;$('flip').onclick=async()=>{const was=active;stop();front=!front;if(was)await start();};$('interval').onchange=()=>{};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop();});
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});render();setStatus('待機中');
