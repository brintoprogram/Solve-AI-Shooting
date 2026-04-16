import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-green-100 text-green-700 border border-green-200",
        secondary: "bg-gray-100 text-gray-700 border border-gray-200",
        destructive: "bg-red-100 text-red-700 border border-red-200",
        outline: "border border-gray-300 text-gray-700",
        amber: "bg-amber-100 text-amber-700 border border-amber-200",
        blue: "bg-blue-100 text-blue-700 border border-blue-200",
        purple: "bg-purple-100 text-purple-700 border border-purple-200",
        green: "bg-green-100 text-green-700 border border-green-200",
        gray: "bg-gray-100 text-gray-500 border border-gray-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
