'use client';

import React, { useState } from 'react';
import { FamilyTree, Person, Relationship, Location } from '@/types/familyTree';

interface FamilyTreeLayoutProps {
  tree: FamilyTree;
  persons: Person[];
  relationships: Relationship[];
  locations: Location[];
  onPersonAdded?: (person: Person) => void;
  onRelationshipAdded?: (relationship: Relationship) => void;
  onTreeUpdated?: (tree: FamilyTree) => void;
}

export const FamilyTreeLayout: React.FC<FamilyTreeLayoutProps> = ({
  tree,
  persons,
  relationships,
  locations,
  onPersonAdded,
  onRelationshipAdded,
  onTreeUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'tree' | 'locations' | 'sharing'>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📋' },
    { id: 'tree', label: 'Family Tree', icon: '🌳' },
    { id: 'locations', label: 'Locations', icon: '📍' },
    { id: 'sharing', label: 'Sharing', icon: '🔗' },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{tree.name}</h1>
            {tree.description && (
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">{tree.description}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
              {persons.length} members
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
              {locations.length} locations
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-t border-gray-200 dark:border-gray-700">
          <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-500 dark:text-gray-400 text-sm font-medium">Total Members</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{persons.length}</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-500 dark:text-gray-400 text-sm font-medium">Relationships</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{relationships.length}</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-500 dark:text-gray-400 text-sm font-medium">Locations</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{locations.length}</div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-3">
                <button className="flex items-center justify-center px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                  <span className="mr-2">➕</span> Add Member
                </button>
                <button className="flex items-center justify-center px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors">
                  <span className="mr-2">🔗</span> Add Relationship
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tree' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 h-96 flex items-center justify-center">
            <p className="text-gray-500 dark:text-gray-400">Tree visualization component will be rendered here</p>
          </div>
        )}

        {activeTab === 'locations' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 h-96 flex items-center justify-center">
            <p className="text-gray-500 dark:text-gray-400">Location map component will be rendered here</p>
          </div>
        )}

        {activeTab === 'sharing' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 h-96 flex items-center justify-center">
            <p className="text-gray-500 dark:text-gray-400">Sharing panel component will be rendered here</p>
          </div>
        )}
      </main>
    </div>
  );
};
