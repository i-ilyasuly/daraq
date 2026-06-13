export interface ArchitectureNode {
  id: string;
  title: string;
  subtitle: string;
  type: 'GATEWAY' | 'ROUTER' | 'VALIDATOR' | 'PIPELINE' | 'RERANKER' | 'REASONING' | 'OUTPUT' | 'DECISION' | 'DATABASE';
  colorTheme: 'green' | 'blue' | 'purple' | 'gray' | 'indigo' | 'amber';
  description: string;
  backgroundTasks: string[];
  role: string;
  fallbackPolicy: string;
  metric: string;
  subNodes?: { label: string; desc: string }[];
  connections: string[]; // target node IDs
  edgeLabels?: Record<string, string>; // targetId -> label
}

export type ThemeMode = 'light' | 'dark';
