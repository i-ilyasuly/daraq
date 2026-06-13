import React, { useState } from 'react';
import { ArchitectureNode } from '../types';
import { generateMermaidCode } from '../data/architectureData';
import { 
  Copy, 
  Download, 
  Edit, 
  Settings, 
  Check, 
  AlertCircle,
  Code2,
  ListFilter
} from 'lucide-react';

interface MermaidEditorProps {
  nodes: ArchitectureNode[];
  onUpdateNodes: (updatedNodes: ArchitectureNode[]) => void;
}

export function MermaidEditor({ nodes, onUpdateNodes }: MermaidEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[0].id);
  const [copied, setCopied] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');

  const activeNode = nodes.find(n => n.id === selectedNodeId) || nodes[0];
  const mermaidCode = generateMermaidCode(nodes);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setSuccessMsg('Mermaid.js коды көшірілді!');
    setTimeout(() => {
      setCopied(false);
      setSuccessMsg('');
    }, 2500);
  };

  const handleDownloadCode = () => {
    const blob = new Blob([mermaidCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daraq-rag-architecture-2026.mmd';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSuccessMsg('daraq-rag-architecture-2026.mmd жүктеліп алынды!');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handlePropertyChange = (field: keyof ArchitectureNode, value: string) => {
    const updated = nodes.map(n => {
      if (n.id === selectedNodeId) {
        return { ...n, [field]: value };
      }
      return n;
    });
    onUpdateNodes(updated);
  };

  const handleBackgroundTaskChange = (index: number, value: string) => {
    if (!activeNode.backgroundTasks) return;
    const newTasks = [...activeNode.backgroundTasks];
    newTasks[index] = value;
    
    const updated = nodes.map(n => {
      if (n.id === selectedNodeId) {
        return { ...n, backgroundTasks: newTasks };
      }
      return n;
    });
    onUpdateNodes(updated);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* LEFT COLUMN: Mermaid syntax and controls */}
      <div className="lg:col-span-7 flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Mermaid.js схема коды</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Көшірілді' : 'Көшіру'}
            </button>
            <button
              onClick={handleDownloadCode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Жүктеу
            </button>
          </div>
        </div>

        {/* Code Content Box */}
        <div className="relative">
          <pre className="p-4 bg-slate-900 border border-slate-800 text-slate-100 dark:text-purple-100/90 rounded-2xl font-mono text-[11px] sm:text-xs overflow-x-auto leading-relaxed shadow-inner max-h-[500px]">
            <code>{mermaidCode}</code>
          </pre>
          <div className="absolute bottom-3 right-3 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-800/80 text-slate-400">
            Mermaid.js
          </div>
        </div>

        {successMsg && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50/80 dark:bg-green-950/20 text-green-700 dark:text-green-400 text-xs font-medium rounded-xl border border-green-100 dark:border-green-900/40">
            <Check className="w-4 h-4" />
            {successMsg}
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Node Properties Editor */}
      <div className="lg:col-span-5 flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Блоктарды өңдеуші</h3>
          </div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            Редактор
          </div>
        </div>

        {/* Selector node menu */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Сілтемелік блок таңдау
          </label>
          <div className="relative">
            <select
              value={selectedNodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
              className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
            >
              {nodes.map(n => (
                <option key={n.id} value={n.id}>
                  {n.title.replace(/^\d+\.\s*/, '')} ({n.id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Editor Inputs */}
        <div className="bg-slate-50 dark:bg-slate-900/40 p-4 border border-slate-200/60 dark:border-slate-800 rounded-2xl space-y-4 shadow-sm">
          {/* Node Title input */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Атауы (Title)
            </label>
            <input
              type="text"
              value={activeNode.title}
              onChange={(e) => handlePropertyChange('title', e.target.value)}
              className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 outline-none font-sans"
            />
          </div>

          {/* Subtitle / Tech Spec */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Технологиялық сипаты (Subtitle)
            </label>
            <input
              type="text"
              value={activeNode.subtitle}
              onChange={(e) => handlePropertyChange('subtitle', e.target.value)}
              className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 outline-none font-mono"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Түсіндірме мәтін (Description)
            </label>
            <textarea
              rows={3}
              value={activeNode.description}
              onChange={(e) => handlePropertyChange('description', e.target.value)}
              className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 outline-none font-sans resize-none"
            />
          </div>

          {/* Fallback policy */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Сақтық регламенті (Fallback Policy)
            </label>
            <textarea
              rows={2}
              value={activeNode.fallbackPolicy}
              onChange={(e) => handlePropertyChange('fallbackPolicy', e.target.value)}
              className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 outline-none font-sans resize-none"
            />
          </div>

          {/* Metrics */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Өнімділік (Metric)
            </label>
            <input
              type="text"
              value={activeNode.metric}
              onChange={(e) => handlePropertyChange('metric', e.target.value)}
              className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 outline-none font-mono"
            />
          </div>

          {/* Background Tasks editing */}
          {activeNode.backgroundTasks && activeNode.backgroundTasks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Бағынышты фондық алгоритмдер
              </label>
              <div className="space-y-2">
                {activeNode.backgroundTasks.map((task, idx) => (
                  <div key={idx} className="flex gap-2">
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500 pt-0.5 shrink-0 mt-2">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={task}
                      onChange={(e) => handleBackgroundTaskChange(idx, e.target.value)}
                      className="flex-1 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Live notification */}
        <div className="flex gap-2 p-3 bg-purple-50/50 dark:bg-purple-950/10 border border-purple-100/50 dark:border-purple-900/40 rounded-xl text-[11px] text-purple-700 dark:text-purple-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Бұл жерде енгізілген кез келген өзгертулер сол мезетте жоғарыдағы Диаграмма ағашына және Mermaid мәтініне беріледі.</span>
        </div>
      </div>
    </div>
  );
}
export default MermaidEditor;
