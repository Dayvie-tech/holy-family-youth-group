-- The appointments table already has narrow RLS policies for reviewing pending claims
-- and ending verified appointments. Grant the table-level UPDATE privilege so those
-- policies can govern the two approved update paths.
grant update on public.appointments to authenticated;
