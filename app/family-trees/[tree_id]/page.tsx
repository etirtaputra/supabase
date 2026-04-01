'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@supabase/supabase-js';
import { FamilyTree, Person, Relationship, Location } from '@/types/familyTree';
import { FamilyTreeLayout } from '@/components/family-tree/FamilyTreeLayout';
import { PersonForm } from '@/components/family-tree/PersonForm';
import { RelationshipForm } from '@/components/family-tree/RelationshipForm';
import { TreeVisualization } from '@/components/family-tree/TreeVisualization';
import { FamilyLocationMap } from '@/components/family-tree/FamilyLocationMap';
import { SharingPanel } from '@/components/family-tree/SharingPanel';

type ViewType = 'layout' | 'person-form' | 'relationship-form' | 'tree' | 'map' | 'sharing';

export default function FamilyTreeEditor() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const treeId = params.tree_id as string;

  const [tree, setTree] = useState<FamilyTree | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<ViewType>('layout');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user && treeId) {
      fetchData();
    }
  }, [user, treeId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      // Fetch tree
      const { data: treeData, error: treeError } = await supabase
        .from('family_trees')
        .select('*')
        .eq('tree_id', treeId)
        .eq('owner_id', user?.id)
        .single();

      if (treeError || !treeData) {
        setError('Family tree not found or you do not have access');
        return;
      }

      setTree(treeData);

      // Fetch all data in parallel
      const [personsData, relData, locData] = await Promise.all([
        supabase.from('persons').select('*').eq('tree_id', treeId),
        supabase.from('relationships').select('*').eq('tree_id', treeId),
        supabase.from('locations').select('*').eq('tree_id', treeId),
      ]);

      setPersons(personsData.data || []);
      setRelationships(relData.data || []);
      setLocations(locData.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load family tree');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPerson = async (personData: Omit<Person, 'person_id' | 'tree_id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error } = await supabase
        .from('persons')
        .insert({
          tree_id: treeId,
          ...personData,
        })
        .select()
        .single();

      if (error) throw error;
      setPersons([...persons, data]);
      setActiveView('layout');
    } catch (err) {
      console.error('Error adding person:', err);
    }
  };

  const handleAddRelationship = async (relationshipData: Omit<Relationship, 'relationship_id' | 'tree_id' | 'created_at'>) => {
    try {
      const { data, error } = await supabase
        .from('relationships')
        .insert({
          tree_id: treeId,
          ...relationshipData,
        })
        .select()
        .single();

      if (error) throw error;
      setRelationships([...relationships, data]);
      setActiveView('layout');
    } catch (err) {
      console.error('Error adding relationship:', err);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-white">Loading...</p>
        </div>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Family tree not found'}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700 p-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center space-x-4">
          <div>
            <h1 className="text-white font-bold text-lg">{tree.name}</h1>
            <p className="text-gray-400 text-sm">{tree.description}</p>
          </div>
          <div className="ml-auto flex items-center space-x-2">
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
            >
              ← Dashboard
            </button>
          </div>
        </div>
      </nav>

      {/* View Tabs */}
      <div className="bg-gray-800 border-b border-gray-700 p-4 sticky top-16 z-10">
        <div className="max-w-7xl mx-auto flex items-center space-x-2 overflow-x-auto">
          {[
            { key: 'layout', label: 'Layout' },
            { key: 'tree', label: 'Tree' },
            { key: 'map', label: 'Map' },
            { key: 'sharing', label: 'Sharing' },
            { key: 'person-form', label: '+ Person' },
            { key: 'relationship-form', label: '+ Relationship' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key as ViewType)}
              className={`px-4 py-2 rounded transition whitespace-nowrap ${
                activeView === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto p-8">
        {activeView === 'layout' && (
          <FamilyTreeLayout
            tree={tree}
            persons={persons}
            relationships={relationships}
            locations={locations}
          />
        )}

        {activeView === 'tree' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Family Tree Visualization</h2>
            <TreeVisualization
              persons={persons}
              relationships={relationships}
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
              persons={persons}
              locations={locations}
            />
          </div>
        )}

        {activeView === 'sharing' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Sharing & Collaboration</h2>
            <SharingPanel
              tree={tree}
              shareLinks={[]}
            />
          </div>
        )}

        {activeView === 'person-form' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Add Family Member</h2>
            <PersonForm
              treeId={treeId}
              locations={locations}
              onSubmit={handleAddPerson}
              onCancel={() => setActiveView('layout')}
            />
          </div>
        )}

        {activeView === 'relationship-form' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Add Relationship</h2>
            <RelationshipForm
              persons={persons}
              onSubmit={handleAddRelationship}
              onCancel={() => setActiveView('layout')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
