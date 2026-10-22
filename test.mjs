// node test.mjs — soundness / completeness smoke tests for zk.js
import * as zk from './zk.js';

let fails = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };

const issuer = { name: 'Payroll Issuer', ...zk.keygen() };
const trusted = { [issuer.name]: issuer.pk };
const { cred, secret } = await zk.issueCredential(issuer, 'income', 124000, 'inc-1');
check('issuer signature verifies', await zk.verifySig(issuer.pk, zk.credMessage(cred), cred.sig));

const nonce = 'nonce-123';
const ge = { attr: 'income', op: '>=', value: 100800 };
let t = performance.now();
const proof = await zk.provePredicate(cred, secret, ge, nonce);
console.log(`  prove ${(performance.now() - t).toFixed(0)} ms, ${JSON.stringify(proof).length} bytes`);
t = performance.now();
const pres = { nonce, items: [{ pred: ge, cred, proof }] };
const v = await zk.verifyPresentation(pres, { nonce, requested: [ge], trustedIssuers: trusted });
console.log(`  verify ${(performance.now() - t).toFixed(0)} ms`);
check('income >= 100800 accepted', v.ok);

check('replay with other nonce rejected',
  !(await zk.verifyPresentation(pres, { nonce: 'other', requested: [ge], trustedIssuers: trusted })).ok);
check('proof for other threshold rejected',
  !(await zk.verifyPredicate(cred, { ...ge, value: 120000 }, proof, nonce)).ok);

const tooHigh = { attr: 'income', op: '>=', value: 150000 };
let threw = false;
try { await zk.provePredicate(cred, secret, tooHigh, nonce); } catch (e) { threw = e.message === 'PREDICATE_FALSE'; }
check('honest prover refuses false predicate', threw);
const forged = await zk.provePredicate(cred, secret, tooHigh, nonce, { cheat: true });
const fr = await zk.verifyPredicate(cred, tooHigh, forged, nonce);
check(`forged >= proof rejected (${fr.why})`, !fr.ok);

const le = { attr: 'income', op: '<=', value: 200000 };
check('income <= 200000 accepted', (await zk.verifyPredicate(cred, le, await zk.provePredicate(cred, secret, le, nonce), nonce)).ok);
const leBad = { attr: 'income', op: '<=', value: 100000 };
check('forged <= proof rejected', !(await zk.verifyPredicate(cred, leBad, await zk.provePredicate(cred, secret, leBad, nonce, { cheat: true }), nonce)).ok);

const st = await zk.issueCredential(issuer, 'state', 0x4341, 'st-1');
const eq = { attr: 'state', op: '==', value: 0x4341 };
check('state == CA accepted', (await zk.verifyPredicate(st.cred, eq, await zk.provePredicate(st.cred, st.secret, eq, nonce), nonce)).ok);
const eqNY = { attr: 'state', op: '==', value: 0x4e59 };
check('forged state == NY rejected', !(await zk.verifyPredicate(st.cred, eqNY, await zk.provePredicate(st.cred, st.secret, eqNY, nonce, { cheat: true }), nonce)).ok);

const tampered = structuredClone(cred); tampered.C = st.cred.C;
check('swapped commitment fails issuer signature',
  !(await zk.verifyPresentation({ nonce, items: [{ pred: ge, cred: tampered, proof }] }, { nonce, requested: [ge], trustedIssuers: trusted })).ok);

process.exit(fails ? 1 : 0);
