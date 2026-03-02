import { deflateSync, inflateSync } from "fflate";

export type CompressionAlgorithm = 0x00 | 0x01;

export interface CompressionResult {
  data: Uint8Array;
  algorithm: CompressionAlgorithm;
}

export function compress(input: Uint8Array): CompressionResult {
  if (input.length === 0) {
    return { data: input, algorithm: 0x00 };
  }

  const compressed = deflateSync(input);

  if (compressed.length >= input.length) {
    return { data: input, algorithm: 0x00 };
  }

  return { data: compressed, algorithm: 0x01 };
}

export function decompress(
  input: Uint8Array,
  algorithm: CompressionAlgorithm,
): Uint8Array {
  if (algorithm === 0x00) {
    return input;
  }
  return inflateSync(input);
}
