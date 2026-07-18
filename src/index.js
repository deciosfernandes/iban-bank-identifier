'use strict';

const fs = require('fs');
const path = require('path');

const structure = require('../data/iban-structure.json');

// Cache de bases de dados de bancos por país, carregadas sob demanda.
const bankDbCache = {};

function loadBankDb(country) {
  if (bankDbCache[country] !== undefined) {
    return bankDbCache[country];
  }
  const file = path.join(__dirname, '..', 'data', `banks-${country}.json`);
  try {
    const db = JSON.parse(fs.readFileSync(file, 'utf8'));
    bankDbCache[country] = db;
    return db;
  } catch (e) {
    bankDbCache[country] = null;
    return null;
  }
}

/**
 * Normaliza um IBAN: remove espaços e passa a maiúsculas.
 */
function normalizeIBAN(iban) {
  if (typeof iban !== 'string') {
    throw new TypeError('O IBAN tem de ser uma string.');
  }
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Valida um IBAN segundo o algoritmo mod-97 (ISO 13616 / ISO 7064).
 * Verifica também o comprimento esperado para o país, quando conhecido.
 */
function isValidIBAN(iban) {
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
function extractBankCode(iban) {
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
function identifyBank(iban, options = {}) {
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
function supportedCountries() {
  return Object.keys(structure);
}

/**
 * Lista os países que têm base de dados de bancos incorporada
 * (ou seja, para os quais é possível resolver o nome do banco).
 */
function supportedBankCountries() {
  const dir = path.join(__dirname, '..', 'data');
  return fs
    .readdirSync(dir)
    .filter((f) => /^banks-[A-Z]{2}\.json$/.test(f))
    .map((f) => f.slice(6, 8))
    .sort();
}

module.exports = {
  identifyBank,
  isValidIBAN,
  extractBankCode,
  normalizeIBAN,
  supportedCountries,
  supportedBankCountries,
};
