# Family Tree Tracker - Setup & Usage Guide

## Overview

You've successfully built a complete Family Tree Tracker application with authentication, family tree management, and visualization features. The app allows users to:

- ✅ Sign up and log in with email/password
- ✅ Create multiple family trees
- ✅ Add family members with details (name, birth/death dates, gender, bio, photos, location)
- ✅ Define relationships (parent-child, spouse, siblings)
- ✅ View family trees in multiple formats (layout, hierarchical tree, map)
- ✅ Share family trees via links
- ✅ Manage and delete family trees

## Architecture

### Pages Created

1. **Landing Page** (`/`) - Unauthenticated users see marketing content, authenticated users redirect to dashboard
2. **Auth Pages** 
   - `/auth/signup` - User registration with email/password
   - `/auth/login` - User login
3. **Dashboard** (`/dashboard`) - User's family tree overview and management
4. **Family Tree Editor** (`/family-trees/[tree_id]`) - Edit specific family tree with CRUD operations
5. **Demo Page** (`/family-trees/demo`) - Interactive demo with sample data

### Key Components

- **AuthProvider** (`lib/auth-context.tsx`) - Authentication context managing signup, login, logout, and session state
- **PersonForm** - Add/edit family members
- **RelationshipForm** - Add/edit relationships between family members
- **FamilyTreeLayout** - Card-based layout view of family members
- **TreeVisualization** - Hierarchical tree diagram
- **FamilyLocationMap** - Geographic map view
- **SharingPanel** - Manage shareable links

## Environment Setup

### 1. Configure Supabase

Update `.env.local` with your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000  # or your deployed URL
```

### 2. Database Schema

The app requires these tables in Supabase (already created):

```sql
-- family_trees table
CREATE TABLE family_trees (
  tree_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  visibility TEXT DEFAULT 'private',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- persons table
CREATE TABLE persons (
  person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id UUID REFERENCES family_trees NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  birth_date DATE,
  death_date DATE,
  gender TEXT DEFAULT 'not_specified',
  bio TEXT,
  photo_url TEXT,
  location_id UUID,
  is_deceased BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- relationships table
CREATE TABLE relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id UUID REFERENCES family_trees NOT NULL,
  person_a_id UUID REFERENCES persons NOT NULL,
  person_b_id UUID REFERENCES persons NOT NULL,
  relationship_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- locations table
CREATE TABLE locations (
  location_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id UUID REFERENCES family_trees NOT NULL,
  city TEXT NOT NULL,
  state_province TEXT,
  country TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMP DEFAULT now()
);

-- shareable_links table
CREATE TABLE shareable_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id UUID REFERENCES family_trees NOT NULL,
  created_by UUID REFERENCES auth.users NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  access_level TEXT DEFAULT 'view_only',
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP,
  analytics_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);
```

### 3. Row Level Security (RLS)

Enable RLS on all tables and create policies to ensure users can only access their own data:

```sql
-- Enable RLS
ALTER TABLE family_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shareable_links ENABLE ROW LEVEL SECURITY;

-- Example: Users can only see their own family trees
CREATE POLICY "Users can view their own trees"
  ON family_trees FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create trees"
  ON family_trees FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Similar policies for other tables...
```

## Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Usage Flow

### For New Users

1. Visit the landing page
2. Click "Sign Up" or "Get Started Free"
3. Enter email and password, confirm password
4. Click "Sign Up" to create account
5. Automatically redirected to dashboard

### For Existing Users

1. Visit the landing page
2. Click "Sign In"
3. Enter email and password
4. Redirected to dashboard

### Creating a Family Tree

1. From dashboard, click "Create New Family Tree"
2. Enter tree name and optional description
3. Click "Create Tree"
4. Tree appears in the list

### Editing a Family Tree

1. From dashboard, click "Edit" on a tree
2. Use the top tabs to navigate between views:
   - **Layout** - Card-based overview
   - **Tree** - Hierarchical diagram
   - **Map** - Geographic view
   - **Sharing** - Share settings
   - **+ Person** - Add family member
   - **+ Relationship** - Define relationships
3. Changes are saved immediately to the database

### Adding Family Members

1. Click the "+ Person" tab
2. Fill in details (first name required)
3. Upload optional photo
4. Select location if available
5. Click "Add Member"
6. Member appears in the family tree

### Adding Relationships

1. Click the "+ Relationship" tab
2. Select relationship type (parent-child, married, siblings)
3. For parent-child, specify who is the parent/child
4. Select the two people to connect
5. Add optional notes
6. Click "Add Relationship"

## Key Features

### Authentication
- Email/password signup and login
- Session persistence using Supabase Auth
- Secure client-side session management

### Family Tree Management
- Create unlimited family trees
- Add unlimited family members per tree
- Define multiple relationship types
- Add notes and biographical information

### Visualization
- Card layout view of all members
- Hierarchical tree diagram
- Geographic map view with coordinates
- Responsive design for mobile and desktop

### Data Persistence
- All data stored in Supabase PostgreSQL
- Real-time synchronization
- Automatic timestamps on all records

## Deployment to Vercel

### 1. Push to GitHub

```bash
git push origin claude/family-tree-tracker-xsaS1
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import your repository
3. Select the branch `claude/family-tree-tracker-xsaS1`
4. Add environment variables from `.env.local`
5. Deploy

### 3. Set Environment Variables in Vercel

In your Vercel project settings, add:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_SITE_URL=https://your-domain.vercel.app
```

## Troubleshooting

### Build Errors

**Error: Cannot find module 'tailwindcss'**
- Solution: The app uses Tailwind CSS CDN instead of npm package. No configuration needed.

**Error: Failed to fetch Google Fonts**
- Solution: Google Fonts fetch is disabled during build. System fonts used instead.

### Authentication Issues

**Error: Invalid API key during signup**
- Check that `NEXT_PUBLIC_SUPABASE_ANON_KEY` is correct
- Verify Supabase project URL matches `NEXT_PUBLIC_SUPABASE_URL`
- Clear browser cache and try again

### Database Issues

**Error: family_trees table not found**
- Create the table using the SQL provided in Database Schema section
- Ensure RLS policies are configured

**No data appears after adding family members**
- Check that RLS policies allow INSERT operations
- Verify user_id matches the authenticated user

## Next Steps

### Potential Enhancements

1. **Photo Upload** - Store photos in Supabase Storage
2. **PDF Export** - Generate family tree PDFs
3. **Email Sharing** - Send shareable links via email
4. **Timeline View** - Show family events chronologically
5. **Batch Import** - Import family data from CSV/Excel
6. **Collaboration** - Real-time editing with multiple users
7. **Advanced Search** - Find family members by attributes
8. **Analytics** - Track family tree growth over time

## Support

For issues or questions:
1. Check the deployment logs on Vercel
2. Check browser console (F12) for JavaScript errors
3. Check Supabase logs for database errors
4. Verify environment variables are set correctly

---

**Build Information**
- Framework: Next.js 16 with App Router
- UI: React 19 with Tailwind CSS CDN
- Database: Supabase PostgreSQL with RLS
- Auth: Supabase Auth (email/password)
- Deployment: Vercel

Enjoy building your family tree! 🌳
