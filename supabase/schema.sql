-- supabase/schema.sql
-- Run this in Supabase Dashboard → SQL Editor

CREATE TABLE members (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  group_name  TEXT NOT NULL DEFAULT 'General',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE attendance (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  arrival_time  TIME NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('green','yellow','red')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, date)
);

CREATE INDEX idx_attendance_date   ON attendance(date);
CREATE INDEX idx_attendance_member ON attendance(member_id);

-- Row Level Security
ALTER TABLE members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users have full access
CREATE POLICY "auth_all_members" ON members
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_attendance" ON attendance
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
