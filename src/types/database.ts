export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationship[];
};

type Timestamped = { created_at: string; updated_at: string };

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        Timestamped & { id: string; display_name: string },
        { id: string; display_name?: string; created_at?: string; updated_at?: string }
      >;
      push_tokens: Table<
        Timestamped & {
          id: string; user_id: string; token: string; platform: string;
          enabled: boolean; last_seen_at: string;
        },
        {
          id?: string; user_id: string; token: string; platform: string;
          enabled?: boolean; created_at?: string; updated_at?: string; last_seen_at?: string;
        }
      >;
      organizations: Table<
        Timestamped & {
          id: string; created_by: string; name: string; institution: string;
          description: string; logo_path: string | null;
        },
        {
          id?: string; created_by: string; name: string; institution?: string;
          description?: string; logo_path?: string | null; created_at?: string; updated_at?: string;
        }
      >;
      organization_members: Table<
        { organization_id: string; user_id: string; member_role: string; created_at: string },
        { organization_id: string; user_id: string; member_role?: string; created_at?: string }
      >;
      roles: Table<
        Timestamped & {
          id: string; organization_id: string; created_by: string; title: string;
          description: string; archived_at: string | null;
        },
        {
          id?: string; organization_id: string; created_by: string; title: string;
          description?: string; archived_at?: string | null; created_at?: string; updated_at?: string;
        }
      >;
      handoffs: Table<
        Timestamped & {
          id: string; organization_id: string; role_id: string; created_by: string;
          service_period: string; status: string; stage: string; published_at: string | null;
        },
        {
          id?: string; organization_id: string; role_id: string; created_by: string;
          service_period: string; status?: string; stage?: string; published_at?: string | null;
          created_at?: string; updated_at?: string;
        }
      >;
      sources: Table<
        Timestamped & {
          id: string; organization_id: string; handoff_id: string; created_by: string;
          kind: string; title: string; text_content: string | null; storage_path: string | null;
          mime_type: string | null; size_bytes: number | null; processing_status: string;
          failure_reason: string | null; provider_reference: string | null; structuring_status: string;
          structuring_failure_reason: string | null; structured_at: string | null;
          structured_proposal_count: number | null; content_hash: string | null;
        },
        {
          id?: string; organization_id: string; handoff_id: string; created_by: string;
          kind: string; title: string; text_content?: string | null; storage_path?: string | null;
          mime_type?: string | null; size_bytes?: number | null; processing_status?: string;
          failure_reason?: string | null; provider_reference?: string | null;
          structuring_status?: string; structuring_failure_reason?: string | null;
          structured_at?: string | null; structured_proposal_count?: number | null;
          content_hash?: string | null;
          created_at?: string; updated_at?: string;
        }
      >;
      captures: Table<
        Timestamped & {
          id: string; organization_id: string; handoff_id: string; created_by: string;
          title: string; text_content: string | null; prompt_id: string | null;
          submitted_at: string | null; structuring_status: string;
          structuring_failure_reason: string | null; structured_at: string | null;
          structured_proposal_count: number | null;
        },
        {
          id?: string; organization_id: string; handoff_id: string; created_by: string;
          title: string; text_content?: string | null; prompt_id?: string | null;
          submitted_at?: string | null; structuring_status?: string;
          structuring_failure_reason?: string | null; structured_at?: string | null;
          structured_proposal_count?: number | null; created_at?: string; updated_at?: string;
        }
      >;
      capture_sources: Table<
        {
          capture_id: string; source_id: string; organization_id: string; handoff_id: string;
          relationship: string; position: number; created_for_capture: boolean;
          removed_at: string | null; created_at: string;
        },
        {
          capture_id: string; source_id: string; organization_id: string; handoff_id: string;
          relationship: string; position?: number; created_for_capture?: boolean;
          removed_at?: string | null; created_at?: string;
        }
      >;
      knowledge_items: Table<
        Timestamped & {
          id: string; organization_id: string; handoff_id: string; created_by: string;
          knowledge_type: string; title: string; content: string; status: string; origin: string;
          uncertainty_note: string | null; sort_order: number; lineage_id: string;
          inherited_from_service_period: string | null;
          proposal_action: string; proposal_target_id: string | null;
          capture_id: string | null;
          decided_by: string | null; decided_at: string | null;
        },
        {
          id?: string; organization_id: string; handoff_id: string; created_by: string;
          knowledge_type: string; title: string; content: string; status: string; origin: string;
          uncertainty_note?: string | null; sort_order?: number; lineage_id?: string;
          proposal_action?: string; proposal_target_id?: string | null;
          capture_id?: string | null;
          decided_by?: string | null; decided_at?: string | null;
          created_at?: string; updated_at?: string;
        }
      >;
      knowledge_lineages: Table<
        Timestamped & {
          id: string; organization_id: string; role_id: string; created_by: string; label: string;
        },
        {
          id?: string; organization_id: string; role_id: string; created_by: string; label: string;
          created_at?: string; updated_at?: string;
        }
      >;
      knowledge_item_revisions: Table<
        {
          id: string; knowledge_item_id: string; organization_id: string; handoff_id: string;
          proposal_id: string | null; knowledge_type: string; title: string; content: string;
          status: string; changed_by: string; changed_at: string;
        },
        {
          id?: string; knowledge_item_id: string; organization_id: string; handoff_id: string;
          proposal_id?: string | null; knowledge_type: string; title: string; content: string;
          status: string; changed_by: string; changed_at?: string;
        }
      >;
      knowledge_item_sources: Table<
        {
          knowledge_item_id: string; source_id: string; handoff_id: string; organization_id: string;
          source_excerpt: string | null; source_locator: string | null; created_at: string;
        },
        {
          knowledge_item_id: string; source_id: string; handoff_id: string; organization_id: string;
          source_excerpt?: string | null; source_locator?: string | null; created_at?: string;
        }
      >;
      preflight_runs: Table<
        Timestamped & {
          id: string; organization_id: string; handoff_id: string; created_by: string;
          status: string; failure_reason: string | null; finding_count: number | null;
          critical_acknowledged_at: string | null; critical_acknowledged_by: string | null;
          started_at: string; completed_at: string | null;
        },
        {
          id?: string; organization_id: string; handoff_id: string; created_by: string;
          status?: string; failure_reason?: string | null; finding_count?: number | null;
          critical_acknowledged_at?: string | null; critical_acknowledged_by?: string | null;
          started_at?: string; completed_at?: string | null; created_at?: string; updated_at?: string;
        }
      >;
      preflight_findings: Table<
        Timestamped & {
          id: string; run_id: string; organization_id: string; handoff_id: string;
          finding_type: string; severity: string; title: string; question: string;
          explanation: string; suggested_knowledge_type: string | null;
          primary_knowledge_item_id: string | null; status: string;
          resolution_knowledge_item_id: string | null; decided_by: string | null;
          decided_at: string | null;
        },
        {
          id?: string; run_id: string; organization_id: string; handoff_id: string;
          finding_type: string; severity: string; title: string; question: string;
          explanation: string; suggested_knowledge_type?: string | null;
          primary_knowledge_item_id?: string | null; status?: string;
          resolution_knowledge_item_id?: string | null; decided_by?: string | null;
          decided_at?: string | null; created_at?: string; updated_at?: string;
        }
      >;
      preflight_finding_evidence: Table<
        {
          id: string; finding_id: string; run_id: string; organization_id: string;
          handoff_id: string; evidence_kind: string; knowledge_item_id: string | null;
          source_id: string | null; label: string; excerpt: string; locator: string | null;
          created_at: string;
        },
        {
          id?: string; finding_id: string; run_id: string; organization_id: string;
          handoff_id: string; evidence_kind: string; knowledge_item_id?: string | null;
          source_id?: string | null; label: string; excerpt: string; locator?: string | null;
          created_at?: string;
        }
      >;
      handoff_publications: Table<
        Timestamped & {
          id: string; organization_id: string; handoff_id: string; access_token: string;
          status: string; organization_name: string; organization_institution: string;
          role_title: string; role_description: string; service_period: string;
          published_by: string; published_at: string; revoked_by: string | null;
          revoked_at: string | null;
        },
        {
          id?: string; organization_id: string; handoff_id: string; access_token: string;
          status?: string; organization_name: string; organization_institution?: string;
          role_title: string; role_description?: string; service_period: string;
          published_by: string; published_at?: string; revoked_by?: string | null;
          revoked_at?: string | null; created_at?: string; updated_at?: string;
        }
      >;
      handoff_publication_items: Table<
        {
          id: string; publication_id: string; organization_id: string; handoff_id: string;
          source_knowledge_item_id: string; knowledge_type: string; title: string;
          content: string; sort_order: number; citation_sources: Json;
          knowledge_lineage_id: string; created_at: string;
        },
        {
          id?: string; publication_id: string; organization_id: string; handoff_id: string;
          source_knowledge_item_id: string; knowledge_type: string; title: string;
          content: string; sort_order: number; citation_sources?: Json;
          knowledge_lineage_id: string; created_at?: string;
        }
      >;
      knowledge_relationships: Table<
        {
          id: string; organization_id: string; role_id: string;
          from_knowledge_item_id: string; to_knowledge_item_id: string;
          relationship_type: string; explanation: string; evidence_source_id: string | null;
          confirmed_by: string | null; created_by: string; created_at: string;
        },
        {
          id?: string; organization_id: string; role_id: string;
          from_knowledge_item_id: string; to_knowledge_item_id: string;
          relationship_type: string; explanation: string; evidence_source_id?: string | null;
          confirmed_by?: string | null; created_by: string; created_at?: string;
        }
      >;
      role_memory_comparisons: Table<
        Timestamped & {
          id: string; organization_id: string; role_id: string;
          previous_publication_id: string; current_publication_id: string;
          previous_service_period: string; current_service_period: string;
          status: string; failure_reason: string | null; material_change_count: number | null;
          created_by: string; completed_at: string | null;
        },
        {
          id?: string; organization_id: string; role_id: string;
          previous_publication_id: string; current_publication_id: string;
          previous_service_period: string; current_service_period: string;
          status?: string; failure_reason?: string | null; material_change_count?: number | null;
          created_by: string; completed_at?: string | null; created_at?: string; updated_at?: string;
        }
      >;
      role_memory_changes: Table<
        {
          id: string; comparison_id: string; organization_id: string; role_id: string;
          change_type: string; title: string; summary: string;
          previous_publication_item_id: string | null; current_publication_item_id: string | null;
          match_basis: string; reason_category: string; reason_explanation: string;
          reason_evidence: Json; before_snapshot: Json | null; after_snapshot: Json | null;
          supporting_provenance: Json; human_confirmed: boolean;
          confirmed_by: string | null; confirmed_at: string | null; created_at: string;
        },
        {
          id?: string; comparison_id: string; organization_id: string; role_id: string;
          change_type: string; title: string; summary: string;
          previous_publication_item_id?: string | null; current_publication_item_id?: string | null;
          match_basis: string; reason_category: string; reason_explanation: string;
          reason_evidence?: Json; before_snapshot?: Json | null; after_snapshot?: Json | null;
          supporting_provenance?: Json; human_confirmed?: boolean;
          confirmed_by?: string | null; confirmed_at?: string | null; created_at?: string;
        }
      >;
      organization_subscriptions: Table<
        Timestamped & {
          id: string; organization_id: string | null; purchaser_user_id: string | null;
          revenuecat_app_user_id: string; entitlement_id: string; status: 'active' | 'inactive';
          product_identifier: string | null; store: string | null;
          expires_at: string | null; revenuecat_checked_at: string;
        },
        {
          id?: string; organization_id?: string | null; purchaser_user_id?: string | null;
          revenuecat_app_user_id: string; entitlement_id: string; status: 'active' | 'inactive';
          product_identifier?: string | null; store?: string | null;
          expires_at?: string | null; revenuecat_checked_at?: string;
          created_at?: string; updated_at?: string;
        }
      >;
      ask_usage_daily: Table<
        {
          publication_id: string; usage_date: string; owner_user_id: string;
          request_count: number; updated_at: string;
        },
        {
          publication_id: string; usage_date?: string; owner_user_id: string;
          request_count?: number; updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      get_organization_continuity: { Args: { requested_organization_id: string }; Returns: Json };
      is_role_holder_for_handoff: { Args: { requested_handoff_id: string }; Returns: boolean };
      can_view_role_history: { Args: { requested_role_id: string }; Returns: boolean };
      create_role_assignment_invite: { Args: { requested_role_id: string; requested_service_period: string; replace_existing: boolean }; Returns: Json };
      preview_role_assignment_invite: { Args: { requested_token: string }; Returns: Json };
      accept_role_assignment_invite: { Args: { requested_token: string }; Returns: string };
      end_role_assignment: { Args: { requested_assignment_id: string }; Returns: undefined };
      reopen_handoff_for_revision: { Args: { requested_handoff_id: string }; Returns: undefined };
      request_organization_ownership_transfer: { Args: { requested_organization_id: string; requested_user_id: string }; Returns: string };
      accept_organization_ownership_transfer: { Args: { requested_transfer_id: string }; Returns: undefined };
      claim_push_token: { Args: { requested_token: string; requested_platform: string }; Returns: undefined };
      create_organization: {
        Args: {
          organization_name: string;
          organization_institution?: string;
          organization_description?: string;
        };
        Returns: string;
      };
      create_role: {
        Args: { requested_organization_id: string; requested_title: string; requested_description?: string };
        Returns: string;
      };
      create_handoff: {
        Args: { requested_organization_id: string; requested_role_id: string; requested_service_period: string };
        Returns: string;
      };
      organization_has_relay_pro: { Args: { requested_organization_id: string }; Returns: boolean };
      purchaser_has_active_relay_pro: { Args: { requested_user_id: string }; Returns: boolean };
      get_organization_plan: { Args: { requested_organization_id: string }; Returns: Json };
      claim_public_ask_request: {
        Args: { requested_token: string; requested_free_limit: number; requested_pro_limit: number };
        Returns: Array<{ publication_id: string; organization_id: string; handoff_id: string; remaining: number }>;
      };
      is_organization_member: { Args: { requested_organization_id: string }; Returns: boolean };
      is_organization_admin: { Args: { requested_organization_id: string }; Returns: boolean };
      organization_id_from_storage_path: { Args: { object_name: string }; Returns: string | null };
      move_knowledge_item: {
        Args: { requested_item_id: string; direction: 'up' | 'down' };
        Returns: undefined;
      };
      begin_handoff_review: { Args: { requested_handoff_id: string }; Returns: undefined };
      return_handoff_to_capture: { Args: { requested_handoff_id: string }; Returns: undefined };
      decide_knowledge_proposal: {
        Args: { requested_item_id: string; decision: 'approved' | 'rejected' };
        Returns: undefined;
      };
      create_capture_draft: {
        Args: {
          requested_organization_id: string;
          requested_handoff_id: string;
          requested_title: string;
          requested_prompt_id?: string | null;
          requested_text_content?: string | null;
        };
        Returns: string;
      };
      attach_source_to_capture: {
        Args: {
          requested_capture_id: string;
          requested_source_id: string;
          requested_position: number;
          requested_created_for_capture: boolean;
        };
        Returns: undefined;
      };
      save_capture: {
        Args: {
          requested_capture_id: string;
          requested_title: string;
          requested_prompt_id: string | null;
          requested_text_content: string | null;
          requested_attachment_source_ids: string[];
        };
        Returns: undefined;
      };
      discard_capture_draft: { Args: { requested_capture_id: string }; Returns: undefined };
      rollback_capture_attachment: {
        Args: { requested_capture_id: string; requested_source_id: string };
        Returns: string | null;
      };
      replace_capture_knowledge_proposals: {
        Args: { requested_capture_id: string; requested_proposals: Json };
        Returns: number;
      };
      replace_source_knowledge_proposals: {
        Args: { requested_source_id: string; requested_proposals: Json };
        Returns: number;
      };
      confirm_memory_change_reason: {
        Args: { requested_change_id: string; requested_reason_category: string; requested_explanation: string };
        Returns: undefined;
      };
      confirm_memory_change_reason_v13: {
        Args: {
          requested_change_id: string;
          requested_reason_category: string;
          requested_explanation: string;
          requested_lesson_knowledge_item_id?: string | null;
        };
        Returns: undefined;
      };
      begin_preflight_run: { Args: { requested_handoff_id: string }; Returns: string };
      complete_preflight_run: {
        Args: { requested_run_id: string; requested_findings: Json };
        Returns: number;
      };
      decide_preflight_finding: {
        Args: { requested_finding_id: string; decision: 'skipped' | 'unknown' };
        Returns: undefined;
      };
      resolve_preflight_finding: {
        Args: {
          requested_finding_id: string;
          requested_knowledge_item_id: string | null;
          requested_knowledge_type: string;
          requested_title: string;
          requested_content: string;
        };
        Returns: string;
      };
      advance_handoff_to_preview: {
        Args: { requested_handoff_id: string; acknowledge_critical?: boolean };
        Returns: undefined;
      };
      publish_handoff: { Args: { requested_handoff_id: string }; Returns: string };
      revoke_handoff_link: { Args: { requested_handoff_id: string }; Returns: undefined };
      replace_handoff_link: { Args: { requested_handoff_id: string }; Returns: string };
      get_shared_handoff: { Args: { requested_token: string }; Returns: Json | null };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
