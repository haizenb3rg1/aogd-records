# Role permissions

Administrative access is enforced by Cloudflare Pages Functions. Hiding a button
in React is only a usability feature and is never treated as authorization.

## Model

- `permissions` is the canonical catalog of supported actions.
- `role_permissions` assigns catalog entries to a role and records who granted
  them.
- `staff_assignments` assigns one or more roles to an account.
- Effective permissions are the union of every assigned role.
- `owner` is a server-side invariant with the wildcard permission `*`. Its
  permissions cannot be edited, it cannot be deleted, and the database prevents
  removal of the final Owner.

Every protected Function calls `requirePermission()` before reading private data
or mutating state. An authenticated staff account without the required
permission receives HTTP 403.

## Escalation controls

- Staff cannot change their own role assignments.
- Non-Owner staff cannot edit a role assigned to themselves.
- A staff member cannot assign a permission they do not already possess.
- Dangerous permissions can only be granted by Owner.
- Only Owner can assign or remove the `owner` role.
- System roles cannot be deleted.
- Role changes, permission changes, account state changes, and assignments are
  written to `admin_audit_log`.

## Production migration

Run from a clean checkout of the deployed commit:

```powershell
corepack pnpm exec wrangler d1 migrations apply aogd-records-db --remote
```

Before applying, create a D1 Time Travel bookmark in the Cloudflare dashboard.
After applying, verify the schema:

```sql
SELECT COUNT(*) AS permissions FROM permissions;
SELECT role_slug, COUNT(*) AS permissions
FROM role_permissions
GROUP BY role_slug
ORDER BY role_slug;
```

The first query must return `33`.

## Verification

```powershell
corepack pnpm test:security
corepack pnpm run build
corepack pnpm test:runtime
corepack pnpm audit --audit-level high
```
