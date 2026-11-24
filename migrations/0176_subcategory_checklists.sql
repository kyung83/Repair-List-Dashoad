-- Keep all existing checklist templates, runs, and answers.
-- A subcategory inherits its parent's checklist until explicitly configured.
ALTER TABLE repair_type_subcategories ADD COLUMN checklist_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(checklist_mode IN ('inherit','none','optional','required'));
ALTER TABLE repair_type_checklist_templates ADD COLUMN repair_subcategory_id INTEGER REFERENCES repair_type_subcategories(id) ON DELETE RESTRICT;
DROP INDEX IF EXISTS idx_repair_type_checklist_template_active;
CREATE UNIQUE INDEX idx_repair_type_checklist_template_active ON repair_type_checklist_templates(repair_type_id) WHERE active=1 AND repair_subcategory_id IS NULL;
CREATE UNIQUE INDEX idx_repair_subcategory_checklist_template_active ON repair_type_checklist_templates(repair_subcategory_id) WHERE active=1 AND repair_subcategory_id IS NOT NULL;
CREATE INDEX idx_repair_subcategory_checklist_versions ON repair_type_checklist_templates(repair_subcategory_id,version);
CREATE TRIGGER repair_subcategory_checklist_template_parent_guard
BEFORE INSERT ON repair_type_checklist_templates
WHEN NEW.repair_subcategory_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM repair_type_subcategories s WHERE s.id=NEW.repair_subcategory_id AND s.repair_type_id=NEW.repair_type_id
)
BEGIN
 SELECT RAISE(ABORT,'Checklist subcategory must belong to its Repair Type.');
END;
CREATE TRIGGER repair_checklist_template_scope_immutable
BEFORE UPDATE OF repair_subcategory_id,repair_type_id ON repair_type_checklist_templates
WHEN NEW.repair_subcategory_id IS NOT OLD.repair_subcategory_id OR NEW.repair_type_id IS NOT OLD.repair_type_id
BEGIN
 SELECT RAISE(ABORT,'Checklist template scope cannot change.');
END;
-- A started inspection remains pinned to its original template. Existing runs
-- predating this feature may still fill in a previously blank subcategory.
CREATE TRIGGER repair_subcategory_checklist_started_lock
BEFORE UPDATE OF repair_subcategory_id ON repairs
WHEN OLD.repair_subcategory_id IS NOT NULL
 AND NEW.repair_subcategory_id IS NOT OLD.repair_subcategory_id
 AND EXISTS(SELECT 1 FROM repair_type_checklist_runs cr WHERE cr.repair_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'Subcategory cannot change after its checklist has started.');
END;
