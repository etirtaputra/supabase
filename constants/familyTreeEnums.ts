export const FAMILY_TREE_ENUMS = {
  GENDER: [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'other', label: 'Other' },
    { value: 'not_specified', label: 'Not Specified' },
  ] as const,

  RELATIONSHIP_TYPES: [
    { value: 'parent_child', label: 'Parent - Child' },
    { value: 'married', label: 'Married' },
    { value: 'siblings', label: 'Siblings' },
    { value: 'custom', label: 'Custom Relation' },
  ] as const,

  RELATIONSHIP_DIRECTIONS: [
    { value: 'parent', label: 'Parent' },
    { value: 'child', label: 'Child' },
    { value: 'spouse', label: 'Spouse' },
    { value: 'sibling', label: 'Sibling' },
    { value: 'custom', label: 'Custom' },
  ] as const,

  VISIBILITY: [
    { value: 'private', label: 'Private' },
    { value: 'unlisted', label: 'Unlisted (link only)' },
    { value: 'public', label: 'Public' },
  ] as const,

  ACCESS_LEVELS: [
    { value: 'view_only', label: 'View Only' },
    { value: 'can_edit', label: 'Can Edit' },
    { value: 'admin', label: 'Admin' },
  ] as const,
};

export const COLORS = {
  male: '#3b82f6',
  female: '#ec4899',
  other: '#8b5cf6',
  not_specified: '#6b7280',
};
