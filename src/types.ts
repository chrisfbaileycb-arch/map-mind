export type NodeColorType = 'emerald' | 'violet' | 'amber';

export type NodeSemanticRole =
  | 'owner'
  | 'urgent'
  | 'milestone'
  | 'finance'
  | 'brainstorm'
  | 'done'
  | 'pending';

export interface NodePayload {
  role: NodeSemanticRole;
  notes: string;
  source: 'seed' | 'intake' | 'blueprint' | 'manual';
  priority: 'normal' | 'high' | 'critical';
  createdAt: string;
}

export interface MindNode {
  id: string;
  type: NodeColorType;
  label: string;
  x: number;
  y: number;
  selected?: boolean;
  payload: NodePayload;
}

export interface MindLink {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface GraphState {
  nodes: MindNode[];
  links: MindLink[];
  pointerId: string | null;
}

export type CompanionType = 'robot' | 'stuffed-animal' | 'grandma';

export interface AuditLogItem {
  id: string;
  time: string;
  message: string;
}
