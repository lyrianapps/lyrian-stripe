import { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader } from "lucide-react";
import classNames from "classnames";

type ButtonVariant = "filled" | "outline" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  variant?: ButtonVariant;
}

export function Button({
  children,
  loading,
  iconLeft,
  iconRight,
  variant = "filled",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center gap-2 px-4 py-2 rounded font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const variantMap: Record<string, string> = {
    filled: "bg-blue-600 text-white hover:bg-blue-700",
    outline:
      "border border-blue-600 text-blue-600 bg-transparent hover:bg-blue-50 dark:hover:bg-blue-900",
    ghost:
      "bg-transparent text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900",
  };
  const variantClass = variantMap[variant] || variantMap.filled;
  return (
    <button
      className={classNames(base, variantClass)}
      disabled={loading || props.disabled}
      {...props}
    >
      {iconLeft && <span>{iconLeft}</span>}
      {loading ? <Loader className="animate-spin" size={18} /> : children}
      {iconRight && <span>{iconRight}</span>}
    </button>
  );
}
