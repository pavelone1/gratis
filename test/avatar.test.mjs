import test from 'node:test';import assert from 'node:assert/strict';import {avatarSvg,avatarColor,avatarShape,BOT_SHAPES,avatarAppearance} from '../src/avatar.mjs';
test('badges are original vector primitives with deterministic choices and bounded colors',()=>{for(const {shape}of BOT_SHAPES){const svg=decodeURIComponent(avatarSvg('Test','#86d6b2',shape).split(',')[1]);assert.match(svg,/<svg/);assert.doesNotMatch(svg,/<script|onload=|<image|<text/);}assert.equal(avatarShape('Research'),avatarShape('Research'));assert.doesNotMatch(avatarSvg('x','\" onload=\"evil()'),/onload/);assert.match(avatarColor('not-a-color'),/^#/);assert.equal(avatarAppearance({name:'Test',avatarDataUrl:'data:image/png;base64,dGVzdA=='}).photo,'data:image/png;base64,dGVzdA==');});

import {CRITTER_IDS,isCritter} from '../src/avatar.mjs';
import {DOMParser} from 'linkedom';
const svgOf=(shape,color,mode)=>decodeURIComponent(avatarSvg('Maple',color,shape,mode).split(',')[1]);

test('every critter is a well-formed, script-free SVG with idle and working animation',()=>{
  assert.equal(CRITTER_IDS.length,10);
  for(const shape of CRITTER_IDS){
    assert.equal(isCritter(shape),true);assert.ok(BOT_SHAPES.some(s=>s.id===shape));
    for(const mode of ['idle','streaming']){
      const svg=svgOf(shape,'#83d5cd',mode);
      const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
      assert.equal(doc.documentElement.nodeName.toLowerCase(),'svg',shape);
      assert.doesNotMatch(svg,/<script|onload=|<image|<text|<foreignObject|href=/i,shape);
      assert.match(svg,/@keyframes blink/);assert.match(svg,/prefers-reduced-motion:reduce/);assert.match(svg,/class="eye"/);
      assert.equal(/class="dot"/.test(svg),mode==='streaming',`${shape} ${mode}: thinking dots only while working`);
      assert.equal(/class="working"/.test(svg),mode==='streaming');
    }
  }
});

test('critters adapt face colour to light and dark bodies, stay deterministic, and reject unsafe colours',()=>{
  assert.match(svgOf('cat','#c4d1cf','idle'),/fill="#1f2b29"/);   // pale body: dark face
  assert.match(svgOf('cat','#30433f','idle'),/fill="#fbf7ee"/);   // dark body: light face
  assert.equal(avatarSvg('Maple','#83d5cd','owl'),avatarSvg('Maple','#83d5cd','owl'));
  assert.notEqual(avatarSvg('Maple','#83d5cd','owl','idle'),avatarSvg('Maple','#83d5cd','owl','streaming'));
  assert.doesNotMatch(avatarSvg('x','" onload="evil()','fox'),/onload/);
  assert.equal(isCritter('blob'),false);
  assert.match(svgOf('blob','#83d5cd','streaming'),/<circle cx="50" cy="50" r="19"/); // old outline badges still render
});

test('bots can be created and saved with a critter avatar, unknown shapes are still rejected',async()=>{
  const {ChatService}=await import('../src/chat-service.mjs');
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'gravis-critter-'));const s=new ChatService({dataDir:dir,backend:async function*(){yield 'ok';}});await s.init();
  try{
    const st=await s.createBot({name:'Penny',instructions:'x',avatarShape:'penguin',avatarColor:'blue',promptMode:'manual'});
    assert.equal(s._bot(st.activeBotId).avatarShape,'penguin');
    await s.updateBot({id:st.activeBotId,avatarShape:'octopus'});assert.equal(s._bot(st.activeBotId).avatarShape,'octopus');
    await assert.rejects(s.updateBot({id:st.activeBotId,avatarShape:'dragon'}),/supported avatar shape/);
  }finally{await s.close();await rm(dir,{recursive:true,force:true});}
});
