export interface FamilyTree {
  tree_id: string;
  owner_id: string;
  name: string;
  description?: string;
  is_public: boolean;
  visibility: 'private' | 'unlisted' | 'public';
  created_at: string;
  updated_at: string;
}

export interface Person {
  person_id: string;
  tree_id: string;
  first_name: string;
  last_name?: string;
  birth_date?: string;
  death_date?: string;
  gender: 'male' | 'female' | 'other' | 'not_specified';
  bio?: string;
  photo_url?: string;
  location_id?: string;
  is_deceased: boolean;
  created_at: string;
  updated_at: string;
}

export interface Location {
  location_id: string;
  tree_id: string;
  city: string;
  state_province?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  created_at: string;
}

export interface Relationship {
  relationship_id: string;
  tree_id: string;
  person_a_id: string;
  person_b_id: string;
  relationship_type: 'parent_child' | 'married' | 'siblings' | 'custom';
  direction: 'parent' | 'child' | 'spouse' | 'sibling' | 'custom';
  notes?: string;
  created_at: string;
}

export interface ShareableLink {
  link_id: string;
  tree_id: string;
  created_by: string;
  slug: string;
  access_level: 'view_only' | 'can_edit' | 'admin';
  is_active: boolean;
  expires_at?: string;
  analytics_enabled: boolean;
  created_at: string;
}

export interface TreeVisualizationNode {
  id: string;
  name: string;
  photoUrl?: string;
  generation: number;
  gender: string;
  isDeceased: boolean;
}

export interface TreeVisualizationEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
}

export interface TreeVisualizationData {
  nodes: TreeVisualizationNode[];
  edges: TreeVisualizationEdge[];
}
