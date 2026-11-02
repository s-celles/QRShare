/**
 * Reed-Solomon over GF(2^8) (primitive polynomial 0x11d, generator α = 2,
 * first consecutive root α^0), for shortened codes of length n ≤ 255.
 *
 * - `rsEncode(msg, nsym)` returns the systematic codeword `msg ‖ parity`.
 * - `rsDecode(cw, nsym, erasures)` corrects errors and erasures as long as
 *   2·errors + erasures ≤ nsym (Berlekamp–Massey with Forney syndromes, Chien
 *   search, Forney algorithm), and verifies the result has a zero syndrome.
 *
 * Polynomials are arrays of coefficients, highest degree first (REQ-AUD-070, 074).
 */

const PRIM = 0x11d;
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("GF(256) division by zero");
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

export function gfPow(a: number, power: number): number {
  if (a === 0) return power === 0 ? 1 : 0;
  return EXP[(((LOG[a] * power) % 255) + 255) % 255];
}

export function gfInverse(a: number): number {
  if (a === 0) throw new Error("GF(256) inverse of zero");
  return EXP[255 - LOG[a]];
}

type Poly = number[];

function polyScale(p: Poly, x: number): Poly {
  return p.map((c) => gfMul(c, x));
}

function polyAdd(p: Poly, q: Poly): Poly {
  const r = new Array<number>(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}

function polyMul(p: Poly, q: Poly): Poly {
  const r = new Array<number>(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) {
    if (q[j] === 0) continue;
    for (let i = 0; i < p.length; i++) r[i + j] ^= gfMul(p[i], q[j]);
  }
  return r;
}

function polyEval(p: ArrayLike<number>, x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = gfMul(y, x) ^ p[i];
  return y;
}

const generatorCache = new Map<number, Poly>();

function generatorPoly(nsym: number): Poly {
  let g = generatorCache.get(nsym);
  if (!g) {
    g = [1];
    for (let i = 0; i < nsym; i++) g = polyMul(g, [1, gfPow(2, i)]);
    generatorCache.set(nsym, g);
  }
  return g;
}

/** Systematic RS encoding: returns `msg ‖ parity` (length msg.length + nsym ≤ 255). */
export function rsEncode(msg: Uint8Array, nsym: number): Uint8Array {
  if (nsym < 1) throw new Error("rsEncode: nsym must be ≥ 1");
  if (msg.length + nsym > 255) throw new Error(`rsEncode: codeword length ${msg.length + nsym} > 255`);
  const gen = generatorPoly(nsym);
  const out = new Uint8Array(msg.length + nsym);
  out.set(msg);
  // Polynomial long division; the remainder lands in the parity bytes.
  const work = new Uint8Array(out);
  for (let i = 0; i < msg.length; i++) {
    const coef = work[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j++) work[i + j] ^= gfMul(gen[j], coef);
  }
  out.set(work.subarray(msg.length), msg.length);
  return out;
}

function calcSyndromes(msg: ArrayLike<number>, nsym: number): number[] {
  const synd = new Array<number>(nsym + 1).fill(0); // synd[0] is padding
  for (let i = 0; i < nsym; i++) synd[i + 1] = polyEval(msg, gfPow(2, i));
  return synd;
}

function forneySyndromes(synd: number[], erasePos: number[], nmess: number): number[] {
  const fsynd = synd.slice(1);
  for (const p of erasePos) {
    const x = gfPow(2, nmess - 1 - p);
    for (let j = 0; j < fsynd.length - 1; j++) fsynd[j] = gfMul(fsynd[j], x) ^ fsynd[j + 1];
  }
  return fsynd;
}

function findErrorLocator(synd: number[], nsym: number, eraseCount: number): Poly | null {
  let errLoc: Poly = [1];
  let oldLoc: Poly = [1];
  const syndShift = synd.length > nsym ? synd.length - nsym : 0;
  for (let i = 0; i < nsym - eraseCount; i++) {
    const k = i + syndShift;
    let delta = synd[k];
    for (let j = 1; j < errLoc.length; j++) delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[k - j]);
    oldLoc = [...oldLoc, 0];
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, gfInverse(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if (errs * 2 + eraseCount > nsym) return null;
  return errLoc;
}

function findErrors(errLocReversed: Poly, nmess: number): number[] | null {
  const errs = errLocReversed.length - 1;
  const pos: number[] = [];
  for (let i = 0; i < nmess; i++) {
    if (polyEval(errLocReversed, gfPow(2, i)) === 0) pos.push(nmess - 1 - i);
  }
  return pos.length === errs ? pos : null;
}

function errataLocator(coefPos: number[]): Poly {
  let loc: Poly = [1];
  for (const i of coefPos) loc = polyMul(loc, polyAdd([1], [gfPow(2, i), 0]));
  return loc;
}

function errorEvaluator(synd: Poly, errLoc: Poly, nsym: number): Poly {
  const product = polyMul(synd, errLoc);
  // remainder of product / x^(nsym+1)
  return product.slice(product.length - (nsym + 1));
}

function correctErrata(msg: number[], synd: number[], errPos: number[]): number[] | null {
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  const errLoc = errataLocator(coefPos);
  const errEval = errorEvaluator([...synd].reverse(), errLoc, errLoc.length - 1).reverse();
  const X = coefPos.map((c) => gfPow(2, c));
  const E = new Array<number>(msg.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xiInv = gfInverse(X[i]);
    let locPrime = 1;
    for (let j = 0; j < X.length; j++) {
      if (j !== i) locPrime = gfMul(locPrime, 1 ^ gfMul(xiInv, X[j]));
    }
    if (locPrime === 0) return null;
    const y = gfMul(X[i], polyEval([...errEval].reverse(), xiInv));
    E[errPos[i]] = gfDiv(y, locPrime);
  }
  return msg.map((v, i) => v ^ E[i]);
}

export type RsDecodeResult =
  | { ok: true; data: Uint8Array; corrected: number }
  | { ok: false };

/**
 * Decodes a codeword (data ‖ nsym parity bytes), correcting errors and the given
 * erasure positions (indices into the codeword). Returns the data part.
 */
export function rsDecode(codeword: Uint8Array, nsym: number, erasures: readonly number[] = []): RsDecodeResult {
  const n = codeword.length;
  if (n > 255 || n <= nsym) return { ok: false };
  const erasePos = [...new Set(erasures)].filter((p) => p >= 0 && p < n);
  if (erasePos.length > nsym) return { ok: false };

  let msg = Array.from(codeword);
  for (const p of erasePos) msg[p] = 0;
  const synd = calcSyndromes(msg, nsym);
  if (synd.every((s) => s === 0)) {
    let corrected = 0;
    for (const p of erasePos) if (codeword[p] !== msg[p]) corrected++;
    return { ok: true, data: Uint8Array.from(msg.slice(0, n - nsym)), corrected };
  }

  const fsynd = forneySyndromes(synd, erasePos, n);
  const errLoc = findErrorLocator(fsynd, nsym, erasePos.length);
  if (!errLoc) return { ok: false };
  const errPos = findErrors([...errLoc].reverse(), n);
  if (!errPos) return { ok: false };
  const all = [...erasePos, ...errPos.filter((p) => !erasePos.includes(p))];
  if (all.length === 0) return { ok: false };
  const fixed = correctErrata(msg, synd, all);
  if (!fixed) return { ok: false };
  if (calcSyndromes(fixed, nsym).some((s) => s !== 0)) return { ok: false };
  msg = fixed;

  let corrected = 0;
  for (let i = 0; i < n; i++) if (msg[i] !== codeword[i]) corrected++;
  return { ok: true, data: Uint8Array.from(msg.slice(0, n - nsym)), corrected };
}
