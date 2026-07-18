export interface BankInfo {
  name: string;
  bic: string | null;
}

export interface IdentifyResult {
  valid: boolean;
  country: string | null;
  bankCode: string | null;
  bank: BankInfo | null;
  error: string | null;
}

export interface IdentifyOptions {
  /** Valida o IBAN (mod-97) antes de identificar. Por omissão: true. */
  validate?: boolean;
}

export function identifyBank(iban: string, options?: IdentifyOptions): IdentifyResult;
export function isValidIBAN(iban: string): boolean;
export function extractBankCode(iban: string): string | null;
export function normalizeIBAN(iban: string): string;
export function supportedCountries(): string[];
export function supportedBankCountries(): string[];
