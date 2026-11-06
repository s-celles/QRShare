/** Byte reader/writer of the OpenTimestamps serialisation (LEB128 varuint, varbytes). */

export class OtsError extends Error {}

export class Reader {
  private o = 0;
  constructor(private readonly bytes: Uint8Array) {}

  atEnd(): boolean {
    return this.o >= this.bytes.length;
  }

  byte(): number {
    if (this.o >= this.bytes.length) throw new OtsError("Truncated proof");
    return this.bytes[this.o++];
  }

  take(n: number): Uint8Array {
    if (this.o + n > this.bytes.length) throw new OtsError("Truncated proof");
    const out = this.bytes.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }

  varuint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * scale;
      if (!(b & 0x80)) break;
      scale *= 128;
      if (scale > 2 ** 56) throw new OtsError("varuint too large");
    }
    if (!Number.isSafeInteger(value)) throw new OtsError("varuint too large");
    return value;
  }

  varbytes(max: number, min = 0): Uint8Array {
    const n = this.varuint();
    if (n > max || n < min) throw new OtsError(`varbytes length ${n} out of bounds`);
    return this.take(n);
  }
}

export class Writer {
  private readonly parts: number[] = [];

  byte(b: number): void {
    this.parts.push(b & 255);
  }

  bytes(b: Uint8Array): void {
    for (const x of b) this.parts.push(x);
  }

  varuint(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new OtsError("Bad varuint");
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      this.parts.push(b);
    } while (n > 0);
  }

  varbytes(b: Uint8Array): void {
    this.varuint(b.length);
    this.bytes(b);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}
