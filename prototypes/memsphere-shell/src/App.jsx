import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowsClockwise,
  Brain,
  CaretDown,
  CheckCircle,
  ClockCounterClockwise,
  Cube,
  DotsThree,
  FileText,
  Gear,
  House,
  MagnifyingGlass,
  PlayCircle,
  Plus,
  RocketLaunch,
  SlidersHorizontal,
  Sparkle,
  Storefront,
  X,
} from "@phosphor-icons/react";

const MODULES = [
  { id: "memory", label: "记忆", icon: Brain, color: "#28766e" },
  { id: "run", label: "运行", icon: PlayCircle, color: "#4d6fc2" },
  { id: "settings", label: "设置", icon: Gear, color: "#765a91" },
];

const PROJECTS = ["memsphere", "craa", "memorybase"];

const MODEL = {
  memory: {
    label: "记忆",
    secondary: [
      { id: "recent", label: "最近使用", icon: ClockCounterClockwise, count: 4 },
      { id: "project", label: "当前项目", icon: Brain, count: 11 },
      { id: "market", label: "记忆市场", icon: Storefront, count: 6 },
      { id: "changes", label: "变更集", icon: Archive, count: 3 },
    ],
    lists: {
      recent: [
        ["敏捷需求开发流程", "流程 · 2 分钟前", "把产品探索推进到可验收交付"],
        ["Memsphere View 架构", "命题 · 18 分钟前", "Module、Slot 与 ViewHost 的边界"],
        ["代码仓库开发规范", "命题 · 昨天", "提交、评审和持续集成约定"],
      ],
      project: [
        ["敏捷需求开发流程", "流程", "从需求澄清到交付验收的完整协作流程"],
        ["Agent 评测与协同修复流程", "流程", "由多个角色协同定位和修复问题"],
        ["Memsphere View 架构", "命题", "稳定 Shell 与可组合 Module"],
        ["代码仓库开发规范", "命题", "仓库内长期使用的开发约定"],
        ["测试工程规范", "命题", "单元、集成与浏览器测试基线"],
      ],
      market: [
        ["产品需求评审流程", "社区流程 · 1.2k 使用", "适合多人共同决策的评审流程"],
        ["研究工作台", "社区 Module · 836 使用", "整理资料、建立观点和生成报告"],
        ["发布检查清单", "社区命题 · 492 使用", "发布前的质量与风险检查"],
      ],
      changes: [
        ["View 整体界面与 Slot 重构", "待评审 · 8 分钟前", "新增稳定的四区页面结构"],
        ["二级导航 Slot 需求", "草稿 · 1 小时前", "统一 Memory、Run、Settings 的二级导航"],
        ["Artifact Review 交互修复", "已合入 · 昨天", "修复评审提交与浮窗交互"],
      ],
    },
  },
  run: {
    label: "运行",
    secondary: [
      { id: "running", label: "运行中", icon: PlayCircle, count: 2 },
      { id: "done", label: "已完成", icon: CheckCircle, count: 18 },
      { id: "abandoned", label: "已废弃", icon: Archive, count: 5 },
    ],
    lists: {
      running: [
        ["View 整体界面与 Slot 重构", "运行中 · 第 2 轮", "等待产品负责人确认交互原型"],
        ["二级导航 Slot 需求", "运行中 · 需求阶段", "正在形成技术方案"],
      ],
      done: [
        ["拆分内置 Builtin Modules", "已完成 · 8 月 30 日", "Memory、Run、Settings 已独立加载"],
        ["Artifact Review 交互修复", "已完成 · 8 月 31 日", "评审、评论和冲突恢复已通过验收"],
        ["ViewHost 组合运行时", "已完成 · 8 月 29 日", "多 Module 组合和故障隔离"],
      ],
      abandoned: [
        ["旧主页概念验证", "已废弃 · 8 月 28 日", "已被新的正式布局方向替代"],
        ["Legacy View 兼容层", "已废弃 · 8 月 30 日", "迁移完成后不再使用"],
      ],
    },
  },
  settings: {
    label: "设置",
    secondary: [
      { id: "overview", label: "设置概览", icon: House },
      { id: "general", label: "通用设置", icon: SlidersHorizontal },
      { id: "providers", label: "模型提供商", icon: Sparkle, count: 3 },
      { id: "participants", label: "参与者", icon: Cube, count: 4 },
    ],
    lists: {
      overview: [
        ["工作语言", "简体中文", "影响 View 的显示语言"],
        ["当前项目", "memsphere", "Project 级设置与数据边界"],
        ["服务状态", "运行正常", "View 与本地服务连接正常"],
      ],
      general: [
        ["界面语言", "简体中文", "可切换为 English"],
        ["界面密度", "舒适", "调整列表与内容区域的密度"],
        ["主题", "跟随系统", "自动跟随操作系统外观"],
      ],
      providers: [
        ["OpenAI", "已配置", "用于 Agent 推理和产物生成"],
        ["Anthropic", "未配置", "可添加 API 连接信息"],
        ["自定义 OpenAI 兼容服务", "1 个连接", "用于内网模型服务"],
      ],
      participants: [
        ["产品负责人", "Human", "负责需求决策与产品验收"],
        ["研发工程师", "Agent", "负责实现和工程验证"],
        ["测试工程师", "Agent", "负责测试设计和回归"],
        ["架构师", "Agent", "负责技术方案与边界审查"],
      ],
    },
  },
};

function IconButton({ label, children, active = false, onClick, className = "" }) {
  return (
    <button className={`icon-button ${active ? "active" : ""} ${className}`} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function PanelResizer({ label, value, min, max, onChange, onReset }) {
  const startDrag = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = value;
    document.body.classList.add("resizing-panels");

    const move = (moveEvent) => {
      onChange(Math.min(max, Math.max(min, startValue + moveEvent.clientX - startX)));
    };
    const end = () => {
      document.body.classList.remove("resizing-panels");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  const changeWithKeyboard = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onChange(Math.min(max, Math.max(min, value + (event.key === "ArrowRight" ? 12 : -12))));
  };

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={startDrag}
      onDoubleClick={onReset}
      onKeyDown={changeWithKeyboard}
    >
      <span />
    </div>
  );
}

function AppRail({ moduleId, onModule, project, onProject, onSearch }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="app-rail" aria-label="应用导航">
      <div className="project-control-wrap">
        <button className="project-control" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`切换 Project，当前 ${project}`}>
          <span className="project-mark"><Cube size={21} weight="fill" /></span>
          <span className="project-initial">{project.slice(0, 1).toUpperCase()}</span>
        </button>
        {open && (
          <div className="project-popover">
            <div className="popover-label">切换 Project</div>
            {PROJECTS.map((name) => (
              <button key={name} className={name === project ? "selected" : ""} onClick={() => { onProject(name); setOpen(false); }}>
                <span>{name.slice(0, 1).toUpperCase()}</span>{name}
                {name === project && <CheckCircle size={16} weight="fill" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <IconButton label="全局搜索" onClick={onSearch} className="search-trigger">
        <MagnifyingGlass size={22} />
      </IconButton>

      <div className="rail-divider" />
      <nav className="module-buttons">
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <button key={module.id} className={`module-button ${moduleId === module.id ? "active" : ""}`} onClick={() => onModule(module.id)}>
              <span className="module-icon" style={{ "--module-color": module.color }}><Icon size={24} weight={moduleId === module.id ? "fill" : "regular"} /></span>
              <span>{module.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="rail-spacer" />
      <IconButton label="新增 Module"><Plus size={21} /></IconButton>
      <div className="avatar">刘</div>
    </aside>
  );
}

function SecondaryNav({ moduleId, active, onSelect, width, onWidth, onResetWidth }) {
  const module = MODEL[moduleId];
  return (
    <aside className="secondary-nav">
      <header className="secondary-header">
        <div>
          <span className="eyebrow">MODULE</span>
          <h1>{module.label}</h1>
        </div>
        <IconButton label={`${module.label}设置`}><Gear size={18} /></IconButton>
      </header>
      <nav>
        {module.secondary.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onSelect(item.id)}>
              <Icon size={18} weight={active === item.id ? "fill" : "regular"} />
              <span>{item.label}</span>
              {item.count !== undefined && <small>{item.count}</small>}
            </button>
          );
        })}
      </nav>
      <div className="nav-note">
        <Sparkle size={17} weight="fill" />
        <p>这里由 <code>navigation.secondary</code> 统一呈现。</p>
      </div>
      <PanelResizer label="调整二级导航栏宽度" value={width} min={176} max={360} onChange={onWidth} onReset={onResetWidth} />
    </aside>
  );
}

function DataList({ moduleId, sectionId, selected, onSelect, width, onWidth, onResetWidth }) {
  const module = MODEL[moduleId];
  const section = module.secondary.find((item) => item.id === sectionId);
  const records = module.lists[sectionId] ?? [];
  return (
    <section className="data-list-panel">
      <header className="list-header">
        <div>
          <span className="eyebrow">{module.label}</span>
          <h2>{section?.label}</h2>
        </div>
        <IconButton label="刷新列表"><ArrowsClockwise size={18} /></IconButton>
      </header>
      <label className="local-search">
        <MagnifyingGlass size={17} />
        <input placeholder={`搜索${section?.label ?? ""}`} />
      </label>
      <div className="record-list">
        {records.map((record, index) => (
          <button key={record[0]} className={selected === index ? "active" : ""} onClick={() => onSelect(index)}>
            <span className="record-icon"><FileText size={19} /></span>
            <span className="record-copy">
              <strong>{record[0]}</strong>
              <small>{record[1]}</small>
              <p>{record[2]}</p>
            </span>
            <CaretDown className="record-caret" size={14} />
          </button>
        ))}
      </div>
      <footer>{records.length} 条结果 · fake data</footer>
      <PanelResizer label="调整内容列表栏宽度" value={width} min={260} max={520} onChange={onWidth} onReset={onResetWidth} />
    </section>
  );
}

function DetailPanel({ moduleId, sectionId, selected }) {
  const records = MODEL[moduleId].lists[sectionId] ?? [];
  const record = records[selected] ?? records[0];
  if (!record) return <main className="detail-panel empty">请选择一项查看详情</main>;

  const isRun = moduleId === "run";
  const isSettings = moduleId === "settings";
  return (
    <main className="detail-panel">
      <header className="detail-header">
        <div>
          <span className="eyebrow">{MODEL[moduleId].label} / {MODEL[moduleId].secondary.find((item) => item.id === sectionId)?.label}</span>
          <h2>{record[0]}</h2>
          <p>{record[1]}</p>
        </div>
        <div className="header-actions">
          {!isSettings && <button className="button secondary"><DotsThree size={18} />更多</button>}
          {isRun && <button className="button primary"><RocketLaunch size={18} weight="fill" />继续运行</button>}
          {moduleId === "memory" && <button className="button primary"><Plus size={18} />创建变更</button>}
          {isSettings && <button className="button primary">保存设置</button>}
        </div>
      </header>

      <div className="detail-scroll">
        <section className="hero-card">
          <div className="hero-icon">{isRun ? <PlayCircle size={28} weight="fill" /> : isSettings ? <Gear size={28} weight="fill" /> : <Brain size={28} weight="fill" />}</div>
          <div>
            <span className="status-pill">{isRun ? "运行正常" : isSettings ? "可配置" : "已生效"}</span>
            <h3>{record[0]}</h3>
            <p>{record[2]}</p>
          </div>
        </section>

        {isSettings ? (
          <section className="content-card form-card">
            <div><label>当前值</label><input defaultValue={record[1]} /></div>
            <div><label>作用范围</label><button className="select-like">Project · memsphere <CaretDown size={15} /></button></div>
            <p>设置修改仅作用于当前 Project。这个区域由 Settings Module 自己负责。</p>
          </section>
        ) : isRun ? (
          <>
            <section className="content-card">
              <div className="section-title"><h3>当前进度</h3><span>2 / 4</span></div>
              <div className="timeline">
                {["需求确认", "技术方案", "研发实现", "产品验收"].map((step, index) => (
                  <div key={step} className={index < 2 ? "done" : index === 2 ? "current" : ""}>
                    <span>{index + 1}</span><strong>{step}</strong><small>{index < 2 ? "已完成" : index === 2 ? "进行中" : "等待中"}</small>
                  </div>
                ))}
              </div>
            </section>
            <section className="content-card"><h3>最近活动</h3><p>产品负责人确认整体结构，建议补充全局搜索入口和统一二级导航。</p><small>10 分钟前 · Human</small></section>
          </>
        ) : (
          <>
            <section className="content-card">
              <div className="section-title"><h3>核心内容</h3><span>Markdown</span></div>
              <h4>目标</h4>
              <p>让 Agent 与用户在同一份项目知识之上协作，并通过稳定、清晰的界面完成查看、执行和调整。</p>
              <h4>规则</h4>
              <ul>
                <li>列表页只加载摘要，选中后再加载详情。</li>
                <li>每个 Module 独立贡献导航、列表、搜索与页面内容。</li>
                <li>Project 切换由 Core 统一管理，不暴露为 Slot。</li>
              </ul>
            </section>
            <section className="content-card meta-grid"><div><small>类型</small><strong>{record[1]}</strong></div><div><small>更新时间</small><strong>今天 14:32</strong></div><div><small>引用</small><strong>7 个</strong></div></section>
          </>
        )}
      </div>
    </main>
  );
}

function SearchOverlay({ onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("全部");
  const inputRef = useRef(null);
  const results = useMemo(() => {
    const all = [
      { provider: "记忆", module: "memory", section: "project", title: "Memsphere View 架构", meta: "命题 · 当前项目", text: "稳定 Shell、Slot 与 Module 组合边界" },
      { provider: "记忆", module: "memory", section: "project", title: "敏捷需求开发流程", meta: "流程 · 当前项目", text: "从需求探索到交付验收" },
      { provider: "运行", module: "run", section: "running", title: "View 整体界面与 Slot 重构", meta: "Run · 运行中", text: "等待产品负责人确认交互原型" },
      { provider: "运行", module: "run", section: "done", title: "拆分内置 Builtin Modules", meta: "Run · 已完成", text: "Memory、Run、Settings 独立加载" },
      { provider: "设置", module: "settings", section: "providers", title: "OpenAI", meta: "模型提供商 · 已配置", text: "Agent 推理和产物生成" },
    ];
    return all.filter((item) => (provider === "全部" || item.provider === provider) && (!query || `${item.title}${item.text}${item.meta}`.toLowerCase().includes(query.toLowerCase())));
  }, [provider, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="全局搜索">
      <div className="search-command">
        <MagnifyingGlass size={24} />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记忆、运行和设置" />
        <kbd>ESC</kbd>
        <button onClick={onClose} aria-label="关闭搜索"><X size={23} /></button>
      </div>
      <div className="provider-row">
        {['全部', '记忆', '运行', '设置'].map((name) => <button key={name} className={provider === name ? "active" : ""} onClick={() => setProvider(name)}>{name}</button>)}
        <span><SlidersHorizontal size={17} />筛选</span>
      </div>
      <div className="search-body">
        {query ? (
          <div className="search-results">
            <div className="result-summary">找到 {results.length} 个结果</div>
            {results.map((item) => (
              <button key={`${item.provider}-${item.title}`} onClick={() => onNavigate(item)}>
                <span className={`result-type ${item.module}`}>{item.provider}</span>
                <span><strong>{item.title}</strong><small>{item.meta}</small><p>{item.text}</p></span>
                <span className="open-hint">打开</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="search-empty">
            <div className="search-orbit"><MagnifyingGlass size={34} /><Sparkle size={18} weight="fill" /></div>
            <h2>跨 Module 搜索</h2>
            <p>输入关键词，搜索当前 Project 中的记忆、运行和设置。</p>
            <div className="search-tips"><span>试试搜索</span><button onClick={() => setQuery("View")}>View 架构</button><button onClick={() => setQuery("评审")}>评审</button></div>
          </div>
        )}
      </div>
      <footer className="search-footer"><span>↑↓ 移动</span><span>↵ 打开</span><span>esc 退出搜索</span></footer>
    </div>
  );
}

export function App() {
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("memsphere.prototype.panel-widths") ?? "null");
      return {
        secondary: Math.min(360, Math.max(176, Number(saved?.secondary) || 218)),
        list: Math.min(520, Math.max(260, Number(saved?.list) || 326)),
      };
    } catch {
      return { secondary: 218, list: 326 };
    }
  });
  const [project, setProject] = useState("memsphere");
  const [moduleId, setModuleId] = useState("memory");
  const [sectionByModule, setSectionByModule] = useState({ memory: "project", run: "running", settings: "overview" });
  const [selectedByView, setSelectedByView] = useState({});
  const [searchOpen, setSearchOpen] = useState(false);
  const sectionId = sectionByModule[moduleId];
  const viewKey = `${moduleId}:${sectionId}`;
  const selected = selectedByView[viewKey] ?? 0;

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    localStorage.setItem("memsphere.prototype.panel-widths", JSON.stringify(panelWidths));
  }, [panelWidths]);

  const changeModule = (nextModule) => setModuleId(nextModule);
  const changeSection = (nextSection) => setSectionByModule((current) => ({ ...current, [moduleId]: nextSection }));
  const navigateFromSearch = (item) => {
    setModuleId(item.module);
    setSectionByModule((current) => ({ ...current, [item.module]: item.section }));
    const index = MODEL[item.module].lists[item.section].findIndex((record) => record[0] === item.title);
    setSelectedByView((current) => ({ ...current, [`${item.module}:${item.section}`]: Math.max(index, 0) }));
    setSearchOpen(false);
  };

  return (
    <div className="prototype-shell" style={{ "--secondary-width": `${panelWidths.secondary}px`, "--list-width": `${panelWidths.list}px` }}>
      <AppRail moduleId={moduleId} onModule={changeModule} project={project} onProject={setProject} onSearch={() => setSearchOpen(true)} />
      <SecondaryNav
        moduleId={moduleId}
        active={sectionId}
        onSelect={changeSection}
        width={panelWidths.secondary}
        onWidth={(secondary) => setPanelWidths((current) => ({ ...current, secondary }))}
        onResetWidth={() => setPanelWidths((current) => ({ ...current, secondary: 218 }))}
      />
      <DataList
        moduleId={moduleId}
        sectionId={sectionId}
        selected={selected}
        onSelect={(index) => setSelectedByView((current) => ({ ...current, [viewKey]: index }))}
        width={panelWidths.list}
        onWidth={(list) => setPanelWidths((current) => ({ ...current, list }))}
        onResetWidth={() => setPanelWidths((current) => ({ ...current, list: 326 }))}
      />
      <DetailPanel moduleId={moduleId} sectionId={sectionId} selected={selected} />
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onNavigate={navigateFromSearch} />}
    </div>
  );
}
