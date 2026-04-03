import express from 'express';
import { authenticate } from '../Middleware/authMiddleware.js';
import {
  getActiveCampaigns,
  checkEligibility,
  awardCampaign,
  getWalletBalance,
  getWalletTransactions,
} from '../Controller/cashbackController.js';

const router = express.Router();

router.get('/cashback-campaigns/active', getActiveCampaigns);
router.post('/cashback-campaigns/:id/eligibility', authenticate, checkEligibility);
router.post('/cashback-campaigns/:id/award', authenticate, awardCampaign);
router.get('/wallet/balance', authenticate, getWalletBalance);
router.get('/wallet/transactions', authenticate, getWalletTransactions);

export default router;
