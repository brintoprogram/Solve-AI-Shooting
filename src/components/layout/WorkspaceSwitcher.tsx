import { useRef, useState, useEffect } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export function WorkspaceSwitcher() {
  const { workspaces, workspaceId, switchWorkspace } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Hooks must always be called before any early return.
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // Only render for users that belong to more than one workspace.
  if (workspaces.length <= 1) return null;

  const current = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium transition-all duration-200"
        style={{
          background: open ? "rgba(63,176,108,0.12)" : "rgba(63,176,108,0.06)",
          border: "1px solid rgba(63,176,108,0.2)",
          color: "#3fb06c",
        }}
      >
        <Building2 className="w-3.5 h-3.5 shrink-0" />
        <span className="max-w-[120px] truncate">{current?.name ?? "Workspace"}</span>
        <ChevronDown
          className="w-3 h-3 shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-9 w-56 rounded-xl overflow-hidden z-50"
          style={{
            background: "#0d1a11",
            border: "1px solid rgba(63,176,108,0.2)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div
            className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest"
            style={{
              color: "#3fb06c",
              borderBottom: "1px solid rgba(63,176,108,0.1)",
            }}
          >
            Workspaces
          </div>

          <div className="py-1">
            {workspaces.map((ws) => {
              const isActive = ws.id === workspaceId;
              return (
                <button
                  key={ws.id}
                  onClick={() => {
                    setOpen(false);
                    if (!isActive) switchWorkspace(ws.id);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors duration-150"
                  style={{
                    color: isActive ? "#3fb06c" : "#9ca3af",
                    background: isActive ? "rgba(63,176,108,0.08)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = isActive ? "rgba(63,176,108,0.08)" : "transparent";
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate text-left">{ws.name}</span>
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
