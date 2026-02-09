import express from 'express';
import {
    getReviewsByProduct,
    addReview,
    deleteReview
} from '../Controller/reviewController.js';

const router = express.Router({ mergeParams: false });

router.get('/product/:productId', getReviewsByProduct);
router.post('/', addReview);
router.delete('/:id', deleteReview);

export default router;
