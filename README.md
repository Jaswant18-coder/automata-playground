# Automata Playground (Offline Frontend)

Offline-only React + Vite app. Supports DFA/NFA (ε-NFA) creation, validation, simulation, NFA→DFA conversion, DFA minimization, regex↔automata, and inline graph visualization. All data stays in-browser (localStorage).

## Setup

```bash
npm install
npm run dev
```

## Features
- DFA and NFA (with ε) definition via forms (states, alphabet, transitions, start, finals)
- Validation: undefined states/symbols, missing DFA transitions, malformed lines
- Simulation: acceptance result, final states, step-by-step trace with explanation panel & complexity note
- Conversions: subset construction (NFA→DFA), Hopcroft-style DFA minimization
- Regex ↔ Automata: regex→NFA (Thompson), subset→DFA, state-elimination NFA/DFA→regex
- Prompt-based generation (small rule model): generate DFA/NFA/PDA from natural-language prompt
- Visualization: simple SVG graph with active-state highlighting; quick tips panel
- Presets: even number of 0s (DFA), ends-with-01 (NFA), ε-NFA sample

## Notes
- Use `eps`/`epsilon` for ε in alphabet and transitions; transitions format: `from,symbol->to1|to2` (one per line).
- Prompt examples: `DFA for strings ending with 01`, `NFA that contains 110`, `PDA for a^n b^n`, `regex: (0|1)*01`.
- Run `npm run build` for a production bundle.
- No backend; to share machines, export/import JSON manually (to be added).
