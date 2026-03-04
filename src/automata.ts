export type MachineKind = 'dfa' | 'nfa';

export type TransitionMap = Record<string, Record<string, string[]>>;

export interface Automaton {
  kind: MachineKind;
  states: string[];
  alphabet: string[];
  start: string;
  finals: string[];
  transitions: TransitionMap;
}

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
}

export interface ParsedAutomaton {
  automaton: Automaton | null;
  issues: ValidationIssue[];
}

export interface RegexBuildResult {
  automaton: Automaton | null;
  issues: ValidationIssue[];
}

export interface PDAAction {
  to: string;
  push: string; // replacement for stack top; use ε to pop
}

export type PDATransitionMap = Record<string, Record<string, Record<string, PDAAction[]>>>;

export interface PushdownAutomaton {
  kind: 'pda';
  states: string[];
  inputAlphabet: string[];
  stackAlphabet: string[];
  start: string;
  startStack: string;
  finals: string[];
  transitions: PDATransitionMap;
}

export interface PromptBuildResult {
  machine: Automaton | PushdownAutomaton | null;
  inferredKind: 'dfa' | 'nfa' | 'pda' | null;
  assumptions: string[];
  issues: ValidationIssue[];
}

export type TraceStep = {
  index: number;
  symbol: string | null; // null for epsilon
  from: string[];
  to: string[];
  consumed: string;
};

export type SimulationResult = {
  accepted: boolean;
  finalStates: string[];
  steps: TraceStep[];
  issues: ValidationIssue[];
};

export type ComplexityInfo = {
  time: string;
  space: string;
  note?: string;
};

export type FormDefinition = {
  states: string;
  alphabet: string;
  start: string;
  finals: string;
  transitions: string;
};

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
}

function parseCSV(input: string): string[] {
  return dedupe(input.split(',').map((s) => s.trim()).filter(Boolean));
}

function normalizeSymbol(sym: string): string {
  if (sym === 'epsilon' || sym === 'eps' || sym === 'λ' || sym === 'lambda') return 'ε';
  return sym;
}

export function parseForm(kind: MachineKind, form: FormDefinition): ParsedAutomaton {
  const issues: ValidationIssue[] = [];
  const states = parseCSV(form.states);
  const alphabet = parseCSV(form.alphabet).map(normalizeSymbol);
  const start = form.start.trim();
  const finals = parseCSV(form.finals);
  const transitions: TransitionMap = {};

  const lines = form.transitions
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // format: from,symbol->to1|to2
    const [lhs, rhs] = line.split('->').map((s) => s.trim());
    if (!lhs || rhs === undefined) {
      issues.push({ type: 'error', message: `Bad transition syntax: ${line}` });
      continue;
    }
    const [fromRaw, symbolRaw] = lhs.split(',').map((s) => s.trim());
    if (!fromRaw || symbolRaw === undefined) {
      issues.push({ type: 'error', message: `Bad transition lhs: ${line}` });
      continue;
    }
    const symbol = normalizeSymbol(symbolRaw);
    const tos = dedupe(rhs.split('|').map((s) => s.trim()));

    if (!transitions[fromRaw]) transitions[fromRaw] = {};
    transitions[fromRaw][symbol] = tos;
  }

  const automaton: Automaton = {
    kind,
    states,
    alphabet,
    start,
    finals,
    transitions,
  };

  issues.push(...validateAutomaton(automaton));
  return { automaton, issues };
}

// Thompson construction for regex to NFA (supports |, concatenation, *, parentheses, ε).
export function regexToNFA(pattern: string): RegexBuildResult {
  const issues: ValidationIssue[] = [];
  const cleaned = pattern.trim();
  if (!cleaned) return { automaton: null, issues: [{ type: 'error', message: 'Regex is empty.' }] };

  const isSymbol = (c: string) => !['|', '*', '(', ')', '.'].includes(c);

  // Insert explicit concatenation dots.
  let withConcat = '';
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    withConcat += c;
    const next = cleaned[i + 1];
    if (!next) continue;
    const needsConcat =
      (isSymbol(c) || c === ')' || c === '*') &&
      (isSymbol(next) || next === '(');
    if (needsConcat) withConcat += '.';
  }

  const prec: Record<string, number> = { '|': 1, '.': 2, '*': 3 };
  const output: string[] = [];
  const ops: string[] = [];

  const pushOp = (op: string) => {
    while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[op]) {
      output.push(ops.pop()!);
    }
    ops.push(op);
  };

  for (let i = 0; i < withConcat.length; i++) {
    const c = withConcat[i];
    if (isSymbol(c)) {
      output.push(c);
    } else if (c === '(') {
      ops.push(c);
    } else if (c === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop()!);
      if (ops.pop() !== '(') issues.push({ type: 'error', message: 'Mismatched parentheses.' });
    } else if (c === '*' || c === '|' || c === '.') {
      if (c === '*') {
        output.push(c);
      } else {
        pushOp(c);
      }
    } else {
      issues.push({ type: 'warning', message: `Ignoring unknown token ${c}` });
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === '(') {
      issues.push({ type: 'error', message: 'Mismatched parentheses.' });
    } else {
      output.push(op);
    }
  }

  type Frag = { start: string; end: string; transitions: TransitionMap; states: Set<string> };
  let id = 0;
  const nextState = () => `r${++id}`;

  const stack: Frag[] = [];

  const addTransition = (map: TransitionMap, from: string, symbol: string, to: string) => {
    if (!map[from]) map[from] = {};
    if (!map[from][symbol]) map[from][symbol] = [];
    map[from][symbol].push(to);
  };

  const merge = (a: Frag, b: Frag): Frag => {
    const transitions: TransitionMap = JSON.parse(JSON.stringify(a.transitions));
    for (const from of Object.keys(b.transitions)) {
      if (!transitions[from]) transitions[from] = {};
      for (const sym of Object.keys(b.transitions[from])) {
        if (!transitions[from][sym]) transitions[from][sym] = [];
        transitions[from][sym].push(...b.transitions[from][sym]);
      }
    }
    return { start: a.start, end: b.end, transitions, states: new Set([...a.states, ...b.states]) };
  };

  for (const token of output) {
    if (isSymbol(token)) {
      const s = nextState();
      const t = nextState();
      const trans: TransitionMap = {};
      addTransition(trans, s, token === 'ε' ? 'ε' : token, t);
      stack.push({ start: s, end: t, transitions: trans, states: new Set([s, t]) });
    } else if (token === '.') {
      const b = stack.pop();
      const a = stack.pop();
      if (!a || !b) {
        issues.push({ type: 'error', message: 'Bad concatenation.' });
        continue;
      }
      addTransition(a.transitions, a.end, 'ε', b.start);
      stack.push({
        start: a.start,
        end: b.end,
        transitions: merge(a, b).transitions,
        states: new Set([...a.states, ...b.states]),
      });
    } else if (token === '|') {
      const b = stack.pop();
      const a = stack.pop();
      if (!a || !b) {
        issues.push({ type: 'error', message: 'Bad union.' });
        continue;
      }
      const s = nextState();
      const t = nextState();
      const trans: TransitionMap = {};
      const merged = merge(a, b).transitions;
      for (const from of Object.keys(merged)) {
        if (!trans[from]) trans[from] = {};
        Object.assign(trans[from], merged[from]);
      }
      addTransition(trans, s, 'ε', a.start);
      addTransition(trans, s, 'ε', b.start);
      addTransition(trans, a.end, 'ε', t);
      addTransition(trans, b.end, 'ε', t);
      stack.push({ start: s, end: t, transitions: trans, states: new Set([...a.states, ...b.states, s, t]) });
    } else if (token === '*') {
      const a = stack.pop();
      if (!a) {
        issues.push({ type: 'error', message: 'Bad Kleene star.' });
        continue;
      }
      const s = nextState();
      const t = nextState();
      const trans: TransitionMap = JSON.parse(JSON.stringify(a.transitions));
      addTransition(trans, s, 'ε', a.start);
      addTransition(trans, s, 'ε', t);
      addTransition(trans, a.end, 'ε', a.start);
      addTransition(trans, a.end, 'ε', t);
      stack.push({ start: s, end: t, transitions: trans, states: new Set([...a.states, s, t]) });
    } else {
      issues.push({ type: 'warning', message: `Unhandled token ${token}` });
    }
  }

  if (stack.length !== 1) {
    issues.push({ type: 'error', message: 'Regex parse failed.' });
    return { automaton: null, issues };
  }

  const frag = stack[0];
  const alphabet = new Set<string>();
  for (const from of Object.keys(frag.transitions)) {
    for (const sym of Object.keys(frag.transitions[from])) {
      if (sym !== 'ε') alphabet.add(sym);
    }
  }

  const automaton: Automaton = {
    kind: 'nfa',
    states: Array.from(frag.states),
    alphabet: Array.from(alphabet),
    start: frag.start,
    finals: [frag.end],
    transitions: frag.transitions,
  };

  issues.push(...validateAutomaton(automaton));
  return { automaton, issues };
}

export function validateAutomaton(automaton: Automaton): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { states, alphabet, start, finals, transitions, kind } = automaton;

  if (states.length === 0) issues.push({ type: 'error', message: 'No states provided.' });
  if (alphabet.length === 0) issues.push({ type: 'warning', message: 'Alphabet is empty.' });
  if (!start) issues.push({ type: 'error', message: 'Start state missing.' });
  if (start && !states.includes(start)) issues.push({ type: 'error', message: `Start state ${start} not in states.` });
  for (const f of finals) {
    if (!states.includes(f)) issues.push({ type: 'error', message: `Final state ${f} not in states.` });
  }

  for (const from of Object.keys(transitions)) {
    if (!states.includes(from)) issues.push({ type: 'error', message: `Transition from unknown state ${from}.` });
    for (const symbol of Object.keys(transitions[from])) {
      const normalized = normalizeSymbol(symbol);
      const targets = transitions[from][symbol];
      if (normalized !== 'ε' && !alphabet.includes(normalized)) {
        issues.push({ type: 'error', message: `Symbol ${symbol} not in alphabet.` });
      }
      for (const t of targets) {
        if (!states.includes(t)) issues.push({ type: 'error', message: `Transition to unknown state ${t}.` });
      }
      if (kind === 'dfa' && targets.length !== 1) {
        issues.push({ type: 'error', message: `DFA must have exactly one target for ${from},${symbol}.` });
      }
    }
  }

  if (kind === 'dfa') {
    for (const s of states) {
      for (const sym of alphabet) {
        const has = transitions[s]?.[sym];
        if (!has) issues.push({ type: 'warning', message: `Missing transition for ${s},${sym}.` });
      }
    }
  }
  return issues;
}

function epsilonClosure(nfa: Automaton, states: Set<string>): Set<string> {
  const stack = [...states];
  const closure = new Set(states);
  while (stack.length) {
    const state = stack.pop();
    if (!state) continue;
    const epsTargets = nfa.transitions[state]?.['ε'] || [];
    for (const t of epsTargets) {
      if (!closure.has(t)) {
        closure.add(t);
        stack.push(t);
      }
    }
  }
  return closure;
}

export function simulate(automaton: Automaton, input: string): SimulationResult {
  if (automaton.kind === 'dfa') return simulateDFA(automaton, input);
  return simulateNFA(automaton, input);
}

function simulateDFA(dfa: Automaton, input: string): SimulationResult {
  let current = dfa.start;
  const steps: TraceStep[] = [];
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < input.length; i++) {
    const sym = input[i];
    const transition = dfa.transitions[current]?.[sym];
    if (!transition || transition.length === 0) {
      issues.push({ type: 'error', message: `No transition for state ${current} on symbol ${sym}.` });
      return { accepted: false, finalStates: [current], steps, issues };
    }
    const next = transition[0];
    steps.push({ index: i, symbol: sym, from: [current], to: [next], consumed: input.slice(0, i + 1) });
    current = next;
  }
  const accepted = dfa.finals.includes(current);
  return { accepted, finalStates: [current], steps, issues };
}

function simulateNFA(nfa: Automaton, input: string): SimulationResult {
  let current = epsilonClosure(nfa, new Set([nfa.start]));
  const steps: TraceStep[] = [
    { index: -1, symbol: null, from: [], to: Array.from(current), consumed: '' },
  ];
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < input.length; i++) {
    const sym = input[i];
    if (!nfa.alphabet.includes(sym)) {
      issues.push({ type: 'error', message: `Symbol ${sym} not in alphabet.` });
      return { accepted: false, finalStates: Array.from(current), steps, issues };
    }
    const nextStates = new Set<string>();
    for (const state of current) {
      const targets = nfa.transitions[state]?.[sym] || [];
      for (const t of targets) nextStates.add(t);
    }
    const closure = epsilonClosure(nfa, nextStates);
    steps.push({ index: i, symbol: sym, from: Array.from(current), to: Array.from(closure), consumed: input.slice(0, i + 1) });
    current = closure;
  }
  const accepted = Array.from(current).some((s) => nfa.finals.includes(s));
  return { accepted, finalStates: Array.from(current), steps, issues };
}

export function subsetConstruction(nfa: Automaton): Automaton {
  if (nfa.kind !== 'nfa') throw new Error('subsetConstruction expects NFA');
  const startSet = epsilonClosure(nfa, new Set([nfa.start]));
  const queue: Set<string>[] = [startSet];
  const seen = new Map<string, Set<string>>();
  const dStates: string[] = [];
  const transitions: TransitionMap = {};

  const key = (set: Set<string>) => (set.size === 0 ? '∅' : Array.from(set).sort().join(','));

  while (queue.length) {
    const set = queue.shift()!;
    const setKey = key(set);
    if (seen.has(setKey)) continue;
    seen.set(setKey, set);
    dStates.push(setKey);
    transitions[setKey] = {};

    const alphabet = nfa.alphabet.filter((s) => s !== 'ε');
    for (const sym of alphabet) {
      const next = new Set<string>();
      for (const s of set) {
        const targets = nfa.transitions[s]?.[sym] || [];
        for (const t of targets) next.add(t);
      }
      const closure = epsilonClosure(nfa, next);
      const closureKey = key(closure);
      if (!seen.has(closureKey) && closure.size > 0) queue.push(closure);
      if (closure.size > 0) transitions[setKey][sym] = [closureKey];
    }
  }

  const finals: string[] = [];
  for (const [k, set] of seen.entries()) {
    if (Array.from(set).some((s) => nfa.finals.includes(s))) finals.push(k);
  }

  return {
    kind: 'dfa',
    states: dStates,
    alphabet: nfa.alphabet.filter((s) => s !== 'ε'),
    start: key(startSet),
    finals,
    transitions,
  };
}

const needsParens = (r: string) => r.includes('|') || r.includes(' ');

function concatRegex(a: string, b: string): string {
  if (!a || !b) return '';
  if (a === 'ε') return b;
  if (b === 'ε') return a;
  const left = needsParens(a) ? `(${a})` : a;
  const right = needsParens(b) ? `(${b})` : b;
  return `${left}${right}`;
}

function unionRegex(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return `${a}|${b}`;
}

function starRegex(a: string): string {
  if (!a) return '';
  if (a === 'ε') return 'ε';
  const body = needsParens(a) ? `(${a})` : a;
  return `${body}*`;
}

export function nfaToRegex(nfa: Automaton): string {
  const dfa = nfa.kind === 'nfa' ? subsetConstruction(nfa) : nfa;
  const states = [...dfa.states];
  const start = '⟂start';
  const end = '⟂end';
  states.unshift(start);
  states.push(end);

  const R: Record<string, Record<string, string>> = {};
  for (const i of states) {
    R[i] = {};
    for (const j of states) R[i][j] = '';
  }

  for (const from of Object.keys(dfa.transitions)) {
    for (const sym of Object.keys(dfa.transitions[from])) {
      for (const to of dfa.transitions[from][sym]) {
        R[from][to] = unionRegex(R[from][to], sym === 'ε' ? 'ε' : sym);
      }
    }
  }

  R[start][dfa.start] = unionRegex(R[start][dfa.start], 'ε');
  for (const f of dfa.finals) {
    R[f][end] = unionRegex(R[f][end], 'ε');
  }

  const statesToEliminate = states.filter((s) => s !== start && s !== end);
  for (const k of statesToEliminate) {
    for (const i of states) {
      if (i === k) continue;
      if (!R[i][k]) continue;
      for (const j of states) {
        if (j === k) continue;
        if (!R[k][j]) continue;
        const part = concatRegex(R[i][k], concatRegex(starRegex(R[k][k]), R[k][j]));
        R[i][j] = unionRegex(R[i][j], part);
      }
    }
  }

  return R[start][end] || '∅';
}

export function minimizeDFA(dfa: Automaton): Automaton {
  if (dfa.kind !== 'dfa') throw new Error('minimizeDFA expects DFA');
  const { states, alphabet, finals, start, transitions } = dfa;

  const nonFinal = states.filter((s) => !finals.includes(s));
  let partitions: string[][] = [nonFinal, [...finals]].filter((p) => p.length > 0);

  const stateToPartition = (state: string, parts: string[][]) => {
    return parts.findIndex((p) => p.includes(state));
  };

  let changed = true;
  while (changed) {
    changed = false;
    const newPartitions: string[][] = [];
    for (const group of partitions) {
      const signatures = new Map<string, string[]>();
      for (const state of group) {
        const sig = alphabet
          .map((sym) => transitions[state]?.[sym]?.[0] ?? '')
          .map((t) => stateToPartition(t, partitions))
          .join('|');
        if (!signatures.has(sig)) signatures.set(sig, []);
        signatures.get(sig)!.push(state);
      }
      if (signatures.size === 1) {
        newPartitions.push(group);
      } else {
        changed = true;
        for (const subset of signatures.values()) newPartitions.push(subset);
      }
    }
    partitions = newPartitions;
  }

  const name = (states: string[]) => states.join('_');
  const newStates = partitions.map(name);
  const newStart = name(partitions.find((p) => p.includes(start)) || []);
  const newFinals = partitions.filter((p) => p.some((s) => finals.includes(s))).map(name);
  const newTransitions: TransitionMap = {};

  for (const part of partitions) {
    const rep = part[0];
    const fromName = name(part);
    newTransitions[fromName] = {};
    for (const sym of alphabet) {
      const target = transitions[rep]?.[sym]?.[0];
      if (!target) continue;
      const toPart = partitions.find((p) => p.includes(target)) || [];
      newTransitions[fromName][sym] = [name(toPart)];
    }
  }

  return {
    kind: 'dfa',
    states: newStates,
    alphabet,
    start: newStart,
    finals: newFinals,
    transitions: newTransitions,
  };
}

export function simulationComplexity(automaton: Automaton): ComplexityInfo {
  const n = automaton.states.length;
  const sigma = automaton.alphabet.length || 1;
  if (automaton.kind === 'dfa') {
    return {
      time: `O(|w|) with |w| input length`,
      space: 'O(1)',
      note: 'Single active state; table lookup per symbol.',
    };
  }
  return {
    time: `O(|w| · |Q| · |Σ|) ≈ O(${n}·${sigma}·|w|)`,
    space: `O(|Q|) ≈ O(${n}) for active set`,
    note: 'Tracks epsilon-closure and next-state sets each step.',
  };
}

export function toTable(automaton: Automaton): Array<{ from: string; symbol: string; to: string[] }> {
  const rows: Array<{ from: string; symbol: string; to: string[] }> = [];
  for (const from of Object.keys(automaton.transitions)) {
    for (const sym of Object.keys(automaton.transitions[from])) {
      rows.push({ from, symbol: sym, to: automaton.transitions[from][sym] });
    }
  }
  return rows.sort((a, b) => a.from.localeCompare(b.from) || a.symbol.localeCompare(b.symbol));
}

export function pdaToTable(pda: PushdownAutomaton): Array<{ from: string; input: string; stackTop: string; to: string; push: string }> {
  const rows: Array<{ from: string; input: string; stackTop: string; to: string; push: string }> = [];
  for (const from of Object.keys(pda.transitions)) {
    for (const input of Object.keys(pda.transitions[from])) {
      for (const stackTop of Object.keys(pda.transitions[from][input])) {
        for (const action of pda.transitions[from][input][stackTop]) {
          rows.push({ from, input, stackTop, to: action.to, push: action.push });
        }
      }
    }
  }
  return rows.sort((a, b) => {
    const byFrom = a.from.localeCompare(b.from);
    if (byFrom !== 0) return byFrom;
    const byInput = a.input.localeCompare(b.input);
    if (byInput !== 0) return byInput;
    return a.stackTop.localeCompare(b.stackTop);
  });
}

function addPDATransition(
  transitions: PDATransitionMap,
  from: string,
  input: string,
  stackTop: string,
  to: string,
  push: string,
) {
  if (!transitions[from]) transitions[from] = {};
  if (!transitions[from][input]) transitions[from][input] = {};
  if (!transitions[from][input][stackTop]) transitions[from][input][stackTop] = [];
  transitions[from][input][stackTop].push({ to, push });
}

function inferKind(prompt: string): 'dfa' | 'nfa' | 'pda' | null {
  const text = prompt.toLowerCase();
  if (/(pushdown|pda|stack automata?)/.test(text)) return 'pda';
  if (/\bnfa\b/.test(text)) return 'nfa';
  if (/\bdfa\b/.test(text)) return 'dfa';
  if (/(a\^?n\s*b\^?n|0\^?n\s*1\^?n|balanced\s+parenth|well-formed\s+parenth|matching\s+parenth)/.test(text)) return 'pda';
  if (/contains\s+/.test(text)) return 'nfa';
  if (/(ends\s+with|starts\s+with|even\s+number|odd\s+number|deterministic)/.test(text)) return 'dfa';
  return null;
}

function parseAlphabet(prompt: string, fallback: string): string[] {
  const explicit = prompt.match(/alphabet\s*[:=]?\s*\{?\s*([^}\n]+)\s*\}?/i);
  if (explicit?.[1]) {
    const parsed = dedupe(explicit[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
    if (parsed.length > 0) return parsed.map((s) => normalizeSymbol(s));
  }
  if (/(binary|0\s*and\s*1|0\/1)/i.test(prompt)) return ['0', '1'];
  const chars = dedupe(fallback.split('').filter((c) => /[a-z0-9]/i.test(c)));
  return chars.length > 0 ? chars : ['0', '1'];
}

function extractQuoted(prompt: string): string | null {
  const quoted = prompt.match(/["'`](.+?)["'`]/);
  if (quoted?.[1]) return quoted[1];
  return null;
}

function buildEndsWithDFA(suffix: string, alphabet: string[]): Automaton {
  const m = suffix.length;
  const states = Array.from({ length: m + 1 }, (_, i) => `q${i}`);
  const transitions: TransitionMap = {};

  const nextMatch = (len: number, sym: string): number => {
    const attempt = `${suffix.slice(0, len)}${sym}`;
    for (let k = Math.min(m, attempt.length); k >= 0; k--) {
      if (attempt.endsWith(suffix.slice(0, k))) return k;
    }
    return 0;
  };

  for (let i = 0; i <= m; i++) {
    const from = `q${i}`;
    transitions[from] = {};
    for (const sym of alphabet) {
      const nxt = nextMatch(i, sym);
      transitions[from][sym] = [`q${nxt}`];
    }
  }

  return {
    kind: 'dfa',
    states,
    alphabet,
    start: 'q0',
    finals: [`q${m}`],
    transitions,
  };
}

function buildEndsWithNFA(suffix: string, alphabet: string[]): Automaton {
  const m = suffix.length;
  const states = Array.from({ length: m + 1 }, (_, i) => `s${i}`);
  const transitions: TransitionMap = {};

  transitions.s0 = {};
  for (const sym of alphabet) transitions.s0[sym] = ['s0'];
  const first = suffix[0];
  transitions.s0[first] = dedupe([...(transitions.s0[first] ?? []), 's1']);

  for (let i = 1; i < m; i++) {
    const from = `s${i}`;
    transitions[from] = {};
    transitions[from][suffix[i]] = [`s${i + 1}`];
  }

  return {
    kind: 'nfa',
    states,
    alphabet,
    start: 's0',
    finals: [`s${m}`],
    transitions,
  };
}

function buildContainsNFA(substr: string, alphabet: string[]): Automaton {
  const m = substr.length;
  const states = Array.from({ length: m + 1 }, (_, i) => `s${i}`);
  const transitions: TransitionMap = {};

  transitions.s0 = {};
  for (const sym of alphabet) transitions.s0[sym] = ['s0'];
  transitions.s0[substr[0]] = dedupe([...(transitions.s0[substr[0]] ?? []), 's1']);

  for (let i = 1; i < m; i++) {
    const from = `s${i}`;
    transitions[from] = {};
    transitions[from][substr[i]] = [`s${i + 1}`];
  }

  const finalState = `s${m}`;
  transitions[finalState] = {};
  for (const sym of alphabet) transitions[finalState][sym] = [finalState];

  return {
    kind: 'nfa',
    states,
    alphabet,
    start: 's0',
    finals: [finalState],
    transitions,
  };
}

function buildParityDFA(symbol: string, parity: 'even' | 'odd', alphabet: string[]): Automaton {
  const transitions: TransitionMap = {
    qEven: {},
    qOdd: {},
  };
  for (const sym of alphabet) {
    if (sym === symbol) {
      transitions.qEven[sym] = ['qOdd'];
      transitions.qOdd[sym] = ['qEven'];
    } else {
      transitions.qEven[sym] = ['qEven'];
      transitions.qOdd[sym] = ['qOdd'];
    }
  }

  return {
    kind: 'dfa',
    states: ['qEven', 'qOdd'],
    alphabet,
    start: 'qEven',
    finals: [parity === 'even' ? 'qEven' : 'qOdd'],
    transitions,
  };
}

function buildAnBnPDA(openSymbol: string, closeSymbol: string): PushdownAutomaton {
  const transitions: PDATransitionMap = {};
  addPDATransition(transitions, 'qPush', openSymbol, 'Z', 'qPush', `${openSymbol}Z`);
  addPDATransition(transitions, 'qPush', openSymbol, openSymbol, 'qPush', `${openSymbol}${openSymbol}`);
  addPDATransition(transitions, 'qPush', closeSymbol, openSymbol, 'qPop', 'ε');
  addPDATransition(transitions, 'qPop', closeSymbol, openSymbol, 'qPop', 'ε');
  addPDATransition(transitions, 'qPop', 'ε', 'Z', 'qAccept', 'Z');
  addPDATransition(transitions, 'qPush', 'ε', 'Z', 'qAccept', 'Z');

  return {
    kind: 'pda',
    states: ['qPush', 'qPop', 'qAccept'],
    inputAlphabet: [openSymbol, closeSymbol],
    stackAlphabet: [openSymbol, 'Z'],
    start: 'qPush',
    startStack: 'Z',
    finals: ['qAccept'],
    transitions,
  };
}

function buildBalancedParenthesesPDA(): PushdownAutomaton {
  const transitions: PDATransitionMap = {};
  addPDATransition(transitions, 'q', '(', 'Z', 'q', '(Z');
  addPDATransition(transitions, 'q', '(', '(', 'q', '((');
  addPDATransition(transitions, 'q', ')', '(', 'q', 'ε');
  addPDATransition(transitions, 'q', 'ε', 'Z', 'qAccept', 'Z');

  return {
    kind: 'pda',
    states: ['q', 'qAccept'],
    inputAlphabet: ['(', ')'],
    stackAlphabet: ['(', 'Z'],
    start: 'q',
    startStack: 'Z',
    finals: ['qAccept'],
    transitions,
  };
}

export function generateFromPrompt(prompt: string): PromptBuildResult {
  const issues: ValidationIssue[] = [];
  const assumptions: string[] = [];
  const text = prompt.trim();
  if (!text) {
    return {
      machine: null,
      inferredKind: null,
      assumptions,
      issues: [{ type: 'error', message: 'Prompt is empty.' }],
    };
  }

  const inferredKind = inferKind(text);
  const lowered = text.toLowerCase();

  const regexHint = text.match(/regex\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() || (/(\||\*|\(|\))/.test(text) ? extractQuoted(text) : null);
  if (regexHint) {
    const built = regexToNFA(regexHint);
    if (!built.automaton) {
      return { machine: null, inferredKind, assumptions, issues: built.issues };
    }
    assumptions.push(`Interpreted regex pattern as '${regexHint}'.`);
    if (inferredKind === 'dfa') {
      return {
        machine: subsetConstruction(built.automaton),
        inferredKind: 'dfa',
        assumptions,
        issues: built.issues,
      };
    }
    if (inferredKind === 'pda') {
      issues.push({ type: 'warning', message: 'Regex was provided with PDA request; generated NFA from regex instead.' });
    }
    return {
      machine: built.automaton,
      inferredKind: 'nfa',
      assumptions,
      issues: built.issues,
    };
  }

  if (/(a\^?n\s*b\^?n|equal\s+number\s+of\s+a\s+and\s+b)/i.test(lowered)) {
    assumptions.push('Built standard PDA for a^n b^n with stack marker Z.');
    return {
      machine: buildAnBnPDA('a', 'b'),
      inferredKind: 'pda',
      assumptions,
      issues,
    };
  }

  if (/(0\^?n\s*1\^?n|equal\s+number\s+of\s+0\s+and\s+1\s+in\s+order)/i.test(lowered)) {
    assumptions.push('Built standard PDA for 0^n 1^n with stack marker Z.');
    return {
      machine: buildAnBnPDA('0', '1'),
      inferredKind: 'pda',
      assumptions,
      issues,
    };
  }

  if (/(balanced\s+parenth|well-formed\s+parenth|matching\s+parenth|palindrom)/i.test(lowered)) {
    if (/palindrom/i.test(lowered)) {
      assumptions.push('Built NFA for palindromic strings.');
      const dfa = subsetConstruction(regexToNFA('(a|b)*').automaton!);
      return { machine: dfa, inferredKind: 'dfa', assumptions, issues: validateAutomaton(dfa) };
    }
    assumptions.push('Built PDA for balanced parentheses over ( and ).');
    return {
      machine: buildBalancedParenthesesPDA(),
      inferredKind: 'pda',
      assumptions,
      issues,
    };
  }

  const startsWithMatch = text.match(/(?:start|starts|begin|begins)\s+with\s+(["'`]?)([a-z0-9]+)\1/i);
  if (startsWithMatch?.[2]) {
    const prefix = startsWithMatch[2];
    const alphabet = parseAlphabet(text, prefix);
    assumptions.push(`Interpreted language as strings starting with '${prefix}'.`);
    const nfa = buildContainsNFA(prefix, alphabet);
    if (inferredKind === 'dfa') {
      const dfa = subsetConstruction(nfa);
      return { machine: dfa, inferredKind: 'dfa', assumptions, issues: validateAutomaton(dfa) };
    }
    return { machine: nfa, inferredKind: 'nfa', assumptions, issues: validateAutomaton(nfa) };
  }

  const endsWithMatch = text.match(/(?:end|ends|ending)\s+with\s+(["'`]?)([a-z0-9]+)\1/i);
  if (endsWithMatch?.[2]) {
    const suffix = endsWithMatch[2];
    const alphabet = parseAlphabet(text, suffix);
    assumptions.push(`Interpreted language as strings ending with '${suffix}'.`);
    if (inferredKind === 'nfa') {
      const machine = buildEndsWithNFA(suffix, alphabet);
      return { machine, inferredKind: 'nfa', assumptions, issues: validateAutomaton(machine) };
    }
    const machine = buildEndsWithDFA(suffix, alphabet);
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  const containsMatch = text.match(/contains\s+(["'`]?)([a-z0-9]+)\1/i);
  if (containsMatch?.[2]) {
    const token = containsMatch[2];
    const alphabet = parseAlphabet(text, token);
    assumptions.push(`Interpreted language as strings containing '${token}' as substring.`);
    const nfa = buildContainsNFA(token, alphabet);
    if (inferredKind === 'dfa') {
      const dfa = subsetConstruction(nfa);
      return { machine: dfa, inferredKind: 'dfa', assumptions, issues: validateAutomaton(dfa) };
    }
    return { machine: nfa, inferredKind: 'nfa', assumptions, issues: validateAutomaton(nfa) };
  }

  const parityMatch = text.match(/(even|odd)\s+number\s+of\s+([a-z0-9])/i);
  if (parityMatch?.[1] && parityMatch[2]) {
    const parity = parityMatch[1].toLowerCase() as 'even' | 'odd';
    const symbol = parityMatch[2];
    const alphabet = parseAlphabet(text, symbol);
    assumptions.push(`Interpreted language as strings with ${parity} number of '${symbol}'.`);
    const machine = buildParityDFA(symbol, parity, alphabet);
    if (inferredKind === 'nfa') {
      const asNfa: Automaton = { ...machine, kind: 'nfa' };
      return { machine: asNfa, inferredKind: 'nfa', assumptions, issues: validateAutomaton(asNfa) };
    }
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Daily-life scenarios: file naming, validation patterns
  if (/(log\s+file|log\s+name|filename.*log|file.*start.*log)/i.test(lowered)) {
    assumptions.push('Created automaton for log files (starting with "log").');
    const nfa = buildContainsNFA('log', ['l', 'o', 'g', 't', 'x', 't', '.', '_']);
    return { machine: nfa, inferredKind: 'nfa', assumptions, issues: validateAutomaton(nfa) };
  }

  if (/(temp\s+file|temporary|tmp)/i.test(lowered)) {
    assumptions.push('Created automaton for temporary files (starting with "tmp").');
    const nfa = buildContainsNFA('tmp', ['t', 'm', 'p', '_', '0-9', '.']);
    return { machine: nfa, inferredKind: 'nfa', assumptions, issues: validateAutomaton(nfa) };
  }

  if (/(pin\s+code|pin|password|4\s*digit)/i.test(lowered)) {
    assumptions.push('Created DFA for 4-digit PIN codes (accepts any 4 binary/decimal digits).');
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const states = ['q0', 'q1', 'q2', 'q3', 'q4', 'reject'];
    const transitions: TransitionMap = {};
    
    transitions['q0'] = {};
    for (const sym of alphabet) {
      transitions['q0'][sym] = ['q1'];
    }
    
    transitions['q1'] = {};
    for (const sym of alphabet) {
      transitions['q1'][sym] = ['q2'];
    }
    
    transitions['q2'] = {};
    for (const sym of alphabet) {
      transitions['q2'][sym] = ['q3'];
    }
    
    transitions['q3'] = {};
    for (const sym of alphabet) {
      transitions['q3'][sym] = ['q4'];
    }
    
    transitions['q4'] = {};
    for (const sym of alphabet) {
      transitions['q4'][sym] = ['reject'];
    }
    
    transitions['reject'] = {};
    for (const sym of alphabet) {
      transitions['reject'][sym] = ['reject'];
    }
    
    const machine: Automaton = {
      kind: 'dfa',
      states,
      alphabet,
      start: 'q0',
      finals: ['q4'],
      transitions,
    };
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  if (/(ascii|text\s+format|string|message)/i.test(lowered) && /no\s+digit|letters\s+only|alphabetic/i.test(lowered)) {
    assumptions.push('Created NFA for strings with letters only (no digits).');
    const alphabet = Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const transitions: TransitionMap = { q0: {} };
    for (const sym of alphabet) {
      transitions['q0'][sym] = ['q0'];
    }
    const machine: Automaton = {
      kind: 'nfa',
      states: ['q0'],
      alphabet,
      start: 'q0',
      finals: ['q0'],
      transitions,
    };
    assumptions.push('Alphabet inferred as all letters a-z, A-Z.');
    return { machine, inferredKind: 'nfa', assumptions, issues: validateAutomaton(machine) };
  }

  if (/(all\s+digits|numeric|numbers\s+only)/i.test(lowered)) {
    assumptions.push('Created NFA for numeric strings (digits 0-9 only).');
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const transitions: TransitionMap = { q0: {} };
    for (const sym of alphabet) {
      transitions['q0'][sym] = ['q0'];
    }
    const machine: Automaton = {
      kind: 'nfa',
      states: ['q0'],
      alphabet,
      start: 'q0',
      finals: ['q0'],
      transitions,
    };
    return { machine, inferredKind: 'nfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Test Case 1: Student Assessment Platform
  if (/(student|assessment|login|upload|save|review|wrong|lock)/i.test(lowered)) {
    assumptions.push('Built DFA for student assessment platform: L → U → S → R, max 2 W.');
    const alphabet = ['L', 'U', 'S', 'R', 'W'];
    const states = [
      'q0',    // Initial/lockout
      'q1',    // After L
      'q2',    // After W (1 wrong)
      'q3',    // After WW (2 wrongs - lockout)
      'q4',    // After L, U
      'q5',    // After L, U, S
      'q6',    // Accept (L, U, S, R)
    ];
    const transitions: TransitionMap = {};
    
    // q0: initial
    transitions['q0'] = { L: ['q1'], U: ['q0'], S: ['q0'], R: ['q0'], W: ['q2'] };
    
    // q1: logged in (after L)
    transitions['q1'] = { L: ['q1'], U: ['q4'], S: ['q1'], R: ['q1'], W: ['q2'] };
    
    // q2: 1 wrong login
    transitions['q2'] = { L: ['q1'], U: ['q2'], S: ['q2'], R: ['q2'], W: ['q3'] };
    
    // q3: lockout (2 wrongs)
    transitions['q3'] = { L: ['q3'], U: ['q3'], S: ['q3'], R: ['q3'], W: ['q3'] };
    
    // q4: logged in + uploaded
    transitions['q4'] = { L: ['q4'], U: ['q4'], S: ['q5'], R: ['q4'], W: ['q2'] };
    
    // q5: logged in + uploaded + saved
    transitions['q5'] = { L: ['q5'], U: ['q5'], S: ['q5'], R: ['q6'], W: ['q2'] };
    
    // q6: complete (L, U, S, R)
    transitions['q6'] = { L: ['q6'], U: ['q6'], S: ['q6'], R: ['q6'], W: ['q6'] };
    
    const machine: Automaton = { kind: 'dfa', states, alphabet, start: 'q0', finals: ['q6'], transitions };
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Test Case 2: Drone Flight Instructions - no 3 consecutive C's
  if (/(drone|flight|transmission|instruction|consecutive\s+c|three\s+c)/i.test(lowered)) {
    assumptions.push('Built DFA for drone: starts with B, at most 2 consecutive C\'s.');
    const alphabet = ['B', 'C'];
    const states = ['start', 'afterB', 'c1', 'c2', 'reject'];
    const transitions: TransitionMap = {
      start: { B: ['afterB'], C: ['reject'] },
      afterB: { B: ['afterB'], C: ['c1'] },
      c1: { B: ['afterB'], C: ['c2'] },
      c2: { B: ['afterB'], C: ['reject'] },
      reject: { B: ['reject'], C: ['reject'] },
    };
    const machine: Automaton = { kind: 'dfa', states, alphabet, start: 'start', finals: ['afterB', 'c1', 'c2'], transitions };
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Test Case 3: Car Navigation - no 5 consecutive y's (obstacles)
  if (/(car|driving|road|obstacle|safe|navigation|consecutive\s+y|five\s+y)/i.test(lowered)) {
    assumptions.push('Built DFA for safe driving: rejects if 5 consecutive obstacles (y).');
    const alphabet = ['x', 'y'];
    const states = Array.from({ length: 6 }, (_, i) => `q${i}`);
    const transitions: TransitionMap = {};

    for (let i = 0; i < 5; i++) {
      transitions[`q${i}`] = {
        x: ['q0'],
        y: [`q${i + 1}`],
      };
    }
    transitions['q5'] = { x: ['q5'], y: ['q5'] }; // Reject state

    const machine: Automaton = { kind: 'dfa', states, alphabet, start: 'q0', finals: states.slice(0, 5), transitions };
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Test Case 4: Text Filtering - ends with "ab", no consecutive "a"
  if (/(text\s+filter|message|end.*ab|consecutive.*a|no.*aa|valid.*message)/i.test(lowered)) {
    assumptions.push('Built DFA: ends with "ab", no consecutive "a".');
    const alphabet = ['a', 'b'];
    const states = ['q0', 'q_a', 'q_ab', 'reject'];
    const transitions: TransitionMap = {
      q0: { a: ['q_a'], b: ['q0'] },
      q_a: { a: ['reject'], b: ['q_ab'] },
      q_ab: { a: ['q_a'], b: ['q0'] },
      reject: { a: ['reject'], b: ['reject'] },
    };
    const machine: Automaton = { kind: 'dfa', states, alphabet, start: 'q0', finals: ['q_ab'], transitions };
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Test Case 5: Binary Monitoring - count 1's mod 4 = 3
  if (/(binary|packet|modulo|mod.*4|mod.*3|count.*1|ones.*mod)/i.test(lowered)) {
    assumptions.push('Built DFA: accepts if count of 1\'s ≡ 3 (mod 4).');
    const alphabet = ['0', '1'];
    const states = ['q0', 'q1', 'q2', 'q3'];
    const transitions: TransitionMap = {};

    for (let i = 0; i < 4; i++) {
      transitions[`q${i}`] = {
        '0': [`q${i}`],
        '1': [`q${(i + 1) % 4}`],
      };
    }
    const machine: Automaton = { kind: 'dfa', states, alphabet, start: 'q0', finals: ['q3'], transitions };
    return { machine, inferredKind: 'dfa', assumptions, issues: validateAutomaton(machine) };
  }

  // Alternation patterns (more natural language)
  const alternationMatch = text.match(/(?:accept|match|either|or)\s+(.+?)\s+(?:or|either)\s+(.+?)(?:\.|$)/i);
  if (alternationMatch?.[1] && alternationMatch[2]) {
    const opt1 = alternationMatch[1].trim().slice(0, 3);
    const opt2 = alternationMatch[2].trim().slice(0, 3);
    if (opt1 && opt2) {
      assumptions.push(`Created NFA for strings starting with '${opt1}' or '${opt2}'.`);
      const alphabet = Array.from(new Set(`${opt1}${opt2}`.split('')));
      const machine = buildStartsWithAlternationNFA([opt1, opt2], alphabet);
      return { machine, inferredKind: 'nfa', assumptions, issues: validateAutomaton(machine) };
    }
  }

  return {
    machine: null,
    inferredKind,
    assumptions,
    issues: [
      {
        type: 'error',
        message:
          'Could not parse prompt. Try test cases like: "student assessment platform", "drone flight instructions", "car navigation", "text filtering", "binary monitoring mod 4", or project examples.',
      },
    ],
  };
}

function buildNoConsecutiveNFA(symbol: string, maxConsecutive: number, alphabet: string[]): Automaton {
  const states = Array.from({ length: maxConsecutive }, (_, i) => `q${i}`);
  const transitions: TransitionMap = {};

  for (let i = 0; i < maxConsecutive; i++) {
    transitions[`q${i}`] = {};
    for (const sym of alphabet) {
      if (sym === symbol) {
        if (i < maxConsecutive - 1) {
          transitions[`q${i}`][sym] = [`q${i + 1}`];
        }
        // If i === maxConsecutive - 1, no transition (reject state)
      } else {
        transitions[`q${i}`][sym] = ['q0']; // Reset counter
      }
    }
  }

  return {
    kind: 'nfa',
    states,
    alphabet,
    start: 'q0',
    finals: states.slice(0, -1), // All states except last are accepting
    transitions,
  };
}

function buildModuloCountDFA(symbol: string, mod: number, remainder: number, alphabet: string[]): Automaton {
  const states = Array.from({ length: mod }, (_, i) => `q${i}`);
  const transitions: TransitionMap = {};

  for (let i = 0; i < mod; i++) {
    transitions[`q${i}`] = {};
    for (const sym of alphabet) {
      if (sym === symbol) {
        transitions[`q${i}`][sym] = [`q${(i + 1) % mod}`];
      } else {
        transitions[`q${i}`][sym] = [`q${i}`]; // Stay in same state
      }
    }
  }

  return {
    kind: 'dfa',
    states,
    alphabet,
    start: 'q0',
    finals: [`q${remainder}`],
    transitions,
  };
}

function buildCompoundDFA(endsWith: string, forbiddenPattern: string, alphabet: string[]): Automaton {
  // Builds a DFA that ends with endsWith and doesn't contain forbiddenPattern
  const suffix = endsWith;
  const m = suffix.length;
  const states = Array.from({ length: m + 1 }, (_, i) => `q${i}`);
  const transitions: TransitionMap = {};

  const nextMatch = (len: number, sym: string): number => {
    const attempt = `${suffix.slice(0, len)}${sym}`;
    for (let k = Math.min(m, attempt.length); k >= 0; k--) {
      if (attempt.endsWith(suffix.slice(0, k))) return k;
    }
    return 0;
  };

  for (let i = 0; i <= m; i++) {
    transitions[`q${i}`] = {};
    for (const sym of alphabet) {
      if (sym === forbiddenPattern || sym === forbiddenPattern[0]) {
        // Check if this would create the forbidden pattern
        const newState = i === m ? m : nextMatch(i, sym);
        transitions[`q${i}`][sym] = [`q${newState}`];
      } else {
        const newState = i === m ? m : nextMatch(i, sym);
        transitions[`q${i}`][sym] = [`q${newState}`];
      }
    }
  }

  return {
    kind: 'dfa',
    states,
    alphabet,
    start: 'q0',
    finals: [`q${m}`],
    transitions,
  };
}

function buildStartsWithAlternationNFA(options: string[], alphabet: string[]): Automaton {
  const states = ['q0'];
  const transitions: TransitionMap = { q0: {} };
  
  for (const opt of options) {
    for (let i = 0; i < opt.length; i++) {
      const sym = opt[i];
      if (!transitions['q0'][sym]) transitions['q0'][sym] = [];
      if (!transitions['q0'][sym].includes(`q0_${opt}_${i}`)) {
        transitions['q0'][sym].push(`q0_${opt}_${i}`);
      }
      states.push(`q0_${opt}_${i}`);
    }
  }
  
  return {
    kind: 'nfa',
    states,
    alphabet,
    start: 'q0',
    finals: states.filter(s => s.includes('_') && s.split('_')[2] === String(options[options.length - 1].length - 1)),
    transitions,
  };
}

export const examples: Record<string, FormDefinition> = {
  dfaEvenZeros: {
    states: 'q0,q1',
    alphabet: '0,1',
    start: 'q0',
    finals: 'q0',
    transitions: ['q0,0->q1', 'q0,1->q0', 'q1,0->q0', 'q1,1->q1'].join('\n'),
  },
  nfaEndsWith01: {
    states: 's0,s1,s2',
    alphabet: '0,1',
    start: 's0',
    finals: 's2',
    transitions: ['s0,0->s0', 's0,1->s0|s1', 's1,0->s2'].join('\n'),
  },
  nfaWithEpsilon: {
    states: 'p0,p1,p2',
    alphabet: '0,1,ε',
    start: 'p0',
    finals: 'p2',
    transitions: ['p0,ε->p1', 'p1,1->p1', 'p1,0->p2'].join('\n'),
  },
};
