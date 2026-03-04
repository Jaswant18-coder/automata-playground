import { useMemo, useState } from 'react';
import {
  type Automaton,
  type ComplexityInfo,
  type FormDefinition,
  type MachineKind,
  type PromptBuildResult,
  type PushdownAutomaton,
  type SimulationResult,
  examples,
  generateFromPrompt,
  minimizeDFA,
  nfaToRegex,
  parseForm,
  pdaToTable,
  regexToNFA,
  simulationComplexity,
  simulate,
  subsetConstruction,
  toTable,
  validateAutomaton,
} from './automata';
import { generateFromLLM, validateAutomataDescription, type LLMProvider, type LLMConfig } from './llm';

type Panel = 'sim' | 'convert' | 'minimize' | 'regex' | 'viz' | 'explain' | 'prompt';

const colors = {
  sim: '#3b82f6',      // blue
  convert: '#8b5cf6',  // purple
  minimize: '#10b981', // emerald
  regex: '#f59e0b',    // amber
  viz: '#ec4899',      // pink
  explain: '#06b6d4',  // cyan
  prompt: '#8b5cf6',   // violet
};

const baseStyles = {
  page: { 
    fontFamily: "'Segoe UI', 'Helvetica Neue', sans-serif", 
    margin: '20px', 
    maxWidth: 1400,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    minHeight: '100vh',
    borderRadius: 20,
  },
  card: { 
    padding: 20, 
    border: 'none',
    borderRadius: 15, 
    background: 'linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
    transition: 'all 0.3s ease',
  },
  cardGradient: (color: string) => ({
    padding: 20,
    border: 'none',
    borderRadius: 15,
    background: `linear-gradient(135deg, ${color}20 0%, ${color}05 100%)`,
    borderLeft: `4px solid ${color}`,
    boxShadow: `0 10px 30px ${color}30`,
  }),
  row: { display: 'grid', gap: 18 },
};

const presets: Record<MachineKind, FormDefinition[]> = {
  dfa: [examples.dfaEvenZeros],
  nfa: [examples.nfaEndsWith01, examples.nfaWithEpsilon],
};

function useFormState(kind: MachineKind) {
  const initial = useMemo(() => presets[kind][0], [kind]);
  const [form, setForm] = useState<FormDefinition>(initial);
  return { form, setForm };
}

function Issues({ issues }: { issues: { type: string; message: string }[] }) {
  if (!issues.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {issues.map((i, idx) => (
        <div 
          key={idx} 
          style={{ 
            padding: '10px 12px',
            marginBottom: 8,
            borderRadius: 8,
            backgroundColor: i.type === 'error' ? '#fee2e2' : '#fef3c7',
            borderLeft: `4px solid ${i.type === 'error' ? '#ef4444' : '#f59e0b'}`,
            color: i.type === 'error' ? '#991b1b' : '#92400e',
            fontSize: '14px',
          }}
        >
          <strong>{i.type === 'error' ? '❌ ERROR' : '⚠️  WARNING'}</strong>: {i.message}
        </div>
      ))}
    </div>
  );
}

function Trace({ result }: { result: SimulationResult | null }) {
  if (!result) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        padding: '14px 16px',
        borderRadius: 10,
        background: result.accepted ? 'linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%)' : 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)',
        borderLeft: `4px solid ${result.accepted ? '#10b981' : '#ef4444'}`,
        marginBottom: 16,
        fontWeight: 500,
      }}>
        {result.accepted ? '✅ ACCEPTED' : '❌ REJECTED'} — Final state(s): <strong>{result.finalStates.join(', ') || '∅'}</strong>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <thead>
          <tr style={{ background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
            <th style={{ textAlign: 'left', padding: '12px', borderRadius: '8px 0 0 0' }}>Step</th>
            <th style={{ textAlign: 'left', padding: '12px' }}>Symbol</th>
            <th style={{ textAlign: 'left', padding: '12px' }}>From</th>
            <th style={{ textAlign: 'left', padding: '12px' }}>To</th>
            <th style={{ textAlign: 'left', padding: '12px', borderRadius: '0 8px 0 0' }}>Consumed</th>
          </tr>
        </thead>
        <tbody>
          {result.steps.map((s, idx) => (
            <tr key={s.index} style={{ 
              background: idx % 2 === 0 ? '#f9fafb' : '#ffffff',
              borderBottom: '1px solid #e5e7eb',
            }}>
              <td style={{ padding: '10px 12px' }}>{s.index >= 0 ? s.index + 1 : '0'}</td>
              <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{s.symbol ?? 'ε'}</td>
              <td style={{ padding: '10px 12px' }}>{s.from.join(', ') || '∅'}</td>
              <td style={{ padding: '10px 12px', color: '#3b82f6', fontWeight: 500 }}>{s.to.join(', ') || '∅'}</td>
              <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{s.consumed || 'ε'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Issues issues={result.issues} />
    </div>
  );
}

function MachineTable({ automaton }: { automaton: Automaton }) {
  const rows = toTable(automaton);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#374151' }}>📋 Transition Table</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'linear-gradient(90deg, #8b5cf6 0%, #6d28d9 100%)', color: 'white' }}>
            <th style={{ textAlign: 'left', padding: '12px', borderRadius: '8px 0 0 0' }}>From State</th>
            <th style={{ textAlign: 'left', padding: '12px' }}>Symbol</th>
            <th style={{ textAlign: 'left', padding: '12px', borderRadius: '0 8px 0 0' }}>To State(s)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} style={{ 
              background: idx % 2 === 0 ? '#f9fafb' : '#ffffff',
              borderBottom: '1px solid #e5e7eb',
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f4ff')}
            onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? '#f9fafb' : '#ffffff')}
            >
              <td style={{ padding: '10px 12px', fontWeight: 500, color: '#1f2937' }}>{r.from}</td>
              <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#6366f1' }}>{r.symbol}</td>
              <td style={{ padding: '10px 12px', color: '#374151' }}>{r.to.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type GraphProps = {
  automaton: Automaton | null;
  activeStates?: string[];
  focusFrom?: string[];
  focusTo?: string[];
  title: string;
};

function GraphView({ automaton, activeStates = [], focusFrom = [], focusTo = [], title }: GraphProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [customCoords, setCustomCoords] = useState<Record<string, { x: number; y: number }>>({});

  if (!automaton) return (
    <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', background: '#f3f4f6', borderRadius: 12 }}>
      📊 No automaton to visualize. Validate or run a machine first.
    </div>
  );

  const width = 800;
  const height = 600;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 120;
  const radius = 32; // state circle radius

  // Initialize coords if not in custom
  const coords: Record<string, { x: number; y: number }> = {};
  automaton.states.forEach((s, i) => {
    if (customCoords[s]) {
      coords[s] = customCoords[s];
    } else {
      const angle = (2 * Math.PI * i) / automaton.states.length;
      coords[s] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }
  });

  const edges: Array<{ from: string; to: string; symbol: string }> = [];
  const edgeSymbols: Record<string, string[]> = {};
  
  for (const from of Object.keys(automaton.transitions)) {
    for (const sym of Object.keys(automaton.transitions[from])) {
      for (const to of automaton.transitions[from][sym]) {
        edges.push({ from, to, symbol: sym });
        const key = `${from}-${to}`;
        if (!edgeSymbols[key]) edgeSymbols[key] = [];
        edgeSymbols[key].push(sym);
      }
    }
  }

  const isActive = (s: string) => activeStates.includes(s);
  const edgeActive = (e: { from: string; to: string }) => focusFrom.includes(e.from) && focusTo.includes(e.to);

  const handleMouseDown = (state: string) => (e: React.MouseEvent<SVGCircleElement>) => {
    e.preventDefault();
    setDragging(state);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = svg.viewBox.baseVal.width / rect.width;
    const scaleY = svg.viewBox.baseVal.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setCustomCoords(prev => ({ ...prev, [dragging]: { x, y } }));
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  // Render self-loops
  const selfLoops = edges.filter(e => e.from === e.to);
  const regularEdges = edges.filter(e => e.from !== e.to);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 10, color: '#374151', fontSize: '16px' }}>
        📊 {title}
        <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af', marginLeft: 8 }}>
          (drag states to reposition)
        </span>
      </div>
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        width="100%" 
        style={{ 
          maxWidth: '100%', 
          border: '2px solid #e5e7eb', 
          borderRadius: 12, 
          background: '#fafbff', 
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker id="arrow-regular" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#666" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1d4ed8" />
          </marker>
          <filter id="label-bg" x="-40%" y="-60%" width="180%" height="180%">
            <feFlood floodColor="white" result="bg" />
            <feComposite in="SourceGraphic" in2="bg" operator="dest-over" />
          </filter>
        </defs>

        {/* Grid background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#grid)" />

        {/* Regular edges */}
        {regularEdges.map((e, idx) => {
          const from = coords[e.from];
          const to = coords[e.to];
          if (!from || !to) return null;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = (dx / dist) * (radius + 4);
          const uy = (dy / dist) * (radius + 4);
          const start = { x: from.x + ux, y: from.y + uy };
          const end = { x: to.x - ux, y: to.y - uy };
          
          // Detect parallel edges (multiple between same pair)
          const key = `${e.from}-${e.to}`;
          const allParallel = edges.filter(ex => `${ex.from}-${ex.to}` === key);
          const isParallel = allParallel.length > 1;
          const parallelIdx = allParallel.findIndex(ex => ex === e);
          
          let mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
          
          // Offset parallel edges
          if (isParallel) {
            const offset = (parallelIdx - (allParallel.length - 1) / 2) * 25;
            const perpX = -dy / dist;
            const perpY = dx / dist;
            mid = { x: mid.x + perpX * offset, y: mid.y + perpY * offset };
          }

          const active = edgeActive(e);
          const color = active ? '#1d4ed8' : '#666';
          const strokeWidth = active ? 2.4 : 1.6;
          
          return (
            <g key={idx}>
              <line 
                x1={start.x} y1={start.y} x2={end.x} y2={end.y} 
                stroke={color} 
                strokeWidth={strokeWidth}
                markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow-regular)'}
                opacity={0.8}
              />
              <g filter="url(#label-bg)">
                <text 
                  x={mid.x} y={mid.y - 6} 
                  fontSize={13} 
                  fontWeight={500}
                  textAnchor="middle" 
                  fill={active ? '#1d4ed8' : '#333'}
                  pointerEvents="none"
                >
                  {e.symbol}
                </text>
              </g>
            </g>
          );
        })}

        {/* Self-loops */}
        {selfLoops.map((e, idx) => {
          const pos = coords[e.from];
          if (!pos) return null;
          const loopR = radius + 30;
          const active = edgeActive(e);
          const color = active ? '#1d4ed8' : '#666';
          return (
            <g key={`self-${idx}`}>
              <path 
                d={`M ${pos.x} ${pos.y - radius} Q ${pos.x + loopR} ${pos.y - loopR} ${pos.x + radius} ${pos.y - radius}`}
                fill="none"
                stroke={color}
                strokeWidth={active ? 2.4 : 1.6}
                markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow-regular)'}
                opacity={0.8}
              />
              <g filter="url(#label-bg)">
                <text 
                  x={pos.x + loopR - 5} 
                  y={pos.y - loopR - 10} 
                  fontSize={13} 
                  fontWeight={500}
                  textAnchor="middle" 
                  fill={active ? '#1d4ed8' : '#333'}
                  pointerEvents="none"
                >
                  {e.symbol}
                </text>
              </g>
            </g>
          );
        })}

        {/* Start arrow */}
        {automaton.start && coords[automaton.start] && (
          <g>
            <line
              x1={30}
              y1={30}
              x2={coords[automaton.start].x - radius - 4}
              y2={coords[automaton.start].y - radius - 4}
              stroke="#333"
              strokeWidth={2}
              markerEnd="url(#arrow-regular)"
            />
            <text x={15} y={18} fontSize={12} fill="#333" fontWeight={600}>start</text>
          </g>
        )}

        {/* States */}
        {automaton.states.map((s) => {
          const { x, y } = coords[s];
          const active = isActive(s);
          const isFinal = automaton.finals.includes(s);
          const isStart = automaton.start === s;
          
          return (
            <g key={s}>
              {/* Outer glow for dragging */}
              {dragging === s && (
                <circle cx={x} cy={y} r={radius + 8} fill="none" stroke="#3b82f6" strokeWidth={2} opacity={0.3} />
              )}
              
              {/* Main circle */}
              <circle 
                cx={x} 
                cy={y} 
                r={radius} 
                fill={active ? '#2563eb' : isStart ? '#3b82f6' : '#ffffff'} 
                stroke={active ? '#1d4ed8' : isStart ? '#1d4ed8' : '#666'} 
                strokeWidth={active ? 3 : isStart ? 2.5 : 2}
                style={{ cursor: 'grab' }}
                onMouseDown={handleMouseDown(s)}
              />
              
              {/* Outer circle for final states */}
              {isFinal && (
                <circle 
                  cx={x} 
                  cy={y} 
                  r={radius - 8} 
                  fill="none" 
                  stroke={active ? '#e0ecff' : '#999'} 
                  strokeWidth={2}
                />
              )}
              
              {/* State label */}
              <text 
                x={x} 
                y={y + 6} 
                fontSize={16} 
                fontWeight={600}
                textAnchor="middle" 
                fill={active ? '#fff' : '#1f2937'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {s}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ExplanationPanel({ automaton, result, issues }: { automaton: Automaton | null; result: SimulationResult | null; issues: { type: string; message: string }[] }) {
  if (!automaton) return <div style={{ ...baseStyles.card, color: '#6b7280' }}>✋ Validate or run a machine to see explanations.</div>;

  const lines: string[] = [];
  if (issues.length) {
    lines.push(`Blocked by validation issue: ${issues[0].message}`);
  } else if (!result) {
    lines.push('No run yet. Enter an input string and press Run.');
  } else if (result.accepted) {
    lines.push(`Accepted because a final state is reached after consuming the full input. Final set: ${result.finalStates.join(', ') || '∅'}.`);
    const last = result.steps[result.steps.length - 1];
    if (last) lines.push(`Last step consumed '${last.symbol ?? 'ε'}' and moved to {${last.to.join(', ') || '∅'}}.`);
  } else {
    if (result.issues.length) {
      lines.push(`Rejected because: ${result.issues[0].message}`);
    } else {
      lines.push(`Rejected because no final state is active at end. Active: {${result.finalStates.join(', ') || '∅'}}; finals: {${automaton.finals.join(', ') || '∅'}}.`);
    }
  }

  const complexity = automaton ? simulationComplexity(automaton) : null;

  return (
    <div style={{ ...baseStyles.card, background: 'linear-gradient(135deg, #06b6d4 10%, #0891b2 50%, #0e7490 100%)' }}>
      <div style={{ fontWeight: 600, marginBottom: 12, fontSize: '18px', color: '#ffffff' }}>💡 Explanation & Complexity</div>
      <ul style={{ marginTop: 8, paddingLeft: 18, color: '#ffffff', listStyle: 'none' }}>
        {lines.map((l, i) => (
          <li key={i} style={{ marginBottom: 8, paddingLeft: 24, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0 }}>→</span>
            {l}
          </li>
        ))}
      </ul>
      {complexity && (
        <div style={{ marginTop: 16, background: '#ffffff', padding: '12px', borderRadius: 8, color: '#374151' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#0e7490' }}>⚡ Complexity Analysis</div>
          <div style={{ marginBottom: 4 }}>⏱️ <strong>Time:</strong> {complexity.time}</div>
          <div style={{ marginBottom: 4 }}>💾 <strong>Space:</strong> {complexity.space}</div>
          {complexity.note && <div>📝 <strong>Note:</strong> {complexity.note}</div>}
        </div>
      )}
    </div>
  );
}

function Controls({
  kind,
  setKind,
  form,
  setForm,
  input,
  setInput,
  onValidate,
  onRun,
  onReset,
}: {
  kind: MachineKind;
  setKind: (k: MachineKind) => void;
  form: FormDefinition;
  setForm: (f: FormDefinition) => void;
  input: string;
  setInput: (s: string) => void;
  onValidate: () => void;
  onRun: () => void;
  onReset: () => void;
}) {
  const setField = (key: keyof FormDefinition, value: string) => setForm({ ...form, [key]: value });

  return (
    <div style={{ ...baseStyles.card, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: '0 0 8px 0', color: '#667eea' }}>🎮 Machine Editor</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(['dfa', 'nfa'] as MachineKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            style={{
              padding: '12px 20px',
              borderRadius: 10,
              border: 'none',
              background: kind === k ? `linear-gradient(135deg, ${colors.sim} 0%, ${colors.convert} 100%)` : '#e5e7eb',
              color: kind === k ? '#fff' : '#374151',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: kind === k ? `0 4px 15px ${colors.sim}40` : 'none',
            }}
            onMouseEnter={(e) => {
              if (kind === k) (e.currentTarget as any).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as any).style.transform = 'translateY(0)';
            }}
          >
            {k === 'dfa' ? '🏛️' : '🌀'} {k.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', color: '#374151', fontWeight: 500 }}>
          States (comma-separated)
          <input
            style={{ 
              width: '100%', 
              marginTop: 6,
              padding: '10px 12px',
              border: '2px solid #e5e7eb',
              borderRadius: 8,
              fontSize: '14px',
              fontFamily: 'menospace',
              transition: 'border-color 0.3s ease',
            }}
            value={form.states}
            onChange={(e) => setField('states', e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.sim)}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', color: '#374151', fontWeight: 500 }}>
          Alphabet (comma-separated; use eps/epsilon for ε)
          <input
            style={{ 
              width: '100%', 
              marginTop: 6,
              padding: '10px 12px',
              border: '2px solid #e5e7eb',
              borderRadius: 8,
              fontSize: '14px',
              fontFamily: 'monospace',
              transition: 'border-color 0.3s ease',
            }}
            value={form.alphabet}
            onChange={(e) => setField('alphabet', e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.sim)}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', color: '#374151', fontWeight: 500 }}>
          Start state
          <input 
            style={{ 
              width: '100%', 
              marginTop: 6,
              padding: '10px 12px',
              border: '2px solid #e5e7eb',
              borderRadius: 8,
              fontSize: '14px',
              fontFamily: 'monospace',
              transition: 'border-color 0.3s ease',
            }} 
            value={form.start} 
            onChange={(e) => setField('start', e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.sim)}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', color: '#374151', fontWeight: 500 }}>
          Final states (comma-separated)
          <input
            style={{ 
              width: '100%', 
              marginTop: 6,
              padding: '10px 12px',
              border: '2px solid #e5e7eb',
              borderRadius: 8,
              fontSize: '14px',
              fontFamily: 'monospace',
              transition: 'border-color 0.3s ease',
            }}
            value={form.finals}
            onChange={(e) => setField('finals', e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.sim)}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', color: '#374151', fontWeight: 500 }}>
          Transitions (from,symbol-&gt;to1|to2). Use eps/epsilon for ε.
          <textarea
            style={{ 
              width: '100%', 
              marginTop: 6,
              minHeight: 120,
              padding: '10px 12px',
              border: '2px solid #e5e7eb',
              borderRadius: 8,
              fontSize: '14px',
              fontFamily: 'monospace',
              resize: 'vertical',
              transition: 'border-color 0.3s ease',
            }}
            value={form.transitions}
            onChange={(e) => setField('transitions', e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.sim)}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button 
          onClick={onValidate}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: `linear-gradient(135deg, ${colors.sim} 0%, #3b82f6 100%)`,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: `0 4px 12px ${colors.sim}40`,
          }}
          onMouseEnter={(e) => ((e.currentTarget as any).style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => ((e.currentTarget as any).style.transform = 'translateY(0)')}
        >
          ✓ Validate
        </button>
        <button
          onClick={onRun}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: `linear-gradient(135deg, ${colors.minimize} 0%, #059669 100%)`,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: `0 4px 12px ${colors.minimize}40`,
          }}
          onMouseEnter={(e) => ((e.currentTarget as any).style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => ((e.currentTarget as any).style.transform = 'translateY(0)')}
        >
          ▶️ Run string
        </button>
        <button
          onClick={onReset}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#e5e7eb',
            color: '#374151',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => ((e.currentTarget as any).style.background = '#d1d5db')}
          onMouseLeave={(e) => ((e.currentTarget as any).style.background = '#e5e7eb')}
        >
          🔄 Reset
        </button>
        <button
          onClick={() => setForm(presets[kind][0])}
          style={{ 
            marginLeft: 'auto',
            padding: '10px 16px',
            borderRadius: 8,
            border: '2px dashed #9ca3af',
            background: '#fff',
            color: '#6b7280',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as any).style.borderColor = colors.sim;
            (e.currentTarget as any).style.color = colors.sim;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as any).style.borderColor = '#9ca3af';
            (e.currentTarget as any).style.color = '#6b7280';
          }}
        >
          📋 Load example
        </button>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', color: '#374151', fontWeight: 500, marginTop: 8 }}>
        Input string
        <input 
          style={{ 
            width: '100%',
            marginTop: 6,
            padding: '10px 12px',
            border: '2px solid #e5e7eb',
            borderRadius: 8,
            fontSize: '14px',
            fontFamily: 'monospace',
            transition: 'border-color 0.3s ease',
          }} 
          value={input} 
          onChange={(e) => setInput(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = colors.minimize)}
          onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
        />
      </label>
    </div>
  );
}

function RegexPanel({
  regexInput,
  setRegexInput,
  regexNFA,
  regexIssues,
  regexDFA,
  regexAsString,
  onBuild,
}: {
  regexInput: string;
  setRegexInput: (s: string) => void;
  regexNFA: Automaton | null;
  regexIssues: { type: string; message: string }[];
  regexDFA: Automaton | null;
  regexAsString: string | null;
  onBuild: () => void;
}) {
  return (
    <div style={{ ...baseStyles.card }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>Regex ↔ Automata</div>
        <input
          style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }}
          value={regexInput}
          onChange={(e) => setRegexInput(e.target.value)}
          placeholder="e.g., (0|1)*01"
        />
        <button onClick={onBuild}>Regex → NFA/DFA</button>
      </div>
      <Issues issues={regexIssues} />
      {regexNFA && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Regex NFA</div>
          <MachineTable automaton={regexNFA} />
        </div>
      )}
      {regexDFA && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Converted DFA</div>
          <MachineTable automaton={regexDFA} />
        </div>
      )}
      {regexAsString && (
        <div style={{ marginTop: 8 }}>NFA/DFA → Regex (state elimination): {regexAsString}</div>
      )}
    </div>
  );
}

function PromptPanel({
  promptInput,
  setPromptInput,
  promptResult,
  onGenerate,
  onLoadAutomaton,
}: {
  promptInput: string;
  setPromptInput: (s: string) => void;
  promptResult: PromptBuildResult | null;
  onGenerate: (useLLM: boolean, config: LLMConfig) => Promise<void>;
  onLoadAutomaton: (machine: Automaton) => void;
}) {
  const [useLLM, setUseLLM] = useState(true); // Always use LLM by default
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const machine = promptResult?.machine;
  const isPDA = machine?.kind === 'pda';
  const pdaRows = isPDA ? pdaToTable(machine as PushdownAutomaton) : [];

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const config: LLMConfig = {
        provider: 'groq',
        apiKey: apiKey,
      };
      await onGenerate(true, config);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...baseStyles.card, background: 'linear-gradient(135deg, #8b5cf6 10%, #6d28d9 50%, #7c3aed 100%)' }}>
      <div style={{ fontWeight: 600, marginBottom: 12, fontSize: '18px', color: '#ffffff' }}>
        ✨ AI Prompt Generator <span style={{ fontSize: '13px', fontWeight: 400, color: '#d8b4fe' }}>Powered by Groq ⚡</span>
      </div>

      {/* API Key Input */}
      <div style={{ 
        background: 'rgba(255,255,255,0.1)',
        padding: '12px',
        borderRadius: 10,
        marginBottom: 12,
        backdropFilter: 'blur(10px)',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', color: '#e9d5ff', fontWeight: 500, marginBottom: 8 }}>
          Groq API Key <span style={{ fontSize: '11px', fontWeight: 400, color: '#d8b4fe' }}>
            (Get yours at <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" style={{ color: '#fbbf24', textDecoration: 'underline' }}>console.groq.com</a>)
          </span>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_..."
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                border: '2px solid rgba(255,255,255,0.3)',
                background: 'rgba(255,255,255,0.95)',
                color: '#374151',
                fontSize: '13px',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'rgba(255,255,255,0.2)',
                color: '#e9d5ff',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {showApiKey ? '👁️' : '🔒'}
            </button>
          </div>
        </label>
      </div>

      <textarea
        style={{ 
          width: '100%', 
          minHeight: 120,
          padding: '12px',
          borderRadius: 10,
          border: '2px solid #c4b5fd',
          fontSize: '14px',
          fontFamily: 'monospace',
          background: '#faf8ff',
          color: '#374151',
          resize: 'vertical',
        }}
        value={promptInput}
        onChange={(e) => setPromptInput(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#a78bfa')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#c4b5fd')}
        disabled={loading}
        placeholder="Describe your automaton in natural language:
Examples:
• 'student assessment platform'
• 'drone flight instructions'
• 'car navigation system'
• 'text filtering system'
• 'binary monitoring mod 4'
• Any custom DFA/NFA description!"
      />
      
      <div style={{ marginTop: 10, padding: '12px', background: '#f3e8ff', borderRadius: 8, fontSize: '13px', color: '#5b21b6', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '16px' }}>🚀</span>
        <span><strong>Powered by Groq:</strong> Fast, intelligent AI parsing of automata descriptions</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button 
          onClick={handleGenerate}
          disabled={loading || !apiKey.trim()}
          style={{
            padding: '14px 28px',
            borderRadius: 10,
            border: 'none',
            background: (loading || !apiKey.trim()) ? '#d8b4fe' : '#ffffff',
            color: '#7c3aed',
            fontWeight: 600,
            fontSize: '16px',
            cursor: (loading || !apiKey.trim()) ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
            opacity: (loading || !apiKey.trim()) ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!loading && apiKey.trim()) {
              ((e.currentTarget as any).style.transform = 'translateY(-2px)');
              ((e.currentTarget as any).style.boxShadow = '0 6px 20px rgba(124, 58, 237, 0.3)');
            }
          }}
          onMouseLeave={(e) => {
            ((e.currentTarget as any).style.transform = 'translateY(0)');
            ((e.currentTarget as any).style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)');
          }}
        >
          {loading ? '⏳ Generating...' : '🚀 Generate Automaton'}
        </button>
        
        {machine && machine.kind !== 'pda' && (
          <button 
            onClick={() => onLoadAutomaton(machine)}
            disabled={loading}
            style={{
              padding: '14px 28px',
              borderRadius: 10,
              border: 'none',
              background: '#fbbf24',
              color: '#78350f',
              fontWeight: 600,
              fontSize: '16px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              opacity: loading ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!loading) ((e.currentTarget as any).style.transform = 'translateY(-2px)');
            }}
            onMouseLeave={(e) => ((e.currentTarget as any).style.transform = 'translateY(0)')}
          >
            📥 Load into Simulator
          </button>
        )}
      </div>

      {promptResult && (
        <div style={{ marginTop: 16, background: '#ffffff', padding: '16px', borderRadius: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#374151' }}>
            Detected: <span style={{ color: '#7c3aed', fontSize: '16px' }}>{promptResult.inferredKind?.toUpperCase() || 'UNKNOWN'}</span>
          </div>
          {promptResult.assumptions.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: '#475569' }}>
              {promptResult.assumptions.map((item, index) => (
                <li key={index} style={{ marginBottom: 4 }}>💡 {item}</li>
              ))}
            </ul>
          )}
          <Issues issues={promptResult.issues} />

          {machine && machine.kind !== 'pda' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8, color: '#374151' }}>
                <strong>Start:</strong> {machine.start} | <strong>Finals:</strong> {machine.finals.join(', ') || '∅'}
              </div>
              <MachineTable automaton={machine} />
            </div>
          )}

          {isPDA && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8, color: '#374151' }}>
                <strong>Start:</strong> {(machine as PushdownAutomaton).start} | 
                <strong> Stack:</strong> {(machine as PushdownAutomaton).startStack} | 
                <strong> Finals:</strong> {(machine as PushdownAutomaton).finals.join(', ') || '∅'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#8b5cf6', color: 'white' }}>
                    <th style={{ textAlign: 'left', padding: '10px', borderRadius: '6px 0 0 0' }}>From</th>
                    <th style={{ textAlign: 'left', padding: '10px' }}>Input</th>
                    <th style={{ textAlign: 'left', padding: '10px' }}>Stack Top</th>
                    <th style={{ textAlign: 'left', padding: '10px' }}>To</th>
                    <th style={{ textAlign: 'left', padding: '10px', borderRadius: '0 6px 0 0' }}>Push</th>
                  </tr>
                </thead>
                <tbody>
                  {pdaRows.map((r, idx) => (
                    <tr key={idx} style={{ background: idx % 2 === 0 ? '#f9fafb' : '#ffffff', borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px' }}>{r.from}</td>
                      <td style={{ padding: '10px', fontFamily: 'monospace' }}>{r.input}</td>
                      <td style={{ padding: '10px', fontFamily: 'monospace' }}>{r.stackTop}</td>
                      <td style={{ padding: '10px' }}>{r.to}</td>
                      <td style={{ padding: '10px', fontFamily: 'monospace' }}>{r.push}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [kind, setKind] = useState<MachineKind>('dfa');
  const { form, setForm } = useFormState(kind);
  const [panel, setPanel] = useState<Panel>('sim');
  const [input, setInput] = useState('101');
  const [parsed, setParsed] = useState<Automaton | null>(() => {
    const { automaton } = parseForm('dfa', presets.dfa[0]);
    return automaton;
  });
  const [issues, setIssues] = useState<{ type: string; message: string }[]>([]);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const [regexInput, setRegexInput] = useState('(0|1)*01');
  const [regexNFA, setRegexNFA] = useState<Automaton | null>(null);
  const [regexIssues, setRegexIssues] = useState<{ type: string; message: string }[]>([]);

  const [promptInput, setPromptInput] = useState('student assessment platform');
  const [promptResult, setPromptResult] = useState<PromptBuildResult | null>(null);

  const handleValidate = () => {
    const { automaton, issues: found } = parseForm(kind, form);
    setParsed(automaton);
    setIssues(found);
  };

  const handleRun = () => {
    const { automaton, issues: found } = parseForm(kind, form);
    setParsed(automaton);
    setIssues(found);
    if (automaton) {
      const sim = simulate(automaton, input);
      setResult(sim);
      setPanel('sim');
    }
  };

  const handleReset = () => {
    setResult(null);
    setIssues([]);
  };

  const converted = useMemo(() => {
    if (parsed && parsed.kind === 'nfa') return subsetConstruction(parsed);
    return null;
  }, [parsed]);

  const minimized = useMemo(() => {
    if (parsed && parsed.kind === 'dfa') return minimizeDFA(parsed);
    return null;
  }, [parsed]);

  const regexDFA = useMemo(() => (regexNFA ? subsetConstruction(regexNFA) : null), [regexNFA]);
  const regexAsString = useMemo(() => (regexNFA ? nfaToRegex(regexNFA) : null), [regexNFA]);
  const parsedRegexString = useMemo(() => (parsed ? nfaToRegex(parsed) : null), [parsed]);

  const handleRegexBuild = () => {
    const { automaton, issues: found } = regexToNFA(regexInput);
    setRegexNFA(automaton);
    setRegexIssues(found);
  };

  const handlePromptGenerate = async (useLLM: boolean, config: LLMConfig) => {
    if (useLLM) {
      // Use LLM to generate automaton
      const { automaton, error } = await generateFromLLM(promptInput, config);
      
      if (error) {
        setPromptResult({
          machine: null,
          inferredKind: null,
          assumptions: [],
          issues: [{ type: 'error', message: error }],
        });
        return;
      }

      if (automaton) {
        // Convert LLM response to Automaton and validate
        const machine: Automaton = {
          kind: automaton.kind,
          states: automaton.states,
          alphabet: automaton.alphabet,
          start: automaton.start,
          finals: automaton.finals,
          transitions: automaton.transitions,
        };
        
        const validation = validateAutomaton(machine);
        const assumptions = [`Generated using ${config.provider.toUpperCase()} LLM`];
        
        setPromptResult({
          machine,
          inferredKind: automaton.kind,
          assumptions,
          issues: validation,
        });
      }
    } else {
      // Use hardcoded pattern matching
      const generated = generateFromPrompt(promptInput);
      setPromptResult(generated);
    }
  };

  const handleLoadGeneratedMachine = (machine: Automaton) => {
    setKind(machine.kind);
    setForm({
      states: machine.states.join(','),
      alphabet: machine.alphabet.join(','),
      start: machine.start,
      finals: machine.finals.join(','),
      transitions: toTable(machine)
        .map((r) => `${r.from},${r.symbol}->${r.to.join('|')}`)
        .join('\n'),
    });
    setParsed(machine);
    setIssues(validateAutomaton(machine));
    setResult(null);
    setPanel('sim');
  };

  const lastStep = result?.steps[result.steps.length - 1];
  const activeStates = lastStep ? lastStep.to : parsed ? [parsed.start] : [];
  const focusFrom = lastStep ? lastStep.from : [];
  const focusTo = lastStep ? lastStep.to : [];

  return (
    <div style={{ ...baseStyles.page, padding: '40px 24px' }}>
      <div style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%)',
        padding: '30px',
        borderRadius: 20,
        marginBottom: 30,
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
      }}>
        <h1 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '2.5em' }}>
          🤖 Automata Playground
        </h1>
        <p style={{ margin: 0, color: '#6b7280', maxWidth: 1200, lineHeight: '1.6' }}>
          Create, simulate, and visualize DFA • NFA • PDA. Convert between regex and automata. Use the <strong>prompt</strong> tab to generate machines from natural language.
        </p>
      </div>

      <div style={{ ...baseStyles.row, gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <Controls
          kind={kind}
          setKind={setKind}
          form={form}
          setForm={setForm}
          input={input}
          setInput={setInput}
          onValidate={handleValidate}
          onRun={handleRun}
          onReset={handleReset}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...baseStyles.card }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', borderBottom: '2px solid #e5e7eb', paddingBottom: 12 }}>
              {(['sim', 'convert', 'minimize', 'regex', 'viz', 'explain', 'prompt'] as Panel[]).map((p) => {
                const panelLabel = {
                  sim: '👁️ Simulate',
                  convert: '🔄 Convert',
                  minimize: '📉 Minimize',
                  regex: '🧮 Regex',
                  viz: '📊 Visualize',
                  explain: '💡 Explain',
                  prompt: '✨ Prompt',
                };
                return (
                  <button
                    key={p}
                    onClick={() => setPanel(p)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 10,
                      border: 'none',
                      background: panel === p ? `linear-gradient(135deg, ${(colors as any)[p]} 0%, ${(colors as any)[p]}dd 100%)` : '#f3f4f6',
                      color: panel === p ? '#fff' : '#6b7280',
                      fontWeight: panel === p ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      boxShadow: panel === p ? `0 4px 12px ${(colors as any)[p]}40` : 'none',
                      transform: panel === p ? 'scale(1.05)' : 'scale(1)',
                    }}
                    onMouseEnter={(e) => {
                      if (panel !== p) {
                        (e.currentTarget as any).style.background = '#e5e7eb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (panel !== p) {
                        (e.currentTarget as any).style.background = '#f3f4f6';
                      }
                    }}
                  >
                    {panelLabel[p]}
                  </button>
                );
              })}
            </div>

            {panel === 'sim' && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Validation</div>
                <Issues issues={issues} />
                {parsed && (
                  <div style={{ marginTop: 10 }}>
                    <div>
                      Start: {parsed.start} | Finals: {parsed.finals.join(', ') || '∅'}
                    </div>
                    <MachineTable automaton={parsed} />
                  </div>
                )}
                <Trace result={result} />
              </div>
            )}

            {panel === 'convert' && (
              <div>
                <div style={{ marginBottom: 6 }}>Subset construction of current NFA (requires NFA).</div>
                {!converted && <div style={{ color: '#b30000' }}>Load/validate an NFA to view conversion.</div>}
                {converted && (
                  <div>
                    <div>Start: {converted.start}</div>
                    <div>Finals: {converted.finals.join(', ') || '∅'}</div>
                    <MachineTable automaton={converted} />
                  </div>
                )}
                {parsed && <div style={{ marginTop: 8 }}>Current automaton → regex: {parsedRegexString}</div>}
              </div>
            )}

            {panel === 'minimize' && (
              <div>
                <div style={{ marginBottom: 6 }}>Hopcroft-style DFA minimization.</div>
                {!minimized && <div style={{ color: '#b30000' }}>Load/validate a DFA to view minimization.</div>}
                {minimized && (
                  <div>
                    <div>Start: {minimized.start}</div>
                    <div>Finals: {minimized.finals.join(', ') || '∅'}</div>
                    <MachineTable automaton={minimized} />
                  </div>
                )}
              </div>
            )}

            {panel === 'regex' && (
              <RegexPanel
                regexInput={regexInput}
                setRegexInput={setRegexInput}
                regexNFA={regexNFA}
                regexIssues={regexIssues}
                regexDFA={regexDFA}
                regexAsString={regexAsString}
                onBuild={handleRegexBuild}
              />
            )}

            {panel === 'prompt' && (
              <PromptPanel
                promptInput={promptInput}
                setPromptInput={setPromptInput}
                promptResult={promptResult}
                onGenerate={handlePromptGenerate}
                onLoadAutomaton={handleLoadGeneratedMachine}
              />
            )}

            {panel === 'viz' && (
              <div style={{ display: 'grid', gap: 16 }}>
                {!parsed ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', background: '#f3f4f6', borderRadius: 12, color: '#6b7280' }}>
                    <div style={{ fontSize: '48px', marginBottom: 12 }}>📊</div>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>No machine loaded</div>
                    <div style={{ fontSize: '14px' }}>Click Validate or Run string to visualize.</div>
                  </div>
                ) : (
                  <>
                    <GraphView automaton={parsed} activeStates={activeStates} focusFrom={focusFrom} focusTo={focusTo} title="Current automaton" />
                    {converted && <GraphView automaton={converted} title="NFA → DFA" activeStates={[]} />}
                    {minimized && <GraphView automaton={minimized} title="Minimized DFA" activeStates={[]} />}
                  </>
                )}
              </div>
            )}

            {panel === 'explain' && <ExplanationPanel automaton={parsed} result={result} issues={issues} />}
          </div>

          <div style={{ 
            ...baseStyles.card, 
            background: 'linear-gradient(135deg, #f59e0b 10%, #d97706 50%, #b45309 100%)',
            color: '#ffffff'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: '16px' }}>📚 Quick Tips & Tricks</div>
            <ul style={{ marginTop: 4, paddingLeft: 22, listStyle: 'none', lineHeight: '1.8' }}>
              <li style={{ marginBottom: 8 }}>💬 <strong>Transitions:</strong> Use <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>from,symbol-&gt;to1|to2</code></li>
              <li style={{ marginBottom: 8 }}>🔤 <strong>Epsilon:</strong> Write <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>eps</code> or <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>epsilon</code> for ε</li>
              <li style={{ marginBottom: 8 }}>🧮 <strong>Regex:</strong> Supports <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>|</code> (union), <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>*</code> (Kleene), <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>( )</code> (grouping)</li>
              <li>🤖 <strong>Prompts:</strong> Try "ends with 01" | "contains 110" | "balanced parentheses" | "a^n b^n"</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
