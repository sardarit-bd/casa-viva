import express from 'express';
import {
    createLease,
    reviewApplication,
    createOrUpdateDraft,
    sendToTenant,
    tenantReviewLease,
    signLease,
    scheduleMoveInInspection,
    conductMoveInInspection,
    giveNotice,
    respondToRenewal,
    scheduleMoveOutInspection,
    processDepositReturn,
    requestChanges,
    updateLease,
    getMyLeases,
    getLeaseById,
    cancelLease,
    getLeaseStats,
    deleteLease,
    restoreLease,
    sendToLandlordForSignature
} from './lease.controller.js'
import { checkAuth } from '../../middlewares/checkAuth.js';
import { Role } from '../auth/auth.model.js';

const router = express.Router();

// ================= PUBLIC/COMMON ROUTES =================

// Get leases for current user
router.get('/my-leases', 
    checkAuth(Role.OWNER, Role.TENANT, Role.ADMIN, Role.SUPER_ADMIN), 
    getMyLeases
);

// Get lease statistics
router.get('/stats', 
    checkAuth(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.TENANT), 
    getLeaseStats
);

// ================= LEASE CREATION =================

// Tenant applies for property
router.post(
    '/',
    checkAuth(Role.TENANT),
    createLease
);

// ================= APPLICATION PHASE =================

// Landlord reviews application
router.post(
    '/:leaseId/review-application',
    checkAuth(Role.OWNER),
    reviewApplication
);

// ================= LEASE DRAFT PHASE =================

// Create/update lease draft
router.put(
    '/:leaseId/draft',
    checkAuth(Role.OWNER),
    createOrUpdateDraft
);

// Send lease to tenant
router.post(
    '/:leaseId/send-to-tenant',
    checkAuth(Role.OWNER),
    sendToTenant
);

// ================= TENANT REVIEW PHASE =================

// Tenant reviews lease (approve/request changes)
router.post(
    '/:leaseId/review',
    checkAuth(Role.TENANT),
    tenantReviewLease
);

// Request changes (legacy, kept for compatibility)
router.post(
    '/:leaseId/request-changes',
    checkAuth(Role.TENANT),
    requestChanges
);

// ================= SIGNING PHASE =================

// Sign lease (both landlord and tenant)
router.post(
    '/:leaseId/sign',
    checkAuth(Role.OWNER, Role.TENANT),
    signLease
);

// Send to landlord for signature (tenant action)
router.post(
    '/:leaseId/send-to-landlord',
    checkAuth(Role.TENANT),
    sendToLandlordForSignature
);

// ================= MOVE-IN PHASE =================

// Schedule move-in inspection
router.post(
    '/:leaseId/schedule-move-in',
    checkAuth(Role.OWNER, Role.TENANT),
    scheduleMoveInInspection
);

// Conduct move-in inspection
router.post(
    '/:leaseId/conduct-move-in',
    checkAuth(Role.OWNER, Role.TENANT),
    conductMoveInInspection
);

// ================= ACTIVE LEASE MANAGEMENT =================

// Give notice (renewal or termination)
router.post(
    '/:leaseId/give-notice',
    checkAuth(Role.OWNER, Role.TENANT),
    giveNotice
);

// Respond to renewal offer
router.post(
    '/:leaseId/respond-to-renewal',
    checkAuth(Role.TENANT),
    respondToRenewal
);

// ================= MOVE-OUT PHASE =================

// Schedule move-out inspection
router.post(
    '/:leaseId/schedule-move-out',
    checkAuth(Role.OWNER, Role.TENANT),
    scheduleMoveOutInspection
);

// Process security deposit return
router.post(
    '/:leaseId/process-deposit',
    checkAuth(Role.OWNER),
    processDepositReturn
);

// ================= GENERAL LEASE MANAGEMENT =================

// Get lease by ID
router.get(
    '/:leaseId',
    checkAuth(Role.OWNER, Role.TENANT, Role.ADMIN, Role.SUPER_ADMIN),
    getLeaseById
);

// Update lease (general)
router.put(
    '/:leaseId/update',
    checkAuth(Role.OWNER, Role.TENANT),
    updateLease
);

// Cancel lease
router.post(
    '/:leaseId/cancel',
    checkAuth(Role.OWNER, Role.TENANT),
    cancelLease
);

// Delete lease (soft delete)
router.delete(
    '/:leaseId',
    checkAuth(Role.OWNER, Role.TENANT, Role.ADMIN, Role.SUPER_ADMIN),
    deleteLease
);

// Restore deleted lease
router.post(
    '/:leaseId/restore',
    checkAuth(Role.OWNER, Role.TENANT, Role.ADMIN, Role.SUPER_ADMIN),
    restoreLease
);

export const LeaseRoutes = router;