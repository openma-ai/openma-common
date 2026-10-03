import { createHash } from "node:crypto";
import type { AcpForkPoint } from "../acp-fork/index.js";

export {
  ACP_INCLUSIVE_FORK_CAPABILITY,
  ACP_INCLUSIVE_FORK_VERSION,
  acpForkPointsFromMessages,
  acpInclusiveForkCapabilityMeta,
  forkSupport,
} from "../acp-fork/index.js";
export type {
  AcpForkPoint,
  AcpForkSupport,
  AcpForkSupportLevel,
  AcpForkSupportReason,
  AcpForkSupportSource,
  AcpInclusiveForkCapability,
} from "../acp-fork/index.js";

/** Inclusive-fork `_meta` carried by `SessionOptions.sessionRequestMeta`.
 * The fingerprint is `sha256:` plus the SHA-256 of the message text's UTF-8 bytes.
 * Node-only: browser clients pass `AcpForkPoint` to the runtime instead of calling this. */
export function acpForkRequestMeta(point: AcpForkPoint): Record<string, unknown> {
  return {
    jetbrains: {
      air: {
        fork: {
          version: 1,
          messageId: point.messageId,
          messageFingerprint: `sha256:${createHash("sha256").update(point.messageText, "utf8").digest("hex")}`,
          messageOccurrence: point.messageOccurrence,
        },
      },
    },
  };
}
