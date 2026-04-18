import { useState } from "react";
import { Users, Upload } from "lucide-react";
import { ImportModal } from "./contacts/ImportModal";

export function Contacts() {
  const [showImport, setShowImport] = useState(false);

  return (
    <div className="flex flex-col h-full" style={{ background: "#0a110e" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2e22] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1e2e22] flex items-center justify-center">
            <Users className="w-5 h-5 text-[#3fb06c]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Contatos</h1>
            <p className="text-xs text-[#6b7f6e]">Gerencie seus contatos e histórico de boletos</p>
          </div>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="btn-agro flex items-center gap-2 px-4 py-2 text-sm"
        >
          <Upload className="w-4 h-4" />
          Importar planilha
        </button>
      </div>

      {/* Empty state */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#1e2e22] flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-[#3fb06c]/50" />
          </div>
          <p className="text-lg font-semibold text-white mb-2">Nenhum contato ainda</p>
          <p className="text-sm text-[#6b7f6e] mb-6">
            Importe uma planilha CSV ou XLSX para adicionar contatos e boletos em massa.
          </p>
          <button
            onClick={() => setShowImport(true)}
            className="btn-agro flex items-center gap-2 px-5 py-2.5 text-sm mx-auto"
          >
            <Upload className="w-4 h-4" />
            Importar planilha
          </button>
        </div>
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
