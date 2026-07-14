import express from 'express';
import { listPublicDeliveryCharges } from '../utils/deliveryCharges.js';

const router = express.Router();

router.get('/', listPublicDeliveryCharges);

export default router;
