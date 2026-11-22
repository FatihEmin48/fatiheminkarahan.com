/* ===========================================================================
   ANTRENMAN — Antrenman sekmesinin bulut tarafı
   ---------------------------------------------------------------------------
   Supabase → SQL Editor → bu dosyanın tamamını çalıştır. Tekrar çalıştırmak güvenlidir.

   Uygulama bu tablolar olmadan da çalışır: antrenmanlar cihazda kalır, tablolar kurulunca
   bir sonraki eşitlemede kendiliğinden gönderilir.

   Tasarım:
   - id istemcide üretilen uuid’dir (çevrimdışı kayıt için). Başkasının satırının üzerine
     yazılamaz: upsert’in güncelleme yolu da RLS’ten geçer (auth.uid() = user_id).
   - Bir antrenmanın hareketleri ve setleri data (jsonb) içinde durur:
       {items:[{ex, name, measure, muscles, muscles2, cat, rest, target, note,
                sets:[{kg, reps, sec, km, done, type}]}], note, routine_id}
   - Silme “deleted = true” ile işaretlenir; böylece başka cihazlar da silindiğini öğrenir.
   - auth.users silinince (hesap silme) iki tablo da cascade ile temizlenir.
   =========================================================================== */

create table if not exists public.sp_workouts (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date,
  started_at  timestamptz,
  ended_at    timestamptz,
  name        text check (char_length(name) <= 120),
  data        jsonb,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sp_workouts_data_boyut check (data is null or pg_column_size(data) < 200000)
);

alter table public.sp_workouts enable row level security;

drop policy if exists "sp antrenman kendi select" on public.sp_workouts;
create policy "sp antrenman kendi select" on public.sp_workouts
  for select using (auth.uid() = user_id);
drop policy if exists "sp antrenman kendi insert" on public.sp_workouts;
create policy "sp antrenman kendi insert" on public.sp_workouts
  for insert with check (auth.uid() = user_id);
drop policy if exists "sp antrenman kendi update" on public.sp_workouts;
create policy "sp antrenman kendi update" on public.sp_workouts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "sp antrenman kendi delete" on public.sp_workouts;
create policy "sp antrenman kendi delete" on public.sp_workouts
  for delete using (auth.uid() = user_id);

create index if not exists sp_workouts_user_started_idx
  on public.sp_workouts (user_id, started_at desc);

-- ---------------------------------------------------------------------------

create table if not exists public.sp_routines (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text check (char_length(name) <= 120),
  data        jsonb,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sp_routines_data_boyut check (data is null or pg_column_size(data) < 50000)
);

alter table public.sp_routines enable row level security;

drop policy if exists "sp program kendi select" on public.sp_routines;
create policy "sp program kendi select" on public.sp_routines
  for select using (auth.uid() = user_id);
drop policy if exists "sp program kendi insert" on public.sp_routines;
create policy "sp program kendi insert" on public.sp_routines
  for insert with check (auth.uid() = user_id);
drop policy if exists "sp program kendi update" on public.sp_routines;
create policy "sp program kendi update" on public.sp_routines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "sp program kendi delete" on public.sp_routines;
create policy "sp program kendi delete" on public.sp_routines
  for delete using (auth.uid() = user_id);

create index if not exists sp_routines_user_idx on public.sp_routines (user_id);
