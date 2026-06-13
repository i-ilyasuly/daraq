import React, { useState, useRef, MouseEvent, TouchEvent } from 'react';
import { ArchitectureNode } from '../types';
import { 
  Radio, 
  GitFork, 
  CheckSquare, 
  Layers, 
  SlidersHorizontal, 
  Brain, 
  Send, 
  ArrowRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Sparkles,
  HelpCircle,
  FileMinus
} from 'lucide-react';

interface FlowchartCanvasProps {
  nodes: ArchitectureNode[];
  onSelectNode: (node: ArchitectureNode) => void;
  selectedNodeId?: string;
}

export function FlowchartCanvas({ nodes, onSelectNode, selectedNodeId }: FlowchartCanvasProps) {
  const [zoom, setZoom] = useState<number>(0.9);
  const [panX, setPanX] = useState<number>(30);
  const [panY, setPanY] = useState<number>(20);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Define canvas dimensions
  const canvasWidth = 1100;
  const canvasHeight = 980;

  // Percentage to absolute coords map for rendering lines and positions
  const getCoordinates = (id: string): { x: number; y: number } => {
    switch (id) {
      case 'step1': return { x: 550, y: 50 };
      case 'step2': return { x: 550, y: 170 };
      case 'chitchat_done': return { x: 880, y: 170 };
      case 'step3': return { x: 550, y: 310 };
      case 'clarification_loop': return { x: 180, y: 310 };
      case 'step4': return { x: 550, y: 460 };
      case 'step5': return { x: 550, y: 600 };
      case 'fallback_empty': return { x: 880, y: 600 };
      case 'step6': return { x: 550, y: 740 };
      case 'step7': return { x: 550, y: 880 };
      default: return { x: 550, y: 50 };
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    // Only drag on canvas background, not on buttons or nodes
    if (e.target instanceof HTMLButtonElement || (e.target as HTMLElement).closest('.flow-node')) {
      return;
    }
    setIsDragging(true);
    dragStart.current = { x: e.clientX - panX, y: e.clientY - panY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    setPanX(e.clientX - dragStart.current.x);
    setPanY(e.clientY - dragStart.current.y);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: TouchEvent) => {
    if ((e.target as HTMLElement).closest('.flow-node')) {
      return;
    }
    const touch = e.touches[0];
    setIsDragging(true);
    dragStart.current = { x: touch.clientX - panX, y: touch.clientY - panY };
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setPanX(touch.clientX - dragStart.current.x);
    setPanY(touch.clientY - dragStart.current.y);
  };

  const resetTransform = () => {
    setZoom(0.9);
    setPanX(30);
    setPanY(20);
  };

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'GATEWAY': return <Radio className="w-5 h-5" />;
      case 'ROUTER': return <GitFork className="w-5 h-5" />;
      case 'VALIDATOR': return <CheckSquare className="w-5 h-5" />;
      case 'PIPELINE': return <Layers className="w-5 h-5" />;
      case 'RERANKER': return <SlidersHorizontal className="w-5 h-5" />;
      case 'REASONING': return <Brain className="w-5 h-5" />;
      case 'OUTPUT': return <Send className="w-5 h-5" />;
      case 'DECISION': return <HelpCircle className="w-5 h-5" />;
      default: return <Sparkles className="w-5 h-5" />;
    }
  };

  const getColorClasses = (theme: string, isSelected: boolean) => {
    const activeRing = isSelected ? 'ring-4 ring-purple-600 dark:ring-purple-400 scale-[1.03] shadow-xl' : 'hover:scale-[1.01] hover:shadow-lg shadow-md';
    switch (theme) {
      case 'green':
        return `border-l-8 border-green-500 bg-white dark:bg-slate-900 border-t border-r border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 ${activeRing}`;
      case 'blue':
        return `border-l-8 border-blue-500 bg-white dark:bg-slate-900 border-t border-r border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 ${activeRing}`;
      case 'purple':
        return `border-l-8 border-purple-500 bg-white dark:bg-slate-900 border-t border-r border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 ${activeRing}`;
      case 'amber':
        return `border-l-8 border-amber-500 bg-white dark:bg-slate-900 border-t border-r border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 ${activeRing}`;
      default:
        return `border-l-8 border-slate-500 bg-white dark:bg-slate-900 border-t border-r border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 ${activeRing}`;
    }
  };

  // Build connection line path between node A and node B
  const drawConnectionLine = (fromId: string, toId: string, label?: string) => {
    const from = getCoordinates(fromId);
    const to = getCoordinates(toId);

    let pathData = '';
    let labelX = 0;
    let labelY = 0;

    if (fromId === 'clarification_loop' && toId === 'step1') {
      // Loop backward: curve upward
      const cp1X = from.x - 100;
      const cp1Y = from.y - 120;
      const cp2X = to.x - 200;
      const cp2Y = to.y - 40;
      pathData = `M ${from.x} ${from.y} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${to.x} ${to.y}`;
      labelX = from.x - 110;
      labelY = (from.y + to.y) / 2 - 30;
    } else if (from.x === to.x) {
      // Straight line vertical down
      pathData = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
      labelX = from.x + 10;
      labelY = (from.y + to.y) / 2;
    } else if (from.y === to.y) {
      // Straight line horizontal across
      pathData = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
      labelX = (from.x + to.x) / 2;
      labelY = from.y - 10;
    } else {
      // Clean S-curve / elbow join
      const midY = (from.y + to.y) / 2;
      pathData = `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
      labelX = to.x - 10;
      labelY = midY - 12;
    }

    return (
      <g key={`${fromId}-${toId}`} className="transition-all duration-300">
        <path
          d={pathData}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-slate-300 dark:text-slate-700 transition-colors duration-300"
          markerEnd="url(#arrow)"
        />
        {/* Glowing highlight selector line if one of the nodes is active */}
        {(selectedNodeId === fromId || selectedNodeId === toId) && (
          <path
            d={pathData}
            fill="none"
            stroke="rgb(168, 85, 247)"
            strokeWidth="4"
            className="opacity-50 blur-sm animate-pulse"
            markerEnd="url(#arrow-active)"
          />
        )}
        {label && (
          <g transform={`translate(${labelX}, ${labelY})`}>
            <rect
              px="2"
              py="1"
              x="-65"
              y="-10"
              width="130"
              height="20"
              rx="4"
              className="fill-slate-100 dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700"
            />
            <text
              textAnchor="middle"
              className="text-[10px] font-semibold tracking-wider fill-slate-700 dark:fill-slate-300 font-sans"
              y="3"
            >
              {label}
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    <div className="relative w-full h-[650px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden select-none">
      
      {/* Zoom / Reset Controls overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <button
          onClick={() => setZoom(prev => Math.min(prev + 0.1, 1.4))}
          className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-sm cursor-pointer"
          title="Үлкейту"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.5))}
          className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-sm cursor-pointer"
          title="Кішірейту"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          onClick={resetTransform}
          className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-sm cursor-pointer"
          title="Орындарын қалпына келтіру"
        >
          <Maximize2 className="w-5 h-5" />
        </button>
      </div>

      {/* Guide tips */}
      <div className="absolute bottom-4 left-4 z-10 hidden sm:block bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        👆 Сүйреп жылжытыңыз • Дөңгелекшені бұрап үлкейтіңіз • Блокты басып ақпарат алыңыз
      </div>

      {/* Primary draggable / transformable canvas */}
      <div
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
        className={`w-full h-full cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`}
      >
        <div
          className="absolute origin-center transition-transform duration-75"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            width: `${canvasWidth}px`,
            height: `${canvasHeight}px`,
          }}
        >
          {/* Connecting SVG lines behind */}
          <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            style={{ width: canvasWidth, height: canvasHeight }}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" className="fill-slate-300 dark:fill-slate-700" />
              </marker>
              <marker
                id="arrow-active"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" className="fill-purple-500" />
              </marker>
            </defs>
            
            {nodes.map(node =>
              node.connections.map(connId => {
                const label = node.edgeLabels?.[connId];
                return drawConnectionLine(node.id, connId, label);
              })
            )}
          </svg>

          {/* Render Nodes as clean absolute elements */}
          {nodes.map(node => {
            const coords = getCoordinates(node.id);
            const isSelected = selectedNodeId === node.id;
            const themeClasses = getColorClasses(node.colorTheme, isSelected);

            return (
              <div
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(node);
                }}
                className={`flow-node absolute z-20 w-[280px] p-4 rounded-xl cursor-pointer transition-all duration-200 ${themeClasses}`}
                style={{
                  left: coords.x - 140, // Centered on coordinate
                  top: coords.y - 45, // Adjusted offset
                }}
                id={`node-${node.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-100 dark:border-slate-800`}>
                    {getNodeIcon(node.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold tracking-tight truncate">
                      {node.title.replace(/^\d+\.\s*/, '')}
                    </h4>
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {node.subtitle}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-bold text-slate-600 dark:text-slate-400">
                        {node.type}
                      </span>
                      <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400 flex items-center gap-1">
                        Толығырақ <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
