'use client';

import React, { useState } from 'react';
import { Person, Location } from '@/types/familyTree';
import { FAMILY_TREE_ENUMS } from '@/constants/familyTreeEnums';

interface PersonFormProps {
  treeId: string;
  person?: Person;
  locations?: Location[];
  onSubmit: (person: Omit<Person, 'person_id' | 'tree_id' | 'created_at' | 'updated_at'>) => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

export const PersonForm: React.FC<PersonFormProps> = ({
  treeId,
  person,
  locations = [],
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState({
    first_name: person?.first_name || '',
    last_name: person?.last_name || '',
    birth_date: person?.birth_date || '',
    death_date: person?.death_date || '',
    gender: person?.gender || 'not_specified',
    bio: person?.bio || '',
    location_id: person?.location_id || '',
    is_deceased: person?.is_deceased || false,
  });

  const [photoPreview, setPhotoPreview] = useState<string | null>(person?.photo_url || null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    });
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required';
    }

    if (formData.birth_date && formData.death_date && formData.birth_date > formData.death_date) {
      newErrors.death_date = 'Death date must be after birth date';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    onSubmit({
      first_name: formData.first_name,
      last_name: formData.last_name,
      birth_date: formData.birth_date || undefined,
      death_date: formData.death_date || undefined,
      gender: formData.gender as any,
      bio: formData.bio || undefined,
      location_id: formData.location_id || undefined,
      is_deceased: formData.is_deceased,
      photo_url: photoPreview || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
      {/* Photo Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Photo</label>
        <div className="flex items-center space-x-4">
          {photoPreview && (
            <img src={photoPreview} alt="Preview" className="w-20 h-20 rounded-full object-cover" />
          )}
          <div>
            <label className="block">
              <span className="sr-only">Choose photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  dark:file:bg-blue-900 dark:file:text-blue-200
                  hover:file:bg-blue-100 dark:hover:file:bg-blue-800
                  cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Name Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            First Name *
          </label>
          <input
            type="text"
            name="first_name"
            value={formData.first_name}
            onChange={handleInputChange}
            className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 ${
              errors.first_name ? 'border-red-500' : ''
            }`}
            placeholder="John"
          />
          {errors.first_name && <p className="text-red-500 text-xs mt-1">{errors.first_name}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Last Name
          </label>
          <input
            type="text"
            name="last_name"
            value={formData.last_name}
            onChange={handleInputChange}
            className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
            placeholder="Doe"
          />
        </div>
      </div>

      {/* Gender and Dates */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Gender
          </label>
          <select
            name="gender"
            value={formData.gender}
            onChange={handleInputChange}
            className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
          >
            {FAMILY_TREE_ENUMS.GENDER.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Birth Date
          </label>
          <input
            type="date"
            name="birth_date"
            value={formData.birth_date}
            onChange={handleInputChange}
            className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Death Date
          </label>
          <input
            type="date"
            name="death_date"
            value={formData.death_date}
            onChange={handleInputChange}
            className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 ${
              errors.death_date ? 'border-red-500' : ''
            }`}
          />
          {errors.death_date && <p className="text-red-500 text-xs mt-1">{errors.death_date}</p>}
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Location
        </label>
        <select
          name="location_id"
          value={formData.location_id}
          onChange={handleInputChange}
          className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
        >
          <option value="">Select a location (optional)</option>
          {locations.map((loc) => (
            <option key={loc.location_id} value={loc.location_id}>
              {loc.city}, {loc.state_province && `${loc.state_province}, `}
              {loc.country}
            </option>
          ))}
        </select>
      </div>

      {/* Bio */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Biography
        </label>
        <textarea
          name="bio"
          value={formData.bio}
          onChange={handleInputChange}
          rows={4}
          className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
          placeholder="Add biographical information..."
        />
      </div>

      {/* Is Deceased */}
      <div className="flex items-center">
        <input
          type="checkbox"
          name="is_deceased"
          checked={formData.is_deceased}
          onChange={handleInputChange}
          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
        />
        <label className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          Mark as deceased
        </label>
      </div>

      {/* Form Actions */}
      <div className="flex space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
        >
          {isLoading ? 'Saving...' : person ? 'Update Member' : 'Add Member'}
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
