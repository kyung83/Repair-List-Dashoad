# Technician repair review corrections

The Review Before Finishing panel is the technician-facing source of truth for saved notes, applied parts, labor, outstanding parts, and checklist results.

Assigned technicians can correct mistaken applied parts on open repairs and edit their own saved repair notes. Part reversals return stock to the recorded warehouse; older part rows without a warehouse link are returned to the repair yard when that yard can be resolved. Managers and admins can edit repair notes as correction reviewers. All note edits and part reversals retain an audit event in `repair_job_events` / `part_lifecycle_events`.
