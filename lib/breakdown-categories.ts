export type BreakdownSubcategoryConfig = {
  id: number;
  categoryId: number;
  name: string;
  active: boolean;
  sortOrder: number;
};

export type BreakdownCategoryConfig = {
  id: number;
  name: string;
  requiresPosition: boolean;
  requiresTireSize: boolean;
  active: boolean;
  sortOrder: number;
  subcategories: BreakdownSubcategoryConfig[];
};

type CategoryRow = {
  id: number;
  name: string;
  requires_position: number;
  requires_tire_size: number;
  active: number;
  sort_order: number;
};

type SubcategoryRow = {
  id: number;
  category_id: number;
  name: string;
  active: number;
  sort_order: number;
};

export async function listBreakdownCategoryConfigs(db: D1Database, includeInactive = false) {
  const categories = await db.prepare(`
    SELECT id,name,requires_position,requires_tire_size,active,sort_order
    FROM breakdown_categories
    ${includeInactive ? '' : 'WHERE active=1'}
    ORDER BY sort_order,name COLLATE NOCASE
  `).all<CategoryRow>();

  const subcategories = await db.prepare(`
    SELECT id,category_id,name,active,sort_order
    FROM breakdown_subcategories
    ${includeInactive ? '' : 'WHERE active=1'}
    ORDER BY sort_order,name COLLATE NOCASE
  `).all<SubcategoryRow>();

  const byCategory = new Map<number, BreakdownSubcategoryConfig[]>();
  for (const row of subcategories.results) {
    const list = byCategory.get(row.category_id) || [];
    list.push({
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      active: Boolean(row.active),
      sortOrder: row.sort_order,
    });
    byCategory.set(row.category_id, list);
  }

  return categories.results.map((row): BreakdownCategoryConfig => ({
    id: row.id,
    name: row.name,
    requiresPosition: Boolean(row.requires_position),
    requiresTireSize: Boolean(row.requires_tire_size),
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    subcategories: byCategory.get(row.id) || [],
  }));
}

export async function validateBreakdownCategorySelection(
  db: D1Database,
  categoryName: string,
  subcategoryName = '',
  requireSubcategory = true,
) {
  const category = await db.prepare(`
    SELECT id,name,requires_position,requires_tire_size,active,sort_order
    FROM breakdown_categories
    WHERE name=? COLLATE NOCASE AND active=1
  `).bind(categoryName.trim()).first<CategoryRow>();
  if (!category) throw new Error('Choose a valid breakdown category.');

  const activeSubs = await db.prepare(`
    SELECT id,category_id,name,active,sort_order
    FROM breakdown_subcategories
    WHERE category_id=? AND active=1
    ORDER BY sort_order,name COLLATE NOCASE
  `).bind(category.id).all<SubcategoryRow>();

  const submittedSub = subcategoryName.trim();
  let subcategory = '';
  if (submittedSub) {
    const match = activeSubs.results.find((row) => row.name.toLowerCase() === submittedSub.toLowerCase());
    if (!match) throw new Error(`Choose a valid ${category.name} issue.`);
    subcategory = match.name;
  } else if (requireSubcategory && activeSubs.results.length) {
    throw new Error(`Choose an ${category.name} issue.`);
  }

  return {
    id: category.id,
    name: category.name,
    requiresPosition: Boolean(category.requires_position),
    requiresTireSize: Boolean(category.requires_tire_size),
    subcategory,
  };
}
