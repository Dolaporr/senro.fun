import { sha256 as portableSha256 } from '@noble/hashes/sha256';
/** Pump Hooks Next reference client. No wallet, RPC, signing, or mainnet defaults. */
export const U64_MAX = (1n << 64n) - 1n;
export const POLICY_BYTES = 290;
const textEncoder = new TextEncoder();

export function u64(value, label = 'value') {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
    throw new TypeError(`${label} must be an unsigned 64-bit bigint`);
  }
  return value;
}

function decimalsChecked(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TypeError('decimals must be an integer between 0 and 255');
  }
}

/** Exact decimal parsing, with no floating-point conversion or silent truncation. */
export function parseAmount(text, decimals) {
  decimalsChecked(decimals);
  if (typeof text !== 'string' || !/^\d+(?:\.\d+)?$/.test(text)) throw new TypeError('invalid amount');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new RangeError('amount has too many decimal places');
  return u64(BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0'));
}

export function formatAmount(raw, decimals) {
  u64(raw); decimalsChecked(decimals);
  const factor = 10n ** BigInt(decimals);
  if (decimals === 0) return raw.toString();
  const tail = (raw % factor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (raw / factor).toString() + (tail ? `.${tail}` : '');
}

function key(value, label) {
  if (!(value instanceof Uint8Array) || value.length !== 32 || value.every(v => v === 0)) {
    throw new TypeError(`${label} must be a nonzero 32-byte public key`);
  }
  return value;
}
const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Matches route-guard's canonical format, including policy namespace and token programs. */
export function encodePolicy(policy) {
  const bytes = new Uint8Array(POLICY_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(textEncoder.encode('HKNXTP01'));
  let offset = 8;
  for (const field of ['id','authority','baseMint','quoteMint','baseTokenProgram','quoteTokenProgram','venueProgram']) {
    bytes.set(key(policy[field], field), offset); offset += 32;
  }
  if (equal(policy.baseMint, policy.quoteMint)) throw new TypeError('base and quote mint must differ');
  const write = value => { view.setBigUint64(offset, u64(value), true); offset += 8; };
  if (u64(policy.revision, 'revision') === 0n) throw new RangeError('revision must be positive');
  write(policy.revision);
  if (typeof policy.active !== 'boolean') throw new TypeError('active must be a boolean');
  bytes[offset++] = Number(policy.active);
  const limits = policy.limits ?? {};
  for (const field of Object.keys(limits)) {
    if (!['maxQuotePerTrade','maxAccountBase','sellCooldownSeconds','rollingQuote'].includes(field)) {
      throw new TypeError(`unsupported limit: ${field}`);
    }
  }
  const fields = ['maxQuotePerTrade','maxAccountBase','sellCooldownSeconds','rollingQuote'];
  let flags = 0;
  for (const [bit, field] of fields.entries()) {
    if (limits[field] !== undefined) flags |= 1 << bit;
  }
  bytes[offset++] = flags;
  for (const field of fields.slice(0,3)) {
    const value = limits[field];
    if (value !== undefined && u64(value, field) === 0n) throw new RangeError(`${field} must be positive`);
    write(value ?? 0n);
  }
  if (limits.rollingQuote !== undefined) {
    for (const field of ['limit','seconds']) {
      if (u64(limits.rollingQuote[field], field) === 0n) throw new RangeError(`${field} must be positive`);
    }
  }
  write(limits.rollingQuote?.limit ?? 0n);
  write(limits.rollingQuote?.seconds ?? 0n);
  if (u64(policy.maxQuoteAgeSlots) === 0n) throw new RangeError('maxQuoteAgeSlots must be positive');
  write(policy.maxQuoteAgeSlots);
  if (offset !== POLICY_BYTES) throw new Error('internal wire-size mismatch');
  return bytes;
}

export async function sha256(bytes) {
  if (globalThis.crypto?.subtle) return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return portableSha256(bytes);
}
export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
export const policyFingerprint = async policy => hex(await sha256(encodePolicy(policy)));

/** Require the exact serialized signed transaction, not a hand-estimated instruction size. */
export function requireAtomicActivation(serializedTransactions) {
  if (!Array.isArray(serializedTransactions) || serializedTransactions.length !== 1) {
    throw new Error('activation must fit in one transaction; automatic splitting is forbidden');
  }
  const bytes = serializedTransactions[0];
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 1232) {
    throw new Error('activation must contain one nonempty transaction of at most 1232 bytes');
  }
  return new Uint8Array(bytes);
}

/** Local workflow ticket. It is NOT a chain receipt or proof of RPC execution. */
export async function simulationTicket({ policy, messageBytes, cluster, simulatedAtSlot, succeeded }) {
  if (!(messageBytes instanceof Uint8Array) || messageBytes.length === 0) throw new TypeError('message bytes required');
  if (typeof cluster !== 'string' || !cluster) throw new TypeError('cluster required');
  if (typeof succeeded !== 'boolean') throw new TypeError('simulation outcome required');
  return Object.freeze({
    policyFingerprint: await policyFingerprint(policy),
    messageHash: hex(await sha256(messageBytes)),
    cluster,
    simulatedAtSlot: u64(simulatedAtSlot),
    succeeded,
    evidence: 'local-workflow-ticket',
  });
}

export async function validateSimulationTicket(ticket, { policy, messageBytes, cluster, currentSlot }) {
  const now = u64(currentSlot);
  if (ticket.evidence !== 'local-workflow-ticket' || ticket.succeeded !== true) throw new Error('a successful simulation is required');
  if (ticket.cluster !== cluster) throw new Error('simulation belongs to another cluster');
  if (ticket.policyFingerprint !== await policyFingerprint(policy)) throw new Error('rules changed; simulate the selected draft again');
  if (ticket.messageHash !== hex(await sha256(messageBytes))) throw new Error('transaction changed; simulate again');
  const at = u64(ticket.simulatedAtSlot);
  if (at > now || now - at > policy.maxQuoteAgeSlots) throw new Error('simulation is stale');
  return true;
}

/** Presets use the actual quote mint's decimals, never a universal SOL denominator. */
export function quoteLimit({ mint, symbol, decimals, amount }) {
  key(mint,'quote mint');
  if (typeof symbol !== 'string' || !symbol.trim()) throw new TypeError('quote symbol required');
  return Object.freeze({ mint: new Uint8Array(mint), symbol, decimals, raw: parseAmount(amount, decimals) });
}
