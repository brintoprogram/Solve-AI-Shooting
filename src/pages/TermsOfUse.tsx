import { Link } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";

export function TermsOfUse() {
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
          <FileText className="w-4 h-4 text-agro-green" />
          <span className="text-sm font-semibold text-agro-text">Solve<span className="text-agro-green">.AI</span></span>
        </div>
        <Link to="/privacidade" className="text-xs text-agro-muted hover:text-agro-green transition-colors">
          Política de Privacidade →
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
            <FileText className="w-3 h-3" />
            Contrato de Uso
          </div>
          <h1 className="text-3xl font-bold text-agro-text mb-3">Termos de Uso</h1>
          <p className="text-sm text-agro-muted">
            Última atualização: <span className="text-agro-text">08 de maio de 2026</span>
          </p>
        </div>

        <div className="space-y-8 text-sm text-agro-muted leading-relaxed">

          <Section title="1. Aceitação dos Termos">
            <p>
              Ao acessar ou utilizar a plataforma <strong className="text-agro-text">Solve AI</strong>, você concorda com
              estes Termos de Uso em sua totalidade. Se não concordar com qualquer disposição, não utilize o serviço.
              Estes Termos constituem um contrato vinculante entre você (ou a empresa que representa) e a
              <strong className="text-agro-text"> Solve AI Consulting</strong>.
            </p>
          </Section>

          <Section title="2. Descrição do Serviço">
            <p className="mb-3">
              A Solve AI é uma plataforma SaaS (Software as a Service) de automação e disparo de mensagens via WhatsApp,
              que oferece:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Disparos em massa de mensagens via WhatsApp (Z-API e WhatsApp Business API oficial)</li>
              <li>Inbox centralizado para gestão de conversas</li>
              <li>Agentes de inteligência artificial para atendimento automatizado</li>
              <li>Gestão de contatos, templates e campanhas</li>
              <li>Relatórios de desempenho e auditoria</li>
              <li>Automações e fluxos de mensagens</li>
            </ul>
            <p className="mt-3">
              O serviço é prestado "no estado em que se encontra" e pode sofrer alterações, adições ou remoções de
              funcionalidades a qualquer momento, com aviso prévio sempre que possível.
            </p>
          </Section>

          <Section title="3. Elegibilidade e Cadastro">
            <ul className="list-disc pl-5 space-y-2">
              <li>Você deve ter pelo menos <strong className="text-agro-text">18 anos</strong> de idade para usar a plataforma.</li>
              <li>Empresas devem ser representadas por um responsável legal devidamente autorizado.</li>
              <li>As informações fornecidas no cadastro devem ser <strong className="text-agro-text">verdadeiras, completas e atualizadas</strong>.</li>
              <li>Você é responsável por manter a confidencialidade de suas credenciais de acesso.</li>
              <li>Qualquer atividade realizada sob sua conta é de sua inteira responsabilidade.</li>
            </ul>
          </Section>

          <Section title="4. Uso Aceitável">
            <p className="mb-3">Ao usar a Solve AI, você concorda em:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Utilizar a plataforma apenas para fins <strong className="text-agro-text">legais e legítimos</strong>.</li>
              <li>Obter o <strong className="text-agro-text">consentimento explícito</strong> dos destinatários antes de enviar mensagens, conforme exigido pela LGPD e pelas políticas do WhatsApp/Meta.</li>
              <li>Respeitar integralmente os <strong className="text-agro-text">Termos de Serviço do WhatsApp e da Meta</strong>, incluindo restrições sobre conteúdo, frequência de envio e opt-out.</li>
              <li>Não utilizar a plataforma para envio de <strong className="text-agro-text">spam</strong> ou comunicações não solicitadas.</li>
              <li>Manter seus dados de contato atualizados e remover imediatamente quaisquer contatos que solicitarem opt-out.</li>
            </ul>
          </Section>

          <Section title="5. Uso Proibido">
            <p className="mb-3">É expressamente proibido:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Enviar conteúdo ilegal, difamatório, discriminatório, obsceno ou que viole direitos de terceiros.</li>
              <li>Utilizar a plataforma para <strong className="text-agro-text">phishing</strong>, fraudes, golpes ou qualquer atividade enganosa.</li>
              <li>Tentar contornar, desabilitar ou interferir nos mecanismos de segurança da plataforma.</li>
              <li>Realizar engenharia reversa, descompilar ou extrair o código-fonte da plataforma.</li>
              <li>Compartilhar credenciais de acesso com terceiros não autorizados.</li>
              <li>Utilizar a plataforma de forma que possa causar banimento de números WhatsApp vinculados ao serviço.</li>
              <li>Revender, sublicenciar ou disponibilizar o acesso à plataforma a terceiros sem autorização expressa.</li>
            </ul>
            <p className="mt-3">
              O descumprimento destas proibições pode resultar na <strong className="text-agro-text">suspensão imediata</strong> da conta,
              sem direito a reembolso, e eventual responsabilização civil e criminal.
            </p>
          </Section>

          <Section title="6. Responsabilidade pelo Conteúdo">
            <p>
              A Solve AI atua como <strong className="text-agro-text">operadora de dados</strong> nos termos da LGPD, processando
              informações conforme as instruções do cliente (controlador). O cliente é exclusivamente responsável por:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>O conteúdo de todas as mensagens enviadas pela plataforma.</li>
              <li>A legalidade da base de contatos utilizada.</li>
              <li>A obtenção e gestão dos consentimentos necessários.</li>
              <li>O cumprimento das leis aplicáveis em sua jurisdição.</li>
            </ul>
            <p className="mt-3">
              A Solve AI não revisa o conteúdo das mensagens antes do envio e não se responsabiliza por danos decorrentes
              do uso indevido da plataforma pelo cliente.
            </p>
          </Section>

          <Section title="7. Planos, Pagamento e Cancelamento">
            <ul className="list-disc pl-5 space-y-2">
              <li>Os planos e preços são exibidos na plataforma e podem ser alterados com aviso prévio de <strong className="text-agro-text">30 dias</strong>.</li>
              <li>O pagamento é realizado de forma <strong className="text-agro-text">antecipada</strong> (mensal ou anual), conforme o plano escolhido.</li>
              <li>Não há reembolso proporcional por cancelamento antecipado, salvo previsão contratual específica.</li>
              <li>Em caso de inadimplência, a conta pode ser suspensa após <strong className="text-agro-text">7 dias</strong> de atraso e encerrada após 30 dias.</li>
              <li>O cancelamento pode ser solicitado a qualquer momento; o acesso permanece ativo até o fim do período já pago.</li>
            </ul>
          </Section>

          <Section title="8. Propriedade Intelectual">
            <p>
              Todo o conteúdo da plataforma — incluindo software, design, logos, textos, interfaces e funcionalidades —
              é de propriedade exclusiva da <strong className="text-agro-text">Solve AI Consulting</strong> ou de seus
              licenciadores. É concedida ao cliente uma licença limitada, não exclusiva e intransferível de uso da
              plataforma durante a vigência do contrato. Nenhum direito de propriedade intelectual é transferido ao cliente.
            </p>
          </Section>

          <Section title="9. Disponibilidade e SLA">
            <p>
              A Solve AI empenha esforços razoáveis para manter a plataforma disponível <strong className="text-agro-text">24/7</strong>,
              mas não garante disponibilidade ininterrupta. Manutenções programadas serão comunicadas com antecedência.
              Indisponibilidades causadas por terceiros (WhatsApp/Meta, Z-API, infraestrutura de nuvem) estão fora do
              controle da Solve AI e não geram direito a crédito ou reembolso.
            </p>
          </Section>

          <Section title="10. Limitação de Responsabilidade">
            <p className="mb-3">
              Na máxima extensão permitida pela lei, a Solve AI não será responsável por:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Danos indiretos, incidentais, especiais ou consequenciais.</li>
              <li>Perda de lucros, receita, dados ou oportunidades de negócio.</li>
              <li>Danos resultantes do banimento de números WhatsApp pela Meta.</li>
              <li>Interrupções no serviço causadas por terceiros ou por casos fortuitos/força maior.</li>
            </ul>
            <p className="mt-3">
              A responsabilidade total da Solve AI, em qualquer hipótese, fica limitada ao valor pago pelo cliente
              nos últimos <strong className="text-agro-text">3 meses</strong> de serviço.
            </p>
          </Section>

          <Section title="11. Rescisão">
            <p>
              A Solve AI pode encerrar ou suspender seu acesso imediatamente, sem aviso prévio, caso você viole estes
              Termos ou use a plataforma de forma que cause riscos legais, reputacionais ou técnicos. Você pode encerrar
              sua conta a qualquer momento através das configurações da plataforma ou por e-mail. Após o encerramento,
              seus dados serão retidos conforme descrito na Política de Privacidade.
            </p>
          </Section>

          <Section title="12. Alterações nos Termos">
            <p>
              Podemos revisar estes Termos periodicamente. Notificaremos usuários sobre mudanças materiais com
              antecedência mínima de <strong className="text-agro-text">15 dias</strong> por e-mail ou aviso na plataforma.
              O uso continuado após a data de vigência constitui aceitação da versão atualizada.
            </p>
          </Section>

          <Section title="13. Lei Aplicável e Foro">
            <p>
              Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de
              <strong className="text-agro-text"> São Paulo/SP</strong> para dirimir quaisquer controvérsias decorrentes
              deste instrumento, com exclusão de qualquer outro, por mais privilegiado que seja.
            </p>
          </Section>

          <Section title="14. Contato">
            <p>Para dúvidas, solicitações ou notificações relacionadas a estes Termos:</p>
            <div className="mt-3 p-4 rounded-xl" style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.12)" }}>
              <p className="text-agro-text font-semibold">Solve AI Consulting</p>
              <p className="mt-1">
                E-mail:{" "}
                <a href="mailto:contato@solveai.consulting" className="text-agro-green hover:underline">
                  contato@solveai.consulting
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
            <Link to="/privacidade" className="hover:text-agro-green transition-colors">Política de Privacidade</Link>
            <Link to="/login" className="hover:text-agro-green transition-colors">Acessar plataforma</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
