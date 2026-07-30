import * as address from 'bitcoinjs-lib/src/address';

export function convertHexToBtcAddress(hexStr: string): string {
  if (!hexStr.startsWith('0x') || hexStr.length < 4) {
    throw new Error('Hex string must start with 0x and have version prefix');
  }

  const versionHex = hexStr.substring(2, 4);
  const hashHex = hexStr.substring(4);
  const hash = Buffer.from(hashHex, 'hex');

  console.log(hexStr, " -hash.length ----- ", hash.length, " versionHex ", versionHex, " hashHex ", hashHex)
  switch (versionHex) {
    case '01':
      if (hash.length === 20) {
        return address.toBase58Check(hash, 0x00);
      }
      if (hash.length === 32) {
        return address.toBech32(hash, 1, 'bc');
      }
      throw new Error('P2PKH Or P2TR v0 requires 20 or 32-byte hash');

    case '05':
      if (hash.length !== 20) {
        throw new Error('P2SH requires 20-byte hash');
      }
      return address.toBase58Check(hash, 0x05);

    case '00':
      if (hash.length === 20) {
        return address.toBech32(hash, 0, 'bc');
      }
      if (hash.length === 32) {
        return address.toBech32(hash, 0, 'bc');
      }
      throw new Error('Bech32 v0 requires 20 or 32-byte hash');

    default:
      throw new Error(`Unsupported version prefix: 0x${versionHex}`);
  }
}

export function isFirst12Zero(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes.slice(0, 12).every(byte => byte === 0);
}

type MergeValue = string | number | bigint | boolean | null | undefined | { toString(): string };

export function mergeArraysWithColon(
  arr1?: MergeValue[] | null,
  arr2?: MergeValue[] | null,
): string[] {
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
    return [];
  }

  const minLength = Math.min(arr1.length, arr2.length);

  return Array.from({ length: minLength }, (_, i) =>
    arr1[i] == null || arr2[i] == null ? null : `${arr1[i]}:${arr2[i]}`
  ).filter((value): value is string => value !== null);
}

export function parseMintAccount(data: Buffer): { decimals: number } {
  return {
    decimals: data.readUInt8(44),
  };
}
