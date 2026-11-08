import test from 'node:test';
import assert from 'node:assert/strict';
import {filterModels,modelGroups,normalizeModelScope,modelName} from '../modules/shared/model-browser-state.js';
import type {ModelPresentationSummary} from '../src/view/view-sdk.js';
const model=(id:string,origin:'project'|'system'|'market',packageId?:string,tags:string[]=[]):ModelPresentationSummary=>({id,origin,builtin:origin==='system',status:'available',metaModel:'json-schema/draft-07.json',title:'Definition name',description:'Definition description',registration:{modelRef:id,storage:'store',store_id:'models/json-schema/draft-07',name:id==='order.json'?'订单':'Note',tags,...(packageId?{package:packageId,package_name:'订单包'}:{})}});
const models=[model('plain.json','project'),model('order.json','project','commerce',['订单','example']),model('builtin.json','system','commerce'),model('imported.json','market','commerce',['external'])];
test('Project unpackaged scope excludes system and imported models, even when a package ID is shared',()=>{
 assert.deepEqual(filterModels(models,'custom').map(m=>m.id),['plain.json']);
 assert.deepEqual(filterModels(models,'project:commerce').map(m=>m.id),['order.json']);
 assert.equal(modelGroups(models).length,3);
});
test('Search combines package scope and exact tag, matching managed name, ID, description and tags',()=>{
 assert.equal(filterModels(models,'project:commerce','订单','EXAMPLE')[0]?.id,'order.json');
 assert.equal(filterModels(models,'project:commerce','external','订单').length,0);
 assert.equal(filterModels(models,'project:commerce','','description')[0]?.id,'order.json');
 assert.equal(filterModels(models,'project:commerce','','   ').length,1);
 assert.equal(filterModels(models,'project:commerce','','unknown').length,0);
});
test('Missing managed names fall back to definition title and then model identity',()=>{
 assert.equal(modelName({...models[0],registration:undefined}),'Definition name');
 assert.equal(modelName({...models[0],registration:undefined,title:undefined}),'plain.json');
});
test('Scope normalization preserves valid package identity and sends unknown scope to unpackaged',()=>{
 assert.equal(normalizeModelScope(models,'project:commerce'),'project:commerce');
 assert.equal(normalizeModelScope(models,'commerce'),'project:commerce');
 assert.equal(normalizeModelScope(models,'missing'),'custom');
});
