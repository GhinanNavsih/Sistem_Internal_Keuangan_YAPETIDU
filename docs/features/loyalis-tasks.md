# Tugas Loyalis

## Tugas Loyalis (to-do tasks for individual Loyalis)

Super Admin gives a Loyalis a task at `/dashboard/tugas` (Sidebar: Tugas Loyalis); the Loyalis works through their own at `/employee/tugas` (menu: Daftar Tugas) and marks each completed. Rules are pure and tested in `src/lib/loyalisTasks.ts`; the service is `src/lib/server/loyalisTasks.ts` behind `/api/loyalis-tasks` (Super Admin: GET, POST, PUT/DELETE `[id]`) and `/api/employee/tasks` (Loyalis: GET, `?countOnly=true`, PATCH `[id]`).

- **Who sees the page.** Only a Loyalis with at least one task, **completed ones included**; the link goes away only if Super Admin deletes all of their tasks. Three layers enforce it, because `ProtectedRoute` is client-only: the menu item (`useLoyalisTasksSummary`, asks `/api/employee/tasks?countOnly=true`), the page (sends a Loyalis with no tasks to `/employee/payslip`) and the API (role `loyalis`, tasks matched on the account's `linkedEmployeeId`; someone else's task answers 404).
- **Keyed by employee, not login.** `LoyalisTasks.assigneeEmployeeId` is the `Employees_Loyalis` id, so a task follows the person across the accounts they switch between (`docs/features/account-switching.md`); only the `loyalis` account sees it. A new task needs an active (`AKTIF`) Loyalis; the assignee cannot be changed afterwards, give a new task instead.
- **Fields.** Title (required, 120), description (optional, 2000), due date (optional `YYYY-MM-DD`, not in the past when set; an overdue task keeps its own date when edited). Status is stored, `open` or `completed`, with `completedAt`/`completedByUid` set on completion and cleared on reopen. A request for the status a task already has changes nothing.
- **Who may do what.** Super Admin gives, edits, reopens and deletes (`LOYALIS_TASK_ASSIGNER_ROLES`). The Loyalis completes or reopens their own. Not financial, so there is no `requestId` or `FinancialAuditLogs` entry; status changes run in a transaction.
- **Server-only.** `LoyalisTasks` is `allow read, write: if false` in `Current_Firestore_Rules.md`. Per-Loyalis lists filter on one field and sort in code, so no composite index is needed.
- **Test**: `npm run test:loyalis-tasks:integration` (Auth + Firestore emulators, project `demo-loyalis-tasks`; needs Java).
