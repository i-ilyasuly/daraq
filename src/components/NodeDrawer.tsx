import React from 'react';
import { ArchitectureNode } from '../types';
import { 
  X, 
  Settings, 
  RotateCcw, 
  CheckCircle, 
  TrendingUp, 
  BrainCircuit, 
  Activity,
  ArrowRight
} from 'lucide-react';

interface NodeDrawerProps {
  node: ArchitectureNode | null;
  onClose: () => void;
}

export function NodeDrawer({ node, onClose }: NodeDrawerProps) {
  if (!node) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-slide-in">
      {/* Drawer Header */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="p-2.5 bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-xl">
            <Settings className="w-5 h-5 animate-spin-slow" />
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Шешім қадамы</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">ID: {node.id}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Node Heading */}
        <div>
          <div className="inline-flex px-2.5 py-0.5 rounded text-xs font-bold font-mono tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 mb-2">
            {node.type}
          </div>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
            {node.title}
          </h2>
          <p className="text-xs font-mono text-purple-600 dark:text-purple-400 mt-1">
            {node.subtitle}
          </p>
        </div>

        {/* Description Section */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Сипаттамасы (Description)
          </h4>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-55/70 dark:bg-slate-850/50 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/60">
            {node.description}
          </p>
        </div>

        {/* Primary Role */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Жүйедегі рөлі мен міндеті (Role)
          </h4>
          <div className="flex gap-3 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800/60">
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{node.role}</p>
          </div>
        </div>

        {/* Fallback & Resiliency Policy */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Апаттық сақтық ережесі (Fallback Policy)
          </h4>
          <div className="flex gap-3 text-sm text-slate-700 dark:text-slate-300 bg-amber-50/50 dark:bg-amber-950/20 p-4 rounded-xl border border-amber-100/50 dark:border-amber-900/40">
            <RotateCcw className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-400 text-xs mb-1">
                Қорғаныс регламенті:
              </p>
              <p className="leading-relaxed">{node.fallbackPolicy}</p>
            </div>
          </div>
        </div>

        {/* Background microservices/operations */}
        {node.backgroundTasks && node.backgroundTasks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Фондық процестер мен алгоритмдер
            </h4>
            <ul className="space-y-3">
              {node.backgroundTasks.map((task, idx) => (
                <li key={idx} className="flex gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                  <span className="flex-none w-5 h-5 rounded-full bg-purple-50 dark:bg-slate-800 text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed">{task}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Drawer Footer Metrics Section */}
      <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Activity className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-semibold">Өнімділік өлшемі (Metric)</span>
          </div>
          <span className="font-mono text-xs font-bold text-green-600 dark:text-green-400 px-2 py-1 bg-green-50 dark:bg-green-950/30 rounded-lg">
            {node.metric}
          </span>
        </div>
      </div>
    </div>
  );
}
export default NodeDrawer;
