PRAGMA foreign_keys = ON;

-- Corrective migration for any partial 0138/0139 production state. The deployment
-- bootstrap rewrites this still-unapplied migration from remote schema metadata when
-- 0138 is already recorded, adding only genuinely missing columns before these drops.
DROP TRIGGER IF EXISTS trg_snapshot_published_checklist_after_run;
DROP TRIGGER IF EXISTS trg_block_legacy_items_for_versioned_checklist;
DROP TRIGGER IF EXISTS trg_validate_versioned_checklist_answer;
DROP TRIGGER IF EXISTS trg_keep_required_checklist_photo_after_answer;
