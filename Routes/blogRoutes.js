import express from 'express';
import { getBlogPostBySlug, getBlogPosts } from '../Controller/blogController.js';

const router = express.Router();

router.get('/:slug', getBlogPostBySlug);
router.get('/', getBlogPosts);

export default router;
