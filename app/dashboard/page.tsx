'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@supabase/supabase-js';

interface FamilyTree {
  tree_id: string;
  name: string;
  description: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const [trees, setTrees] = useState<FamilyTree[]>([]);
  const [loadingTrees, setLoadingTrees] = useState(true);
  const [showNewTreeForm, setShowNewTreeForm] = useState(false);
  const [newTreeName, setNewTreeName] = useState('');
  const [newTreeDescription, setNewTreeDescription] = useState('');
  const [creatingTree, setCreatingTree] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      fetchTrees();
    }
  }, [user]);

  const fetchTrees = async () => {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data, error } = await supabase
        .from('family_trees')
        .select('*')
        .eq('owner_id', user?.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setTrees(data || []);
    } catch (error) {
      console.error('Error fetching trees:', error);
    } finally {
      setLoadingTrees(false);
    }
  };

  const handleCreateTree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTreeName.trim()) return;

    try {
      setCreatingTree(true);
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data, error } = await supabase
        .from('family_trees')
        .insert({
          owner_id: user?.id,
          name: newTreeName,
          description: newTreeDescription,
          is_public: false,
          visibility: 'private',
        })
        .select()
        .single();

      if (error) throw error;

      setNewTreeName('');
      setNewTreeDescription('');
      setShowNewTreeForm(false);
      await fetchTrees();
    } catch (error) {
      console.error('Error creating tree:', error);
    } finally {
      setCreatingTree(false);
    }
  };

  const handleDeleteTree = async (treeId: string) => {
    if (!confirm('Are you sure you want to delete this family tree?')) return;

    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { error } = await supabase
        .from('family_trees')
        .delete()
        .eq('tree_id', treeId);

      if (error) throw error;
      await fetchTrees();
    } catch (error) {
      console.error('Error deleting tree:', error);
    }
  };

  if (loading || (user && loadingTrees)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🌳 My Family Trees</h1>
            <p className="text-sm text-gray-600">{user.email}</p>
          </div>
          <button
            onClick={signOut}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Create New Tree Button */}
        {!showNewTreeForm && (
          <button
            onClick={() => setShowNewTreeForm(true)}
            className="mb-8 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            + Create New Family Tree
          </button>
        )}

        {/* Create Tree Form */}
        {showNewTreeForm && (
          <div className="mb-8 p-6 bg-white rounded-lg shadow-md border border-gray-200">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Create New Family Tree</h2>
            <form onSubmit={handleCreateTree} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tree Name *
                </label>
                <input
                  type="text"
                  value={newTreeName}
                  onChange={(e) => setNewTreeName(e.target.value)}
                  placeholder="e.g., Smith Family Tree"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creatingTree}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newTreeDescription}
                  onChange={(e) => setNewTreeDescription(e.target.value)}
                  placeholder="Add a description for this family tree..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creatingTree}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={creatingTree || !newTreeName.trim()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition"
                >
                  {creatingTree ? 'Creating...' : 'Create Tree'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewTreeForm(false);
                    setNewTreeName('');
                    setNewTreeDescription('');
                  }}
                  className="px-6 py-2 bg-gray-300 hover:bg-gray-400 text-gray-900 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Trees Grid */}
        {trees.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">No family trees yet. Create one to get started!</p>
            {!showNewTreeForm && (
              <button
                onClick={() => setShowNewTreeForm(true)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
              >
                Create Your First Tree
              </button>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {trees.map((tree) => (
              <div key={tree.tree_id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition border border-gray-200 overflow-hidden">
                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{tree.name}</h3>
                  {tree.description && (
                    <p className="text-gray-600 text-sm mb-4">{tree.description}</p>
                  )}
                  <p className="text-xs text-gray-500 mb-4">
                    Updated {new Date(tree.updated_at).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2">
                    <Link
                      href={`/family-trees/${tree.tree_id}`}
                      className="flex-1 text-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDeleteTree(tree.tree_id)}
                      className="flex-1 text-center px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
