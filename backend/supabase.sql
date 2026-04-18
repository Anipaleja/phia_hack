-- Shopping Agent Supabase Database Schema

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Profiles Table (optional, stores user preferences)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  style_preferences JSONB DEFAULT '{}',
  budget_range VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Searches Table (stores search history)
CREATE TABLE IF NOT EXISTS public.searches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  ai_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT prompt_not_empty CHECK (prompt != '')
);

-- Saved Outfits Table (stores favorited outfits)
CREATE TABLE IF NOT EXISTS public.saved_outfits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outfit_data JSONB NOT NULL,
  prompt TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_searches_user_id ON public.searches(user_id);
CREATE INDEX IF NOT EXISTS idx_searches_created_at ON public.searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_outfits_user_id ON public.saved_outfits(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_outfits_created_at ON public.saved_outfits(created_at DESC);

-- Enable Row Level Security (RLS) for security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_outfits ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only read/write their own data
-- User Profiles
CREATE POLICY "Users can view own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Searches
CREATE POLICY "Users can view own searches" ON public.searches
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own searches" ON public.searches
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Saved Outfits
CREATE POLICY "Users can view own saved outfits" ON public.saved_outfits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved outfits" ON public.saved_outfits
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved outfits" ON public.saved_outfits
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved outfits" ON public.saved_outfits
  FOR DELETE USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON public.user_profiles TO authenticated;
GRANT ALL ON public.searches TO authenticated;
GRANT ALL ON public.saved_outfits TO authenticated;

-- Optional: Create a function to update updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_profiles updated_at
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for saved_outfits updated_at
DROP TRIGGER IF EXISTS update_saved_outfits_updated_at ON public.saved_outfits;
CREATE TRIGGER update_saved_outfits_updated_at
  BEFORE UPDATE ON public.saved_outfits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
