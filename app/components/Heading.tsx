import { ReactNode, JSX } from "react";

interface HeadingProps {
  children: ReactNode;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}

export function Heading({ children, level = 2, className = "" }: HeadingProps) {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  return (
    <Tag
      className={`font-bold text-zinc-900 dark:text-zinc-100 mb-2 text-${level === 1 ? "3xl" : level === 2 ? "2xl" : level === 3 ? "xl" : "lg"} ${className}`}
    >
      {children}
    </Tag>
  );
}
