-- ═══════════════════════════════════════════════════════════════════════════
--  Chays Trainer — schéma Supabase
--  À coller dans : Supabase → SQL Editor → New query → Run.   Rejouable sans risque.
--
--  Une ligne = un « document » synchronisé (une clé de stockage : openingDB_Général_w, …).
--  Sécurité : chaque utilisateur ne voit et ne modifie QUE ses lignes (RLS).
--  Concurrence : `version` est incrémentée par le SERVEUR à chaque mise à jour ; le client écrit
--  « WHERE version = <celle que j'ai vue> » : si quelqu'un est passé avant, 0 ligne modifiée = conflit.
--  Quota : 500 documents et 20 Mo par compte. Suppression de compte : fonction delete_my_account().
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

-- Droits : jamais d'accès anonyme ; connecté = lire / créer / modifier / supprimer, via les règles RLS
-- ci-dessous (pas de TRUNCATE, TRIGGER ni REFERENCES : TRUNCATE ignorerait les règles RLS).
revoke all on public.documents from anon, authenticated;
grant select, insert, update, delete on public.documents to authenticated;

alter table public.documents enable row level security;

-- (select auth.uid()) : évalué une fois par requête, pas une fois par ligne.
drop policy if exists documents_select_own on public.documents;
drop policy if exists documents_insert_own on public.documents;
drop policy if exists documents_update_own on public.documents;
drop policy if exists documents_delete_own on public.documents;

create policy documents_select_own on public.documents for select to authenticated
    using ((select auth.uid()) = user_id);
create policy documents_insert_own on public.documents for insert to authenticated
    with check ((select auth.uid()) = user_id);
create policy documents_update_own on public.documents for update to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy documents_delete_own on public.documents for delete to authenticated
    using ((select auth.uid()) = user_id);

-- Versionnage côté serveur : le client ne peut ni tricher sur la version, ni changer de clé / de propriétaire.
create or replace function public.documents_bump() returns trigger
language plpgsql set search_path = '' as $$
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

-- Quota par compte (empêche un compte de remplir la base) : le client affiche « Limite du compte atteinte ».
create or replace function public.documents_quota() returns trigger
language plpgsql set search_path = '' as $$
declare
    n     bigint;
    total bigint;
begin
    select count(*), coalesce(sum(octet_length(d.data::text)), 0) into n, total
      from public.documents d
     where d.user_id = new.user_id and d.key <> new.key;
    if tg_op = 'INSERT' and n >= 500 then
        raise exception 'quota_documents' using errcode = 'P0001', hint = 'Limite de 500 documents par compte.';
    end if;
    if total + octet_length(new.data::text) > 20000000 then
        raise exception 'quota_size' using errcode = 'P0001', hint = 'Limite de 20 Mo par compte.';
    end if;
    return new;
end $$;

drop trigger if exists documents_quota on public.documents;
create trigger documents_quota before insert or update of data on public.documents
    for each row execute function public.documents_quota();

revoke all on function public.documents_bump()  from public, anon, authenticated;
revoke all on function public.documents_quota() from public, anon, authenticated;

-- Suppression de son propre compte (« Supprimer mon compte » dans l'application) :
-- l'utilisateur et, par cascade, tous ses documents. Seul un utilisateur connecté peut l'appeler, pour lui-même.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;
    -- Photos de profil (dossier {uid}/ du seau « avatars ») : l'application les supprime d'abord par l'API de stockage ;
    -- ce filet ne doit jamais empêcher la suppression du compte (certaines versions refusent l'écriture directe).
    begin
        delete from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = uid::text;
    exception when others then null;
    end;
    delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ─── Photos de profil (avatarPhoto.js) ─────────────────────────────────────────
-- Seau PRIVÉ « avatars » : une image WebP de 256 px par utilisateur, chemin {uid}/avatar-{horodatage}.webp.
-- Chacun ne lit, n'écrit et ne supprime que son propre dossier. À exécuter une fois dans l'éditeur SQL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 262144, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 262144, allowed_mime_types = array['image/webp'];

drop policy if exists "avatars : lire son dossier"      on storage.objects;
drop policy if exists "avatars : ajouter dans son dossier" on storage.objects;
drop policy if exists "avatars : remplacer dans son dossier" on storage.objects;
drop policy if exists "avatars : supprimer dans son dossier" on storage.objects;

create policy "avatars : lire son dossier" on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars : ajouter dans son dossier" on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars : remplacer dans son dossier" on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars : supprimer dans son dossier" on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
