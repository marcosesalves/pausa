-- Feedback and bug reports from the closed test group.
-- Written only by the submit-feedback edge function (service role). No client can read or write directly.

create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  kind            text not null check (kind in ('bug', 'feedback')),
  message         text not null check (char_length(message) between 1 and 4000),
  contact         text check (contact is null or char_length(contact) <= 200),
  -- pseudonymous per-install id (random UUID created on first launch), not a person
  install_id      uuid,
  app_version     text,
  os_version      text,
  settings        jsonb,
  log_tail        text check (log_tail is null or char_length(log_tail) <= 20000),
  screenshot_path text
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

-- Row level security on with no policies: anon and authenticated roles get nothing.
alter table public.feedback enable row level security;

-- Private bucket for optional screenshots (2 MB cap, images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

comment on table public.feedback is
  'Closed-test feedback. Contains free text that may be personal: review access and delete on request or after the test.';
