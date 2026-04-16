import { Send, Users, MessageSquare, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";

const stats = [
  { icon: Send, label: "Campanhas ativas", value: "3", trend: "+2 este mês" },
  { icon: MessageSquare, label: "Mensagens enviadas", value: "12.847", trend: "+4.2k esta semana" },
  { icon: Users, label: "Contatos ativos", value: "2.340", trend: "+180 este mês" },
  { icon: Zap, label: "Taxa de entrega", value: "98.2%", trend: "+0.3% vs. mês anterior" },
];

export function Dashboard() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar breadcrumbs={[{ label: "Dashboard" }]} />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Bem-vindo, Bruno</h1>
          <p className="text-gray-500 mt-1">A inteligência que cultiva resultados</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center mb-3">
                <s.icon className="w-4.5 h-4.5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
              <p className="text-xs text-green-600 mt-1 font-medium">{s.trend}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
            <Send className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Shooting — Disparos WhatsApp</h2>
          <p className="text-gray-500 mt-2 max-w-md mx-auto">
            Envie mensagens em massa via API oficial do WhatsApp Business com rastreamento em tempo real.
          </p>
          <Button className="mt-6" size="lg" onClick={() => navigate("/shooting")}>
            Acessar Shooting
          </Button>
        </div>
      </div>
    </div>
  );
}
