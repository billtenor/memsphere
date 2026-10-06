const [projectModels, importedDemo] = await Promise.all(['./models.json', './imported-models-demo.json'].map(path => fetch(path).then(response => response.json())));
const models = [...projectModels, ...importedDemo];
// Grouping is derived from model records; there is no separate package model.
// origin belongs to preview context, outside ModelRegistration.
const packageGroups = [...new Set(models.map(model => model.registration.package).filter(Boolean))].map(id => {
 const members = models.filter(model => model.registration.package === id);
 return { id, name: members.find(model => model.registration.package_name)?.registration.package_name || id,
  origin: members[0].origin, prototypeOnly: members.every(model => model.prototypeOnly) };
});
const groupById = new Map(packageGroups.map(group => [group.id, group]));
const packages = Object.fromEntries(packageGroups.map(group => [group.id, group.name]));
const market = [
 { name: '交易与订单', package: 'acme.commerce', description: '订单、商品与支付的常用结构，让业务模型从一个包开始。', tags: ['order', 'payment'], models: ['订单', '商品', '支付记录'], version: '1.0.0', icon: '▱' },
 { name: '项目与协作', package: 'acme.workspace', description: '项目、任务与成员模型，适合组织团队协作中的业务数据。', tags: ['project', 'task'], models: ['项目', '任务', '成员'], version: '0.3.0', icon: '◇' },
 { name: '指标与事件', package: 'acme.analytics', description: '统一事件、指标和观察记录，为分析与监测建立基础。', tags: ['event', 'metrics'], models: ['事件', '指标', '观察记录'], version: '0.2.0', icon: '⌁' }
];
const query = new URLSearchParams(location.search);
let scope = query.get('scope') || 'custom';
if (scope === 'custom' && packageGroups.some(record => record.origin === 'project' && record.id === query.get('package'))) scope = query.get('package');
if (!['custom', 'market', ...packageGroups.map(record => record.id)].includes(scope)) scope = 'custom';
let tag = query.get('tag') || '';
let search = '';
let selected = query.get('model') || 'examples/02-nested-order.json';
let tab = 'information';
let expanded = new Set();
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const scoped = () => models.filter(({ registration: r }) => scope === 'custom' ? !r.package : r.package === scope);
const visible = () => scoped().filter(({ registration: r }) => (!tag || r.tags.includes(tag)) && `${r.name} ${r.modelRef} ${r.description} ${r.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
const scopeName = () => scope === 'custom' ? '未定义包' : scope === 'market' ? '模型市场' : packages[scope] || scope;
function syncURL() {
 const params = new URLSearchParams({ scope });
 if (tag) params.set('tag', tag);
 if (selected && scope !== 'market') params.set('model', selected);
 history.replaceState(null, '', `${location.pathname}?${params}`);
}
function navItem(id, name, icon, count) {
 return `<button class="nav-item ${scope === id ? 'selected' : ''}" data-scope="${escape(id)}" ${scope === id ? 'aria-current="page"' : ''}><span class="nav-icon">${icon}</span><span class="nav-name">${escape(name)}</span>${count === undefined ? '' : `<span class="nav-count">${count}</span>`}</button>`;
}
function navigation() {
 const packageNames = packageGroups.filter(record => record.origin !== 'project' && models.some(model => model.registration.package === record.id)).map(record => record.id);
 const projectPackages = packageGroups.filter(record => record.origin === 'project' && models.some(model => model.registration.package === record.id));
 $('navigation').innerHTML = '<div class="nav-label">本项目</div>' + navItem('custom', '未定义包', '◇', models.filter(model => !model.registration.package).length)
  + projectPackages.map(record => navItem(record.id, record.name, '⬡', models.filter(model => model.registration.package === record.id).length)).join('')
  + '<div class="nav-label">已导入的包</div>' + packageNames.map(name => navItem(name, packages[name] || name, '⬡', models.filter(model=>model.registration.package === name).length)).join('')
  + `<div class="market-nav">${navItem('market', '模型市场', '⊞')}</div>`;
}
function render() {
 navigation();
 $('workspace').classList.toggle('market', scope === 'market');
 $('page-title').textContent = scope === 'market' ? '模型市场' : '模型';
 $('page-subtitle').textContent = scope === 'market' ? '发现模型包' : 'memsphere';
 if (scope === 'market') { renderMarket(); syncURL(); return; }
 const availableTags = [...new Set(scoped().flatMap(model => model.registration.tags))].sort();
 if (tag && !availableTags.includes(tag)) tag = '';
 $('tag').innerHTML = '<option value="">全部标签</option>' + availableTags.map(value=>`<option value="${escape(value)}">${escape(value)} · ${scoped().filter(model=>model.registration.tags.includes(value)).length}</option>`).join('');
 $('tag').value = tag;
 $('search').value = search;
 $('scope-title').textContent = scopeName();
 $('scope-count').textContent = scoped().length;
 const items = visible();
 if (!items.some(model => model.registration.modelRef === selected)) { selected = items[0]?.registration.modelRef; tab = 'information'; expanded = new Set(); }
 $('list-footer').textContent = `显示 ${items.length} / ${scoped().length} 个模型${groupById.get(scope)?.prototypeOnly ? ' · 市场导入演示' : ''}`;
 $('model-list').innerHTML = items.length ? items.map(({ registration:r, status })=>`<button class="model-item ${selected === r.modelRef ? 'selected' : ''}" data-model="${escape(r.modelRef)}" ${selected === r.modelRef ? 'aria-current="true"' : ''}><h3>${escape(r.name)}${status === 'unavailable' ? ' · 不可用' : ''}</h3><div class="model-id">${escape(r.modelRef)}</div><p class="model-summary">${escape(r.description)}</p>${r.tags?.length ? `<div class="badges">${r.tags.slice(0,2).map(tag=>`<span class="badge">${escape(tag)}</span>`).join('')}${r.tags.length > 2 ? `<span class="badge neutral" title="${escape(r.tags.slice(2).join(', '))}" aria-label="另有 ${r.tags.length - 2} 个标签">+${r.tags.length - 2}</span>` : ''}</div>` : ''}</button>`).join('') : '<div class="empty">没有匹配的模型<br>试试其他标签或搜索词</div>';
 renderDetail(); syncURL();
}
function renderDetail() {
 const model = models.find(model => model.registration.modelRef === selected);
 if (!model) { $('content').innerHTML = '<div class="empty">当前筛选下没有模型</div>'; return; }
 const r = model.registration;
 if (model.status === 'unavailable') { $('content').innerHTML = `<article class="detail-inner"><h2 class="detail-heading">${escape(r.name)}</h2><p role="alert">${escape(model.error)}</p></article>`; return; }
 $('content').innerHTML = `<article class="detail-inner"><div class="breadcrumb">${escape(model.origin !== 'project' ? '已导入的包' : '本项目')}<span>/</span>${escape(scopeName())}</div><h2 class="detail-heading">${escape(r.name)}</h2><p class="detail-description">${escape(r.description)}</p><div class="detail-badges"><span class="badge ${r.package ? 'blue' : 'neutral'}">${escape(r.package ? r.package_name || r.package : '本项目 · 未定义包')}</span>${model.prototypeOnly ? '<span class="badge neutral">导入演示</span>' : ''}${r.tags.map(tag=>`<span class="badge neutral">${escape(tag)}</span>`).join('')}</div><div class="tab-bar" role="tablist" aria-label="模型详情">${[['information','模型信息'],['structure','模型结构'],['source','原始定义']].map(([id,name])=>`<button class="tab ${tab===id?'selected':''}" role="tab" aria-selected="${tab===id}" data-tab="${id}">${name}</button>`).join('')}</div><div id="tab-content" role="tabpanel"></div></article>`;
 const panel = $('tab-content');
 if (tab === 'source') panel.innerHTML = `<pre class="code">${escape(model.source)}</pre>`;
 else if (tab === 'information') panel.innerHTML = modelInformation(model);
 else if (model.metaModel === 'raw.json') panel.innerHTML = '<div class="raw-card"><span style="font-size:28px">▱</span><h3>原始内容模型</h3><p>内容作为完整字节值管理，不声明成员字段。</p></div>';
 else panel.innerHTML = `<div class="section-tools"><span>字段与约束</span><div><button class="text-button" id="expand-all">全部展开</button> <button class="text-button" id="collapse-all">全部收起</button></div></div><div class="table-wrap"><table><thead><tr><th>字段 / 结构</th><th>类型</th><th>规则</th><th>说明</th></tr></thead><tbody>${schemaRows(model.schema)}</tbody></table></div>`;
}
function modelInformation(model) {
 const r = model.registration;
 const mono = value => `<span class="mono">${escape(value)}</span>`;
 const rows = [
  ['名称', escape(r.name)],
  ['说明', escape(r.description || '—')],
  ['所属包', r.package ? `${r.package_name ? `${escape(r.package_name)} <span class="muted mono">${escape(r.package)}</span>` : mono(r.package)}` : '<span class="muted">未定义包</span>'],
  ['模型 ID', mono(r.modelRef)],
  ['定义标准', mono(model.metaModel)],
  ['标签', r.tags.length ? `<div class="badges">${r.tags.map(tag=>`<span class="badge neutral">${escape(tag)}</span>`).join('')}</div>` : '<span class="muted">—</span>'],
  ['存储方式', escape(r.storage === 'builtin' ? '代码内置' : '持久化存储')],
  ['存储 ID', r.store_id ? mono(r.store_id) : '<span class="muted">—</span>']
 ];
 const table = values => `<div class="table-wrap information-table"><table><thead><tr><th>属性</th><th>内容</th></tr></thead><tbody>${values.map(([label,value])=>`<tr><th scope="row">${escape(label)}</th><td>${value}</td></tr>`).join('')}</tbody></table></div>`;
 return `<div class="section-tools"><span>基本信息</span></div>${table(rows)}`;
}
function schemaRows(root) {
 const resolve = schema => {
  if (!schema?.$ref?.startsWith('#/')) return schema;
  const target = schema.$ref.slice(2).split('/').reduce((value,key)=>value?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],root);
  return target ? { ...target, ...schema } : schema;
 };
 const rows = [];
 function walk(input, name, path, depth, required = false, ancestry = new Set()) {
  const schema = resolve(input) || {};
  const cycle = ancestry.has(schema.$ref);
  const nextAncestry = new Set(ancestry);
  if (schema.$ref) nextAncestry.add(schema.$ref);
  const branches = schema.oneOf || schema.anyOf || schema.allOf;
  const children = Object.entries(schema.properties || {});
  const hasChildren = !cycle && (children.length || schema.items || branches || (typeof schema.additionalProperties === 'object'));
  const type = schema.enum ? `${({string:'文本',integer:'整数',number:'数字'}[schema.type] || schema.type || '值')}枚举` : schema.const !== undefined ? '固定值' : branches ? '联合结构' : ({object:'对象',array:'数组',string:'文本',integer:'整数',number:'数字',boolean:'布尔',null:'空值'}[schema.type] || (schema === false ? '不允许' : '—'));
  const rules = [required && '必填', schema.const !== undefined && `固定值: ${JSON.stringify(schema.const)}`, schema.enum && `可选值: ${schema.enum.join(', ')}`, schema.minimum !== undefined && `最小值: ${schema.minimum}`, schema.maximum !== undefined && `最大值: ${schema.maximum}`, schema.minLength !== undefined && `最短 ${schema.minLength} 字符`, schema.uniqueItems && '元素不重复', schema.$ref && `引用: ${schema.$ref}`].filter(Boolean).join(' · ') || '—';
  rows.push(`<tr class="${name.startsWith('[')?'tree-branch':''}"><td style="padding-left:${12+depth*17}px">${hasChildren ? `<button class="tree-button" data-expand="${escape(path)}" aria-label="${expanded.has(path)?'收起':'展开'} ${escape(name)}" aria-expanded="${expanded.has(path)}">${expanded.has(path)?'⊟':'⊞'}</button>` : '<span style="display:inline-block;width:17px"></span>'}${escape(name)}</td><td><span class="badge">${escape(type)}</span></td><td>${escape(rules)}</td><td>${escape(schema.description || schema.title || '—')}</td></tr>`);
  if (!hasChildren || !expanded.has(path)) return;
  for (const [key,value] of children) walk(value,key,`${path}/${key}`,depth+1,(schema.required || []).includes(key),nextAncestry);
  if (schema.items) walk(schema.items,'[元素结构]',`${path}/items`,depth+1,false,nextAncestry);
  if (typeof schema.additionalProperties === 'object') walk(schema.additionalProperties,'[动态字段]',`${path}/additionalProperties`,depth+1,false,nextAncestry);
  branches?.forEach((branch,index)=>walk(branch,`[${branch.title || `候选 ${index+1}`}]`,`${path}/branch-${index}`,depth+1,false,nextAncestry));
 }
 const entries = Object.entries(root.properties || {});
 if (entries.length) for (const [name,schema] of entries) walk(schema,name,name,0,(root.required || []).includes(name));
 else walk(root,'[模型整体]','root',0);
 return rows.join('');
}
function expandAll() {
 const model = models.find(model=>model.registration.modelRef === selected);
 function visit(schema,path,seen = new Set()) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref?.startsWith('#/')) {
   if (seen.has(schema.$ref)) return;
   seen = new Set([...seen,schema.$ref]);
   schema = { ...schema.$ref.slice(2).split('/').reduce((value,key)=>value?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],model.schema), ...schema };
  }
  expanded.add(path);
  for (const [key,value] of Object.entries(schema.properties || {})) visit(value,`${path}/${key}`,seen);
  if (schema.items) visit(schema.items,`${path}/items`,seen);
  if (typeof schema.additionalProperties === 'object') visit(schema.additionalProperties,`${path}/additionalProperties`,seen);
  (schema.oneOf || schema.anyOf || schema.allOf)?.forEach((branch,index)=>visit(branch,`${path}/branch-${index}`,seen));
 }
 for (const [key,value] of Object.entries(model.schema.properties || {})) visit(value,key);
 if (!Object.keys(model.schema.properties || {}).length) visit(model.schema,'root');
 renderDetail();
}
function renderMarket() {
 $('content').innerHTML = `<div class="detail-inner"><div class="market-heading"><h2>找到适合你的模型</h2><span class="badge neutral">模型包</span></div><p class="market-subtitle">按包发现模型，安装后在项目中统一管理。</p><div class="market-notice">市场展示示例 · 以下包为原型演示数据，预览和安装不会改变项目。</div><div class="market-grid">${market.map((item,index)=>`<article class="market-card"><div class="package-icon">${item.icon}</div><h3>${escape(item.name)}</h3><div class="package-id">${escape(item.package)}</div><p>${escape(item.description)}</p><div class="badges"><span class="badge">${escape(item.tags.join(' · '))}</span><span class="badge neutral">${item.models.length} 个模型</span></div><footer><span>v${item.version}</span><button class="button" data-market-preview="${index}">预览</button><button class="button primary" data-install="${index}">安装</button></footer></article>`).join('')}</div></div>`;
}
let toastTimer;
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
$('navigation').addEventListener('click',event=>{
 const target=event.target.closest('[data-scope]'); if(!target)return;
 scope=target.dataset.scope; tag=''; search=''; tab='information'; expanded=new Set(); render();
});
$('search').addEventListener('input',event=>{ search=event.target.value; const start=event.target.selectionStart; render(); $('search').focus(); $('search').setSelectionRange(start,start); });
$('tag').addEventListener('change',event=>{tag=event.target.value;render();});
$('model-list').addEventListener('click',event=>{const target=event.target.closest('[data-model]');if(!target)return;selected=target.dataset.model;tab='information';expanded=new Set();render();});
$('content').addEventListener('click',event=>{
 const target=event.target.closest('button');if(!target)return;
 if(target.dataset.tab){tab=target.dataset.tab;renderDetail();}
 if(target.dataset.expand){const path=target.dataset.expand;expanded.has(path)?expanded.delete(path):expanded.add(path);renderDetail();}
 if(target.id==='expand-all')expandAll();
 if(target.id==='collapse-all'){expanded=new Set();renderDetail();}
 if(target.dataset.install!==undefined)toast('安装演示：正式接入后，将创建模型定义和登记记录。当前项目未改变。');
 if(target.dataset.marketPreview!==undefined){const item=market[Number(target.dataset.marketPreview)];$('dialog-content').innerHTML=`<span class="badge neutral">演示模型包</span><h2>${escape(item.name)}</h2><p class="mono">${escape(item.package)} · v${item.version}</p><p>${escape(item.description)}</p><ul>${item.models.map(name=>`<li>${escape(name)} <span class="muted">· JSON Schema</span></li>`).join('')}</ul>`;$('market-preview').showModal();}
});
$('close-dialog').onclick=()=>$('market-preview').close();
$('reset').onclick=()=>{scope='custom';tag='';search='';selected='examples/01-basic-types.json';tab='information';expanded=new Set();render();toast('已重置预览');};
for(const button of document.querySelectorAll('.rail button:not(#open-settings)'))button.onclick=()=>toast('当前原型聚焦模型模块');
const previewStoreConfigs = {
 'memsphere/model-registrations': { type: 'filesystem', directory: 'models/registrations' },
 'project/model-registrations': { type: 'filesystem', directory: 'data/model-registrations' }
};
let savedRegistrationStore = 'memsphere/model-registrations';
let storeDrafts;
let editingStore;
function showStoreConfiguration() {
 editingStore = $('registration-store').value;
 const config = storeDrafts[editingStore];
 $('store-type').value = config.type;
 $('store-directory').value = config.directory;
 $('store-directory').setCustomValidity('');
 $('store-config-badge').textContent = editingStore === 'memsphere/model-registrations' ? '默认' : '演示';
}
$('open-settings').onclick=()=>{
 storeDrafts = Object.fromEntries(Object.entries(previewStoreConfigs).map(([id,config])=>[id,{...config}]));
 $('registration-store').value = savedRegistrationStore;
 showStoreConfiguration();
 $('storage-settings').showModal();
};
$('registration-store').onchange=()=>showStoreConfiguration();
$('store-directory').oninput=()=>{storeDrafts[editingStore].directory=$('store-directory').value;$('store-directory').setCustomValidity('');};
$('store-type').onchange=()=>{storeDrafts[editingStore].type=$('store-type').value;};
$('close-settings').onclick=()=>$('storage-settings').close();
$('save-settings').onclick=()=>{
 const directory=$('store-directory');
 if(!directory.value.trim()){directory.setCustomValidity('请填写存储目录');directory.reportValidity();return;}
 for(const [id,config] of Object.entries(storeDrafts)) {
  if(!config.directory.trim()){ $('registration-store').value=id;showStoreConfiguration();directory.setCustomValidity('请填写存储目录');directory.reportValidity();return; }
 }
 Object.assign(previewStoreConfigs,storeDrafts);
 savedRegistrationStore=$('registration-store').value;
 $('storage-settings').close();
 toast('保存演示：已更新所选存储及详细配置，实际项目未改变。');
};
render();
