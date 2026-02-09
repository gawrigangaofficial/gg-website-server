import supabase from '../config/supabaseClient.js';

/**
 * GET /api/reviews/product/:productId
 * Returns all reviews for a product, ordered by created_at desc.
 */
export const getReviewsByProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        if (!productId) {
            return res.status(400).json({ success: false, message: 'Product ID is required' });
        }

        const { data, error } = await supabase
            .from('reviews')
            .select('id, product_id, user_id, reviewer_name, rating, comment, image_url, verified, created_at')
            .eq('product_id', productId)
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch reviews',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (err) {
        console.error('getReviewsByProduct:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: err.message
        });
    }
};

/**
 * POST /api/reviews
 * Body: { product_id, user_id? (optional), reviewer_name, rating, comment?, image_url? }
 * Adds a review. user_id required if you want the user to be able to delete it later.
 */
export const addReview = async (req, res) => {
    try {
        const body = req.body || {};
        const { product_id, user_id, reviewer_name, rating, comment, image_url } = body;

        if (!product_id || !reviewer_name || rating == null || rating === '') {
            return res.status(400).json({
                success: false,
                message: 'product_id, reviewer_name, and rating are required'
            });
        }

        const r = Number(rating);
        if (!Number.isInteger(r) || r < 1 || r > 5) {
            return res.status(400).json({
                success: false,
                message: 'rating must be an integer between 1 and 5'
            });
        }

        const row = {
            product_id: product_id,
            reviewer_name: String(reviewer_name).trim(),
            rating: r,
            comment: comment ? String(comment).trim() : null,
            image_url: image_url ? String(image_url).trim() : null,
            verified: false,
            user_id: user_id || null
        };

        const { data, error } = await supabase
            .from('reviews')
            .insert([row])
            .select()
            .single();

        if (error) {
            console.error('addReview Supabase error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to add review',
                error: error.message,
                code: error.code
            });
        }

        res.status(201).json({
            success: true,
            message: 'Review added',
            data
        });
    } catch (err) {
        console.error('addReview:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: err.message,
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
        });
    }
};

/**
 * DELETE /api/reviews/:id
 * Body: { user_id } – user can only delete their own review (where review.user_id === user_id).
 */
export const deleteReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { user_id } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Review ID is required' });
        }

        const { data: existing, error: fetchError } = await supabase
            .from('reviews')
            .select('id, user_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch review',
                error: fetchError.message
            });
        }

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        if (existing.user_id != null && user_id !== existing.user_id) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own review'
            });
        }

        const { error: deleteError } = await supabase
            .from('reviews')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete review',
                error: deleteError.message
            });
        }

        res.status(200).json({
            success: true,
            message: 'Review deleted'
        });
    } catch (err) {
        console.error('deleteReview:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: err.message
        });
    }
}
