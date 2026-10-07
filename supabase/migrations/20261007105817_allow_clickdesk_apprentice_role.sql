alter table public.clickdesk_chat_analyst_links
  drop constraint if exists clickdesk_chat_analyst_links_person_role_check;

alter table public.clickdesk_chat_analyst_links
  add constraint clickdesk_chat_analyst_links_person_role_check
  check (person_role = any (array[
    'analyst'::text,
    'management'::text,
    'unmapped'::text,
    'apprentice'::text
  ]));

alter table public.clickdesk_chat_attendances
  drop constraint if exists clickdesk_chat_attendances_identity_role_check;

alter table public.clickdesk_chat_attendances
  add constraint clickdesk_chat_attendances_identity_role_check
  check (identity_role = any (array[
    'analyst'::text,
    'management'::text,
    'unmapped'::text,
    'apprentice'::text
  ]));
