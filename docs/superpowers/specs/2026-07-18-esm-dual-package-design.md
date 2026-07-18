# Design: Pacote dual ESM + CJS, utilizável no browser (React, Angular, …)

- **Data:** 18/07/2026
- **Estado:** Aprovado
- **Versão atual do pacote:** 1.1.0 (CommonJS, apenas Node)

## Problema

O pacote atual só funciona em Node com CommonJS e **não pode ser usado em bundlers de browser** (React, Angular, Vite, webpack). Duas causas:

1. **Formato do módulo:** só exporta CommonJS (`module.exports` / `require`). Não há entrada ESM (`import`).
2. **Dependência de `fs`/`path` em runtime** — o bloqueador principal:
   - `loadBankDb()` usa `fs.readFileSync` + `path.join` para carregar `data/banks-XX.json` sob demanda.
   - `supportedBankCountries()` usa `fs.readdirSync` para listar os ficheiros de bancos.
   - Estas APIs não existem no browser; qualquer bundler falha ou avisa ao encontrá-las.

Adicionar ESM sem remover `fs`/`path` **não** resolve o uso em browser. Os dados têm de ser incorporados em tempo de build.

## Objetivos

- Publicar um **pacote dual**: `import` (ESM) e `require` (CJS), mais tipos TypeScript.
- Funcionar sem alterações em **Node (ESM e CJS)** e em **bundlers de browser** (React, Angular, Vite, webpack).
- **Manter a API pública inalterada** — sem quebras para quem já usa `require()`.
- Zero chamadas de rede em runtime (característica do pacote mantida: dados incorporados).

## Não-objetivos (YAGNI)

- Imports por subpath / tree-shaking por país. Justificação: total dos dados = 32 KB (~<10 KB gzip). Adicionar quando um consumidor precisar mesmo de um bundle mais pequeno.
- Reescrita para TypeScript. Mantém-se JS + `.d.ts` escrito à mão.
- Novos países ou novos dados de bancos. Fora do âmbito desta alteração.

## Arquitetura

### 1. Código-fonte → ESM (`src/index.js`)

- Substituir `require`/`module.exports` por `import`/`export`.
- Importar todos os JSON estaticamente (o bundler incorpora-os no output; sem `fs` em runtime):
  ```js
  import structure from '../data/iban-structure.json' /* with { type: 'json' } — resolvido pelo bundler */;
  import banksPT from '../data/banks-PT.json';
  import banksES from '../data/banks-ES.json';
  import banksFR from '../data/banks-FR.json';
  import banksIT from '../data/banks-IT.json';
  import banksNL from '../data/banks-NL.json';
  import banksDE from '../data/banks-DE.json';

  const bankDbs = { PT: banksPT, ES: banksES, FR: banksFR, IT: banksIT, NL: banksNL, DE: banksDE };
  ```
- `loadBankDb(country)` → `return bankDbs[country] ?? null;` (mantém o nome e a assinatura síncrona; remove `fs`/`path` e a cache, que deixa de ser necessária).
- `supportedBankCountries()` → `return Object.keys(bankDbs).sort();` (remove `readdirSync`).
- Exportações: `export { identifyBank, isValidIBAN, extractBankCode, normalizeIBAN, supportedCountries, supportedBankCountries }` **e** um `export default` com o mesmo objeto (conveniência para `import iban from 'iban-bank-identifier'`).
- **A restante lógica (mod-97, extração, `identifyBank`) fica inalterada.**

### 2. Build → tsup (1 devDependency)

- `tsup` gera a partir de `src/index.js`:
  - `dist/index.mjs` (ESM)
  - `dist/index.cjs` (CJS)
  - JSON incorporado nos dois; sem referências a `fs`/`path`.
- **Tipos:** copiar `src/index.d.ts` → `dist/index.d.ts` no fim do build (o mesmo `.d.ts` serve ESM e CJS). Cópia com one-liner de Node (`node -e "require('fs').copyFileSync(...)"`) — multiplataforma, sem dependências extra.

### 3. `package.json`

```jsonc
{
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
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.js --format esm,cjs --clean && node -e \"require('fs').copyFileSync('src/index.d.ts','dist/index.d.ts')\"",
    "test": "node test/index.test.js",
    "prepublishOnly": "npm run build && npm test"
  },
  "devDependencies": { "tsup": "^8" }
}
```

- `files` deixa de incluir `src/` e `data/` (passa a `["dist"]`; os dados vão incorporados no `dist`). `engines.node` sobe para `>=18` (ESM estável + tsup).

### 4. Testes → ESM (`test/index.test.js`)

- Trocar `require('assert')` → `import assert from 'node:assert'`.
- Trocar `require('../src')` → `import { ... } from '../src/index.js'`.
- Correm contra o **código-fonte** diretamente (não é preciso build para testar). Asserções mantêm-se; `supportedBankCountries()` continua a devolver `['DE','ES','FR','IT','NL','PT']` (Object.keys ordenado).

### 5. README

- Adicionar exemplos de uso: ESM (`import`), CJS (`require`), React (componente), Angular (serviço/componente). Manter breve.

## Fluxo de dados (runtime, inalterado logicamente)

`identifyBank(iban)` → `normalizeIBAN` → `isValidIBAN` (mod-97 + comprimento por país via `structure`) → `extractBankCode` (via `structure`) → `loadBankDb(country)` (agora lookup em `bankDbs`, antes `fs`) → devolve `{ valid, country, bankCode, bank, error }`.

## Tratamento de erros

Inalterado. As mensagens de erro e a forma do resultado (`IdentifyResult`) mantêm-se exatamente iguais. A única diferença interna: `loadBankDb` nunca falha por I/O (não há I/O); devolve `null` para países sem dados, tal como antes.

## Estratégia de testes

- Continuar sem framework (asserções + saída de processo), agora em ESM.
- Cobertura mantém-se: normalização, validação mod-97, extração, caminho feliz, casos de erro, `validate=false`, listagens.
- Verificação manual pós-build: `require()` de `dist/index.cjs` e `import` de `dist/index.mjs` num Node limpo, confirmando que nenhum output referencia `fs`/`readFileSync`.

## Riscos e pressupostos

- **Pressuposto:** os bundlers-alvo (Vite, webpack 5, Angular CLI/esbuild) suportam import de JSON, que o tsup incorpora — verdadeiro para todos os bundlers modernos.
- **Risco:** `"type": "module"` no `package.json` torna qualquer `.js` do próprio repo em ESM. Mitigação: os artefactos CJS têm extensão `.cjs`; o teste é ESM. Sem `.js` CJS remanescente.
- **Risco:** subir `engines.node` para `>=18` exclui Node 14–16. Aceitável — LTS 14/16 em fim de vida; ESM/tsup precisam de ≥18.
- **Compatibilidade:** consumidores CJS existentes (`require('iban-bank-identifier')`) continuam a funcionar via `exports.require` → `dist/index.cjs`.
```
