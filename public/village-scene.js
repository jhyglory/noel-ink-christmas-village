import * as THREE from '/vendor/three.module.js';

// A small 3D village. Network coordinates are retained as normalized x/z ground positions.
const PLACES=[{id:'square',label:'🎄 트리 광장',x:.18,y:.62},{id:'post',label:'✉ 우체국',x:.50,y:.43},{id:'game',label:'✦ 게임장',x:.82,y:.62}];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const groundPoint=(x,y)=>new THREE.Vector3((clamp(x,0,1)-.5)*12,0,(clamp(y,0,1)-.5)*10);
const furColors={rabbit:0xf7e9d6,fox:0xce8965,bear:0xa88169,cat:0xaaa8b4};

export function mountVillageScene(container,options={}) {
 if(!(container instanceof HTMLElement))throw new TypeError('A village container is required.');
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
 const canvas=renderer.domElement,resources=new Set(),objects=new Map(),destinations=[];
 let observer=null,resize=null,onContextLost=null,labels=null,frame=0,disposed=false,paused=false,previous=0,ownId=null,viewWidth=1,viewHeight=1;
 const keep=x=>(resources.add(x),x);
 const material=(color,extra={})=>keep(new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true,...extra}));
 const basic=(color,extra={})=>keep(new THREE.MeshBasicMaterial({color,...extra}));
 const geom={};
 function mesh(geometry,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);return m;}
 function box(w,h,d,mat,x=0,y=0,z=0){const m=mesh(geom.cube,mat,x,y,z);m.scale.set(w,h,d);return m;}
 function ball(rx,ry,rz,mat,x=0,y=0,z=0){const m=mesh(geom.sphere,mat,x,y,z);m.scale.set(rx,ry,rz);return m;}
 function cone(radius,height,mat,x=0,y=0,z=0){const m=mesh(geom.cone,mat,x,y,z);m.scale.set(radius,height,radius);return m;}
 function cyl(radius,height,mat,x=0,y=0,z=0){const m=mesh(geom.cylinder,mat,x,y,z);m.scale.set(radius,height,radius);return m;}
 function shadow(m){m.castShadow=true;m.receiveShadow=true;return m;}
 function lookLabel(className,text){const el=document.createElement('span');el.className=className;el.textContent=text;Object.assign(el.style,{position:'absolute',transform:'translate(-50%,-100%)',padding:'5px 8px',borderRadius:'7px',background:'rgba(38,54,77,.90)',color:'#fff3df',font:'600 10px sans-serif',whiteSpace:'nowrap',maxWidth:'145px',overflow:'hidden',textOverflow:'ellipsis',boxShadow:'0 2px 8px #26364d44'});labels.append(el);return el;}
 try {
  canvas.className='village-canvas';canvas.setAttribute('aria-hidden','true');Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',display:'block',pointerEvents:'none'});container.prepend(canvas);
  labels=document.createElement('div');labels.setAttribute('aria-hidden','true');Object.assign(labels.style,{position:'absolute',inset:'0',overflow:'hidden',pointerEvents:'none'});container.append(labels);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene();
  const bg=document.createElement('canvas');bg.width=4;bg.height=256;const bgc=bg.getContext('2d');const gradient=bgc.createLinearGradient(0,0,0,256);gradient.addColorStop(0,'#344765');gradient.addColorStop(.53,'#a5899b');gradient.addColorStop(1,'#edbb9f');bgc.fillStyle=gradient;bgc.fillRect(0,0,4,256);const sky=keep(new THREE.CanvasTexture(bg));sky.colorSpace=THREE.SRGBColorSpace;scene.background=sky;
  const camera=new THREE.PerspectiveCamera(39,1,.1,100);camera.position.set(0,7.5,20);camera.lookAt(0,1.3,-.8);
  scene.add(new THREE.HemisphereLight(0xfff3dd,0x8a9bb6,2.0));const sun=new THREE.DirectionalLight(0xffe5bd,2.1);sun.position.set(-7,15,9);sun.castShadow=true;sun.shadow.mapSize.set(512,512);Object.assign(sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:.5,far:35});sun.shadow.bias=-.0007;scene.add(sun);
  geom.cube=keep(new THREE.BoxGeometry(1,1,1));geom.sphere=keep(new THREE.SphereGeometry(1,12,8));geom.cone=keep(new THREE.ConeGeometry(1,1,8));geom.cylinder=keep(new THREE.CylinderGeometry(1,1,1,10));
  const village=new THREE.Group();village.scale.z=1.35;scene.add(village);
  const mat={snow:material(0xf0e8e7),snowLight:material(0xfff9ef),snowShade:material(0xd8d7dd),stone:material(0xb4a6a6),brick:material(0xa96459),brickDark:material(0x874f4b),wood:material(0x624d48),woodLight:material(0xa47b64),roof:material(0x6b6775),pine:material(0x496458),pineDark:material(0x354f47),gold:material(0xe3bc80),red:material(0xa84f43),coat:material(0x3e536c),cream:material(0xf7e6c7),glass:material(0xf5be78,{emissive:0xc2732f,emissiveIntensity:.42}),dark:material(0x3b404b),pink:material(0xd59691)};
  const furMats=Object.fromEntries(Object.entries(furColors).map(([key,color])=>[key,material(color)]));
  const surroundingSnow=mesh(keep(new THREE.PlaneGeometry(80,18)),mat.snowShade,0,-.55,3);surroundingSnow.rotation.x=-Math.PI/2;village.add(surroundingSnow);const base=shadow(box(12,.46,10,mat.stone,0,-.28,0));village.add(base);const ground=shadow(box(12,.12,10,mat.snow,0,.015,0));village.add(ground);
  // Curved snowy paths connect the three destinations across the square.
  const pathMat=material(0xd4c4c0);const path=new THREE.CatmullRomCurve3([new THREE.Vector3(-4.7,.085,2.0),new THREE.Vector3(-2.6,.085,1.6),new THREE.Vector3(0,.085,.9),new THREE.Vector3(2.8,.085,1.5),new THREE.Vector3(4.8,.085,2.2)]);const pathMesh=mesh(keep(new THREE.TubeGeometry(path,36,.16,6,false)),pathMat);village.add(pathMesh);
  const postPath=mesh(keep(new THREE.BoxGeometry(.95,.035,2.6)),pathMat,0,.09,-.65);village.add(postPath);
  const gamePath=mesh(keep(new THREE.BoxGeometry(.75,.035,2)),pathMat,3.84,.09,.1);village.add(gamePath);
  // Snowy firs are solid layered cones, not billboard sprites.
  function fir(x,z,size,decorated=false){const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(size);g.add(cyl(.12,.58,mat.wood,0,.28,0));for(let i=0;i<3;i++){const y=.72+i*.48,r=1-i*.19;g.add(shadow(cone(r,1.18, i%2?mat.pine:mat.pineDark,0,y,0)));g.add(cone(r*.90,.36,mat.snowLight,0,y+.40,0));}
   if(decorated){for(let i=0;i<12;i++){const angle=i*2.399,y=.55+(i%5)*.31,r=.80-(y-.55)*.27;g.add(ball(.065,.065,.065,i%2?mat.red:mat.gold,Math.cos(angle)*r,y,Math.sin(angle)*r));}const star=mesh(keep(new THREE.OctahedronGeometry(.18)),mat.gold,0,2.18,0);g.add(star);}village.add(g);return g;}
  fir(-3.85,-.35,1.27,true);fir(-5.4,-3.5,.78);fir(5.35,-3.8,.8);fir(-5.5,3.8,.75);fir(5.5,3.7,.9);fir(-4.9,2.95,.42);fir(4.9,3,.48);
  // Freestanding low-poly buildings have actual walls, roof thickness, windows and doors.
  function building(x,z,w,d,h,kind){const g=new THREE.Group();g.position.set(x,0,z);const wall=kind==='post'?mat.brick:mat.woodLight;g.add(shadow(box(w,h,d,wall,0,h/2,0)));
   g.add(box(w+.16,.16,d+.15,mat.snowLight,0,h+.08,0));
   const roof=new THREE.Mesh(keep(new THREE.ConeGeometry(1,1,4,1)),mat.roof);roof.rotation.y=Math.PI/4;roof.scale.set(w*.78,1.25,d*.78);roof.position.y=h+.66;g.add(shadow(roof));
   const snowRoof=new THREE.Mesh(keep(new THREE.ConeGeometry(1,1,4,1)),mat.snowLight);snowRoof.rotation.y=Math.PI/4;snowRoof.scale.set(w*.79,.26,d*.79);snowRoof.position.y=h+1.21;g.add(snowRoof);
   const front=d/2+.015;g.add(box(.8,1.25,.10,mat.wood,0,.625,front));g.add(box(.56,.5,.03,mat.glass,0,.98,front+.065));g.add(ball(.035,.035,.035,mat.gold,.26,.53,front+.09));
   for(const side of [-1,1]){g.add(box(.82,.78,.08,mat.wood,side*w*.32,1.22,front));g.add(box(.65,.62,.04,mat.glass,side*w*.32,1.22,front+.06));g.add(box(.04,.65,.05,mat.wood,side*w*.32,1.22,front+.09));g.add(box(.68,.045,.05,mat.wood,side*w*.32,1.22,front+.09));g.add(box(.91,.1,.2,mat.snowLight,side*w*.32,.78,front+.09));}
   if(kind==='post'){g.add(box(.95,.63,.12,mat.cream,0,h-.12,front+.10));const seal=box(.60,.34,.02,mat.brickDark,0,h-.12,front+.18);g.add(seal);g.add(box(.44,.22,.02,mat.cream,0,h-.12,front+.20));g.add(cyl(.18,.95,mat.brickDark,-w*.3,h+1,-.1));g.add(box(.5,.11,.5,mat.snowLight,-w*.3,h+1.5,-.1));}
   else {g.add(box(1.2,.40,.12,mat.pineDark,0,h-.05,front+.10));for(let i=-1;i<=1;i++)g.add(ball(.07,.07,.07,mat.gold,i*.25,h-.05,front+.19));}
   village.add(g);return g;}
  const postPlaceholder=building(0,-3.05,3.35,2.25,2.32,'post');building(4,-1.8,2.35,1.85,1.95,'game');
  // Keep the procedural building visible until the local GLB is fully ready.
  // Loading failures and older cached installations retain the working fallback.
  const disposeModel=model=>{const all=new Set();model.traverse(node=>{if(node.geometry)all.add(node.geometry);for(const m of Array.isArray(node.material)?node.material:(node.material?[node.material]:[])){all.add(m);for(const value of Object.values(m))if(value?.isTexture)all.add(value);}});for(const resource of all){if(resource.isTexture && typeof resource.image?.close==='function')resource.image.close();resource.dispose?.();}};
  import('/vendor/addons/loaders/GLTFLoader.js').then(({GLTFLoader})=>{
   if(disposed)return;
   new GLTFLoader().load('/assets/post-office/post-office-meshy-mobile.glb',gltf=>{
    const model=gltf.scene;if(disposed){disposeModel(model);return;}
    const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    if(!Number.isFinite(size.x)||size.x<=0){disposeModel(model);return;}
    const scale=4.85/size.x;model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-3.05-center.z*scale);
    model.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    village.add(model);postPlaceholder.visible=false;keep({dispose(){village.remove(model);disposeModel(model);}});
   },undefined,()=>{});
  }).catch(()=>{});
  function lamp(x,z){const g=new THREE.Group();g.position.set(x,0,z);g.add(cyl(.075,1.55,mat.wood,0,.77,0));g.add(box(.34,.45,.34,mat.wood,0,1.68,0));g.add(box(.25,.31,.36,mat.glass,0,1.68,0));g.add(cone(.30,.23,mat.wood,0,2,0));g.add(ball(.075,.075,.075,mat.snowLight,0,2.12,0));village.add(g);}
  lamp(-2.1,-1.65);lamp(2.05,-1.55);lamp(-2.2,2.6);lamp(2.25,2.65);
  for(let i=0;i<7;i++){const x=-5.1+i*1.7;village.add(ball(.50,.15,.25,mat.snowLight,x,.12,-4.82));}
  // UI labels are DOM for legibility; floor rings and their corresponding places are 3D.
  for(const place of PLACES){const point=groundPoint(place.x,place.y);const ring=mesh(keep(new THREE.TorusGeometry(.49,.045,6,32)),mat.gold,point.x,.11,point.z);ring.rotation.x=Math.PI/2;village.add(ring);const label=lookLabel('destination-label',place.label);label.dataset.destination=place.id;destinations.push({...place,ring,label,point});}
  function setActiveDestination(id){if(disposed)return;for(const d of destinations){const active=d.id===id;d.label.style.background=active?'#a44738':'rgba(38,54,77,.90)';d.label.style.boxShadow=active?'0 0 0 3px #f8da9c88,0 4px 12px #26364d66':'0 2px 8px #26364d44';d.ring.scale.setScalar(active?1.25:1);}}
  function createCharacter(member){const g=new THREE.Group(),f=furMats[member.appearance]||furMats.rabbit;const body=shadow(ball(.34,.47,.25,mat.coat,0,.72,0));g.add(body);g.add(ball(.34,.16,.26,mat.red,0,1.02,0));const head=shadow(ball(.37,.34,.31,f,0,1.34,.01));g.add(head);
   if(member.appearance==='rabbit'||!furColors[member.appearance]){g.add(ball(.10,.37,.085,f,-.20,1.78,0));g.add(ball(.10,.37,.085,f,.20,1.78,0));g.add(ball(.04,.25,.025,mat.pink,-.20,1.81,.075));g.add(ball(.04,.25,.025,mat.pink,.20,1.81,.075));}
   else if(member.appearance==='bear'){g.add(ball(.14,.15,.11,f,-.30,1.58,0));g.add(ball(.14,.15,.11,f,.30,1.58,0));}
   else{for(const side of [-1,1]){const ear=cone(.15,.35,f,side*.26,1.65,0);ear.rotation.z=-side*.2;g.add(ear);}}
   for(const side of [-1,1])g.add(ball(.035,.042,.025,mat.dark,side*.13,1.37,.31));g.add(ball(.055,.04,.03,mat.pink,0,1.25,.325));
   const arms=[],legs=[];for(const side of [-1,1]){const arm=new THREE.Group();arm.position.set(side*.31,.95,0);arm.add(ball(.11,.30,.105,mat.coat,side*.025,-.20,0));arm.add(ball(.10,.095,.1,f,side*.025,-.44,0));g.add(arm);arms.push(arm);const leg=new THREE.Group();leg.position.set(side*.15,.36,0);leg.add(ball(.10,.20,.11,mat.wood,0,-.12,0));leg.add(ball(.115,.085,.17,mat.wood,0,-.30,.06));g.add(leg);legs.push(leg);}
   const label=lookLabel('player-label','');village.add(g);return {group:g,label,arms,legs,appearance:member.appearance,x:member.x??.5,y:member.y??.72,targetX:member.x??.5,targetY:member.y??.72,angle:0,waving:false,phase:0};}
  function removeCharacter(entry){village.remove(entry.group);entry.group.traverse(item=>{if(item.material&&item.material!==mat.coat&&item.material!==mat.red&&item.material!==mat.pink&&item.material!==mat.dark&&item.material!==mat.wood){/* shared materials are disposed with the scene */}});entry.label.remove();}
  function updateMembers(list,self){if(disposed)return;ownId=self;const seen=new Set();for(const p of list||[]){if(!p?.id)continue;seen.add(p.id);let e=objects.get(p.id);if(e&&e.appearance!==p.appearance){removeCharacter(e);objects.delete(p.id);e=null;}if(!e){e=createCharacter(p);objects.set(p.id,e);}e.targetX=clamp(Number.isFinite(p.x)?p.x:.5,0,1);e.targetY=clamp(Number.isFinite(p.y)?p.y:.72,0,1);e.waving=!!p.waving;e.label.textContent=String(p.nickname||'손님').slice(0,20)+(p.id===self?' · 나':'')+(p.waving?' 👋':'');}for(const [id,e]of objects)if(!seen.has(id)){removeCharacter(e);objects.delete(id);}}
  const particles=70,coords=new Float32Array(particles*3),flakes=[];for(let i=0;i<particles;i++){const s={x:Math.random()*14-7,y:Math.random()*9+.3,z:Math.random()*12-6,speed:.22+Math.random()*.25};flakes.push(s);coords[i*3]=s.x;coords[i*3+1]=s.y;coords[i*3+2]=s.z;}
  const snowGeo=keep(new THREE.BufferGeometry());snowGeo.setAttribute('position',new THREE.BufferAttribute(coords,3));const snowMat=keep(new THREE.PointsMaterial({color:0xfff8ee,size:.055,transparent:true,opacity:.8,depthWrite:false}));const snow=new THREE.Points(snowGeo,snowMat);village.add(snow);
  const raycaster=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.08),hit=new THREE.Vector3();
  // Player-side collision preserves free door approaches and keeps movement out of solid volumes.
  function isWalkable(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return false;const inPost=x>.30&&x<.70&&y>.062&&y<.328;const inGame=x>.715&&x<.95&&y>.207&&y<.433;const tree=Math.pow((x-.179)/.078,2)+Math.pow((y-.465)/.092,2)<1;return !(inPost||inGame||tree);}
  function screenToPosition(clientX,clientY){const rect=container.getBoundingClientRect();if(!rect.width||!rect.height)return null;const x=(clientX-rect.left)/rect.width*2-1,y=-(clientY-rect.top)/rect.height*2+1;raycaster.setFromCamera({x,y},camera);if(!raycaster.ray.intersectPlane(plane,hit)||hit.x < -6||hit.x > 6||hit.z < -6.75||hit.z > 6.75)return null;return{x:clamp(hit.x/12+.5,0,1),y:clamp(hit.z/13.5+.5,0,1)};}
  resize=()=>{if(disposed)return;const r=container.getBoundingClientRect();if(!r.width||!r.height)return;viewWidth=r.width;viewHeight=r.height;camera.aspect=r.width/r.height;camera.position.set(0,7.5,Math.max(19,15/Math.max(.65,camera.aspect)));camera.lookAt(0,1.3,-.8);camera.updateProjectionMatrix();renderer.setSize(Math.round(r.width),Math.round(r.height),false);};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,tmp=new THREE.Vector3();
  function projectLabel(el,p){tmp.copy(p);tmp.z*=1.35;tmp.project(camera);el.style.display=tmp.z < -1||tmp.z > 1?'none':'block';el.style.left=`${(tmp.x*.5+.5)*viewWidth}px`;el.style.top=`${(-tmp.y*.5+.5)*viewHeight}px`;}
  function draw(time){if(disposed||paused)return;frame=requestAnimationFrame(draw);if(previous&&time-previous<33)return;const dt=previous?Math.min(.1,(time-previous)/1000):0;previous=time;
   for(const e of objects.values()){const dx=e.targetX-e.x,dy=e.targetY-e.y,blend=Math.min(1,dt*9),moving=Math.hypot(dx,dy)>.0003;e.x+=dx*blend;e.y+=dy*blend;const p=groundPoint(e.x,e.y);e.group.position.set(p.x,.08,p.z);if(moving){const target=Math.atan2(dx*12,dy*10);let diff=(target-e.angle+Math.PI*3)%(Math.PI*2)-Math.PI;e.angle+=diff*Math.min(1,dt*10);}e.group.rotation.y=e.angle;e.phase+=dt*11;const swing=moving&&!reduced?Math.sin(e.phase)*.55:0;e.legs[0].rotation.x=swing;e.legs[1].rotation.x=-swing;e.arms[0].rotation.x=-swing*.8;e.arms[1].rotation.x=e.waving?-.9:swing*.8;e.group.position.y=.08+(moving&&!reduced?Math.abs(Math.sin(e.phase))*.035:0);projectLabel(e.label,new THREE.Vector3(p.x,2.35,p.z));}
   for(const d of destinations)projectLabel(d.label,new THREE.Vector3(d.point.x,d.id==='post'?2.7:d.id==='game'?2.35:2.5,d.point.z));
   if(!reduced){for(let i=0;i<flakes.length;i++){const f=flakes[i];f.y-=f.speed*dt;if(f.y<.15){f.y=9;f.x=Math.random()*14-7;f.z=Math.random()*12-6;}coords[i*3]=f.x;coords[i*3+1]=f.y;coords[i*3+2]=f.z;}snowGeo.attributes.position.needsUpdate=true;}
   renderer.render(scene,camera);
  }
  function setPaused(value){if(disposed)return;const next=!!value;if(next===paused)return;paused=next;previous=0;if(paused){cancelAnimationFrame(frame);frame=0;}else frame=requestAnimationFrame(draw);}
  onContextLost=event=>{event.preventDefault();if(!disposed)options.onUnavailable?.();};canvas.addEventListener('webglcontextlost',onContextLost);
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(resize);observer.observe(container);}else window.addEventListener('resize',resize);resize();frame=requestAnimationFrame(draw);
  return {updateMembers,setActiveDestination,screenToPosition,isWalkable,setPaused,dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',resize);canvas.removeEventListener('webglcontextlost',onContextLost);for(const e of objects.values())removeCharacter(e);objects.clear();for(const d of destinations)d.label.remove();for(const r of resources)r.dispose();renderer.dispose();renderer.forceContextLoss?.();labels.remove();canvas.remove();}};
 } catch(error){disposed=true;cancelAnimationFrame(frame);observer?.disconnect();if(resize)window.removeEventListener('resize',resize);if(onContextLost)canvas.removeEventListener('webglcontextlost',onContextLost);for(const r of resources){try{r.dispose();}catch{}}try{renderer.dispose();renderer.forceContextLoss?.();}catch{}canvas.remove();labels?.remove();throw error;}
}
