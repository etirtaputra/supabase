-- Create user_profiles table linked to Supabase Auth users.
-- Role is set manually by the owner after a user first signs in.

CREATE TABLE IF NOT EXISTS user_profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  display_name text,
  role         text        NOT NULL DEFAULT 'viewer'
                           CHECK (role IN ('owner', 'data_entry', 'finance', 'viewer')),
  created_at   timestamptz DEFAULT now() NOT NULL
);

-- Auto-create a viewer profile when a new user signs in for the first time.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Allow users to read their own profile.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Only owner role can update roles (enforced in app; RLS keeps reads safe).
CREATE POLICY "Owner can manage all profiles"
  ON user_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );
