'use client';

import React, { useState } from 'react';
import { FamilyTree, ShareableLink } from '@/types/familyTree';
import { FAMILY_TREE_ENUMS } from '@/constants/familyTreeEnums';

interface SharingPanelProps {
  tree: FamilyTree;
  shareLinks?: ShareableLink[];
  onCreateLink?: (accessLevel: 'view_only' | 'can_edit' | 'admin') => void;
  onRevokeLink?: (linkId: string) => void;
  isLoading?: boolean;
  className?: string;
}

export const SharingPanel: React.FC<SharingPanelProps> = ({
  tree,
  shareLinks = [],
  onCreateLink,
  onRevokeLink,
  isLoading = false,
  className = '',
}) => {
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<'view_only' | 'can_edit' | 'admin'>(
    'view_only'
  );

  const copyToClipboard = (slug: string) => {
    const url = `${window.location.origin}/public/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedLinkId(slug);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const getAccessLevelLabel = (level: string) => {
    return FAMILY_TREE_ENUMS.ACCESS_LEVELS.find((a) => a.value === level)?.label || level;
  };

  const generateQRCode = (slug: string) => {
    const url = `${window.location.origin}/public/${slug}`;
    // QR code generation would use a library like qrcode.react
    return `QR Code for: ${url}`;
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Tree Visibility Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tree Visibility</h2>

        <div className="space-y-3">
          {FAMILY_TREE_ENUMS.VISIBILITY.map((option) => (
            <label key={option.value} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={tree.visibility === option.value}
                className="w-4 h-4 text-blue-600"
                onChange={() => {}}
              />
              <div className="ml-3">
                <p className="font-medium text-gray-900 dark:text-white">{option.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {option.value === 'private' && 'Only you and invited collaborators can view'}
                  {option.value === 'unlisted' && 'Anyone with the link can view'}
                  {option.value === 'public' && 'Visible to everyone, listed in search'}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Generate Shareable Links */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Shareable Links</h2>

        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
            Generate a unique link to share your family tree with others
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Access Level
              </label>
              <select
                value={selectedAccessLevel}
                onChange={(e) => setSelectedAccessLevel(e.target.value as any)}
                className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500"
              >
                {FAMILY_TREE_ENUMS.ACCESS_LEVELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {selectedAccessLevel === 'view_only' && 'Recipients can only view the family tree'}
                {selectedAccessLevel === 'can_edit' && 'Recipients can view and edit the family tree'}
                {selectedAccessLevel === 'admin' && 'Recipients have full administrative access'}
              </p>
            </div>

            <button
              onClick={() => onCreateLink?.(selectedAccessLevel)}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors flex items-center justify-center"
            >
              <span className="mr-2">🔗</span>
              {isLoading ? 'Generating...' : 'Generate New Link'}
            </button>
          </div>
        </div>

        {/* Existing Links */}
        {shareLinks.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No shareable links yet. Generate one to get started!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shareLinks.map((link) => (
              <div key={link.link_id} className="border rounded-lg p-4 dark:border-gray-700">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {getAccessLevelLabel(link.access_level)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Created {new Date(link.created_at).toLocaleDateString()}
                    </p>
                    {link.expires_at && (
                      <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                        Expires {new Date(link.expires_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onRevokeLink?.(link.link_id)}
                    className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  >
                    Revoke
                  </button>
                </div>

                <div className="space-y-2">
                  {/* Link URL */}
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/public/${link.slug}`}
                      className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white"
                    />
                    <button
                      onClick={() => copyToClipboard(link.slug)}
                      className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                        copiedLinkId === link.slug
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                    >
                      {copiedLinkId === link.slug ? '✅ Copied' : '📋 Copy'}
                    </button>
                  </div>

                  {/* QR Code Placeholder */}
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Share via QR code:</p>
                    <div className="w-24 h-24 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
                      <span className="text-xs text-gray-500 dark:text-gray-500">QR Code</span>
                    </div>
                  </div>

                  {/* Social Share */}
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Share on social media:</p>
                    <div className="flex space-x-2">
                      <button className="px-3 py-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors">
                        Twitter
                      </button>
                      <button className="px-3 py-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors">
                        Facebook
                      </button>
                      <button className="px-3 py-2 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                        Email
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sharing Analytics */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Sharing Analytics</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Views</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2">0</div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
            <div className="text-sm text-gray-600 dark:text-gray-400">People Joined</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2">0</div>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
            <div className="text-sm text-gray-600 dark:text-gray-400">Conversion Rate</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2">0%</div>
          </div>
        </div>

        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-center text-sm text-gray-600 dark:text-gray-400">
          Detailed analytics tracking coming soon
        </div>
      </div>

      {/* Collaborators */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Collaborators</h2>

        <button className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium transition-colors flex items-center justify-center">
          <span className="mr-2">👥</span> Invite Collaborators
        </button>

        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-center text-sm text-gray-600 dark:text-gray-400">
          No collaborators yet
        </div>
      </div>
    </div>
  );
};
