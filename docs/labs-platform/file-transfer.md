# Moving files between the laptop and the lab

- **Download:** `GET /api/playgrounds/:id/download[?path=...][&heavy=1]`. No path = whole project as a
  zip; a folder = that folder as a zip; a file = the raw file (binary-safe). `node_modules`, `.git`,
  `.svelte-kit`, `.next`, `.cache`, `__pycache__`, `.venv` and OS junk are left out unless `heavy=1`.
- **Upload:** `POST /api/playgrounds/:id/upload[?dest=folder][&extract=1]`, multipart with repeated
  `files` + parallel `paths`. A lone `.zip` is extracted. Browser side: `apps/web/src/lib/transfer.ts`
  (drag-and-drop, folder picker, zip detection) so any UI can reuse it.
- **Caps** (env-tunable in `images/base-lab/lab-transfer`): 5000 files, 100 MB per upload, 25 MB per
  file, 1 GB workspace (counted on upload only). Zip bombs are caught by counting real bytes.
- **Safety:** every path is resolved and must stay inside the workspace; `..`, absolute paths and
  zip symlinks are refused or skipped. In the Docker driver it all runs inside the learner's container.
- **Not done:** a hard per-workspace disk quota (an agent running `npm install` can still fill the
  disk). On the VPS use an XFS project quota / a size-limited volume for `/home/student`; see RUNBOOK.
- **Not planned:** live sync with a laptop folder (Chrome/Edge only, conflict-prone). For git, use the
  lab terminal.
