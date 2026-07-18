# iban-bank-identifier

Identifica automaticamente o banco a partir de um IBAN, usando **bases de dados JSON incorporadas** — sem chamadas de rede. Inclui validação de IBAN pelo algoritmo mod-97 (ISO 13616 / ISO 7064).

## Cobertura de bancos

Bases de dados incorporadas para **6 países**:

| País | Código | Nº de bancos | Fiabilidade dos dados |
|---|---|---|---|
| Portugal | `PT` | ~22 | Alta (códigos do Banco de Portugal) |
| Espanha | `ES` | ~46 | Alta (código de entidade do Banco de España) |
| Países Baixos | `NL` | ~31 | Muito alta (código = prefixo do BIC, 4 letras) |
| França | `FR` | ~13 | Média — só entidades nacionais (ver limitações) |
| Itália | `IT` | ~17 | Média-alta (ABI dos principais bancos) |
| Alemanha | `DE` | ~14 | Média — só grandes bancos nacionais (ver limitações) |

Para qualquer outro país da UE, o pacote continua a **validar** o IBAN e a **extrair** o código do banco (quando a estrutura é conhecida), mas devolve `bank: null` por não haver base de dados incorporada.

## Instalação

```bash
npm install iban-bank-identifier
```

## Utilização

```js
const { identifyBank, isValidIBAN } = require('iban-bank-identifier');

identifyBank('PT49 0035 0000 0000 1234 5670 0');
// { valid: true, country: 'PT', bankCode: '0035',
//   bank: { name: 'Caixa Geral de Depósitos', bic: 'CGDIPTPL' }, error: null }

identifyBank('NL91 ABNA 0417 1643 00');
// { valid: true, country: 'NL', bankCode: 'ABNA',
//   bank: { name: 'ABN AMRO Bank', bic: 'ABNANL2A' }, error: null }

identifyBank('ES91 2100 0418 4502 0005 1332');
// { valid: true, country: 'ES', bankCode: '2100',
//   bank: { name: 'CaixaBank', bic: 'CAIXESBB' }, error: null }

isValidIBAN('DE89370400440532013000'); // true
```

Espaços e minúsculas são normalizados internamente.

## API

### `identifyBank(iban, options?)`
Devolve:

| Campo | Tipo | Descrição |
|---|---|---|
| `valid` | `boolean` | Se o IBAN passa a validação mod-97 e o comprimento do país. |
| `country` | `string \| null` | Código ISO do país (ex.: `PT`). |
| `bankCode` | `string \| null` | Código do banco extraído do IBAN. |
| `bank` | `{ name, bic } \| null` | Dados do banco, se encontrado. `bic` pode ser `null` quando desconhecido. |
| `error` | `string \| null` | Mensagem de erro, se algo falhou. |

**Opções:** `validate` (`boolean`, por omissão `true`). Se `false`, não bloqueia em IBANs inválidos (útil para inspecionar o código do banco mesmo assim).

### Outras funções
- `isValidIBAN(iban)` → `boolean` — validação mod-97 + comprimento por país.
- `extractBankCode(iban)` → `string | null` — extrai só o código do banco.
- `normalizeIBAN(iban)` → `string` — remove espaços e passa a maiúsculas.
- `supportedCountries()` → `string[]` — países com estrutura de IBAN conhecida.
- `supportedBankCountries()` → `string[]` — países com base de dados de bancos incorporada.

## Como funciona

Cada IBAN é `país(2) + dígitos de controlo(2) + BBAN`. O ficheiro
`data/iban-structure.json` define, por país, as posições onde está o código do
banco. Esse código é cruzado com `data/banks-XX.json` para obter nome e BIC/SWIFT.
As posições variam: em PT/ES são 4 dígitos; em FR 5 dígitos; em NL 4 letras;
em IT 5 dígitos ABI (a seguir a um caractere CIN); em DE 8 dígitos BLZ.

## Limitações importantes

- **França:** os bancos mutualistas (Crédit Agricole, Crédit Mutuel, Caisse
  d'Épargne, Banque Populaire) usam **códigos regionais** — a mesma marca tem
  vários códigos consoante a região de abertura da conta. A base de dados cobre
  as entidades nacionais e os principais códigos, não todas as caixas regionais.
- **Alemanha:** existem mais de 1500 bancos, e as redes Sparkassen e
  Volksbanken/Raiffeisenbanken têm um BLZ específico por cidade/região. Só estão
  incorporados os grandes bancos comerciais e digitais com BLZ nacional.
- **Portugal:** os códigos baseiam-se em listas públicas do Banco de Portugal;
  pode faltar alguma instituição recente ou já extinta.
- **BIC:** alguns bancos têm `bic: null` quando o valor não pôde ser confirmado
  numa fonte fiável. Para dados financeiros, preferiu-se "desconhecido" a "errado".

Os dados destinam-se a identificação/UX e **não** substituem a validação oficial
de um banco ou de um serviço de pagamentos em produção crítica.

## Estender a outros países

1. Confirmar/adicionar a estrutura do país em `data/iban-structure.json`
   (`length`, `bankStart`, `bankEnd`).
2. Criar `data/banks-XX.json` com o mapa `código → { name, bic }`.

Não é preciso alterar código: os ficheiros são carregados sob demanda.

## Licença

MIT
