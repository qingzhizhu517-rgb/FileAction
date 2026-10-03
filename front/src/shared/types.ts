export type User = {
  id: string;
  username: string;
  display_name: string;
  revision: number;
};
export type DocumentItem = {
  id: string;
  name: string;
  revision: number;
  retention: "temporary" | "retained";
  parse_status: string;
  index_status: string;
  category?: string;
  created_at?: string;
  size_bytes?: number;
  current_version_id?: string;
  warnings?: string[];
  deletion_state?: "active" | "deleting" | "deleted";
  mime_type?: string;
};
export type Configuration = {
  storage_notice_version?: string;
  cos?: { region?: string; configured?: boolean };
  generation?: { configured?: boolean; model?: string; domain?: string };
  embedding?: {
    configured?: boolean;
    model?: string;
    dimensions?: number;
    domain?: string;
  };
};
export type Workspace = {
  id: string;
  title: string;
  revision: number;
  retention: string;
  goal?: string;
  status?: string;
  documents?: DocumentItem[];
  facts?: WorkspaceFact[];
};
export type WorkspaceFact = {
  id: string;
  version: number;
  text: string;
  confirmed: true;
  retention: "temporary";
};
export type SourceSegment = {
  id?: string;
  segment_id?: string;
  text: string;
  location?: string;
  char_start?: number;
  char_end?: number;
  content_hash?: string;
};
export type WorkspaceMessage = { id: string; role: string; text: string; run_id?: string };
export type ContextPreview = {
  preview_id: string;
  manifest_hash: string;
  expires_at: string;
  manifest: {
    documents: {
      document_id: string;
      document_version_id: string;
      name: string;
      segments: SourceSegment[];
    }[];
    facts: WorkspaceFact[];
    history: WorkspaceMessage[];
    message: string;
    goal: string;
    kind: string;
    retrieval_mode: string;
    model: { domain: string; name: string };
    coverage: unknown;
    character_counts: Record<string, number>;
    estimated_tokens: number;
    embedding?: { domain: string; model: string; dimensions: number; profile_version: string };
    query_embedding_authorization?: { query: string; max_requests: number; max_queries: number; max_characters: number; request_seconds: number; retrieval_seconds: number };
  };
};
