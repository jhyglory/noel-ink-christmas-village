import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWalkPath } from '../public/world-navigation.js';

test('paths detour around obstacles without crossing them', () => {
 const open=(x,y)=>!(x>.36&&x<.64&&y>.28&&y<.64);
 const start={x:.18,y:.43}, goal={x:.82,y:.43};
 const path=findWalkPath(start,goal,open);
 assert.ok(path?.length>1);assert.deepEqual(path.at(-1),goal);
 let current=start;for(const next of path){for(let i=1;i<=100;i++){const t=i/100;assert.ok(open(current.x+(next.x-current.x)*t,current.y+(next.y-current.y)*t));}current=next;}
});
test('blocked endpoints and impassable barriers do not produce a path', () => {
 const split=(x,y)=>!(x>.45&&x<.55);
 assert.equal(findWalkPath({x:.2,y:.5},{x:.8,y:.5},split),null);
 assert.equal(findWalkPath({x:.2,y:.5},{x:.5,y:.5},split),null);
 assert.equal(findWalkPath({x:-1,y:.5},{x:.8,y:.5},()=>true),null);
 assert.deepEqual(findWalkPath({x:.2,y:.5},{x:.8,y:.5},()=>true),[{x:.8,y:.5}]);
});
