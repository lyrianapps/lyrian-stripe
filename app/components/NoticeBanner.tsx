export type NoticeBannerVariant = "error" | "success" | "warning";

export interface NoticeBannerConfig {
  variant: NoticeBannerVariant;
  title: string;
  body: string;
}

const variantStyles: Record<
  NoticeBannerVariant,
  { wrapper: string; body: string }
> = {
  error: {
    wrapper: "bg-red-50 border-red-200 text-red-800",
    body: "text-red-700",
  },
  success: {
    wrapper: "bg-green-50 border-green-200 text-green-800",
    body: "text-green-700",
  },
  warning: {
    wrapper: "bg-yellow-50 border-yellow-200 text-yellow-800",
    body: "text-yellow-700",
  },
};

export function NoticeBanner({ variant, title, body }: NoticeBannerConfig) {
  const styles = variantStyles[variant];
  return (
    <div className={`mb-4 rounded-md border p-4 ${styles.wrapper}`}>
      <div className="font-semibold">{title}</div>
      <p className={`text-sm mt-1 ${styles.body}`}>{body}</p>
    </div>
  );
}
