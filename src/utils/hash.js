import crypto from 'node:crypto';

export function stableHash(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export function hashToBucket(input, modulo = 100) {
  const hash = stableHash(input);
  const slice = hash.slice(0, 8);
  return parseInt(slice, 16) % modulo;
}
