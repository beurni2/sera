# WO-6.4 fresh-context verifier brief (mandatory — safety/custody path)

A fresh-context verifier subagent (no memory of the build) was dispatched against committed bytes `eaea0de`, given only the DoD, the diff location, and this mandate:

- **(A)** Rider store: by its own hands, raise an out-of-hours SOS (responder 'founder') and call `acknowledgeSos('dispatcher')` — confirm it THROWS and the incident is byte-unchanged; symmetric in-hours case; confirm the correct responder still acks and is credited.
- **(B)** Console: same responder-mismatch throw + matching-responder success against `sandbox-incident.ts`.
- **(C)** Type-level: confirm both apps typecheck (a live `@ts-expect-error` means tsc saw the expected error), and INDEPENDENTLY prove non-vacuity by making a lying literal match its responder in a throwaway copy and confirming tsc then flags the directive as unused.
- **(D)** Gallery: re-run the capture TWICE and sha256-diff every PNG; report identical/differing + differing-pixel region; confirm no gate byte-compares the PNGs and no PNG is tracked.
- **(E)** Run `run-gates.sh` once; report final line + exit code.
- **(F)** FORBIDDEN-check: no journey/custody semantics touched, no franc, no new dep, no disabled check.

Verbatim verdict in `verifier-verdict.md`.
