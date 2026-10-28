import { defineViewPlugin, slots } from '@memsphere/view-sdk';
import fixtures from '../fixtures.json' with { type: 'json' };
import markup from './markup.js';

// Presentation fixtures mirror existing Memory and context-control models.
// Coordinates, selection and translations are UI state, never business fields.
export const procedure = fixtures.procedure;
export const snapshots = fixtures.snapshots;
const positions = { prepare:[26,98], check:[280,98], analyze:[534,98], gather:[280,292], summarize:[534,292] };
const paths = {
  'START:prepare':'M48 78 L48 98', 'prepare:check':'M204 143 L280 143',
  'check:analyze':'M458 143 L534 143',
  'analyze:check':'M623 98 L623 45 Q623 30 608 30 L384 30 Q369 30 369 45 L369 98',
  'check:gather':'M369 187 L369 292', 'gather:summarize':'M458 337 L534 337'
};
const stepLabels = {pending:'待执行',running:'执行中',awaiting_review:'待评审',done:'已完成',failed:'失败',cancelled:'已取消'};
const runLabels = {running:'运行中',done:'已完成',abandoned:'已废弃'};
const voteLabels = {approve:'通过',request_changes:'要求修改',abstain:'弃权'};
const reviewLabels = {pending:'待评审',running:'评审中',submitted:'已提交',cancelled:'已取消'};
const artifactLabels = {draft:'草稿',submitted:'已提交'};
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function actionSteps(snapshot, id) {
  return snapshot.steps.filter(s=>s.source?.actionId===id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
export function statusCounts(steps) {
  return Object.keys(stepLabels).map(status=>({status,count:steps.filter(s=>s.status===status).length})).filter(x=>x.count);
}
export function artifactVersions(snapshot, stepId) {
  const entries=snapshot.artifacts.filter(a=>a.stepId===stepId), byId=new Map(entries.map(a=>[a.id,a]));
  const depth=a=>{let n=0,seen=new Set();while(a?.revisedFrom&&byId.has(a.revisedFrom)&&!seen.has(a.id)){seen.add(a.id);n++;a=byId.get(a.revisedFrom);}return n;};
  return entries.sort((a,b)=>depth(a)-depth(b)||a.id.localeCompare(b.id));
}

export default defineViewPlugin({
  name:'procedure-graph-prototype',apiVersion:1,
  inject:['slots','router','theme','ui'],themeVersion:1,uiVersion:1,
  apply(ctx) {
    const text=value=>({text:value});
    const route=ctx.router.register({id:'prototype',path:'/'});
    ctx.slots.register(slots.navigationPrimary,{id:'navigation',order:86,value:{label:text('Graph 原型'),icon:{kind:'system',name:'stack'},route:route.to()}});
    ctx.slots.register(slots.headerTitle,{id:'title',when:route.activation,value:{title:text('Graph 记忆与运行'),breadcrumbs:[{label:text('交互原型')}]}});
    ctx.slots.register(slots.mainView,{id:'page',key:route.key,when:route.activation,value:{mount({element}) {
      element.innerHTML=markup;
      const root=element.querySelector('#gm-proto'),q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)];
      q('#gm-detail').remove();q('#gm-overlay').remove();
      const controller=new AbortController();
      const state={view:'definition',node:'analyze',edge:null,scenario:'review',stepId:'s-analyze-2',artifactId:'a-analyze-2-v2',zoom:1,sources:false};
      let opener,disposed=false,restoringFocus=false,runDialog,dialogKind,dialogStepId,dialogArtifactId,dialogPane='content';
      const snapshot=()=>snapshots[state.scenario];
      const action=()=>procedure.actions.find(a=>a.id===state.node);
      const mark=(content,path)=>`<span data-source="${escape(path)}" title="${escape(path)}">${escape(content)}</span><span class="gm-source">${escape(path)}</span>`;
      const value=(v,path)=>mark(typeof v==='object'?JSON.stringify(v):v,path);
      const pill=(v,c='',path)=>`<span class="gm-pill ${c}">${path?mark(v,path):escape(v)}</span>`;
      const row=(label,v,path)=>`<dt>${escape(label)}</dt><dd>${value(v,path)}</dd>`;
      const pre=(v,path)=>`<pre class="gm-record" data-source="${escape(path)}">${escape(typeof v==='string'?v:JSON.stringify(v,null,2))}</pre><span class="gm-source">${escape(path)}</span>`;
      const button=(label,attr)=>`<button class="gm-link" ${attr}>${escape(label)}</button>`;
      const displayRef=id=>id==='START'?'开始':id;
      q('.gm-start').textContent='开始';
      q('.gm-start').setAttribute('aria-label','开始');
      const preview=document.createElement('div');preview.className='gm-edge-preview';preview.hidden=true;preview.setAttribute('role','tooltip');q('.gm-stage').append(preview);
      function edges() {
        return procedure.actions.flatMap(a=>[
          ...a.dependencies.flatMap((dependency,index)=>(Array.isArray(dependency.from)?dependency.from:[dependency.from]).map(from=>({id:`${a.id}:${index}:${from}`,from,to:a.id,index,dependency,path:paths[`${from}:${a.id}`],kind:'dependency'}))),
          ...(a.collect??[]).map((from,index)=>({id:`${a.id}:collect:${from}`,from,to:a.id,index,kind:'collect',path:'M623 187 L623 252 Q623 265 610 265 L468 265 Q450 265 442 292'}))
        ]);
      }
      function edgeContent(edge) {
        const source=edge.kind==='collect'?'Action.collect':`Action.dependencies[${edge.index}].from`;
        let html=`<h3>${edge.kind==='collect'?'收集关系':'执行依赖'}</h3><dl class="gm-dl">${row('来自',displayRef(edge.from),source)}${row('指向',edge.to,'Action.id')}</dl>`;
        if(edge.dependency?.when)html+='<h4>条件</h4>'+pre(edge.dependency.when,`Action.dependencies[${edge.index}].when`);
        if(Array.isArray(edge.dependency?.from))html+='<h4>共同等待</h4>'+pre(edge.dependency.from,source);
        return html;
      }
      function highlightEdge(id) {
        const edge=edges().find(e=>e.id===id);
        qa('[data-edge-line]').forEach(line=>line.dataset.highlighted=String(line.dataset.edgeLine===edge?.id));
        qa('.gm-edge-condition').forEach(label=>label.dataset.highlighted=String(label.dataset.edge===edge?.id));
        qa('[data-node]').forEach(node=>node.dataset.edgeHighlighted=String(!!edge&&[edge.from,edge.to].includes(node.dataset.node)));
        q('.gm-start').dataset.edgeHighlighted=String(edge?.from==='START');
      }
      function showEdgePreview(id,target,event) {
        const edge=edges().find(e=>e.id===id);if(!edge)return;
        highlightEdge(id);preview.innerHTML=`<strong>${escape(displayRef(edge.from))} → ${escape(edge.to)}</strong>`+(edge.dependency?.when?'<div>条件</div><code>'+escape(edge.dependency.when)+'</code>':'');
        const stage=q('.gm-stage').getBoundingClientRect(),box=target.getBoundingClientRect();
        const x=event?.clientX??box.x+box.width/2,y=event?.clientY??box.y+box.height/2;
        preview.hidden=false;preview.style.left=Math.max(8,Math.min(x-stage.x+12,stage.width-preview.offsetWidth-8))+'px';preview.style.top=Math.max(8,Math.min(y-stage.y+12,stage.height-preview.offsetHeight-8))+'px';
      }
      function hideEdgePreview(){preview.hidden=true;highlightEdge();}
      function selectEdge(id){opener=q(`[data-edge="${id}"]`);state.edge=id;hideEdgePreview();renderNodes();highlightEdge();dialogKind='edge';renderRunDialog();}
      q('h2').innerHTML=value(procedure.names[1]??procedure.names[0],'Procedure.names');
      q('.gm-desc').innerHTML=procedure.defines.map(v=>value(v,'Procedure.defines')).join('<br>');
      q('.gm-eyebrow').replaceChildren(ctx.ui.badge(text('原型 · 示例数据')));
      function renderNodes() {
        q('#gm-nodes').innerHTML=procedure.actions.map(a=>{
          const [x,y]=positions[a.id],steps=actionSteps(snapshot(),a.id);
          const badges=state.view==='definition'
            ? a.collect?pill('collect','neutral','Action.collect'):pill(a.actor??'agent','neutral','Action.actor (default: agent)')
            : statusCounts(steps).map(s=>pill(`${stepLabels[s.status]} ${s.count}`,s.status==='awaiting_review'?'wait':'','count(Step.status; source.actionId = '+a.id+')')).join('');
          const sub=state.view==='definition'?(a.artifact?value(a.artifact.name,'Action.artifact.name'):value(a.collect,'Action.collect')):value(`${steps.length} 次执行`,'count(Step where source.actionId = '+a.id+')');
          return `<button class="gm-node" style="left:${x}px;top:${y}px" data-node="${a.id}"><div class="gm-node-top"><span class="gm-type">${escape(a.id)}</span>${badges}</div><b>${value(a.description,'Action.description')}</b><small>${sub}</small></button>`;
        }).join('');
      }
      function renderEdges() {
        q('#gm-edges').innerHTML=edges().filter(e=>e.path).map(edge=>`<path d="${edge.path}" marker-end="url(#gm-arrow)" data-edge-line="${edge.id}" ${edge.kind==='collect'?'stroke-dasharray="5 5"':''}></path><path d="${edge.path}" class="gm-edge-hit" data-edge="${edge.id}" role="button" tabindex="0" aria-label="${escape(`${displayRef(edge.from)} 指向 ${edge.to}${edge.dependency?.when?'，条件：'+edge.dependency.when:''}`)}"></path>`).join('');
        qa('.gm-edge-condition').forEach(e=>e.remove());
        for(const a of procedure.actions) a.dependencies.forEach((d,index)=>{
          if(!d.when)return;
          const b=document.createElement('button');b.className='gm-edge-condition';b.textContent='条件';
          b.dataset.edge=`${a.id}:${index}:${Array.isArray(d.from)?d.from[0]:d.from}`;b.setAttribute('aria-label','条件：'+d.when);
          b.style.left=(a.id==='analyze'?478:386)+'px';b.style.top=(a.id==='analyze'?122:230)+'px';
          q('.gm-world').append(b);
        });
        qa('[data-edge]').forEach(target=>{
          target.addEventListener('pointerenter',event=>showEdgePreview(target.dataset.edge,target,event));
          target.addEventListener('pointerleave',hideEdgePreview);
          target.addEventListener('focus',()=>{if(!restoringFocus)showEdgePreview(target.dataset.edge,target);});
          target.addEventListener('blur',hideEdgePreview);
        });
        highlightEdge();
      }
      function renderDefinition(a) {
        let html=`<dl class="gm-dl">${a.actor?row('执行者',a.actor,'Action.actor'):''}${a.artifact?row('产物',a.artifact.name,'Action.artifact.name')+row('内容类型',a.artifact.payload.contentType,'Action.artifact.payload.contentType'):row('收集来源',a.collect,'Action.collect')}</dl>`;
        html+='<h4>依赖</h4>'+a.dependencies.map((d,i)=>`<div class="gm-row"><dl class="gm-dl">${row('来自',Array.isArray(d.from)?d.from.map(displayRef):displayRef(d.from),`Action.dependencies[${i}].from`)}${d.when?row('条件',d.when,`Action.dependencies[${i}].when`):''}</dl></div>`).join('');
        if(a.artifact?.review)html+='<h4>评审</h4>'+value(a.artifact.review,'Action.artifact.review');
        if(a.asserts)html+='<h4>执行约束</h4>'+pre(a.asserts,'Action.asserts');
        if(a.artifact?.model){
          let definition=a.artifact.model.definition;
          try{definition=JSON.parse(definition);}catch{ /* Keep the original stored text. */ }
          html+='<h4>产物模型</h4>'+value(a.artifact.model.definedBy,'Action.artifact.model.definedBy')+'<details class="gm-model-definition"><summary>模型定义</summary>'+pre(definition,'Action.artifact.model.definition')+'</details>';
        }
        html+='<h4>定义</h4>'+button('查看完整定义','data-modal="source"');
        return html;
      }
      function artifactBody(artifact) {
        const payload=artifact.content?.payload;
        if(!payload)return pre(artifact.contentRef,'Artifact.contentRef');
        let body=payload.content;
        if(payload.contentType.split(';')[0]==='application/json')try{body=JSON.parse(body);}catch{ /* Preserve original content on decode failure. */ }
        return pre(body,'Artifact.content.payload.content');
      }
      function artifactLinks(refs) {
        return refs.map(ref=>{
          const artifact=snapshot().artifacts.find(a=>a.id===ref.id);
          return artifact?`<button class="gm-related-artifact" data-dialog-artifact="${escape(artifact.id)}">${value(artifact.name,'Artifact.name')}<small>${value(artifact.id,'Artifact.id')}</small></button>`:pre(ref,'Step.inputs');
        }).join('');
      }
      function reviewPane(artifact) {
        const entries=snapshot().reviews.filter(r=>r.artifactId===artifact.id);
        return '<h3>评审</h3>'+(entries.length?entries.map(r=>'<article class="gm-dialog-review"><dl class="gm-dl">'+row('参与者',r.reviewer.actorId??r.reviewer.role,'Review.reviewer')+row('状态',reviewLabels[r.status]??r.status,'Review.status')+(r.vote?row('投票',voteLabels[r.vote.value]??r.vote.value,'Review.vote.value'):'')+'</dl>'+r.comments.map(c=>'<p>'+value(c.body,'Review.comments[].body')+'</p>').join('')+'</article>').join(''):'<div class="gm-dialog-empty">'+value('0 条评审','count(Review where artifactId = Artifact.id)')+'</div>');
      }
      function executionInfo(step) {
        if(!step)return '';
        const inputs=Object.entries(step.inputs??{});
        return '<details class="gm-execution-info"><summary>执行信息</summary><dl class="gm-dl">'+row('标识',step.id,'Step.id')+row('状态',stepLabels[step.status],'Step.status')+row('创建时间',step.createdAt,'Step.createdAt')+(step.startedAt?row('开始时间',step.startedAt,'Step.startedAt'):'')+(step.endedAt?row('结束时间',step.endedAt,'Step.endedAt'):'')+'</dl><h3>固定输入</h3>'+(inputs.length?inputs.map(([from,refs])=>'<section class="gm-input-group"><h4>来自 '+escape(displayRef(from))+'</h4>'+artifactLinks(refs)+'</section>').join(''):pre(step.inputs??{},'Step.inputs'))+'</details>';
      }
      function renderRunDialog(focusSelector) {
        const snap=snapshot();let title,metadata,left,right,secondLabel;
        const compact=['definition','edge','source','empty'].includes(dialogKind);
        if(compact){
          const a=action(),edge=edges().find(e=>e.id===state.edge);
          title=dialogKind==='edge'?(edge.kind==='collect'?'收集关系':'执行依赖'):a.description;
          metadata=dialogKind==='edge'?'':value(a.id,'Action.id');
          left=dialogKind==='edge'?edgeContent(edge).replace(/^<h3>.*?<\/h3>/,''):dialogKind==='source'?pre(a,'Procedure.actions[]'):(dialogKind==='empty'?'<div class="gm-dialog-empty">'+value('0 次执行','count(Step where source.actionId = '+a.id+')')+'</div>':'')+renderDefinition(a);
        }else if(dialogKind==='artifact'){
          const artifact=snap.artifacts.find(a=>a.id===dialogArtifactId);if(!artifact)return;
          const step=snap.steps.find(s=>s.id===artifact.stepId);
          const versions=artifactVersions(snap,artifact.stepId),index=versions.findIndex(a=>a.id===artifact.id);
          title=artifact.name;metadata=value(artifact.id,'Artifact.id')+pill(artifactLabels[artifact.status],'','Artifact.status');
          const adopted=snap.steps.find(s=>s.id===artifact.stepId)?.artifact;
          if(adopted?.mode==='produce'&&adopted.id===artifact.id)metadata+=pill('已采用','','Step.artifact.id = Artifact.id');
          left='<div class="gm-dialog-versionbar"><select id="gm-dialog-version" aria-label="产物版本">'+versions.map((a,i)=>`<option value="${escape(a.id)}" ${a.id===artifact.id?'selected':''}>v${i+1} · ${escape(a.name)}</option>`).join('')+`</select><button data-dialog-version="${escape(versions[index-1]?.id??'')}" data-version-action="older" ${index===0?'disabled':''}>上一版</button><button data-dialog-version="${escape(versions[index+1]?.id??'')}" data-version-action="newer" ${index===versions.length-1?'disabled':''}>下一版</button></div>`;
          if(artifact.revisedSummary)left+='<div class="gm-dialog-revision">'+value(artifact.revisedSummary,'Artifact.revisedSummary')+'</div>';
          left+=executionInfo(step);
          left+='<h3>产物内容</h3><article class="gm-dialog-document">'+artifactBody(artifact)+'</article>';
          right=reviewPane(artifact);secondLabel='评审';
        }else{
          const step=snap.steps.find(s=>s.id===dialogStepId);if(!step)return;
          const definition=procedure.actions.find(a=>a.id===step.source?.actionId);
          title=definition?.description??step.id;metadata=value(step.id,'Step.id')+pill(stepLabels[step.status],'','Step.status');
          left=executionInfo(step);
          if(step.artifact?.mode==='collect')left+='<h3>已收集成员</h3>'+Object.entries(step.artifact.items).map(([from,ids])=>'<h4>'+value(from,'Step.artifact.items key')+'</h4>'+artifactLinks(ids.map(id=>({kind:'artifact',id})))).join('');
          else left+='<h3>产物内容</h3><div class="gm-dialog-empty">'+value('0 份产物','count(Artifact where stepId = Step.id)')+'</div>';
          right='<h3>评审</h3><div class="gm-dialog-empty">'+value('0 条评审','count(Review for Artifact where stepId = Step.id)')+'</div>';secondLabel='评审';
        }
        if(!runDialog){
          runDialog=document.createElement('dialog');runDialog.className='gm-run-dialog';root.append(runDialog);
          runDialog.addEventListener('cancel',event=>{event.preventDefault();closeRunDialog();},{signal:controller.signal});
        }
        let stepPicker='';
        if(!compact){
          const step=snap.steps.find(s=>s.id===(dialogKind==='artifact'?snap.artifacts.find(a=>a.id===dialogArtifactId)?.stepId:dialogStepId));
          if(step){const group=actionSteps(snap,step.source.actionId);stepPicker='<label class="gm-dialog-step-picker">执行实例 <select id="gm-dialog-step" aria-label="执行实例">'+group.map((s,i)=>`<option value="${escape(s.id)}" ${s.id===step.id?'selected':''}>第 ${i+1} 次 · ${escape(stepLabels[s.status])} · ${escape(s.id)}</option>`).join('')+'</select></label>';}
        }
        runDialog.dataset.kind=dialogKind;runDialog.dataset.layout=compact?'compact':'wide';runDialog.dataset.pane=dialogPane;
        const label=dialogKind==='edge'?'边详情':compact?'节点详情':'运行详情';runDialog.setAttribute('aria-label',label);
        runDialog.innerHTML='<header class="gm-dialog-head"><div><div class="gm-eyebrow">'+label+'</div><h2>'+escape(title)+'</h2><div class="gm-dialog-metadata">'+metadata+'</div></div><div class="gm-dialog-head-actions"><button data-run-close>关闭</button></div></header>'+stepPicker+(!compact?'<div class="gm-dialog-mobile-tabs"><button data-dialog-pane="content" aria-pressed="'+(dialogPane==='content')+'">内容</button><button data-dialog-pane="review" aria-pressed="'+(dialogPane==='review')+'">'+secondLabel+'</button></div>':'')+'<div class="gm-dialog-columns"><section class="gm-dialog-pane gm-dialog-content" aria-label="内容">'+left+'</section>'+(!compact?'<section class="gm-dialog-pane gm-dialog-reviews" aria-label="'+secondLabel+'">'+right+'</section>':'')+'</div>';
        if(!runDialog.open)runDialog.showModal();
        const target=focusSelector?runDialog.querySelector(focusSelector):runDialog.querySelector('[data-run-close]');
        (target?.disabled?runDialog.querySelector('#gm-dialog-version'):target)?.focus();
      }
      function openStepDialog(id){
        dialogStepId=id;const step=snapshot().steps.find(s=>s.id===id),versions=artifactVersions(snapshot(),id);
        const artifactId=step?.artifact?.mode==='produce'?step.artifact.id:versions.at(-1)?.id;
        if(artifactId){openArtifactDialog(artifactId);return;}
        dialogKind='step';dialogPane='content';renderRunDialog();
      }
      function openArtifactDialog(id){dialogArtifactId=id;dialogKind='artifact';dialogPane='content';renderRunDialog();}
      function closeRunDialog(){
        restoringFocus=true;runDialog?.close();dialogKind=null;dialogStepId=null;
        state.edge=null;
        (opener?.isConnected?opener:q(`[data-node="${state.node}"]`))?.focus();
        restoringFocus=false;hideEdgePreview();
      }
      function render() {
        root.dataset.sources=String(state.sources);
        qa('[data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===state.view)));
        q('#gm-shared-panel').setAttribute('aria-labelledby',state.view==='run'?'gm-run-tab':'gm-definition-tab');
        q('#gm-meta').innerHTML=(state.view==='definition'?pill(procedure.mode,'','Procedure.mode')+value(`${procedure.actions.length} 个 Action`,'count(Procedure.actions)')+value(`${procedure.actions.filter(a=>a.collect).length} 个 collect`,'count(Action with collect)'):pill(runLabels[snapshot().run.status],'','Run.status')+value(snapshot().run.name,'Run.name')+'<select aria-label="示例记录" id="gm-scenario"><option value="fresh">初始样例</option><option value="review">评审样例</option><option value="done">完成样例</option></select>')+`<label class="gm-source-toggle"><input id="gm-sources" type="checkbox" ${state.sources?'checked':''}>字段来源</label>`;
        if(q('#gm-scenario'))q('#gm-scenario').value=state.scenario;
        q('#gm-bottomtext').textContent=state.view==='definition'?'Procedure':'Run / Step / Artifact / Review';
        renderNodes();renderEdges();
      }
      function modal(kind) {
        if(kind==='artifact'){openArtifactDialog(state.artifactId);return;}
        dialogKind='source';renderRunDialog();
      }
      function zoom(mode){const viewport=q('.gm-viewport');state.zoom=mode==='fit'?Math.min(1,viewport.clientWidth/746):Math.max(.5,Math.min(1.5,state.zoom+(mode==='in'?.1:-.1)));q('.gm-world').style.transform=`scale(${state.zoom})`;q('.gm-world').style.marginBottom=`${420*(state.zoom-1)}px`;q('#gm-scale').textContent=Math.round(state.zoom*100)+'%';}
      root.addEventListener('click',e=>{
        const edge=e.target.closest('[data-edge]');if(edge){selectEdge(edge.dataset.edge);return;}
        const b=e.target.closest('button');if(!b)return;
        if(b.dataset.view){state.view=b.dataset.view;render();}
        else if(b.dataset.node){
          opener=b;state.edge=null;state.node=b.dataset.node;hideEdgePreview();renderNodes();
          if(state.view==='definition'){dialogKind='definition';renderRunDialog();}
          else{const steps=actionSteps(snapshot(),state.node);if(steps.length){state.stepId=steps.at(-1).id;openStepDialog(state.stepId);}else{dialogKind='empty';renderRunDialog();}}
        }
        else if(b.dataset.stepId){opener=b;state.stepId=b.dataset.stepId;openStepDialog(state.stepId);}
        else if(b.dataset.artifactId){opener=b;state.artifactId=b.dataset.artifactId;dialogStepId=state.stepId;openArtifactDialog(state.artifactId);}
        else if(b.dataset.dialogArtifact){openArtifactDialog(b.dataset.dialogArtifact);}
        else if(b.dataset.dialogVersion){dialogArtifactId=b.dataset.dialogVersion;renderRunDialog(`[data-version-action="${b.dataset.versionAction}"]`);}
        else if(b.hasAttribute('data-run-close'))closeRunDialog();
        else if(b.dataset.dialogPane){dialogPane=b.dataset.dialogPane;runDialog.dataset.pane=dialogPane;runDialog.querySelectorAll('[data-dialog-pane]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.dialogPane===dialogPane)));}
        else if(b.dataset.zoom)zoom(b.dataset.zoom);
        else if(b.dataset.modal){opener=b;modal(b.dataset.modal);}
      },{signal:controller.signal});
      root.addEventListener('change',e=>{if(e.target.id==='gm-scenario'){state.scenario=e.target.value;render();}else if(e.target.id==='gm-sources'){state.sources=e.target.checked;root.dataset.sources=String(state.sources);}else if(e.target.id==='gm-dialog-version'){dialogArtifactId=e.target.value;renderRunDialog('#gm-dialog-version');}else if(e.target.id==='gm-dialog-step'){state.stepId=e.target.value;openStepDialog(state.stepId);}},{signal:controller.signal});
      root.addEventListener('keydown',e=>{
        if(e.target.matches('.gm-edge-hit')&&['Enter',' '].includes(e.key)){e.preventDefault();selectEdge(e.target.dataset.edge);}
        if(e.target.dataset.view&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();state.view=state.view==='run'?'definition':'run';render();q(`[data-view="${state.view}"]`).focus();}
      },{signal:controller.signal});
      render();requestAnimationFrame(()=>{if(!disposed)zoom('fit');});
      return ()=>{disposed=true;runDialog?.close();controller.abort();element.replaceChildren();};
    }}});
  }
});
