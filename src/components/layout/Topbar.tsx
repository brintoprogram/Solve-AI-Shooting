import { Bell, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface TopbarProps {
  breadcrumbs: Array<{ label: string; href?: string }>;
}

export function Topbar({ breadcrumbs }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5">
        {breadcrumbs.map((crumb, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
            <span
              className={
                i === breadcrumbs.length - 1
                  ? "text-sm font-semibold text-gray-900"
                  : "text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
              }
            >
              {crumb.label}
            </span>
          </div>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500" />
        </Button>
        <Avatar className="w-8 h-8">
          <AvatarFallback className="text-xs">BR</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
