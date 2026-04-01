'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600">
      {/* Navigation */}
      <nav className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">🌳 Family Tree Tracker</h1>
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-white">{user.email}</span>
              <Link href="/dashboard" className="px-6 py-2 bg-white text-blue-600 rounded-lg font-medium hover:bg-gray-100 transition">
                Dashboard
              </Link>
            </div>
          ) : (
            <div className="flex items-center space-x-4">
              <Link href="/auth/login" className="text-white hover:text-gray-100 transition">
                Sign In
              </Link>
              <Link href="/auth/signup" className="px-6 py-2 bg-white text-blue-600 rounded-lg font-medium hover:bg-gray-100 transition">
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-20">
          <h2 className="text-5xl font-bold text-white mb-6">
            Discover and Share Your Family Heritage
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Create beautiful family trees, connect generations, track lineages, and share your family history with loved ones.
          </p>
          <div className="flex justify-center gap-4">
            {!user ? (
              <>
                <Link href="/auth/signup" className="px-8 py-4 bg-white text-blue-600 rounded-lg font-bold text-lg hover:bg-gray-100 transition shadow-lg">
                  Get Started Free
                </Link>
                <Link href="/family-trees/demo" className="px-8 py-4 bg-blue-600/30 backdrop-blur-md text-white rounded-lg font-bold text-lg hover:bg-blue-600/50 transition border border-white/30">
                  View Demo
                </Link>
              </>
            ) : (
              <Link href="/dashboard" className="px-8 py-4 bg-white text-blue-600 rounded-lg font-bold text-lg hover:bg-gray-100 transition shadow-lg">
                Go to Dashboard
              </Link>
            )}
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mb-20">
          <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20">
            <div className="text-4xl mb-4">👥</div>
            <h3 className="text-2xl font-bold text-white mb-3">Track Family Members</h3>
            <p className="text-blue-100">
              Add family members with names, birth/death dates, photos, bios, and locations.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20">
            <div className="text-4xl mb-4">🔗</div>
            <h3 className="text-2xl font-bold text-white mb-3">Define Relationships</h3>
            <p className="text-blue-100">
              Create parent-child, spouse, and sibling relationships to build your family structure.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20">
            <div className="text-4xl mb-4">📍</div>
            <h3 className="text-2xl font-bold text-white mb-3">Map Locations</h3>
            <p className="text-blue-100">
              View family members on an interactive map to understand geographic connections.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20">
            <div className="text-4xl mb-4">🌳</div>
            <h3 className="text-2xl font-bold text-white mb-3">Visualize Trees</h3>
            <p className="text-blue-100">
              See hierarchical family trees with clear parent-child relationships and connections.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20">
            <div className="text-4xl mb-4">🔗</div>
            <h3 className="text-2xl font-bold text-white mb-3">Share Easily</h3>
            <p className="text-blue-100">
              Generate shareable links to let family members view and contribute to your tree.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20">
            <div className="text-4xl mb-4">🔒</div>
            <h3 className="text-2xl font-bold text-white mb-3">Privacy Controlled</h3>
            <p className="text-blue-100">
              Control who can see and edit your family trees with flexible privacy settings.
            </p>
          </div>
        </div>

        {/* Demo CTA */}
        <div className="bg-white/10 backdrop-blur-md rounded-lg p-12 border border-white/20 text-center">
          <h3 className="text-3xl font-bold text-white mb-4">See It In Action</h3>
          <p className="text-blue-100 mb-6 max-w-xl mx-auto">
            Explore our demo to see how you can organize, visualize, and share your family tree.
          </p>
          <Link href="/family-trees/demo" className="inline-block px-8 py-3 bg-white text-blue-600 rounded-lg font-bold hover:bg-gray-100 transition">
            Try the Demo
          </Link>
        </div>
      </div>
    </div>
  );
}
