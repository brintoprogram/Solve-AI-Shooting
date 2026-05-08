import { Link } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between"
        style={{ background: "rgba(10,17,14,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}
      >
        <Link
          to="/login"
          className="flex items-center gap-2 text-sm text-agro-muted hover:text-agro-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Link>
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-agro-green" />
          <span className="text-sm font-semibold text-agro-text">Solve<span className="text-agro-green">.AI</span></span>
        </div>
        <Link to="/termos" className="text-xs text-agro-muted hover:text-agro-green transition-colors">
          Termos de Uso →
        </Link>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Title */}
        <div className="mb-10">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
            style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)", color: "#3fb06c" }}
          >
            <Shield className="w-3 h-3" />
            Privacidade & Dados
          </div>
          <h1 className="text-3xl font-bold text-agro-text mb-3">Política de Privacidade</h1>
          <p className="text-sm text-agro-muted">
            Última atualização: <span className="text-agro-text">08 de maio de 2026</span>
          </p>
        </div>

        <div className="space-y-8 text-sm text-agro-muted leading-relaxed">

          <Section title="1. Quem somos">
            <p>
              A <strong className="text-agro-text">Solve AI</strong> é uma plataforma de automação e disparo de mensagens via WhatsApp,
              operada por <strong className="text-agro-text">Solve AI Consulting</strong> (CNPJ a identificar), com sede no Brasil.
              Esta Política de Privacidade descreve como coletamos, usamos, armazenamos e protegemos as informações dos
              nossos clientes e dos contatos por eles gerenciados na plataforma.
            </p>
          </Section>

          <Section title="2. Dados que coletamos">
            <p className="mb-3">Coletamos dois tipos de dados:</p>
            <SubSection title="2.1 Dados dos nossos clientes (usuários da plataforma)">
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Nome completo e endereço de e-mail (cadastro e autenticação)</li>
                <li>Cargo e função dentro do workspace</li>
                <li>Logs de acesso e atividade (auditoria de segurança)</li>
                <li>Dados de conexões WhatsApp configuradas (tokens criptografados com AES-256-GCM)</li>
              </ul>
            </SubSection>
            <SubSection title="2.2 Dados dos contatos gerenciados">
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Número de telefone (identificador único no WhatsApp)</li>
                <li>Nome e demais campos importados pelo cliente via planilha ou cadastro</li>
                <li>Histórico de mensagens trocadas pela plataforma</li>
                <li>Metadados de entrega (status de envio, leitura, resposta)</li>
              </ul>
            </SubSection>
          </Section>

          <Section title="3. Como usamos os dados">
            <ul className="list-disc pl-5 space-y-2">
              <li>Prestação do serviço contratado (disparos, inbox, relatórios)</li>
              <li>Autenticação e controle de acesso por workspace</li>
              <li>Geração de relatórios e métricas de campanha para o próprio cliente</li>
              <li>Detecção de abuso e conformidade com os Termos de Serviço do WhatsApp / Meta</li>
              <li>Suporte técnico e diagnóstico de problemas</li>
              <li>Cumprimento de obrigações legais e regulatórias</li>
            </ul>
            <p className="mt-3">
              <strong className="text-agro-text">Não vendemos, alugamos ou compartilhamos</strong> dados pessoais de clientes
              ou de seus contatos com terceiros para fins comerciais.
            </p>
          </Section>

          <Section title="4. Base legal (LGPD)">
            <p className="mb-3">
              Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), o tratamento dos dados se fundamenta em:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong className="text-agro-text">Execução de contrato</strong> — para entregar os serviços contratados pelo cliente.</li>
              <li><strong className="text-agro-text">Legítimo interesse</strong> — para segurança, prevenção de fraudes e melhorias do produto.</li>
              <li><strong className="text-agro-text">Obrigação legal</strong> — quando exigido por lei ou autoridade competente.</li>
              <li><strong className="text-agro-text">Consentimento</strong> — quando aplicável e coletado de forma explícita.</li>
            </ul>
            <p className="mt-3">
              É responsabilidade do <strong className="text-agro-text">cliente</strong> (controlador dos dados de seus contatos)
              garantir que os destinatários de suas campanhas consentiram em receber comunicações via WhatsApp, conforme
              exigido pela LGPD e pelos Termos de Serviço da Meta.
            </p>
          </Section>

          <Section title="5. Armazenamento e segurança">
            <ul className="list-disc pl-5 space-y-2">
              <li>Dados armazenados na infraestrutura <strong className="text-agro-text">Supabase</strong> (PostgreSQL), com servidores na região da AWS us-east-1.</li>
              <li>Tokens de integração (WhatsApp, APIs externas) criptografados em repouso com <strong className="text-agro-text">AES-256-GCM</strong>.</li>
              <li>Comunicações em trânsito protegidas por <strong className="text-agro-text">TLS 1.2+</strong>.</li>
              <li>Acesso ao banco de dados restrito por Row Level Security (RLS), garantindo isolamento total entre workspaces.</li>
              <li>Logs de auditoria para todas as ações sensíveis (criação de campanhas, exportações, alterações de equipe).</li>
            </ul>
          </Section>

          <Section title="6. Retenção de dados">
            <ul className="list-disc pl-5 space-y-2">
              <li>Dados de conta: mantidos durante a vigência do contrato e por até <strong className="text-agro-text">5 anos</strong> após o encerramento para fins fiscais e legais.</li>
              <li>Histórico de mensagens e campanhas: mantido conforme o plano contratado; o cliente pode solicitar exclusão a qualquer momento.</li>
              <li>Logs de auditoria: retidos por <strong className="text-agro-text">12 meses</strong>.</li>
            </ul>
          </Section>

          <Section title="7. Seus direitos (titular dos dados)">
            <p className="mb-3">Nos termos da LGPD, você tem direito a:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Confirmar a existência e acessar seus dados</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados</li>
              <li>Solicitar anonimização, bloqueio ou eliminação de dados desnecessários</li>
              <li>Portabilidade dos dados a outro fornecedor de serviço</li>
              <li>Revogar consentimento, quando aplicável</li>
              <li>Peticionar perante a Autoridade Nacional de Proteção de Dados (ANPD)</li>
            </ul>
            <p className="mt-3">
              Para exercer qualquer desses direitos, entre em contato pelo e-mail{" "}
              <a href="mailto:privacidade@solveai.consulting" className="text-agro-green hover:underline">
                privacidade@solveai.consulting
              </a>.
            </p>
          </Section>

          <Section title="8. Cookies e tecnologias similares">
            <p>
              Utilizamos cookies estritamente necessários para autenticação de sessão e preferências de interface.
              Não utilizamos cookies de rastreamento ou publicidade de terceiros.
            </p>
          </Section>

          <Section title="9. Subprocessadores">
            <p className="mb-3">Para entregar nosso serviço, utilizamos os seguintes subprocessadores:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(63,176,108,0.15)" }}>
                    <th className="text-left py-2 pr-4 text-agro-text font-semibold">Fornecedor</th>
                    <th className="text-left py-2 pr-4 text-agro-text font-semibold">Finalidade</th>
                    <th className="text-left py-2 text-agro-text font-semibold">Região</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "rgba(63,176,108,0.08)" }}>
                  {[
                    ["Supabase", "Banco de dados e autenticação", "EUA (AWS)"],
                    ["Meta / WhatsApp Business API", "Envio de mensagens (canal oficial)", "Global"],
                    ["Z-API", "Envio de mensagens (WhatsApp conectado)", "Brasil"],
                    ["Anthropic / OpenAI", "Processamento de IA para agentes (opcional)", "EUA"],
                  ].map(([name, purpose, region]) => (
                    <tr key={name}>
                      <td className="py-2 pr-4 text-agro-text font-medium">{name}</td>
                      <td className="py-2 pr-4">{purpose}</td>
                      <td className="py-2">{region}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="10. Alterações nesta política">
            <p>
              Podemos atualizar esta Política periodicamente. Notificaremos os usuários sobre mudanças materiais por
              e-mail ou aviso na plataforma com antecedência mínima de <strong className="text-agro-text">15 dias</strong>.
              O uso continuado do serviço após a data de vigência implica concordância com a versão atualizada.
            </p>
          </Section>

          <Section title="11. Contato">
            <p>
              Dúvidas, solicitações ou reclamações relacionadas a privacidade e proteção de dados:
            </p>
            <div className="mt-3 p-4 rounded-xl" style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.12)" }}>
              <p className="text-agro-text font-semibold">Encarregado de Dados (DPO)</p>
              <p className="mt-1">Solve AI Consulting</p>
              <p>
                E-mail:{" "}
                <a href="mailto:privacidade@solveai.consulting" className="text-agro-green hover:underline">
                  privacidade@solveai.consulting
                </a>
              </p>
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div
          className="mt-12 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-agro-muted"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
        >
          <p>© 2026 Solve AI Consulting. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4">
            <Link to="/termos" className="hover:text-agro-green transition-colors">Termos de Uso</Link>
            <Link to="/login" className="hover:text-agro-green transition-colors">Acessar plataforma</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2
        className="text-base font-bold text-agro-text mb-3 pb-2"
        style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}
      >
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-agro-text font-semibold mb-1.5">{title}</p>
      {children}
    </div>
  );
}
