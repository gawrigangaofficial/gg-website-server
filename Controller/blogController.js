import { query } from '../config/db.js';

const DEFAULT_HERO_IMAGE = 'https://via.placeholder.com/1200x630?text=Gawri+Ganga+Blog';

function normalizeBlogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt || '',
    html_content: row.html_content || '',
    hero_image_url: row.hero_image_url || row.header_image_url || DEFAULT_HERO_IMAGE,
    header_image_url: row.header_image_url || row.hero_image_url || DEFAULT_HERO_IMAGE,
    primary_link_label: row.primary_link_label || '',
    primary_link_url: row.primary_link_url || '',
    is_published: Boolean(row.is_published),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const getBlogPosts = async (req, res) => {
  try {
    const includeDrafts = String(req.query.include_drafts || '').toLowerCase() === 'true';
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : null;

    const whereClause = includeDrafts ? '' : 'WHERE is_published = TRUE';
    const limitClause = limit ? `LIMIT ${limit}` : '';

    const result = await query(
      `SELECT id, title, slug, excerpt, html_content, hero_image_url, header_image_url,
              primary_link_label, primary_link_url, is_published, published_at, created_at, updated_at
       FROM blog_posts
       ${whereClause}
       ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
       ${limitClause}`,
    );

    const posts = (result.rows || []).map(normalizeBlogRow);
    return res.json({ success: true, data: posts });
  } catch (_error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch blog posts' });
  }
};

export const getBlogPostBySlug = async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Blog slug is required' });
    }

    const includeDrafts = String(req.query.include_drafts || '').toLowerCase() === 'true';
    const result = await query(
      `SELECT id, title, slug, excerpt, html_content, hero_image_url, header_image_url,
              primary_link_label, primary_link_url, is_published, published_at, created_at, updated_at
       FROM blog_posts
       WHERE LOWER(slug) = $1
         ${includeDrafts ? '' : 'AND is_published = TRUE'}
       LIMIT 1`,
      [slug],
    );

    const post = normalizeBlogRow(result.rows?.[0]);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Blog post not found' });
    }
    return res.json({ success: true, data: post });
  } catch (_error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch blog post' });
  }
};
