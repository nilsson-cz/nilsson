-- Fix: staff_can_access_student kontrolovala gm.valid_to IS NULL
-- coz odfiltrovala zaky s valid_to = 2026-08-31 (konec skolniho roku)
-- Oprava: platne clenstvı = valid_to IS NULL OR valid_to >= CURRENT_DATE

CREATE OR REPLACE FUNCTION public.staff_can_access_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM staff_groups sg
      JOIN group_memberships gm ON gm.group_id = sg.group_id
     WHERE sg.staff_id    = current_staff_id()
       AND gm.student_id  = p_student_id
       AND (sg.valid_to IS NULL OR sg.valid_to >= CURRENT_DATE)
       AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
  );
$function$;
