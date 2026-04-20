import express from 'express';
import { createPreorder } from '../Controller/preorderController.js';
import { optionalAuthenticate } from '../Middleware/authMiddleware.js';

const router = express.Router();

router.post('/', optionalAuthenticate, createPreorder);

export default router;
