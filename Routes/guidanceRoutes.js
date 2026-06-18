import express from 'express';
import { optionalAuthenticate } from '../Middleware/authMiddleware.js';
import { createGuidanceRequest, listGuidanceCategories } from '../Controller/guidanceController.js';

const router = express.Router();

router.get('/categories', listGuidanceCategories);
router.post('/', optionalAuthenticate, createGuidanceRequest);

export default router;
