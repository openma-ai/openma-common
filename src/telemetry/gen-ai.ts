/** OpenTelemetry GenAI semantic-convention attribute names. */
export const GEN_AI = {
  operationName: "gen_ai.operation.name",
  providerName: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  conversationId: "gen_ai.conversation.id",
  agentName: "gen_ai.agent.name",
  agentId: "gen_ai.agent.id",
  toolName: "gen_ai.tool.name",
  toolCallId: "gen_ai.tool.call.id",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  errorType: "error.type",
} as const;

export const GEN_AI_OPERATIONS = {
  createAgent: "create_agent",
  invokeAgent: "invoke_agent",
  executeTool: "execute_tool",
} as const;

/** Product-neutral attributes this package adds next to GenAI ones. */
export const OPENMA_ATTR = {
  turnId: "openma.turn_id",
  acpSessionId: "openma.acp_session_id",
  promptChars: "openma.prompt_chars",
  toolKind: "openma.acp.tool_kind",
  endReason: "openma.end_reason",
  contextUsed: "openma.acp.context_used",
  contextSize: "openma.acp.context_size",
  costAmount: "openma.acp.cost_amount",
} as const;
