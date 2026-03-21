-- Supabase Schema for Stroke Scheduling Feature

-- 1. Users Table
CREATE TABLE public.users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text,
  avatar_url text,
  refresh_token text, -- Store the Google OAuth refresh token securely
  created_at timestamp with time zone DEFAULT now()
);

-- 2. Campaigns Table
CREATE TABLE public.campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  action text NOT NULL, -- 'bulkSend' or 'threadedFollowup'
  subject_template text,
  body_template text,
  csv_data jsonb,
  headers jsonb,
  scheduled_at timestamp with time zone NOT NULL,
  followup_delay_hours integer,
  status text DEFAULT 'pending', -- pending, processing, done
  created_at timestamp with time zone DEFAULT now()
);

-- 3. Emails Table
CREATE TABLE public.emails (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  subject text,
  body text,
  thread_id text,
  message_id text,
  rfc_message_id text,
  scheduled_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  status text DEFAULT 'pending', -- pending, sent, failed, skipped_replied
  error text,
  is_followup boolean DEFAULT false
);

-- Enable Row Level Security (RLS) but allow Service Role bypass
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

-- Note: Because our Vercel backend uses the Service Role key (SUPABASE_KEY),
-- it can bypass RLS automatically. If we ever queries directly from the browser,
-- we would need specific RLS policies here. For now, the backend handles everything.
