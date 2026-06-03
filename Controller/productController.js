import { query } from '../config/db.js';
import { getS3PublicUrl } from '../config/s3.js';

/** Read a text column from a DB row (snake_case / camelCase). */
function pickTextField(row, ...keys) {
    if (!row || typeof row !== 'object') return '';
    for (const key of keys) {
        const raw = row[key];
        if (raw == null) continue;
        const text = String(raw).trim();
        if (text) return text;
    }
    return '';
}

/** Read discount from DB row (node-pg uses snake_case; tolerate camelCase). Null/empty → null; 0+ → number. */
function pickDiscountPercent(row) {
    if (!row || typeof row !== 'object') return null;
    const raw = row.discount_percent ?? row.discountPercent;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    return n;
}

/** DB column `sale_type`: 'order' | 'preorder' (tolerate pre-order, pre_order). */
function normalizeSaleType(raw) {
    const s = String(raw ?? 'order')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
    if (s === 'preorder' || s === 'pre_order') return 'preorder';
    return 'order';
}

function pushImageFromValue(out, value) {
    if (value == null) return;

    // Array/jsonb array
    if (Array.isArray(value)) {
        value.forEach((v) => pushImageFromValue(out, v));
        return;
    }

    // Json object like { url }, { key }, { path }
    if (typeof value === 'object') {
        const nested = value.url ?? value.image_url ?? value.key ?? value.path ?? value.src ?? null;
        if (nested != null) pushImageFromValue(out, nested);
        return;
    }

    const raw = String(value).trim();
    if (!raw || raw.toLowerCase() === 'null') return;

    // JSON string array/object
    if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
        try {
            const parsed = JSON.parse(raw);
            pushImageFromValue(out, parsed);
            return;
        } catch (_err) {
            // Fall through and treat as plain string
        }
    }

    // Comma-separated list
    if (raw.includes(',')) {
        raw
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => pushImageFromValue(out, part));
        return;
    }

    out.push(getS3PublicUrl(raw) || raw);
}

function toProductImages(imagesData) {
    if (!imagesData || typeof imagesData !== 'object') return [];

    // Explicit legacy schema support: image1..image8
    const explicitLegacyKeys = ['image1', 'image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8'];

    const keys = Object.keys(imagesData);
    const orderedNumericImageKeys = keys
        .filter((key) => /^image[_-]?\d+$/i.test(key))
        .sort((a, b) => {
            const aNum = Number(a.replace(/\D+/g, '')) || 0;
            const bNum = Number(b.replace(/\D+/g, '')) || 0;
            return aNum - bNum;
        });

    // Also support common alternate column names from legacy schemas.
    const fuzzyKeys = keys.filter((key) =>
        /(^|_)(image|img|photo|pic|thumbnail|banner|url|path|file)(_|$)/i.test(key),
    );

    const candidateKeys = [
        ...explicitLegacyKeys.filter((k) => Object.prototype.hasOwnProperty.call(imagesData, k)),
        ...orderedNumericImageKeys,
        ...fuzzyKeys.filter((k) => !orderedNumericImageKeys.includes(k)),
    ];

    const out = [];
    candidateKeys.forEach((key) => pushImageFromValue(out, imagesData[key]));

    // Preserve order, remove duplicates.
    return [...new Set(out)];
}

/** Format numeric measure for API (e.g. 200.0000 → "200"). */
function formatMeasureNumericDisplay(raw) {
    if (raw == null || raw === '') return '';
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw).trim();
    if (Number.isInteger(n)) return String(n);
    const s = parseFloat(n.toFixed(10)).toString();
    return s.replace(/\.?0+$/, '') || '0';
}

/**
 * Measurements live on `products` columns: product_measure_value, product_measure_unit (e.g. 200 + ml).
 */
function hasNumericMeasure(raw) {
    if (raw == null || raw === '') return false;
    if (typeof raw === 'string' && raw.trim() === '') return false;
    return Number.isFinite(Number(raw));
}

function measuresFromProductRow(row) {
    if (!row || typeof row !== 'object') return [];
    const rawVal = row.product_measure_value ?? row.productMeasureValue;
    const rawUnit = row.product_measure_unit ?? row.productMeasureUnit;
    const hasVal = hasNumericMeasure(rawVal);
    const unitName = rawUnit != null ? String(rawUnit).trim() : '';
    if (!hasVal && !unitName) return [];

    const valueStr = hasVal ? formatMeasureNumericDisplay(rawVal) : '';
    const label = [valueStr, unitName].filter(Boolean).join(' ').trim();
    return [
        {
            value: valueStr || (unitName ? '—' : ''),
            unit_name: unitName,
            unit_symbol: unitName,
            label: (label || unitName || valueStr || '—').trim(),
        },
    ];
}

/** Append subcategory / deity / planet / rarity / purpose filters for a SQL table alias. */
function appendAttributeFilters(alias, filters, params, startIdx) {
    const { subcategory, deity, planet, rarity, purpose } = filters;
    let sql = '';
    let idx = startIdx;

    if (subcategory && subcategory !== 'all') {
        sql += ` AND LOWER(TRIM(${alias}.subcategory)) = LOWER(TRIM($${idx}::text))`;
        params.push(subcategory);
        idx++;
    }
    if (deity && deity !== 'all') {
        sql += ` AND ${alias}.deity = $${idx}`;
        params.push(deity);
        idx++;
    }
    if (planet && planet !== 'all') {
        sql += ` AND ${alias}.planet = $${idx}`;
        params.push(planet);
        idx++;
    }
    if (rarity && rarity !== 'all') {
        sql += ` AND ${alias}.rarity = $${idx}`;
        params.push(rarity);
        idx++;
    }
    if (purpose && purpose !== 'all') {
        sql += ` AND EXISTS (
            SELECT 1
            FROM unnest(COALESCE(${alias}.purposes, ARRAY[]::text[])) AS purpose_token(token)
            WHERE LOWER(TRIM(purpose_token.token)) = LOWER(TRIM($${idx}::text))
        )`;
        params.push(String(purpose).trim());
        idx++;
    }

    return { sql, nextIdx: idx };
}

// Get products by category with filters
export const getProductsByCategory = async (req, res) => {
    try {
        const { category, subcategory, deity, planet, rarity, search, featured, purpose } = req.query;
        const listFilters = { subcategory, deity, planet, rarity, purpose };

        let categoryId = null;
        if (category) {
            const catRes = await query(
                'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)',
                [category],
            );
            if (catRes.rows.length === 0) {
                return res.status(200).json({ success: true, data: [] });
            }
            categoryId = catRes.rows[0].id;
        }

        let combosCategoryId = null;
        const categoryNameNorm = String(category || '').trim().toLowerCase();
        const includeLinkedCombos =
            categoryId != null && categoryNameNorm !== 'combos';
        if (includeLinkedCombos) {
            const combosCatRes = await query(
                'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)',
                ['Combos'],
            );
            if (combosCatRes.rows.length > 0) {
                combosCategoryId = combosCatRes.rows[0].id;
            }
        }

        let sql = `
            SELECT p.id, p.slug, p.name, p.description, p.short_description, p.price, p.stock_quantity,
                   p.category_id, p.subcategory, p.deity, p.benefits, p.purposes, p.planet, p.rarity, p.status, p.created_at,
                   p.discount_percent, p.is_featured, p.sale_type,
                   p.product_measure_value, p.product_measure_unit
            FROM products p
            WHERE p.status = 'active'
        `;
        const params = [];
        let idx = 1;

        if (categoryId != null) {
            if (includeLinkedCombos && combosCategoryId != null) {
                params.push(categoryId, combosCategoryId, String(category).trim());
                const categoryParam = idx;
                const combosParam = idx + 1;
                const categoryNameParam = idx + 2;
                const filterStartIdx = idx + 3;
                const directFilters = appendAttributeFilters('p', listFilters, params, filterStartIdx);

                sql += ` AND (
                    (p.category_id = $${categoryParam}${directFilters.sql})
                    OR (
                        p.category_id = $${combosParam}
                        AND EXISTS (
                            SELECT 1
                            FROM unnest(COALESCE(p.related_categories, ARRAY[]::text[])) AS rc(token)
                            WHERE LOWER(TRIM(rc.token)) = LOWER(TRIM($${categoryNameParam}::text))
                        )
                    )
                )`;
                idx = directFilters.nextIdx;
            } else {
                sql += ` AND p.category_id = $${idx}`;
                params.push(categoryId);
                idx++;
                const attr = appendAttributeFilters('p', listFilters, params, idx);
                sql += attr.sql;
                idx = attr.nextIdx;
            }
        } else {
            const attr = appendAttributeFilters('p', listFilters, params, idx);
            sql += attr.sql;
            idx = attr.nextIdx;
        }

        if (search) {
            const searchPattern = `%${search}%`;
            if (includeLinkedCombos && combosCategoryId != null && categoryId != null) {
                params.push(searchPattern, combosCategoryId, String(category).trim());
                const searchParam = idx;
                const combosParam = idx + 1;
                const categoryNameParam = idx + 2;
                sql += ` AND (
                    (p.name ILIKE $${searchParam} OR p.description ILIKE $${searchParam})
                    OR (
                        p.category_id = $${combosParam}
                        AND EXISTS (
                            SELECT 1
                            FROM unnest(COALESCE(p.related_categories, ARRAY[]::text[])) AS rc(token)
                            WHERE LOWER(TRIM(rc.token)) = LOWER(TRIM($${categoryNameParam}::text))
                        )
                        AND (p.name ILIKE $${searchParam} OR p.description ILIKE $${searchParam})
                    )
                )`;
                idx += 3;
            } else {
                sql += ` AND (p.name ILIKE $${idx} OR p.description ILIKE $${idx})`;
                params.push(searchPattern);
                idx++;
            }
        }
        if (featured !== undefined) {
            const featuredValue = String(featured).toLowerCase() === 'true';
            sql += ` AND p.is_featured = $${idx}`;
            params.push(featuredValue);
            idx++;
        }

        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = parseInt(req.query.offset, 10) || 0;
        sql += ` ORDER BY p.created_at ASC LIMIT $${idx} OFFSET $${idx + 1}`;
        params.push(limit, offset);

        const productsRes = await query(sql, params);
        const products = productsRes.rows || [];

        let productImagesMap = {};
        if (products.length > 0) {
            const ids = products.map((p) => p.id);
            const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
            const imgRes = await query(
                `SELECT * FROM product_images WHERE product_id IN (${placeholders})`,
                ids,
            );
            (imgRes.rows || []).forEach((img) => {
                if (!productImagesMap[img.product_id]) productImagesMap[img.product_id] = [];
                toProductImages(img).forEach((url) => productImagesMap[img.product_id].push(url));
            });
        }

        const transformedProducts = products.map((product) => ({
            id: product.id,
            slug: product.slug || null,
            name: product.name,
            description: product.description,
            short_description: product.short_description || '',
            price: parseFloat(product.price),
            stock: product.stock_quantity,
            subcategory: product.subcategory || '',
            deity: product.deity || '',
            benefits: product.benefits || '',
            purposes: Array.isArray(product.purposes) ? product.purposes : [],
            planet: product.planet || '',
            rarity: product.rarity || '',
            discount_percent: pickDiscountPercent(product),
            is_featured: product.is_featured ?? false,
            sale_type: normalizeSaleType(product.sale_type),
            images: productImagesMap[product.id] || [],
            measures: measuresFromProductRow(product),
        }));

        res.status(200).json({ success: true, data: transformedProducts });
    } catch (error) {
        console.error('[getProductsByCategory]', error?.message || error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
};

// Get unique filter values for a category
export const getFilterOptions = async (req, res) => {
    try {
        const { category } = req.query;
        if (!category) {
            return res.status(400).json({
                success: false,
                error: 'Category parameter is required',
            });
        }

        const catRes = await query(
            'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)',
            [category],
        );
        if (catRes.rows.length === 0) {
            return res.status(200).json({
                success: true,
                data: { subcategories: [], deities: [], planets: [], rarities: [], purposes: [] },
            });
        }

        const catId = catRes.rows[0].id;
        const prodsRes = await query(
            'SELECT subcategory, deity, planet, rarity, purposes FROM products WHERE category_id = $1 AND status = $2',
            [catId, 'active'],
        );
        const products = prodsRes.rows || [];

        const subcategories = [...new Set(products.map((p) => p.subcategory).filter(Boolean))].sort();
        const deities = [...new Set(products.map((p) => p.deity).filter(Boolean))].sort();
        const planets = [...new Set(products.map((p) => p.planet).filter(Boolean))].sort();
        const rarities = [...new Set(products.map((p) => p.rarity).filter(Boolean))].sort();
        const purposes = [
            ...new Set(
                products
                    .flatMap((p) => (Array.isArray(p.purposes) ? p.purposes : []))
                    .map((value) => String(value).trim())
                    .filter(Boolean),
            ),
        ].sort();

        res.status(200).json({
            success: true,
            data: { subcategories, deities, planets, rarities, purposes },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
};

// Get single product by slug
export const getProductBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        if (!slug) {
            return res.status(400).json({
                success: false,
                error: 'Product slug is required',
            });
        }

        const productRes = await query(
            `SELECT id, slug, name, description, short_description, price, stock_quantity,
                    category_id, subcategory, deity, benefits, elements, purposes, planet, rarity, status, created_at,
                    discount_percent, is_featured, sale_type,
                    product_measure_value, product_measure_unit, who_can_use
             FROM products WHERE slug = $1 AND status = 'active'`,
            [slug],
        );
        const product = productRes.rows[0];
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const imgRes = await query(
            'SELECT * FROM product_images WHERE product_id = $1',
            [product.id],
        );
        const images = (imgRes.rows || []).flatMap((row) => toProductImages(row));

        let categoryName = '';
        if (product.category_id) {
            const catRes = await query('SELECT name FROM categories WHERE id = $1', [
                product.category_id,
            ]);
            if (catRes.rows[0]) categoryName = catRes.rows[0].name;
        }

        res.status(200).json({
            success: true,
            data: {
                id: product.id,
                slug: product.slug || null,
                name: product.name,
                description: product.description,
                short_description: product.short_description || '',
                price: parseFloat(product.price),
                stock: product.stock_quantity,
                category: categoryName,
                subcategory: product.subcategory || '',
                deity: product.deity || '',
                benefits: pickTextField(product, 'benefits', 'Benefits'),
                elements: pickTextField(product, 'elements', 'Elements'),
                purposes: Array.isArray(product.purposes) ? product.purposes : [],
                planet: product.planet || '',
                rarity: product.rarity || '',
                discount_percent: pickDiscountPercent(product),
                is_featured: product.is_featured ?? false,
                sale_type: normalizeSaleType(product.sale_type),
                images,
                measures: measuresFromProductRow(product),
                who_can_use: pickTextField(product, 'who_can_use', 'whoCanUse', 'WhoCanUse'),
            },
        });
    } catch (error) {
        console.error('[getProductBySlug]', error?.message || error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
};

// Get unique purposes (for homepage shop by purpose section)
export const getPurposes = async (_req, res) => {
    try {
        const purposesRes = await query(
            `SELECT DISTINCT TRIM(purpose_token) AS purpose
             FROM products
             CROSS JOIN LATERAL unnest(COALESCE(purposes, ARRAY[]::text[])) AS purpose_token
             WHERE status = 'active'
               AND TRIM(purpose_token) <> ''
             ORDER BY purpose ASC`,
            [],
        );

        const rawPurposes = (purposesRes.rows || [])
            .map((row) => row.purpose)
            .filter(Boolean);

        const seen = new Set();
        const purposes = [];

        rawPurposes.forEach((part) => {
            const normalized = String(part).trim();
            if (!normalized) return;
            const key = normalized.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                purposes.push(normalized);
            }
        });

        purposes.sort((a, b) => a.localeCompare(b));

        res.status(200).json({
            success: true,
            data: purposes,
        });
    } catch (error) {
        console.error('[getPurposes]', error?.message || error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
};
