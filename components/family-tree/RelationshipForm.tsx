'use client';

import React, { useState } from 'react';
import { Person, Relationship } from '@/types/familyTree';
import { FAMILY_TREE_ENUMS } from '@/constants/familyTreeEnums';

interface RelationshipFormProps {
  persons: Person[];
  relationship?: Relationship;
  onSubmit: (relationship: Omit<Relationship, 'relationship_id' | 'tree_id' | 'created_at'>) => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

export const RelationshipForm: React.FC<RelationshipFormProps> = ({
  persons,
  relationship,
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState({
    person_a_id: relationship?.person_a_id || '',
    person_b_id: relationship?.person_b_id || '',
    relationship_type: relationship?.relationship_type || 'parent_child',
    direction: relationship?.direction || 'parent',
    notes: relationship?.notes || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleInputChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.person_a_id) {
      newErrors.person_a_id = 'First person is required';
    }

    if (!formData.person_b_id) {
      newErrors.person_b_id = 'Second person is required';
    }

    if (formData.person_a_id === formData.person_b_id) {
      newErrors.person_b_id = 'Cannot create a relationship with the same person';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    onSubmit({
      person_a_id: formData.person_a_id,
      person_b_id: formData.person_b_id,
      relationship_type: formData.relationship_type as any,
      direction: formData.direction as any,
      notes: formData.notes || undefined,
    });
  };

  const getPersonName = (personId: string) => {
    const person = persons.find((p) => p.person_id === personId);
    return person ? `${person.first_name} ${person.last_name || ''}` : 'Unknown';
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
      {/* Relationship Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Relationship Type *
        </label>
        <select
          name="relationship_type"
          value={formData.relationship_type}
          onChange={handleInputChange}
          className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
        >
          {FAMILY_TREE_ENUMS.RELATIONSHIP_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Person A */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          First Person *
        </label>
        <select
          name="person_a_id"
          value={formData.person_a_id}
          onChange={handleInputChange}
          className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 ${
            errors.person_a_id ? 'border-red-500' : ''
          }`}
        >
          <option value="">Select a person</option>
          {persons.map((person) => (
            <option key={person.person_id} value={person.person_id}>
              {person.first_name} {person.last_name || ''}
            </option>
          ))}
        </select>
        {errors.person_a_id && <p className="text-red-500 text-xs mt-1">{errors.person_a_id}</p>}
      </div>

      {/* Direction (for parent-child relationships) */}
      {formData.relationship_type === 'parent_child' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Relationship Direction *
          </label>
          <div className="flex items-center space-x-4">
            <label className="flex items-center">
              <input
                type="radio"
                name="direction"
                value="parent"
                checked={formData.direction === 'parent'}
                onChange={handleInputChange}
                className="w-4 h-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                First person is parent
              </span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="direction"
                value="child"
                checked={formData.direction === 'child'}
                onChange={handleInputChange}
                className="w-4 h-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                First person is child
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Person B */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Second Person *
        </label>
        <select
          name="person_b_id"
          value={formData.person_b_id}
          onChange={handleInputChange}
          className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 ${
            errors.person_b_id ? 'border-red-500' : ''
          }`}
        >
          <option value="">Select a person</option>
          {persons.map((person) => (
            <option key={person.person_id} value={person.person_id}>
              {person.first_name} {person.last_name || ''}
            </option>
          ))}
        </select>
        {errors.person_b_id && <p className="text-red-500 text-xs mt-1">{errors.person_b_id}</p>}
      </div>

      {/* Relationship Preview */}
      {formData.person_a_id && formData.person_b_id && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold">{getPersonName(formData.person_a_id)}</span>
            {' '}
            <span className="text-blue-600 dark:text-blue-400">
              {FAMILY_TREE_ENUMS.RELATIONSHIP_TYPES.find((r) => r.value === formData.relationship_type)?.label}
            </span>
            {' '}
            <span className="font-semibold">{getPersonName(formData.person_b_id)}</span>
          </p>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Notes
        </label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleInputChange}
          rows={3}
          className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
          placeholder="Add any additional notes about this relationship..."
        />
      </div>

      {/* Form Actions */}
      <div className="flex space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
        >
          {isLoading ? 'Saving...' : relationship ? 'Update Relationship' : 'Add Relationship'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-md font-medium transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};
