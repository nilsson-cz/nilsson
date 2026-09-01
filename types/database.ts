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
      _attic_comm_campaign_recipients: {
        Row: {
          campaign_id: string
          guardian_id: string
        }
        Insert: {
          campaign_id: string
          guardian_id: string
        }
        Update: {
          campaign_id?: string
          guardian_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "_attic_comm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_campaign_recipients_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      _attic_comm_campaigns: {
        Row: {
          body_html: string | null
          body_text: string | null
          created_at: string
          created_by: string
          id: string
          sent_at: string | null
          status: string
          subject: string
          target_ref: string | null
          target_type: string
          title: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          created_by: string
          id?: string
          sent_at?: string | null
          status?: string
          subject: string
          target_ref?: string | null
          target_type: string
          title: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          created_by?: string
          id?: string
          sent_at?: string | null
          status?: string
          subject?: string
          target_ref?: string | null
          target_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      _attic_comm_log: {
        Row: {
          campaign_id: string
          email_address: string
          error_detail: string | null
          guardian_id: string
          id: string
          resend_message_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          email_address: string
          error_detail?: string | null
          guardian_id: string
          id?: string
          resend_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          email_address?: string
          error_detail?: string | null
          guardian_id?: string
          id?: string
          resend_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "_attic_comm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_log_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      _attic_hospitace: {
        Row: {
          created_at: string
          datum: string
          hospitant_inst: string | null
          hospitant_jmeno: string
          id: string
          poznamka: string | null
          typ: string
          zaznam_id: string | null
        }
        Insert: {
          created_at?: string
          datum: string
          hospitant_inst?: string | null
          hospitant_jmeno: string
          id?: string
          poznamka?: string | null
          typ: string
          zaznam_id?: string | null
        }
        Update: {
          created_at?: string
          datum?: string
          hospitant_inst?: string | null
          hospitant_jmeno?: string
          id?: string
          poznamka?: string | null
          typ?: string
          zaznam_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hospitace_zaznam_id_fkey"
            columns: ["zaznam_id"]
            isOneToOne: false
            referencedRelation: "tridni_kniha_zaznamy"
            referencedColumns: ["id"]
          },
        ]
      }
      _attic_lunch_allergens: {
        Row: {
          code: number
          name_cs: string
        }
        Insert: {
          code: number
          name_cs: string
        }
        Update: {
          code?: number
          name_cs?: string
        }
        Relationships: []
      }
      _attic_student_notes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_safety_relevant: boolean
          note_text: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_safety_relevant?: boolean
          note_text: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_safety_relevant?: boolean
          note_text?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      _attic_v_staff_id: {
        Row: {
          id: string | null
        }
        Insert: {
          id?: string | null
        }
        Update: {
          id?: string | null
        }
        Relationships: []
      }
      absence_requests: {
        Row: {
          created_at: string
          date_from: string
          date_to: string
          entered_by_staff_id: string | null
          id: string
          je_castecna: boolean
          note_internal: string | null
          reason: string
          requested_by_guardian_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          student_id: string
          time_from: string | null
          time_to: string | null
        }
        Insert: {
          created_at?: string
          date_from: string
          date_to: string
          entered_by_staff_id?: string | null
          id?: string
          je_castecna?: boolean
          note_internal?: string | null
          reason: string
          requested_by_guardian_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id: string
          time_from?: string | null
          time_to?: string | null
        }
        Update: {
          created_at?: string
          date_from?: string
          date_to?: string
          entered_by_staff_id?: string | null
          id?: string
          je_castecna?: boolean
          note_internal?: string | null
          reason?: string
          requested_by_guardian_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string
          time_from?: string | null
          time_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "absence_requests_entered_by_staff_id_fkey"
            columns: ["entered_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_requests_requested_by_guardian_id_fkey"
            columns: ["requested_by_guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          absence_request_id: string | null
          created_at: string
          date: string
          event_id: string | null
          group_id: string
          hodiny: number | null
          id: string
          note: string | null
          slot_id: string | null
          staff_id: string | null
          status: string
          student_id: string
        }
        Insert: {
          absence_request_id?: string | null
          created_at?: string
          date: string
          event_id?: string | null
          group_id: string
          hodiny?: number | null
          id?: string
          note?: string | null
          slot_id?: string | null
          staff_id?: string | null
          status: string
          student_id: string
        }
        Update: {
          absence_request_id?: string | null
          created_at?: string
          date?: string
          event_id?: string | null
          group_id?: string
          hodiny?: number | null
          id?: string
          note?: string | null
          slot_id?: string | null
          staff_id?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_absence_request_id_fkey"
            columns: ["absence_request_id"]
            isOneToOne: false
            referencedRelation: "absence_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      bozp_attendance: {
        Row: {
          bozp_id: string
          student_id: string
        }
        Insert: {
          bozp_id: string
          student_id: string
        }
        Update: {
          bozp_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bozp_attendance_bozp_id_fkey"
            columns: ["bozp_id"]
            isOneToOne: false
            referencedRelation: "bozp_zaznamy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bozp_attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      bozp_zaznamy: {
        Row: {
          created_at: string
          created_by: string | null
          datum: string
          id: string
          je_hromadne: boolean
          popis: string
          school_year: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          datum: string
          id?: string
          je_hromadne?: boolean
          popis: string
          school_year: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          datum?: string
          id?: string
          je_hromadne?: boolean
          popis?: string
          school_year?: string
        }
        Relationships: [
          {
            foreignKeyName: "bozp_zaznamy_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      bulletin_post_recipients: {
        Row: {
          email_at_send: string | null
          guardian_id: string
          post_id: string
        }
        Insert: {
          email_at_send?: string | null
          guardian_id: string
          post_id: string
        }
        Update: {
          email_at_send?: string | null
          guardian_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulletin_post_recipients_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulletin_post_recipients_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "bulletin_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      bulletin_post_staff_recipients: {
        Row: {
          email_at_send: string | null
          post_id: string
          staff_id: string
        }
        Insert: {
          email_at_send?: string | null
          post_id: string
          staff_id: string
        }
        Update: {
          email_at_send?: string | null
          post_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulletin_post_staff_recipients_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "bulletin_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulletin_post_staff_recipients_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      bulletin_post_students: {
        Row: {
          group_id: string
          post_id: string
          student_id: string
        }
        Insert: {
          group_id: string
          post_id: string
          student_id: string
        }
        Update: {
          group_id?: string
          post_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulletin_post_students_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulletin_post_students_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "bulletin_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulletin_post_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      bulletin_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          email_sent_at: string | null
          event_date: string | null
          event_location: string | null
          id: string
          school_year: string
          send_email: boolean
          title: string
          type: string
          updated_at: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          email_sent_at?: string | null
          event_date?: string | null
          event_location?: string | null
          id?: string
          school_year?: string
          send_email?: boolean
          title: string
          type: string
          updated_at?: string
          valid_from: string
          valid_until: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          email_sent_at?: string | null
          event_date?: string | null
          event_location?: string | null
          id?: string
          school_year?: string
          send_email?: boolean
          title?: string
          type?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulletin_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_definitions: {
        Row: {
          body: string
          code: string
          created_at: string
          duration_type: string
          duration_years: number | null
          fixed_until: string | null
          id: string
          is_active: boolean
          legal_basis: string
          requires_reconsent: boolean
          sort_order: number
          special_category: boolean
          subject_type: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          code: string
          created_at?: string
          duration_type: string
          duration_years?: number | null
          fixed_until?: string | null
          id?: string
          is_active?: boolean
          legal_basis: string
          requires_reconsent?: boolean
          sort_order?: number
          special_category?: boolean
          subject_type?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          code?: string
          created_at?: string
          duration_type?: string
          duration_years?: number | null
          fixed_until?: string | null
          id?: string
          is_active?: boolean
          legal_basis?: string
          requires_reconsent?: boolean
          sort_order?: number
          special_category?: boolean
          subject_type?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          created_at: string
          decided_at: string
          decided_by: string
          definition_id: string
          guardian_id: string
          id: string
          status: string
          student_id: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          definition_id: string
          guardian_id: string
          id?: string
          status: string
          student_id: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          definition_id?: string
          guardian_id?: string
          id?: string
          status?: string
          student_id?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "consent_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      disciplinary_measures: {
        Row: {
          created_at: string
          created_by: string
          grade: number | null
          id: string
          justification_text: string
          measure_date: string
          measure_type: string
          school_year: string
          student_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          grade?: number | null
          id?: string
          justification_text: string
          measure_date: string
          measure_type: string
          school_year: string
          student_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          grade?: number | null
          id?: string
          justification_text?: string
          measure_date?: string
          measure_type?: string
          school_year?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disciplinary_measures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplinary_measures_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      dokument_spis: {
        Row: {
          datum_zarazeni: string
          dokument_id: string
          poradi: number | null
          spis_id: string
        }
        Insert: {
          datum_zarazeni?: string
          dokument_id: string
          poradi?: number | null
          spis_id: string
        }
        Update: {
          datum_zarazeni?: string
          dokument_id?: string
          poradi?: number | null
          spis_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dokument_spis_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokument_spis_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokument_spis_spis_id_fkey"
            columns: ["spis_id"]
            isOneToOne: false
            referencedRelation: "spisy"
            referencedColumns: ["id"]
          },
        ]
      }
      dokumenty: {
        Row: {
          cislo_jednaci: string
          created_at: string
          datum_isteni: string | null
          datum_pm: string | null
          datum_prijeti: string | null
          datum_vyrizeni: string | null
          datum_vzniku: string
          datum_zahajeni_lhuty: string | null
          datum_zniceni: string | null
          ds_zprava_id: number | null
          id: string
          poradove_cislo: number
          poznamka: string | null
          predmet: string
          prilohy: Json
          rok: number
          skartacni_lhuta_let: number | null
          skartacni_znak:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          smer: Database["public"]["Enums"]["dokument_smer"]
          stav: Database["public"]["Enums"]["dokument_stav"]
          storno_duvod: string | null
          storno_nahrazeno_id: string | null
          stornovano_at: string | null
          subjekt_id: string | null
          subjekt_nazev_cache: string | null
          updated_at: string
          vecna_skupina_id: string | null
          zniceni_protokol_id: string | null
          zpracovatel_id: string | null
          zpusob_doruceni: Database["public"]["Enums"]["zpusob_doruceni"] | null
          zpusob_vyrizeni: Database["public"]["Enums"]["zpusob_vyrizeni"] | null
        }
        Insert: {
          cislo_jednaci: string
          created_at?: string
          datum_isteni?: string | null
          datum_pm?: string | null
          datum_prijeti?: string | null
          datum_vyrizeni?: string | null
          datum_vzniku?: string
          datum_zahajeni_lhuty?: string | null
          datum_zniceni?: string | null
          ds_zprava_id?: number | null
          id?: string
          poradove_cislo: number
          poznamka?: string | null
          predmet: string
          prilohy?: Json
          rok: number
          skartacni_lhuta_let?: number | null
          skartacni_znak?:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          smer: Database["public"]["Enums"]["dokument_smer"]
          stav?: Database["public"]["Enums"]["dokument_stav"]
          storno_duvod?: string | null
          storno_nahrazeno_id?: string | null
          stornovano_at?: string | null
          subjekt_id?: string | null
          subjekt_nazev_cache?: string | null
          updated_at?: string
          vecna_skupina_id?: string | null
          zniceni_protokol_id?: string | null
          zpracovatel_id?: string | null
          zpusob_doruceni?:
            | Database["public"]["Enums"]["zpusob_doruceni"]
            | null
          zpusob_vyrizeni?:
            | Database["public"]["Enums"]["zpusob_vyrizeni"]
            | null
        }
        Update: {
          cislo_jednaci?: string
          created_at?: string
          datum_isteni?: string | null
          datum_pm?: string | null
          datum_prijeti?: string | null
          datum_vyrizeni?: string | null
          datum_vzniku?: string
          datum_zahajeni_lhuty?: string | null
          datum_zniceni?: string | null
          ds_zprava_id?: number | null
          id?: string
          poradove_cislo?: number
          poznamka?: string | null
          predmet?: string
          prilohy?: Json
          rok?: number
          skartacni_lhuta_let?: number | null
          skartacni_znak?:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          smer?: Database["public"]["Enums"]["dokument_smer"]
          stav?: Database["public"]["Enums"]["dokument_stav"]
          storno_duvod?: string | null
          storno_nahrazeno_id?: string | null
          stornovano_at?: string | null
          subjekt_id?: string | null
          subjekt_nazev_cache?: string | null
          updated_at?: string
          vecna_skupina_id?: string | null
          zniceni_protokol_id?: string | null
          zpracovatel_id?: string | null
          zpusob_doruceni?:
            | Database["public"]["Enums"]["zpusob_doruceni"]
            | null
          zpusob_vyrizeni?:
            | Database["public"]["Enums"]["zpusob_vyrizeni"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "dokumenty_storno_nahrazeno_id_fkey"
            columns: ["storno_nahrazeno_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenty_storno_nahrazeno_id_fkey"
            columns: ["storno_nahrazeno_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenty_subjekt_id_fkey"
            columns: ["subjekt_id"]
            isOneToOne: false
            referencedRelation: "jmenny_rejstrik"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenty_vecna_skupina_id_fkey"
            columns: ["vecna_skupina_id"]
            isOneToOne: false
            referencedRelation: "vecne_skupiny"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dokumenty_zniceni_protokol"
            columns: ["zniceni_protokol_id"]
            isOneToOne: false
            referencedRelation: "skartacni_navrhy"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_denni_zmeny: {
        Row: {
          created_at: string
          created_by: string | null
          datum: string
          id: string
          poznamka_odchod: string | null
          prihlasen: boolean
          school_year: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          datum: string
          id?: string
          poznamka_odchod?: string | null
          prihlasen: boolean
          school_year: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          datum?: string
          id?: string
          poznamka_odchod?: string | null
          prihlasen?: boolean
          school_year?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_denni_zmeny_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_dochazka: {
        Row: {
          cas_odchodu: string | null
          cas_prichodu: string | null
          created_at: string
          datum: string
          id: string
          note: string | null
          odchod_zpusob: string | null
          oddeleni_id: string
          recorded_by: string | null
          status: string
          student_id: string
          updated_at: string
          vyzvedavajici_id: string | null
        }
        Insert: {
          cas_odchodu?: string | null
          cas_prichodu?: string | null
          created_at?: string
          datum: string
          id?: string
          note?: string | null
          odchod_zpusob?: string | null
          oddeleni_id: string
          recorded_by?: string | null
          status?: string
          student_id: string
          updated_at?: string
          vyzvedavajici_id?: string | null
        }
        Update: {
          cas_odchodu?: string | null
          cas_prichodu?: string | null
          created_at?: string
          datum?: string
          id?: string
          note?: string | null
          odchod_zpusob?: string | null
          oddeleni_id?: string
          recorded_by?: string | null
          status?: string
          student_id?: string
          updated_at?: string
          vyzvedavajici_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "druzina_dochazka_oddeleni_id_fkey"
            columns: ["oddeleni_id"]
            isOneToOne: false
            referencedRelation: "druzina_oddeleni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_dochazka_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_dochazka_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_dochazka_vyzvedavajici_id_fkey"
            columns: ["vyzvedavajici_id"]
            isOneToOne: false
            referencedRelation: "druzina_vyzvedavajici"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_enrollments: {
        Row: {
          created_at: string
          date_from: string
          date_to: string | null
          dny_dochazky: string[]
          enrolled_by: string
          id: string
          note: string | null
          odchod_doprovod: boolean
          odchod_sam: boolean
          odchod_sam_cas: string | null
          oddeleni_id: string
          school_year: string
          student_id: string
          unenrolled_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_from: string
          date_to?: string | null
          dny_dochazky?: string[]
          enrolled_by: string
          id?: string
          note?: string | null
          odchod_doprovod?: boolean
          odchod_sam?: boolean
          odchod_sam_cas?: string | null
          oddeleni_id: string
          school_year: string
          student_id: string
          unenrolled_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_from?: string
          date_to?: string | null
          dny_dochazky?: string[]
          enrolled_by?: string
          id?: string
          note?: string | null
          odchod_doprovod?: boolean
          odchod_sam?: boolean
          odchod_sam_cas?: string | null
          oddeleni_id?: string
          school_year?: string
          student_id?: string
          unenrolled_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_enrollments_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_enrollments_oddeleni_id_fkey"
            columns: ["oddeleni_id"]
            isOneToOne: false
            referencedRelation: "druzina_oddeleni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_enrollments_unenrolled_by_fkey"
            columns: ["unenrolled_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_oddeleni: {
        Row: {
          created_at: string
          id: string
          name: string
          school_year: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          school_year: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          school_year?: string
        }
        Relationships: []
      }
      druzina_prihlaska_vyzvedavajici: {
        Row: {
          created_at: string
          id: string
          jmeno: string
          prihlaska_id: string
          telefon: string
        }
        Insert: {
          created_at?: string
          id?: string
          jmeno: string
          prihlaska_id: string
          telefon: string
        }
        Update: {
          created_at?: string
          id?: string
          jmeno?: string
          prihlaska_id?: string
          telefon?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_prihlaska_vyzvedavajici_prihlaska_id_fkey"
            columns: ["prihlaska_id"]
            isOneToOne: false
            referencedRelation: "druzina_prihlasky"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_prihlasky: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          dny_dochazky: string[]
          dokument_id: string | null
          guardian_id: string
          id: string
          odchod_doprovod: boolean
          odchod_sam: boolean
          odchod_sam_cas: string | null
          school_year: string
          souhlas_gdpr_rozsireni: boolean | null
          souhlas_uplata: boolean
          souhlas_vnitrni_rad: boolean
          souhlas_vnitrni_rad_verze: string | null
          stav: string
          student_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          dny_dochazky?: string[]
          dokument_id?: string | null
          guardian_id: string
          id?: string
          odchod_doprovod?: boolean
          odchod_sam?: boolean
          odchod_sam_cas?: string | null
          school_year: string
          souhlas_gdpr_rozsireni?: boolean | null
          souhlas_uplata?: boolean
          souhlas_vnitrni_rad?: boolean
          souhlas_vnitrni_rad_verze?: string | null
          stav?: string
          student_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          dny_dochazky?: string[]
          dokument_id?: string | null
          guardian_id?: string
          id?: string
          odchod_doprovod?: boolean
          odchod_sam?: boolean
          odchod_sam_cas?: string | null
          school_year?: string
          souhlas_gdpr_rozsireni?: boolean | null
          souhlas_uplata?: boolean
          souhlas_vnitrni_rad?: boolean
          souhlas_vnitrni_rad_verze?: string | null
          stav?: string
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_prihlasky_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_prihlasky_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_prihlasky_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_prihlasky_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_prihlasky_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_skolni_rok: {
        Row: {
          created_at: string
          id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          oddeleni_id: string
          school_year: string
          unlocked_at: string | null
          unlocked_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          oddeleni_id: string
          school_year: string
          unlocked_at?: string | null
          unlocked_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          oddeleni_id?: string
          school_year?: string
          unlocked_at?: string | null
          unlocked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "druzina_skolni_rok_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_skolni_rok_oddeleni_id_fkey"
            columns: ["oddeleni_id"]
            isOneToOne: false
            referencedRelation: "druzina_oddeleni"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_skolni_rok_unlocked_by_fkey"
            columns: ["unlocked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_vyzvedavajici: {
        Row: {
          created_at: string
          enrollment_id: string
          id: string
          jmeno: string
          telefon: string
        }
        Insert: {
          created_at?: string
          enrollment_id: string
          id?: string
          jmeno: string
          telefon: string
        }
        Update: {
          created_at?: string
          enrollment_id?: string
          id?: string
          jmeno?: string
          telefon?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_vyzvedavajici_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "druzina_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_zaznamy: {
        Row: {
          cas_do: string | null
          cas_od: string | null
          created_at: string
          datum: string
          den_v_tydnu: string
          id: string
          nazev: string
          oddeleni_id: string
          popis: string | null
          school_year: string
          updated_at: string
        }
        Insert: {
          cas_do?: string | null
          cas_od?: string | null
          created_at?: string
          datum: string
          den_v_tydnu: string
          id?: string
          nazev: string
          oddeleni_id: string
          popis?: string | null
          school_year: string
          updated_at?: string
        }
        Update: {
          cas_do?: string | null
          cas_od?: string | null
          created_at?: string
          datum?: string
          den_v_tydnu?: string
          id?: string
          nazev?: string
          oddeleni_id?: string
          popis?: string | null
          school_year?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_zaznamy_oddeleni_id_fkey"
            columns: ["oddeleni_id"]
            isOneToOne: false
            referencedRelation: "druzina_oddeleni"
            referencedColumns: ["id"]
          },
        ]
      }
      druzina_zaznamy_changes: {
        Row: {
          changed_at: string
          changed_by: string
          duvod_zmeny: string
          hodnota_po: string
          hodnota_pred: string | null
          id: string
          pole: string
          zaznam_id: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          duvod_zmeny: string
          hodnota_po: string
          hodnota_pred?: string | null
          id?: string
          pole: string
          zaznam_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          duvod_zmeny?: string
          hodnota_po?: string
          hodnota_pred?: string | null
          id?: string
          pole?: string
          zaznam_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "druzina_zaznamy_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "druzina_zaznamy_changes_zaznam_id_fkey"
            columns: ["zaznam_id"]
            isOneToOne: false
            referencedRelation: "druzina_zaznamy"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_zpravy: {
        Row: {
          chyba: string | null
          created_at: string
          datum_dodani: string | null
          dokument_id: string | null
          ds_zprava_id: number
          id: string
          odesilatel_id_ds: string | null
          odesilatel_nazev: string | null
          predmet: string | null
          raw_payload: Json
          typ_zpravy: string | null
          zpracovano: boolean
        }
        Insert: {
          chyba?: string | null
          created_at?: string
          datum_dodani?: string | null
          dokument_id?: string | null
          ds_zprava_id: number
          id?: string
          odesilatel_id_ds?: string | null
          odesilatel_nazev?: string | null
          predmet?: string | null
          raw_payload: Json
          typ_zpravy?: string | null
          zpracovano?: boolean
        }
        Update: {
          chyba?: string | null
          created_at?: string
          datum_dodani?: string | null
          dokument_id?: string | null
          ds_zprava_id?: number
          id?: string
          odesilatel_id_ds?: string | null
          odesilatel_nazev?: string | null
          predmet?: string | null
          raw_payload?: Json
          typ_zpravy?: string | null
          zpracovano?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ds_zpravy_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ds_zpravy_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          email_address: string
          event_type: string
          guardian_id: string | null
          id: string
          metadata: Json | null
          occurred_at: string
          resend_id: string | null
          source_id: string
          source_type: string
        }
        Insert: {
          email_address: string
          event_type: string
          guardian_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          resend_id?: string | null
          source_id: string
          source_type: string
        }
        Update: {
          email_address?: string
          event_type?: string
          guardian_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          resend_id?: string | null
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_applications: {
        Row: {
          budouci_rocnik: number | null
          created_at: string
          dalsi_informace: string | null
          datum_narozeni: string
          dite_bydli_jinde: boolean
          dite_jmeno: string
          dite_kontaktni_adresa_cislo: string | null
          dite_kontaktni_adresa_obec: string | null
          dite_kontaktni_adresa_psc: string | null
          dite_kontaktni_adresa_ruian_kod: string | null
          dite_kontaktni_adresa_ulice: string | null
          dite_kontaktni_adresa_validated_at: string | null
          dite_prijmeni: string
          dite_trvale_bydliste_cislo: string
          dite_trvale_bydliste_obec: string
          dite_trvale_bydliste_psc: string
          dite_trvale_bydliste_ruian_kod: string
          dite_trvale_bydliste_ulice: string | null
          dite_trvale_bydliste_validated_at: string
          dosavadni_skola: string | null
          id: string
          individualni_vzdelavani: boolean | null
          jsou_zastupci_rodice: boolean | null
          lekar: string | null
          melo_odklad: boolean
          migrated_at: string | null
          misto_narozeni: string | null
          odklad_lekar_dokument_id: string | null
          odklad_lekar_stav: Database["public"]["Enums"]["enrollment_doklad_stav"]
          odklad_ppp_dokument_id: string | null
          odklad_ppp_stav: Database["public"]["Enums"]["enrollment_doklad_stav"]
          odklad_rezim: string | null
          pohlavi: string | null
          prestup_doporuceni_stav:
            | Database["public"]["Enums"]["enrollment_prestup_doporuceni"]
            | null
          prestup_k_datu: string | null
          prilis_mlade_potvrzeno: boolean
          rodne_cislo: string | null
          soucasna_skola: string | null
          soucasna_trida: string | null
          specificke_potreby: Database["public"]["Enums"]["enrollment_specificke_potreby"]
          spis_id: string | null
          statni_obcanstvi: string | null
          stav: Database["public"]["Enums"]["enrollment_stav"]
          student_id: string | null
          typ: Database["public"]["Enums"]["enrollment_typ"]
          updated_at: string
          vekova_kategorie:
            | Database["public"]["Enums"]["enrollment_vekova_kategorie"]
            | null
          vyzaduje_lekare: boolean
          vyzaduje_ppp: boolean
          vyzaduje_specialistu: boolean
          zdravotni_omezeni: string | null
          zdravotni_pojistovna: string | null
        }
        Insert: {
          budouci_rocnik?: number | null
          created_at?: string
          dalsi_informace?: string | null
          datum_narozeni: string
          dite_bydli_jinde?: boolean
          dite_jmeno: string
          dite_kontaktni_adresa_cislo?: string | null
          dite_kontaktni_adresa_obec?: string | null
          dite_kontaktni_adresa_psc?: string | null
          dite_kontaktni_adresa_ruian_kod?: string | null
          dite_kontaktni_adresa_ulice?: string | null
          dite_kontaktni_adresa_validated_at?: string | null
          dite_prijmeni: string
          dite_trvale_bydliste_cislo: string
          dite_trvale_bydliste_obec: string
          dite_trvale_bydliste_psc: string
          dite_trvale_bydliste_ruian_kod: string
          dite_trvale_bydliste_ulice?: string | null
          dite_trvale_bydliste_validated_at: string
          dosavadni_skola?: string | null
          id?: string
          individualni_vzdelavani?: boolean | null
          jsou_zastupci_rodice?: boolean | null
          lekar?: string | null
          melo_odklad?: boolean
          migrated_at?: string | null
          misto_narozeni?: string | null
          odklad_lekar_dokument_id?: string | null
          odklad_lekar_stav?: Database["public"]["Enums"]["enrollment_doklad_stav"]
          odklad_ppp_dokument_id?: string | null
          odklad_ppp_stav?: Database["public"]["Enums"]["enrollment_doklad_stav"]
          odklad_rezim?: string | null
          pohlavi?: string | null
          prestup_doporuceni_stav?:
            | Database["public"]["Enums"]["enrollment_prestup_doporuceni"]
            | null
          prestup_k_datu?: string | null
          prilis_mlade_potvrzeno?: boolean
          rodne_cislo?: string | null
          soucasna_skola?: string | null
          soucasna_trida?: string | null
          specificke_potreby?: Database["public"]["Enums"]["enrollment_specificke_potreby"]
          spis_id?: string | null
          statni_obcanstvi?: string | null
          stav?: Database["public"]["Enums"]["enrollment_stav"]
          student_id?: string | null
          typ: Database["public"]["Enums"]["enrollment_typ"]
          updated_at?: string
          vekova_kategorie?:
            | Database["public"]["Enums"]["enrollment_vekova_kategorie"]
            | null
          vyzaduje_lekare?: boolean
          vyzaduje_ppp?: boolean
          vyzaduje_specialistu?: boolean
          zdravotni_omezeni?: string | null
          zdravotni_pojistovna?: string | null
        }
        Update: {
          budouci_rocnik?: number | null
          created_at?: string
          dalsi_informace?: string | null
          datum_narozeni?: string
          dite_bydli_jinde?: boolean
          dite_jmeno?: string
          dite_kontaktni_adresa_cislo?: string | null
          dite_kontaktni_adresa_obec?: string | null
          dite_kontaktni_adresa_psc?: string | null
          dite_kontaktni_adresa_ruian_kod?: string | null
          dite_kontaktni_adresa_ulice?: string | null
          dite_kontaktni_adresa_validated_at?: string | null
          dite_prijmeni?: string
          dite_trvale_bydliste_cislo?: string
          dite_trvale_bydliste_obec?: string
          dite_trvale_bydliste_psc?: string
          dite_trvale_bydliste_ruian_kod?: string
          dite_trvale_bydliste_ulice?: string | null
          dite_trvale_bydliste_validated_at?: string
          dosavadni_skola?: string | null
          id?: string
          individualni_vzdelavani?: boolean | null
          jsou_zastupci_rodice?: boolean | null
          lekar?: string | null
          melo_odklad?: boolean
          migrated_at?: string | null
          misto_narozeni?: string | null
          odklad_lekar_dokument_id?: string | null
          odklad_lekar_stav?: Database["public"]["Enums"]["enrollment_doklad_stav"]
          odklad_ppp_dokument_id?: string | null
          odklad_ppp_stav?: Database["public"]["Enums"]["enrollment_doklad_stav"]
          odklad_rezim?: string | null
          pohlavi?: string | null
          prestup_doporuceni_stav?:
            | Database["public"]["Enums"]["enrollment_prestup_doporuceni"]
            | null
          prestup_k_datu?: string | null
          prilis_mlade_potvrzeno?: boolean
          rodne_cislo?: string | null
          soucasna_skola?: string | null
          soucasna_trida?: string | null
          specificke_potreby?: Database["public"]["Enums"]["enrollment_specificke_potreby"]
          spis_id?: string | null
          statni_obcanstvi?: string | null
          stav?: Database["public"]["Enums"]["enrollment_stav"]
          student_id?: string | null
          typ?: Database["public"]["Enums"]["enrollment_typ"]
          updated_at?: string
          vekova_kategorie?:
            | Database["public"]["Enums"]["enrollment_vekova_kategorie"]
            | null
          vyzaduje_lekare?: boolean
          vyzaduje_ppp?: boolean
          vyzaduje_specialistu?: boolean
          zdravotni_omezeni?: string | null
          zdravotni_pojistovna?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_applications_odklad_lekar_dokument_id_fkey"
            columns: ["odklad_lekar_dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_applications_odklad_lekar_dokument_id_fkey"
            columns: ["odklad_lekar_dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_applications_odklad_ppp_dokument_id_fkey"
            columns: ["odklad_ppp_dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_applications_odklad_ppp_dokument_id_fkey"
            columns: ["odklad_ppp_dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_applications_spis_id_fkey"
            columns: ["spis_id"]
            isOneToOne: false
            referencedRelation: "spisy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_applications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_decisions: {
        Row: {
          application_id: string
          cilovy_school_year: string | null
          created_at: string
          datum_nastupu: string | null
          dokument_id: string | null
          duvod: string | null
          id: number
          rozhodl_user_id: string | null
          rozhodnuti: Database["public"]["Enums"]["enrollment_rozhodnuti"]
        }
        Insert: {
          application_id: string
          cilovy_school_year?: string | null
          created_at?: string
          datum_nastupu?: string | null
          dokument_id?: string | null
          duvod?: string | null
          id?: never
          rozhodl_user_id?: string | null
          rozhodnuti: Database["public"]["Enums"]["enrollment_rozhodnuti"]
        }
        Update: {
          application_id?: string
          cilovy_school_year?: string | null
          created_at?: string
          datum_nastupu?: string | null
          dokument_id?: string | null
          duvod?: string | null
          id?: never
          rozhodl_user_id?: string | null
          rozhodnuti?: Database["public"]["Enums"]["enrollment_rozhodnuti"]
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_decisions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "enrollment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_decisions_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_decisions_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_guardians: {
        Row: {
          address_cislo: string | null
          address_obec: string | null
          address_psc: string | null
          address_ruian_kod: string | null
          address_ulice: string | null
          address_validated_at: string | null
          application_id: string
          auth_user_id: string | null
          created_at: string
          datova_schranka: string | null
          email: string
          existujici_guardian_id: string | null
          first_name: string | null
          id: string
          last_name: string | null
          poradi: number
          potvrzeno_at: string | null
          pozvanka_odeslana_at: string | null
          pribuzensky_vztah: string | null
          role_v_zadosti: Database["public"]["Enums"]["enrollment_guardian_role"]
          stav: Database["public"]["Enums"]["enrollment_guardian_stav"]
          telefon: string | null
        }
        Insert: {
          address_cislo?: string | null
          address_obec?: string | null
          address_psc?: string | null
          address_ruian_kod?: string | null
          address_ulice?: string | null
          address_validated_at?: string | null
          application_id: string
          auth_user_id?: string | null
          created_at?: string
          datova_schranka?: string | null
          email: string
          existujici_guardian_id?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          poradi: number
          potvrzeno_at?: string | null
          pozvanka_odeslana_at?: string | null
          pribuzensky_vztah?: string | null
          role_v_zadosti: Database["public"]["Enums"]["enrollment_guardian_role"]
          stav?: Database["public"]["Enums"]["enrollment_guardian_stav"]
          telefon?: string | null
        }
        Update: {
          address_cislo?: string | null
          address_obec?: string | null
          address_psc?: string | null
          address_ruian_kod?: string | null
          address_ulice?: string | null
          address_validated_at?: string | null
          application_id?: string
          auth_user_id?: string | null
          created_at?: string
          datova_schranka?: string | null
          email?: string
          existujici_guardian_id?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          poradi?: number
          potvrzeno_at?: string | null
          pozvanka_odeslana_at?: string | null
          pribuzensky_vztah?: string | null
          role_v_zadosti?: Database["public"]["Enums"]["enrollment_guardian_role"]
          stav?: Database["public"]["Enums"]["enrollment_guardian_stav"]
          telefon?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_guardians_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "enrollment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_guardians_existujici_guardian_id_fkey"
            columns: ["existujici_guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_legal_rules: {
        Row: {
          created_at: string
          id: string
          odklad_stare_pravidla_od_narozeni: string | null
          poznamka: string | null
          rok_zapisu: number
          zdroj_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          odklad_stare_pravidla_od_narozeni?: string | null
          poznamka?: string | null
          rok_zapisu: number
          zdroj_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          odklad_stare_pravidla_od_narozeni?: string | null
          poznamka?: string | null
          rok_zapisu?: number
          zdroj_url?: string | null
        }
        Relationships: []
      }
      enrollment_settings: {
        Row: {
          id: number
          okno_do: string | null
          okno_od: string | null
          updated_at: string
          updated_by: string | null
          zapis_otevren: boolean
        }
        Insert: {
          id?: number
          okno_do?: string | null
          okno_od?: string | null
          updated_at?: string
          updated_by?: string | null
          zapis_otevren?: boolean
        }
        Update: {
          id?: number
          okno_do?: string | null
          okno_od?: string | null
          updated_at?: string
          updated_by?: string | null
          zapis_otevren?: boolean
        }
        Relationships: []
      }
      essl_cj_sekvence: {
        Row: {
          dalsi: number
          rok: number
        }
        Insert: {
          dalsi?: number
          rok: number
        }
        Update: {
          dalsi?: number
          rok?: number
        }
        Relationships: []
      }
      essl_sz_sekvence: {
        Row: {
          dalsi: number
          kod_agendy: string
          rok: number
        }
        Insert: {
          dalsi?: number
          kod_agendy: string
          rok: number
        }
        Update: {
          dalsi?: number
          kod_agendy?: string
          rok?: number
        }
        Relationships: []
      }
      essl_transakce: {
        Row: {
          created_at: string
          detail: Json
          dokument_id: string | null
          id: number
          operace: Database["public"]["Enums"]["essl_operace"]
          skartacni_navrh_id: string | null
          spis_id: string | null
          uzivatel_id: string | null
          uzivatel_popis: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          dokument_id?: string | null
          id?: never
          operace: Database["public"]["Enums"]["essl_operace"]
          skartacni_navrh_id?: string | null
          spis_id?: string | null
          uzivatel_id?: string | null
          uzivatel_popis?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          dokument_id?: string | null
          id?: never
          operace?: Database["public"]["Enums"]["essl_operace"]
          skartacni_navrh_id?: string | null
          spis_id?: string | null
          uzivatel_id?: string | null
          uzivatel_popis?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "essl_transakce_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "essl_transakce_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "essl_transakce_spis_id_fkey"
            columns: ["spis_id"]
            isOneToOne: false
            referencedRelation: "spisy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_essl_transakce_skartacni_navrh"
            columns: ["skartacni_navrh_id"]
            isOneToOne: false
            referencedRelation: "skartacni_navrhy"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string
          date_from: string
          date_to: string | null
          default_amount: number | null
          description: string | null
          id: string
          name: string
          school_year: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          date_from: string
          date_to?: string | null
          default_amount?: number | null
          description?: string | null
          id?: string
          name: string
          school_year: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          date_from?: string
          date_to?: string | null
          default_amount?: number | null
          description?: string | null
          id?: string
          name?: string
          school_year?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memberships: {
        Row: {
          created_at: string
          group_id: string
          id: string
          school_year: string
          student_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          school_year: string
          student_id: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          school_year?: string
          student_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          name: string
          school_year: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          school_year: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          school_year?: string
        }
        Relationships: []
      }
      guardian_questionnaire: {
        Row: {
          created_at: string
          guardian_id: string
          nabidka_exkurze: boolean
          nabidka_profese: boolean
          nabidka_upresneni: string | null
          nabidka_workshop: boolean
          sourozenci_mimo_skolu: Json
          updated_at: string
          zavazne_sdeleni: string | null
        }
        Insert: {
          created_at?: string
          guardian_id: string
          nabidka_exkurze?: boolean
          nabidka_profese?: boolean
          nabidka_upresneni?: string | null
          nabidka_workshop?: boolean
          sourozenci_mimo_skolu?: Json
          updated_at?: string
          zavazne_sdeleni?: string | null
        }
        Update: {
          created_at?: string
          guardian_id?: string
          nabidka_exkurze?: boolean
          nabidka_profese?: boolean
          nabidka_upresneni?: string | null
          nabidka_workshop?: boolean
          sourozenci_mimo_skolu?: Json
          updated_at?: string
          zavazne_sdeleni?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_questionnaire_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: true
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      guardians: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_delivery: string | null
          address_ruian_kod: string | null
          address_street: string | null
          address_validated_at: string | null
          address_zip: string | null
          created_at: string
          data_box_id: string | null
          email: string | null
          first_name: string
          gdpr_consent_at: string | null
          gdpr_consent_version: string | null
          id: string
          last_name: string
          phone_primary: string | null
          phone_secondary: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_delivery?: string | null
          address_ruian_kod?: string | null
          address_street?: string | null
          address_validated_at?: string | null
          address_zip?: string | null
          created_at?: string
          data_box_id?: string | null
          email?: string | null
          first_name: string
          gdpr_consent_at?: string | null
          gdpr_consent_version?: string | null
          id?: string
          last_name: string
          phone_primary?: string | null
          phone_secondary?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_delivery?: string | null
          address_ruian_kod?: string | null
          address_street?: string | null
          address_validated_at?: string | null
          address_zip?: string | null
          created_at?: string
          data_box_id?: string | null
          email?: string | null
          first_name?: string
          gdpr_consent_at?: string | null
          gdpr_consent_version?: string | null
          id?: string
          last_name?: string
          phone_primary?: string | null
          phone_secondary?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      guardians_audit: {
        Row: {
          audit_id: string
          changed_at: string
          changed_by: string | null
          new_data: Json | null
          old_data: Json | null
          operation: string
        }
        Insert: {
          audit_id?: string
          changed_at?: string
          changed_by?: string | null
          new_data?: Json | null
          old_data?: Json | null
          operation: string
        }
        Update: {
          audit_id?: string
          changed_at?: string
          changed_by?: string | null
          new_data?: Json | null
          old_data?: Json | null
          operation?: string
        }
        Relationships: []
      }
      jmenny_rejstrik: {
        Row: {
          adresa: string | null
          created_at: string
          email: string | null
          guardian_id: string | null
          ico: string | null
          id: string
          id_ds: string | null
          nazev: string
          poznamka: string | null
          typ: Database["public"]["Enums"]["jmenny_typ"]
        }
        Insert: {
          adresa?: string | null
          created_at?: string
          email?: string | null
          guardian_id?: string | null
          ico?: string | null
          id?: string
          id_ds?: string | null
          nazev: string
          poznamka?: string | null
          typ: Database["public"]["Enums"]["jmenny_typ"]
        }
        Update: {
          adresa?: string | null
          created_at?: string
          email?: string | null
          guardian_id?: string | null
          ico?: string | null
          id?: string
          id_ds?: string | null
          nazev?: string
          poznamka?: string | null
          typ?: Database["public"]["Enums"]["jmenny_typ"]
        }
        Relationships: [
          {
            foreignKeyName: "jmenny_rejstrik_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      kompetence_poznamky: {
        Row: {
          autor_id: string | null
          created_at: string
          id: string
          school_year: string
          semester: number
          student_id: string
          text: string
          updated_at: string
          vystup_id: string
        }
        Insert: {
          autor_id?: string | null
          created_at?: string
          id?: string
          school_year: string
          semester: number
          student_id: string
          text: string
          updated_at?: string
          vystup_id: string
        }
        Update: {
          autor_id?: string | null
          created_at?: string
          id?: string
          school_year?: string
          semester?: number
          student_id?: string
          text?: string
          updated_at?: string
          vystup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kompetence_poznamky_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kompetence_poznamky_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kompetence_poznamky_vystup_id_fkey"
            columns: ["vystup_id"]
            isOneToOne: false
            referencedRelation: "svp_vystupy"
            referencedColumns: ["id"]
          },
        ]
      }
      lunch_menu_days: {
        Row: {
          id: string
          menu_date: string
          raw_text: string | null
          scraped_at: string
          soup: string | null
          soup_allergens: number[]
          source_url: string
          week_end: string
          week_start: string
          weekday: number
        }
        Insert: {
          id?: string
          menu_date: string
          raw_text?: string | null
          scraped_at?: string
          soup?: string | null
          soup_allergens?: number[]
          source_url?: string
          week_end: string
          week_start: string
          weekday: number
        }
        Update: {
          id?: string
          menu_date?: string
          raw_text?: string | null
          scraped_at?: string
          soup?: string | null
          soup_allergens?: number[]
          source_url?: string
          week_end?: string
          week_start?: string
          weekday?: number
        }
        Relationships: []
      }
      lunch_menu_items: {
        Row: {
          allergens: number[]
          day_id: string
          description: string
          id: string
          option_no: number
        }
        Insert: {
          allergens?: number[]
          day_id: string
          description: string
          id?: string
          option_no: number
        }
        Update: {
          allergens?: number[]
          day_id?: string
          description?: string
          id?: string
          option_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "lunch_menu_items_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "lunch_menu_days"
            referencedColumns: ["id"]
          },
        ]
      }
      lunch_orders: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          id: string
          menu_date: string
          school_year: string
          status: string
          student_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          menu_date: string
          school_year: string
          status?: string
          student_id: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          menu_date?: string
          school_year?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lunch_orders_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      lunch_prices: {
        Row: {
          age_category: string
          id: string
          school_year: string
          unit_price: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          age_category: string
          id?: string
          school_year: string
          unit_price: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          age_category?: string
          id?: string
          school_year?: string
          unit_price?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      lunch_report_log: {
        Row: {
          detail: string | null
          meal_count: number
          older: number | null
          phone: string | null
          report_date: string
          sent_at: string
          sms_ok: boolean
          younger: number | null
        }
        Insert: {
          detail?: string | null
          meal_count: number
          older?: number | null
          phone?: string | null
          report_date: string
          sent_at?: string
          sms_ok?: boolean
          younger?: number | null
        }
        Update: {
          detail?: string | null
          meal_count?: number
          older?: number | null
          phone?: string | null
          report_date?: string
          sent_at?: string
          sms_ok?: boolean
          younger?: number | null
        }
        Relationships: []
      }
      lunch_settings: {
        Row: {
          id: number
          report_phone: string | null
          send_hour: number
          sms_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          report_phone?: string | null
          send_hour?: number
          sms_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          report_phone?: string | null
          send_hour?: number
          sms_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      mapa_pokroku_hodnoceni: {
        Row: {
          created_at: string
          hodnotil_id: string | null
          id: string
          poznamka: string | null
          school_year: string
          semester: number
          student_id: string
          stupen: Database["public"]["Enums"]["stupen_zvladnuti"]
          updated_at: string
          vystup_id: string
        }
        Insert: {
          created_at?: string
          hodnotil_id?: string | null
          id?: string
          poznamka?: string | null
          school_year: string
          semester: number
          student_id: string
          stupen: Database["public"]["Enums"]["stupen_zvladnuti"]
          updated_at?: string
          vystup_id: string
        }
        Update: {
          created_at?: string
          hodnotil_id?: string | null
          id?: string
          poznamka?: string | null
          school_year?: string
          semester?: number
          student_id?: string
          stupen?: Database["public"]["Enums"]["stupen_zvladnuti"]
          updated_at?: string
          vystup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mapa_pokroku_hodnoceni_hodnotil_id_fkey"
            columns: ["hodnotil_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapa_pokroku_hodnoceni_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapa_pokroku_hodnoceni_vystup_id_fkey"
            columns: ["vystup_id"]
            isOneToOne: false
            referencedRelation: "svp_vystupy"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_matches: {
        Row: {
          donation_amount: number
          matched_amount: number
          matched_at: string
          matched_by: string | null
          obligation_id: string
          transaction_id: string
        }
        Insert: {
          donation_amount?: number
          matched_amount: number
          matched_at?: string
          matched_by?: string | null
          obligation_id: string
          transaction_id: string
        }
        Update: {
          donation_amount?: number
          matched_amount?: number
          matched_at?: string
          matched_by?: string | null
          obligation_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_matches_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_matches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_obligations: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          currency: string
          due_date: string
          id: string
          notified_at: string | null
          period: string | null
          popis: string | null
          reference_event_id: string | null
          school_year: string
          ss_kod: string | null
          student_id: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          currency?: string
          due_date: string
          id?: string
          notified_at?: string | null
          period?: string | null
          popis?: string | null
          reference_event_id?: string | null
          school_year: string
          ss_kod?: string | null
          student_id: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          currency?: string
          due_date?: string
          id?: string
          notified_at?: string | null
          period?: string | null
          popis?: string | null
          reference_event_id?: string | null
          school_year?: string
          ss_kod?: string | null
          student_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_obligations_reference_event_id_fkey"
            columns: ["reference_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          counterparty_account: string | null
          counterparty_name: string | null
          currency: string
          fio_transaction_id: string
          id: string
          ignored: boolean
          imported_at: string
          match_status: string
          note: string | null
          specific_symbol: string | null
          student_id: string | null
          transaction_date: string
          updated_at: string
          variable_symbol: string | null
        }
        Insert: {
          amount: number
          counterparty_account?: string | null
          counterparty_name?: string | null
          currency?: string
          fio_transaction_id: string
          id?: string
          ignored?: boolean
          imported_at?: string
          match_status?: string
          note?: string | null
          specific_symbol?: string | null
          student_id?: string | null
          transaction_date: string
          updated_at?: string
          variable_symbol?: string | null
        }
        Update: {
          amount?: number
          counterparty_account?: string | null
          counterparty_name?: string | null
          currency?: string
          fio_transaction_id?: string
          id?: string
          ignored?: boolean
          imported_at?: string
          match_status?: string
          note?: string | null
          specific_symbol?: string | null
          student_id?: string | null
          transaction_date?: string
          updated_at?: string
          variable_symbol?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      rozvrh_blok: {
        Row: {
          cas_do: string
          cas_od: string
          created_at: string
          datum: string
          id: string
          nazev: string
          obsah: string | null
          potvrzeno_at: string | null
          potvrzeno_by: string | null
          sablona_id: string | null
          school_year: string
          stav: string
          tridni_zaznam_id: string | null
          typ_bloku: string
        }
        Insert: {
          cas_do: string
          cas_od: string
          created_at?: string
          datum: string
          id?: string
          nazev: string
          obsah?: string | null
          potvrzeno_at?: string | null
          potvrzeno_by?: string | null
          sablona_id?: string | null
          school_year: string
          stav?: string
          tridni_zaznam_id?: string | null
          typ_bloku?: string
        }
        Update: {
          cas_do?: string
          cas_od?: string
          created_at?: string
          datum?: string
          id?: string
          nazev?: string
          obsah?: string | null
          potvrzeno_at?: string | null
          potvrzeno_by?: string | null
          sablona_id?: string | null
          school_year?: string
          stav?: string
          tridni_zaznam_id?: string | null
          typ_bloku?: string
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_blok_potvrzeno_by_fkey"
            columns: ["potvrzeno_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_sablona_id_fkey"
            columns: ["sablona_id"]
            isOneToOne: false
            referencedRelation: "rozvrh_blok_sablona"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_tridni_zaznam_id_fkey"
            columns: ["tridni_zaznam_id"]
            isOneToOne: false
            referencedRelation: "tridni_kniha_zaznamy"
            referencedColumns: ["id"]
          },
        ]
      }
      rozvrh_blok_priznak: {
        Row: {
          blok_id: string
          id: string
          nastaveno_at: string
          nastavil_by: string
          osoba_staff_id: string | null
          poznamka: string | null
          typ_kod: string
        }
        Insert: {
          blok_id: string
          id?: string
          nastaveno_at?: string
          nastavil_by: string
          osoba_staff_id?: string | null
          poznamka?: string | null
          typ_kod: string
        }
        Update: {
          blok_id?: string
          id?: string
          nastaveno_at?: string
          nastavil_by?: string
          osoba_staff_id?: string | null
          poznamka?: string | null
          typ_kod?: string
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_blok_priznak_blok_id_fkey"
            columns: ["blok_id"]
            isOneToOne: false
            referencedRelation: "rozvrh_blok"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_priznak_blok_id_fkey"
            columns: ["blok_id"]
            isOneToOne: false
            referencedRelation: "v_vykaz_ppc_blok"
            referencedColumns: ["blok_id"]
          },
          {
            foreignKeyName: "rozvrh_blok_priznak_nastavil_by_fkey"
            columns: ["nastavil_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_priznak_osoba_staff_id_fkey"
            columns: ["osoba_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_priznak_typ_kod_fkey"
            columns: ["typ_kod"]
            isOneToOne: false
            referencedRelation: "tridnice_priznak_typ"
            referencedColumns: ["kod"]
          },
        ]
      }
      rozvrh_blok_sablona: {
        Row: {
          cas_do: string
          cas_od: string
          created_at: string
          created_by: string | null
          den_v_tydnu: number
          group_id: string
          id: string
          nazev: string
          school_year: string
          typ_bloku: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          cas_do: string
          cas_od: string
          created_at?: string
          created_by?: string | null
          den_v_tydnu: number
          group_id: string
          id?: string
          nazev: string
          school_year: string
          typ_bloku?: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          cas_do?: string
          cas_od?: string
          created_at?: string
          created_by?: string | null
          den_v_tydnu?: number
          group_id?: string
          id?: string
          nazev?: string
          school_year?: string
          typ_bloku?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_blok_sablona_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_sablona_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      rozvrh_blok_skupiny: {
        Row: {
          blok_id: string
          group_id: string
        }
        Insert: {
          blok_id: string
          group_id: string
        }
        Update: {
          blok_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_blok_skupiny_blok_id_fkey"
            columns: ["blok_id"]
            isOneToOne: false
            referencedRelation: "rozvrh_blok"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_blok_skupiny_blok_id_fkey"
            columns: ["blok_id"]
            isOneToOne: false
            referencedRelation: "v_vykaz_ppc_blok"
            referencedColumns: ["blok_id"]
          },
          {
            foreignKeyName: "rozvrh_blok_skupiny_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      rozvrh_changes: {
        Row: {
          akce: string
          changed_at: string
          changed_by: string | null
          entita: string
          entita_id: string
          id: string
          stav_po: Json | null
          stav_pred: Json | null
        }
        Insert: {
          akce: string
          changed_at?: string
          changed_by?: string | null
          entita: string
          entita_id: string
          id?: string
          stav_po?: Json | null
          stav_pred?: Json | null
        }
        Update: {
          akce?: string
          changed_at?: string
          changed_by?: string | null
          entita?: string
          entita_id?: string
          id?: string
          stav_po?: Json | null
          stav_pred?: Json | null
        }
        Relationships: []
      }
      rozvrh_obsazeni: {
        Row: {
          blok_id: string
          created_at: string
          id: string
          je_suplovani: boolean
          pozice_na_bloku: string
          staff_id: string
          supluje_za_staff_id: string | null
          zapocitat_ppc: boolean
        }
        Insert: {
          blok_id: string
          created_at?: string
          id?: string
          je_suplovani?: boolean
          pozice_na_bloku?: string
          staff_id: string
          supluje_za_staff_id?: string | null
          zapocitat_ppc?: boolean
        }
        Update: {
          blok_id?: string
          created_at?: string
          id?: string
          je_suplovani?: boolean
          pozice_na_bloku?: string
          staff_id?: string
          supluje_za_staff_id?: string | null
          zapocitat_ppc?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_obsazeni_blok_id_fkey"
            columns: ["blok_id"]
            isOneToOne: false
            referencedRelation: "rozvrh_blok"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_obsazeni_blok_id_fkey"
            columns: ["blok_id"]
            isOneToOne: false
            referencedRelation: "v_vykaz_ppc_blok"
            referencedColumns: ["blok_id"]
          },
          {
            foreignKeyName: "rozvrh_obsazeni_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_obsazeni_supluje_za_staff_id_fkey"
            columns: ["supluje_za_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      rozvrh_sablona_obsazeni: {
        Row: {
          blok_sablona_id: string
          id: string
          pozice_na_bloku: string
          staff_id: string
        }
        Insert: {
          blok_sablona_id: string
          id?: string
          pozice_na_bloku?: string
          staff_id: string
        }
        Update: {
          blok_sablona_id?: string
          id?: string
          pozice_na_bloku?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_sablona_obsazeni_blok_sablona_id_fkey"
            columns: ["blok_sablona_id"]
            isOneToOne: false
            referencedRelation: "rozvrh_blok_sablona"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rozvrh_sablona_obsazeni_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      ruian_adresni_mista: {
        Row: {
          cislo_domovni: string
          cislo_orientacni: string | null
          imported_at: string
          kod_casti_obce: string | null
          kod_momc: string | null
          kod_obce: string
          kod_obvodu_prahy: string | null
          kod_ulice: string | null
          nazev_casti_obce: string | null
          nazev_momc: string | null
          nazev_obvodu_prahy: string | null
          nazev_ulice: string | null
          plati_od: string
          psc: string
          ruian_kod: number
          souradnice_x: number | null
          souradnice_y: number | null
          typ_so: string
          znak_cisla_orientacniho: string | null
        }
        Insert: {
          cislo_domovni: string
          cislo_orientacni?: string | null
          imported_at?: string
          kod_casti_obce?: string | null
          kod_momc?: string | null
          kod_obce: string
          kod_obvodu_prahy?: string | null
          kod_ulice?: string | null
          nazev_casti_obce?: string | null
          nazev_momc?: string | null
          nazev_obvodu_prahy?: string | null
          nazev_ulice?: string | null
          plati_od: string
          psc: string
          ruian_kod: number
          souradnice_x?: number | null
          souradnice_y?: number | null
          typ_so: string
          znak_cisla_orientacniho?: string | null
        }
        Update: {
          cislo_domovni?: string
          cislo_orientacni?: string | null
          imported_at?: string
          kod_casti_obce?: string | null
          kod_momc?: string | null
          kod_obce?: string
          kod_obvodu_prahy?: string | null
          kod_ulice?: string | null
          nazev_casti_obce?: string | null
          nazev_momc?: string | null
          nazev_obvodu_prahy?: string | null
          nazev_ulice?: string | null
          plati_od?: string
          psc?: string
          ruian_kod?: number
          souradnice_x?: number | null
          souradnice_y?: number | null
          typ_so?: string
          znak_cisla_orientacniho?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ruian_adresni_mista_kod_obce_fkey"
            columns: ["kod_obce"]
            isOneToOne: false
            referencedRelation: "ruian_obce"
            referencedColumns: ["kod_obce"]
          },
        ]
      }
      ruian_obce: {
        Row: {
          cleneni_rozsah_kod: string | null
          cleneni_typ_kod: string | null
          datum_vzniku: string | null
          imported_at: string
          kod_obce: string
          kod_okresu: string
          nazev_obce: string
          plati_od: string | null
          pou_kod: string | null
          status_kod: number
        }
        Insert: {
          cleneni_rozsah_kod?: string | null
          cleneni_typ_kod?: string | null
          datum_vzniku?: string | null
          imported_at?: string
          kod_obce: string
          kod_okresu: string
          nazev_obce: string
          plati_od?: string | null
          pou_kod?: string | null
          status_kod: number
        }
        Update: {
          cleneni_rozsah_kod?: string | null
          cleneni_typ_kod?: string | null
          datum_vzniku?: string | null
          imported_at?: string
          kod_obce?: string
          kod_okresu?: string
          nazev_obce?: string
          plati_od?: string | null
          pou_kod?: string | null
          status_kod?: number
        }
        Relationships: [
          {
            foreignKeyName: "ruian_obce_kod_okresu_fkey"
            columns: ["kod_okresu"]
            isOneToOne: false
            referencedRelation: "ruian_okresy"
            referencedColumns: ["kod_okresu"]
          },
        ]
      }
      ruian_okresy: {
        Row: {
          datum_vzniku: string | null
          imported_at: string
          kod_kraje: string
          kod_okresu: string
          nazev_okresu: string
          nuts_lau: string | null
          plati_od: string | null
        }
        Insert: {
          datum_vzniku?: string | null
          imported_at?: string
          kod_kraje: string
          kod_okresu: string
          nazev_okresu: string
          nuts_lau?: string | null
          plati_od?: string | null
        }
        Update: {
          datum_vzniku?: string | null
          imported_at?: string
          kod_kraje?: string
          kod_okresu?: string
          nazev_okresu?: string
          nuts_lau?: string | null
          plati_od?: string | null
        }
        Relationships: []
      }
      school_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          datum: string
          id: string
          nazev: string
          school_year: string
          typ: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          datum: string
          id?: string
          nazev: string
          school_year: string
          typ: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          datum?: string
          id?: string
          nazev?: string
          school_year?: string
          typ?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      school_programs: {
        Row: {
          created_at: string
          id: string
          rvp_name: string
          svp_file_number: string | null
          svp_name: string
          svp_valid_from: string | null
          svp_valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          rvp_name: string
          svp_file_number?: string | null
          svp_name: string
          svp_valid_from?: string | null
          svp_valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          rvp_name?: string
          svp_file_number?: string | null
          svp_name?: string
          svp_valid_from?: string | null
          svp_valid_to?: string | null
        }
        Relationships: []
      }
      school_year_config: {
        Row: {
          active_year: string | null
          id: number
          updated_at: string
          updated_by: string | null
          visible_years: string[] | null
        }
        Insert: {
          active_year?: string | null
          id?: number
          updated_at?: string
          updated_by?: string | null
          visible_years?: string[] | null
        }
        Update: {
          active_year?: string | null
          id?: number
          updated_at?: string
          updated_by?: string | null
          visible_years?: string[] | null
        }
        Relationships: []
      }
      semester_attendance_summary: {
        Row: {
          created_at: string
          group_id: string
          id: string
          locked_at: string | null
          locked_by: string | null
          neoml_h: number | null
          oml_h: number | null
          school_year: string
          semester: number
          student_id: string
          transfer_hours_neoml: number
          transfer_hours_oml: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          neoml_h?: number | null
          oml_h?: number | null
          school_year: string
          semester: number
          student_id: string
          transfer_hours_neoml?: number
          transfer_hours_oml?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          neoml_h?: number | null
          oml_h?: number | null
          school_year?: string
          semester?: number
          student_id?: string
          transfer_hours_neoml?: number
          transfer_hours_oml?: number
        }
        Relationships: [
          {
            foreignKeyName: "semester_attendance_summary_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "semester_attendance_summary_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "semester_attendance_summary_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      skartacni_navrh_polozky: {
        Row: {
          datum_zniceni: string | null
          dokument_id: string | null
          id: string
          navrh_id: string
          poznamka: string | null
          rozhodnuti: string
          skartacni_znak: Database["public"]["Enums"]["skartacni_znak_enum"]
          spis_id: string | null
        }
        Insert: {
          datum_zniceni?: string | null
          dokument_id?: string | null
          id?: string
          navrh_id: string
          poznamka?: string | null
          rozhodnuti?: string
          skartacni_znak: Database["public"]["Enums"]["skartacni_znak_enum"]
          spis_id?: string | null
        }
        Update: {
          datum_zniceni?: string | null
          dokument_id?: string | null
          id?: string
          navrh_id?: string
          poznamka?: string | null
          rozhodnuti?: string
          skartacni_znak?: Database["public"]["Enums"]["skartacni_znak_enum"]
          spis_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skartacni_navrh_polozky_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skartacni_navrh_polozky_dokument_id_fkey"
            columns: ["dokument_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skartacni_navrh_polozky_navrh_id_fkey"
            columns: ["navrh_id"]
            isOneToOne: false
            referencedRelation: "skartacni_navrhy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skartacni_navrh_polozky_spis_id_fkey"
            columns: ["spis_id"]
            isOneToOne: false
            referencedRelation: "spisy"
            referencedColumns: ["id"]
          },
        ]
      }
      skartacni_navrhy: {
        Row: {
          archiv_ref: string | null
          created_at: string
          datum_odeslani: string | null
          datum_sestaveni: string
          datum_souhlasu: string | null
          id: string
          poznamka: string | null
          rok_skartace: number
          sestavil_id: string | null
          stav: string
          updated_at: string
        }
        Insert: {
          archiv_ref?: string | null
          created_at?: string
          datum_odeslani?: string | null
          datum_sestaveni?: string
          datum_souhlasu?: string | null
          id?: string
          poznamka?: string | null
          rok_skartace: number
          sestavil_id?: string | null
          stav?: string
          updated_at?: string
        }
        Update: {
          archiv_ref?: string | null
          created_at?: string
          datum_odeslani?: string | null
          datum_sestaveni?: string
          datum_souhlasu?: string | null
          id?: string
          poznamka?: string | null
          rok_skartace?: number
          sestavil_id?: string | null
          stav?: string
          updated_at?: string
        }
        Relationships: []
      }
      spisy: {
        Row: {
          created_at: string
          datum_isteni: string | null
          datum_otevreni: string
          datum_uzavreni: string | null
          datum_zahajeni_lhuty: string | null
          id: string
          kod_agendy: string
          nazev: string
          poradove_cislo: number
          poznamka: string | null
          rok: number
          skartacni_lhuta_let: number | null
          skartacni_znak:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          spisova_znacka: string
          stav: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          datum_isteni?: string | null
          datum_otevreni?: string
          datum_uzavreni?: string | null
          datum_zahajeni_lhuty?: string | null
          id?: string
          kod_agendy: string
          nazev: string
          poradove_cislo: number
          poznamka?: string | null
          rok: number
          skartacni_lhuta_let?: number | null
          skartacni_znak?:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          spisova_znacka: string
          stav?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          datum_isteni?: string | null
          datum_otevreni?: string
          datum_uzavreni?: string | null
          datum_zahajeni_lhuty?: string | null
          id?: string
          kod_agendy?: string
          nazev?: string
          poradove_cislo?: number
          poznamka?: string | null
          rok?: number
          skartacni_lhuta_let?: number | null
          skartacni_znak?:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          spisova_znacka?: string
          stav?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          birth_number: string | null
          created_at: string
          email: string
          employment_end: string | null
          employment_start: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          first_name: string
          id: string
          last_name: string
          qualification_code: string | null
          role: Database["public"]["Enums"]["staff_role"]
          subject_codes: string[] | null
          typ_zamestnance: Database["public"]["Enums"]["typ_zamestnance"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          birth_number?: string | null
          created_at?: string
          email: string
          employment_end?: string | null
          employment_start?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name: string
          id?: string
          last_name: string
          qualification_code?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          subject_codes?: string[] | null
          typ_zamestnance: Database["public"]["Enums"]["typ_zamestnance"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          birth_number?: string | null
          created_at?: string
          email?: string
          employment_end?: string | null
          employment_start?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name?: string
          id?: string
          last_name?: string
          qualification_code?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          subject_codes?: string[] | null
          typ_zamestnance?: Database["public"]["Enums"]["typ_zamestnance"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      staff_absence: {
        Row: {
          created_at: string
          created_by: string | null
          date_from: string
          date_to: string
          id: string
          poznamka: string | null
          staff_id: string
          typ: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date_from: string
          date_to: string
          id?: string
          poznamka?: string | null
          staff_id: string
          typ: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date_from?: string
          date_to?: string
          id?: string
          poznamka?: string | null
          staff_id?: string
          typ?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_absence_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_absence_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_consent_records: {
        Row: {
          created_at: string
          decided_at: string
          decided_by: string
          definition_id: string
          id: string
          staff_id: string
          status: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          definition_id: string
          id?: string
          staff_id: string
          status: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          definition_id?: string
          id?: string
          staff_id?: string
          status?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_consent_records_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "consent_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_consent_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_discord: {
        Row: {
          created_at: string
          discord_user_id: string
          discord_username: string | null
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discord_user_id: string
          discord_username?: string | null
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discord_user_id?: string
          discord_username?: string | null
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_discord_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_groups: {
        Row: {
          created_at: string
          group_id: string
          id: string
          school_year: string
          staff_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          school_year: string
          staff_id: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          school_year?: string
          staff_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_groups_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          staff_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          staff_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          staff_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_roles_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      student_contracts: {
        Row: {
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at: string
          created_by: string
          document_url: string | null
          effective_date: string
          end_date: string | null
          id: string
          notes: string | null
          signed_date: string
          student_id: string
          version_number: number
        }
        Insert: {
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by: string
          document_url?: string | null
          effective_date: string
          end_date?: string | null
          id?: string
          notes?: string | null
          signed_date: string
          student_id: string
          version_number?: number
        }
        Update: {
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by?: string
          document_url?: string | null
          effective_date?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          signed_date?: string
          student_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_contracts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_education_mode: {
        Row: {
          created_at: string
          created_by: string
          id: string
          rocnik: number | null
          student_id: string
          valid_from: string
          valid_to: string | null
          zpusob: Database["public"]["Enums"]["zpusob_plneni_psd"]
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          rocnik?: number | null
          student_id: string
          valid_from: string
          valid_to?: string | null
          zpusob: Database["public"]["Enums"]["zpusob_plneni_psd"]
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          rocnik?: number | null
          student_id?: string
          valid_from?: string
          valid_to?: string | null
          zpusob?: Database["public"]["Enums"]["zpusob_plneni_psd"]
        }
        Relationships: [
          {
            foreignKeyName: "student_education_mode_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_education_mode_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_guardian_links: {
        Row: {
          created_at: string
          guardian_id: string
          id: string
          je_primarni_kontakt: boolean
          je_zakonny_zastupce: boolean
          legal_document_ref: string | null
          platnost_do: string | null
          platnost_od: string | null
          pravni_titul: string | null
          role: Database["public"]["Enums"]["guardian_role"]
          student_id: string
        }
        Insert: {
          created_at?: string
          guardian_id: string
          id?: string
          je_primarni_kontakt?: boolean
          je_zakonny_zastupce?: boolean
          legal_document_ref?: string | null
          platnost_do?: string | null
          platnost_od?: string | null
          pravni_titul?: string | null
          role: Database["public"]["Enums"]["guardian_role"]
          student_id: string
        }
        Update: {
          created_at?: string
          guardian_id?: string
          id?: string
          je_primarni_kontakt?: boolean
          je_zakonny_zastupce?: boolean
          legal_document_ref?: string | null
          platnost_do?: string | null
          platnost_od?: string | null
          pravni_titul?: string | null
          role?: Database["public"]["Enums"]["guardian_role"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_guardian_links_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_guardian_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_matrika_a: {
        Row: {
          created_at: string
          created_by: string
          id: string
          id_znev: string | null
          indi: string | null
          jaz_podp: boolean
          jaz_prip: boolean
          nadani: string | null
          prodl_dv: boolean
          pspo: number | null
          student_id: string
          sz: string
          typ_tr: string
          upr_vyst: boolean
          uvp: boolean
          valid_from: string
          valid_to: string | null
          zvj: string | null
          zz: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          id_znev?: string | null
          indi?: string | null
          jaz_podp?: boolean
          jaz_prip?: boolean
          nadani?: string | null
          prodl_dv?: boolean
          pspo?: number | null
          student_id: string
          sz?: string
          typ_tr?: string
          upr_vyst?: boolean
          uvp?: boolean
          valid_from: string
          valid_to?: string | null
          zvj?: string | null
          zz?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          id_znev?: string | null
          indi?: string | null
          jaz_podp?: boolean
          jaz_prip?: boolean
          nadani?: string | null
          prodl_dv?: boolean
          pspo?: number | null
          student_id?: string
          sz?: string
          typ_tr?: string
          upr_vyst?: boolean
          uvp?: boolean
          valid_from?: string
          valid_to?: string | null
          zvj?: string | null
          zz?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_matrika_a_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_matrika_a_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_matrika_changes: {
        Row: {
          created_at: string
          datum_zmeny: string
          dokument_ref: string | null
          hodnota_po: string
          hodnota_pred: string | null
          id: string
          pole: string
          student_id: string
          zaznamenal: string
          zdroj_zmeny: string
        }
        Insert: {
          created_at?: string
          datum_zmeny: string
          dokument_ref?: string | null
          hodnota_po: string
          hodnota_pred?: string | null
          id?: string
          pole: string
          student_id: string
          zaznamenal: string
          zdroj_zmeny: string
        }
        Update: {
          created_at?: string
          datum_zmeny?: string
          dokument_ref?: string | null
          hodnota_po?: string
          hodnota_pred?: string | null
          id?: string
          pole?: string
          student_id?: string
          zaznamenal?: string
          zdroj_zmeny?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_matrika_changes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_questionnaire: {
        Row: {
          created_at: string
          jine_sdeleni: string | null
          leky_davkovani: string | null
          leky_podavat_povoleno: boolean
          leky_potvrzeno_lekarem: boolean
          obavy: string | null
          osloveni: string | null
          plavec: boolean | null
          potreby_navyky: string | null
          problemy_reseni: string | null
          rodinne_zazemi: string | null
          student_id: string
          updated_at: string
          updated_by_guardian_id: string | null
          vliv_na_chovani: string | null
          zdr_alergie: string | null
          zdr_dietni_omezeni: string | null
          zdr_jine: string | null
          zdr_leky: string | null
          zdr_onemocneni_urazy: string | null
          zdr_pohybova_omezeni: string | null
          zdr_seed_ze_zapisu: boolean
        }
        Insert: {
          created_at?: string
          jine_sdeleni?: string | null
          leky_davkovani?: string | null
          leky_podavat_povoleno?: boolean
          leky_potvrzeno_lekarem?: boolean
          obavy?: string | null
          osloveni?: string | null
          plavec?: boolean | null
          potreby_navyky?: string | null
          problemy_reseni?: string | null
          rodinne_zazemi?: string | null
          student_id: string
          updated_at?: string
          updated_by_guardian_id?: string | null
          vliv_na_chovani?: string | null
          zdr_alergie?: string | null
          zdr_dietni_omezeni?: string | null
          zdr_jine?: string | null
          zdr_leky?: string | null
          zdr_onemocneni_urazy?: string | null
          zdr_pohybova_omezeni?: string | null
          zdr_seed_ze_zapisu?: boolean
        }
        Update: {
          created_at?: string
          jine_sdeleni?: string | null
          leky_davkovani?: string | null
          leky_podavat_povoleno?: boolean
          leky_potvrzeno_lekarem?: boolean
          obavy?: string | null
          osloveni?: string | null
          plavec?: boolean | null
          potreby_navyky?: string | null
          problemy_reseni?: string | null
          rodinne_zazemi?: string | null
          student_id?: string
          updated_at?: string
          updated_by_guardian_id?: string | null
          vliv_na_chovani?: string | null
          zdr_alergie?: string | null
          zdr_dietni_omezeni?: string | null
          zdr_jine?: string | null
          zdr_leky?: string | null
          zdr_onemocneni_urazy?: string | null
          zdr_pohybova_omezeni?: string | null
          zdr_seed_ze_zapisu?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "student_questionnaire_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_questionnaire_updated_by_guardian_id_fkey"
            columns: ["updated_by_guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      student_school_history: {
        Row: {
          created_at: string
          id: string
          period_from: string
          period_to: string | null
          school_address: string | null
          school_izo: string | null
          school_name: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_from: string
          period_to?: string | null
          school_address?: string | null
          school_izo?: string | null
          school_name: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period_from?: string
          period_to?: string | null
          school_address?: string | null
          school_izo?: string | null
          school_name?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_school_history_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          birth_date: string
          birth_number: string | null
          birth_place: string | null
          citizenship: string | null
          cizi_jazyky: Json | null
          created_at: string
          delka_programu: number | null
          education_mode: string | null
          enrollment_date: string
          first_name: string
          has_svp: boolean
          health_fitness_note: string | null
          health_insurance_code: string | null
          id: string
          kat_list_drive_url: string | null
          kat_list_poznamka: string | null
          kat_list_stav: Database["public"]["Enums"]["kat_list_stav"] | null
          kod_zahajeni: string | null
          kod_zaka: string
          kod_zaka_msmt: string | null
          last_name: string
          nationality: string | null
          obec_bydliste_kod: string | null
          okres_bydliste_kod: string | null
          photo_consent: boolean
          predchozi_skola_izo: string | null
          predchozi_vzdelavani: string | null
          sp_obvod: string | null
          status: Database["public"]["Enums"]["student_status"]
          svp_detail: string | null
          updated_at: string
          vs_interni: string | null
          withdrawal_date: string | null
          withdrawal_reason: string | null
          zdroj_financovani: string | null
        }
        Insert: {
          birth_date: string
          birth_number?: string | null
          birth_place?: string | null
          citizenship?: string | null
          cizi_jazyky?: Json | null
          created_at?: string
          delka_programu?: number | null
          education_mode?: string | null
          enrollment_date: string
          first_name: string
          has_svp?: boolean
          health_fitness_note?: string | null
          health_insurance_code?: string | null
          id?: string
          kat_list_drive_url?: string | null
          kat_list_poznamka?: string | null
          kat_list_stav?: Database["public"]["Enums"]["kat_list_stav"] | null
          kod_zahajeni?: string | null
          kod_zaka: string
          kod_zaka_msmt?: string | null
          last_name: string
          nationality?: string | null
          obec_bydliste_kod?: string | null
          okres_bydliste_kod?: string | null
          photo_consent?: boolean
          predchozi_skola_izo?: string | null
          predchozi_vzdelavani?: string | null
          sp_obvod?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          svp_detail?: string | null
          updated_at?: string
          vs_interni?: string | null
          withdrawal_date?: string | null
          withdrawal_reason?: string | null
          zdroj_financovani?: string | null
        }
        Update: {
          birth_date?: string
          birth_number?: string | null
          birth_place?: string | null
          citizenship?: string | null
          cizi_jazyky?: Json | null
          created_at?: string
          delka_programu?: number | null
          education_mode?: string | null
          enrollment_date?: string
          first_name?: string
          has_svp?: boolean
          health_fitness_note?: string | null
          health_insurance_code?: string | null
          id?: string
          kat_list_drive_url?: string | null
          kat_list_poznamka?: string | null
          kat_list_stav?: Database["public"]["Enums"]["kat_list_stav"] | null
          kod_zahajeni?: string | null
          kod_zaka?: string
          kod_zaka_msmt?: string | null
          last_name?: string
          nationality?: string | null
          obec_bydliste_kod?: string | null
          okres_bydliste_kod?: string | null
          photo_consent?: boolean
          predchozi_skola_izo?: string | null
          predchozi_vzdelavani?: string | null
          sp_obvod?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          svp_detail?: string | null
          updated_at?: string
          vs_interni?: string | null
          withdrawal_date?: string | null
          withdrawal_reason?: string | null
          zdroj_financovani?: string | null
        }
        Relationships: []
      }
      students_audit: {
        Row: {
          audit_id: string
          changed_at: string
          changed_by: string | null
          new_data: Json | null
          old_data: Json | null
          operation: string
        }
        Insert: {
          audit_id?: string
          changed_at?: string
          changed_by?: string | null
          new_data?: Json | null
          old_data?: Json | null
          operation: string
        }
        Update: {
          audit_id?: string
          changed_at?: string
          changed_by?: string | null
          new_data?: Json | null
          old_data?: Json | null
          operation?: string
        }
        Relationships: []
      }
      svp_vazby: {
        Row: {
          ai_jistota: number | null
          ai_model: string | null
          ai_navrzeno_at: string | null
          ai_zduvodneni: string | null
          created_at: string
          id: string
          rocnik: number
          vystup_id: string
          zaznam_id: string
          zdroj: string
        }
        Insert: {
          ai_jistota?: number | null
          ai_model?: string | null
          ai_navrzeno_at?: string | null
          ai_zduvodneni?: string | null
          created_at?: string
          id?: string
          rocnik: number
          vystup_id: string
          zaznam_id: string
          zdroj?: string
        }
        Update: {
          ai_jistota?: number | null
          ai_model?: string | null
          ai_navrzeno_at?: string | null
          ai_zduvodneni?: string | null
          created_at?: string
          id?: string
          rocnik?: number
          vystup_id?: string
          zaznam_id?: string
          zdroj?: string
        }
        Relationships: [
          {
            foreignKeyName: "svp_vazby_vystup_id_fkey"
            columns: ["vystup_id"]
            isOneToOne: false
            referencedRelation: "svp_vystupy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "svp_vazby_zaznam_id_fkey"
            columns: ["zaznam_id"]
            isOneToOne: false
            referencedRelation: "tridni_kniha_zaznamy"
            referencedColumns: ["id"]
          },
        ]
      }
      svp_vystupy: {
        Row: {
          aktivni: boolean
          created_at: string
          id: string
          kod: string
          predmet: string
          rocnik: number
          svp_version: string
          vystup_text: string
        }
        Insert: {
          aktivni?: boolean
          created_at?: string
          id?: string
          kod: string
          predmet: string
          rocnik: number
          svp_version: string
          vystup_text: string
        }
        Update: {
          aktivni?: boolean
          created_at?: string
          id?: string
          kod?: string
          predmet?: string
          rocnik?: number
          svp_version?: string
          vystup_text?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          alert_type: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          message: string
          module: string
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
        }
        Insert: {
          alert_type: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          message: string
          module: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
        }
        Update: {
          alert_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          message?: string
          module?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "fk_system_alerts_resolved_by"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      tridni_kniha_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          duvod_zmeny: string
          hodnota_po: string
          hodnota_pred: string | null
          id: string
          pole: string
          zaznam_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          duvod_zmeny: string
          hodnota_po: string
          hodnota_pred?: string | null
          id?: string
          pole: string
          zaznam_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          duvod_zmeny?: string
          hodnota_po?: string
          hodnota_pred?: string | null
          id?: string
          pole?: string
          zaznam_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tridni_kniha_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tridni_kniha_changes_zaznam_id_fkey"
            columns: ["zaznam_id"]
            isOneToOne: false
            referencedRelation: "tridni_kniha_zaznamy"
            referencedColumns: ["id"]
          },
        ]
      }
      tridni_kniha_skolni_rok: {
        Row: {
          created_at: string
          group_id: string | null
          id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          school_year: string
          unlocked_at: string | null
          unlocked_by: string | null
        }
        Insert: {
          created_at?: string
          group_id?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          school_year: string
          unlocked_at?: string | null
          unlocked_by?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          school_year?: string
          unlocked_at?: string | null
          unlocked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tridni_kniha_skolni_rok_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tridni_kniha_skolni_rok_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tridni_kniha_skolni_rok_unlocked_by_fkey"
            columns: ["unlocked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      tridni_kniha_zaznamy: {
        Row: {
          cas_do: string | null
          cas_od: string | null
          created_at: string
          datum: string
          den_v_tydnu: string
          group_id: string | null
          id: string
          nazev: string
          popis: string | null
          school_year: string
          typ_zaznamu: string
          updated_at: string
        }
        Insert: {
          cas_do?: string | null
          cas_od?: string | null
          created_at?: string
          datum: string
          den_v_tydnu: string
          group_id?: string | null
          id?: string
          nazev: string
          popis?: string | null
          school_year: string
          typ_zaznamu: string
          updated_at?: string
        }
        Update: {
          cas_do?: string | null
          cas_od?: string | null
          created_at?: string
          datum?: string
          den_v_tydnu?: string
          group_id?: string | null
          id?: string
          nazev?: string
          popis?: string | null
          school_year?: string
          typ_zaznamu?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tridni_kniha_zaznamy_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      tridnice_priznak_typ: {
        Row: {
          aktivni: boolean
          created_at: string
          id: string
          ikona: string | null
          kod: string
          ma_osobu: boolean
          ma_poznamku: boolean
          nazev: string
          poradi: number
        }
        Insert: {
          aktivni?: boolean
          created_at?: string
          id?: string
          ikona?: string | null
          kod: string
          ma_osobu?: boolean
          ma_poznamku?: boolean
          nazev: string
          poradi?: number
        }
        Update: {
          aktivni?: boolean
          created_at?: string
          id?: string
          ikona?: string | null
          kod?: string
          ma_osobu?: boolean
          ma_poznamku?: boolean
          nazev?: string
          poradi?: number
        }
        Relationships: []
      }
      tripartita_events: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          school_year: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          school_year: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          school_year?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tripartita_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      tripartita_reservations: {
        Row: {
          created_at: string
          event_id: string
          guardian_id: string
          id: string
          note: string | null
          slot_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          guardian_id: string
          id?: string
          note?: string | null
          slot_id: string
          student_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          guardian_id?: string
          id?: string
          note?: string | null
          slot_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tripartita_reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "tripartita_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tripartita_reservations_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tripartita_reservations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "tripartita_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tripartita_reservations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      tripartita_slots: {
        Row: {
          capacity: number
          created_at: string
          ends_at: string | null
          event_id: string
          id: string
          label: string
          reserved_count: number
          starts_at: string | null
        }
        Insert: {
          capacity?: number
          created_at?: string
          ends_at?: string | null
          event_id: string
          id?: string
          label: string
          reserved_count?: number
          starts_at?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string
          ends_at?: string | null
          event_id?: string
          id?: string
          label?: string
          reserved_count?: number
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tripartita_slots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "tripartita_events"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_snapshots: {
        Row: {
          captured_at: string
          id: string
          limit_value: number | null
          metric: string
          note: string | null
          ok: boolean
          ratio: number | null
          service: string
          unit: string | null
          value: number | null
        }
        Insert: {
          captured_at?: string
          id?: string
          limit_value?: number | null
          metric: string
          note?: string | null
          ok?: boolean
          ratio?: number | null
          service: string
          unit?: string | null
          value?: number | null
        }
        Update: {
          captured_at?: string
          id?: string
          limit_value?: number | null
          metric?: string
          note?: string | null
          ok?: boolean
          ratio?: number | null
          service?: string
          unit?: string | null
          value?: number | null
        }
        Relationships: []
      }
      usage_thresholds: {
        Row: {
          crit_ratio: number
          enabled: boolean
          id: string
          label: string | null
          manual_limit: number | null
          metric: string
          poradi: number
          service: string
          unit: string | null
          updated_at: string
          warn_ratio: number
        }
        Insert: {
          crit_ratio?: number
          enabled?: boolean
          id?: string
          label?: string | null
          manual_limit?: number | null
          metric: string
          poradi?: number
          service: string
          unit?: string | null
          updated_at?: string
          warn_ratio?: number
        }
        Update: {
          crit_ratio?: number
          enabled?: boolean
          id?: string
          label?: string | null
          manual_limit?: number | null
          metric?: string
          poradi?: number
          service?: string
          unit?: string | null
          updated_at?: string
          warn_ratio?: number
        }
        Relationships: []
      }
      vecne_skupiny: {
        Row: {
          aktivni: boolean
          created_at: string
          id: string
          nadrazeny_znak: string | null
          nazev: string
          poznamka: string | null
          skartacni_lhuta_let: number | null
          skartacni_lhuta_text: string
          skartacni_znak: Database["public"]["Enums"]["skartacni_znak_enum"]
          spis_znak: string
          spousteci_udalost: string
          ulozeni_nilsson: string | null
          uroven: number
        }
        Insert: {
          aktivni?: boolean
          created_at?: string
          id?: string
          nadrazeny_znak?: string | null
          nazev: string
          poznamka?: string | null
          skartacni_lhuta_let?: number | null
          skartacni_lhuta_text: string
          skartacni_znak: Database["public"]["Enums"]["skartacni_znak_enum"]
          spis_znak: string
          spousteci_udalost: string
          ulozeni_nilsson?: string | null
          uroven: number
        }
        Update: {
          aktivni?: boolean
          created_at?: string
          id?: string
          nadrazeny_znak?: string | null
          nazev?: string
          poznamka?: string | null
          skartacni_lhuta_let?: number | null
          skartacni_lhuta_text?: string
          skartacni_znak?: Database["public"]["Enums"]["skartacni_znak_enum"]
          spis_znak?: string
          spousteci_udalost?: string
          ulozeni_nilsson?: string | null
          uroven?: number
        }
        Relationships: [
          {
            foreignKeyName: "vecne_skupiny_nadrazeny_znak_fkey"
            columns: ["nadrazeny_znak"]
            isOneToOne: false
            referencedRelation: "vecne_skupiny"
            referencedColumns: ["spis_znak"]
          },
        ]
      }
      vp_student_care: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          dokumenty: Json
          drive_url_private: string | null
          drive_url_public: string | null
          id: string
          ivp_evaluated_at: string | null
          ivp_required: boolean
          poznamka: string | null
          school_year: string
          spz_review_due: string | null
          spz_valid_until: string | null
          started_at: string
          status: string
          student_id: string
          typ_pece: Database["public"]["Enums"]["typ_vp_pece"]
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          dokumenty?: Json
          drive_url_private?: string | null
          drive_url_public?: string | null
          id?: string
          ivp_evaluated_at?: string | null
          ivp_required?: boolean
          poznamka?: string | null
          school_year: string
          spz_review_due?: string | null
          spz_valid_until?: string | null
          started_at?: string
          status?: string
          student_id: string
          typ_pece: Database["public"]["Enums"]["typ_vp_pece"]
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          dokumenty?: Json
          drive_url_private?: string | null
          drive_url_public?: string | null
          id?: string
          ivp_evaluated_at?: string | null
          ivp_required?: boolean
          poznamka?: string | null
          school_year?: string
          spz_review_due?: string | null
          spz_valid_until?: string | null
          started_at?: string
          status?: string
          student_id?: string
          typ_pece?: Database["public"]["Enums"]["typ_vp_pece"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vp_student_care_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vp_student_care_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      vykaz_ku_snapshot: {
        Row: {
          captured_at: string
          druzina_pocet: number
          id: string
          indiv_41: number
          jiny_38: number
          mesic: number
          obed_pocet: number | null
          period: string
          rok: number
          std_36: number
        }
        Insert: {
          captured_at?: string
          druzina_pocet?: number
          id?: string
          indiv_41?: number
          jiny_38?: number
          mesic: number
          obed_pocet?: number | null
          period: string
          rok: number
          std_36?: number
        }
        Update: {
          captured_at?: string
          druzina_pocet?: number
          id?: string
          indiv_41?: number
          jiny_38?: number
          mesic?: number
          obed_pocet?: number | null
          period?: string
          rok?: number
          std_36?: number
        }
        Relationships: []
      }
      vykaz_ppc_uzaverka: {
        Row: {
          id: string
          locked_at: string
          locked_by: string | null
          obdobi: string
        }
        Insert: {
          id?: string
          locked_at?: string
          locked_by?: string | null
          obdobi: string
        }
        Update: {
          id?: string
          locked_at?: string
          locked_by?: string | null
          obdobi?: string
        }
        Relationships: [
          {
            foreignKeyName: "vykaz_ppc_uzaverka_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      dokumenty_platne: {
        Row: {
          cislo_jednaci: string | null
          created_at: string | null
          datum_isteni: string | null
          datum_pm: string | null
          datum_prijeti: string | null
          datum_vyrizeni: string | null
          datum_vzniku: string | null
          datum_zahajeni_lhuty: string | null
          datum_zniceni: string | null
          ds_zprava_id: number | null
          id: string | null
          poradove_cislo: number | null
          poznamka: string | null
          predmet: string | null
          prilohy: Json | null
          rok: number | null
          skartacni_lhuta_let: number | null
          skartacni_znak:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          smer: Database["public"]["Enums"]["dokument_smer"] | null
          stav: Database["public"]["Enums"]["dokument_stav"] | null
          storno_duvod: string | null
          storno_nahrazeno_id: string | null
          stornovano_at: string | null
          subjekt_id: string | null
          subjekt_nazev_cache: string | null
          updated_at: string | null
          vecna_skupina_id: string | null
          zniceni_protokol_id: string | null
          zpracovatel_id: string | null
          zpusob_doruceni: Database["public"]["Enums"]["zpusob_doruceni"] | null
          zpusob_vyrizeni: Database["public"]["Enums"]["zpusob_vyrizeni"] | null
        }
        Insert: {
          cislo_jednaci?: string | null
          created_at?: string | null
          datum_isteni?: string | null
          datum_pm?: string | null
          datum_prijeti?: string | null
          datum_vyrizeni?: string | null
          datum_vzniku?: string | null
          datum_zahajeni_lhuty?: string | null
          datum_zniceni?: string | null
          ds_zprava_id?: number | null
          id?: string | null
          poradove_cislo?: number | null
          poznamka?: string | null
          predmet?: string | null
          prilohy?: Json | null
          rok?: number | null
          skartacni_lhuta_let?: number | null
          skartacni_znak?:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          smer?: Database["public"]["Enums"]["dokument_smer"] | null
          stav?: Database["public"]["Enums"]["dokument_stav"] | null
          storno_duvod?: string | null
          storno_nahrazeno_id?: string | null
          stornovano_at?: string | null
          subjekt_id?: string | null
          subjekt_nazev_cache?: string | null
          updated_at?: string | null
          vecna_skupina_id?: string | null
          zniceni_protokol_id?: string | null
          zpracovatel_id?: string | null
          zpusob_doruceni?:
            | Database["public"]["Enums"]["zpusob_doruceni"]
            | null
          zpusob_vyrizeni?:
            | Database["public"]["Enums"]["zpusob_vyrizeni"]
            | null
        }
        Update: {
          cislo_jednaci?: string | null
          created_at?: string | null
          datum_isteni?: string | null
          datum_pm?: string | null
          datum_prijeti?: string | null
          datum_vyrizeni?: string | null
          datum_vzniku?: string | null
          datum_zahajeni_lhuty?: string | null
          datum_zniceni?: string | null
          ds_zprava_id?: number | null
          id?: string | null
          poradove_cislo?: number | null
          poznamka?: string | null
          predmet?: string | null
          prilohy?: Json | null
          rok?: number | null
          skartacni_lhuta_let?: number | null
          skartacni_znak?:
            | Database["public"]["Enums"]["skartacni_znak_enum"]
            | null
          smer?: Database["public"]["Enums"]["dokument_smer"] | null
          stav?: Database["public"]["Enums"]["dokument_stav"] | null
          storno_duvod?: string | null
          storno_nahrazeno_id?: string | null
          stornovano_at?: string | null
          subjekt_id?: string | null
          subjekt_nazev_cache?: string | null
          updated_at?: string | null
          vecna_skupina_id?: string | null
          zniceni_protokol_id?: string | null
          zpracovatel_id?: string | null
          zpusob_doruceni?:
            | Database["public"]["Enums"]["zpusob_doruceni"]
            | null
          zpusob_vyrizeni?:
            | Database["public"]["Enums"]["zpusob_vyrizeni"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "dokumenty_storno_nahrazeno_id_fkey"
            columns: ["storno_nahrazeno_id"]
            isOneToOne: false
            referencedRelation: "dokumenty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenty_storno_nahrazeno_id_fkey"
            columns: ["storno_nahrazeno_id"]
            isOneToOne: false
            referencedRelation: "dokumenty_platne"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenty_subjekt_id_fkey"
            columns: ["subjekt_id"]
            isOneToOne: false
            referencedRelation: "jmenny_rejstrik"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenty_vecna_skupina_id_fkey"
            columns: ["vecna_skupina_id"]
            isOneToOne: false
            referencedRelation: "vecne_skupiny"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dokumenty_zniceni_protokol"
            columns: ["zniceni_protokol_id"]
            isOneToOne: false
            referencedRelation: "skartacni_navrhy"
            referencedColumns: ["id"]
          },
        ]
      }
      v_vykaz_ppc_blok: {
        Row: {
          blok_id: string | null
          cas_do: string | null
          cas_od: string | null
          datum: string | null
          je_suplovani: boolean | null
          minut: number | null
          nazev: string | null
          obdobi: string | null
          obsazeni_id: string | null
          pozice_na_bloku: string | null
          staff_id: string | null
          typ_bloku: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_obsazeni_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      v_vykaz_ppc_den: {
        Row: {
          datum: string | null
          minut: number | null
          obdobi: string | null
          staff_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_obsazeni_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      v_vykaz_ppc_mesic: {
        Row: {
          dnu: number | null
          minut: number | null
          obdobi: string | null
          staff_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rozvrh_obsazeni_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_unlock_semester_record: {
        Args: { p_id: string }
        Returns: undefined
      }
      bulletin_active_staff: {
        Args: never
        Returns: {
          email: string
          first_name: string
          id: string
          last_name: string
        }[]
      }
      bulletin_resolve_recipients: {
        Args: {
          p_excluded_guardian_ids: string[]
          p_group_ids: string[]
          p_school_year: string
        }
        Returns: {
          email: string
          first_name: string
          id: string
          last_name: string
        }[]
      }
      bulletin_resolve_target_students: {
        Args: { p_group_ids: string[]; p_school_year: string }
        Returns: {
          group_id: string
          student_id: string
        }[]
      }
      can_read_guardian: { Args: { p_guardian_id: string }; Returns: boolean }
      can_read_student: { Args: { p_student_id: string }; Returns: boolean }
      current_guardian_id: { Args: never; Returns: string }
      current_staff_id: { Args: never; Returns: string }
      current_staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      druzina_cutoff_ts: { Args: { p_date: string }; Returns: string }
      druzina_den_ocekavani: {
        Args: { p_datum: string; p_oddeleni_id: string }
        Returns: {
          first_name: string
          last_name: string
          ocekavano: boolean
          omluven: boolean
          override: boolean
          poznamka_odchod: string
          student_id: string
          vzor_default: boolean
        }[]
      }
      druzina_den_set: {
        Args: {
          p_datum: string
          p_poznamka?: string
          p_prihlasen: boolean
          p_student_id: string
        }
        Returns: undefined
      }
      druzina_den_stav: {
        Args: { p_datum: string; p_student_id: string }
        Returns: {
          aktivni: boolean
          is_school_day: boolean
          ocekavano: boolean
          oddeleni_id: string
          omluven: boolean
          override: boolean
          poznamka_odchod: string
          vzor_default: boolean
        }[]
      }
      druzina_is_school_day: { Args: { p_date: string }; Returns: boolean }
      druzina_kod_dne: { Args: { p_date: string }; Returns: string }
      druzina_month: {
        Args: { p_month: number; p_student_id: string; p_year: number }
        Returns: {
          datum: string
          is_school_day: boolean
          ocekavano: boolean
          omluven: boolean
          override: boolean
          poznamka_odchod: string
          toggling_open: boolean
          vzor_default: boolean
        }[]
      }
      druzina_prihlaska_odeslat: {
        Args: { p_prihlaska_id: string }
        Returns: string
      }
      druzina_prihlaska_rozhodnout: {
        Args: {
          p_decided_by: string
          p_prihlaska_id: string
          p_rozhodnuti: string
        }
        Returns: {
          r_enrollment_id: string
          r_obligation_id: string
        }[]
      }
      druzina_prihlaska_stornovat: {
        Args: { p_prihlaska_id: string }
        Returns: undefined
      }
      druzina_school_year: { Args: { p_date: string }; Returns: string }
      druzina_toggling_open: { Args: { p_date: string }; Returns: boolean }
      druzina_vytvorit_pohledavku: {
        Args: {
          p_created_by: string
          p_school_year: string
          p_student_id: string
        }
        Returns: string
      }
      enrollment_classify_age: {
        Args: {
          p_datum_narozeni: string
          p_melo_odklad: boolean
          p_rok_zapisu: number
          p_skolni_rok_zacatek: string
        }
        Returns: {
          odklad_rezim: string
          vekova_kategorie: Database["public"]["Enums"]["enrollment_vekova_kategorie"]
          vyzaduje_lekare: boolean
          vyzaduje_ppp: boolean
          vyzaduje_specialistu: boolean
        }[]
      }
      enrollment_create_application: {
        Args: { p_typ: Database["public"]["Enums"]["enrollment_typ"] }
        Returns: string
      }
      enrollment_essl_open_spis: {
        Args: { p_application_id: string }
        Returns: string
      }
      enrollment_invite_second_guardian: {
        Args: {
          p_application_id: string
          p_email: string
          p_first_name?: string
          p_last_name?: string
          p_pribuzensky_vztah?: string
        }
        Returns: string
      }
      enrollment_is_guardian_on_application: {
        Args: { p_application_id: string }
        Returns: boolean
      }
      enrollment_is_owner_on_application: {
        Args: { p_application_id: string }
        Returns: boolean
      }
      enrollment_link_second_guardian: {
        Args: { p_guardian_id: string }
        Returns: {
          application_id: string
          stav: Database["public"]["Enums"]["enrollment_guardian_stav"]
        }[]
      }
      enrollment_mark_invite_sent: {
        Args: { p_guardian_id: string }
        Returns: undefined
      }
      enrollment_migrate_to_student: {
        Args: { p_application_id: string; p_decision_id: number }
        Returns: string
      }
      enrollment_record_decision: {
        Args: {
          p_application_id: string
          p_cilovy_school_year?: string
          p_datum_nastupu?: string
          p_duvod?: string
          p_rozhodnuti: Database["public"]["Enums"]["enrollment_rozhodnuti"]
        }
        Returns: number
      }
      enrollment_validate_address: {
        Args: {
          p_cislo: string
          p_obec: string
          p_psc: string
          p_ulice: string
        }
        Returns: Json
      }
      essl_log: {
        Args: {
          p_detail?: Json
          p_dokument_id?: string
          p_operace: Database["public"]["Enums"]["essl_operace"]
          p_skartacni_navrh_id?: string
          p_spis_id?: string
          p_uzivatel_popis_override?: string
        }
        Returns: undefined
      }
      generate_bozp_alerts: { Args: { p_school_year: string }; Returns: Json }
      generate_kod_zaka: { Args: { rok_narozeni: number }; Returns: string }
      generate_rozvrh: {
        Args: { p_date_from: string; p_date_to: string; p_group_id: string }
        Returns: {
          inserted: number
          skipped: number
        }[]
      }
      generate_vp_alerts: {
        Args: never
        Returns: {
          inserted_count: number
        }[]
      }
      get_bulletin_email_stats: {
        Args: { p_post_id: string }
        Returns: {
          cnt: number
          event_type: string
        }[]
      }
      get_bulletin_for_guardian: {
        Args: { p_school_year?: string }
        Returns: {
          body: string
          email_sent_at: string
          event_date: string
          event_location: string
          id: string
          school_year: string
          title: string
          type: string
          valid_from: string
          valid_until: string
        }[]
      }
      get_bulletin_read_by_class: {
        Args: { p_post_id: string }
        Returns: {
          class_id: string
          class_name: string
          opened: boolean
          student_id: string
          student_name: string
        }[]
      }
      get_consent_overview: {
        Args: { p_school_year: string }
        Returns: {
          code: string
          first_name: string
          kod_zaka: string
          last_name: string
          special_category: boolean
          state: string
          student_id: string
          title: string
        }[]
      }
      get_consents_for_guardian: {
        Args: { p_student_id: string }
        Returns: {
          active_version: number
          body: string
          code: string
          definition_id: string
          duration_type: string
          my_decided_at: string
          my_status: string
          needs_reconsent: boolean
          responded_version: number
          sort_order: number
          special_category: boolean
          title: string
        }[]
      }
      get_dokumenty_ke_skartaci: {
        Args: { p_k_datu?: string }
        Returns: {
          cislo_jednaci: string
          datum_isteni: string
          id: string
          predmet: string
          skartacni_znak: Database["public"]["Enums"]["skartacni_znak_enum"]
          vecna_skupina: string
        }[]
      }
      get_enrollment_health_seed: {
        Args: { p_student_id: string }
        Returns: {
          lekar: string
          zdravotni_omezeni: string
        }[]
      }
      get_guardian_bulletin_posts: {
        Args: { p_limit?: number }
        Returns: {
          body_preview: string
          id: string
          published_at: string
          title: string
        }[]
      }
      get_guardian_unpaid_receivables: {
        Args: never
        Returns: {
          amount_czk: number
          description: string
          due_date: string
          id: string
          status: string
          vs: string
        }[]
      }
      get_hodnoceni_counts: {
        Args: {
          p_school_year: string
          p_semester: number
          p_student_ids: string[]
        }
        Returns: {
          cnt: number
          student_id: string
        }[]
      }
      get_in_school_siblings: {
        Args: { p_student_id: string }
        Returns: {
          birth_date: string
          first_name: string
          group_name: string
          last_name: string
          student_id: string
        }[]
      }
      get_lunch_menu_week: {
        Args: { p_week_start?: string }
        Returns: {
          items: Json
          menu_date: string
          soup: string
          soup_allergens: number[]
          weekday: number
        }[]
      }
      get_my_staff_consents: {
        Args: never
        Returns: {
          active_version: number
          body: string
          code: string
          definition_id: string
          duration_type: string
          my_decided_at: string
          my_status: string
          needs_reconsent: boolean
          responded_version: number
          sort_order: number
          special_category: boolean
          title: string
        }[]
      }
      get_or_link_guardian_self: {
        Args: never
        Returns: {
          first_name: string
          id: string
          last_name: string
        }[]
      }
      get_questionnaire_overview: {
        Args: { p_school_year: string }
        Returns: {
          first_name: string
          group_name: string
          guardian_filled: boolean
          kod_zaka: string
          last_name: string
          student_filled: boolean
          student_id: string
        }[]
      }
      get_spisy_ke_skartaci: {
        Args: { p_k_datu?: string }
        Returns: {
          datum_isteni: string
          id: string
          nazev: string
          skartacni_znak: Database["public"]["Enums"]["skartacni_znak_enum"]
          spisova_znacka: string
        }[]
      }
      get_staff_consent_overview: {
        Args: never
        Returns: {
          code: string
          employment_end: string
          first_name: string
          last_name: string
          role: string
          special_category: boolean
          staff_id: string
          state: string
          title: string
        }[]
      }
      get_staff_group_ids: { Args: never; Returns: string[] }
      get_student_consent_state: {
        Args: { p_student_id: string }
        Returns: {
          code: string
          special_category: boolean
          state: string
          title: string
        }[]
      }
      get_students_in_school_year: {
        Args: { p_school_year: string }
        Returns: {
          first_name: string
          id: string
          kod_zaka: string
          last_name: string
        }[]
      }
      get_students_roster: {
        Args: { p_school_year: string }
        Returns: {
          birth_date: string
          first_name: string
          id: string
          kod_zaka: string
          last_name: string
          trida: string
        }[]
      }
      get_students_without_bozp: {
        Args: { p_school_year: string }
        Returns: {
          first_name: string
          id: string
          kod_zaka: string
          last_name: string
        }[]
      }
      get_tridni_kniha_for_guardian: {
        Args: { p_datum_do: string; p_datum_od: string; p_school_year: string }
        Returns: {
          cas_do: string
          cas_od: string
          datum: string
          den_v_tydnu: string
          group_id: string
          id: string
          nazev: string
          popis: string
          school_year: string
          svp_vystupy: Json
          typ_zaznamu: string
        }[]
      }
      guardian_can_access_student: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      has_role: { Args: { p_role: string }; Returns: boolean }
      immutable_unaccent: { Args: { "": string }; Returns: string }
      is_director: { Args: never; Returns: boolean }
      is_director_or_vp: { Args: never; Returns: boolean }
      is_guardian: { Args: never; Returns: boolean }
      is_school_holiday: { Args: { check_date?: string }; Returns: boolean }
      is_vp: { Args: never; Returns: boolean }
      lock_semester: {
        Args: { p_group_id: string; p_school_year: string; p_semester: number }
        Returns: number
      }
      lunch_age_category: {
        Args: { p_birth_date: string; p_ref_date: string }
        Returns: string
      }
      lunch_cutoff_ts: { Args: { p_date: string }; Returns: string }
      lunch_day_editable: {
        Args: { p_date: string }
        Returns: {
          auto_cancelled: boolean
          first_name: string
          last_name: string
          ordered: boolean
          student_id: string
          trida: string
        }[]
      }
      lunch_day_roster: {
        Args: { p_date: string }
        Returns: {
          first_name: string
          last_name: string
          student_id: string
          trida: string
        }[]
      }
      lunch_effective_order_counts: {
        Args: { p_date: string }
        Returns: {
          younger: number
          older: number
        }[]
      }
      lunch_effective_orders: {
        Args: { p_date: string }
        Returns: {
          student_id: string
        }[]
      }
      lunch_generate_obligations: {
        Args: { p_year: number; p_month: number; p_due_date?: string | null }
        Returns: {
          created: number
          ss_kod: string | null
          note: string | null
        }[]
      }
      lunch_is_school_day: { Args: { p_date: string }; Returns: boolean }
      lunch_month: {
        Args: { p_month: number; p_student_id: string; p_year: number }
        Returns: {
          auto_cancelled: boolean
          is_school_day: boolean
          menu_date: string
          ordered: boolean
          ordering_open: boolean
        }[]
      }
      lunch_month_billing: {
        Args: { p_month: number; p_year: number }
        Returns: {
          student_id: string
          first_name: string
          last_name: string
          trida: string | null
          age_category: string
          meals: number
          unit_price: number | null
          amount: number | null
        }[]
      }
      lunch_ordering_open: { Args: { p_date: string }; Returns: boolean }
      lunch_school_year: { Args: { p_date: string }; Returns: string }
      lunch_set_order: {
        Args: { p_menu_date: string; p_ordered: boolean; p_student_id: string }
        Returns: undefined
      }
      lunch_staff_set_order: {
        Args: { p_menu_date: string; p_ordered: boolean; p_student_id: string }
        Returns: undefined
      }
      matrika_set_rocnik: {
        Args: {
          p_new_rocnik: number
          p_reason: string
          p_student_id: string
          p_valid_from: string
        }
        Returns: undefined
      }
      nastavit_blok_priznak: {
        Args: {
          p_blok_id: string
          p_osoba_id?: string
          p_poznamka?: string
          p_typ_kod: string
        }
        Returns: string
      }
      new_school_year_rollover: {
        Args: { p_current_year: string; p_new_year: string }
        Returns: Json
      }
      potvrdit_blok: {
        Args: { p_absent_ids?: string[]; p_blok_id: string; p_obsah?: string }
        Returns: string
      }
      recalculate_semester_summary: {
        Args: {
          p_group_id: string
          p_school_year: string
          p_semester: number
          p_student_id: string
        }
        Returns: undefined
      }
      reserve_tripartita_slot: {
        Args: { p_note?: string; p_slot_id: string; p_student_id: string }
        Returns: string
      }
      resolve_bozp_alerts: {
        Args: { p_student_id: string }
        Returns: undefined
      }
      rollover_vp_care: {
        Args: { p_from_year: string; p_to_year: string }
        Returns: {
          copied_count: number
        }[]
      }
      set_consent: {
        Args: {
          p_definition_id: string
          p_status: string
          p_student_id: string
        }
        Returns: string
      }
      set_staff_consent: {
        Args: { p_definition_id: string; p_status: string }
        Returns: string
      }
      staff_can_access_student: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      staff_can_read_campaign: {
        Args: { p_campaign_id: string }
        Returns: boolean
      }
      usage_db_size: { Args: never; Returns: number }
      zrusit_blok_priznak: {
        Args: { p_blok_id: string; p_typ_kod: string }
        Returns: undefined
      }
      zrusit_potvrzeni_blok: { Args: { p_blok_id: string }; Returns: undefined }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      contract_type: "enrollment" | "amendment" | "termination"
      dokument_smer: "prijaty" | "odchozi" | "vlastni"
      dokument_stav:
        | "prijat"
        | "prideleno"
        | "ve_vyrizeni"
        | "vyrizeno"
        | "uzavreno"
      employment_type: "full_time" | "part_time" | "dpp" | "dpc"
      enrollment_doklad_stav: "nedodano" | "prijato"
      enrollment_guardian_role: "vlastnik" | "spoluzastupce"
      enrollment_guardian_stav: "pozvan" | "zaregistrovan" | "potvrzeno"
      enrollment_prestup_doporuceni: "ano" | "ne" | "zatim_ne"
      enrollment_rozhodnuti:
        | "prijat"
        | "nepryjat_kapacita"
        | "nepryjat_jiny_duvod"
        | "odklad"
        | "prestup_zamitnut"
        | "stornovano_rodicem"
        | "nedostavili_se"
        | "autoremedura_prijat"
        | "autoremedura_nepryjat"
      enrollment_specificke_potreby:
        | "ne"
        | "ano_mame_podklady"
        | "ano_zatim_nemame"
      enrollment_stav:
        | "zalozena"
        | "ceka_na_spoluzastupce"
        | "dotaznik_rozpracovany"
        | "dotaznik_odeslan"
        | "k_rozhodnuti"
        | "prijat"
        | "nepryjat"
        | "odklad"
        | "prestup_zamitnut"
        | "stornovano_rodicem"
        | "nedostavili_se"
        | "autoremedura_zmeneno"
      enrollment_typ: "zapis" | "prestup"
      enrollment_vekova_kategorie:
        | "bezne_okno"
        | "predcasny_zari_prosinec"
        | "predcasny_leden_cerven"
        | "prilis_mlade"
        | "po_odkladu"
      essl_operace:
        | "dokument_prijat"
        | "dokument_evidovan"
        | "dokument_pridelan"
        | "dokument_vyrizeno"
        | "dokument_uzavreno"
        | "spis_zalozen"
        | "spis_uzavren"
        | "dokument_pridan_do_spisu"
        | "skartacni_navrh_vytvoren"
        | "skartacni_souhlas_prijat"
        | "dokument_znicen"
        | "nahlednuti_externi_osoby"
        | "dokument_stornovan"
      guardian_role:
        | "matka"
        | "otec"
        | "porucnik"
        | "opatrovnik"
        | "pestoun"
        | "sverena_pece"
        | "jiny_zz"
        | "kontaktni_osoba"
      jmenny_typ: "fyzicka_osoba" | "pravnicka_osoba" | "organ_verejne_moci"
      kat_list_stav: "k_dispozici" | "chybi" | "nevyzadovano"
      skartacni_znak_enum: "A" | "S" | "V"
      staff_role: "director" | "vp" | "guide" | "assistant" | "readonly"
      student_status: "active" | "archived" | "withdrawn"
      stupen_zvladnuti:
        | "s_jistotou"
        | "castecne"
        | "s_dopomoci"
        | "nezacali"
        | "nezvlada"
      typ_vp_pece: "watch" | "po_1" | "po_2" | "po_3" | "po_4" | "po_5"
      typ_zamestnance: "pedagogicky" | "THP"
      zpusob_doruceni: "datova_schranka" | "email" | "posta" | "osobne"
      zpusob_plneni_psd: "11" | "30" | "40" | "50"
      zpusob_vyrizeni:
        | "odpoved_odeslana"
        | "rozhodnuti_vydano"
        | "postoupeno"
        | "ulozeno_bez_odpovedi"
        | "vzato_na_vedomi"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  web: {
    Tables: {
      access_tokens: {
        Row: {
          created_at: string
          id: string
          label: string | null
          revoked_at: string | null
          school_year: string
          scope: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          revoked_at?: string | null
          school_year: string
          scope?: string
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          revoked_at?: string | null
          school_year?: string
          scope?: string
          token_hash?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          category: string
          created_at: string
          drive_file_id: string
          id: string
          is_current: boolean
          published_at: string
          slug: string
          supersedes_id: string | null
          title: string
          version: number
        }
        Insert: {
          category: string
          created_at?: string
          drive_file_id: string
          id?: string
          is_current?: boolean
          published_at?: string
          slug: string
          supersedes_id?: string | null
          title: string
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          drive_file_id?: string
          id?: string
          is_current?: boolean
          published_at?: string
          slug?: string
          supersedes_id?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      galleries: {
        Row: {
          cover_photo_id: string | null
          created_at: string
          depicted_groups: string[]
          description_md: string | null
          drive_folder_id: string | null
          event_date: string | null
          id: string
          school_year: string
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          cover_photo_id?: string | null
          created_at?: string
          depicted_groups?: string[]
          description_md?: string | null
          drive_folder_id?: string | null
          event_date?: string | null
          id?: string
          school_year: string
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          cover_photo_id?: string | null
          created_at?: string
          depicted_groups?: string[]
          description_md?: string | null
          drive_folder_id?: string | null
          event_date?: string | null
          id?: string
          school_year?: string
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "galleries_cover_fk"
            columns: ["cover_photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_tags: {
        Row: {
          photo_id: string
          student_id: string
        }
        Insert: {
          photo_id: string
          student_id: string
        }
        Update: {
          photo_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_tags_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          caption: string | null
          created_at: string
          drive_file_id: string
          gallery_id: string
          height: number | null
          id: string
          no_identifiable_person: boolean
          placeholder: string | null
          sort_order: number
          width: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          drive_file_id: string
          gallery_id: string
          height?: number | null
          id?: string
          no_identifiable_person?: boolean
          placeholder?: string | null
          sort_order?: number
          width?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          drive_file_id?: string
          gallery_id?: string
          height?: number | null
          id?: string
          no_identifiable_person?: boolean
          placeholder?: string | null
          sort_order?: number
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_staff_id: string | null
          body_md: string
          cover_photo_id: string | null
          created_at: string
          gallery_id: string | null
          id: string
          publish_at: string | null
          school_year: string
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_staff_id?: string | null
          body_md?: string
          cover_photo_id?: string | null
          created_at?: string
          gallery_id?: string | null
          id?: string
          publish_at?: string | null
          school_year: string
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_staff_id?: string | null
          body_md?: string
          cover_photo_id?: string | null
          created_at?: string
          gallery_id?: string | null
          id?: string
          publish_at?: string | null
          school_year?: string
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_cover_photo_id_fkey"
            columns: ["cover_photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      access_token_valid: { Args: { p_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      photo_is_publishable: { Args: { p_photo: string }; Returns: boolean }
      student_has_web_photo_consent: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      verify_access_token: {
        Args: { p_hash: string }
        Returns: {
          school_year: string
          token_id: string
        }[]
      }
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
    Enums: {
      alert_severity: ["info", "warning", "critical"],
      contract_type: ["enrollment", "amendment", "termination"],
      dokument_smer: ["prijaty", "odchozi", "vlastni"],
      dokument_stav: [
        "prijat",
        "prideleno",
        "ve_vyrizeni",
        "vyrizeno",
        "uzavreno",
      ],
      employment_type: ["full_time", "part_time", "dpp", "dpc"],
      enrollment_doklad_stav: ["nedodano", "prijato"],
      enrollment_guardian_role: ["vlastnik", "spoluzastupce"],
      enrollment_guardian_stav: ["pozvan", "zaregistrovan", "potvrzeno"],
      enrollment_prestup_doporuceni: ["ano", "ne", "zatim_ne"],
      enrollment_rozhodnuti: [
        "prijat",
        "nepryjat_kapacita",
        "nepryjat_jiny_duvod",
        "odklad",
        "prestup_zamitnut",
        "stornovano_rodicem",
        "nedostavili_se",
        "autoremedura_prijat",
        "autoremedura_nepryjat",
      ],
      enrollment_specificke_potreby: [
        "ne",
        "ano_mame_podklady",
        "ano_zatim_nemame",
      ],
      enrollment_stav: [
        "zalozena",
        "ceka_na_spoluzastupce",
        "dotaznik_rozpracovany",
        "dotaznik_odeslan",
        "k_rozhodnuti",
        "prijat",
        "nepryjat",
        "odklad",
        "prestup_zamitnut",
        "stornovano_rodicem",
        "nedostavili_se",
        "autoremedura_zmeneno",
      ],
      enrollment_typ: ["zapis", "prestup"],
      enrollment_vekova_kategorie: [
        "bezne_okno",
        "predcasny_zari_prosinec",
        "predcasny_leden_cerven",
        "prilis_mlade",
        "po_odkladu",
      ],
      essl_operace: [
        "dokument_prijat",
        "dokument_evidovan",
        "dokument_pridelan",
        "dokument_vyrizeno",
        "dokument_uzavreno",
        "spis_zalozen",
        "spis_uzavren",
        "dokument_pridan_do_spisu",
        "skartacni_navrh_vytvoren",
        "skartacni_souhlas_prijat",
        "dokument_znicen",
        "nahlednuti_externi_osoby",
        "dokument_stornovan",
      ],
      guardian_role: [
        "matka",
        "otec",
        "porucnik",
        "opatrovnik",
        "pestoun",
        "sverena_pece",
        "jiny_zz",
        "kontaktni_osoba",
      ],
      jmenny_typ: ["fyzicka_osoba", "pravnicka_osoba", "organ_verejne_moci"],
      kat_list_stav: ["k_dispozici", "chybi", "nevyzadovano"],
      skartacni_znak_enum: ["A", "S", "V"],
      staff_role: ["director", "vp", "guide", "assistant", "readonly"],
      student_status: ["active", "archived", "withdrawn"],
      stupen_zvladnuti: [
        "s_jistotou",
        "castecne",
        "s_dopomoci",
        "nezacali",
        "nezvlada",
      ],
      typ_vp_pece: ["watch", "po_1", "po_2", "po_3", "po_4", "po_5"],
      typ_zamestnance: ["pedagogicky", "THP"],
      zpusob_doruceni: ["datova_schranka", "email", "posta", "osobne"],
      zpusob_plneni_psd: ["11", "30", "40", "50"],
      zpusob_vyrizeni: [
        "odpoved_odeslana",
        "rozhodnuti_vydano",
        "postoupeno",
        "ulozeno_bez_odpovedi",
        "vzato_na_vedomi",
      ],
    },
  },
  web: {
    Enums: {},
  },
} as const
