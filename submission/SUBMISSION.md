# Devpost submission: NeedToKnow

## Project name (≤ 60)
NeedToKnow: AI agent that shares proofs, not your data

## Elevator pitch (≤ 200)
Agents now talk to agents, and sensitive checks still mean handing over raw data. NeedToKnow lets any agent prove facts with zero-knowledge proofs. Demo: prove balance ≥ $10K, reveal $0 of it.

## Thumbnail
`thumbnail2.png` (1200×800, 3:2). Alternative: `thumbnail.png`

## About the project
See `about.md` (Markdown + LaTeX); `about-preview.html` renders it locally.

---

## Track
Track 2: Personal agents and data privacy

## Inspiration
Personal AI agents are about to fill out forms, apply for apartments and open accounts for us. Today that means forwarding SSNs, pay stubs and bank statements wholesale, when the other side only needs a handful of yes/no answers: *Is this person 18+? Do they earn 3× rent? Is their credit above 680?* Every extra field becomes breach liability for the service and a privacy loss for the user. And an LLM agent holding raw personal data is one prompt injection away from leaking it.

## What it does
NeedToKnow is a personal agent plus a cryptographic wallet:
1. **Minimize:** The agent (Claude) reads any data request and maps every item to either *drop* (with a reason) or the narrowest predicate that answers the service's actual question.
2. **Consent:** The user approves each proof on a consent card that shows recipient, purpose and what leaves the device, or a standing policy auto-approves low-risk proofs (age, residency).
3. **Prove:** The wallet produces zero-knowledge proofs over issuer-signed credentials. The service verifies the issuer signature and the proof, and learns one bit per predicate.
4. **Record:** Every disclosure is appended to a hash-chained consent ledger.

**Privacy from your own agent:** The LLM only ever sees the vault *schema*, never values. A prompt-injection attack embedded in a request is flagged, and even if the model obeyed, there would be nothing to leak.

Demo scenarios: apartment application, car rental (auto-approved by policy), a premium card the user doesn't qualify for (the honest wallet refuses; a forged proof is rejected by the verifier), a prompt-injection attack, a replay attack, and any custom request a judge types in.

## How we built it
- **Crypto core (zero dependencies, ~280 lines of JS):** secp256k1 arithmetic on BigInt, Pedersen commitments with a hash-to-curve second generator, Schnorr-signed committed credentials, range proofs (bit decomposition + CDS OR-proofs) for ≥/≤ and Schnorr proofs for equality, made non-interactive with Fiat–Shamir bound to a per-session verifier nonce. Batch issuance gives each service a fresh, unlinkable credential.
- **Agent:** Claude (`claude-opus-5-5`) via the Anthropic SDK with a strict tool schema (`submit_disclosure_plan`). Predicates are validated and translated by the wallet; the model can't invent unsupported statements.
- **UI:** vanilla HTML/JS with three panes: vault, agent, and the service's view, so judges see exactly what crosses the wire.

## Challenges we ran into
Keeping the LLM out of the trust boundary: the model plans, but the wallet decides what is provable and checks truth locally. Making 32-bit range proofs fast enough for a live demo (~45 ms prove / ~60 ms verify in the browser).

## Accomplishments we're proud of
A real, sound ZK protocol written from scratch in a day. A forged proof is rejected live, and so is a replayed one. The service receives **0 of N** requested raw values.

## What we learned
Agent privacy is a systems problem, not a prompt problem. If the model never holds the data, no jailbreak can leak it.

## What's next
Bulletproofs (log-size range proofs), BBS+ for multi-show unlinkability, revocation via accumulators, an MCP server so any agent can use NeedToKnow as its privacy layer, and integration with mobile driver's license / EU digital identity wallet credentials.

## Built with
JavaScript, Node.js, WebCrypto, secp256k1, Pedersen commitments, Sigma protocols, Anthropic Claude API

## Credits
AI-assisted development with Claude Code (Anthropic). No third-party crypto libraries. All personal data in the demo is synthetic.
