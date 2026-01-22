import mongoose from "mongoose";
import AppError from "../../errorHelpers/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { User } from "../auth/auth.model.js";
import Property from "../properties/properties.model.js";
import Lease from "./lease.model.js";
import httpStatus from "http-status-codes";

// Create new lease
const createLease = catchAsync(async (req, res) => {
  const tenantId = req.user.userId;
  const { property: propertyId } = req.body;

  // Find property
  const property = await Property.findOne({
    _id: propertyId,
    isDeleted: false
  });

  if (!property) {
    throw new AppError(404, "Property not found");
  }

  if (property.status !== "active") {
    throw new AppError(400, "Property is not available");
  }

  const landlordId = property.owner;

  // Verify tenant
  const tenant = await User.findById(tenantId);
  if (!tenant || tenant.role !== "tenant") {
    throw new AppError(404, "Tenant not found");
  }

  // Prevent duplicate request
  const existing = await Lease.findOne({
    property: propertyId,
    tenant: tenantId,
    status: { $nin: ["cancelled", "expired"] },
    isDeleted: false
  });

  if (existing) {
    throw new AppError(400, "You already requested this property");
  }

  const rentAmount = property.price || 0;

  const lease = await Lease.create({
    landlord: landlordId,
    tenant: tenantId,
    property: propertyId,
    status: "pending_request",
    rentAmount: rentAmount,
    rentFrequency: "monthly",
    createdBy: tenantId,
    statusHistory: [
      {
        status: "pending_request",
        changedBy: tenantId,
        reason: "Tenant requested to rent"
      }
    ]
  });

  res.status(201).json({
    success: true,
    message: "Request sent to landlord",
    data: lease
  });
});



// Send lease to tenant
const sendToTenant = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { message } = req.body;
  const landlordId = req.user.userId;

  // Find lease (only landlord + draft)
  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: "draft",
    isDeleted: false
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Lease not found or you are not authorized to send it"
    );
  }

  // Validate required fields before sending
  if (!lease.startDate || !lease.endDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Lease start and end dates must be set before sending"
    );
  }

  if (!lease.rentAmount || lease.rentAmount <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Valid rent amount must be set before sending"
    );
  }

  // Update lease status
  lease.status = "sent_to_tenant";
  lease._updatedBy = landlordId;

  // Add optional message
  if (message?.trim()) {
    lease.messages.push({
      from: landlordId,
      message: message.trim(),
      sentAt: new Date()
    });
  }

  // Save lease
  await lease.save();

  const tenant = await User.findById(lease.tenant);
  if (tenant) {
    // TODO: send email / notification
    // notifyTenant(tenant.email, lease._id);
  }

  res.status(httpStatus.OK).json({
    success: true,
    message: "Lease sent to tenant successfully",
    data: lease
  });
});

// Request changes to lease
const requestChanges = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { changes } = req.body;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ]
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found');
  }

  // Check if user can request changes
  if (
    lease.status !== 'sent_to_tenant' ||
    req.user.userId.toString() !== lease.tenant.toString()
  ) {
    throw new AppError(400, 'Only tenant can request changes');
  }


  // Update status
  lease.status = 'changes_requested';

  // Add change request
  lease.requestedChanges.push({
    requestedBy: req.user.userId,
    changes,
    requestedAt: new Date()
  });

  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `Requested changes: ${changes}`,
    sentAt: new Date()
  });

  await lease.save();

  // Notify other party
  const otherPartyId = req.user.userId.toString() === lease.landlord.toString()
    ? lease.tenant
    : lease.landlord;

  const otherUser = await User.findById(otherPartyId);
  if (otherUser) {
    // send notification about requested changes
  }

  res.status(200).json({
    success: true,
    message: 'Changes requested successfully',
    data: lease
  });
});

// Update lease
const updateLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const updates = req.body;
  const landlordId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: { $in: ['draft', 'changes_requested'] },
    isDeleted: false
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      'Lease not found or unauthorized to edit'
    );
  }

  const allowedUpdates = [
    'title',
    'description',
    'startDate',
    'endDate',
    'rentAmount',
    'rentFrequency',
    'securityDeposit',
    'terms',
    'customClauses'
  ];

  // Update allowed fields
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      lease[field] = updates[field];
    }
  });

  // Handle change request resolution
  if (lease.status === 'changes_requested') {
    lease.requestedChanges.forEach(rc => {
      if (!rc.resolved) {
        rc.resolved = true;
        rc.resolvedAt = new Date();
        rc.resolutionNotes = updates.resolutionNotes || 'Resolved by landlord';
      }
    });

    lease.status = 'draft';
    lease._updatedBy = landlordId;

    lease.statusHistory.push({
      status: 'draft',
      changedBy: landlordId,
      reason: 'Tenant requested changes resolved by landlord'
    });
  }

  // Add message
  lease.messages.push({
    from: landlordId,
    message:
      updates.message ||
      (lease.status === 'draft'
        ? 'Lease updated after tenant requested changes'
        : 'Lease updated'),
    sentAt: new Date()
  });

  await lease.save();

  console.log('Lease updated successfully:', {
    leaseId: lease._id,
    rentAmount: lease.rentAmount,
    securityDeposit: lease.securityDeposit,
    startDate: lease.startDate,
    endDate: lease.endDate
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Lease updated successfully',
    data: lease
  });
});


// Sign lease with simple signature
const signLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { singnatureImageUrl } = req.body;
  const userId = req.user.userId;

  // Find lease
  const lease = await Lease.findOne({
    _id: leaseId,
    isDeleted: false
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
  }

  // Check if lease already locked
  if (lease.isLocked) {
    throw new AppError(httpStatus.BAD_REQUEST, "Lease is already finalized");
  }

  // Identify role
  const isLandlord = lease.landlord.toString() === userId;
  const isTenant = lease.tenant.toString() === userId;

  if (!isLandlord && !isTenant) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized to sign this lease");
  }

  const role = isLandlord ? "landlord" : "tenant";

  // Status validation (must be sent_to_tenant or signed_by_landlord)
  if (!["sent_to_tenant", "signed_by_landlord"].includes(lease.status)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Lease is not ready for signing"
    );
  }

  // Signing order enforcement
  if (role === "tenant" && !lease.signatures.landlord?.signedAt) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Landlord must sign before tenant"
    );
  }

  // Prevent double signing
  if (lease.signatures?.[role]?.signedAt) {
    throw new AppError(httpStatus.BAD_REQUEST, "You have already signed this lease");
  }

  // Save signature
  lease.signatures[role] = {
    signedAt: new Date(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    singnatureImageUrl
  };

  // Update status correctly
  if (role === "landlord") {
    lease.status = "signed_by_landlord";
  } else if (lease.signatures.landlord?.signedAt) {
    lease.status = "fully_executed";
  }

  // Add message
  lease.messages.push({
    from: userId,
    message: `${role} signed the lease`,
    sentAt: new Date()
  });

  await lease.save();

  res.status(httpStatus.OK).json({
    success: true,
    message: "Lease signed successfully",
    data: {
      leaseId: lease._id,
      status: lease.status,
      isFullySigned: lease.isFullySigned,
      nextAction: lease.nextAction
    }
  });
});



// Get leases for current user
const getMyLeases = catchAsync(async (req, res) => {
  const { status, role } = req.query;
  const userId = req.user.userId;

  let query = {
    $or: [
      { landlord: userId },
      { tenant: userId }
    ],
    isDeleted: false
  };

  // Filter by role if specified
  if (role === 'landlord') {
    query = { landlord: userId, isDeleted: false };
  } else if (role === 'tenant') {
    query = { tenant: userId, isDeleted: false };
  }

  // Filter by status if specified
  if (status && status !== 'all') {
    query.status = status;
  }

  const leases = await Lease.find(query)
    .populate('property', 'title address city type price')
    .populate('landlord', 'name email')
    .populate('tenant', 'name email')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    message: 'Leases retrieved successfully',
    data: leases,
    count: leases.length
  });
});

// Get lease by ID
const getLeaseById = catchAsync(async (req, res) => {
  const { leaseId } = req.params;

  // Validate leaseId format
  if (!mongoose.Types.ObjectId.isValid(leaseId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid lease ID format');
  }

  try {
    const lease = await Lease.findOne({
      _id: leaseId,
      $or: [
        { landlord: req.user.userId },
        { tenant: req.user.userId }
      ],
      isDeleted: false
    })
      .populate('property', 'title address city state zipCode type amenities price')
      .populate('landlord', 'name email phone profilePicture')
      .populate('tenant', 'name email phone profilePicture')
      .populate('createdBy', 'name email')
      .populate('statusHistory.changedBy', 'name email')
      .populate('messages.from', 'name email profilePicture')
      .populate('requestedChanges.requestedBy', 'name email');

    if (!lease) {
      console.log('Lease not found or unauthorized access attempt');
      throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or you are not authorized to view this lease');
    }

    res.status(200).json({
      success: true,
      message: 'Lease retrieved successfully',
      data: lease
    });
  } catch (error) {
    console.error('Error in getLeaseById:', error);
    throw error;
  }
});

// Cancel lease
const cancelLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { reason } = req.body;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    status: { $nin: ['fully_executed', 'cancelled', 'expired'] },
    isDeleted: false
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or cannot be cancelled');
  }

  // Update status
  lease.status = 'cancelled';

  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `Lease cancelled. Reason: ${reason || 'No reason provided'}`,
    sentAt: new Date()
  });

  await lease.save();

  // Notify other party
  const otherPartyId = req.user.userId.toString() === lease.landlord.toString()
    ? lease.tenant
    : lease.landlord;

  const otherUser = await User.findById(otherPartyId);
  if (otherUser) {
    // send notification about lease cancellation
  }

  res.status(200).json({
    success: true,
    message: 'Lease cancelled successfully',
    data: lease
  });
});


// Get lease statistics
const getLeaseStats = catchAsync(async (req, res) => {
  const userId = req.user.userId;

  const objectUserId = new mongoose.Types.ObjectId(userId);

  const stats = await Lease.aggregate([
    {
      $match: {
        $or: [
          { landlord: objectUserId },
          { tenant: objectUserId }
        ],
        isDeleted: false
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRent: { $sum: '$rentAmount' }
      }
    },
    {
      $project: {
        status: '$_id',
        count: 1,
        totalRent: 1,
        _id: 0
      }
    }
  ]);

  const asLandlord = await Lease.countDocuments({
    landlord: userId,
    isDeleted: false
  });

  const asTenant = await Lease.countDocuments({
    tenant: userId,
    isDeleted: false
  });

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const expiringSoon = await Lease.countDocuments({
    $or: [
      { landlord: userId },
      { tenant: userId }
    ],
    status: 'fully_executed',
    endDate: {
      $gte: new Date(),
      $lte: thirtyDaysFromNow
    },
    isDeleted: false
  });

  res.status(200).json({
    success: true,
    message: 'Statistics retrieved successfully',
    data: {
      byStatus: stats,
      counts: {
        total: asLandlord + asTenant,
        asLandlord,
        asTenant
      },
      expiringSoon
    }
  });
});


// Soft delete lease (archive)
const deleteLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    status: { $in: ['draft', 'cancelled', 'expired'] }
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or cannot be deleted');
  }

  lease.isDeleted = true;
  lease.deletedAt = new Date();

  await lease.save();

  res.status(200).json({
    success: true,
    message: 'Lease deleted successfully',
    data: { leaseId, deletedAt: new Date() }
  });
});

// Restore deleted lease
const restoreLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    isDeleted: true
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Deleted lease not found');
  }

  lease.isDeleted = false;
  lease.deletedAt = undefined;

  await lease.save();

  res.status(200).json({
    success: true,
    message: 'Lease restored successfully',
    data: lease
  });
});


const approveRequest = catchAsync(async (req, res) => {
  const lease = await Lease.findOne({
    _id: req.params.leaseId,
    landlord: req.user.userId,
    status: 'pending_request',
    isDeleted: false
  }).populate('property');

  if (!lease) {
    throw new AppError(404, 'Request not found');
  }

  lease.status = 'draft';
  lease._updatedBy = req.user.userId;

  if (!lease.rentAmount && lease.property?.price) {
    lease.rentAmount = lease.property.price;
    console.log('Setting rentAmount from property.price:', lease.property.price);
  }

  lease.statusHistory.push({
    status: 'draft',
    changedBy: req.user.userId,
    reason: 'Owner approved request'
  });

  await lease.save();

  console.log('After save - rentAmount:', lease.rentAmount);

  res.json({
    success: true,
    message: 'Request approved. Lease draft created',
    data: lease
  });
});



export {
  createLease,
  sendToTenant,
  requestChanges,
  updateLease,
  signLease,
  getMyLeases,
  getLeaseById,
  cancelLease,
  getLeaseStats,
  deleteLease,
  restoreLease,
  approveRequest
};