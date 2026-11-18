import { mountPuzzle } from './puzzle.js';
import { findWalkPath } from './world-navigation.js';

const app = document.querySelector('#app');
const toastBox = document.querySelector('#toast');
let socket = null, retryTimer = null, movementTimer = null, puzzleCleanup = null;
let villageScene = null, sceneGeneration = 0, worldCleanup = null, villageJourney = false;
let currentRoom = null, me = null, members = new Map(), connected = false, position = {x:.5,y:.72};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const saved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
function toast(message) { toastBox.textContent = message; toastBox.className = 'visible'; clearTimeout(toast.timer); toast.timer = setTimeout(() => toastBox.className = '', 3000); }
async function api(path, options = {}) { const res = await fetch(path, { ...options, headers: {'Content-Type':'application/json', ...(options.headers || {})}, cache:'no-store' }); let data; try { data = await res.json(); } catch { data = {}; } if (!res.ok) throw new Error((typeof data.error==='string'?data.error:data.error?.message) || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'); return data; }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('링크를 복사했어요.'); } catch { const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); toast('링크를 복사했어요.'); } }
function stopWorld(keepSocket=false) { sceneGeneration++; if(worldCleanup){worldCleanup();worldCleanup=null;} if(villageScene){villageScene.dispose();villageScene=null;} clearTimeout(retryTimer); clearInterval(movementTimer); if(!keepSocket){if(socket){socket.onclose=null;socket.close();socket=null;}connected=false;villageJourney=false;} }
function cleanup(keepSocket=false) { stopWorld(keepSocket); if(typeof puzzleCleanup === 'function') puzzleCleanup(); puzzleCleanup = null; }
function go(route) { if(location.hash === '#'+route) render(); else location.hash = route; }
const logo = `<img class="brand" src="/assets/brand/noel-ink-horizontal-gold.svg" alt="NOËL INK">`;
function page(title, content, sub = '') { return `<main class="shell page"><header class="pagebar"><button data-go="/" aria-label="처음으로">${logo}</button><button data-go="${villageJourney ? '/village' : '/'}">${villageJourney ? '마을로 돌아가기 ←' : '마을 처음으로 ✕'}</button></header><div class="pagebody"><div class="page-title"><div class="eyebrow">TREE PICK · CHRISTMAS VILLAGE</div><h1>${title}</h1>${sub ? `<p>${sub}</p>`:''}</div>${content}</div></main>`; }
function bindNav() { app.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go))); }
function home() {
 app.innerHTML = `<main class="shell"><section class="hero"><div class="hero-bg"></div><header class="topbar">${logo}<div class="top-right"><span>A LITTLE CHRISTMAS VILLAGE</span><button data-go="/enter">마을 입장하기 ↗</button></div></header><div class="hero-content"><div class="eyebrow">✦ &nbsp; A LITTLE CHRISTMAS, TOGETHER</div><h1>작은 마음들이<br><em>모이는 마을.</em></h1><p class="hero-copy">눈 내리는 마을에 오신 걸 환영해요.<br>소중한 사람에게 편지를 보내고, 함께 성탄의 온기를 나눠요.</p><div class="actions"><button class="btn btn-primary" data-go="/enter">마을로 놀러가기 <span>↗</span></button><button class="btn btn-outline" data-go="/write">편지 먼저 쓰기 <span>✉</span></button></div></div><div class="hero-foot"><span>✦ &nbsp; A PLACE FOR WARM HEARTS</span><span>SCROLL TO EXPLORE &nbsp; ↓</span></div></section><section class="intro"><div class="section-head"><div><div class="eyebrow" style="color:#a46e52">WELCOME TO TREE PICK</div><h2>마음이 머무는 세 곳</h2></div><p>서두르지 않아도 괜찮아요.<br>오늘의 마음이 이끄는 곳으로 가보세요.</p></div><div class="cards"><button class="card" data-go="/enter"><span class="card-icon">🎄</span><small>01 / THE VILLAGE</small><h3>친구와 함께, 트리 광장</h3><p>친구를 초대하고 같은 마을을 걸어보세요.</p></button><button class="card" data-go="/write"><span class="card-icon">✉️</span><small>02 / THE POST OFFICE</small><h3>마음을 담아, 우체국</h3><p>따뜻한 편지를 쓰고 소중한 사람에게 전해요.</p></button><button class="card" data-go="/puzzle"><span class="card-icon">✨</span><small>03 / THE GAME ROOM</small><h3>천천히 즐기는 게임장</h3><p>색을 맞추며 나만의 성탄 장식을 완성해요.</p></button></div><div class="community-count" id="community-count" aria-live="polite">✦ &nbsp; 공동 트리의 마음을 불러오고 있어요</div></section><footer class="footer"><span>© NOËL INK · TREE PICK</span><span>MADE FOR A WARMER CHRISTMAS ✦</span></footer></main>`; bindNav(); api('/api/v1/community-tree').then(result=>{const count=document.querySelector('#community-count');if(count)count.textContent=`✦  공동 트리에 모인 편지 ${result.data.letterCount.toLocaleString('ko-KR')}통`;}).catch(()=>{const count=document.querySelector('#community-count');if(count)count.textContent='✦  공동 트리의 마음을 잠시 불러올 수 없어요';});
}
function enter() { const code = new URL(location.href).searchParams.get('room') || ''; const nick = saved('treepick-nickname',''); app.innerHTML = page('우리의 작은 마을로', `<div class="panel"><label class="field"><span>어떻게 불러드릴까요?</span><input id="nickname" maxlength="20" value="${esc(nick)}" placeholder="닉네임을 입력해 주세요" autocomplete="nickname"></label><label class="field"><span>내 모습 고르기</span><select id="appearance"><option value="rabbit">🐰 눈토끼</option><option value="fox">🦊 여우</option><option value="bear">🐻 곰</option><option value="cat">🐱 고양이</option></select></label><div class="row"><button class="btn btn-dark" id="create">새 마을 만들기</button></div>${saved('treepick-room',null)?.token ? `<div class="divider"></div><button type="button" class="btn btn-light full" data-go="/village">이전에 방문한 마을로 돌아가기 →</button>` : ''}<div class="divider"></div><label class="field"><span>친구의 초대 코드가 있나요?</span><input id="roomcode" maxlength="16" value="${esc(code)}" placeholder="초대 코드 입력" autocomplete="off"></label><button class="btn btn-light full" id="join">친구 마을 들어가기 →</button><p id="enter-error" class="error" role="alert"></p></div>`, '이름과 모습을 고르면 바로 만날 수 있어요.'); bindNav();
 const submit = async join => { const nickname = document.querySelector('#nickname').value.trim(), appearance = document.querySelector('#appearance').value, roomcode = document.querySelector('#roomcode').value.trim().toUpperCase(); if(!nickname) return document.querySelector('#enter-error').textContent = '닉네임을 입력해 주세요.'; if(join && !roomcode) return document.querySelector('#enter-error').textContent = '초대 코드를 입력해 주세요.'; const btn = document.querySelector(join?'#join':'#create'); btn.disabled=true; try { const data = await api(join?`/api/rooms/${encodeURIComponent(roomcode)}/join`:'/api/rooms', {method:'POST',body:JSON.stringify(join?{nickname,appearance}:{name:`${nickname}의 마을`,nickname,appearance})}); save('treepick-nickname',nickname); save('treepick-room',{room:data.room,token:data.token}); currentRoom = {room:data.room,token:data.token}; history.replaceState(null,'',location.pathname + location.hash); go('/village'); } catch(e) { document.querySelector('#enter-error').textContent=e.message; } finally {btn.disabled=false;} }; document.querySelector('#create').onclick=()=>submit(false); document.querySelector('#join').onclick=()=>submit(true);
}
const PLACES = [
 {id:'square', label:'트리 광장', x:.18, y:.62},
 {id:'post', label:'우체국', x:.50, y:.43},
 {id:'game', label:'게임장', x:.82, y:.62}
];
function world() {
 currentRoom = currentRoom || saved('treepick-room',null); if(!currentRoom?.token) return go('/enter');
 const {room} = currentRoom;
 const resumed = connected && socket?.readyState === WebSocket.OPEN && me?.id === room.member.id;
 if(!resumed){me=room.member;members=new Map();position={x:.5,y:.72};}
 app.innerHTML = `<main class="shell page"><header class="pagebar"><button data-go="/">${logo}</button><button data-go="/">마을 나가기 ✕</button></header><div class="world-wrap"><div class="world-top"><div><h1>🎄 ${esc(room.name || '우리의 마을')}</h1><p>초대 코드 ${esc(room.code)} · <span id="connection">연결 중...</span></p></div><button class="btn btn-light" id="invite">친구 초대 ↗</button></div><div class="world" id="world" aria-label="크리스마스 마을"><div id="village-scene" class="village-scene" aria-hidden="true"></div><div class="world-label">✦ &nbsp; 함께 걷는 트리 광장</div><div id="avatars" aria-hidden="true"></div><div id="fallback-signs" class="fallback-signs"><button data-target-place="square" style="left:18%;top:62%">🎄 트리 광장</button><button data-target-place="post" style="left:50%;top:43%">✉ 우체국</button><button data-target-place="game" style="left:82%;top:62%">✦ 게임장</button></div><button class="area-action" id="area-action" hidden></button></div><p class="sr-only" id="village-members" aria-live="polite"></p><p class="area-hint" id="area-hint" aria-live="polite">가고 싶은 곳을 눌러 걷거나 방향 버튼으로 이동해요.</p><div class="world-controls"><div><div class="dpad" aria-label="이동 버튼"><button data-move="up" aria-label="위로">▲</button><button data-move="left" aria-label="왼쪽으로">◀</button><button data-move="down" aria-label="아래로">▼</button><button data-move="right" aria-label="오른쪽으로">▶</button></div><p class="help">방향 버튼 · 키보드 · 바닥 터치</p></div><div class="world-actions"><button class="btn btn-light" id="wave">👋 손 흔들기</button><button class="btn btn-light" data-go="/write">✉ 편지 쓰기</button><button class="btn btn-dark" data-go="/puzzle">✦ 게임장</button></div></div></div><dialog class="place-dialog" id="place-dialog" aria-label="마을의 장소"><div id="place-content"></div></dialog></main>`;
 bindNav();
 document.querySelector('#invite').onclick=()=>copy(`${location.origin}${location.pathname}?room=${encodeURIComponent(room.code)}#/enter`);
 document.querySelector('#wave').onclick=()=>send({type:'wave'});
 document.querySelectorAll('.world-actions [data-go]').forEach(button=>button.addEventListener('click',()=>{villageJourney=true;},{capture:true}));
 const worldElement=document.querySelector('#world'), areaButton=document.querySelector('#area-action'), hint=document.querySelector('#area-hint'), dialog=document.querySelector('#place-dialog');
 let activePlace=null, target=null, path=[], escapePoint=null, lastTime=performance.now(), placeHandle=null, placeSequence=0;
 const keys=new Set(); let pointerDirection=null;
 const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
 function updatePlace() {
  const candidate=PLACES.map(place=>({place,distance:Math.hypot(position.x-place.x,position.y-place.y)})).sort((a,b)=>a.distance-b.distance)[0];
  const next=candidate.distance<=.145?candidate.place:null;
  if(next?.id===activePlace?.id)return;
  activePlace=next;villageScene?.setActiveDestination?.(next?.id||null);
  areaButton.hidden=!next;areaButton.dataset.place=next?.id||'';
  if(next){areaButton.textContent=`${next.label} 들어가기 ↗`;hint.textContent=`${next.label}에 도착했어요. 입장 버튼을 누르거나 E 키를 눌러 주세요.`;}
  else hint.textContent='가고 싶은 곳을 눌러 걷거나 방향 버튼으로 이동해요.';
 }
 function dismissPlace(){placeSequence++;placeHandle?.dispose?.();placeHandle=null;if(dialog.open)dialog.close();villageScene?.setPaused?.(false);}
 async function openPlace() {
  if(!activePlace || !connected || dialog.open)return;
  const place=activePlace; target=null;path=[];keys.clear();pointerDirection=null;
  const sequence=++placeSequence;
  try {
   const [{mountPlace},interior] = await Promise.all([import('./places.js'),import('./interior-scene.js').catch(()=>null)]);
   if(sequence!==placeSequence || !dialog.isConnected)return;
   dialog.showModal();villageScene?.setPaused?.(true);
   const leaveFor=route=>{villageJourney=true;dismissPlace();go(route);};
   const options={placeId:place.id,appearance:me?.appearance||'rabbit',onBack:dismissPlace,onWrite:()=>leaveFor('/write'),onRead:()=>leaveFor('/my-letters'),onGame:()=>leaveFor('/puzzle')};
   const fallback=()=>{if(sequence!==placeSequence || !dialog.open)return;placeHandle?.dispose?.();placeHandle=null;placeHandle=mountPlace(document.querySelector('#place-content'),options);};
   if(interior?.mountInterior){try{placeHandle=interior.mountInterior(document.querySelector('#place-content'),{...options,onUnavailable:()=>queueMicrotask(fallback)});}catch{fallback();}}else fallback();
  } catch { if(dialog.open)dialog.close();villageScene?.setPaused?.(false);toast('장소를 열지 못했어요. 다시 시도해 주세요.'); }
 }
 areaButton.onclick=openPlace;
 document.querySelectorAll('[data-target-place]').forEach(button=>{const choose=()=>{const selected=PLACES.find(place=>place.id===button.dataset.targetPlace);if(connected&&selected){walkTo(selected);keys.clear();pointerDirection=null;}};button.addEventListener('pointerdown',event=>{event.stopPropagation();choose();});button.addEventListener('click',event=>{event.stopPropagation();if(event.detail===0)choose();});});
 dialog.addEventListener('cancel',e=>{e.preventDefault();dismissPlace();});
 worldElement.addEventListener('pointerdown',event=>{
  if(event.target.closest('button') || !connected || dialog.open)return;
  const rect=worldElement.getBoundingClientRect();
  const hit=[...worldElement.querySelectorAll('[data-destination]')].find(label=>{const r=label.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;});
  const destination=hit&&PLACES.find(place=>place.id===hit.dataset.destination);
  const projected=destination||villageScene?.screenToPosition?.(event.clientX,event.clientY);
  if(villageScene && !projected)return;
  const point=projected || {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
  walkTo(point);keys.clear();pointerDirection=null;
 });
 document.querySelectorAll('[data-move]').forEach(button=>{
  button.addEventListener('pointerdown',event=>{event.preventDefault();target=null;path=[];keys.clear();pointerDirection=button.dataset.move;const [x,y]=directions[pointerDirection];advance(x*.025,y*.025);button.setPointerCapture?.(event.pointerId);});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>button.addEventListener(type,()=>{pointerDirection=null;}));
  button.addEventListener('click',event=>{if(event.detail===0 && connected && !dialog.open){const [x,y]=directions[button.dataset.move];advance(x*.025,y*.025);}});
 });
 const keyMap={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',W:'up',S:'down',A:'left',D:'right'};
 const keyDown=event=>{if(dialog.open)return;const dir=keyMap[event.key];if(dir){event.preventDefault();target=null;path=[];if(!keys.has(dir)&&!event.repeat){const [x,y]=directions[dir];advance(x*.025,y*.025);}keys.add(dir);}else if((event.key==='e'||event.key==='E'||(event.key==='Enter'&&event.target.tagName!=='BUTTON'))&&activePlace){event.preventDefault();openPlace();}};
 const keyUp=event=>{const dir=keyMap[event.key];if(dir)keys.delete(dir);};
 const blur=()=>{keys.clear();pointerDirection=null;target=null;path=[];};
 document.addEventListener('keydown',keyDown);document.addEventListener('keyup',keyUp);window.addEventListener('blur',blur);
 const canWalk=(x,y)=>villageScene?.isWalkable?.(x,y)??true;
 // A player from the previous scene may already be inside a newly added collider.
 // Walk them out in small, server-validated steps rather than teleporting them.
 function nearestSafePoint(){
  for(let radius=.01;radius<=.65;radius+=.01)for(let i=0;i<48;i++){
   const angle=i*Math.PI/24,x=position.x+radius*Math.cos(angle),y=position.y+radius*Math.sin(angle);
   if(x>=.03&&x<=.97&&y>=.15&&y<=.95&&canWalk(x,y))return{x,y};
  }return null;
 }
 function walkTo(point){
  let goal={x:Math.max(.03,Math.min(.97,point.x)),y:Math.max(.15,Math.min(.95,point.y))};
  if(!canWalk(goal.x,goal.y)){const nearest=PLACES.map(p=>({p,d:Math.hypot(p.x-goal.x,p.y-goal.y)})).sort((a,b)=>a.d-b.d)[0];goal={x:nearest.p.x,y:nearest.p.y};}
  const unsafe=!canWalk(position.x,position.y);if(unsafe&&!escapePoint)escapePoint=nearestSafePoint();
  const start=unsafe?escapePoint:position;
  const route=start&&findWalkPath(start,goal,canWalk);
  if(!route){target=null;path=[];toast('그곳으로 가는 길을 찾지 못했어요. 다른 곳을 눌러 주세요.');return;}
  path=unsafe?[escapePoint,...route]:route;target=path.shift()||null;
 }
 function advance(dx,dy){
  if(!connected || !me)return false;
  let x=Math.max(.03,Math.min(.97,position.x+dx)),y=Math.max(.15,Math.min(.95,position.y+dy));
  if(!canWalk(position.x,position.y)){
   if(!escapePoint)escapePoint=nearestSafePoint();
   if(!escapePoint || Math.hypot(x-escapePoint.x,y-escapePoint.y)>=Math.hypot(position.x-escapePoint.x,position.y-escapePoint.y))return false;
  }else{escapePoint=null;if(!canWalk(x,y)){if(canWalk(x,position.y))y=position.y;else if(canWalk(position.x,y))x=position.x;else return false;}}
  if(x===position.x && y===position.y)return false;position.x=x;position.y=y;
  const self=members.get(me.id);if(self){self.x=x;self.y=y;drawMembers();}send({type:'position',...position});updatePlace();return true;
 }
 movementTimer=setInterval(()=>{
  const now=performance.now(),dt=Math.min(.12,(now-lastTime)/1000);lastTime=now;
  if(!connected||dialog.open)return;
  if(!canWalk(position.x,position.y)&&!target&&!keys.size&&!pointerDirection){escapePoint ||= nearestSafePoint();if(escapePoint){target=escapePoint;path=[];}}
  let dx=0,dy=0;const held=new Set(keys);if(pointerDirection)held.add(pointerDirection);
  for(const dir of held){const d=directions[dir];dx+=d[0];dy+=d[1];}
  if(dx||dy){const n=Math.hypot(dx,dy);advance(dx/n*.25*dt,dy/n*.25*dt);return;}
  if(target){const x=target.x-position.x,y=target.y-position.y,d=Math.hypot(x,y),step=.25*dt;if(d<=step){advance(x,y);target=path.shift()||null;}else if(!advance(x/d*step,y/d*step)){target=null;path=[];}}
 },80);
 worldCleanup=()=>{dismissPlace();document.removeEventListener('keydown',keyDown);document.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);};
 if(resumed){document.querySelector('#connection').textContent=`연결됨 · ${members.size}명 함께하는 중`;drawMembers();}else connect();
 initVillageScene(document.querySelector('#village-scene'));updatePlace();
}
function send(message) { if(socket?.readyState === WebSocket.OPEN && connected) socket.send(JSON.stringify(message)); else toast('마을에 다시 연결하고 있어요.'); }
function connect() { const {room,token}=currentRoom; const status=document.querySelector('#connection'); if(!status)return; status.textContent='연결 중...'; socket = new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`); socket.onopen=()=>socket.send(JSON.stringify({type:'auth',code:room.code,token})); socket.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;} if(m.type==='welcome'){connected=true;me=m.member;members=new Map(m.members.map(x=>[x.id,x])); const self=members.get(me.id);if(self)position={x:self.x,y:self.y};} if(m.type==='roster')members=new Map(m.members.map(x=>[x.id,x])); if(m.type==='position'){const p=members.get(m.memberId);if(p){p.x=m.x;p.y=m.y;}} if(m.type==='wave'){const p=members.get(m.memberId);if(p){p.waving=true;setTimeout(()=>{p.waving=false;drawMembers();},1800);}} if(m.type==='error')toast(m.error||'마을 연결을 확인해 주세요.'); if(connected && document.querySelector('#connection'))document.querySelector('#connection').textContent=`연결됨 · ${members.size}명 함께하는 중`; drawMembers(); }; socket.onclose=(event)=>{connected=false;if(document.querySelector('#connection')){if(event.code===1008){document.querySelector('#connection').textContent='입장할 수 없어요 · 마을로 다시 입장해 주세요';}else{document.querySelector('#connection').textContent='연결이 끊겼어요 · 다시 연결 중';retryTimer=setTimeout(connect,2000);}}}; socket.onerror=()=>socket.close(); }
async function initVillageScene(host) {
 const generation=++sceneGeneration;
 try {
  const {mountVillageScene}=await import('./village-scene.js');
  if(generation!==sceneGeneration || !host?.isConnected) return;
  const fallback=()=>{if(generation!==sceneGeneration)return; if(villageScene){villageScene.dispose();villageScene=null;} const avatars=document.querySelector('#avatars'),signs=document.querySelector('#fallback-signs');if(avatars)avatars.hidden=false;if(signs)signs.hidden=false;};
  const scene=mountVillageScene(host,{onUnavailable:fallback});
  if(!scene || generation!==sceneGeneration){scene?.dispose();return;}
  villageScene=scene;document.querySelector('#avatars').hidden=true;document.querySelector('#fallback-signs').hidden=true;scene.setActiveDestination?.(document.querySelector('#area-action')?.dataset.place||null);if(document.querySelector('#place-dialog')?.open)scene.setPaused?.(true);drawMembers();
 } catch { if(generation===sceneGeneration){const avatars=document.querySelector('#avatars'),signs=document.querySelector('#fallback-signs');if(avatars)avatars.hidden=false;if(signs)signs.hidden=false;} }
}
function drawMembers(){const el=document.querySelector('#avatars');if(!el)return; const list=[...members.values()];el.innerHTML=list.map(p=>`<div class="avatar" style="left:${Math.max(0,Math.min(100,(p.x??.5)*100))}%;top:${Math.max(0,Math.min(100,(p.y??.7)*100))}%"><span class="face">${esc(({rabbit:'🐰',fox:'🦊',bear:'🐻',cat:'🐱'})[p.appearance]||'🐰')}</span><span class="name">${esc(p.nickname)}${p.id===me?.id?' · 나':''}</span>${p.waving?'<span class="wave">👋</span>':''}</div>`).join('');
 const status=document.querySelector('#village-members');const description=list.length?`마을에 ${list.length}명: ${list.map(p=>p.nickname+(p.id===me?.id?' (나)':'')).join(', ')}`:'마을에 연결 중입니다.';if(status&&status.textContent!==description)status.textContent=description;
 try{villageScene?.updateMembers(list,me?.id);}catch{if(villageScene){villageScene.dispose();villageScene=null;}el.hidden=false;const signs=document.querySelector('#fallback-signs');if(signs)signs.hidden=false;}
}
function writeLetter() {
 const draftKey='treepick-letter-draft-v1';
 let draft={}; try { draft=JSON.parse(sessionStorage.getItem(draftKey)||'{}'); } catch {}
 app.innerHTML = page('마음을 전하는 우체국', `<form class="panel" id="letter-form"><div class="notice">✉ 편지를 받은 사람은 가입 없이 열고 답장할 수 있어요. 링크를 가진 누구나 편지를 볼 수 있으니 공유할 때 주의해 주세요.</div><div class="divider"></div><div class="row"><label class="field" style="flex:1;min-width:150px"><span>받는 사람</span><input name="recipient" maxlength="24" required placeholder="소중한 사람에게"></label><label class="field" style="flex:1;min-width:150px"><span>보내는 사람</span><input name="sender" maxlength="24" required placeholder="내 이름"></label></div><label class="field"><span>편지지</span><select name="paper"><option value="cream">따뜻한 아이보리</option><option value="snow">눈 내리는 저녁</option><option value="holly">겨울의 초록</option></select></label><label class="field"><span>마음 한 장 <small>(최대 1,000자)</small></span><textarea name="text" maxlength="1000" required placeholder="올해 당신에게 전하고 싶었던 마음을 적어주세요."></textarea></label><label class="field"><span>봉인 인장</span><select name="stamp"><option value="tree">🎄 트리 인장</option></select></label><p class="help">편지는 저장일로부터 1년 동안 열 수 있어요. 작성 중인 내용은 이 탭에 임시 저장됩니다. 삭제 권한은 이 브라우저에 보관됩니다.</p><p class="error" id="letter-error" role="alert"></p><button class="btn btn-dark full" type="submit">편지 봉인하기 &nbsp; ✉</button></form><div style="text-align:center;margin-top:22px"><button class="text-btn" style="color:#8d715a" data-go="/my-letters">내가 보낸 편지 보기 →</button></div>`, '짧은 안부도, 오랫동안 간직한 마음도 좋아요.');
 bindNav(); const form=document.querySelector('#letter-form');
 for(const [name,value] of Object.entries(draft.data||{})){const input=form.elements.namedItem(name);if(input)input.value=value;}
 if(!form.elements.sender.value)form.elements.sender.value=saved('treepick-nickname','');
 const dataFromForm=()=>Object.fromEntries(new FormData(form));
 function rememberDraft() { const data=dataFromForm();if(draft.attempted && JSON.stringify(data)!==draft.attempted){draft.key=null;draft.attempted=null;}draft.data=data;try{sessionStorage.setItem(draftKey,JSON.stringify(draft));}catch{} }
 form.addEventListener('input',rememberDraft);form.addEventListener('change',rememberDraft);
 form.onsubmit=async e=>{e.preventDefault();const data=dataFromForm();const payload=JSON.stringify(data);if(!draft.key||draft.attempted!==payload){const bytes=crypto.getRandomValues(new Uint8Array(32));draft.key=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');draft.attempted=payload;}draft.data=data;try{sessionStorage.setItem(draftKey,JSON.stringify(draft));}catch{}const b=form.querySelector('button[type=submit]');b.disabled=true;try{const result=await api('/api/letters',{method:'POST',headers:{'Idempotency-Key':draft.key},body:payload});const list=saved('treepick-letters',[]);if(!list.some(item=>item.readToken===result.readToken))list.unshift({readToken:result.readToken,manageToken:result.manageToken,recipient:data.recipient,createdAt:result.letter.createdAt});save('treepick-letters',list);try{sessionStorage.removeItem(draftKey);}catch{}showSent(result.readToken);}catch(err){const error=document.querySelector('#letter-error');if(error)error.textContent=err.message+' 작성 내용은 남아 있어요. 다시 시도해 주세요.';}finally{b.disabled=false;}};
}
function showSent(token) { const url=`${location.origin}${location.pathname}#/letter/${encodeURIComponent(token)}`; app.innerHTML=page('편지를 봉인했어요', `<div class="panel" style="text-align:center"><div style="font-size:52px;margin:10px">💌</div><h2>따뜻한 마음이 준비됐어요</h2><p class="help">아래 링크를 복사해 소중한 사람에게 전해 주세요.<br>링크를 가진 사람은 누구나 편지를 열어볼 수 있어요.</p><div class="linkbox"><span>${esc(url)}</span><button id="copy-letter">복사</button></div><div class="divider"></div><div class="row"><button class="btn btn-light" id="open-letter">편지 확인하기</button><button class="btn btn-dark" data-go="/">처음으로</button></div><p class="help">삭제 권한은 이 브라우저에만 저장돼요. 브라우저 데이터를 지우면 삭제할 수 없어요.</p></div>`);bindNav();document.querySelector('#copy-letter').onclick=()=>copy(url);document.querySelector('#open-letter').onclick=()=>go('/letter/'+encodeURIComponent(token)); }
function myLetters() {const list=saved('treepick-letters',[]);app.innerHTML=page('내가 보낸 편지',`<div class="panel">${list.length ? list.map((l,i)=>`<div class="reply"><strong>TO. ${esc(l.recipient)}</strong><div class="row" style="justify-content:space-between"><span>${esc(new Date(l.createdAt).toLocaleDateString('ko-KR'))}</span><button class="text-btn" style="color:#a44738" data-letter="${i}">편지 열기 →</button></div></div>`).join(''):'<p class="help">이 기기에서 보낸 편지가 아직 없어요.</p>'}<div class="divider"></div><button class="btn btn-dark full" data-go="/write">새 편지 쓰기</button></div>`, '이 브라우저에 저장된 편지만 보여요.');bindNav();document.querySelectorAll('[data-letter]').forEach(b=>b.onclick=()=>go('/letter/'+encodeURIComponent(list[+b.dataset.letter].readToken))); }
async function readLetter(token) { app.innerHTML=page('편지가 도착했어요','<div class="panel status">편지를 불러오고 있어요... ✉</div>');bindNav(); try { const {letter}=await api('/api/letters/'+encodeURIComponent(token)); if(!location.hash.includes(token)) return; const own=saved('treepick-letters',[]).find(x=>x.readToken===token); const papers={cream:'#fffdf5',snow:'#f1f5fa',holly:'#f4f6eb',special:'#fff5df'}; app.innerHTML=page('당신에게 온 편지',`<div class="letter-paper" style="background:${papers[letter.paper]||papers.cream}"><h2>To. ${esc(letter.recipient)}</h2><div>${esc(letter.text)}</div><p style="text-align:right">From. ${esc(letter.sender)} &nbsp; ${letter.stamp==='star'?'⭐':'🎄'}</p></div><div class="panel" style="margin-top:16px"><h3>함께 나눈 마음 <span class="badge">${letter.replies.length}</span></h3>${letter.replies.length?letter.replies.map(r=>`<div class="reply"><strong>${esc(r.author)}</strong>${esc(r.text)}</div>`).join(''):'<p class="help">첫 번째 답장을 남겨보세요.</p>'}<form id="reply-form"><label class="field"><span>내 이름</span><input name="author" maxlength="24" required placeholder="이름을 적어주세요"></label><label class="field"><span>답장</span><textarea name="text" maxlength="2000" required placeholder="마음을 담아 답장을 써주세요" style="min-height:100px"></textarea></label><p class="error" id="reply-error" role="alert"></p><button class="btn btn-dark full">답장 보내기</button></form><div class="divider"></div><button class="btn btn-light full" id="share">편지 링크 복사</button>${own?'<button class="text-btn" id="delete-letter" style="color:#a44738;margin-top:15px">이 편지 삭제하기</button>':''}</div>`, '봉인을 열어 마음을 읽어보세요.');bindNav();document.querySelector('#share').onclick=()=>copy(`${location.origin}${location.pathname}#/letter/${encodeURIComponent(token)}`);document.querySelector('#reply-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{await api('/api/letters/'+encodeURIComponent(token)+'/replies',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});toast('답장을 보냈어요.');readLetter(token);}catch(err){document.querySelector('#reply-error').textContent=err.message;b.disabled=false;}}; if(own)document.querySelector('#delete-letter').onclick=async()=>{if(!confirm('이 편지와 답장을 모두 삭제할까요? 삭제하면 되돌릴 수 없어요.'))return;try{await api('/api/letters/'+encodeURIComponent(own.manageToken),{method:'DELETE'});save('treepick-letters',saved('treepick-letters',[]).filter(x=>x.readToken!==token));toast('편지를 삭제했어요.');go('/my-letters');}catch(err){toast(err.message);}};
 } catch(e) {if(!location.hash.includes(token)) return; app.innerHTML=page('편지를 열 수 없어요',`<div class="panel status"><p>${esc(e.message)}</p><p class="help">링크를 다시 확인해 주세요.</p><button class="btn btn-dark" data-go="/">처음으로</button></div>`);bindNav();} }
function puzzle() {
 const stages = ['first-snow','winter-forest','christmas-night'];
 let activeStage = stages[0], finished = null, requestId = 0;
 app.innerHTML=page('반짝이는 게임장',`<div class="panel"><p class="help">기존 TREE PICK의 게임과 기록을 별도 창에서 이용할 수 있어요.</p><a class="btn btn-dark full" href="https://treepick.vercel.app/play/difficulty" target="_blank" rel="noopener noreferrer">기존 TREE PICK 게임 열기 ↗</a><div class="divider"></div><p class="help">아래 색 정렬은 이 마을의 시험용 퍼즐입니다. 완료해도 보상은 지급되지 않아요.</p><div id="puzzle"></div></div><div class="panel" id="ranking"></div><div style="text-align:center;margin-top:20px"><button class="btn btn-light" data-go="/write">편지 쓰러 가기 ✉</button></div>`, '색을 차근차근 정리하며 나만의 성탄 장식을 완성해요.');bindNav();
 const board = document.querySelector('#puzzle');
 async function showRanking() {
  const target = document.querySelector('#ranking'); if(!target) return;
  const stage=activeStage, request=++requestId;
  target.innerHTML='<h3>✦ 시험용 퍼즐 기록</h3><p class="help">기록을 불러오는 중이에요.</p>';
  try {
   const {entries}=await api('/api/leaderboard/'+stage);
   if(!document.querySelector('#ranking') || stage!==activeStage || request!==requestId) return;
   target.innerHTML=`<h3>✦ 시험용 퍼즐 기록</h3><p class="help">기존 TREE PICK 랭킹과 분리된 임시 기록입니다. 누구나 등록할 수 있으며 플레이 검증과 보상 지급은 제공하지 않아요.</p>${entries.length?entries.slice(0,10).map((e,i)=>`<div class="rank-row"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(e.name)}</strong><span>${e.moves}회</span></div>`).join(''):'<p class="help">아직 기록이 없어요. 첫 번째 기록을 남겨보세요.</p>'}${finished?.stage===stage?`<div class="divider"></div><form id="rank-form"><p class="help">${finished.moves}회 만에 완성했어요! 기록을 남겨볼까요?</p><label class="field"><span>이름</span><input name="name" maxlength="20" required value="${esc(saved('treepick-nickname',''))}" placeholder="기록에 표시할 이름"></label><p class="error" id="rank-error" role="alert"></p><button class="btn btn-dark full">기록 등록하기</button></form>`:''}`;
   const form=target.querySelector('#rank-form'); if(form) form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button'),name=new FormData(form).get('name').trim();if(!name)return;b.disabled=true;try{await api('/api/leaderboard/'+stage,{method:'POST',body:JSON.stringify({name,moves:finished.moves})});save('treepick-nickname',name);finished=null;toast('기록을 등록했어요.');showRanking();}catch(err){target.querySelector('#rank-error').textContent=err.message;b.disabled=false;}};
  } catch(e) {if(request===requestId && document.querySelector('#ranking'))target.innerHTML=`<h3>✦ 시험용 퍼즐 기록</h3><p class="error">${esc(e.message)}</p>`;}
 }
 const game=mountPuzzle(board,{onComplete(stageId,moves){toast('도안을 완성했어요!');finished={stage:stageId,moves};showRanking();}});
 board.addEventListener('click',event=>{const stageButton=event.target.closest('[data-stage]'), nextButton=event.target.closest('[data-action="next"]');if(stageButton){activeStage=stages[Number(stageButton.dataset.stage)];finished=null;showRanking();}else if(nextButton){activeStage=stages[Math.min(stages.indexOf(activeStage)+1,stages.length-1)];finished=null;showRanking();}});
 showRanking();puzzleCleanup=()=>{requestId++;game.destroy();};
}
async function mountHomeVillage() {
 const hero=document.querySelector('.hero'); if(!hero)return;
 const generation=sceneGeneration;
 const preview=document.createElement('div'); preview.className='home-village'; preview.setAttribute('aria-hidden','true'); hero.append(preview);
 try {
  const {mountVillageScene}=await import('./village-scene.js');
  if(generation!==sceneGeneration || !preview.isConnected)return;
  const scene=mountVillageScene(preview, {onUnavailable:()=>{if(generation===sceneGeneration){scene.dispose();if(villageScene===scene)villageScene=null;preview.remove();}}});
  if(generation!==sceneGeneration){scene.dispose();return;}
  villageScene=scene;
  scene.updateMembers([{id:'welcome',nickname:'',appearance:'rabbit',x:.50,y:.78}],null);
  hero.classList.add('has-village-preview');
 } catch { preview.remove(); }
}
function render() { const route=location.hash.slice(1)||'/'; const keepSocket=villageJourney && (['/village','/write','/my-letters','/puzzle'].includes(route)||route.startsWith('/letter/')); cleanup(keepSocket); document.onkeydown=null; if(route==='/'){home();mountHomeVillage();}else if(route==='/enter')enter();else if(route==='/village')world();else if(route==='/write')writeLetter();else if(route==='/my-letters')myLetters();else if(route==='/puzzle')puzzle();else if(route.startsWith('/letter/')){let token;try{token=decodeURIComponent(route.slice(8));}catch{token='';}readLetter(token);}else{home();mountHomeVillage();} window.scrollTo(0,0); }
window.addEventListener('hashchange',render);render();
