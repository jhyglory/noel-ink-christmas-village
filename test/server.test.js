import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';

async function freePort() { return await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});}); }
async function start(data,port) {
 const proc=spawn(process.execPath,['server/server.js'],{env:{...process.env,TREEPICK_DATA_DIR:data,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let log='';proc.stderr.on('data',chunk=>log+=chunk);
 for(let i=0;i<100;i++){if(proc.exitCode!==null)throw new Error('Server exited: '+log);try{const res=await fetch(`http://127.0.0.1:${port}/api/health`);if(res.ok)return proc;}catch{}await new Promise(r=>setTimeout(r,30));}
 proc.kill();throw new Error('Server failed to start: '+log);
}
function stop(proc){return new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once('exit',resolve);proc.kill();});}
async function request(base,endpoint,method='GET',body,headers={}){const res=await fetch(base+endpoint,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,headers:res.headers,data:await res.json()};}
function connect(port,code,token){return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);const timer=setTimeout(()=>reject(new Error('socket timeout')),3000);ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'auth',code,token})));ws.on('message',data=>{const m=JSON.parse(data);if(m.type==='welcome'){clearTimeout(timer);resolve(ws);}});});}
function message(ws,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(new Error('Missing '+type));},3000);function handler(raw){const value=JSON.parse(raw);if(value.type===type){clearTimeout(timer);ws.off('message',handler);resolve(value);}}ws.on('message',handler);});}

test('letters, separate delete authority, rooms, live movement, and persistent records',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'treepick-test-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let proc;
 try{
  proc=await start(data,port);
  const key=randomBytes(32).toString('base64url'), headers={'Idempotency-Key':key};
  const payload={sender:'토끼',recipient:'친구',text:'성탄 인사',paper:'snow',stamp:'tree'};
  assert.equal((await request(base,'/api/letters','POST',payload)).status,400);
  assert.equal((await request(base,'/api/letters','POST',{...payload,text:'가'.repeat(1001)},headers)).status,400);
  assert.equal((await request(base,'/api/letters','POST',{...payload,paper:'special'},headers)).status,400);
  const [created,duplicate]=await Promise.all([request(base,'/api/letters','POST',payload,headers),request(base,'/api/letters','POST',payload,headers)]);
  assert.deepEqual([created.status,duplicate.status].sort(),[200,201]);
  const {readToken,manageToken}=created.data;assert.notEqual(readToken,manageToken);assert.equal(duplicate.data.readToken,readToken);assert.equal(duplicate.data.manageToken,manageToken);
  assert.equal((await request(base,'/api/letters','POST',{...payload,text:'다른 내용'},headers)).status,409);
  const read=await request(base,'/api/letters/'+readToken);assert.equal(read.data.letter.text,'성탄 인사');assert.equal(read.data.letter.paper,'snow');assert.equal(read.headers.get('cache-control'),'no-store');
  assert.equal((await request(base,'/api/v1/community-tree')).data.data.letterCount,1);
  const v1Read=await request(base,'/api/v1/letters/read/'+readToken);assert.equal(v1Read.data.data.body,'성탄 인사');assert.ok(v1Read.data.requestId);
  assert.equal((await request(base,'/api/letters/'+readToken,'DELETE')).status,404);
  assert.equal((await request(base,'/api/letters/'+readToken+'/replies','POST',{author:'친구',text:'고마워요'})).status,201);
  const room=(await request(base,'/api/rooms','POST',{name:'마을',nickname:'토끼',appearance:'fox'})).data;
  const other=(await request(base,`/api/rooms/${room.room.code}/join`,'POST',{nickname:'친구'})).data;
  const one=await connect(port,room.room.code,room.token),two=await connect(port,room.room.code,other.token);
  const moved=message(two,'position');one.send(JSON.stringify({type:'position',x:.45,y:.72}));assert.equal((await moved).x,.45);
  const waved=message(one,'wave');two.send(JSON.stringify({type:'wave'}));assert.equal((await waved).memberId,other.room.member.id);one.close();two.close();
  assert.equal((await request(base,'/api/leaderboard/first-snow','POST',{name:'토끼',moves:10})).status,201);
  assert.equal((await request(base,'/api/leaderboard/first-snow','POST',{name:'토끼',moves:-1})).status,400);
  await stop(proc);proc=await start(data,port);
  const persisted=await request(base,'/api/letters/'+readToken);assert.equal(persisted.data.letter.replies[0].text,'고마워요');
  assert.equal((await request(base,'/api/leaderboard/first-snow')).data.entries[0].moves,10);
  const replay=await request(base,'/api/letters','POST',payload,headers);assert.equal(replay.data.manageToken,manageToken);assert.equal(replay.data.readToken,readToken);
  const db=JSON.parse(await readFile(path.join(data,'treepick.json'),'utf8'));const serialized=JSON.stringify(db);
  assert.equal(serialized.includes(key),false);assert.equal(serialized.includes(readToken),false);assert.equal(serialized.includes(manageToken),false);
  assert.equal((await request(base,'/api/letters/'+manageToken,'DELETE')).status,200);assert.equal((await request(base,'/api/letters/'+readToken)).status,410);
  assert.equal((await request(base,'/api/v1/community-tree')).data.data.letterCount,1);
 }finally{if(proc)await stop(proc);await rm(data,{recursive:true,force:true});}
});

test('expiry blocks body and replies without changing the provisional tree count',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'treepick-expiry-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let proc;
 try {
  proc=await start(data,port);
  const headers={'Idempotency-Key':randomBytes(32).toString('base64url')};
  const result=await request(base,'/api/letters','POST',{sender:'a',recipient:'b',text:'secret'},headers);
  const {readToken}=result.data; const saved=new Date(result.data.letter.createdAt), expiry=new Date(result.data.letter.expiresAt);
  assert.equal(expiry.getUTCFullYear(),saved.getUTCFullYear()+1);
  await stop(proc);const file=path.join(data,'treepick.json'),db=JSON.parse(await readFile(file,'utf8'));
  db.letters[0].expiresAt='2000-01-01T00:00:00.000Z';await writeFile(file,JSON.stringify(db));
  proc=await start(data,port);
  const read=await request(base,'/api/letters/'+readToken);assert.equal(read.status,410);assert.equal(JSON.stringify(read.data).includes('secret'),false);
  assert.equal((await request(base,`/api/letters/${readToken}/replies`,'POST',{author:'c',text:'reply'})).status,410);
  assert.equal((await request(base,'/api/v1/community-tree')).data.data.letterCount,1);
 } finally {if(proc)await stop(proc);await rm(data,{recursive:true,force:true});}
});

test('concurrent room authentication never exceeds 12 active members',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'treepick-room-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let proc;const clients=[];
 try {
  proc=await start(data,port);const owner=(await request(base,'/api/rooms','POST',{name:'마을',nickname:'0'})).data;
  const members=[owner];for(let i=1;i<13;i++)members.push((await request(base,`/api/rooms/${owner.room.code}/join`,'POST',{nickname:String(i)})).data);
  const results=await Promise.all(members.map(member=>new Promise((resolve,reject)=>{
   const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);clients.push(ws);const timer=setTimeout(()=>reject(new Error('auth timeout')),3000);
   ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'auth',code:owner.room.code,token:member.token})));
   ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome'){clearTimeout(timer);resolve(true);}});
   ws.on('close',()=>{clearTimeout(timer);resolve(false);});
  })));
  assert.equal(results.filter(Boolean).length,12);assert.equal(results.filter(x=>!x).length,1);
 } finally {for(const client of clients)client.terminate();if(proc)await stop(proc);await rm(data,{recursive:true,force:true});}
});

test('a failed storage write does not increment the tree or reserve the idempotency key',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'treepick-fail-')),data=path.join(parent,'store'),backup=path.join(parent,'backup'),port=await freePort(),base=`http://127.0.0.1:${port}`;let proc;
 try {
  proc=await start(data,port);const headers={'Idempotency-Key':randomBytes(32).toString('base64url')};
  const payload={sender:'a',recipient:'b',text:'retry after failure'};
  await rename(data,backup);await writeFile(data,'not a directory');
  assert.equal((await request(base,'/api/letters','POST',payload,headers)).status,500);
  assert.equal((await request(base,'/api/v1/community-tree')).data.data.letterCount,0);
  await rm(data);await rename(backup,data);
  const retried=await request(base,'/api/letters','POST',payload,headers);assert.equal(retried.status,201);
  assert.equal((await request(base,'/api/v1/community-tree')).data.data.letterCount,1);
 } finally {if(proc)await stop(proc);await rm(parent,{recursive:true,force:true});}
});

test('missing or replaced replay secret fails closed after idempotent letters exist',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'treepick-secret-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let proc;
 try {
  proc=await start(data,port);const headers={'Idempotency-Key':randomBytes(32).toString('base64url')};
  assert.equal((await request(base,'/api/letters','POST',{sender:'a',recipient:'b',text:'secret'},headers)).status,201);
  await stop(proc);proc=null;
  const file=path.join(data,'replay-secret.key'),original=await readFile(file);
  await rm(file);await assert.rejects(start(data,port),/Replay secret is missing/);
  await writeFile(file,randomBytes(32));await assert.rejects(start(data,port),/Replay secret does not match/);
  await writeFile(file,original);proc=await start(data,port);
  assert.equal((await request(base,'/api/v1/community-tree')).data.data.letterCount,1);
 } finally {if(proc)await stop(proc);await rm(data,{recursive:true,force:true});}
});
