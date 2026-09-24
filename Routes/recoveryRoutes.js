import express from 'express';
import { optionalAuthenticate } from '../Middleware/authMiddleware.js';
import { upsertAbandonedCart } from '../Controller/recoveryController.js';

const router = express.Router();

router.post('/abandoned-carts', optionalAuthenticate, upsertAbandonedCart);

export default router;
