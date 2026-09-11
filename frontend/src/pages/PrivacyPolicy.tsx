/**
 * WMS Kiwkiw - Política de Privacidade
 * Página pública e estática (sem login), exigida pelo Google para publicar
 * o app OAuth usado no envio de e-mails do Acesso Protegido ao Financeiro
 * (ver CLAUDE.md, seção "Acesso Protegido ao Financeiro").
 */

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-app text-t1 flex justify-center px-4 py-12">
      <div className="max-w-2xl w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Política de Privacidade — WMS Kiwkiw</h1>
          <p className="text-sm text-t3 mt-1">Última atualização: 11/09/2026</p>
        </div>

        <p className="text-sm text-t2 leading-relaxed">
          O WMS Kiwkiw é um sistema interno de gerenciamento de armazém (fulfillment),
          operado pela Kiwkiw para controlar recebimento, armazenagem e despacho de
          produtos de seus clientes ("sellers").
        </p>

        <section>
          <h2 className="text-base font-semibold mb-2">Quais dados tratamos</h2>
          <ul className="list-disc list-inside text-sm text-t2 space-y-1.5 leading-relaxed">
            <li>Dados de usuários internos (nome, e-mail, função) para autenticação e controle de acesso ao sistema.</li>
            <li>Dados operacionais dos sellers (pedidos, estoque, faturamento) necessários à prestação do serviço de fulfillment.</li>
            <li>E-mails enviados automaticamente a responsáveis autorizados para liberar acesso a áreas sensíveis do sistema (ex.: código de verificação para acesso ao Financeiro).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold mb-2">Como usamos</h2>
          <p className="text-sm text-t2 leading-relaxed">
            Exclusivamente para operar o sistema e prestar o serviço de fulfillment aos
            sellers. Não vendemos nem compartilhamos esses dados com terceiros para fins
            de marketing.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold mb-2">Provedores usados na operação</h2>
          <p className="text-sm text-t2 leading-relaxed">
            Hospedagem (Railway, Vercel) e envio de e-mail (API do Gmail/Google). Esses
            provedores têm acesso limitado ao necessário para prestar o serviço técnico.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold mb-2">Contato</h2>
          <p className="text-sm text-t2 leading-relaxed">
            Dúvidas sobre esta política podem ser enviadas para{' '}
            <a href="mailto:felipecspinheiro88@gmail.com" className="text-brand hover:underline">
              felipecspinheiro88@gmail.com
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
