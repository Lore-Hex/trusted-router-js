import {
  policyFromTrustRelease,
  verifyGatewayAttestation,
} from "../attestation.js";

/** Internal dependency seam used by the frozen receipt fixture tests. */
export const receiptVerificationDependencies = {
  policyFromTrustRelease,
  verifyGatewayAttestation,
};
