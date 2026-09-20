# Boundary audit mutation results

Each source mutation was transpiled, its focused tests run, and the original source/output restored in a finally block. Both lint mutants ran `npm run lint`.

| Mutation | Source | Result | Failing regression / rule |
|---|---|---|---|
| header own lookup and HeadersInit | src/internal/transport.ts | killed | Boundary audit: header reader normalizes tuples and ignores inherited keys |
| telemetry tuple headers | src/internal/telemetry.ts | killed | Boundary audit: telemetry reads tuple headers through transport normalization |
| error attribution records | src/internal/errors.ts | killed | Boundary audit: error records exclude arrays |
| error message records | src/internal/errors.ts | killed | Boundary audit: error records exclude arrays |
| trust release record | src/internal/trust.ts | killed | Boundary audit: trust record |
| request record | src/client.ts | killed | Boundary audit: request record |
| status record | src/client.ts | killed | Boundary audit: status record |
| responses shape | src/client.ts | killed | Boundary audit: responses shape |
| token shape | src/client.ts | killed | Boundary audit: token shape |
| userinfo shape | src/client.ts | killed | Boundary audit: userinfo shape |
| OAuth shape | src/client.ts | killed | Boundary audit: OAuth shape |
| chat chunk shape | src/client.ts | killed | Boundary audit: chat chunk shape is checked before yielding |
| SSE event array shape | src/internal/sse.ts | killed | Boundary audit: response SSE arrays cannot become object events |
| SSE usage record | src/internal/sse.ts | killed | Boundary audit: completion record shapes exclude arrays |
| SSE choice record | src/internal/sse.ts | killed | Boundary audit: completion record shapes exclude arrays |
| SSE tool record | src/internal/sse.ts | killed | Boundary audit: completion record shapes exclude arrays |
| SSE tool function record | src/internal/sse.ts | killed | Boundary audit: completion record shapes exclude arrays |
| SSE envelope prototype key | src/internal/sse.ts | killed | Boundary audit: completion envelope copies prototype keys as data |
| SSE choice prototype key | src/internal/sse.ts | killed | Boundary audit: completion choice copies prototype keys as data |
| SSE message prototype key | src/internal/sse.ts | killed | Boundary audit: completion message copies prototype keys as data |
| SSE tool prototype key | src/internal/sse.ts | killed | Boundary audit: completion tool copies prototype keys as data |
| SSE tool function prototype key | src/internal/sse.ts | killed | Boundary audit: completion tool function copies prototype keys as data |
| SSE function call prototype key | src/internal/sse.ts | killed | Boundary audit: completion function call copies prototype keys as data |
| SSE synth prototype key | src/internal/sse.ts | killed | Boundary audit: completion synth copies prototype keys as data |
| JWT record boundary | src/attestation.ts | killed | Boundary audit: JWT header and claims must be records |
| fetched JWKS keys | src/attestation.ts | killed | Boundary audit: JWKS fetched and supplied keys must be records |
| supplied JWKS keys | src/attestation.ts | killed | Boundary audit: JWKS fetched and supplied keys must be records |
| RSA JWK fields | src/attestation.ts | killed | Boundary audit: RSA JWK fields must be strings |
| JWT nested container | src/attestation.ts | killed | Boundary audit: attestation nested records and nonce shape |
| JWT nonce array | src/attestation.ts | killed | Boundary audit: attestation nested records and nonce shape |
| beacon identity record | src/internal/beacon.ts | killed | Boundary audit: beacon identity rejects array records |
| beacon attempt record | src/internal/beacon.ts | killed | Boundary audit: beacon attempt rejects array records |
| beacon event record | src/internal/beacon.ts | killed | Boundary audit: beacon event rejects array records |
| beacon event attempts record | src/internal/beacon.ts | killed | Boundary audit: beacon event attempts rejects array records |
| beacon increment record | src/internal/beacon.ts | killed | Boundary audit: beacon increment rejects array records |
| beacon histogram record | src/internal/beacon.ts | killed | Boundary audit: beacon histogram rejects array records |
| beacon counter row record | src/internal/beacon.ts | killed | Boundary audit: beacon counter row rejects array records |
| beacon counter input record | src/internal/beacon.ts | killed | Boundary audit: beacon counter input rejects array records |
| beacon request record | src/internal/beacon.ts | killed | Boundary audit: beacon request rejects array records |
| beacon policy envelope record | src/internal/beacon.ts | killed | Boundary audit: beacon policy envelope rejects array records |
| beacon policy record | src/internal/beacon.ts | killed | Boundary audit: beacon policy rejects array records |
| CLI attestation record | src/cli/main.ts | killed | Boundary audit: attestation CLI does not spread an array as a record |
| transport pre-send error record | src/internal/transport.ts | killed | Boundary audit: malformed error arrays cannot authorize replay |
| transport cancellation error record | src/internal/transport.ts | killed | Boundary audit: malformed error arrays cannot impersonate cancellation |
| transport message record | src/internal/transport.ts | killed | Boundary audit: transport messages narrow error records |
| telemetry cause record | src/internal/telemetry.ts | killed | Boundary audit: telemetry error chains exclude array records |
| telemetry classifier records | src/internal/telemetry.ts | killed | Boundary audit: telemetry classifier excludes array records |
| telemetry timeout record | src/internal/telemetry.ts | killed | Boundary audit: telemetry timeout name excludes array records |
| lint prototype literal | src/__wave_b_mutant.ts | killed | error  Use ownProperty from src/internal/records.ts (or a Map) for data-keyed lookups  no-restricted-syntax |
| lint JSON.parse assertion | src/__wave_b_mutant.ts | killed | error  Narrow external data at runtime; an assertion must not hide any. Assign it to unknown first  boundaries/no-assert-any |
