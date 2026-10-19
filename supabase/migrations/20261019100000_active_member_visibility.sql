-- Former members no longer see a relationship after it ends.
-- The app reads relationships only through SECURITY DEFINER functions
-- (get_my_relationship and friends), so only direct table reads change:
-- before, anyone who had ever been a member could list the ended
-- relationship and its member ids. Now only active members can.

drop policy if exists "Members can view their relationships" on public.relationships;
drop policy if exists "Members can view relationship members" on public.relationship_members;

create policy "Active members can view their relationship"
  on public.relationships for select to authenticated
  using (public.is_active_member(relationships.id));

create policy "Active members can view relationship members"
  on public.relationship_members for select to authenticated
  using (public.is_active_member(relationship_members.relationship_id));
