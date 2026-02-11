import express from 'express';
import { createPreorders, getAllPreorders } from '../Controller/preorderController.js';

const router = express.Router();

router.post('/', createPreorders);
router.get('/', getAllPreorders);

export default router;
