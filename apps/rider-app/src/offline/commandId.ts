/**
 * SERA-S1 · the offline MINT SEAM (canon derivation `COMMAND-ID-MINT.md`: "APPS
 * adopts `mintCommandId` at its isolated offline seam `src/offline/commandId.ts`").
 *
 * It ADOPTS the canon reference helper — it never re-implements it. Re-implementing
 * the branded `CommandIdSchema` or the mint would be canon drift (the founder ruling
 * ships ONE mint shape all consumers validate to). RN-SAFE: it imports the canon
 * command-id SUBPATH (`@platform/contracts/dist/command-id.js` — pure `zod`, no node
 * builtins, no barrel), never the `@platform/contracts` barrel the RN-safe scanner
 * keeps out of the shell.
 *
 * The OS CSPRNG the helper reads (`globalThis.crypto.randomUUID`) is provided by
 * Node in tests and by expo-crypto on device (see `ensureCsprng.ts`). `Math.random`
 * is FORBIDDEN as an idempotency-key source (the mint-path-entropy gate proves it).
 */
export { mintCommandId, CommandIdSchema, type CommandId } from '@platform/contracts/dist/command-id.js';
