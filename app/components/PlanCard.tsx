import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import { Button } from "@/app/components/Button";
import { ArrowUpRight } from "lucide-react";

interface PlanCardProps {
  name: string;
  description: string;
  price: string;
  current: boolean;
  onUpgrade: () => void;
  loading?: boolean;
  billingType?: string;
  upgradeDisabled?: boolean;
}

export function PlanCard({
  name,
  description,
  price,
  current,
  onUpgrade,
  loading,
  billingType,
  upgradeDisabled,
}: PlanCardProps) {
  return (
    <div
      className={`border rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between ${current ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-zinc-200 dark:border-zinc-700"}`}
    >
      <div>
        <Heading level={3} className="mb-1">
          {name}
        </Heading>
        <Paragraph className="mb-1">{description}</Paragraph>
        <div className="font-semibold text-lg">{price}</div>
        {billingType === "metered" && (
          <div className="text-xs text-gray-500 mt-0.5">
            Billed at end of billing period based on usage
          </div>
        )}
      </div>
      <div className="mt-4 sm:mt-0">
        {current ? (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
            Current plan
          </span>
        ) : (
          <Button
            variant="outline"
            iconLeft={<ArrowUpRight className="w-4 h-4" />}
            onClick={onUpgrade}
            loading={loading}
            disabled={upgradeDisabled}
          >
            Upgrade
          </Button>
        )}
      </div>
    </div>
  );
}
