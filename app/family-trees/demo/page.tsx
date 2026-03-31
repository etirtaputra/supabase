'use client';

import React, { useState } from 'react';
import { FamilyTree, Person, Relationship, Location, ShareableLink } from '@/types/familyTree';
import { FamilyTreeLayout } from '@/components/family-tree/FamilyTreeLayout';
import { PersonForm } from '@/components/family-tree/PersonForm';
import { RelationshipForm } from '@/components/family-tree/RelationshipForm';
import { TreeVisualization } from '@/components/family-tree/TreeVisualization';
import { FamilyLocationMap } from '@/components/family-tree/FamilyLocationMap';
import { SharingPanel } from '@/components/family-tree/SharingPanel';

// Demo data
const demoTree: FamilyTree = {
  tree_id: 'demo-tree-1',
  owner_id: 'user-1',
  name: 'Smith Family Tree',
  description: 'Our family heritage spanning four generations',
  is_public: false,
  visibility: 'unlisted',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const demoPersons: Person[] = [
  {
    person_id: 'p1',
    tree_id: 'demo-tree-1',
    first_name: 'John',
    last_name: 'Smith',
    birth_date: '1940-01-15',
    death_date: '2010-06-20',
    gender: 'male',
    bio: 'Founder of the family business',
    location_id: 'loc-1',
    is_deceased: true,
    photo_url: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    person_id: 'p2',
    tree_id: 'demo-tree-1',
    first_name: 'Mary',
    last_name: 'Smith',
    birth_date: '1945-03-22',
    gender: 'female',
    bio: 'Teacher and community leader',
    location_id: 'loc-1',
    is_deceased: false,
    photo_url: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    person_id: 'p3',
    tree_id: 'demo-tree-1',
    first_name: 'Robert',
    last_name: 'Smith',
    birth_date: '1968-05-10',
    gender: 'male',
    bio: 'Software engineer',
    location_id: 'loc-2',
    is_deceased: false,
    photo_url: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    person_id: 'p4',
    tree_id: 'demo-tree-1',
    first_name: 'Sarah',
    last_name: 'Johnson',
    birth_date: '1970-07-18',
    gender: 'female',
    bio: 'Doctor',
    location_id: 'loc-3',
    is_deceased: false,
    photo_url: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    person_id: 'p5',
    tree_id: 'demo-tree-1',
    first_name: 'Emma',
    last_name: 'Smith',
    birth_date: '1995-11-03',
    gender: 'female',
    bio: 'Student',
    location_id: 'loc-2',
    is_deceased: false,
    photo_url: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const demoRelationships: Relationship[] = [
  {
    relationship_id: 'r1',
    tree_id: 'demo-tree-1',
    person_a_id: 'p1',
    person_b_id: 'p3',
    relationship_type: 'parent_child',
    direction: 'parent',
    created_at: new Date().toISOString(),
  },
  {
    relationship_id: 'r2',
    tree_id: 'demo-tree-1',
    person_a_id: 'p2',
    person_b_id: 'p3',
    relationship_type: 'parent_child',
    direction: 'parent',
    created_at: new Date().toISOString(),
  },
  {
    relationship_id: 'r3',
    tree_id: 'demo-tree-1',
    person_a_id: 'p1',
    person_b_id: 'p2',
    relationship_type: 'married',
    direction: 'spouse',
    created_at: new Date().toISOString(),
  },
  {
    relationship_id: 'r4',
    tree_id: 'demo-tree-1',
    person_a_id: 'p3',
    person_b_id: 'p4',
    relationship_type: 'married',
    direction: 'spouse',
    created_at: new Date().toISOString(),
  },
  {
    relationship_id: 'r5',
    tree_id: 'demo-tree-1',
    person_a_id: 'p3',
    person_b_id: 'p5',
    relationship_type: 'parent_child',
    direction: 'parent',
    created_at: new Date().toISOString(),
  },
];

const demoLocations: Location[] = [
  {
    location_id: 'loc-1',
    tree_id: 'demo-tree-1',
    city: 'New York',
    state_province: 'New York',
    country: 'United States',
    latitude: 40.7128,
    longitude: -74.006,
    created_at: new Date().toISOString(),
  },
  {
    location_id: 'loc-2',
    tree_id: 'demo-tree-1',
    city: 'San Francisco',
    state_province: 'California',
    country: 'United States',
    latitude: 37.7749,
    longitude: -122.4194,
    created_at: new Date().toISOString(),
  },
  {
    location_id: 'loc-3',
    tree_id: 'demo-tree-1',
    city: 'Boston',
    state_province: 'Massachusetts',
    country: 'United States',
    latitude: 42.3601,
    longitude: -71.0589,
    created_at: new Date().toISOString(),
  },
];

const demoShareLinks: ShareableLink[] = [
  {
    link_id: 'link-1',
    tree_id: 'demo-tree-1',
    created_by: 'user-1',
    slug: 'smith-family-abc123',
    access_level: 'view_only',
    is_active: true,
    expires_at: undefined,
    analytics_enabled: true,
    created_at: new Date().toISOString(),
  },
];

export default function DemoPage() {
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [showRelationshipForm, setShowRelationshipForm] = useState(false);
  const [activeView, setActiveView] = useState<'layout' | 'person-form' | 'relationship-form' | 'tree' | 'map' | 'sharing'>('layout');

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700 p-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center space-x-4">
          <h1 className="text-white font-bold text-lg mr-auto">Family Tree Demo</h1>
          <button
            onClick={() => setActiveView('layout')}
            className={`px-4 py-2 rounded ${activeView === 'layout' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Layout
          </button>
          <button
            onClick={() => setActiveView('tree')}
            className={`px-4 py-2 rounded ${activeView === 'tree' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Tree
          </button>
          <button
            onClick={() => setActiveView('map')}
            className={`px-4 py-2 rounded ${activeView === 'map' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Map
          </button>
          <button
            onClick={() => setActiveView('sharing')}
            className={`px-4 py-2 rounded ${activeView === 'sharing' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Sharing
          </button>
          <button
            onClick={() => setActiveView('person-form')}
            className={`px-4 py-2 rounded ${activeView === 'person-form' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Add Person
          </button>
          <button
            onClick={() => setActiveView('relationship-form')}
            className={`px-4 py-2 rounded ${activeView === 'relationship-form' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Add Relationship
          </button>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto p-8">
        {activeView === 'layout' && (
          <FamilyTreeLayout
            tree={demoTree}
            persons={demoPersons}
            relationships={demoRelationships}
            locations={demoLocations}
          />
        )}

        {activeView === 'tree' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Family Tree Visualization</h2>
            <TreeVisualization
              persons={demoPersons}
              relationships={demoRelationships}
              onPersonClick={(person) => setSelectedPerson(person)}
            />
            {selectedPerson && (
              <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Selected Person</h3>
                <p className="text-gray-700 dark:text-gray-300">
                  {selectedPerson.first_name} {selectedPerson.last_name}
                  {selectedPerson.birth_date && ` (b. ${new Date(selectedPerson.birth_date).getFullYear()})`}
                </p>
              </div>
            )}
          </div>
        )}

        {activeView === 'map' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Family Locations</h2>
            <FamilyLocationMap
              persons={demoPersons}
              locations={demoLocations}
            />
          </div>
        )}

        {activeView === 'sharing' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Sharing & Collaboration</h2>
            <SharingPanel
              tree={demoTree}
              shareLinks={demoShareLinks}
            />
          </div>
        )}

        {activeView === 'person-form' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Add Family Member</h2>
            <PersonForm
              treeId={demoTree.tree_id}
              locations={demoLocations}
              onSubmit={(data) => {
                console.log('Person submitted:', data);
                setActiveView('layout');
              }}
              onCancel={() => setActiveView('layout')}
            />
          </div>
        )}

        {activeView === 'relationship-form' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Add Relationship</h2>
            <RelationshipForm
              persons={demoPersons}
              onSubmit={(data) => {
                console.log('Relationship submitted:', data);
                setActiveView('layout');
              }}
              onCancel={() => setActiveView('layout')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
