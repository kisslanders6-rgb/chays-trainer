-- ═══════════════════════════════════════════════════════════════════════════
--  Chays Trainer — schéma Supabase
--  À coller dans : Supabase → SQL Editor → New query → Run.   Rejouable sans risque.
--
--  Une ligne = un « document » synchronisé (une clé de stockage : openingDB_Général_w, …).
--  Sécurité : chaque utilisateur ne voit et ne modifie QUE ses lignes (RLS).
--  Concurrence : `version` est incrémentée par le SERVEUR à chaque mise à jour ; le client écrit
--  « WHERE version = <celle que j'ai vue> » : si quelqu'un est passé avant, 0 ligne modifiée = conflit.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.documents (
    user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
    key        text        not null,
    data       jsonb       not null,
    version    bigint      not null default 1,
    updated_at timestamptz not null default now(),
    device     text,
    primary key (user_id, key),
    constraint documents_key_len  check (char_length(key) between 1 and 300),
    constraint documents_data_len check (octet_length(data::text) <= 4000000)
);

-- Droits : jamais d'accès anonyme ; connecté = uniquement via les règles RLS ci-dessous.
revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

alter table public.documents enable row level security;

drop policy if exists documents_select_own on public.documents;
drop policy if exists documents_insert_own on public.documents;
drop policy if exists documents_update_own on public.documents;
drop policy if exists documents_delete_own on public.documents;

create policy documents_select_own on public.documents for select to authenticated
    using (auth.uid() = user_id);
create policy documents_insert_own on public.documents for insert to authenticated
    with check (auth.uid() = user_id);
create policy documents_update_own on public.documents for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy documents_delete_own on public.documents for delete to authenticated
    using (auth.uid() = user_id);

-- Versionnage côté serveur : le client ne peut ni tricher sur la version, ni changer de clé / de propriétaire.
create or replace function public.documents_bump() returns trigger
language plpgsql as $$
begin
    new.user_id    := old.user_id;
    new.key        := old.key;
    new.version    := old.version + 1;
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists documents_bump on public.documents;
create trigger documents_bump before update on public.documents
    for each row execute function public.documents_bump();
