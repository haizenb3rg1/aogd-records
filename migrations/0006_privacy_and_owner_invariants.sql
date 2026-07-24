-- Existing presence rows were created under an opt-out default.
-- Require every staff member to opt in again after this privacy hardening.
UPDATE staff_presence SET visible = 0;

CREATE TRIGGER IF NOT EXISTS staff_preserve_last_owner
BEFORE DELETE ON staff_assignments
WHEN OLD.role_slug = 'owner'
  AND (SELECT COUNT(*) FROM staff_assignments WHERE role_slug = 'owner') <= 1
BEGIN
  SELECT RAISE(ABORT, 'last_owner');
END;
