export type AcpSystemNotice = {
    message: string;
    tone: "warning";
};
export declare function splitAcpSystemNoticeText(text: string): {
    notice?: string;
    transcript: string;
};
export declare function extractAcpSystemNotice(event: unknown): AcpSystemNotice | null;
//# sourceMappingURL=acp-system-notices.d.ts.map