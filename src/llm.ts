/**
 * LLM Integration for Automata Generation
 * Supports multiple free and paid LLM providers
 */

export type LLMProvider = 'openai' | 'gemini' | 'groq' | 'huggingface' | 'ollama';

export interface AutomataDescription {
  states: string[];
  alphabet: string[];
  start: string;
  finals: string[];
  transitions: Record<string, Record<string, string[]>>;
  kind: 'dfa' | 'nfa';
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
}

const systemPrompt = `You are an expert in Theory of Computation and DFA/NFA design.
Given a natural language description of an automaton problem, extract and return a JSON object with:

{
  "states": ["q0", "q1", ...],
  "alphabet": ["a", "b", "c", ...],
  "start": "q0",
  "finals": ["q1", ...],
  "transitions": {
    "q0": { "a": ["q1"], "b": ["q0"] },
    "q1": { ... }
  },
  "kind": "dfa" or "nfa"
}

IMPORTANT RULES:
1. transitions[state][symbol] is always an ARRAY of next states
2. For DFA, arrays should have exactly 1 element
3. For NFA, arrays can have multiple elements
4. Use epsilon transitions only for NFA
5. Ensure all referenced states are in the states array
6. All symbols in transitions must be in alphabet
7. Start and finals states must exist in states

Return ONLY the JSON object, no markdown, no explanation.`;

// OpenAI API
async function generateFromOpenAI(prompt: string, apiKey: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate an automaton for: ${prompt}` },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `OpenAI API Error (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// Google Gemini API (Free tier available)
async function generateFromGemini(prompt: string, apiKey: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemPrompt}\n\nGenerate an automaton for: ${prompt}`,
          }],
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `Gemini API Error (${response.status})`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Groq API (Free, very fast)
async function generateFromGroq(prompt: string, apiKey: string) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mixtral-8x7b-32768',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate an automaton for: ${prompt}` },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `Groq API Error (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// Hugging Face Inference API (Free tier)
async function generateFromHuggingFace(prompt: string, apiKey: string) {
  const response = await fetch('https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: `${systemPrompt}\n\nGenerate an automaton for: ${prompt}`,
      parameters: { max_new_tokens: 1000, temperature: 0.3 },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.[0]?.error || `HuggingFace API Error (${response.status})`);
  }

  const data = await response.json();
  return data?.[0]?.generated_text || '';
}

// Local Ollama (Completely free, runs locally)
async function generateFromOllama(prompt: string, baseUrl: string = 'http://localhost:11434') {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral',
      prompt: `${systemPrompt}\n\nGenerate an automaton for: ${prompt}`,
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama Error (${response.status}). Is Ollama running at ${baseUrl}?`);
  }

  const data = await response.json();
  return data.response || '';
}

export async function generateFromLLM(
  prompt: string,
  config: LLMConfig
): Promise<{ automaton: AutomataDescription | null; error?: string }> {
  try {
    let content = '';

    switch (config.provider) {
      case 'openai':
        if (!config.apiKey?.trim()) {
          return { automaton: null, error: 'OpenAI API key not provided.' };
        }
        content = await generateFromOpenAI(prompt, config.apiKey);
        break;

      case 'gemini':
        if (!config.apiKey?.trim()) {
          return { automaton: null, error: 'Google Gemini API key not provided.' };
        }
        content = await generateFromGemini(prompt, config.apiKey);
        break;

      case 'groq':
        if (!config.apiKey?.trim()) {
          return { automaton: null, error: 'Groq API key not provided.' };
        }
        content = await generateFromGroq(prompt, config.apiKey);
        break;

      case 'huggingface':
        if (!config.apiKey?.trim()) {
          return { automaton: null, error: 'HuggingFace API key not provided.' };
        }
        content = await generateFromHuggingFace(prompt, config.apiKey);
        break;

      case 'ollama':
        content = await generateFromOllama(prompt, config.baseUrl || 'http://localhost:11434');
        break;
    }

    if (!content) {
      return { automaton: null, error: 'No response from LLM.' };
    }

    // Parse JSON response
    let automaton: AutomataDescription;
    try {
      automaton = JSON.parse(content);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { automaton: null, error: 'Could not parse automaton JSON from response.' };
      }
      automaton = JSON.parse(jsonMatch[0]);
    }

    // Validate structure
    if (!automaton.states || !automaton.alphabet || !automaton.transitions) {
      return { automaton: null, error: 'Invalid automaton structure from LLM.' };
    }

    return { automaton };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { automaton: null, error: message };
  }
}

export function validateAutomataDescription(desc: AutomataDescription): string | null {
  // Basic validation
  if (!desc.states?.length) return 'No states defined.';
  if (!desc.alphabet?.length) return 'No alphabet defined.';
  if (!desc.start || !desc.states.includes(desc.start)) return 'Invalid start state.';
  if (!desc.finals?.length) return 'No final states defined.';

  // Check all finals exist
  const invalidFinals = desc.finals.filter((f) => !desc.states.includes(f));
  if (invalidFinals.length) return `Invalid final states: ${invalidFinals.join(', ')}`;

  // Check transitions reference valid states and symbols
  for (const [from, trans] of Object.entries(desc.transitions)) {
    if (!desc.states.includes(from)) return `Transition from undefined state: ${from}`;
    for (const [sym, tos] of Object.entries(trans)) {
      if (!desc.alphabet.includes(sym) && sym !== 'ε') {
        return `Undefined symbol in alphabet: ${sym}`;
      }
      if (!Array.isArray(tos)) return `Invalid transition format for ${from}/${sym}`;
      for (const to of tos) {
        if (!desc.states.includes(to)) {
          return `Transition to undefined state: ${from}/${sym} → ${to}`;
        }
      }
    }
  }

  return null;
}
