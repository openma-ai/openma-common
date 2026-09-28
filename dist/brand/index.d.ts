export declare const COMMON_THEME_TOKEN_NAMES: readonly ["brand", "brand-hover", "brand-subtle", "brand-fg", "bg", "bg-sidebar", "bg-surface", "bg-bubble", "bg-overlay", "fg", "fg-muted", "fg-subtle", "border", "border-strong", "success", "success-subtle", "warning", "warning-subtle", "danger", "danger-subtle", "info", "info-subtle", "accent-violet", "accent-violet-subtle", "shadow-md", "shadow-sm", "shadow-card-soft", "shadow-card-press", "shadow-input-rest", "shadow-chip-press", "shadow-pip", "ring"];
export type CommonThemeTokenName = (typeof COMMON_THEME_TOKEN_NAMES)[number];
export type CommonThemeTokens = Record<CommonThemeTokenName, string>;
export declare const OPENMA_BRAND_RGB: readonly [248, 79, 50];
export declare const OPENMA_ICON_ID: "openma";
export declare const OPENMA_MARK_VIEW_BOX: "240 244 548 454";
export declare const OPENMA_MARK_PATHS: readonly ["M279 363H346C356 363 363 371 363 381V397C363 407 356 414 346 414H320C312 414 308 419 308 427V620C308 628 313 633 321 633H349C357 633 363 640 363 648V665C363 675 355 683 345 683H279C265 683 254 672 254 658V388C254 374 265 363 279 363Z", "M748 363H681C671 363 666 371 666 381V397C666 407 673 414 683 414H708C716 414 720 419 720 427V620C720 628 715 633 707 633H680C671 633 666 640 666 648V665C666 675 674 683 684 683H748C762 683 773 672 773 658V388C773 374 762 363 748 363Z", "M500 258C496 258 491 260 488 264C486 267 485 271 485 275V343C485 351 491 357 499 357H575C583 357 587 348 581 342L507 264C505 261 503 258 500 258Z"];
export declare const OPENMA_MARK_CIRCLE: {
    readonly cx: 535;
    readonly cy: 520;
    readonly r: 42;
};
/** Full SVG markup accepted by hosts such as Obsidian's `addIcon`. */
export declare const OPENMA_ICON_INNER_SVG: string;
export declare const commonLightTokens: CommonThemeTokens;
export declare const commonDarkTokens: CommonThemeTokens;
//# sourceMappingURL=index.d.ts.map