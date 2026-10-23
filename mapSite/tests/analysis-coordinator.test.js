import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnalysisCoordinator } from '../analysis-coordinator.js';
const candidates = n => Array.from({length:n}, (_, i) => ({id:String(i), analysis:{source:'local'}}));
const reviewed = batch => ({ recommendations: batch.map(candidate => ({...candidate, analysis:{source:'Gemini'}})) });

test('switching views shares one request and a finished analysis until explicit refresh', async () => {
  let calls = 0, release;
  const coordinator = createAnalysisCoordinator({ analyze: batch => { calls++; return new Promise(resolve => {release=()=>resolve(reviewed(batch));}); }, onUpdate() {}, onProgress() {} });
  coordinator.replace(candidates(2));
  const run = coordinator.run();
  await coordinator.run();
  assert.equal(calls, 1);
  release(); await run;
  await coordinator.run();
  assert.equal(calls, 1);
  const refresh = coordinator.run({force:true});
  assert.equal(calls, 2);
  release(); await refresh;
});

test('new reports cancel stale work and late responses cannot overwrite a new plan', async () => {
  let release, requestSignal;
  const updates = [], progress = [];
  const coordinator = createAnalysisCoordinator({ analyze: (batch,{signal}) => {requestSignal=signal;return new Promise(resolve=>{release=()=>resolve(reviewed(batch));});}, onUpdate: items=>updates.push(items), onProgress: state=>progress.push(state) });
  coordinator.replace(candidates(2));
  const pending = coordinator.run();
  coordinator.replace([{id:'new'}]);
  assert.equal(requestSignal.aborted,true);
  const progressCount=progress.length;
  release(); await pending;
  assert.deepEqual(updates.at(-1), [{id:'new'}]);
  assert.equal(progress.length,progressCount);
});

test('batch errors preserve successful evidence and report exact partial completion', async () => {
  let calls=0, latest, final;
  const offsets=[];
  const coordinator=createAnalysisCoordinator({analyze:async(batch,{candidateOffset})=>{offsets.push(candidateOffset);if(++calls===2)throw new Error('Offline');return reviewed(batch);},onUpdate:items=>{latest=items;},onProgress:state=>{final=state;}});
  coordinator.replace(candidates(6));await coordinator.run();
  assert.deepEqual(offsets,[0,4]);assert.equal(final.analyzed,4);assert.equal(final.failed,2);assert.equal(final.running,false);
  assert.equal(latest.filter(item=>item.analysis.source==='Gemini').length,4);
  assert.equal(latest.filter(item=>item.analysis.source==='local').length,2);
});

test('a lost connection or destroyed workspace cannot restart analysis on tab changes', async () => {
  let calls=0;
  const coordinator=createAnalysisCoordinator({analyze:async batch=>{calls++;return reviewed(batch);},onUpdate(){},onProgress(){}});
  coordinator.replace(candidates(2));
  coordinator.destroy();
  await coordinator.run();
  await coordinator.run({force:true});
  coordinator.replace(candidates(3));
  await coordinator.run();
  assert.equal(calls,0);
});
