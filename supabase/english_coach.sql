create table if not exists public.english_coach_courses (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  title text not null default '',
  summary_zh text not null default '',
  learned_on date,
  display_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id),
  constraint english_coach_courses_course_id_not_blank
    check (length(btrim(course_id)) > 0),
  constraint english_coach_courses_payload_is_object
    check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.english_coach_review_cards (
  user_id uuid not null,
  course_id text not null,
  card_id text not null,
  prompt text not null default '',
  answer text not null default '',
  status text not null default 'new',
  mastery_score smallint not null default 0,
  interval_days integer not null default 0,
  review_count integer not null default 0,
  success_streak integer not null default 0,
  last_result text,
  next_due date,
  last_reviewed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id, card_id),
  foreign key (user_id, course_id)
    references public.english_coach_courses(user_id, course_id)
    on delete cascade,
  constraint english_coach_review_cards_card_id_not_blank
    check (length(btrim(card_id)) > 0),
  constraint english_coach_review_cards_mastery_score_range
    check (mastery_score between 0 and 100),
  constraint english_coach_review_cards_interval_nonnegative
    check (interval_days >= 0),
  constraint english_coach_review_cards_review_count_nonnegative
    check (review_count >= 0),
  constraint english_coach_review_cards_success_streak_nonnegative
    check (success_streak >= 0),
  constraint english_coach_review_cards_payload_is_object
    check (jsonb_typeof(payload) = 'object')
);

create index if not exists english_coach_courses_user_order_idx
  on public.english_coach_courses (user_id, display_order, updated_at desc);

create index if not exists english_coach_review_cards_learning_order_idx
  on public.english_coach_review_cards (
    user_id,
    mastery_score asc,
    next_due asc nulls first,
    updated_at asc
  );

create index if not exists english_coach_review_cards_course_idx
  on public.english_coach_review_cards (user_id, course_id, updated_at desc);

create or replace function public.touch_english_coach_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_english_coach_courses_updated_at
  on public.english_coach_courses;
create trigger touch_english_coach_courses_updated_at
  before update on public.english_coach_courses
  for each row
  execute function public.touch_english_coach_updated_at();

drop trigger if exists touch_english_coach_review_cards_updated_at
  on public.english_coach_review_cards;
create trigger touch_english_coach_review_cards_updated_at
  before update on public.english_coach_review_cards
  for each row
  execute function public.touch_english_coach_updated_at();

alter table public.english_coach_courses enable row level security;
alter table public.english_coach_courses force row level security;

drop policy if exists "Users can select their own English Coach courses"
  on public.english_coach_courses;
create policy "Users can select their own English Coach courses"
  on public.english_coach_courses
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own English Coach courses"
  on public.english_coach_courses;
create policy "Users can insert their own English Coach courses"
  on public.english_coach_courses
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own English Coach courses"
  on public.english_coach_courses;
create policy "Users can update their own English Coach courses"
  on public.english_coach_courses
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own English Coach courses"
  on public.english_coach_courses;
create policy "Users can delete their own English Coach courses"
  on public.english_coach_courses
  for delete
  to authenticated
  using (auth.uid() = user_id);

alter table public.english_coach_review_cards enable row level security;
alter table public.english_coach_review_cards force row level security;

drop policy if exists "Users can select their own English Coach review cards"
  on public.english_coach_review_cards;
create policy "Users can select their own English Coach review cards"
  on public.english_coach_review_cards
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own English Coach review cards"
  on public.english_coach_review_cards;
create policy "Users can insert their own English Coach review cards"
  on public.english_coach_review_cards
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own English Coach review cards"
  on public.english_coach_review_cards;
create policy "Users can update their own English Coach review cards"
  on public.english_coach_review_cards
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own English Coach review cards"
  on public.english_coach_review_cards;
create policy "Users can delete their own English Coach review cards"
  on public.english_coach_review_cards
  for delete
  to authenticated
  using (auth.uid() = user_id);
