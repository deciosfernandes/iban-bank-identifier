'use strict';

// Testes sem framework: correm com `node test/index.test.js` (ver package.json).
// Cada `assert` falha lança e faz o Node sair com código != 0, o que chega para o CI.

const assert = require('assert');

const {
  identifyBank,
  isValidIBAN,
  extractBankCode,
  normalizeIBAN,
  supportedCountries,
  supportedBankCountries,
} = require('../src');

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
