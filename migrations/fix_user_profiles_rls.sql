-- Fix RLS on user_profiles.
-- Previous "owner can manage all" policy had a circular self-reference.
-- For an internal tool: any authenticated user can read all profiles;
-- only the app enforces that role changes require owner access.

DROP POLICY IF EXISTS "Users can read own profile"      ON user_profiles;
DROP POLICY IF EXISTS "Owner can manage all profiles"   ON user_profiles;

-- Read: any signed-in user can see all profiles
CREATE POLICY "Authenticated users can read profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Insert: only your own row (triggered on first login)
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Update: any authenticated user can update any profile row
-- (owner-only enforcement is handled in the app at /admin)
CREATE POLICY "Authenticated users can update profiles"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (true);
