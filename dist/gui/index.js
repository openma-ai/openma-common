/**
 * GUI-facing OpenMA surface.
 *
 * Console / UI code should import from `@openma/common/gui` (or
 * `session-events/openma` + `protocol/managed` decode/encode) and must not
 * read Claude Managed Agents wire fields such as `processed_at` for behavior.
 *
 * Boundary:
 *   CMA wire  --decodeManagedSessionEvent-->  OpenMA events  -->  GUI
 *   GUI       --encodeManagedSessionInput-->  CMA wire
 */
export { OPENMA_EVENT_SCHEMA_VERSION, OPENMA_CANONICAL_EVENT_TYPES, OPENMA_EVENT_TYPES, createOpenMAEvent, isOpenMAEvent, isOpenMAQueuedEvent, } from "../session-events/openma.js";
export { decodeManagedSessionEvent, decodeManagedStreamEvent, encodeManagedSessionInput, } from "../protocol/managed/index.js";
//# sourceMappingURL=index.js.map