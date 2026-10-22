// zk.js — NeedToKnow crypto core. Zero dependencies (BigInt + WebCrypto).
//
//   • secp256k1 group arithmetic (Jacobian coordinates, fixed-base window tables)
//   • Pedersen commitments  C = v·G + r·H   (H = hash-to-curve, nobody knows log_G H)
//   • Schnorr signatures     — issuers sign commitments → "committed credentials"
//   • Predicate proofs (non-interactive Σ-protocols, Fiat–Shamir, bound to a verifier nonce)
//       attr ≥ t, attr ≤ t : bit-decomposition range proof, CDS OR-proof per bit
//       attr == t          : Schnorr proof of knowledge of log_H(C − t·G)
//
// Works in modern browsers and Node ≥ 19 (ES module, top-level await).

const P = 2n ** 256n - 2n ** 32n - 977n;
export const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const G = {
  X: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
  Y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,
  Z: 1n,
};
const ZERO = { X: 0n, Y: 1n, Z: 0n };
export const RANGE_BITS = 32;

// ---------- field / group ----------
const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function powmod(b, e, m) {
  let r = 1n; b = mod(b, m);
  while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; }
  return r;
}
const inv = (a, m = P) => powmod(a, m - 2n, m);

function dbl(p) {
  if (p.Z === 0n || p.Y === 0n) return ZERO;
  const { X, Y, Z } = p;
  const A = X * X % P, B = Y * Y % P, C = B * B % P;
  const D = mod(2n * ((X + B) ** 2n - A - C));
  const E = 3n * A % P;
  const X3 = mod(E * E - 2n * D);
  return { X: X3, Y: mod(E * (D - X3) - 8n * C), Z: 2n * Y * Z % P };
}
function add(p, q) {
  if (p.Z === 0n) return q;
  if (q.Z === 0n) return p;
  const Z1Z1 = p.Z * p.Z % P, Z2Z2 = q.Z * q.Z % P;
  const U1 = p.X * Z2Z2 % P, U2 = q.X * Z1Z1 % P;
  const S1 = p.Y * q.Z % P * Z2Z2 % P, S2 = q.Y * p.Z % P * Z1Z1 % P;
  const H = mod(U2 - U1), r = mod(S2 - S1);
  if (H === 0n) return r === 0n ? dbl(p) : ZERO;
  const HH = H * H % P, HHH = H * HH % P, V = U1 * HH % P;
  const X3 = mod(r * r - HHH - 2n * V);
  return { X: X3, Y: mod(r * (V - X3) - S1 * HHH), Z: p.Z * q.Z % P * H % P };
}
const neg = (p) => (p.Z === 0n ? p : { X: p.X, Y: mod(-p.Y), Z: p.Z });
const sub = (p, q) => add(p, neg(q));

function mulVar(p, k) {
  k = mod(k, N);
  let R = ZERO, Q = p;
  while (k > 0n) { if (k & 1n) R = add(R, Q); Q = dbl(Q); k >>= 1n; }
  return R;
}
// 4-bit fixed-base windows: 64 rows × 16 multiples
function makeTable(B) {
  const T = []; let base = B;
  for (let w = 0; w < 64; w++) {
    const row = [ZERO];
    for (let j = 1; j < 16; j++) row.push(add(row[j - 1], base));
    T.push(row);
    base = add(row[15], base);
  }
  return T;
}
function mulFixed(T, k) {
  k = mod(k, N);
  let R = ZERO;
  for (let w = 0; w < 64 && k > 0n; w++) {
    const j = Number(k & 15n);
    if (j) R = add(R, T[w][j]);
    k >>= 4n;
  }
  return R;
}

function toAffine(p) {
  if (p.Z === 0n) return null;
  const zi = inv(p.Z), zi2 = zi * zi % P;
  return { x: p.X * zi2 % P, y: p.Y * zi2 % P * zi % P };
}
export function encode(p) {
  const a = toAffine(p);
  if (!a) return '00';
  return (a.y & 1n ? '03' : '02') + a.x.toString(16).padStart(64, '0');
}
export function decode(hex) {
  if (hex === '00') return ZERO;
  if (!/^0[23][0-9a-f]{64}$/.test(hex)) throw new Error('bad point encoding');
  const x = BigInt('0x' + hex.slice(2));
  if (x >= P) throw new Error('bad point encoding');
  const y2 = mod(x * x % P * x + 7n);
  let y = powmod(y2, (P + 1n) / 4n, P);
  if (y * y % P !== y2) throw new Error('point not on curve');
  if ((y & 1n) !== (hex[1] === '3' ? 1n : 0n)) y = P - y;
  return { X: x, Y: y, Z: 1n };
}
const eqPt = (p, q) => encode(p) === encode(q);

// ---------- hashing / randomness ----------
const te = new TextEncoder();
export async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', te.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const hashToScalar = async (...parts) => mod(BigInt('0x' + await sha256hex(JSON.stringify(parts))), N);
export function randScalar() {
  const b = new Uint8Array(48);
  crypto.getRandomValues(b);
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return mod(x, N) || 1n;
}
const hx = (k) => k.toString(16);
const fromHx = (s) => {
  if (typeof s !== 'string' || !/^[0-9a-f]{1,64}$/.test(s)) throw new Error('bad scalar');
  const k = BigInt('0x' + s);
  if (k >= N) throw new Error('bad scalar');
  return k;
};

async function hashToPoint(label) {
  for (let i = 0; ; i++) {
    const x = mod(BigInt('0x' + await sha256hex(`${label}:${i}`)));
    const y2 = mod(x * x % P * x + 7n);
    const y = powmod(y2, (P + 1n) / 4n, P);
    if (y * y % P === y2) return { X: x, Y: y, Z: 1n };
  }
}

const H = await hashToPoint('NeedToKnow/pedersen-H/v1');
const TG = makeTable(G);
const TH = makeTable(H);
const NEG_G = neg(G);

// ---------- Pedersen + Schnorr ----------
export function commit(v, r) {
  return encode(add(mulFixed(TG, BigInt(v)), mulFixed(TH, r)));
}

export function keygen() {
  const sk = randScalar();
  return { sk: hx(sk), pk: encode(mulFixed(TG, sk)) };
}
export async function sign(skHex, msg) {
  const sk = fromHx(skHex), k = randScalar();
  const R = encode(mulFixed(TG, k));
  const pk = encode(mulFixed(TG, sk));
  const e = await hashToScalar('sig', R, pk, msg);
  return { R, s: hx(mod(k + e * sk, N)) };
}
export async function verifySig(pkHex, msg, sig) {
  try {
    const e = await hashToScalar('sig', sig.R, pkHex, msg);
    return eqPt(mulFixed(TG, fromHx(sig.s)), add(decode(sig.R), mulVar(decode(pkHex), e)));
  } catch { return false; }
}

// ---------- credentials ----------
// The issuer knows the true value v (it is the DMV / payroll / bureau). It commits, signs the
// commitment, and hands (v, r) to the holder's wallet. Verifiers only ever see C + signature.
export const credMessage = (c) => JSON.stringify({ attr: c.attr, C: c.C, issuer: c.issuer, serial: c.serial });

export async function issueCredential(issuer, attr, value, serial) {
  const r = randScalar();
  const cred = { attr, C: commit(value, r), issuer: issuer.name, serial };
  cred.sig = await sign(issuer.sk, credMessage(cred));
  return { cred, secret: { v: String(value), r: hx(r) } };
}

// ---------- predicate proofs ----------
const ctxOf = (nonce, pred, C) => JSON.stringify({ nonce, pred, C });

// Proves d ∈ [0, 2^RANGE_BITS) for Cd = d·G + r·H.
// `cheatD` lets the UI demonstrate a dishonest prover: it commits to bits of a fake d.
async function proveNonNeg(d, r, ctx, cheatD) {
  const dd = cheatD ?? d;
  if (dd < 0n || dd >= 1n << BigInt(RANGE_BITS)) throw new Error('PREDICATE_FALSE');
  const rs = []; let acc = 0n;
  for (let i = 0; i < RANGE_BITS; i++) {
    const w = 1n << BigInt(i);
    const ri = i < RANGE_BITS - 1 ? randScalar() : mod((r - acc) * inv(w, N), N);
    acc = mod(acc + ri * w, N);
    rs.push(ri);
  }
  const bits = [];
  for (let i = 0; i < RANGE_BITS; i++) {
    const b = (dd >> BigInt(i)) & 1n;
    const Ci = add(mulFixed(TG, b), mulFixed(TH, rs[i]));
    const Y = [Ci, add(Ci, NEG_G)]; // b=0: Ci = r·H   b=1: Ci − G = r·H
    const j = Number(b), o = 1 - j;
    const k = randScalar(), eo = randScalar(), so = randScalar();
    const T = [];
    T[j] = mulFixed(TH, k);
    T[o] = sub(mulFixed(TH, so), mulVar(Y[o], eo));
    const C = encode(Ci);
    const e = await hashToScalar('bit', ctx, i, C, encode(T[0]), encode(T[1]));
    const es = [], ss = [];
    es[o] = eo; ss[o] = so;
    es[j] = mod(e - eo, N); ss[j] = mod(k + es[j] * rs[i], N);
    bits.push({ C, e0: hx(es[0]), e1: hx(es[1]), s0: hx(ss[0]), s1: hx(ss[1]) });
  }
  return bits;
}

async function verifyNonNeg(Cd, bits, ctx) {
  if (!Array.isArray(bits) || bits.length !== RANGE_BITS) return { ok: false, why: 'wrong bit count' };
  const Cs = [];
  for (let i = 0; i < RANGE_BITS; i++) {
    const b = bits[i];
    const Ci = decode(b.C);
    const e0 = fromHx(b.e0), e1 = fromHx(b.e1), s0 = fromHx(b.s0), s1 = fromHx(b.s1);
    const T0 = sub(mulFixed(TH, s0), mulVar(Ci, e0));
    const T1 = sub(mulFixed(TH, s1), mulVar(add(Ci, NEG_G), e1));
    const e = await hashToScalar('bit', ctx, i, b.C, encode(T0), encode(T1));
    if (mod(e0 + e1, N) !== e) return { ok: false, why: `bit ${i}: OR-proof invalid` };
    Cs.push(Ci);
  }
  let sum = ZERO; // Horner: Σ 2^i·C_i
  for (let i = RANGE_BITS - 1; i >= 0; i--) sum = add(dbl(sum), Cs[i]);
  if (!eqPt(sum, Cd)) return { ok: false, why: 'bit commitments do not recombine to the credential' };
  return { ok: true };
}

// Statement commitment the prover must open, derived identically by both sides.
function statementCommitment(C, pred) {
  const t = BigInt(pred.value);
  if (pred.op === '>=') return sub(C, mulFixed(TG, t)); // (v−t)·G + r·H
  if (pred.op === '<=') return sub(mulFixed(TG, t), C); // (t−v)·G − r·H
  if (pred.op === '==') return sub(C, mulFixed(TG, t)); //       0·G + r·H
  throw new Error('unknown op');
}

export function holds(secret, pred) {
  const v = BigInt(secret.v), t = BigInt(pred.value);
  return pred.op === '>=' ? v >= t : pred.op === '<=' ? v <= t : v === t;
}

// pred = { attr, op: '>=' | '<=' | '==', value }
export async function provePredicate(cred, secret, pred, nonce, { cheat = false } = {}) {
  const C = decode(cred.C);
  const v = BigInt(secret.v), r = fromHx(secret.r), t = BigInt(pred.value);
  const ctx = ctxOf(nonce, pred, cred.C);
  if (pred.op === '==') {
    if (v !== t && !cheat) throw new Error('PREDICATE_FALSE');
    const k = randScalar();
    const e = await hashToScalar('eq', ctx, encode(mulFixed(TH, k)));
    return { kind: 'eq', e: hx(e), s: hx(mod(k + e * r, N)) };
  }
  const d = pred.op === '>=' ? v - t : t - v;
  const rd = pred.op === '>=' ? r : mod(-r, N);
  const bits = await proveNonNeg(d, rd, ctx, cheat && d < 0n ? 0n : undefined);
  return { kind: 'range', bits };
}

export async function verifyPredicate(cred, pred, proof, nonce) {
  try {
    if (cred.attr !== pred.attr) return { ok: false, why: 'credential is for a different attribute' };
    const Cd = statementCommitment(decode(cred.C), pred);
    const ctx = ctxOf(nonce, pred, cred.C);
    if (pred.op === '==') {
      if (proof.kind !== 'eq') return { ok: false, why: 'wrong proof type' };
      const e = fromHx(proof.e), s = fromHx(proof.s);
      const T = sub(mulFixed(TH, s), mulVar(Cd, e));
      const ok = (await hashToScalar('eq', ctx, encode(T))) === e;
      return ok ? { ok } : { ok, why: 'equality proof invalid' };
    }
    if (proof.kind !== 'range') return { ok: false, why: 'wrong proof type' };
    return await verifyNonNeg(Cd, proof.bits, ctx);
  } catch (err) {
    return { ok: false, why: 'malformed proof: ' + err.message };
  }
}

// Verifier entry point: checks issuer signature, nonce binding and each predicate.
export async function verifyPresentation(pres, { nonce, requested, trustedIssuers }) {
  const results = [];
  if (pres.nonce !== nonce) return { ok: false, results, why: 'stale or replayed presentation (nonce mismatch)' };
  for (const want of requested) {
    const item = pres.items.find((it) => JSON.stringify(it.pred) === JSON.stringify(want));
    if (!item) { results.push({ pred: want, ok: false, why: 'not provided' }); continue; }
    const pk = trustedIssuers[item.cred.issuer];
    if (!pk) { results.push({ pred: want, ok: false, why: 'untrusted issuer' }); continue; }
    if (!(await verifySig(pk, credMessage(item.cred), item.cred.sig))) {
      results.push({ pred: want, ok: false, why: 'issuer signature invalid' }); continue;
    }
    results.push({ pred: want, ...(await verifyPredicate(item.cred, want, item.proof, nonce)) });
  }
  return { ok: results.every((r) => r.ok), results };
}
