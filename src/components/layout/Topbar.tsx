import { Bell, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface TopbarProps {
  breadcrumbs: Array<{ label: string; href?: string }>;
}

export function Topbar({ breadcrumbs }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-20 h-14 flex items-center justify-between px-6"
      style={{
        background: "rgba(10,17,14,0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(63,176,108,0.08)",
      }}
    >
      {/* Left: logo + breadcrumb */}
      <div className="flex items-center gap-3">
        <Link to="/" className="shrink-0 flex items-center">
          <img
            src="/logo.png"
            alt="Solve AI"
            className="h-9 w-auto object-contain"
            style={{ filter: "drop-shadow(0 0 8px rgba(63,176,108,0.3))" }}
          />
        </Link>

        {/* Subtle divider */}
        <div
          className="h-5 w-px shrink-0"
          style={{ background: "rgba(63,176,108,0.15)" }}
        />

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5">
          {breadcrumbs.map((crumb, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-agro-muted-2" />}
              <span className={
                i === breadcrumbs.length - 1
                  ? "text-sm font-semibold text-agro-text"
                  : "text-sm text-agro-muted-2"
              }>
                {crumb.label}
              </span>
            </div>
          ))}
        </nav>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors duration-200"
          style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-agro-green glow-green-sm" />
        </button>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
        >
          BR
        </div>
      </div>
    </header>
  );
}
