// Serve interactive API documentation (Scalar UI) + raw YAML spec
// GET /api-docs       → HTML page (browser)
// GET /api-docs/spec  → raw YAML (Postman / Insomnia import)

const SPEC = `openapi: 3.1.0
info:
  title: Solve AI Shooting — API Pública
  version: "1.0"
  description: |
    API REST para integração de sistemas externos (ERP, automações, etc.).

    ## Autenticação
    Todas as requisições exigem **dois headers obrigatórios**:
    \`\`\`
    Authorization: Bearer sk_live_<64 hex chars>
    X-Workspace-Id: <uuid do seu workspace>
    \`\`\`
    Chaves são gerenciadas em **Configurações → API**.

    O \`X-Workspace-Id\` é uma camada extra de segurança: mesmo que alguém
    capture sua chave, não poderá usá-la em outro workspace. O servidor
    verifica que o header corresponde exatamente ao workspace vinculado
    à chave — qualquer divergência retorna \`401 UNAUTHORIZED\`.

    ## Scopes
    Cada chave é criada com um subconjunto de escopos:
    | Escopo            | Permite                                    |
    |-------------------|--------------------------------------------|
    | \`contacts:read\`   | GET /v1/contacts, GET /v1/contacts/:phone  |
    | \`contacts:write\`  | POST /v1/contacts, POST /v1/contacts/batch |
    | \`campaigns:read\`  | GET /v1/campaigns, GET /v1/campaigns/:id   |
    | \`stats:read\`      | GET /v1/stats                              |

    ## Rate Limiting
    Cada chave de API está sujeita a um limite de **100 requisições por janela
    deslizante de 60 segundos**. Ao ultrapassar o limite, o servidor retorna
    \`429 Too Many Requests\` com os headers:

    | Header | Descrição |
    |--------|-----------|
    | \`Retry-After\` | Segundos até o limite ser resetado (sempre 60) |
    | \`X-RateLimit-Limit\` | Limite total da janela (100) |
    | \`X-RateLimit-Remaining\` | Requisições restantes na janela atual |
    | \`X-RateLimit-Reset\` | Unix timestamp (segundos) de reset da janela |

    Em integrações de alto volume (ex: sincronização inicial de base grande),
    implemente back-off exponencial ao receber \`429\` e envie em lotes com
    intervalos de 1-2 s entre chamadas.

    ## Transport Security
    Toda comunicação deve usar **HTTPS com TLS 1.2 ou superior**. Requisições
    HTTP puro serão recusadas pela infraestrutura. Certificados são gerenciados
    automaticamente pela plataforma Supabase / Cloudflare.

    ## Respostas de erro
    Erros retornam sempre o formato:
    \`\`\`json
    { "error": { "code": "UNAUTHORIZED", "message": "..." } }
    \`\`\`
    Códigos possíveis: \`UNAUTHORIZED\`, \`INSUFFICIENT_SCOPE\`, \`NOT_FOUND\`,
    \`INVALID_PARAM\`, \`INVALID_BODY\`, \`RATE_LIMITED\`, \`API_DISABLED\`, \`INTERNAL_ERROR\`.

servers:
  - url: https://emmtsjbpnavlzzspzcmt.supabase.co/functions/v1/public-api/v1
    description: Produção

security:
  - BearerAuth: []
    WorkspaceId: []

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: "sk_live_<64 hex chars>"
      description: Chave gerada em Configurações → API
    WorkspaceId:
      type: apiKey
      in: header
      name: X-Workspace-Id
      description: UUID do workspace vinculado à chave. Obrigatório em toda requisição.

  schemas:
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code:    { type: string, example: "UNAUTHORIZED" }
            message: { type: string, example: "Invalid or unauthorized API key" }

    Invoice:
      type: object
      properties:
        id:            { type: string, format: uuid }
        valor:         { type: number, example: 3892.00 }
        vencimento:    { type: string, format: date, example: "2026-03-15" }
        status:        { type: string, example: "pendente" }
        numero_nf:     { type: string, nullable: true, example: "NF-2026-4821" }
        codigo_barras: { type: string, nullable: true }

    Contact:
      type: object
      properties:
        id:         { type: string, format: uuid }
        name:       { type: string, example: "Luís Henrique Ferreira" }
        phone:      { type: string, example: "5517996543210" }
        empresa:    { type: string, nullable: true, example: "Agropecuária Ferreira" }
        cidade:     { type: string, nullable: true, example: "Ribeirão Preto" }
        estado:     { type: string, nullable: true, example: "SP" }
        tags:       { type: array, items: { type: string } }
        created_at: { type: string, format: date-time }
        contact_invoices:
          type: array
          items: { $ref: "#/components/schemas/Invoice" }

    Campaign:
      type: object
      properties:
        id:               { type: string, format: uuid }
        name:             { type: string, example: "Cobrança Boletos — Mar/26" }
        status:
          type: string
          enum: [draft, scheduled, sending, paused, completed, cancelled, failed]
        dispatch_channel:
          type: string
          enum: [z_api, whatsapp, meta, n8n_email]
        total_recipients: { type: integer, example: 312 }
        sent_count:       { type: integer, example: 308 }
        delivered_count:  { type: integer, example: 290 }
        read_count:       { type: integer, example: 210 }
        failed_count:     { type: integer, example: 4 }
        created_at:       { type: string, format: date-time }
        started_at:       { type: string, format: date-time, nullable: true }
        completed_at:     { type: string, format: date-time, nullable: true }

    Pagination:
      type: object
      properties:
        total: { type: integer }
        page:  { type: integer }
        limit: { type: integer }

    Stats:
      type: object
      properties:
        total_contacts:      { type: integer, example: 248 }
        total_campaigns:     { type: integer, example: 12 }
        active_campaigns:    { type: integer, example: 2 }
        total_messages_sent: { type: integer, example: 3104 }
        as_of:               { type: string, format: date-time }

paths:

  /contacts:
    get:
      summary: Listar contatos
      description: |
        Retorna contatos do workspace com suas faturas. Suporta busca por texto,
        filtros de boleto (vencimento e valor) e paginação.

        Quando qualquer filtro de boleto é usado, a API retorna **apenas contatos
        que possuem boletos correspondentes**. Os boletos listados dentro de cada
        contato também são filtrados.
      tags: [Contatos]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      parameters:
        - name: q
          in: query
          description: Busca por nome, telefone ou empresa
          schema: { type: string, example: "Ferreira" }
        - name: venc_from
          in: query
          description: "Vencimento mínimo dos boletos (YYYY-MM-DD)"
          schema: { type: string, format: date, example: "2026-05-01" }
        - name: venc_to
          in: query
          description: "Vencimento máximo dos boletos (YYYY-MM-DD)"
          schema: { type: string, format: date, example: "2026-05-31" }
        - name: valor_min
          in: query
          description: Valor mínimo dos boletos (R$)
          schema: { type: number, example: 1000 }
        - name: valor_max
          in: query
          description: Valor máximo dos boletos (R$)
          schema: { type: number, example: 50000 }
        - name: invoice_status
          in: query
          description: Status do boleto
          schema:
            type: string
            enum: [pendente, vencido, pago, aberto, em_aberto, cancelado]
        - name: page
          in: query
          schema: { type: integer, default: 0 }
        - name: limit
          in: query
          schema: { type: integer, default: 50, minimum: 1, maximum: 100 }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { type: array, items: { $ref: "#/components/schemas/Contact" } }
                  meta: { $ref: "#/components/schemas/Pagination" }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/RateLimited" }

    post:
      summary: Criar / atualizar contato
      description: |
        Faz upsert de um contato pelo campo \`phone\` dentro do workspace.
        Opcionalmente cria/atualiza também um boleto (\`invoice\`).

        O campo \`invoice.numero_nf\` é usado como chave de upsert — se já existir um
        boleto com esse NF para o contato, o registro será atualizado.
      tags: [Contatos]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, phone]
              properties:
                name:    { type: string, minLength: 2, example: "Luís Henrique Ferreira" }
                phone:   { type: string, description: "Apenas dígitos, mín. 8", example: "5517996543210" }
                empresa: { type: string, nullable: true, example: "Agropecuária Ferreira" }
                cidade:  { type: string, nullable: true, example: "Ribeirão Preto" }
                estado:  { type: string, nullable: true, example: "SP" }
                tags:    { type: array, items: { type: string }, example: ["cliente"] }
                invoice:
                  type: object
                  description: Boleto a criar/atualizar junto com o contato (opcional)
                  properties:
                    valor:         { type: number, example: 3892.00 }
                    vencimento:    { type: string, format: date, example: "2026-03-15" }
                    status:        { type: string, default: "pendente", example: "pendente" }
                    numero_nf:     { type: string, nullable: true, example: "NF-2026-4821" }
                    codigo_barras: { type: string, nullable: true }
      responses:
        "201":
          description: Contato criado / atualizado
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:    { $ref: "#/components/schemas/Contact" }
                  message: { type: string, example: "Contact upserted successfully" }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/RateLimited" }

  /contacts/batch:
    post:
      summary: Importar contatos em lote
      description: |
        Faz upsert de até **100 contatos** em uma única requisição.
        Cada entrada pode incluir opcionalmente um boleto (\`invoice\`).

        Retorna \`207 Multi-Status\` quando ao menos um contato foi processado
        com sucesso. Retorna \`422\` somente se **todos** falharam.
      tags: [Contatos]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [contacts]
              properties:
                contacts:
                  type: array
                  maxItems: 100
                  items:
                    type: object
                    required: [name, phone]
                    properties:
                      name:    { type: string, minLength: 2 }
                      phone:   { type: string }
                      empresa: { type: string, nullable: true }
                      cidade:  { type: string, nullable: true }
                      estado:  { type: string, nullable: true }
                      tags:    { type: array, items: { type: string } }
                      invoice:
                        type: object
                        properties:
                          valor:         { type: number }
                          vencimento:    { type: string, format: date }
                          status:        { type: string, default: "pendente" }
                          numero_nf:     { type: string, nullable: true }
                          codigo_barras: { type: string, nullable: true }
      responses:
        "207":
          description: Processado (ao menos um contato bem-sucedido)
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        index:  { type: integer }
                        phone:  { type: string, nullable: true }
                        status: { type: string, enum: [created, updated, error] }
                        error:  { type: string }
                  summary:
                    type: object
                    properties:
                      total:   { type: integer }
                      created: { type: integer }
                      updated: { type: integer }
                      errors:  { type: integer }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "422":
          description: Todos os contatos falharam na validação
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "429": { $ref: "#/components/responses/RateLimited" }

  /contacts/{phone}:
    get:
      summary: Buscar contato por telefone
      tags: [Contatos]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      parameters:
        - name: phone
          in: path
          required: true
          description: Número de telefone (apenas dígitos, com código do país)
          schema: { type: string, example: "5517996543210" }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { $ref: "#/components/schemas/Contact" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }

  /campaigns:
    get:
      summary: Listar campanhas
      tags: [Campanhas]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [draft, scheduled, sending, paused, completed, cancelled, failed]
        - name: channel
          in: query
          schema:
            type: string
            enum: [z_api, whatsapp, meta, n8n_email]
        - name: page
          in: query
          schema: { type: integer, default: 0 }
        - name: limit
          in: query
          schema: { type: integer, default: 20, minimum: 1, maximum: 50 }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { type: array, items: { $ref: "#/components/schemas/Campaign" } }
                  meta: { $ref: "#/components/schemas/Pagination" }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/RateLimited" }

  /campaigns/{id}:
    get:
      summary: Detalhe de campanha
      tags: [Campanhas]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { $ref: "#/components/schemas/Campaign" }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }

  /stats:
    get:
      summary: Resumo do workspace
      tags: [Estatísticas]
      security: [{ BearerAuth: [], WorkspaceId: [] }]
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data: { $ref: "#/components/schemas/Stats" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/RateLimited" }

components:
  responses:
    Unauthorized:
      description: Chave inválida, revogada ou expirada
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error: { code: "UNAUTHORIZED", message: "Invalid or unauthorized API key" }
    Forbidden:
      description: A chave não possui o escopo necessário
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error: { code: "INSUFFICIENT_SCOPE", message: "This API key does not have the 'contacts:write' scope." }
    NotFound:
      description: Recurso não encontrado
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error: { code: "NOT_FOUND", message: "Contact not found" }
    BadRequest:
      description: Parâmetro inválido
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error: { code: "INVALID_PARAM", message: "'phone' is required (min 8 digits)" }
    RateLimited:
      description: Limite de requisições excedido (100 req/60s por chave)
      headers:
        Retry-After:
          schema: { type: integer }
          description: Segundos até o limite ser resetado
        X-RateLimit-Limit:
          schema: { type: integer }
        X-RateLimit-Remaining:
          schema: { type: integer }
        X-RateLimit-Reset:
          schema: { type: integer }
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error: { code: "RATE_LIMITED", message: "Too many requests. Maximum 100 requests per 60 seconds per API key." }
`;

const HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <title>Solve AI — API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; background: #0f1b14; }
    </style>
  </head>
  <body>
    <script id="api-reference" type="application/yaml">${SPEC}</script>
    <script>
      window.scalarConfig = {
        theme: "deepSpace",
        darkMode: true,
        showSidebar: true,
        hideDownloadButton: false,
      };
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

Deno.serve((req: Request) => {
  const path = new URL(req.url).pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" },
    });
  }

  // /api-docs/spec → raw YAML for Postman / Insomnia
  if (path.endsWith("/spec")) {
    return new Response(SPEC, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="solve-ai-api.yaml"',
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Default → interactive HTML docs
  return new Response(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
