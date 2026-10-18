/** OpenTelemetry GenAI semantic-convention attribute names. */
export declare const GEN_AI: {
    readonly operationName: "gen_ai.operation.name";
    readonly providerName: "gen_ai.provider.name";
    readonly requestModel: "gen_ai.request.model";
    readonly conversationId: "gen_ai.conversation.id";
    readonly agentName: "gen_ai.agent.name";
    readonly agentId: "gen_ai.agent.id";
    readonly toolName: "gen_ai.tool.name";
    readonly toolCallId: "gen_ai.tool.call.id";
    readonly usageInputTokens: "gen_ai.usage.input_tokens";
    readonly usageOutputTokens: "gen_ai.usage.output_tokens";
    readonly responseFinishReasons: "gen_ai.response.finish_reasons";
    readonly errorType: "error.type";
};
export declare const GEN_AI_OPERATIONS: {
    readonly createAgent: "create_agent";
    readonly invokeAgent: "invoke_agent";
    readonly executeTool: "execute_tool";
};
/** Product-neutral attributes this package adds next to GenAI ones. */
export declare const OPENMA_ATTR: {
    readonly turnId: "openma.turn_id";
    readonly acpSessionId: "openma.acp_session_id";
    readonly promptChars: "openma.prompt_chars";
    readonly toolKind: "openma.acp.tool_kind";
    readonly endReason: "openma.end_reason";
    readonly contextUsed: "openma.acp.context_used";
    readonly contextSize: "openma.acp.context_size";
    readonly costAmount: "openma.acp.cost_amount";
};
//# sourceMappingURL=gen-ai.d.ts.map