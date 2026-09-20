import {
  policyFromTrustRelease,
  verifyReceiptKeyAttestation,
} from "../attestation.js";

/** Internal dependency seam used by the frozen receipt fixture tests. */
export const receiptVerificationDependencies = {
  policyFromTrustRelease,
  verifyReceiptKeyAttestation,
};
