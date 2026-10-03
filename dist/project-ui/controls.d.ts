import type { ButtonHTMLAttributes, ReactNode } from "react";
export declare function projectErrorText(error: unknown): string;
export declare function ProjectButton({ variant, icon, className, type, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "outline";
    icon?: boolean;
}): import("react").JSX.Element;
export declare function ProjectDialog({ open, title, description, onClose, children, wide, }: {
    open: boolean;
    title: string;
    description?: string;
    onClose: () => void;
    children: ReactNode;
    wide?: boolean;
}): import("react").JSX.Element | null;
//# sourceMappingURL=controls.d.ts.map