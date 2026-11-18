import * as THREE from '/vendor/three.module.js';

const INFO = {
 square:{title:'트리 광장',subtitle:'함께 모이는 성탄의 마음',goal:'편지 테이블',action:'편지 쓰기',goalPosition:[-2.0,-1.1]},
 post:{title:'마을 우체국',subtitle:'소중한 마음을 전하는 곳',goal:'편지 책상',action:'편지 쓰기',goalPosition:[-1.8,-1.15]},
 game:{title:'반짝이는 게임장',subtitle:'천천히 즐기는 작은 놀이',goal:'게임 테이블',action:'시험 퍼즐 열기',goalPosition:[-1.8,-1.15]}
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** A self-contained navigable Three.js location. The village connection stays with the host. */
export function mountInterior(container, options={}) {
 const info=INFO[options.placeId];
 if(!(container instanceof HTMLElement) || !info) throw new TypeError('A known place and container are required.');
 let renderer,frame=0,observer=null,disposed=false,elapsed=0,last=0,contextHandler=null;
 const resources=new Set(),callbacks=new AbortController();
 let countRequest=null;
 const track=resource=>(resources.add(resource),resource);
 function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();countRequest?.abort();callbacks.abort();if(renderer){if(contextHandler)renderer.domElement.removeEventListener('webglcontextlost',contextHandler);renderer.dispose();renderer.forceContextLoss?.();renderer.domElement.remove();}for(const resource of resources)resource.dispose?.();resources.clear();container.replaceChildren();}
 try {
 container.innerHTML=`<section class="interior" aria-label="${info.title}"><header class="interior-header"><button type="button" data-interior="back" class="interior-back">← 마을로</button><div><strong tabindex="-1" class="interior-title">${info.title}</strong><span>${info.subtitle}</span></div><span aria-hidden="true">✦</span></header><div class="interior-stage" aria-label="${info.title} 3D 공간"><div class="interior-canvas"></div><div class="interior-labels" aria-label="둘러볼 장소"></div><button class="interior-action" type="button" hidden></button></div><p class="interior-hint" aria-live="polite">바닥이나 표지를 누르거나 방향 버튼으로 걸어보세요.</p>${options.placeId==='square'?'<p class="interior-count" role="status">공동 트리에 모인 편지를 불러오는 중이에요.</p>':''}<div class="interior-controls"><div class="interior-dpad" aria-label="캐릭터 방향 조작"><button type="button" data-direction="up" aria-label="앞으로">▲</button><button type="button" data-direction="left" aria-label="왼쪽으로">◀</button><button type="button" data-direction="down" aria-label="뒤로">▼</button><button type="button" data-direction="right" aria-label="오른쪽으로">▶</button></div><div class="interior-explain"><strong>걸어서 둘러보기</strong><span>가까이 가면 사용할 수 있어요.</span>${options.placeId==='game'?'<a href="https://treepick.vercel.app/play/difficulty" target="_blank" rel="noopener noreferrer">기존 TREE PICK 게임 ↗</a>':''}</div></div><button type="button" class="interior-leave" data-interior="back">← 마을로 돌아가기</button></section>`;
 const root=container.querySelector('.interior'),stage=root.querySelector('.interior-stage'),canvasHost=root.querySelector('.interior-canvas'),labels=root.querySelector('.interior-labels'),action=root.querySelector('.interior-action'),hint=root.querySelector('.interior-hint');
 renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(options.placeId==='square'?0x71849d:0x493e48,1);renderer.domElement.setAttribute('aria-hidden','true');canvasHost.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(options.placeId==='square'?0x71849d:0x524653);
 const camera=new THREE.PerspectiveCamera(38,1,.1,100);camera.position.set(0,9.2,12.5);camera.lookAt(0,.3,-.25);
 scene.add(new THREE.HemisphereLight(0xf9ead9,0x586274,2.1));const sun=new THREE.DirectionalLight(0xffe0b1,1.9);sun.position.set(-4,9,6);scene.add(sun);
 const materialCache=new Map();const mat=(color,extra={})=>{const key=`${color}/${JSON.stringify(extra)}`;if(!materialCache.has(key))materialCache.set(key,track(new THREE.MeshStandardMaterial({color,roughness:.9,...extra})));return materialCache.get(key);};
 const geometries=new Map();const geo=(kind,args)=>{const key=kind+args.join(',');if(!geometries.has(key)){const ctor={box:THREE.BoxGeometry,sphere:THREE.SphereGeometry,cylinder:THREE.CylinderGeometry,cone:THREE.ConeGeometry,plane:THREE.PlaneGeometry}[kind];geometries.set(key,track(new ctor(...args)));}return geometries.get(key);};
 function box(parent,color,x,y,z,w,h,d,extra={}){const obj=new THREE.Mesh(geo('box',[w,h,d]),mat(color,extra));obj.position.set(x,y,z);parent.add(obj);return obj;}
 function sphere(parent,color,x,y,z,r,extra={}){const obj=new THREE.Mesh(geo('sphere',[r,12,9]),mat(color,extra));obj.position.set(x,y,z);parent.add(obj);return obj;}
 function cylinder(parent,color,x,y,z,r1,r2,h){const obj=new THREE.Mesh(geo('cylinder',[r1,r2,h,12]),mat(color));obj.position.set(x,y,z);parent.add(obj);return obj;}
 function cone(parent,color,x,y,z,r,h){const obj=new THREE.Mesh(geo('cone',[r,h,10]),mat(color));obj.position.set(x,y,z);parent.add(obj);return obj;}
 function addWindow(x){box(scene,0x453c42,x,2.1,-3.45,1.45,1.8,.14);box(scene,0x7385a0,x,2.1,-3.35,1.16,1.5,.06,{emissive:0x323b52,emissiveIntensity:.25});box(scene,0x574841,x,2.1,-3.26,.08,1.5,.07);box(scene,0x574841,x,2.1,-3.25,1.15,.07,.07);}
 function tree(x,z,scale=1,decorated=false){const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(scale);scene.add(g);cylinder(g,0x715847,0,.36,0,.19,.22,.72);for(let n=0;n<3;n++){const y=.9+n*.58,r=1.0-n*.2;cone(g,0x385a4a,0,y,0,r,1.4);cone(g,0xe5ebed,0,y+.39,0,r*.7,.48);}if(decorated){for(let n=0;n<9;n++){const angle=n*2.4,y=.55+(n%4)*.42,r=.75-(n%4)*.12;sphere(g,n%2?0xeebc70:0xb65243,Math.sin(angle)*r,y,Math.cos(angle)*r,.09,{emissive:n%2?0x956126:0x532018,emissiveIntensity:.35});}sphere(g,0xffdf9b,0,2.5,0,.16,{emissive:0xf1b852,emissiveIntensity:.55});}return g;}
 function lamp(x,z){cylinder(scene,0x6c5547,x,.85,z,.055,.09,1.7);box(scene,0x6c5547,x,1.82,z,.30,.12,.3);sphere(scene,0xf4c67e,x,1.66,z,.19,{emissive:0xefaa50,emissiveIntensity:.7});}
 function table(x,z,game=false){box(scene,0x96674d,x,.86,z,1.65,.16,1.05);for(const dx of [-.65,.65])for(const dz of [-.36,.36])box(scene,0x6d5144,x+dx,.42,z+dz,.12,.84,.12);if(game){for(let i=0;i<3;i++){cylinder(scene,[0xca7d69,0x8cae99,0xe5bf80][i],x-.43+i*.43,1.17,z,.12,.12,.48);sphere(scene,0xf2e0bf,x-.43+i*.43,1.43,z,.12);}}else{box(scene,0xf6e7cd,x,.98,z,.68,.03,.44);box(scene,0xa65141,x,1.01,z,.09,.03,.09);cylinder(scene,0x59463c,x+.53,1.03,z+.12,.085,.085,.21);}}
 const outdoor=options.placeId==='square';
 box(scene,outdoor?0xe4e5ea:0xb88969,0,-.13,0,8.0,.24,7.25);
 if(outdoor){box(scene,0xc4ccd4,0,-.02,.2,2.2,.03,6.7);tree(0,-1.35,1.3,true);tree(-3,-2.5,.70);tree(3,-2.5,.70);lamp(-2.8,.15);lamp(2.8,.15);table(-2,-1.1);for(let i=0;i<6;i++)box(scene,0xf5f5f3,(i%2?1:-1)*3.3,.16,-2.4+i*.9,.8,.3,.62);}
 else {box(scene,0x76584c,0,1.85,-3.65,8,3.7,.3);box(scene,0x986b53,-3.95,.92,0,.20,1.85,7.2);box(scene,0x986b53,3.95,.92,0,.20,1.85,7.2);box(scene,0x5c4a48,0,3.64,-3.45,8,.14,.26);addWindow(-2.5);addWindow(2.5);lamp(-3.25,-2.5);lamp(3.25,-2.5);table(-1.8,-1.8,options.placeId==='game');
  if(options.placeId==='post'){box(scene,0x8d5945,1.8,.78,-1.75,1.4,1.56,.9);box(scene,0xf0d8ae,1.8,1.45,-1.25,.48,.31,.07);box(scene,0x684739,1.8,1.05,-1.25,.65,.09,.08);for(let i=0;i<3;i++)box(scene,0xe6d2ae,1.38+i*.43,1.62,-1.58,.3,.18,.2);}else{box(scene,0x67465a,1.9,1,-1.9,1.3,2,1);box(scene,0xd2ab78,1.9,1.55,-1.38,1,.68,.06);box(scene,0x4f7280,1.9,1.55,-1.34,.84,.5,.04,{emissive:0x274a56,emissiveIntensity:.4});for(let i=0;i<3;i++)sphere(scene,[0xca755e,0xeab879,0x93b29f][i],1.6+i*.3,.8,-1.35,.08);}}
 // A small door marks the return path without blocking the host's current room.
 box(scene,0x6e5143,0,.16,3.25,1.35,.3,.45);box(scene,0xe3c7a5,0,.34,3.22,1.05,.06,.35);
 const character=new THREE.Group(),body=new THREE.Group();character.add(body);scene.add(character);
 const coat=0x465b70,appearance=options.appearance||'rabbit',fur=({rabbit:0xf4e7d0,fox:0xc7835f,bear:0xb38d72,cat:0xaaa4b5})[appearance]||0xf4e7d0;cylinder(body,coat,0,.55,0,.28,.35,.67);sphere(body,fur,0,1.13,0,.35);if(appearance==='rabbit'){const ears=[sphere(body,fur,-.17,1.57,0,.16),sphere(body,fur,.17,1.57,0,.16)];ears.forEach(ear=>ear.scale.set(.55,2.4,.55));}else if(appearance==='bear'){sphere(body,fur,-.27,1.41,0,.15);sphere(body,fur,.27,1.41,0,.15);}else{cone(body,fur,-.23,1.48,0,.16,.36);cone(body,fur,.23,1.48,0,.16,.36);}sphere(body,0x403a3a,-.11,1.16,.31,.035);sphere(body,0x403a3a,.11,1.16,.31,.035);sphere(body,0xb57c76,0,1.05,.33,.045);cylinder(body,0xa74e42,0,.87,0,.32,.32,.13);const leftLeg=box(body,0x685749,-.17,.12,0,.23,.28,.28),rightLeg=box(body,0x685749,.17,.12,0,.23,.28,.28);const leftArm=box(body,coat,-.37,.59,0,.16,.50,.18),rightArm=box(body,coat,.37,.59,0,.16,.50,.18);
 const markers=[{id:'goal',label:info.goal,x:info.goalPosition[0],z:info.goalPosition[1],action:()=>options.placeId==='game'?options.onGame?.():options.onWrite?.(),button:info.action},{id:'exit',label:'마을로',x:0,z:3.10,action:()=>options.onBack?.(),button:'마을로 돌아가기'}];
 if(options.placeId==='post')markers.push({id:'read',label:'보낸 편지함',x:1.8,z:-1.1,action:()=>options.onRead?.(),button:'내가 보낸 편지 보기'});
 const labelElements=[];for(const marker of markers){const ring=new THREE.Mesh(geo('cylinder',[.58,.58,.035,24]),track(mat(0xf1d5a9,{transparent:true,opacity:.78}).clone()));ring.position.set(marker.x,.02,marker.z);scene.add(ring);marker.ring=ring;const element=document.createElement('button');element.type='button';element.dataset.interiorTarget=marker.id;element.textContent=marker.label;element.setAttribute('aria-label',`${marker.label} 쪽으로 걷기`);labels.append(element);labelElements.push({element,marker});}
 let x=0,z=1.65,path=[],held=new Set(),pointer=null,near=null,angle=0;
 const dirs={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};const raycaster=new THREE.Raycaster(),ground=new THREE.Plane(new THREE.Vector3(0,1,0),0),rayPoint=new THREE.Vector3();
 // The avatar has a small footprint. Colliders reflect the ground footprint of
 // furniture, trees and lamps rather than the silhouette of their upper parts.
 const minX=-3.55,maxX=3.55,minZ=-2.9,maxZ=3,actorRadius=.26;
 const obstacles=[];
 const blockBox=(cx,cz,w,d)=>obstacles.push({type:'box',minX:cx-w/2-actorRadius,maxX:cx+w/2+actorRadius,minZ:cz-d/2-actorRadius,maxZ:cz+d/2+actorRadius});
 const blockCircle=(cx,cz,r)=>obstacles.push({type:'circle',x:cx,z:cz,r:r+actorRadius});
 if(outdoor){
  blockCircle(0,-1.35,1.25);blockCircle(-3,-2.5,.65);blockCircle(3,-2.5,.65);
  blockCircle(-2.8,.15,.10);blockCircle(2.8,.15,.10);blockBox(-2,-1.1,1.65,1.05);
  for(let i=0;i<6;i++)blockBox((i%2?1:-1)*3.3,-2.4+i*.9,.8,.62);
 } else {
  blockBox(-1.8,-1.8,1.65,1.05);blockCircle(-3.25,-2.5,.1);blockCircle(3.25,-2.5,.1);
  blockBox(options.placeId==='post'?1.8:1.9,options.placeId==='post'?-1.75:-1.9,options.placeId==='post'?1.4:1.3,options.placeId==='post'?.9:1);
 }
 function canStand(px,pz){if(px<minX||px>maxX||pz<minZ||pz>maxZ)return false;return !obstacles.some(o=>o.type==='box'?px>o.minX&&px<o.maxX&&pz>o.minZ&&pz<o.maxZ:Math.hypot(px-o.x,pz-o.z)<o.r);}
 function canTravel(ax,az,bx,bz){const steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/.065));for(let i=1;i<=steps;i++){const t=i/steps;if(!canStand(ax+(bx-ax)*t,az+(bz-az)*t))return false;}return true;}
 function moveBy(dx,dz){const nx=x+dx,nz=z+dz;if(canTravel(x,z,nx,nz)){x=nx;z=nz;return true;}let moved=false;if(canTravel(x,z,nx,z)){x=nx;moved=true;}if(canTravel(x,z,x,nz)){z=nz;moved=true;}return moved;}
 // Small A* grid is local to this room. It permits walking around obstacles,
 // and stops within interaction distance instead of trying to enter furniture.
 const gridStep=.18,cols=Math.floor((maxX-minX)/gridStep)+1,rows=Math.floor((maxZ-minZ)/gridStep)+1;
 const pointAt=(gx,gz)=>({x:minX+gx*gridStep,z:minZ+gz*gridStep});
 const cellAt=(px,pz)=>({gx:clamp(Math.round((px-minX)/gridStep),0,cols-1),gz:clamp(Math.round((pz-minZ)/gridStep),0,rows-1)});
 function findPath(goalX,goalZ,radius){
  const initial=cellAt(x,z);let start=null,best=Infinity;
  for(let dz=-3;dz<=3;dz++)for(let dx=-3;dx<=3;dx++){const gx=initial.gx+dx,gz=initial.gz+dz;if(gx<0||gx>=cols||gz<0||gz>=rows)continue;const p=pointAt(gx,gz),distance=Math.hypot(p.x-x,p.z-z);if(distance<best&&canStand(p.x,p.z)&&canTravel(x,z,p.x,p.z)){start={gx,gz};best=distance;}}
  if(!start)return [];
  const goalRadius=Math.max(radius,.13),index=(gx,gz)=>gz*cols+gx,total=cols*rows,gScore=new Float64Array(total).fill(Infinity),closed=new Uint8Array(total),prev=new Int32Array(total).fill(-1),startIndex=index(start.gx,start.gz);
  const startPoint=pointAt(start.gx,start.gz),estimate=p=>Math.max(0,Math.hypot(p.x-goalX,p.z-goalZ)-goalRadius),open=[{id:startIndex,score:estimate(startPoint)}];gScore[startIndex]=0;
  const steps=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];let end=-1;
  while(open.length){let smallest=0;for(let i=1;i<open.length;i++)if(open[i].score<open[smallest].score)smallest=i;const current=open.splice(smallest,1)[0].id;if(closed[current])continue;closed[current]=1;const gx=current%cols,gz=Math.floor(current/cols),p=pointAt(gx,gz);if(Math.hypot(p.x-goalX,p.z-goalZ)<=goalRadius){end=current;break;}
   for(const [dx,dz] of steps){const nx=gx+dx,nz=gz+dz;if(nx<0||nx>=cols||nz<0||nz>=rows)continue;const next=index(nx,nz),q=pointAt(nx,nz);if(closed[next]||!canStand(q.x,q.z)||!canTravel(p.x,p.z,q.x,q.z))continue;const tentative=gScore[current]+Math.hypot(dx,dz)*gridStep;if(tentative>=gScore[next])continue;gScore[next]=tentative;prev[next]=current;open.push({id:next,score:tentative+estimate(q)});}
  }
  if(end<0)return [];
  const result=[];for(let at=end;at!==-1;at=prev[at])result.push(pointAt(at%cols,Math.floor(at/cols)));result.reverse();
  // For ordinary ground taps, finish at the exact point if it is reachable.
  if(radius===0&&canStand(goalX,goalZ)){const tail=result[result.length-1];if(tail&&canTravel(tail.x,tail.z,goalX,goalZ))result.push({x:goalX,z:goalZ});}
  return result;
 }
 function updateNear(){const candidate=markers.map(marker=>({marker,d:Math.hypot(marker.x-x,marker.z-z)})).sort((a,b)=>a.d-b.d)[0];const next=candidate.d<1.02?candidate.marker:null;if(next===near)return;near=next;action.hidden=!near;if(near){action.textContent=near.button+' ↗';hint.textContent=`${near.label}에 도착했어요. 버튼 또는 E 키를 눌러 주세요.`;}else hint.textContent='바닥이나 표지를 누르거나 방향 버튼으로 걸어보세요.';for(const marker of markers)marker.ring.material.opacity=marker===near?1:.65;}
 function activate(){if(near)near.action();}
 action.addEventListener('click',activate,{signal:callbacks.signal});root.querySelectorAll('[data-interior="back"]').forEach(button=>button.addEventListener('click',()=>options.onBack?.(),{signal:callbacks.signal}));
 for(const {element,marker} of labelElements)element.addEventListener('click',event=>{event.stopPropagation();held.clear();pointer=null;path=findPath(marker.x,marker.z,.98);},{signal:callbacks.signal});
 const onKeyDown=event=>{const direction={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',W:'up',S:'down',A:'left',D:'right'}[event.key];if(direction){event.preventDefault();path=[];if(!held.has(direction)&&!event.repeat){const dir=dirs[direction];moveBy(dir[0]*.14,dir[1]*.14);updateNear();}held.add(direction);}else if((event.key==='e'||event.key==='E'||(event.key==='Enter' && event.target.tagName!=='BUTTON' && event.target.tagName!=='A'))&&near){event.preventDefault();activate();}};
 const onKeyUp=event=>{const direction={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',W:'up',S:'down',A:'left',D:'right'}[event.key];if(direction)held.delete(direction);};
 document.addEventListener('keydown',onKeyDown,{signal:callbacks.signal});document.addEventListener('keyup',onKeyUp,{signal:callbacks.signal});window.addEventListener('blur',()=>{held.clear();pointer=null;path=[];},{signal:callbacks.signal});
 for(const button of root.querySelectorAll('[data-direction]')){button.addEventListener('pointerdown',event=>{event.preventDefault();path=[];held.clear();pointer=button.dataset.direction;const dir=dirs[pointer];moveBy(dir[0]*.14,dir[1]*.14);updateNear();button.setPointerCapture?.(event.pointerId);},{signal:callbacks.signal});for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{pointer=null;},{signal:callbacks.signal});button.addEventListener('click',event=>{if(event.detail===0){const dir=dirs[button.dataset.direction];moveBy(dir[0]*.14,dir[1]*.14);updateNear();}},{signal:callbacks.signal});}
 stage.addEventListener('pointerdown',event=>{if(event.target.closest('button'))return;const r=stage.getBoundingClientRect(),point=new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-((event.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(point,camera);if(raycaster.ray.intersectPlane(ground,rayPoint)&&canStand(rayPoint.x,rayPoint.z)){path=findPath(rayPoint.x,rayPoint.z,0);held.clear();pointer=null;}},{signal:callbacks.signal});
 contextHandler=event=>{event.preventDefault();if(!disposed)options.onUnavailable?.();};renderer.domElement.addEventListener('webglcontextlost',contextHandler);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function resize(){const r=stage.getBoundingClientRect();if(!r.width||!r.height)return;camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(Math.round(r.width),Math.round(r.height),false);}
 if(typeof ResizeObserver==='function'){observer=new ResizeObserver(resize);observer.observe(stage);}else window.addEventListener('resize',resize,{signal:callbacks.signal});resize();
 const labelVector=new THREE.Vector3();
 function render(time){if(disposed)return;frame=requestAnimationFrame(render);if(last&&time-last<33)return;const dt=last?Math.min(.1,(time-last)/1000):0;last=time;let dx=0,dz=0;const all=new Set(held);if(pointer)all.add(pointer);for(const d of all){dx+=dirs[d][0];dz+=dirs[d][1];}if(dx||dz){const n=Math.hypot(dx,dz);dx/=n;dz/=n;}else {while(path.length&&Math.hypot(path[0].x-x,path[0].z-z)<.025)path.shift();if(path.length){const a=path[0].x-x,b=path[0].z-z,n=Math.hypot(a,b);dx=a/n;dz=b/n;}}
  let moving=false;if(dx||dz){const speed=path.length?Math.min(2.4*dt,Math.hypot(path[0].x-x,path[0].z-z)):2.4*dt;const oldX=x,oldZ=z;moveBy(dx*speed,dz*speed);moving=Math.hypot(x-oldX,z-oldZ)>.0001;if(!moving&&path.length)path=[];if(moving){angle=Math.atan2(x-oldX,z-oldZ);elapsed+=dt*10;}}
  root.dataset.playerX=x.toFixed(4);root.dataset.playerZ=z.toFixed(4);character.position.set(x,0,z);character.rotation.y=angle;body.position.y=moving&&!reduced?Math.abs(Math.sin(elapsed))*.07:0;leftLeg.rotation.x=moving&&!reduced?Math.sin(elapsed)*.55:0;rightLeg.rotation.x=-leftLeg.rotation.x;leftArm.rotation.x=-leftLeg.rotation.x*.7;rightArm.rotation.x=leftLeg.rotation.x*.7;updateNear();for(const {element,marker} of labelElements){labelVector.set(marker.x,.12,marker.z).project(camera);element.style.left=`${(labelVector.x*.5+.5)*100}%`;element.style.top=`${(-labelVector.y*.5+.5)*100}%`;}renderer.render(scene,camera);}

 if(options.placeId==='square'){const count=root.querySelector('.interior-count');countRequest=new AbortController();fetch('/api/v1/community-tree',{cache:'no-store',signal:countRequest.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(!disposed)count.textContent=`공동 트리에 모인 편지 ${Number(data.data.letterCount).toLocaleString('ko-KR')}통`;}).catch(error=>{if(!disposed&&error.name!=='AbortError')count.textContent='공동 트리의 편지를 잠시 불러올 수 없어요.';});}
 requestAnimationFrame(()=>{if(!disposed&&root.isConnected)root.querySelector('.interior-title')?.focus({preventScroll:true});});frame=requestAnimationFrame(render);return {dispose};
 } catch(error){dispose();throw error;}
}
