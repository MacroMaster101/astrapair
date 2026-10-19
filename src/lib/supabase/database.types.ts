export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      ai_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          input_tokens: number | null;
          model: string | null;
          output_tokens: number | null;
          prompt_version: string | null;
          role: string;
          thread_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          input_tokens?: number | null;
          model?: string | null;
          output_tokens?: number | null;
          prompt_version?: string | null;
          role: string;
          thread_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          input_tokens?: number | null;
          model?: string | null;
          output_tokens?: number | null;
          prompt_version?: string | null;
          role?: string;
          thread_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "ai_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_threads: {
        Row: {
          created_at: string;
          id: string;
          owner_user_id: string;
          relationship_id: string | null;
          thread_type: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          owner_user_id: string;
          relationship_id?: string | null;
          thread_type: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_user_id?: string;
          relationship_id?: string | null;
          thread_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_threads_relationship_id_fkey";
            columns: ["relationship_id"];
            isOneToOne: false;
            referencedRelation: "relationships";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage_events: {
        Row: {
          attempt: number;
          created_at: string;
          id: number;
          input_tokens: number;
          kind: string;
          model: string;
          output_tokens: number;
          prompt_version: string;
          relationship_id: string | null;
          user_id: string;
        };
        Insert: {
          attempt?: number;
          created_at?: string;
          id?: never;
          input_tokens?: number;
          kind: string;
          model: string;
          output_tokens?: number;
          prompt_version: string;
          relationship_id?: string | null;
          user_id: string;
        };
        Update: {
          attempt?: number;
          created_at?: string;
          id?: never;
          input_tokens?: number;
          kind?: string;
          model?: string;
          output_tokens?: number;
          prompt_version?: string;
          relationship_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_relationship_id_fkey";
            columns: ["relationship_id"];
            isOneToOne: false;
            referencedRelation: "relationships";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_events: {
        Row: {
          created_at: string;
          event: string;
          id: number;
          user_ref: string;
        };
        Insert: {
          created_at?: string;
          event: string;
          id?: never;
          user_ref: string;
        };
        Update: {
          created_at?: string;
          event?: string;
          id?: never;
          user_ref?: string;
        };
        Relationships: [];
      };
      audit_events: {
        Row: {
          actor_user_id: string | null;
          created_at: string;
          event_type: string;
          id: number;
          metadata: Json;
          resource_id: string | null;
          resource_type: string | null;
        };
        Insert: {
          actor_user_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: never;
          metadata?: Json;
          resource_id?: string | null;
          resource_type?: string | null;
        };
        Update: {
          actor_user_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: never;
          metadata?: Json;
          resource_id?: string | null;
          resource_type?: string | null;
        };
        Relationships: [];
      };
      beta_invite_codes: {
        Row: {
          code_hash: string;
          created_at: string;
          disabled_at: string | null;
          label: string;
          max_uses: number;
          uses: number;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          disabled_at?: string | null;
          label: string;
          max_uses?: number;
          uses?: number;
        };
        Update: {
          code_hash?: string;
          created_at?: string;
          disabled_at?: string | null;
          label?: string;
          max_uses?: number;
          uses?: number;
        };
        Relationships: [];
      };
      birth_profiles: {
        Row: {
          birth_date: string;
          birth_place_label: string;
          birth_time: string | null;
          birth_time_accuracy: string;
          created_at: string;
          display_name: string | null;
          id: string;
          latitude: number;
          longitude: number;
          owner_user_id: string;
          timezone_id: string;
          updated_at: string;
        };
        Insert: {
          birth_date: string;
          birth_place_label: string;
          birth_time?: string | null;
          birth_time_accuracy: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          latitude: number;
          longitude: number;
          owner_user_id: string;
          timezone_id: string;
          updated_at?: string;
        };
        Update: {
          birth_date?: string;
          birth_place_label?: string;
          birth_time?: string | null;
          birth_time_accuracy?: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          latitude?: number;
          longitude?: number;
          owner_user_id?: string;
          timezone_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      charts: {
        Row: {
          birth_profile_id: string;
          calculation_provider: string;
          calculation_version: string;
          chart_json: Json;
          created_at: string;
          house_system: string | null;
          id: string;
          input_hash: string;
          zodiac_system: string;
        };
        Insert: {
          birth_profile_id: string;
          calculation_provider: string;
          calculation_version: string;
          chart_json: Json;
          created_at?: string;
          house_system?: string | null;
          id?: string;
          input_hash: string;
          zodiac_system?: string;
        };
        Update: {
          birth_profile_id?: string;
          calculation_provider?: string;
          calculation_version?: string;
          chart_json?: Json;
          created_at?: string;
          house_system?: string | null;
          id?: string;
          input_hash?: string;
          zodiac_system?: string;
        };
        Relationships: [
          {
            foreignKeyName: "charts_birth_profile_id_fkey";
            columns: ["birth_profile_id"];
            isOneToOne: false;
            referencedRelation: "birth_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      compatibility_reports: {
        Row: {
          cache_key: string | null;
          claim_id: string | null;
          completed_at: string | null;
          facts_json: Json | null;
          generated_by: string | null;
          generation_started_at: string | null;
          interpretation_json: Json | null;
          model: string | null;
          pending_cache_key: string | null;
          prompt_version: string | null;
          relationship_id: string;
          status: string;
          synastry_input_hash: string | null;
        };
        Insert: {
          cache_key?: string | null;
          claim_id?: string | null;
          completed_at?: string | null;
          facts_json?: Json | null;
          generated_by?: string | null;
          generation_started_at?: string | null;
          interpretation_json?: Json | null;
          model?: string | null;
          pending_cache_key?: string | null;
          prompt_version?: string | null;
          relationship_id: string;
          status: string;
          synastry_input_hash?: string | null;
        };
        Update: {
          cache_key?: string | null;
          claim_id?: string | null;
          completed_at?: string | null;
          facts_json?: Json | null;
          generated_by?: string | null;
          generation_started_at?: string | null;
          interpretation_json?: Json | null;
          model?: string | null;
          pending_cache_key?: string | null;
          prompt_version?: string | null;
          relationship_id?: string;
          status?: string;
          synastry_input_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "compatibility_reports_relationship_id_fkey";
            columns: ["relationship_id"];
            isOneToOne: true;
            referencedRelation: "relationships";
            referencedColumns: ["id"];
          },
        ];
      };
      consents: {
        Row: {
          accepted_at: string;
          consent_type: string;
          id: string;
          policy_version: string;
          relationship_id: string | null;
          revoked_at: string | null;
          user_id: string;
        };
        Insert: {
          accepted_at?: string;
          consent_type: string;
          id?: string;
          policy_version: string;
          relationship_id?: string | null;
          revoked_at?: string | null;
          user_id: string;
        };
        Update: {
          accepted_at?: string;
          consent_type?: string;
          id?: string;
          policy_version?: string;
          relationship_id?: string | null;
          revoked_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consents_relationship_id_fkey";
            columns: ["relationship_id"];
            isOneToOne: false;
            referencedRelation: "relationships";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          onboarded_at: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          onboarded_at?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          onboarded_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      relationship_invites: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          inviter_policy_version: string;
          inviter_user_id: string;
          responded_at: string | null;
          responded_by: string | null;
          status: string;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          inviter_policy_version: string;
          inviter_user_id: string;
          responded_at?: string | null;
          responded_by?: string | null;
          status?: string;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          inviter_policy_version?: string;
          inviter_user_id?: string;
          responded_at?: string | null;
          responded_by?: string | null;
          status?: string;
          token_hash?: string;
        };
        Relationships: [];
      };
      relationship_members: {
        Row: {
          joined_at: string;
          left_at: string | null;
          relationship_id: string;
          user_id: string;
        };
        Insert: {
          joined_at?: string;
          left_at?: string | null;
          relationship_id: string;
          user_id: string;
        };
        Update: {
          joined_at?: string;
          left_at?: string | null;
          relationship_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "relationship_members_relationship_id_fkey";
            columns: ["relationship_id"];
            isOneToOne: false;
            referencedRelation: "relationships";
            referencedColumns: ["id"];
          },
        ];
      };
      relationships: {
        Row: {
          created_at: string;
          created_by: string | null;
          ended_at: string | null;
          ended_by: string | null;
          id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          ended_at?: string | null;
          ended_by?: string | null;
          id?: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          ended_at?: string | null;
          ended_by?: string | null;
          id?: string;
          status?: string;
        };
        Relationships: [];
      };
      synastry: {
        Row: {
          calculation_version: string;
          created_at: string;
          facts_json: Json;
          input_hash: string;
          relationship_id: string;
        };
        Insert: {
          calculation_version: string;
          created_at?: string;
          facts_json: Json;
          input_hash: string;
          relationship_id: string;
        };
        Update: {
          calculation_version?: string;
          created_at?: string;
          facts_json?: Json;
          input_hash?: string;
          relationship_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "synastry_relationship_id_fkey";
            columns: ["relationship_id"];
            isOneToOne: true;
            referencedRelation: "relationships";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invite: {
        Args: { p_policy_version: string; p_token_hash: string };
        Returns: string;
      };
      check_beta_code: { Args: { p_code: string }; Returns: boolean };
      claim_report_generation: {
        Args: {
          p_claim_id: string;
          p_pending_cache_key: string;
          p_relationship_id: string;
        };
        Returns: boolean;
      };
      complete_onboarding: {
        Args: { p_policy_version: string };
        Returns: undefined;
      };
      create_invite: {
        Args: { p_policy_version: string; p_token_hash: string };
        Returns: string;
      };
      decline_invite: { Args: { p_token_hash: string }; Returns: undefined };
      delete_relationship_derived_data: {
        Args: { p_relationship_id: string };
        Returns: undefined;
      };
      end_relationship: {
        Args: { p_relationship_id: string };
        Returns: undefined;
      };
      finish_report_generation: {
        Args: {
          p_claim_id: string;
          p_relationship_id: string;
          p_report: Json;
          p_success: boolean;
        };
        Returns: boolean;
      };
      get_invite_preview: {
        Args: { p_token_hash: string };
        Returns: {
          inviter_name: string;
          is_own: boolean;
          state: string;
        }[];
      };
      get_my_pending_invite: {
        Args: never;
        Returns: {
          created_at: string;
          expires_at: string;
        }[];
      };
      get_my_relationship: {
        Args: never;
        Returns: {
          connected_at: string;
          partner_display_name: string;
          partner_user_id: string;
          relationship_id: string;
        }[];
      };
      hook_before_user_created: { Args: { event: Json }; Returns: Json };
      is_active_member: {
        Args: { p_relationship_id: string };
        Returns: boolean;
      };
      is_member: { Args: { p_relationship_id: string }; Returns: boolean };
      purge_old_audit_events: {
        Args: { p_older_than: string };
        Returns: number;
      };
      revoke_invite: { Args: never; Returns: undefined };
      rls_audit: { Args: never; Returns: string[] };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
