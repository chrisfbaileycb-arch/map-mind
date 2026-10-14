import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Compass,
  Copy,
  Crosshair,
  FileJson,
  FolderUp,
  Link2,
  Maximize2,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  APPROVAL_KEY,
  BLUEPRINT_PRESETS,
  COMPANION_KEY,
  createSeedGraph,
  INTAKE_PRESETS,
  loadGraphFromStorage,
  NODE_COLORS,
  NODE_RADII,
  parseBlueprintInput,
  parseIntakeText,
  saveGraphToStorage,
  verifyDeterministicRoundTrip,
} from './graphUtils';
import { OfflineIndicator, PWAInstallButton } from './PWAInstallButton';
import {
  AuditLogItem,
  CompanionType,
  GraphState,
  MindNode,
  NodeColorType,
  NodeSemanticRole,
} from './types';

const COMPANION_META: Record<
  CompanionType,
  { name: string; title: string; approvalPrompt: string; deniedLine: string; approvedLine: string }
> = {
  robot: {
    name: 'Robot',
    title: 'Deterministic Guard Unit',
    approvalPrompt: 'Unit-01 requests explicit owner authorization before mutating graph topology.',
    deniedLine: 'Directive blocked: toggle owner approval or confirm below.',
    approvedLine: 'Checksum verified. Destructive graph edits authorized.',
  },
  'stuffed-animal': {
    name: 'Stuffed Bear',
    title: 'Soft Workspace Guardian',
    approvalPrompt: 'Hold on! Are you sure we should snip this node from your mind-map?',
    deniedLine: 'Paused for safety — give a quick paw-stamp approval first.',
    approvedLine: 'All cozy and confirmed! You can prune or reshape nodes freely.',
  },
  grandma: {
    name: 'Grandma',
    title: 'Wise Archive Keeper',
    approvalPrompt: 'Measure twice, cut once, dear. Confirm before throwing away your notes.',
    deniedLine: 'Not so fast — unlock approval first so we do not lose good work.',
    approvedLine: 'Blessings granted. Tidy up the board however you see fit.',
  },
};

export default function App() {
  // Graph state
  const [graph, setGraph] = useState<GraphState>(() => loadGraphFromStorage());
  const [storeBytes, setStoreBytes] = useState<number>(0);
  const [roundTripValid, setRoundTripValid] = useState<boolean>(true);

  // Filter & Search state
  const [colorFilter, setColorFilter] = useState<NodeColorType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Companion & Gate state
  const [companion, setCompanion] = useState<CompanionType>(() => {
    const saved = localStorage.getItem(COMPANION_KEY) as CompanionType | null;
    return saved && COMPANION_META[saved] ? saved : 'robot';
  });
  const [ownerApproved, setOwnerApproved] = useState<boolean>(() => {
    return localStorage.getItem(APPROVAL_KEY) === 'yes';
  });
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = useState<string | null>(null);

  // Audit log state
  const [auditLog, setAuditLog] = useState<AuditLogItem[]>(() => {
    const ts = new Date().toISOString().slice(11, 23);
    return [
      { id: 'init-1', time: ts, message: 'Atrium runtime initialized · deterministic check ok' },
    ];
  });
  const [copiedLog, setCopiedLog] = useState(false);

  // Modals state
  const [activeModal, setActiveModal] = useState<'intake' | 'blueprint' | 'howto' | null>(null);
  const [intakeText, setIntakeText] = useState<string>(INTAKE_PRESETS[0].content);
  const [blueprintText, setBlueprintText] = useState<string>(BLUEPRINT_PRESETS[0].content);
  const [anchorNodeId, setAnchorNodeId] = useState<string>('u');

  // SVG Viewport pan/zoom & drag state
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 800,
    height: 620,
  });
  const [view, setView] = useState<{ scale: number; tx: number; ty: number }>({
    scale: 1,
    tx: 0,
    ty: 0,
  });
  const [dragState, setDragState] = useState<{
    kind: 'viewport' | 'node';
    nodeId?: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  // Add deterministic audit entry
  const audit = (message: string) => {
    const time = new Date().toISOString().slice(11, 23);
    setAuditLog((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time, message },
      ...prev.slice(0, 49),
    ]);
  };

  // Persist graph on change
  useEffect(() => {
    const bytes = saveGraphToStorage(graph);
    setStoreBytes(bytes);
    setRoundTripValid(verifyDeterministicRoundTrip());
  }, [graph]);

  // Measure viewport and center (0,0) on first mount
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setViewportSize({ width: rect.width, height: rect.height });
    setView({
      scale: 1,
      tx: Math.round(rect.width / 2),
      ty: Math.round(rect.height / 2),
    });

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setViewportSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Selected node
  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === graph.pointerId) || null,
    [graph.nodes, graph.pointerId]
  );

  // Sync modal anchor to selected node when available
  useEffect(() => {
    if (selectedNode) {
      setAnchorNodeId(selectedNode.id);
    } else if (graph.nodes[0]) {
      setAnchorNodeId(graph.nodes[0].id);
    }
  }, [selectedNode, graph.nodes]);

  // Filtered nodes set (dim non-matching nodes rather than hiding links cleanly, or filter)
  const matchingNodeIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return new Set(
      graph.nodes
        .filter((n) => {
          const matchesColor = colorFilter === 'all' || n.type === colorFilter;
          const matchesQuery =
            !q ||
            n.label.toLowerCase().includes(q) ||
            n.payload.notes.toLowerCase().includes(q) ||
            n.payload.role.toLowerCase().includes(q);
          return matchesColor && matchesQuery;
        })
        .map((n) => n.id)
    );
  }, [graph.nodes, colorFilter, searchQuery]);

  // Companion selection handler
  const handleSelectCompanion = (next: CompanionType) => {
    setCompanion(next);
    localStorage.setItem(COMPANION_KEY, next);
    audit(`companion set to ${next}`);
  };

  // Toggle owner approval gate
  const handleToggleApproval = (next?: boolean) => {
    const target = typeof next === 'boolean' ? next : !ownerApproved;
    setOwnerApproved(target);
    localStorage.setItem(APPROVAL_KEY, target ? 'yes' : 'no');
    if (target) setPendingDeleteNodeId(null);
    audit(
      target
        ? `companion (${companion}) unlocked owner approval`
        : `companion (${companion}) locked owner approval gate`
    );
  };

  // Select a node
  const handleSelectNode = (nodeId: string | null) => {
    setPendingDeleteNodeId(null);
    setGraph((prev) => ({
      ...prev,
      pointerId: nodeId,
      nodes: prev.nodes.map((n) => ({
        ...n,
        selected: n.id === nodeId,
      })),
    }));
  };

  // Shift+Click: Toggle link between currently selected node and target node
  const handleToggleLink = (targetNode: MindNode) => {
    const sourceId = graph.pointerId;
    if (!sourceId || sourceId === targetNode.id) {
      handleSelectNode(targetNode.id);
      return;
    }

    setGraph((prev) => {
      const existing = prev.links.find(
        (l) =>
          (l.from === sourceId && l.to === targetNode.id) ||
          (l.from === targetNode.id && l.to === sourceId)
      );
      if (existing) {
        audit(`unlinked ${sourceId} <-> ${targetNode.id}`);
        return {
          ...prev,
          links: prev.links.filter((l) => l.id !== existing.id),
        };
      } else {
        const newLink = {
          id: `link-${sourceId}-${targetNode.id}-${Date.now()}`,
          from: sourceId,
          to: targetNode.id,
          label: 'linked',
        };
        audit(`linked ${sourceId} -> ${targetNode.id}`);
        return {
          ...prev,
          links: [...prev.links, newLink],
        };
      }
    });
  };

  // Pointer handlers for panning viewport and dragging individual nodes
  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setDragState({
      kind: 'viewport',
      startX: e.clientX,
      startY: e.clientY,
      originX: view.tx,
      originY: view.ty,
      moved: false,
    });
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGGElement>, node: MindNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    if (e.shiftKey) {
      handleToggleLink(node);
      return;
    }

    setDragState({
      kind: 'node',
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: node.x,
      originY: node.y,
      moved: false,
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e: PointerEvent) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const moved = dragState.moved || Math.hypot(dx, dy) > 3;

      if (dragState.kind === 'viewport') {
        setView((prev) => ({
          ...prev,
          tx: dragState.originX + dx,
          ty: dragState.originY + dy,
        }));
        if (moved !== dragState.moved) {
          setDragState((prev) => (prev ? { ...prev, moved: true } : null));
        }
      } else if (dragState.kind === 'node' && dragState.nodeId) {
        const scaledDx = dx / view.scale;
        const scaledDy = dy / view.scale;
        setGraph((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === dragState.nodeId
              ? {
                  ...n,
                  x: Math.round(dragState.originX + scaledDx),
                  y: Math.round(dragState.originY + scaledDy),
                }
              : n
          ),
        }));
        if (moved !== dragState.moved) {
          setDragState((prev) => (prev ? { ...prev, moved: true } : null));
        }
      }
    };

    const handlePointerUp = () => {
      if (dragState.kind === 'node' && dragState.nodeId) {
        if (!dragState.moved) {
          // Click on node: toggle selection
          handleSelectNode(dragState.nodeId);
        } else {
          const movedNode = graph.nodes.find((n) => n.id === dragState.nodeId);
          if (movedNode) {
            audit(`moved "${movedNode.label.slice(0, 22)}" to (${movedNode.x}, ${movedNode.y})`);
          }
        }
      } else if (dragState.kind === 'viewport' && !dragState.moved) {
        // Clicked empty canvas -> deselect
        handleSelectNode(null);
      }
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, view.scale, graph.nodes]);

  // Double-click canvas to create node at cursor coordinates
  const handleViewportDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const worldX = Math.round((clickX - view.tx) / view.scale);
    const worldY = Math.round((clickY - view.ty) / view.scale);

    createNewNodeAt(worldX, worldY, selectedNode?.id || graph.nodes[0]?.id);
  };

  const createNewNodeAt = (x: number, y: number, parentId?: string) => {
    const id = `node-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const newNode: MindNode = {
      id,
      type: 'violet',
      label: `Thought node #${graph.nodes.length + 1}`,
      x,
      y,
      selected: true,
      payload: {
        role: 'brainstorm',
        notes: 'Created directly on the Atrium stage.',
        source: 'manual',
        priority: 'normal',
        createdAt: now,
      },
    };

    setGraph((prev) => ({
      nodes: [...prev.nodes.map((n) => ({ ...n, selected: false })), newNode],
      links: parentId
        ? [...prev.links, { id: `link-${parentId}-${id}`, from: parentId, to: id, label: 'branch' }]
        : prev.links,
      pointerId: id,
    }));
    audit(`spawned node "${newNode.label}" at (${x}, ${y})`);
  };

  // Wheel zoom & pan on viewport
  const handleViewportWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.09 : 1 / 1.09;
      const nextScale = Math.min(2.6, Math.max(0.32, view.scale * factor));
      const ratio = nextScale / view.scale;
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setView((prev) => ({
        scale: nextScale,
        tx: cursorX - (cursorX - prev.tx) * ratio,
        ty: cursorY - (cursorY - prev.ty) * ratio,
      }));
    } else if (e.shiftKey) {
      e.preventDefault();
      setView((prev) => ({
        ...prev,
        tx: prev.tx - e.deltaX - e.deltaY,
      }));
    }
  };

  // Zoom controls
  const zoomBy = (factor: number) => {
    const cx = viewportSize.width / 2;
    const cy = viewportSize.height / 2;
    const nextScale = Math.min(2.6, Math.max(0.32, view.scale * factor));
    const ratio = nextScale / view.scale;
    setView((prev) => ({
      scale: nextScale,
      tx: cx - (cx - prev.tx) * ratio,
      ty: cy - (cy - prev.ty) * ratio,
    }));
  };

  const centerStage = () => {
    setView({
      scale: 1,
      tx: Math.round(viewportSize.width / 2),
      ty: Math.round(viewportSize.height / 2),
    });
    audit('stage centered to origin (0, 0)');
  };

  // Auto-layout radial arrangement around core node
  const handleAutoLayout = () => {
    setGraph((prev) => {
      if (prev.nodes.length <= 1) return prev;
      const [core, ...rest] = prev.nodes;
      const updated = prev.nodes.map((node, index) => {
        if (index === 0) return { ...node, x: 0, y: 0 };
        const ringIndex = Math.floor((index - 1) / 7);
        const posInRing = (index - 1) % 7;
        const countInRing = Math.min(7, rest.length - ringIndex * 7);
        const angle = -Math.PI / 2 + (posInRing * Math.PI * 2) / Math.max(countInRing, 1);
        const radius = 195 + ringIndex * 125;
        return {
          ...node,
          x: Math.round(Math.cos(angle) * radius),
          y: Math.round(Math.sin(angle) * radius),
        };
      });
      return { ...prev, nodes: updated };
    });
    centerStage();
    audit(`auto-arranged ${graph.nodes.length} nodes in radial rings`);
  };

  // Update selected node fields
  const updateSelectedNode = (
    patch: Partial<Pick<MindNode, 'label' | 'type'>> & {
      notes?: string;
      role?: NodeSemanticRole;
      priority?: 'normal' | 'high' | 'critical';
    }
  ) => {
    if (!selectedNode) return;
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== selectedNode.id) return n;
        return {
          ...n,
          label: patch.label !== undefined ? patch.label : n.label,
          type: patch.type !== undefined ? patch.type : n.type,
          payload: {
            ...n.payload,
            notes: patch.notes !== undefined ? patch.notes : n.payload.notes,
            role: patch.role !== undefined ? patch.role : n.payload.role,
            priority: patch.priority !== undefined ? patch.priority : n.payload.priority,
          },
        };
      }),
    }));
  };

  // Delete selected node (Companion-gated)
  const handleAttemptDeleteSelected = () => {
    if (!selectedNode) return;
    if (selectedNode.id === 'u' && graph.nodes.length > 1) {
      audit('protected: core anchor node cannot be deleted while linked');
      return;
    }

    if (ownerApproved) {
      executeDeleteNode(selectedNode.id, selectedNode.label);
    } else {
      setPendingDeleteNodeId(selectedNode.id);
      audit(`denied by ${companion} — owner approval required`);
    }
  };

  const executeDeleteNode = (nodeId: string, label: string) => {
    setGraph((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      links: prev.links.filter((l) => l.from !== nodeId && l.to !== nodeId),
      pointerId: prev.nodes.find((n) => n.id !== nodeId)?.id || null,
    }));
    setPendingDeleteNodeId(null);
    audit(`deleted "${label}" (approved via ${companion})`);
  };

  // Run Intake Parser
  const handleRunIntake = (e: React.FormEvent) => {
    e.preventDefault();
    const { newNodes, newLinks } = parseIntakeText(intakeText, graph.nodes, anchorNodeId);
    if (!newNodes.length) return;

    setGraph((prev) => ({
      nodes: [
        ...prev.nodes.map((n) => ({ ...n, selected: false })),
        ...newNodes.map((n, i) => ({ ...n, selected: i === 0 })),
      ],
      links: [...prev.links, ...newLinks],
      pointerId: newNodes[0].id,
    }));
    setActiveModal(null);
    audit(`parsed ${newNodes.length} intake nodes -> anchored to #${anchorNodeId}`);
  };

  // Run Blueprint Importer
  const handleRunBlueprint = (e: React.FormEvent) => {
    e.preventDefault();
    const { newNodes, newLinks } = parseBlueprintInput(blueprintText, graph.nodes, anchorNodeId);
    if (!newNodes.length) return;

    setGraph((prev) => ({
      nodes: [
        ...prev.nodes.map((n) => ({ ...n, selected: false })),
        ...newNodes.map((n, i) => ({ ...n, selected: i === 0 })),
      ],
      links: [...prev.links, ...newLinks],
      pointerId: newNodes[0].id,
    }));
    setActiveModal(null);
    audit(`imported ${newNodes.length} blueprint nodes (${newLinks.length} links)`);
  };

  // Export Graph JSON
  const handleExportJSON = () => {
    const payload = JSON.stringify(graph, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atrium-graph-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    audit(`exported ${new Blob([payload]).size}B JSON snapshot`);
  };

  // Import Graph JSON
  const handleImportJSONFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.nodes)) {
          setGraph({
            nodes: parsed.nodes,
            links: Array.isArray(parsed.links) ? parsed.links : [],
            pointerId: parsed.nodes[0]?.id || null,
          });
          audit(`restored ${parsed.nodes.length} nodes from ${file.name}`);
        }
      } catch {
        audit('import error: invalid JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Reset Demo
  const handleResetDemo = () => {
    const fresh = createSeedGraph();
    setGraph(fresh);
    centerStage();
    audit('reset graph to default seed topology');
  };

  // Copy audit log
  const handleCopyAuditLog = () => {
    const text = auditLog.map((item) => `[${item.time}] ${item.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 1800);
  };

  // Count by color type
  const counts = useMemo(() => {
    let emerald = 0;
    let violet = 0;
    let amber = 0;
    for (const n of graph.nodes) {
      if (n.type === 'emerald') emerald++;
      else if (n.type === 'violet') violet++;
      else amber++;
    }
    return { emerald, violet, amber };
  }, [graph.nodes]);

  const companionInfo = COMPANION_META[companion];

  return (
    <div className="atrium-grid-bg min-h-screen flex flex-col bg-[#0a0a0a] text-slate-100">
      <OfflineIndicator />

      {/* ============ TOP BAR (Strict 3-Zone Contract) ============ */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              centerStage();
            }}
            className="font-display text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Atrium · Visual Mind-Map
          </a>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-300">
            <button
              onClick={() => setActiveModal('intake')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Intake
            </button>
            <button
              onClick={() => setActiveModal('blueprint')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Blueprints
            </button>
            <button
              onClick={() => setActiveModal('howto')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              How-To
            </button>
            <button
              onClick={handleResetDemo}
              className="text-slate-400 hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Reset Demo
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileJson className="w-3.5 h-3.5" />
              Export JSON
            </button>
          </div>
        </div>
      </header>

      {/* ============ MAIN 3-COLUMN WORKSPACE ============ */}
      <main className="mx-auto flex flex-1 w-full max-w-[1440px] items-stretch gap-5 p-5">
        {/* ============ LEFT RAIL: Status + Companion Gate + Verbatim Log ============ */}
        <aside className="w-64 shrink-0 flex flex-col gap-4">
          {/* Live Graph Status & Filter Controls */}
          <section className="rounded-xl border border-white/10 bg-[#0d0d0f] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-400">Live Graph</h2>
              <span className="font-mono text-xs text-emerald-300 tabular-nums">
                {graph.nodes.length} nodes · {graph.links.length} links
              </span>
            </div>

            {/* Search Filter */}
            <div className="relative mt-3">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter nodes by label..."
                className="w-full rounded-lg border border-white/10 bg-black/40 pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Interactive Segmented Filter Controls */}
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setColorFilter('all')}
                className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  colorFilter === 'all'
                    ? 'bg-white/12 text-white border border-white/20'
                    : 'bg-white/[0.03] text-slate-400 border border-transparent hover:bg-white/[0.06] hover:text-slate-200'
                }`}
              >
                All ({graph.nodes.length})
              </button>
              <button
                onClick={() => setColorFilter(colorFilter === 'emerald' ? 'all' : 'emerald')}
                className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  colorFilter === 'emerald'
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                    : 'bg-emerald-500/[0.06] text-emerald-300/80 border border-transparent hover:bg-emerald-500/12'
                }`}
              >
                Emerald · {counts.emerald}
              </button>
              <button
                onClick={() => setColorFilter(colorFilter === 'violet' ? 'all' : 'violet')}
                className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  colorFilter === 'violet'
                    ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                    : 'bg-violet-500/[0.06] text-violet-300/80 border border-transparent hover:bg-violet-500/12'
                }`}
              >
                Violet · {counts.violet}
              </button>
              <button
                onClick={() => setColorFilter(colorFilter === 'amber' ? 'all' : 'amber')}
                className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  colorFilter === 'amber'
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                    : 'bg-amber-500/[0.06] text-amber-300/80 border border-transparent hover:bg-amber-500/12'
                }`}
              >
                Amber · {counts.amber}
              </button>
            </div>
          </section>

          {/* Companion Gate */}
          <section className="rounded-xl border border-white/10 bg-[#0d0d0f] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-400">Companion Gate</h2>
              <span className="text-xs text-slate-400">{companionInfo.name}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Choose who confirms destructive graph edits.
            </p>

            {/* Companion Picker */}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {(['robot', 'stuffed-animal', 'grandma'] as CompanionType[]).map((item) => {
                const active = companion === item;
                const label =
                  item === 'robot' ? 'Robot' : item === 'stuffed-animal' ? 'Bear' : 'Grandma';
                return (
                  <button
                    key={item}
                    onClick={() => handleSelectCompanion(item)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Companion Status & Owner Approval Switch */}
            <div className="mt-3 pt-3 border-t border-white/10">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Edit Authorization</span>
                <button
                  onClick={() => handleToggleApproval()}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    ownerApproved
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {ownerApproved ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Approved
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Gate Locked
                    </>
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {ownerApproved ? companionInfo.approvedLine : companionInfo.deniedLine}
              </p>
            </div>
          </section>

          {/* Verbatim Log */}
          <section className="flex-1 flex flex-col rounded-xl border border-white/10 bg-[#0d0d0f] p-4 min-h-[200px]">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-400">Verbatim Log</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyAuditLog}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  title="Copy Verbatim Log"
                >
                  {copiedLog ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedLog ? 'Copied' : 'Copy'}
                </button>
                <span className="text-slate-700">·</span>
                <button
                  onClick={() =>
                    setAuditLog([
                      {
                        id: String(Date.now()),
                        time: new Date().toISOString().slice(11, 23),
                        message: 'log cleared by owner',
                      },
                    ])
                  }
                  className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
            <ul className="mt-2.5 flex-1 space-y-1.5 overflow-y-auto max-h-56 pr-1 font-mono text-[11px] leading-snug text-slate-400 tabular-nums">
              {auditLog.map((entry) => (
                <li key={entry.id} className="break-words">
                  <span className="text-slate-500">[{entry.time}]</span>{' '}
                  <span className="text-slate-300">{entry.message}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {/* ============ CENTER: Interactive SVG Mind-Map Stage ============ */}
        <section className="relative flex-1 flex flex-col min-h-[600px]">
          <div
            ref={viewportRef}
            onPointerDown={handleViewportPointerDown}
            onDoubleClick={handleViewportDoubleClick}
            onWheel={handleViewportWheel}
            className="relative flex-1 w-full rounded-2xl border border-white/10 bg-[#0d0d0f]/75 overflow-hidden select-none"
            style={{ cursor: dragState?.kind === 'viewport' ? 'grabbing' : 'grab' }}
          >
            {/* Floating Stage Controls (Top-Left) */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="absolute top-3.5 left-3.5 z-10 flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#0a0a0a]/90 p-1.5 backdrop-blur-md"
            >
              <button
                onClick={() =>
                  createNewNodeAt(
                    Math.round((Math.random() - 0.5) * 220),
                    Math.round((Math.random() - 0.5) * 180),
                    selectedNode?.id || graph.nodes[0]?.id
                  )
                }
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Node
              </button>
              <button
                onClick={handleAutoLayout}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Arrange nodes in radial rings around core"
              >
                <Compass className="w-3.5 h-3.5" />
                Radial Layout
              </button>
              <button
                onClick={centerStage}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Center viewport on (0,0)"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Center
              </button>
            </div>

            {/* Floating Zoom Controls (Top-Right) */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="absolute top-3.5 right-3.5 z-10 flex items-center gap-1 rounded-xl border border-white/10 bg-[#0a0a0a]/90 p-1.5 backdrop-blur-md"
            >
              <button
                onClick={() => zoomBy(1 / 1.15)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono text-xs text-slate-300 tabular-nums">
                {Math.round(view.scale * 100)}%
              </span>
              <button
                onClick={() => zoomBy(1.15)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Interactive SVG Canvas */}
            <svg width="100%" height="100%" className="block w-full h-full">
              <defs>
                <marker
                  id="arrow-default"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#52525b" />
                </marker>
                <marker
                  id="arrow-active"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#34d399" />
                </marker>
              </defs>

              <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
                {/* Subtle origin crosshair at (0,0) */}
                <line x1={-18} y1={0} x2={18} y2={0} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <line x1={0} y1={-18} x2={0} y2={18} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

                {/* Graph Links (drawn underneath nodes) */}
                {graph.links.map((link) => {
                  const a = graph.nodes.find((n) => n.id === link.from);
                  const b = graph.nodes.find((n) => n.id === link.to);
                  if (!a || !b) return null;

                  const isConnectedToSelected =
                    selectedNode && (link.from === selectedNode.id || link.to === selectedNode.id);
                  const dimmed =
                    !matchingNodeIds.has(a.id) || !matchingNodeIds.has(b.id);

                  const midX = (a.x + b.x) / 2;
                  const midY = (a.y + b.y) / 2;

                  return (
                    <g key={link.id} opacity={dimmed ? 0.2 : 1}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={isConnectedToSelected ? '#34d399' : '#52525b'}
                        strokeWidth={isConnectedToSelected ? 2 : 1.5}
                        strokeDasharray={link.label === 'blueprint' ? '5 4' : undefined}
                        markerEnd={
                          isConnectedToSelected ? 'url(#arrow-active)' : 'url(#arrow-default)'
                        }
                      />
                      {link.label && isConnectedToSelected && (
                        <text
                          x={midX}
                          y={midY - 6}
                          fill="#94a3b8"
                          fontSize="10"
                          textAnchor="middle"
                          className="font-mono pointer-events-none"
                        >
                          {link.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Graph Nodes */}
                {graph.nodes.map((node) => {
                  const radius = NODE_RADII[node.type] || 16;
                  const colorMeta = NODE_COLORS[node.type] || NODE_COLORS.amber;
                  const isSelected = node.id === graph.pointerId;
                  const isDimmed = !matchingNodeIds.has(node.id);

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      onPointerDown={(e) => handleNodePointerDown(e, node)}
                      style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1 }}
                      className="transition-opacity duration-150"
                    >
                      {/* Outer selection halo */}
                      {isSelected && (
                        <circle
                          r={radius + 8}
                          fill="none"
                          stroke={colorMeta.stroke}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          className={colorMeta.glowClass}
                        />
                      )}

                      {/* Node ring badge */}
                      <circle
                        r={radius}
                        fill="#0d0d0f"
                        stroke={colorMeta.stroke}
                        strokeWidth={isSelected ? 3 : 2.5}
                        className={isSelected ? colorMeta.glowClass : undefined}
                      />

                      {/* Inner accent dot */}
                      <circle
                        cx={0}
                        cy={0}
                        r={isSelected ? 4 : 3}
                        fill={colorMeta.stroke}
                      />

                      {/* Node primary label */}
                      <text
                        y={radius + 15}
                        fill={isSelected ? '#ffffff' : '#e5e7eb'}
                        fontSize="12"
                        fontWeight={isSelected ? '600' : '500'}
                        textAnchor="middle"
                        className="pointer-events-none"
                      >
                        {node.label}
                      </text>

                      {/* Quiet semantic role caption below label */}
                      <text
                        y={radius + 28}
                        fill="#64748b"
                        fontSize="10"
                        textAnchor="middle"
                        className="font-mono pointer-events-none"
                      >
                        {node.payload.role}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Bottom Interaction Hint Strip */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute bottom-3 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0a0a0a]/85 px-3.5 py-2 text-xs text-slate-400 backdrop-blur-md"
            >
              <span>
                Drag node to move · Shift+Click node to link or unlink · Double-click canvas to spawn node
              </span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                Origin ({Math.round(view.tx)}, {Math.round(view.ty)})
              </span>
            </div>
          </div>
        </section>

        {/* ============ RIGHT RAIL: Node Inspector + Local Storage Data ============ */}
        <aside className="w-80 shrink-0 flex flex-col gap-4">
          {/* Node Inspector & Live Editor */}
          <section className="flex-1 rounded-xl border border-white/10 bg-[#0d0d0f] p-4 text-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-xs font-semibold tracking-wide text-slate-400">Node Inspector</h2>
              {selectedNode && (
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  ({selectedNode.x}, {selectedNode.y})
                </span>
              )}
            </div>

            {selectedNode ? (
              <div className="mt-3 space-y-3.5">
                {/* Clean Unboxed Metadata Line (Zero-Pill Compliance) */}
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span
                    className="font-medium"
                    style={{ color: NODE_COLORS[selectedNode.type].text }}
                  >
                    {selectedNode.type}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedNode.payload.role}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedNode.payload.priority} priority</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">#{selectedNode.id.slice(0, 8)}</span>
                </div>

                {/* Editable Label */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Label</label>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => updateSelectedNode({ label: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>

                {/* Color Type & Semantic Role */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Status Ring</label>
                    <select
                      value={selectedNode.type}
                      onChange={(e) =>
                        updateSelectedNode({ type: e.target.value as NodeColorType })
                      }
                      className="w-full rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                    >
                      <option value="emerald">Emerald (Done / Core)</option>
                      <option value="violet">Violet (Brainstorm)</option>
                      <option value="amber">Amber (Pending / Urgent)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Role</label>
                    <select
                      value={selectedNode.payload.role}
                      onChange={(e) =>
                        updateSelectedNode({ role: e.target.value as NodeSemanticRole })
                      }
                      className="w-full rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                    >
                      <option value="owner">owner</option>
                      <option value="urgent">urgent</option>
                      <option value="milestone">milestone</option>
                      <option value="finance">finance</option>
                      <option value="brainstorm">brainstorm</option>
                      <option value="done">done</option>
                      <option value="pending">pending</option>
                    </select>
                  </div>
                </div>

                {/* Notes / Payload Editor */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Notes</label>
                  <textarea
                    rows={3}
                    value={selectedNode.payload.notes}
                    onChange={(e) => updateSelectedNode({ notes: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-black/40 p-2.5 text-xs leading-relaxed text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>

                {/* Raw Payload JSON Readout */}
                <div>
                  <div className="text-xs text-slate-400 mb-1">Payload JSON</div>
                  <pre className="rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto">
                    {JSON.stringify(selectedNode.payload, null, 2)}
                  </pre>
                </div>

                {/* Node Actions */}
                <div className="pt-1 flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      createNewNodeAt(
                        selectedNode.x + Math.round((Math.random() - 0.5) * 140),
                        selectedNode.y + 110,
                        selectedNode.id
                      )
                    }
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Branch Child
                  </button>

                  <button
                    onClick={handleAttemptDeleteSelected}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Node
                  </button>
                </div>

                {/* In-Panel Companion Approval Prompt when Delete is Clicked while Gate is Locked */}
                {pendingDeleteNodeId === selectedNode.id && !ownerApproved && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <div className="font-semibold text-amber-200">
                      {companionInfo.name} Gate Confirmation Required
                    </div>
                    <p className="mt-1 text-amber-100/80 leading-relaxed">
                      {companionInfo.approvalPrompt}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        onClick={() => {
                          handleToggleApproval(true);
                          executeDeleteNode(selectedNode.id, selectedNode.label);
                        }}
                        className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Approve & Delete
                      </button>
                      <button
                        onClick={() => setPendingDeleteNodeId(null)}
                        className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">Select any node on the stage to inspect or edit it.</p>
                <div className="mt-4 flex justify-center gap-2">
                  {graph.nodes[0] && (
                    <button
                      onClick={() => handleSelectNode(graph.nodes[0].id)}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15 cursor-pointer"
                    >
                      Inspect Core Node
                    </button>
                  )}
                  <button
                    onClick={() => createNewNodeAt(0, 0)}
                    className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
                  >
                    Create Node
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Local Storage Persistence & Export */}
          <section className="rounded-xl border border-white/10 bg-[#0d0d0f] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-400">Data (Local)</h2>
              <span className="font-mono text-xs text-slate-300 tabular-nums">
                {storeBytes > 0 ? `${storeBytes}B stored` : 'nothing stored yet'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Round-trip persistence:{' '}
              <span className={roundTripValid ? 'text-emerald-300' : 'text-amber-300'}>
                {roundTripValid ? 'Identity verified' : 'Pending sync'}
              </span>
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportJSONFile}
              className="hidden"
            />

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={handleExportJSON}
                className="flex items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileJson className="w-3.5 h-3.5" />
                Export
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderUp className="w-3.5 h-3.5" />
                Import
              </button>
              <button
                onClick={handleResetDemo}
                className="flex items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>
          </section>
        </aside>
      </main>

      {/* ============ MODALS (Intake / Blueprints / How-To) ============ */}
      {activeModal === 'intake' && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl overflow-hidden"
          >
            <form onSubmit={handleRunIntake} className="flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
                <span className="font-display text-sm font-semibold text-white">
                  Email & Workflow Intake Parser
                </span>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <p className="text-xs leading-relaxed text-slate-300">
                  Paste a raw email, daily note, or task outline — the parser splits each line into
                  typed nodes (<span className="text-emerald-300">milestone / done</span>,{' '}
                  <span className="text-violet-300">brainstorm</span>,{' '}
                  <span className="text-amber-300">urgent / financial</span>) and wires them to your
                  selected anchor node.
                </p>

                {/* Sample Presets */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">Presets:</span>
                  {INTAKE_PRESETS.map((preset) => (
                    <button
                      key={preset.title}
                      type="button"
                      onClick={() => setIntakeText(preset.content)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
                    >
                      {preset.title}
                    </button>
                  ))}
                </div>

                {/* Anchor Node Picker */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-slate-400">Wire new nodes to:</label>
                  <select
                    value={anchorNodeId}
                    onChange={(e) => setAnchorNodeId(e.target.value)}
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                  >
                    {graph.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} (#{n.id.slice(0, 6)})
                      </option>
                    ))}
                  </select>
                </div>

                <textarea
                  rows={6}
                  value={intakeText}
                  onChange={(e) => setIntakeText(e.target.value)}
                  placeholder="Urgent: Review security audit&#10;Milestone: Ship v2.5 mind-map&#10;Brainstorm: Graph layout solver"
                  className="w-full rounded-xl border border-white/15 bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3.5 bg-black/20">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  Parse & Add Nodes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'blueprint' && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl overflow-hidden"
          >
            <form onSubmit={handleRunBlueprint} className="flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
                <span className="font-display text-sm font-semibold text-white">
                  Blueprint & Snippet Importer
                </span>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <p className="text-xs leading-relaxed text-slate-300">
                  Paste arrow pipelines (<code>Stage A -&gt; Stage B</code>), JSX component trees (
                  <code>&lt;Header /&gt;</code>), or JSON node arrays. The parser extracts nodes and
                  directed relationships onto the canvas.
                </p>

                {/* Blueprint Presets */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">Templates:</span>
                  {BLUEPRINT_PRESETS.map((preset) => (
                    <button
                      key={preset.title}
                      type="button"
                      onClick={() => setBlueprintText(preset.content)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
                    >
                      {preset.title}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={7}
                  value={blueprintText}
                  onChange={(e) => setBlueprintText(e.target.value)}
                  placeholder="Paste JSX, JSON workflow, or arrow pipeline..."
                  className="w-full rounded-xl border border-white/15 bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3.5 bg-black/20">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  Import Onto Canvas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'howto' && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <span className="font-display text-sm font-semibold text-white">
                How-To: Export, Shortcuts & PWA Usage
              </span>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs leading-relaxed text-slate-300">
              <ol className="list-decimal pl-4 space-y-3">
                <li>
                  <strong className="text-white">Export & Restore JSON:</strong> Click{' '}
                  <span className="text-emerald-300">Export JSON</span> in the top bar or Data panel
                  to download a deterministic snapshot of your nodes and links. Use{' '}
                  <span className="text-slate-100">Import</span> at any time to restore a saved
                  graph.
                </li>
                <li>
                  <strong className="text-white">Interactive Canvas Shortcuts:</strong>
                  <ul className="mt-1.5 list-disc pl-4 space-y-1 text-slate-400">
                    <li>
                      <strong className="text-slate-200">Drag any node</strong> to reposition it on
                      the SVG stage (coordinates auto-save to <code>localStorage</code>).
                    </li>
                    <li>
                      <strong className="text-slate-200">Shift + Click</strong> a second node to
                      create or remove a directed link between the selected node and the clicked
                      node.
                    </li>
                    <li>
                      <strong className="text-slate-200">Double-click empty canvas</strong> to spawn
                      a new thought node directly at the cursor position.
                    </li>
                    <li>
                      <strong className="text-slate-200">Mouse Wheel / Trackpad</strong> to zoom and
                      pan across large architectures.
                    </li>
                  </ul>
                </li>
                <li>
                  <strong className="text-white">Companion Gate Safety:</strong> Destructive edits
                  (such as deleting a node) are guarded by your chosen Companion (
                  <em>Robot, Stuffed Bear, or Grandma</em>). Unlock approval in the left rail or
                  confirm directly inside the Inspector prompt.
                </li>
                <li>
                  <strong className="text-white">Install as Offline PWA:</strong> Use the{' '}
                  <strong className="text-emerald-300">Install App</strong> button in the header (or
                  browser &ldquo;Add to Home Screen&rdquo; on mobile) to run Atrium standalone with
                  full offline service-worker caching.
                </li>
              </ol>
            </div>

            <div className="flex items-center justify-end border-t border-white/10 px-5 py-3 bg-black/20">
              <button
                onClick={() => setActiveModal(null)}
                className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
