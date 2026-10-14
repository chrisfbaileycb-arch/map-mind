import { GraphState, MindLink, MindNode, NodeColorType, NodeSemanticRole } from './types';

export const STORAGE_KEY = 'atrium-graph-v1';
export const APPROVAL_KEY = 'atrium-approved';
export const COMPANION_KEY = 'atrium-companion';

export const NODE_RADII: Record<NodeColorType, number> = {
  emerald: 16,
  violet: 20,
  amber: 16,
};

export const NODE_COLORS: Record<
  NodeColorType,
  { stroke: string; fill: string; text: string; label: string; glowClass: string }
> = {
  emerald: {
    stroke: '#34d399',
    fill: '#0d0d0f',
    text: '#6ee7b7',
    label: 'Emerald · Done / Core',
    glowClass: 'glow-emerald',
  },
  violet: {
    stroke: '#8b5cf6',
    fill: '#0d0d0f',
    text: '#c4b5fd',
    label: 'Violet · Brainstorm',
    glowClass: 'glow-violet',
  },
  amber: {
    stroke: '#fbbf24',
    fill: '#0d0d0f',
    text: '#fcd34d',
    label: 'Amber · Pending / Urgent',
    glowClass: 'glow-amber',
  },
};

export function createSeedGraph(): GraphState {
  const now = new Date().toISOString();
  const nodes: MindNode[] = [
    {
      id: 'u',
      type: 'emerald',
      label: 'You (core)',
      x: 0,
      y: 0,
      selected: true,
      payload: {
        role: 'owner',
        notes: 'Central workspace hub. All intake workflows and blueprints anchor here by default.',
        source: 'seed',
        priority: 'normal',
        createdAt: now,
      },
    },
    {
      id: 'e1',
      type: 'amber',
      label: 'Urgent email: Security audit sign-off',
      x: -230,
      y: 55,
      selected: false,
      payload: {
        role: 'urgent',
        notes: 'Requires CISO review and companion confirmation before production cutover.',
        source: 'seed',
        priority: 'critical',
        createdAt: now,
      },
    },
    {
      id: 'm1',
      type: 'emerald',
      label: 'Project milestone: v2.4 Graph Engine',
      x: 195,
      y: -95,
      selected: false,
      payload: {
        role: 'milestone',
        notes: 'Deterministic localStorage round-trip and interactive SVG stage shipped.',
        source: 'seed',
        priority: 'high',
        createdAt: now,
      },
    },
    {
      id: 'b1',
      type: 'violet',
      label: 'Brainstorm: Multi-agent intake parser',
      x: -175,
      y: -125,
      selected: false,
      payload: {
        role: 'brainstorm',
        notes: 'Map raw markdown outlines, JSX trees, and email threads into radial clusters.',
        source: 'seed',
        priority: 'normal',
        createdAt: now,
      },
    },
    {
      id: 'f1',
      type: 'amber',
      label: 'Financial task: Q4 cloud reserve reconciliation',
      x: 225,
      y: 115,
      selected: false,
      payload: {
        role: 'finance',
        notes: 'Reconcile compute ledger before Friday close.',
        source: 'seed',
        priority: 'high',
        createdAt: now,
      },
    },
  ];

  const links: MindLink[] = [
    { id: 'l-u-e1', from: 'u', to: 'e1', label: 'inbox' },
    { id: 'l-u-m1', from: 'u', to: 'm1', label: 'shipped' },
    { id: 'l-u-b1', from: 'u', to: 'b1', label: 'architecture' },
    { id: 'l-u-f1', from: 'u', to: 'f1', label: 'ledger' },
  ];

  return {
    nodes,
    links,
    pointerId: 'u',
  };
}

export function loadGraphFromStorage(): GraphState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedGraph();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || !parsed.nodes.length) {
      return createSeedGraph();
    }
    return {
      nodes: parsed.nodes,
      links: Array.isArray(parsed.links) ? parsed.links : [],
      pointerId: parsed.pointerId ?? (parsed.nodes[0]?.id || null),
    };
  } catch {
    return createSeedGraph();
  }
}

export function saveGraphToStorage(graph: GraphState): number {
  const serialized = JSON.stringify(graph);
  localStorage.setItem(STORAGE_KEY, serialized);
  return new Blob([serialized]).size;
}

export function verifyDeterministicRoundTrip(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    return JSON.stringify(JSON.parse(raw)) === raw;
  } catch {
    return false;
  }
}

function classifyTextLine(line: string): {
  type: NodeColorType;
  role: NodeSemanticRole;
  priority: 'normal' | 'high' | 'critical';
} {
  const lower = line.toLowerCase();
  if (lower.includes('urgent') || lower.includes('blocker') || lower.includes('asap') || lower.includes('critical')) {
    return { type: 'amber', role: 'urgent', priority: 'critical' };
  }
  if (lower.includes('milestone') || lower.includes('ship') || lower.includes('done') || lower.includes('complete')) {
    return { type: 'emerald', role: 'milestone', priority: 'high' };
  }
  if (lower.includes('financial') || lower.includes('finance') || lower.includes('budget') || lower.includes('invoice') || lower.includes('$')) {
    return { type: 'amber', role: 'finance', priority: 'high' };
  }
  if (lower.includes('brainstorm') || lower.includes('idea') || lower.includes('architecture') || lower.includes('design') || lower.includes('spec')) {
    return { type: 'violet', role: 'brainstorm', priority: 'normal' };
  }
  return { type: 'amber', role: 'pending', priority: 'normal' };
}

export function parseIntakeText(
  raw: string,
  existingNodes: MindNode[],
  anchorNodeId: string
): { newNodes: MindNode[]; newLinks: MindLink[] } {
  const lines = String(raw)
    .split(/\r?\n/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);

  if (!lines.length) return { newNodes: [], newLinks: [] };

  const anchor = existingNodes.find((n) => n.id === anchorNodeId) || existingNodes[0] || { x: 0, y: 0, id: 'u' };
  const baseRadius = 185 + (existingNodes.length % 3) * 35;
  const startAngle = (existingNodes.length * 0.75) % (Math.PI * 2);
  const now = new Date().toISOString();

  const newNodes: MindNode[] = [];
  const newLinks: MindLink[] = [];

  lines.forEach((text, idx) => {
    const angle = startAngle + (idx * (Math.PI * 2)) / Math.max(lines.length, 3);
    const radius = baseRadius + (idx % 2) * 45;
    const x = Math.round(anchor.x + Math.cos(angle) * radius);
    const y = Math.round(anchor.y + Math.sin(angle) * radius);
    const { type, role, priority } = classifyTextLine(text);
    const id = `intake-${Date.now()}-${idx}`;

    newNodes.push({
      id,
      type,
      label: text.length > 48 ? text.slice(0, 45) + '...' : text,
      x,
      y,
      selected: false,
      payload: {
        role,
        notes: text,
        source: 'intake',
        priority,
        createdAt: now,
      },
    });

    newLinks.push({
      id: `link-${anchor.id}-${id}`,
      from: anchor.id,
      to: id,
      label: role,
    });
  });

  return { newNodes, newLinks };
}

export function parseBlueprintInput(
  raw: string,
  existingNodes: MindNode[],
  anchorNodeId: string
): { newNodes: MindNode[]; newLinks: MindLink[] } {
  const trimmed = raw.trim();
  if (!trimmed) return { newNodes: [], newLinks: [] };

  const anchor = existingNodes.find((n) => n.id === anchorNodeId) || existingNodes[0] || { x: 0, y: 0, id: 'u' };
  const now = new Date().toISOString();
  const newNodes: MindNode[] = [];
  const newLinks: MindLink[] = [];

  // 1. Try JSON parsing first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.nodes)
        ? parsed.nodes
        : Object.entries(parsed).map(([k, v]) => ({
            name: k,
            notes: typeof v === 'string' ? v : JSON.stringify(v),
          }));

      const labelToId = new Map<string, string>();
      list.forEach((item: Record<string, unknown>, idx: number) => {
        const label = String(item.label || item.name || item.text || item.id || `Node ${idx + 1}`).trim();
        const id = `bp-json-${Date.now()}-${idx}`;
        labelToId.set(label.toLowerCase(), id);
        if (item.id) labelToId.set(String(item.id).toLowerCase(), id);

        const angle = -Math.PI / 3 + (idx * (Math.PI * 1.6)) / Math.max(list.length, 2);
        const radius = 210 + (idx % 2) * 50;
        const rawType = String(item.type || '').toLowerCase();
        const colorType: NodeColorType =
          rawType === 'emerald' || rawType === 'done' || rawType === 'milestone'
            ? 'emerald'
            : rawType === 'amber' || rawType === 'urgent' || rawType === 'finance'
            ? 'amber'
            : 'violet';

        newNodes.push({
          id,
          type: colorType,
          label,
          x: Math.round(anchor.x + Math.cos(angle) * radius),
          y: Math.round(anchor.y + Math.sin(angle) * radius),
          selected: false,
          payload: {
            role: colorType === 'emerald' ? 'milestone' : colorType === 'amber' ? 'pending' : 'brainstorm',
            notes: String(item.notes || item.description || JSON.stringify(item)),
            source: 'blueprint',
            priority: 'normal',
            createdAt: now,
          },
        });
      });

      // Wire explicit targets or connect to anchor
      list.forEach((item: Record<string, unknown>, idx: number) => {
        const currentNode = newNodes[idx];
        if (!currentNode) return;
        const targetKey = item.to || item.target || item.parent;
        if (targetKey && labelToId.has(String(targetKey).toLowerCase())) {
          const targetId = labelToId.get(String(targetKey).toLowerCase())!;
          newLinks.push({
            id: `link-${currentNode.id}-${targetId}`,
            from: currentNode.id,
            to: targetId,
            label: 'flow',
          });
        } else {
          newLinks.push({
            id: `link-${anchor.id}-${currentNode.id}`,
            from: anchor.id,
            to: currentNode.id,
            label: 'blueprint',
          });
        }
      });

      return { newNodes, newLinks };
    } catch {
      // Fall through to JSX / Markdown parser
    }
  }

  // 2. Check for arrow chains e.g. "AuthGateway -> SessionStore -> AuditLedger"
  if (trimmed.includes('->') || trimmed.includes('=>')) {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const labelMap = new Map<string, MindNode>();

    lines.forEach((line) => {
      const parts = line
        .split(/->|=>/)
        .map((p) => p.replace(/^[-*•\s]+/, '').trim())
        .filter(Boolean);

      for (let i = 0; i < parts.length; i++) {
        const partLabel = parts[i];
        const key = partLabel.toLowerCase();
        if (!labelMap.has(key)) {
          const idx = labelMap.size;
          const angle = -Math.PI / 2 + (idx * (Math.PI * 2)) / 7;
          const radius = 190 + Math.floor(idx / 6) * 80;
          const { type, role, priority } = classifyTextLine(partLabel);
          const node: MindNode = {
            id: `bp-flow-${Date.now()}-${idx}`,
            type: type === 'amber' && role === 'pending' ? 'violet' : type,
            label: partLabel,
            x: Math.round(anchor.x + Math.cos(angle) * radius),
            y: Math.round(anchor.y + Math.sin(angle) * radius),
            selected: false,
            payload: {
              role: role === 'pending' ? 'brainstorm' : role,
              notes: `Blueprint pipeline stage: ${partLabel}`,
              source: 'blueprint',
              priority,
              createdAt: now,
            },
          };
          labelMap.set(key, node);
          newNodes.push(node);
        }

        if (i === 0) {
          const firstNode = labelMap.get(key)!;
          const linkExists = newLinks.some((l) => l.from === anchor.id && l.to === firstNode.id);
          if (!linkExists) {
            newLinks.push({
              id: `link-${anchor.id}-${firstNode.id}`,
              from: anchor.id,
              to: firstNode.id,
              label: 'entry',
            });
          }
        }

        if (i > 0) {
          const prevNode = labelMap.get(parts[i - 1].toLowerCase())!;
          const currNode = labelMap.get(key)!;
          newLinks.push({
            id: `link-${prevNode.id}-${currNode.id}-${i}`,
            from: prevNode.id,
            to: currNode.id,
            label: 'next',
          });
        }
      }
    });

    if (newNodes.length > 0) return { newNodes, newLinks };
  }

  // 3. JSX Tag or PascalCase / Markdown token extraction
  const jsxMatches = [...trimmed.matchAll(/<([A-Za-z][A-Za-z0-9._-]*)/g)].map((m) => m[1]);
  const tokens =
    jsxMatches.length > 0
      ? Array.from(new Set(jsxMatches))
      : Array.from(
          new Set(
            trimmed
              .split(/\r?\n/)
              .map((l) => l.replace(/^[#*>-]+\s*/, '').trim())
              .filter(Boolean)
          )
        );

  tokens.forEach((token, idx) => {
    const angle = (idx * (Math.PI * 2)) / Math.max(tokens.length, 3);
    const radius = 200 + (idx % 2) * 45;
    const isComponent = /^[A-Z]/.test(token);
    const id = `bp-tok-${Date.now()}-${idx}`;

    newNodes.push({
      id,
      type: isComponent ? 'violet' : 'amber',
      label: isComponent ? `<${token} />` : token.slice(0, 44),
      x: Math.round(anchor.x + Math.cos(angle) * radius),
      y: Math.round(anchor.y + Math.sin(angle) * radius),
      selected: false,
      payload: {
        role: isComponent ? 'brainstorm' : 'pending',
        notes: `Extracted from blueprint snippet (${token})`,
        source: 'blueprint',
        priority: 'normal',
        createdAt: now,
      },
    });

    if (idx === 0) {
      newLinks.push({
        id: `link-${anchor.id}-${id}`,
        from: anchor.id,
        to: id,
        label: 'root',
      });
    } else {
      newLinks.push({
        id: `link-${newNodes[0].id}-${id}`,
        from: newNodes[0].id,
        to: id,
        label: 'child',
      });
    }
  });

  return { newNodes, newLinks };
}

export const INTAKE_PRESETS = [
  {
    title: 'Executive Morning Triage',
    content: `Urgent: Approve zero-trust key rotation before 11:00 UTC
Project milestone: Ship Atrium SVG mind-map v2.5 to production
Financial: Review Q4 infrastructure invoice ($14,200)
Brainstorm: Offline-first CRDT graph sync protocol
Done: Verified localStorage deterministic round-trip check`,
  },
  {
    title: 'Product Release Sprint',
    content: `Milestone: Finalize WCAG AA contrast across dark slate canvas
Urgent: Fix pointerup drag state leak on mobile touch viewports
Brainstorm: Companion confirmation personas with audit log signatures
Financial: Allocate $3,500 security bounty pool`,
  },
];

export const BLUEPRINT_PRESETS = [
  {
    title: 'Arrow Workflow Pipeline',
    content: `Raw Email Intake -> Lexical Line Classifier -> Radial Coordinate Solver -> SVG Stage Renderer
SVG Stage Renderer -> Companion Gate Check -> LocalStorage Persistence`,
  },
  {
    title: 'JSX Component Architecture',
    content: `<AtriumShell>
  <TopNavigation />
  <GraphViewport>
    <SvgEdgeLayer />
    <SvgNodeRing />
  </GraphViewport>
  <CompanionGate />
  <NodeInspector />
</AtriumShell>`,
  },
  {
    title: 'JSON System Topology',
    content: `[
  { "name": "Core Identity Hub", "type": "emerald", "notes": "Primary owner vertex" },
  { "name": "Threat Telemetry", "type": "amber", "to": "Core Identity Hub", "notes": "Live anomaly stream" },
  { "name": "Synthesis Engine", "type": "violet", "to": "Core Identity Hub", "notes": "Semantic clustering worker" }
]`,
  },
];
