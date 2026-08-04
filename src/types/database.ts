export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_agents: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          is_active: boolean
          is_triage: boolean
          model: string
          name: string
          system_prompt: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          is_triage?: boolean
          model?: string
          name: string
          system_prompt: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          is_triage?: boolean
          model?: string
          name?: string
          system_prompt?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          revoked_reason: string | null
          scopes: string[]
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          revoked_reason?: string | null
          scopes?: string[]
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          scopes?: string[]
          workspace_id?: string
        }
        Relationships: []
      }
      api_request_logs: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          id: string
          ip_address: string | null
          key_id: string | null
          method: string
          path: string
          status_code: number
          user_agent: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          ip_address?: string | null
          key_id?: string | null
          method: string
          path: string
          status_code: number
          user_agent?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          ip_address?: string | null
          key_id?: string | null
          method?: string
          path?: string
          status_code?: number
          user_agent?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          error: string | null
          event_type: string
          id: string
          metadata: Json | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          status?: string
          workspace_id?: string
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          channel: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          day_offset: number | null
          error_message: string | null
          id: string
          recipient_id: string | null
          rule_id: string
          scheduled_for: string | null
          sent_at: string | null
          status: string
          trigger_id: string | null
          wamid: string | null
          workspace_id: string
          zaap_id: string | null
        }
        Insert: {
          channel?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          day_offset?: number | null
          error_message?: string | null
          id?: string
          recipient_id?: string | null
          rule_id: string
          scheduled_for?: string | null
          sent_at?: string | null
          status: string
          trigger_id?: string | null
          wamid?: string | null
          workspace_id: string
          zaap_id?: string | null
        }
        Update: {
          channel?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          day_offset?: number | null
          error_message?: string | null
          id?: string
          recipient_id?: string | null
          rule_id?: string
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          trigger_id?: string | null
          wamid?: string | null
          workspace_id?: string
          zaap_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "automation_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "automation_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_recipients: {
        Row: {
          codigo_barras: string | null
          contact_id: string
          contact_name: string
          contact_phone: string
          created_at: string | null
          id: string
          invoice_id: string | null
          numero_nf: string | null
          removed: boolean
          rule_id: string
          valor: number | null
          vencimento: string
          workspace_id: string
        }
        Insert: {
          codigo_barras?: string | null
          contact_id: string
          contact_name: string
          contact_phone: string
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          numero_nf?: string | null
          removed?: boolean
          rule_id: string
          valor?: number | null
          vencimento: string
          workspace_id: string
        }
        Update: {
          codigo_barras?: string | null
          contact_id?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          numero_nf?: string | null
          removed?: boolean
          rule_id?: string
          valor?: number | null
          vencimento?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_recipients_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          meta_connection_id: string | null
          name: string
          send_hour: number
          sent_count: number
          status: string
          template_mode: string
          total_recipients: number
          unified_message: string | null
          updated_at: string | null
          workspace_id: string
          z_api_connection_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string | null
          id?: string
          meta_connection_id?: string | null
          name: string
          send_hour?: number
          sent_count?: number
          status?: string
          template_mode?: string
          total_recipients?: number
          unified_message?: string | null
          updated_at?: string | null
          workspace_id: string
          z_api_connection_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          meta_connection_id?: string | null
          name?: string
          send_hour?: number
          sent_count?: number
          status?: string
          template_mode?: string
          total_recipients?: number
          unified_message?: string | null
          updated_at?: string | null
          workspace_id?: string
          z_api_connection_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_z_api_connection_id_fkey"
            columns: ["z_api_connection_id"]
            isOneToOne: false
            referencedRelation: "z_api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_triggers: {
        Row: {
          channel: string | null
          column_mapping: Json | null
          created_at: string | null
          day_offset: number
          enabled: boolean
          id: string
          label: string | null
          message_body: string | null
          meta_connection_id: string | null
          meta_template_id: string | null
          rule_id: string
          workspace_id: string
          z_api_connection_id: string | null
          z_api_template_id: string | null
        }
        Insert: {
          channel?: string | null
          column_mapping?: Json | null
          created_at?: string | null
          day_offset: number
          enabled?: boolean
          id?: string
          label?: string | null
          message_body?: string | null
          meta_connection_id?: string | null
          meta_template_id?: string | null
          rule_id: string
          workspace_id: string
          z_api_connection_id?: string | null
          z_api_template_id?: string | null
        }
        Update: {
          channel?: string | null
          column_mapping?: Json | null
          created_at?: string | null
          day_offset?: number
          enabled?: boolean
          id?: string
          label?: string | null
          message_body?: string | null
          meta_connection_id?: string | null
          meta_template_id?: string | null
          rule_id?: string
          workspace_id?: string
          z_api_connection_id?: string | null
          z_api_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_triggers_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_triggers_meta_template_id_fkey"
            columns: ["meta_template_id"]
            isOneToOne: false
            referencedRelation: "meta_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_triggers_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_triggers_z_api_connection_id_fkey"
            columns: ["z_api_connection_id"]
            isOneToOne: false
            referencedRelation: "z_api_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_triggers_z_api_template_id_fkey"
            columns: ["z_api_template_id"]
            isOneToOne: false
            referencedRelation: "z_api_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_alerts: {
        Row: {
          analyzed_at: string | null
          campaign_id: string
          category: string
          conversation_id: string | null
          created_at: string | null
          id: string
          message_id: string
          read_at: string | null
          recipient_name: string | null
          recipient_phone: string
          reply_text: string
          severity: string
          summary: string
          workspace_id: string
        }
        Insert: {
          analyzed_at?: string | null
          campaign_id: string
          category: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_id: string
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone: string
          reply_text: string
          severity?: string
          summary: string
          workspace_id: string
        }
        Update: {
          analyzed_at?: string | null
          campaign_id?: string
          category?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_id?: string
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone?: string
          reply_text?: string
          severity?: string
          summary?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_alerts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "shooting_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_alerts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_alerts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "shooting_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_invoices: {
        Row: {
          arquivo_pdf: string | null
          codigo_barras: string | null
          contact_id: string
          created_at: string
          id: string
          numero_nf: string | null
          status: string
          updated_at: string
          valor: number
          vencimento: string | null
          workspace_id: string
        }
        Insert: {
          arquivo_pdf?: string | null
          codigo_barras?: string | null
          contact_id: string
          created_at?: string
          id?: string
          numero_nf?: string | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
          workspace_id: string
        }
        Update: {
          arquivo_pdf?: string | null
          codigo_barras?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          numero_nf?: string | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "inbox_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          contact_name: string | null
          contact_phone: string
          content: string
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          follow_up_date: string | null
          follow_up_done: boolean | null
          id: string
          type: string
          workspace_id: string
        }
        Insert: {
          contact_name?: string | null
          contact_phone: string
          content: string
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          follow_up_date?: string | null
          follow_up_done?: boolean | null
          id?: string
          type?: string
          workspace_id: string
        }
        Update: {
          contact_name?: string | null
          contact_phone?: string
          content?: string
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          follow_up_date?: string | null
          follow_up_done?: boolean | null
          id?: string
          type?: string
          workspace_id?: string
        }
        Relationships: []
      }
      debt_negotiations: {
        Row: {
          agreed_amount: number | null
          agreed_at: string | null
          agreed_first_due_date: string | null
          agreed_installments: number | null
          contact_id: string
          conversation_id: string
          created_at: string
          escalation_reason: string | null
          id: string
          invoice_id: string
          offer_round: number
          original_amount: number
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agreed_amount?: number | null
          agreed_at?: string | null
          agreed_first_due_date?: string | null
          agreed_installments?: number | null
          contact_id: string
          conversation_id: string
          created_at?: string
          escalation_reason?: string | null
          id?: string
          invoice_id: string
          offer_round?: number
          original_amount: number
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agreed_amount?: number | null
          agreed_at?: string | null
          agreed_first_due_date?: string | null
          agreed_installments?: number | null
          contact_id?: string
          conversation_id?: string
          created_at?: string
          escalation_reason?: string | null
          id?: string
          invoice_id?: string
          offer_round?: number
          original_amount?: number
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_negotiations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "inbox_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_negotiations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_negotiations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "contact_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_negotiations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      department_members: {
        Row: {
          created_at: string
          department_id: string
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          color: string
          created_at: string | null
          description: string | null
          id: string
          name: string
          order_index: number
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          order_index?: number
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          order_index?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          body_html: string
          cc_list: string[]
          cc_representante: boolean
          column_mapping: Json
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          data_source: string
          email_connection_id: string
          failed_count: number
          filters: Json
          id: string
          name: string
          sending_speed: number
          sent_count: number
          started_at: string | null
          status: string
          subject: string
          total_recipients: number
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          body_html: string
          cc_list?: string[]
          cc_representante?: boolean
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          data_source?: string
          email_connection_id: string
          failed_count?: number
          filters?: Json
          id?: string
          name: string
          sending_speed?: number
          sent_count?: number
          started_at?: string | null
          status?: string
          subject: string
          total_recipients?: number
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          body_html?: string
          cc_list?: string[]
          cc_representante?: boolean
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          data_source?: string
          email_connection_id?: string
          failed_count?: number
          filters?: Json
          id?: string
          name?: string
          sending_speed?: number
          sent_count?: number
          started_at?: string | null
          status?: string
          subject?: string
          total_recipients?: number
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_email_connection_id_fkey"
            columns: ["email_connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      email_connections: {
        Row: {
          client_id: string | null
          created_at: string | null
          from_email: string
          from_name: string
          host: string
          id: string
          name: string
          oauth_access_token: string | null
          oauth_refresh_token: string | null
          oauth_token_expires_at: string | null
          password: string
          port: number
          provider: string
          secure: boolean
          tenant_id: string | null
          username: string
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          from_email: string
          from_name: string
          host: string
          id?: string
          name: string
          oauth_access_token?: string | null
          oauth_refresh_token?: string | null
          oauth_token_expires_at?: string | null
          password: string
          port?: number
          provider?: string
          secure?: boolean
          tenant_id?: string | null
          username: string
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          from_email?: string
          from_name?: string
          host?: string
          id?: string
          name?: string
          oauth_access_token?: string | null
          oauth_refresh_token?: string | null
          oauth_token_expires_at?: string | null
          password?: string
          port?: number
          provider?: string
          secure?: boolean
          tenant_id?: string | null
          username?: string
          workspace_id?: string
        }
        Relationships: []
      }
      email_messages: {
        Row: {
          campaign_id: string
          cc_emails: string[]
          created_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          max_retries: number
          recipient_data: Json
          recipient_email: string
          recipient_name: string | null
          retry_count: number
          sent_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          cc_emails?: string[]
          created_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          max_retries?: number
          recipient_data?: Json
          recipient_email: string
          recipient_name?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          cc_emails?: string[]
          created_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          max_retries?: number
          recipient_data?: Json
          recipient_email?: string
          recipient_name?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_contacts: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          cpf_cnpj: string | null
          email: string | null
          email_representante: string | null
          email2: string | null
          empresa: string | null
          estado: string | null
          first_seen_at: string | null
          gerente1_email: string | null
          gerente1_nome: string | null
          gerente2_email: string | null
          gerente2_nome: string | null
          id: string
          last_seen_at: string | null
          logradouro: string | null
          name: string | null
          nome_representante: string | null
          numero: string | null
          phone: string
          profile_pic_url: string | null
          tags: string[]
          wa_checked_at: string | null
          wa_status: string | null
          workspace_id: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          cpf_cnpj?: string | null
          email?: string | null
          email_representante?: string | null
          email2?: string | null
          empresa?: string | null
          estado?: string | null
          first_seen_at?: string | null
          gerente1_email?: string | null
          gerente1_nome?: string | null
          gerente2_email?: string | null
          gerente2_nome?: string | null
          id?: string
          last_seen_at?: string | null
          logradouro?: string | null
          name?: string | null
          nome_representante?: string | null
          numero?: string | null
          phone: string
          profile_pic_url?: string | null
          tags?: string[]
          wa_checked_at?: string | null
          wa_status?: string | null
          workspace_id: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          cpf_cnpj?: string | null
          email?: string | null
          email_representante?: string | null
          email2?: string | null
          empresa?: string | null
          estado?: string | null
          first_seen_at?: string | null
          gerente1_email?: string | null
          gerente1_nome?: string | null
          gerente2_email?: string | null
          gerente2_nome?: string | null
          id?: string
          last_seen_at?: string | null
          logradouro?: string | null
          name?: string | null
          nome_representante?: string | null
          numero?: string | null
          phone?: string
          profile_pic_url?: string | null
          tags?: string[]
          wa_checked_at?: string | null
          wa_status?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      inbox_conversations: {
        Row: {
          ai_agent_id: string | null
          archived: boolean | null
          assigned_to: string | null
          contact_id: string
          created_at: string | null
          department_id: string | null
          id: string
          last_message_at: string | null
          last_message_body: string | null
          last_message_direction: string | null
          meta_connection_id: string | null
          pinned: boolean | null
          status: string | null
          tags: string[] | null
          unread_count: number | null
          updated_at: string | null
          workspace_id: string
          z_api_connection_id: string | null
        }
        Insert: {
          ai_agent_id?: string | null
          archived?: boolean | null
          assigned_to?: string | null
          contact_id: string
          created_at?: string | null
          department_id?: string | null
          id?: string
          last_message_at?: string | null
          last_message_body?: string | null
          last_message_direction?: string | null
          meta_connection_id?: string | null
          pinned?: boolean | null
          status?: string | null
          tags?: string[] | null
          unread_count?: number | null
          updated_at?: string | null
          workspace_id: string
          z_api_connection_id?: string | null
        }
        Update: {
          ai_agent_id?: string | null
          archived?: boolean | null
          assigned_to?: string | null
          contact_id?: string
          created_at?: string | null
          department_id?: string | null
          id?: string
          last_message_at?: string | null
          last_message_body?: string | null
          last_message_direction?: string | null
          meta_connection_id?: string | null
          pinned?: boolean | null
          status?: string | null
          tags?: string[] | null
          unread_count?: number | null
          updated_at?: string | null
          workspace_id?: string
          z_api_connection_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbox_conversations_ai_agent_id_fkey"
            columns: ["ai_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "inbox_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_z_api_connection_id_fkey"
            columns: ["z_api_connection_id"]
            isOneToOne: false
            referencedRelation: "z_api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          body: string | null
          contact_id: string
          conversation_id: string
          created_at: string | null
          delivered_at: string | null
          direction: string
          failed_at: string | null
          id: string
          is_internal: boolean
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          location_name: string | null
          media_caption: string | null
          media_filename: string | null
          media_id: string | null
          media_mime_type: string | null
          media_size: number | null
          media_url: string | null
          message_type: string
          reaction_emoji: string | null
          reaction_wamid: string | null
          read_at: string | null
          sent_at: string | null
          sent_by: string | null
          status: string | null
          wamid: string | null
          workspace_id: string
        }
        Insert: {
          body?: string | null
          contact_id: string
          conversation_id: string
          created_at?: string | null
          delivered_at?: string | null
          direction: string
          failed_at?: string | null
          id?: string
          is_internal?: boolean
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_name?: string | null
          media_caption?: string | null
          media_filename?: string | null
          media_id?: string | null
          media_mime_type?: string | null
          media_size?: number | null
          media_url?: string | null
          message_type: string
          reaction_emoji?: string | null
          reaction_wamid?: string | null
          read_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          wamid?: string | null
          workspace_id: string
        }
        Update: {
          body?: string | null
          contact_id?: string
          conversation_id?: string
          created_at?: string | null
          delivered_at?: string | null
          direction?: string
          failed_at?: string | null
          id?: string
          is_internal?: boolean
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_name?: string | null
          media_caption?: string | null
          media_filename?: string | null
          media_id?: string | null
          media_mime_type?: string | null
          media_size?: number | null
          media_url?: string | null
          message_type?: string
          reaction_emoji?: string | null
          reaction_wamid?: string | null
          read_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          wamid?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "inbox_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_connections: {
        Row: {
          access_token: string
          business_name: string | null
          created_at: string | null
          display_phone: string
          id: string
          messaging_limit: string | null
          phone_number_id: string
          quality_rating: string | null
          status: string | null
          token_expires_at: string | null
          updated_at: string | null
          waba_id: string
          webhook_verify_token: string
          workspace_id: string
        }
        Insert: {
          access_token: string
          business_name?: string | null
          created_at?: string | null
          display_phone: string
          id?: string
          messaging_limit?: string | null
          phone_number_id: string
          quality_rating?: string | null
          status?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          waba_id: string
          webhook_verify_token?: string
          workspace_id: string
        }
        Update: {
          access_token?: string
          business_name?: string | null
          created_at?: string | null
          display_phone?: string
          id?: string
          messaging_limit?: string | null
          phone_number_id?: string
          quality_rating?: string | null
          status?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          waba_id?: string
          webhook_verify_token?: string
          workspace_id?: string
        }
        Relationships: []
      }
      meta_templates: {
        Row: {
          category: string
          components: Json
          created_at: string | null
          id: string
          language: string
          last_synced_at: string | null
          meta_connection_id: string
          quality_score: Json | null
          status: string
          template_id: string
          template_name: string
          workspace_id: string
        }
        Insert: {
          category: string
          components?: Json
          created_at?: string | null
          id?: string
          language?: string
          last_synced_at?: string | null
          meta_connection_id: string
          quality_score?: Json | null
          status: string
          template_id: string
          template_name: string
          workspace_id: string
        }
        Update: {
          category?: string
          components?: Json
          created_at?: string | null
          id?: string
          language?: string
          last_synced_at?: string | null
          meta_connection_id?: string
          quality_score?: Json | null
          status?: string
          template_id?: string
          template_name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_templates_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_offers: {
        Row: {
          created_at: string
          discount_pct: number
          first_due_date: string | null
          id: string
          installment_amount: number
          installments: number
          negotiation_id: string
          offer_amount: number
          proposed_by: string
          proposed_by_agent_id: string | null
          proposed_by_user_id: string | null
          rejection_reason: string | null
          round: number
          rule_snapshot: Json | null
          source_message_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          discount_pct: number
          first_due_date?: string | null
          id?: string
          installment_amount: number
          installments?: number
          negotiation_id: string
          offer_amount: number
          proposed_by: string
          proposed_by_agent_id?: string | null
          proposed_by_user_id?: string | null
          rejection_reason?: string | null
          round: number
          rule_snapshot?: Json | null
          source_message_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          discount_pct?: number
          first_due_date?: string | null
          id?: string
          installment_amount?: number
          installments?: number
          negotiation_id?: string
          offer_amount?: number
          proposed_by?: string
          proposed_by_agent_id?: string | null
          proposed_by_user_id?: string | null
          rejection_reason?: string | null
          round?: number
          rule_snapshot?: Json | null
          source_message_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_offers_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "debt_negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_offers_proposed_by_agent_id_fkey"
            columns: ["proposed_by_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_offers_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "inbox_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_offers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_portal_tokens: {
        Row: {
          attempts: number
          cpf_last_digits_hash: string
          created_at: string
          expires_at: string
          id: string
          locked_at: string | null
          negotiation_id: string
          token: string
          used_at: string | null
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          cpf_last_digits_hash: string
          created_at?: string
          expires_at: string
          id?: string
          locked_at?: string | null
          negotiation_id: string
          token?: string
          used_at?: string | null
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          cpf_last_digits_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          locked_at?: string | null
          negotiation_id?: string
          token?: string
          used_at?: string | null
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_portal_tokens_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "debt_negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_portal_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_rules: {
        Row: {
          auto_escalate_keywords: string[]
          created_at: string
          escalation_department_id: string | null
          id: string
          is_ai_negotiation_enabled: boolean
          max_discount_pct: number
          max_installments: number
          max_negotiation_rounds: number
          min_down_payment_pct: number | null
          min_installment_amount: number
          portal_token_ttl_hours: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auto_escalate_keywords?: string[]
          created_at?: string
          escalation_department_id?: string | null
          id?: string
          is_ai_negotiation_enabled?: boolean
          max_discount_pct?: number
          max_installments?: number
          max_negotiation_rounds?: number
          min_down_payment_pct?: number | null
          min_installment_amount?: number
          portal_token_ttl_hours?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auto_escalate_keywords?: string[]
          created_at?: string
          escalation_department_id?: string | null
          id?: string
          is_ai_negotiation_enabled?: boolean
          max_discount_pct?: number
          max_installments?: number
          max_negotiation_rounds?: number
          min_down_payment_pct?: number | null
          min_installment_amount?: number
          portal_token_ttl_hours?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_rules_escalation_department_id_fkey"
            columns: ["escalation_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_replies: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          title: string
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shooting_campaigns: {
        Row: {
          column_mapping: Json
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          data_source: string
          delivered_count: number | null
          dispatch_channel: string
          error_summary: Json | null
          failed_count: number | null
          filters: Json | null
          id: string
          max_delay_seconds: number | null
          message_body: string | null
          meta_connection_id: string | null
          min_delay_seconds: number | null
          name: string
          next_message_at: string | null
          read_count: number | null
          replied_count: number | null
          scheduled_at: string | null
          sending_speed: number | null
          sending_speed_mode: string
          sent_count: number | null
          started_at: string | null
          status: string | null
          template_id: string | null
          total_recipients: number | null
          updated_at: string | null
          workspace_id: string
          z_api_connection_id: string | null
          z_api_template_id: string | null
        }
        Insert: {
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          data_source: string
          delivered_count?: number | null
          dispatch_channel?: string
          error_summary?: Json | null
          failed_count?: number | null
          filters?: Json | null
          id?: string
          max_delay_seconds?: number | null
          message_body?: string | null
          meta_connection_id?: string | null
          min_delay_seconds?: number | null
          name: string
          next_message_at?: string | null
          read_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          sending_speed?: number | null
          sending_speed_mode?: string
          sent_count?: number | null
          started_at?: string | null
          status?: string | null
          template_id?: string | null
          total_recipients?: number | null
          updated_at?: string | null
          workspace_id: string
          z_api_connection_id?: string | null
          z_api_template_id?: string | null
        }
        Update: {
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          data_source?: string
          delivered_count?: number | null
          dispatch_channel?: string
          error_summary?: Json | null
          failed_count?: number | null
          filters?: Json | null
          id?: string
          max_delay_seconds?: number | null
          message_body?: string | null
          meta_connection_id?: string | null
          min_delay_seconds?: number | null
          name?: string
          next_message_at?: string | null
          read_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          sending_speed?: number | null
          sending_speed_mode?: string
          sent_count?: number | null
          started_at?: string | null
          status?: string | null
          template_id?: string | null
          total_recipients?: number | null
          updated_at?: string | null
          workspace_id?: string
          z_api_connection_id?: string | null
          z_api_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shooting_campaigns_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shooting_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "meta_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shooting_campaigns_z_api_connection_id_fkey"
            columns: ["z_api_connection_id"]
            isOneToOne: false
            referencedRelation: "z_api_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shooting_campaigns_z_api_template_id_fkey"
            columns: ["z_api_template_id"]
            isOneToOne: false
            referencedRelation: "z_api_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      shooting_messages: {
        Row: {
          campaign_id: string
          created_at: string | null
          delivered_at: string | null
          error_code: string | null
          error_details: Json | null
          error_message: string | null
          failed_at: string | null
          id: string
          max_retries: number | null
          read_at: string | null
          recipient_data: Json | null
          recipient_name: string | null
          recipient_phone: string
          replied_at: string | null
          retry_count: number | null
          sent_at: string | null
          status: string | null
          wamid: string | null
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          delivered_at?: string | null
          error_code?: string | null
          error_details?: Json | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          max_retries?: number | null
          read_at?: string | null
          recipient_data?: Json | null
          recipient_name?: string | null
          recipient_phone: string
          replied_at?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string | null
          wamid?: string | null
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          delivered_at?: string | null
          error_code?: string | null
          error_details?: Json | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          max_retries?: number | null
          read_at?: string | null
          recipient_data?: Json | null
          recipient_name?: string | null
          recipient_phone?: string
          replied_at?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string | null
          wamid?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shooting_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "shooting_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      shooting_uploads: {
        Row: {
          campaign_id: string | null
          column_headers: string[] | null
          created_at: string | null
          file_name: string
          file_url: string
          id: string
          invalid_rows: number | null
          preview_data: Json | null
          processed: boolean | null
          total_rows: number | null
          valid_rows: number | null
          validation_errors: Json | null
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          column_headers?: string[] | null
          created_at?: string | null
          file_name: string
          file_url: string
          id?: string
          invalid_rows?: number | null
          preview_data?: Json | null
          processed?: boolean | null
          total_rows?: number | null
          valid_rows?: number | null
          validation_errors?: Json | null
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          column_headers?: string[] | null
          created_at?: string | null
          file_name?: string
          file_url?: string
          id?: string
          invalid_rows?: number | null
          preview_data?: Json | null
          processed?: boolean | null
          total_rows?: number | null
          valid_rows?: number | null
          validation_errors?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shooting_uploads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "shooting_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          attachments: Json
          author_id: string
          body: string
          created_at: string | null
          id: string
          is_staff: boolean
          ticket_id: string
          workspace_id: string
        }
        Insert: {
          attachments?: Json
          author_id: string
          body: string
          created_at?: string | null
          id?: string
          is_staff?: boolean
          ticket_id: string
          workspace_id: string
        }
        Update: {
          attachments?: Json
          author_id?: string
          body?: string
          created_at?: string | null
          id?: string
          is_staff?: boolean
          ticket_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          closed_at: string | null
          created_at: string | null
          created_by: string
          description: string
          id: string
          priority: string
          status: string
          title: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          created_by: string
          description?: string
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          created_by?: string
          description?: string
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          description: string | null
          full_name: string | null
          id: string
          permissions: Json | null
          presence_status: string
          role: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          description?: string | null
          full_name?: string | null
          id: string
          permissions?: Json | null
          presence_status?: string
          role?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          description?: string | null
          full_name?: string | null
          id?: string
          permissions?: Json | null
          presence_status?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          meta_connection_id: string
          payload: Json
          processed: boolean | null
          wamid: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          meta_connection_id: string
          payload: Json
          processed?: boolean | null
          wamid?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          meta_connection_id?: string
          payload?: Json
          processed?: boolean | null
          wamid?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: string
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string | null
          department_id: string | null
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          ai_provider: string
          anthropic_api_key: string | null
          api_enabled: boolean
          created_at: string | null
          id: string
          name: string
          openai_api_key: string | null
          routing_body: string
          routing_enabled: boolean
          routing_header: string
          shooting_visible_fields: Json | null
          support_email: string | null
        }
        Insert: {
          ai_provider?: string
          anthropic_api_key?: string | null
          api_enabled?: boolean
          created_at?: string | null
          id?: string
          name: string
          openai_api_key?: string | null
          routing_body?: string
          routing_enabled?: boolean
          routing_header?: string
          shooting_visible_fields?: Json | null
          support_email?: string | null
        }
        Update: {
          ai_provider?: string
          anthropic_api_key?: string | null
          api_enabled?: boolean
          created_at?: string | null
          id?: string
          name?: string
          openai_api_key?: string | null
          routing_body?: string
          routing_enabled?: boolean
          routing_header?: string
          shooting_visible_fields?: Json | null
          support_email?: string | null
        }
        Relationships: []
      }
      z_api_connections: {
        Row: {
          client_token: string | null
          created_at: string | null
          display_name: string | null
          id: string
          instance_id: string
          name: string
          phone: string | null
          status: string
          token: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          client_token?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          instance_id: string
          name: string
          phone?: string | null
          status?: string
          token: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          client_token?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          instance_id?: string
          name?: string
          phone?: string | null
          status?: string
          token?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "z_api_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      z_api_debug_log: {
        Row: {
          created_at: string | null
          event_type: string | null
          id: number
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          event_type?: string | null
          id?: number
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          event_type?: string | null
          id?: number
          payload?: Json | null
        }
        Relationships: []
      }
      z_api_templates: {
        Row: {
          blocks: string[]
          body: string
          buttons: Json | null
          created_at: string | null
          enable_light_variations: boolean
          footer: string | null
          header_text: string | null
          id: string
          message_type: string
          name: string
          updated_at: string | null
          workspace_id: string
          z_api_connection_id: string | null
        }
        Insert: {
          blocks?: string[]
          body: string
          buttons?: Json | null
          created_at?: string | null
          enable_light_variations?: boolean
          footer?: string | null
          header_text?: string | null
          id?: string
          message_type?: string
          name: string
          updated_at?: string | null
          workspace_id: string
          z_api_connection_id?: string | null
        }
        Update: {
          blocks?: string[]
          body?: string
          buttons?: Json | null
          created_at?: string | null
          enable_light_variations?: boolean
          footer?: string | null
          header_text?: string | null
          id?: string
          message_type?: string
          name?: string
          updated_at?: string | null
          workspace_id?: string
          z_api_connection_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "z_api_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "z_api_templates_z_api_connection_id_fkey"
            columns: ["z_api_connection_id"]
            isOneToOne: false
            referencedRelation: "z_api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_role: { Args: never; Returns: string }
      get_my_workspace_ids: { Args: never; Returns: string[] }
      increment_campaign_counters: {
        Args: {
          p_campaign_id: string
          p_counter_name: string
          p_increment?: number
        }
        Returns: undefined
      }
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
