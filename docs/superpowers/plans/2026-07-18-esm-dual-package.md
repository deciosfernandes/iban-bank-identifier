# Dual ESM + CJS Browser-Safe Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `iban-bank-identifier` into a dual ESM + CJS package that works unchanged in Node (both module systems) and in browser bundlers (React, Angular, Vite, webpack), with the public API preserved.

**Architecture:** Rewrite `src/index.js` as ESM importing all JSON data statically (killing the runtime `fs`/`path` dependency). Bundle with `tsup` into `dist/index.mjs` + `dist/index.cjs` with JSON inlined. Expose both via a `package.json` `exports` map. Tests and README updated to match.

**Tech Stack:** JavaScript (ESM source), `tsup` (esbuild-based bundler), Node's built-in `assert` test runner, hand-written `.d.ts`.

## Global Constraints

- Public API unchanged — same 6 named exports, same signatures, same `IdentifyResult` shape and error messages: `identifyBank`, `isValidIBAN`, `extractBankCode`, `normalizeIBAN`, `supportedCountries`, `supportedBankCountries`.
- No runtime `fs`/`path`/`readFileSync`/`readdirSync` anywhere in shipped output.
- No network calls in runtime (data stays embedded).
- `engines.node`: `>=18`.
- Only one new devDependency allowed: `tsup` (`^8`). No new runtime dependencies.
- `files` field ships only `["dist"]`.
- Tests run against the **built `dist/index.mjs`** (the real shipped artifact), not source — source uses plain JSON imports that only a bundler resolves.

---

### Task 1: Rewrite source as ESM with inlined data

**Files:**
- Modify (full rewrite): `src/index.js`

**Interfaces:**
- Consumes: JSON data files in `data/` (unchanged).
- Produces: ESM module with named exports `identifyBank(iban, options?)`, `isValidIBAN(iban)`, `extractBankCode(iban)`, `normalizeIBAN(iban)`, `supportedCountries()`, `supportedBankCountries()`, plus a `default` export bundling all six. `loadBankDb(country)` is a private helper returning `object | null`.

- [ ] **Step 1: Replace `src/index.js` entirely with the ESM version below**

```js
import structure from '../data/iban-structure.json';
import banksPT from '../data/banks-PT.json';
import banksES from '../data/banks-ES.json';
import banksFR from '../data/banks-FR.json';
import banksIT from '../data/banks-IT.json';
import banksNL from '../data/banks-NL.json';
import banksDE from '../data/banks-DE.json';

// Bases de dados de bancos por país, incorporadas em tempo de build.
// (Substitui o carregamento por fs.readFileSync do código antigo.)
const bankDbs = {
  PT: banksPT,
  ES: banksES,
  FR: banksFR,
  IT: banksIT,
  NL: banksNL,
  DE: banksDE,
};

function loadBankDb(country) {
  return bankDbs[country] ?? null;
}

/**
 * Normaliza um IBAN: remove espaços e passa a maiúsculas.
 */
export function normalizeIBAN(iban) {
  if (typeof iban !== 'string') {
    throw new TypeError('O IBAN tem de ser uma string.');
  }
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Valida um IBAN segundo o algoritmo mod-97 (ISO 13616 / ISO 7064).
 * Verifica também o comprimento esperado para o país, quando conhecido.
 */
export function isValidIBAN(iban) {
  const clean = normalizeIBAN(iban);

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) {
    return false;
  }

  const country = clean.slice(0, 2);
  const spec = structure[country];
  if (spec && clean.length !== spec.length) {
    return false;
  }

  // Move os 4 primeiros caracteres para o fim e converte letras em números.
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) =>
    (ch.charCodeAt(0) - 55).toString()
  );

  // mod-97 por blocos, para evitar overflow de inteiros grandes.
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const block = remainder.toString() + numeric.substring(i, i + 7);
    remainder = parseInt(block, 10) % 97;
  }

  return remainder === 1;
}

/**
 * Extrai o código do banco de um IBAN, com base na estrutura do país.
 */
export function extractBankCode(iban) {
  const clean = normalizeIBAN(iban);
  const country = clean.slice(0, 2);
  const spec = structure[country];
  if (!spec) {
    return null;
  }
  return clean.slice(spec.bankStart, spec.bankEnd);
}

/**
 * Identifica o banco associado a um IBAN.
 *
 * @param {string} iban
 * @param {object} [options]
 * @param {boolean} [options.validate=true] Valida o IBAN (mod-97) antes de identificar.
 * @returns {{ valid: boolean, country: string, bankCode: string|null,
 *             bank: object|null, error: string|null }}
 */
export function identifyBank(iban, options = {}) {
  const { validate = true } = options;
  const result = {
    valid: false,
    country: null,
    bankCode: null,
    bank: null,
    error: null,
  };

  let clean;
  try {
    clean = normalizeIBAN(iban);
  } catch (e) {
    result.error = e.message;
    return result;
  }

  result.country = clean.slice(0, 2) || null;

  if (validate && !isValidIBAN(clean)) {
    result.error = 'IBAN inválido (falha na validação mod-97 ou no comprimento).';
    return result;
  }
  result.valid = validate ? true : isValidIBAN(clean);

  const country = clean.slice(0, 2);
  if (!structure[country]) {
    result.error = `País "${country}" não suportado para extração do código do banco.`;
    return result;
  }

  const bankCode = extractBankCode(clean);
  result.bankCode = bankCode;

  const db = loadBankDb(country);
  if (!db) {
    result.error = `Sem base de dados de bancos para o país "${country}".`;
    return result;
  }

  const bank = db[bankCode] || null;
  result.bank = bank;
  if (!bank) {
    result.error = `Código de banco "${bankCode}" não encontrado para ${country}.`;
  }

  return result;
}

/**
 * Lista os países suportados para extração do código do banco.
 */
export function supportedCountries() {
  return Object.keys(structure);
}

/**
 * Lista os países que têm base de dados de bancos incorporada
 * (ou seja, para os quais é possível resolver o nome do banco).
 */
export function supportedBankCountries() {
  return Object.keys(bankDbs).sort();
}

export default {
  identifyBank,
  isValidIBAN,
  extractBankCode,
  normalizeIBAN,
  supportedCountries,
  supportedBankCountries,
};
```

- [ ] **Step 2: Confirm no `fs`/`path`/`require`/`module.exports` remain**

Run: `grep -nE "require\(|module\.exports|readFileSync|readdirSync|'fs'|'path'" src/index.js`
Expected: no matches (empty output).

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "refactor: convert source to ESM with inlined bank data"
```

Note: source is not yet runnable by bare Node (plain JSON imports need a bundler) and the test still uses `require` — both are fixed in Tasks 2 and 3. No test run in this task.

---

### Task 2: Add tsup build and dual-package metadata

**Files:**
- Modify: `package.json`
- Create (generated, not committed): `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`
- Create: `.gitignore` (add `dist/` and `node_modules/` if not already ignored)

**Interfaces:**
- Consumes: `src/index.js` (Task 1), `src/index.d.ts` (existing, unchanged).
- Produces: `npm run build` emitting `dist/index.mjs` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` (copied). `exports` map resolving `import`→mjs, `require`→cjs, `types`→d.ts.

- [ ] **Step 1: Replace `package.json` with the version below**

```json
{
  "name": "iban-bank-identifier",
  "version": "2.0.0",
  "description": "Identifica o banco a partir de um IBAN, usando bases de dados JSON incorporadas (PT, ES, FR, IT, NL, DE). Inclui validação mod-97. Sem chamadas de rede. ESM + CommonJS, pronto para Node e browser (React, Angular, Vite, webpack).",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.js --format esm,cjs --clean && node -e \"require('fs').copyFileSync('src/index.d.ts','dist/index.d.ts')\"",
    "test": "npm run build && node test/index.test.js",
    "prepublishOnly": "npm test"
  },
  "files": [
    "dist/"
  ],
  "keywords": [
    "iban",
    "banco",
    "bank",
    "nib",
    "bic",
    "swift",
    "portugal",
    "spain",
    "france",
    "italy",
    "netherlands",
    "germany",
    "sepa",
    "validation",
    "mod97",
    "esm",
    "browser",
    "react",
    "angular"
  ],
  "author": "deciosfernandes <deciosfernandes@gmail.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deciosfernandes/iban-bank-identifier.git"
  },
  "bugs": {
    "url": "https://github.com/deciosfernandes/iban-bank-identifier/issues"
  },
  "homepage": "https://github.com/deciosfernandes/iban-bank-identifier#readme",
  "engines": {
    "node": ">=18"
  },
  "devDependencies": {
    "tsup": "^8"
  }
}
```

Note: version bumped to `2.0.0` — dropping Node 14–16 and changing `main` to `dist/` is a breaking change (SemVer major).

- [ ] **Step 2: Ensure `dist/` and `node_modules/` are git-ignored**

Create or append to `.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 3: Install tsup**

Run: `npm install`
Expected: `tsup` added under `devDependencies`, `node_modules/` populated, exit code 0.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit code 0; files `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts` created.

- [ ] **Step 5: Verify the CJS artifact works and has no fs**

Run: `node -e "const m=require('./dist/index.cjs'); console.log(m.isValidIBAN('NL91ABNA0417164300'), m.identifyBank('ES9121000418450200051332').bank.name)"`
Expected output: `true CaixaBank`

Run: `grep -nE "readFileSync|readdirSync|require\(.fs.\)|require\(.path.\)" dist/index.cjs dist/index.mjs`
Expected: no matches (empty output). This proves the browser blocker is gone.

- [ ] **Step 6: Verify the ESM artifact works**

Run: `node --input-type=module -e "import('./dist/index.mjs').then(m => console.log(m.isValidIBAN('DE89370400440532013000'), m.default.supportedBankCountries().join(',')))"`
Expected output: `true DE,ES,FR,IT,NL,PT`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "build: add tsup dual ESM+CJS build and exports map"
```

---

### Task 3: Convert tests to ESM against the built artifact

**Files:**
- Modify (full rewrite): `test/index.test.js`

**Interfaces:**
- Consumes: `dist/index.mjs` (built in Task 2 via the `test` script's `npm run build`).
- Produces: passing test suite via `npm test`.

- [ ] **Step 1: Replace `test/index.test.js` entirely with the ESM version below**

```js
// Testes sem framework: correm com `npm test` (que faz build e depois `node test/index.test.js`).
// Cada `assert` falha lança e faz o Node sair com código != 0, o que chega para o CI.
// Importa-se o artefacto construído (dist/index.mjs) — é o que os utilizadores recebem.

import assert from 'node:assert';

import {
  identifyBank,
  isValidIBAN,
  extractBankCode,
  normalizeIBAN,
  supportedCountries,
  supportedBankCountries,
} from '../dist/index.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// IBANs reais e válidos (mod-97) usados como vetores de teste.
const NL = 'NL91ABNA0417164300';
const ES = 'ES9121000418450200051332';
const DE = 'DE89370400440532013000';
const GB = 'GB82WEST12345698765432'; // país com estrutura mas sem base de dados de bancos
const NO = 'NO9386011117947'; // país sem estrutura conhecida

// --- normalizeIBAN ---
test('normalizeIBAN remove espaços e passa a maiúsculas', () => {
  assert.strictEqual(normalizeIBAN(' nl91 abna 0417 1643 00 '), NL);
});

test('normalizeIBAN lança TypeError em não-string', () => {
  assert.throws(() => normalizeIBAN(123), TypeError);
  assert.throws(() => normalizeIBAN(null), TypeError);
  assert.throws(() => normalizeIBAN(undefined), TypeError);
});

// --- isValidIBAN ---
test('isValidIBAN aceita IBANs válidos', () => {
  assert.strictEqual(isValidIBAN(NL), true);
  assert.strictEqual(isValidIBAN(ES), true);
  assert.strictEqual(isValidIBAN(DE), true);
  assert.strictEqual(isValidIBAN(GB), true);
});

test('isValidIBAN rejeita dígito de controlo alterado', () => {
  assert.strictEqual(isValidIBAN('DE89370400440532013001'), false);
});

test('isValidIBAN rejeita comprimento errado para o país', () => {
  assert.strictEqual(isValidIBAN('PT5000350000'), false);
});

test('isValidIBAN rejeita formato inválido', () => {
  assert.strictEqual(isValidIBAN('HELLO'), false);
  assert.strictEqual(isValidIBAN(''), false);
});

// --- extractBankCode ---
test('extractBankCode extrai o código correto', () => {
  assert.strictEqual(extractBankCode(ES), '2100');
  assert.strictEqual(extractBankCode(NL), 'ABNA');
  assert.strictEqual(extractBankCode(DE), '37040044');
});

test('extractBankCode devolve null para país sem estrutura', () => {
  assert.strictEqual(extractBankCode(NO), null);
});

// --- identifyBank: caminho feliz (valida + encontra banco) ---
test('identifyBank identifica banco em IBAN válido', () => {
  assert.deepStrictEqual(identifyBank(NL), {
    valid: true,
    country: 'NL',
    bankCode: 'ABNA',
    bank: { name: 'ABN AMRO Bank', bic: 'ABNANL2A' },
    error: null,
  });
  assert.deepStrictEqual(identifyBank(ES), {
    valid: true,
    country: 'ES',
    bankCode: '2100',
    bank: { name: 'CaixaBank', bic: 'CAIXESBB' },
    error: null,
  });
});

// --- identifyBank: casos de erro ---
test('identifyBank marca IBAN inválido e não segue em frente', () => {
  const r = identifyBank('DE89370400440532013001');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.bank, null);
  assert.ok(r.error);
});

test('identifyBank: país conhecido sem base de dados de bancos', () => {
  const r = identifyBank(GB);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.bankCode, 'WEST');
  assert.strictEqual(r.bank, null);
  assert.match(r.error, /Sem base de dados/);
});

test('identifyBank: país sem estrutura de IBAN suportada', () => {
  const r = identifyBank(NO);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.bankCode, null);
  assert.match(r.error, /não suportado/);
});

// --- identifyBank: options.validate=false ---
test('validate=false extrai e resolve banco mesmo em IBAN inválido', () => {
  const iban = 'PT00' + '0007' + '0'.repeat(17); // 25 chars, dígitos de controlo inválidos
  const r = identifyBank(iban, { validate: false });
  assert.strictEqual(r.valid, false); // reflete o resultado real do mod-97
  assert.strictEqual(r.bankCode, '0007');
  assert.deepStrictEqual(r.bank, { name: 'Novo Banco', bic: 'BESCPTPL' });
});

// --- listagens ---
test('supportedCountries inclui as estruturas conhecidas', () => {
  const list = supportedCountries();
  for (const c of ['PT', 'ES', 'FR', 'IT', 'NL', 'DE', 'GB']) {
    assert.ok(list.includes(c), `esperado ${c} em supportedCountries()`);
  }
});

test('supportedBankCountries corresponde às bases de dados existentes', () => {
  assert.deepStrictEqual(supportedBankCountries(), ['DE', 'ES', 'FR', 'IT', 'NL', 'PT']);
});

console.log(`\n${passed} testes passaram.`);
```

- [ ] **Step 2: Run the full suite (builds first, then tests)**

Run: `npm test`
Expected: build succeeds, then 14 lines of `  ok - ...` followed by `14 testes passaram.`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add test/index.test.js
git commit -m "test: run ESM suite against built dist artifact"
```

---

### Task 4: Document ESM / CJS / React / Angular usage

**Files:**
- Modify: `README.md` (add a "Instalação e uso" / usage section covering the module formats; keep existing content, adjust any `require`-only examples).

**Interfaces:**
- Consumes: the public API (unchanged names/signatures).
- Produces: usage docs. No code behavior.

- [ ] **Step 1: Read the current README to find where usage examples live**

Run: `cat README.md`
Expected: see current structure and any existing `require()` example to update.

- [ ] **Step 2: Add (or replace the existing usage section with) the following usage block**

Insert under the installation/usage heading (adapt heading level to match the file):

````markdown
## Uso

Funciona em Node (ESM e CommonJS) e em bundlers de browser (React, Angular, Vite, webpack) — sem configuração extra e sem chamadas de rede.

### ESM (recomendado)

```js
import { identifyBank, isValidIBAN } from 'iban-bank-identifier';

console.log(isValidIBAN('PT50000201231234567890154')); // true
console.log(identifyBank('ES9121000418450200051332').bank);
// { name: 'CaixaBank', bic: 'CAIXESBB' }
```

### CommonJS

```js
const { identifyBank } = require('iban-bank-identifier');

console.log(identifyBank('NL91ABNA0417164300').bank);
// { name: 'ABN AMRO Bank', bic: 'ABNANL2A' }
```

### React

```jsx
import { useState } from 'react';
import { identifyBank } from 'iban-bank-identifier';

export function IbanChecker() {
  const [iban, setIban] = useState('');
  const result = iban ? identifyBank(iban) : null;

  return (
    <div>
      <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IBAN" />
      {result && (
        <p>{result.valid ? (result.bank?.name ?? 'Banco desconhecido') : result.error}</p>
      )}
    </div>
  );
}
```

### Angular

```ts
import { Component } from '@angular/core';
import { identifyBank, type IdentifyResult } from 'iban-bank-identifier';

@Component({
  selector: 'app-iban-checker',
  standalone: true,
  template: `
    <input [(ngModel)]="iban" (ngModelChange)="check()" placeholder="IBAN" />
    <p *ngIf="result">{{ result.valid ? (result.bank?.name ?? 'Banco desconhecido') : result.error }}</p>
  `,
})
export class IbanCheckerComponent {
  iban = '';
  result: IdentifyResult | null = null;

  check(): void {
    this.result = this.iban ? identifyBank(this.iban) : null;
  }
}
```
````

- [ ] **Step 3: Verify no stale `require`-only claims remain**

Run: `grep -niE "commonjs only|apenas node|só funciona em node|src/index" README.md`
Expected: no matches, or only matches you intentionally keep. Update any text claiming the package is Node/CJS-only.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add ESM/CJS/React/Angular usage examples"
```

---

## Self-Review

**1. Spec coverage:**
- Dual ESM+CJS + types → Task 2 (`exports` map). ✓
- Kill `fs`/`path`; inline data → Task 1 + verified Task 2 Step 5. ✓
- API unchanged → Task 1 preserves all signatures; Task 3 asserts behavior. ✓
- No network → no code added; embedded data. ✓
- tsup build, `dist/` only, `files:["dist"]` → Task 2. ✓
- Tests ESM → Task 3. ✓
- README React/Angular/ESM/CJS → Task 4. ✓
- `engines.node >=18` → Task 2. ✓
- Skipped subpath/tree-shaking & TS rewrite → not implemented (per spec non-goals). ✓

**2. Placeholder scan:** No TBD/TODO; all steps carry full code and exact commands. ✓

**3. Type consistency:** `bankDbs`, `loadBankDb`, and all six exports named identically across Tasks 1–3. Test imports match export names. `IdentifyResult` type referenced in Task 4 matches existing `src/index.d.ts`. ✓

**Note on spec refinement:** The spec said tests run "against source directly". This plan runs them against `dist/index.mjs` instead — plain JSON imports in ESM source are only resolvable by the bundler, not by bare Node without version-gated import attributes. Testing the built artifact is both more robust and validates the actual shipped output. `test` script builds first so a single `npm test` covers it.
