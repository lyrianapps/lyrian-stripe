import { ReactNode } from "react";

interface ParagraphProps {
  children: ReactNode;
  className?: string;
}

export function Paragraph({ children, className = "" }: ParagraphProps) {
  return (
    <p className={`text-zinc-700 dark:text-zinc-300 mb-4 ${className}`}>
      {children}
    </p>
  );
}
