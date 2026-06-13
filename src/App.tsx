import React, { useState, useEffect } from 'react';
import { CenterLayout } from './components/CenterLayout';
import { Card } from './components/Card';
import { Typography } from './components/Typography';
import { FlowchartCanvas } from './components/FlowchartCanvas';
import { NodeDrawer } from './components/NodeDrawer';
import { MermaidEditor } from './components/MermaidEditor';
import { DARAQ_NODES, generateMermaidCode } from './data/architectureData';
import { ArchitectureNode, ThemeMode } from './types';
import { 
  Sun, 
  Moon, 
  Settings, 
  Layers, 
  Code2, 
  Bot, 
  Info,
  RotateCcw, 
  FileJson, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Cpu,
  Tv,
  Check
} from 'lucide-react';

export default function App() {
  // Theme state
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('daraq-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    // Fallback to dark theme by default (matching premium dashboard styling)
    return 'dark';
  });

  // Master nodes state (allows interactive editing across views!)
  const [nodes, setNodes] = useState<ArchitectureNode[]>(() => {
    const saved = localStorage.getItem('daraq-nodes-config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clean stale Gemini 3.1 Pro model cache to propagate user specifications instantly
        const hasStaleModel = parsed.some((n: any) => n.id === 'step6' && n.subtitle && n.subtitle.includes('Gemini 3.1 Pro'));
        if (hasStaleModel) {
          localStorage.removeItem('daraq-nodes-config');
          return DARAQ_NODES;
        }
        return parsed;
      } catch (e) {
        console.error('Failed to parse cached nodes:', e);
      }
    }
    return DARAQ_NODES;
  });

  // Selection states
  const [selectedNode, setSelectedNode] = useState<ArchitectureNode | null>(null);
  const [activeTab, setActiveTab] = useState<'diagram' | 'code'>('diagram');
  const [activePage, setActivePage] = useState<'architecture' | 'bot_status'>('architecture');
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

  // Save config changes to cache
  useEffect(() => {
    localStorage.setItem('daraq-nodes-config', JSON.stringify(nodes));
  }, [nodes]);

  // Persist theme choice
  useEffect(() => {
    localStorage.setItem('daraq-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Handle restoring architecture blocks to original 2026 specs
  const handleResetSpecs = () => {
    if (window.confirm('Барлық блок сипаттамалары мен өнімділік өлшемдерін бастапқы 2026 нұсқамасына қалпына келтіргіңіз келе ме?')) {
      setNodes(DARAQ_NODES);
      setSelectedNode(null);
      triggerToast('Агент архитектурасы бастапқы күйге келтірілді!');
    }
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // Download nodes schema as JSON
  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(nodes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daraq-pipeline-architecture-2026.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast('JSON Схемасы жүктелді!');
    setExportMenuOpen(false);
  };

  // Download raw Mermaid.js schema
  const handleDownloadMermaid = () => {
    const code = generateMermaidCode(nodes);
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daraq-architecture-2026.mmd';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast('Mermaid.js файлы жүктелді!');
    setExportMenuOpen(false);
  };

  return (
    <div className={`min-h-screen font-sans antialiased transition-colors duration-300 ${
      theme === 'dark' ? 'bg-slate-950 text-slate-100 dark' : 'bg-slate-50 text-slate-900'
    }`}>
      
      {/* 1. TOP BRAND NAVIGATION HEADER CONTAINER */}
      <header className="sticky top-0 z-40 w-full bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo & Platform label */}
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-purple-600 dark:bg-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Bot className="w-5 h-5 text-white animate-pulse" />
            </span>
            <div>
              <span className="font-display font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                Daraq
              </span>
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase font-mono bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200/40">
                RAG Engine
              </span>
            </div>
          </div>

          {/* Primary View switching tabs */}
          <nav className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800">
            <button
              onClick={() => setActivePage('architecture')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                activePage === 'architecture'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Архитектуралық панель
            </button>
            <button
              onClick={() => setActivePage('bot_status')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                activePage === 'bot_status'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              Бот Статусы
            </button>
          </nav>

          {/* System Control Settings / Dark Mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-505 dark:text-slate-300 cursor-pointer transition-colors"
              title={theme === 'dark' ? 'Жарық режимге өту' : 'Қараңғы режимге өту'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-purple-600" />}
            </button>
          </div>
        </div>
      </header>

      {/* TOAST SYSTEM POPUP */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl shadow-xl border border-slate-800 dark:border-slate-200 animate-fade-in">
          <Check className="w-4 h-4 text-green-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 2. CHOOSE CURRENT PAGE VIEW */}
      {activePage === 'bot_status' ? (
        /* ================= ORIGINAL BOT STATUS PAGE (KEPT 100% INTACT) ================= */
        <CenterLayout>
          <Card>
            <Typography variant="h1">Daraq AI Assistant</Typography>
            <Typography variant="body">
              Бұл қосымша Telegram бот ретінде жұмыс істейді. Сервер іске қосылды.
            </Typography>
            <Typography variant="caption">
              Толығырақ конфигурацияны жүйелік логтардан көре аласыз.
            </Typography>
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setActivePage('architecture')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl shadow-md cursor-pointer transition-colors"
              >
                Агент архитектуралық панеліне өту
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </Card>
        </CenterLayout>
      ) : (
        /* ================= NEW EXTREMELY BEAUTIFUL INTERACTIVE REVOLUTIONARY DASHBOARD ================= */
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in space-y-8">
          
          {/* Dashboard Head / Title */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/60 dark:border-slate-800/80 pb-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 font-mono">
                <Settings className="w-3.5 h-3.5 animate-spin-slow" />
                <span>ӨНДІРІСТІК-ДЕҢГЕЙДЕГІ RAG ОРТАЛЫҒЫ</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white font-display">
                Daraq Когнитивті Архитектуралық Панелі
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                2026 жылғы толық көпқабатты RAG пен Agentic пайымдау ағымының интерактивті схемасы
              </p>
            </div>

            {/* Global Actions Block bar */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleResetSpecs}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-colors border border-slate-200/40 dark:border-slate-800/30"
              >
                <RotateCcw className="w-4 h-4" />
                Қалпына келтіру
              </button>
              
              {/* Export dropdown switcher */}
              <div className="relative">
                <button
                  onClick={() => setExportMenuOpen(prev => !prev)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-purple-600/15"
                >
                  Экспорттау
                  <ChevronRight className="w-3.5 h-3.5 transform rotate-90" />
                </button>
                {exportMenuOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setExportMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden text-xs">
                      <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/60 font-semibold text-slate-500 dark:text-slate-400">
                        Схеманы жүктеу нұсқалары
                      </div>
                      <button
                        onClick={handleDownloadJSON}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <FileJson className="w-4 h-4 text-purple-500" />
                        JSON Схемасы (.json)
                      </button>
                      <button
                        onClick={handleDownloadMermaid}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <Code2 className="w-4 h-4 text-purple-500" />
                        Mermaid Script (.mmd)
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Inline informational details banner */}
          <div className="p-4 bg-purple-50/60 dark:bg-purple-950/10 border border-purple-100/50 dark:border-purple-900/40 rounded-2xl flex gap-3.5 text-xs text-slate-600 dark:text-slate-300">
            <Info className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                Қазақша Платформалық Интерактивті Нұсқаулық:
              </p>
              <p className="leading-relaxed">
                Төмендегі диаграмма блогында әрбір кезеңнің нақты жұмыс істеу логикасы көрсетілген. Қадамды білу үшін оның үстіне басыңыз — оң жақтан толық мәліметтер суырылып шығады. <strong>"Код"</strong> қосымшасында Mermaid.js тегтері мен дереккөзді динамикалық баптауға мүмкіндік бар.
              </p>
            </div>
          </div>

          {/* 3. MULTI-TAB ARCHITECTURE RENDERER */}
          <div className="space-y-4">
            {/* Tab switch bar */}
            <div className="flex border-b border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveTab('diagram')}
                className={`py-3 px-6 text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'diagram'
                    ? 'border-purple-600 dark:border-purple-400 text-purple-600 dark:text-purple-400 font-extrabold'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350 hover:border-slate-300'
                }`}
              >
                <Layers className="w-4 h-4" />
                Диаграмма
              </button>
              <button
                onClick={() => setActiveTab('code')}
                className={`py-3 px-6 text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'code'
                    ? 'border-purple-600 dark:border-purple-400 text-purple-600 dark:text-purple-400 font-extrabold'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350 hover:border-slate-300'
                }`}
              >
                <Code2 className="w-4 h-4" />
                Код (Mermaid.js / JSON)
              </button>
            </div>

            {/* Tab Content Display */}
            <div className="relative">
              {activeTab === 'diagram' ? (
                /* TAB 1: DIAGRAM FLOWCHART */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Daraq қадамдық шешім ағыны
                    </h3>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      Белсенді схема
                    </div>
                  </div>
                  
                  <FlowchartCanvas
                    nodes={nodes}
                    onSelectNode={(node) => setSelectedNode(node)}
                    selectedNodeId={selectedNode?.id}
                  />
                </div>
              ) : (
                /* TAB 2: MERMAID CODE VIEW / EDIT BLOCK */
                <div className="animate-fade-in">
                  <MermaidEditor 
                    nodes={nodes} 
                    onUpdateNodes={(updated) => {
                      setNodes(updated);
                      // Update drawer reference if currently viewed node was modified
                      if (selectedNode) {
                        const newMatch = updated.find(n => n.id === selectedNode.id);
                        if (newMatch) setSelectedNode(newMatch);
                      }
                    }} 
                  />
                </div>
              )}
            </div>
          </div>

          {/* 4. STATISTICS & PERFORMANCE OVERVIEW GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl flex items-center gap-4 shadow-sm">
              <span className="p-3 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 rounded-xl border border-green-100/30 dark:border-green-905/30">
                <Bot className="w-5 h-5" />
              </span>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Басты LLM Ойлаушы</p>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-1">gemini-flash-lite</p>
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl flex items-center gap-4 shadow-sm">
              <span className="p-3 bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 rounded-xl border border-purple-100/30 dark:border-purple-905/30">
                <Cpu className="w-5 h-5" />
              </span>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Орташа Latency</p>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-1">~0.6–2.5 секунд</p>
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl flex items-center gap-4 shadow-sm">
              <span className="p-3 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100/30 dark:border-blue-905/30">
                <Layers className="w-5 h-5" />
              </span>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Архитектура қабаты</p>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-1">7 Негізгі қадам</p>
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl flex items-center gap-4 shadow-sm">
              <span className="p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded-xl border border-amber-100/30 dark:border-amber-905/30">
                <Settings className="w-5 h-5 animate-spin-slow" />
              </span>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Апаттық резервттер</p>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-1">Monkey Patch белсенді</p>
              </div>
            </div>
          </div>

          {/* 5. SLIDING SIDE PANEL DETAILS DRAWER */}
          {selectedNode && (
            <>
              <div 
                className="fixed inset-0 bg-slate-950/45 dark:bg-slate-950/65 backdrop-blur-xs z-40 transition-opacity"
                onClick={() => setSelectedNode(null)}
              />
              <NodeDrawer
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
              />
            </>
          )}

        </main>
      )}

      {/* Decorative clean footer credit */}
      <footer className="py-12 border-t border-slate-200/40 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-950/25 transition-colors">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
          <p className="font-display font-bold text-xs text-slate-400 dark:text-slate-600 uppercase tracking-widest">
            Daraq AI Engine Platform
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">
            © 2026 Daraq. All rights reserved. Custom-made multi-tier RAG & Agentic architecture visualization.
          </p>
        </div>
      </footer>

    </div>
  );
}
