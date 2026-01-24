import mongoose from "mongoose";
import AppError from "../../errorHelpers/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { User } from "../auth/auth.model.js";
import Property from "../properties/properties.model.js";
import Lease from "./lease.model.js";
import httpStatus from "http-status-codes";
import { uploadServices } from "../upload/upload.services.js";
import { base64ToBuffer } from "../../utils/base64ToBuffer.js";

// ================= HELPER FUNCTIONS =================
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, p) => o ? o[p] : undefined, obj);
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((o, p) => o[p] = o[p] || {}, obj);
  target[lastKey] = value;
}

// ================= COMPLETE WORKFLOW CONTROLLERS =================

// 1. Tenant requests property (Create Lease)
const createLease = catchAsync(async (req, res) => {
  const tenantId = req.user.userId;
  const { property: propertyId, message } = req.body;

  // Find property
  const property = await Property.findOne({
    _id: propertyId,
    isDeleted: false,
  }).populate("owner");

  if (!property) {
    throw new AppError(404, "Property not found");
  }

  if (property.status !== "active") {
    throw new AppError(400, "Property is not available for rent");
  }

  const landlordId = property.owner._id;

  // Prevent duplicate request
  const existing = await Lease.findOne({
    property: propertyId,
    tenant: tenantId,
    status: { $nin: ["cancelled", "expired", "rejected"] },
    isDeleted: false,
  });

  if (existing) {
    throw new AppError(400, "You already have an active request for this property");
  }

  // Create lease with application status
  const lease = await Lease.create({
    landlord: landlordId,
    tenant: tenantId,
    property: propertyId,
    status: "pending_request",
    application: {
      status: "pending",
      submittedAt: new Date(),
      documents: [],
    },
    rentAmount: property.price || 0,
    rentFrequency: "monthly",
    createdBy: tenantId,
    messages: message ? [{
      from: tenantId,
      message: message,
      sentAt: new Date(),
      readBy: [tenantId],
    }] : [],
    statusHistory: [{
      status: "pending_request",
      changedBy: tenantId,
      reason: "Tenant applied for property",
    }],
  });

  // Populate response
  const populatedLease = await Lease.findById(lease._id)
    .populate("property", "title address city state")
    .populate("landlord", "name email")
    .populate("tenant", "name email");

  res.status(201).json({
    success: true,
    message: "Application submitted successfully",
    data: populatedLease,
  });
});

// 2. Landlord reviews application
const reviewApplication = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { action, reason, screeningResults } = req.body;
  const landlordId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: "pending_request",
    isDeleted: false,
  }).populate("tenant");

  if (!lease) {
    throw new AppError(404, "Application not found or already processed");
  }

  if (!["approve", "reject"].includes(action)) {
    throw new AppError(400, "Invalid action. Use 'approve' or 'reject'");
  }

  if (action === "approve") {
    // Approve application
    lease.status = "approved";
    lease.application.status = "approved";
    lease.application.reviewedAt = new Date();
    lease.application.reviewedBy = landlordId;
    
    if (screeningResults) {
      lease.application.screeningResults = screeningResults;
    }

    // Add status history
    lease.statusHistory.push({
      status: "approved",
      changedBy: landlordId,
      reason: reason || "Application approved by landlord",
      changedAt: new Date(),
      metadata: { screeningResults }
    });

    // Auto-create draft lease
    const draftLease = {
      startDate: new Date(),
      endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      rentAmount: lease.rentAmount,
      securityDeposit: lease.rentAmount, // Typically 1 month rent
      depositStatus: "pending",
      utilities: {
        includedInRent: [],
        paidByTenant: ["electricity", "water", "internet"],
      },
    };

    Object.assign(lease, draftLease);

  } else {
    // Reject application
    lease.status = "rejected";
    lease.application.status = "rejected";
    lease.application.reviewedAt = new Date();
    lease.application.reviewedBy = landlordId;
    
    lease.statusHistory.push({
      status: "rejected",
      changedBy: landlordId,
      reason: reason || "Application rejected by landlord",
      changedAt: new Date(),
    });
  }

  // Add message
  lease.messages.push({
    from: landlordId,
    message: action === "approve" 
      ? "Application approved. Lease draft created." 
      : "Application rejected.",
    sentAt: new Date(),
    readBy: [landlordId],
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: action === "approve" ? "Application approved" : "Application rejected",
    data: lease,
  });
});

// 3. Approve Request (Legacy function - for backward compatibility)
const approveRequest = catchAsync(async (req, res) => {
  const lease = await Lease.findOne({
    _id: req.params.leaseId,
    landlord: req.user.userId,
    status: "pending_request",
    isDeleted: false,
  }).populate("property");

  if (!lease) {
    throw new AppError(404, "Request not found");
  }

  lease.status = "draft";
  lease._updatedBy = req.user.userId;

  if (!lease.rentAmount && lease.property?.price) {
    lease.rentAmount = lease.property.price;
  }

  // Initialize utilities if needed
  if (!lease.utilities) {
    lease.utilities = {
      includedInRent: [],
      paidByTenant: []
    };
  }

  lease.statusHistory.push({
    status: "draft",
    changedBy: req.user.userId,
    reason: "Owner approved request",
    changedAt: new Date(),
  });

  await lease.save();

  res.json({
    success: true,
    message: "Request approved. Lease draft created",
    data: lease,
  });
});

// 4. Create/update lease draft
const createOrUpdateDraft = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const updates = req.body;
  const landlordId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: { $in: ["approved", "draft", "changes_requested"] },
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or cannot be edited");
  }

  // Allowed updates
  const allowedUpdates = [
    "title", "description", "startDate", "endDate", 
    "rentAmount", "rentFrequency", "securityDeposit",
    "utilities", "maintenanceTerms", "lateFee", "gracePeriod",
    "terms", "paymentSettings"
  ];

  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      lease[field] = updates[field];
    }
  });

  // Update status if needed
  if (lease.status === "approved" || lease.status === "changes_requested") {
    lease.status = "draft";
    lease.statusHistory.push({
      status: "draft",
      changedBy: landlordId,
      reason: updates.message || "Lease draft created/updated",
      changedAt: new Date(),
    });
  }

  // Resolve change requests if any
  if (lease.status === "changes_requested" && updates.resolveChanges) {
    lease.requestedChanges.forEach(rc => {
      if (!rc.resolved) {
        rc.resolved = true;
        rc.resolvedAt = new Date();
        rc.resolutionNotes = updates.resolutionNotes || "Changes implemented";
      }
    });
  }

  // Add message if provided
  if (updates.message) {
    lease.messages.push({
      from: landlordId,
      message: updates.message,
      sentAt: new Date(),
      readBy: [landlordId],
    });
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease draft updated successfully",
    data: lease,
  });
});

// 5. Send lease to tenant
const sendToTenant = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { message } = req.body;
  const landlordId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: { $in: ["draft", "changes_requested"] },
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or cannot be sent");
  }

    if (lease.requestedChanges?.length > 0) {
    lease.requestedChanges.forEach(rc => {
      if (!rc.resolved) {
        rc.resolved = true;
        rc.resolvedAt = new Date();
        rc.resolutionNotes = "Changes implemented by landlord";
      }
    });
  }

  // Validate required fields
  const validations = [];
  if (!lease.startDate) validations.push("Start date");
  if (!lease.endDate) validations.push("End date");
  if (!lease.rentAmount || lease.rentAmount <= 0) validations.push("Valid rent amount");
  if (!lease.securityDeposit && lease.securityDeposit !== 0) validations.push("Security deposit");

  if (validations.length > 0) {
    throw new AppError(400, 
      `Cannot send lease. Missing: ${validations.join(", ")}`
    );
  }

  // Update status
  lease.status = "sent_to_tenant";
  lease.statusHistory.push({
    status: "sent_to_tenant",
    changedBy: landlordId,
    reason: "Lease sent to tenant for review",
    changedAt: new Date(),
  });

  if (message) {
    lease.messages.push({
      from: landlordId,
      message: message,
      sentAt: new Date(),
      readBy: [landlordId],
    });
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease sent to tenant successfully",
    data: lease,
  });
});

// 6. Request changes to lease
const requestChanges = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { changes } = req.body;
  const tenantId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    tenant: tenantId,
    status: "sent_to_tenant",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or cannot request changes");
  }

  if (!changes || changes.trim() === "") {
    throw new AppError(400, "Changes description is required");
  }

  // Update status
  lease.status = "changes_requested";

  // Add change request
  lease.requestedChanges.push({
    requestedBy: tenantId,
    changes: changes.trim(),
    requestedAt: new Date(),
    resolved: false,
  });

  // Add status history
  lease.statusHistory.push({
    status: "changes_requested",
    changedBy: tenantId,
    reason: "Tenant requested changes",
    changedAt: new Date(),
  });

  // Add message
  lease.messages.push({
    from: tenantId,
    message: `Requested changes: ${changes}`,
    sentAt: new Date(),
    readBy: [tenantId],
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Changes requested successfully",
    data: lease,
  });
});

// 7. Tenant reviews lease (approve or request changes)
const tenantReviewLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { action, changes, message } = req.body;
  const tenantId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    tenant: tenantId,
    status: "sent_to_tenant",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or not available for review");
  }

  if (!["approve", "request_changes"].includes(action)) {
    throw new AppError(400, "Invalid action. Use 'approve' or 'request_changes'");
  }

  if (action === "approve") {
    // Tenant approves and sends to landlord for signature
    lease.status = "sent_to_landlord";
    lease.statusHistory.push({
      status: "sent_to_landlord",
      changedBy: tenantId,
      reason: "Tenant approved lease, sent to landlord for signature",
      changedAt: new Date(),
    });

    if (message) {
      lease.messages.push({
        from: tenantId,
        message: message,
        sentAt: new Date(),
        readBy: [tenantId],
      });
    }
  } else {
    // Request changes
    if (!changes || changes.trim() === "") {
      throw new AppError(400, "Changes description is required");
    }

    lease.status = "changes_requested";
    lease.requestedChanges.push({
      requestedBy: tenantId,
      changes: changes.trim(),
      requestedAt: new Date(),
      resolved: false,
    });

    lease.statusHistory.push({
      status: "changes_requested",
      changedBy: tenantId,
      reason: "Tenant requested changes",
      changedAt: new Date(),
    });

    if (message) {
      lease.messages.push({
        from: tenantId,
        message: message,
        sentAt: new Date(),
        readBy: [tenantId],
      });
    }
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: action === "approve" 
      ? "Lease approved and sent to landlord" 
      : "Change request submitted",
    data: lease,
  });
});

// 8. Send to landlord for signature
const sendToLandlordForSignature = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { message } = req.body;
  const tenantId = req.user.userId;

  // Find lease
  const lease = await Lease.findOne({
    _id: leaseId,
    tenant: tenantId,
    status: "sent_to_tenant",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or you are not authorized");
  }

  if (lease.signatures?.tenant?.signedAt) {
    throw new AppError(400, "You have already signed this lease");
  }

  // Update status
  lease.status = "sent_to_landlord";
  lease._updatedBy = tenantId;

  // Add message if provided
  if (message?.trim()) {
    lease.messages.push({
      from: tenantId,
      message: message.trim(),
      sentAt: new Date(),
      readBy: [tenantId],
    });
  }

  // Add status history
  lease.statusHistory.push({
    status: "sent_to_landlord",
    changedBy: tenantId,
    reason: "Tenant sent lease to landlord for signature",
    changedAt: new Date(),
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease sent to landlord for signature successfully",
    data: lease,
  });
});

// 9. Sign lease
const signLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { signatureDataUrl, signatureMode, typedSignature } = req.body;
  const userId = req.user.userId;

  if (!signatureDataUrl || !signatureMode) {
    throw new AppError(400, "Signature data is required");
  }

  const lease = await Lease.findOne({
    _id: leaseId,
    isDeleted: false,
  }).populate("tenant landlord");

  if (!lease) {
    throw new AppError(404, "Lease not found");
  }

  if (lease.isLocked) {
    throw new AppError(400, "Lease already finalized");
  }

  const isLandlord = lease.landlord._id.toString() === userId;
  const isTenant = lease.tenant._id.toString() === userId;

  if (!isLandlord && !isTenant) {
    throw new AppError(403, "Unauthorized to sign this lease");
  }

  const role = isLandlord ? "landlord" : "tenant";

  // Check if already signed
  if (lease.signatures?.[role]?.signedAt) {
    throw new AppError(400, "You have already signed this lease");
  }

  // Validate signing order based on status
  if (role === "tenant" && !lease.signatures?.landlord?.signedAt) {
    if (lease.status === "sent_to_tenant") {
      throw new AppError(400, 
        "Please review and approve the lease first before signing"
      );
    } else if (lease.status === "sent_to_landlord") {
      throw new AppError(400, 
        "Landlord must sign first. The lease is with the landlord for signature."
      );
    }
  }

  // Upload signature
  const signatureBuffer = base64ToBuffer(signatureDataUrl);
  const uploadResult = await uploadServices.uploadSingleFile(
    signatureBuffer,
    `leases/${leaseId}/signatures`,
    "image"
  );

  // Save signature
  lease.signatures[role] = {
    signedAt: new Date(),
    signatureType: signatureMode,
    signatureData: {
      dataUrl: uploadResult.url,
      typedText: signatureMode === "type" ? typedSignature : undefined,
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };

  // Update status based on signing order
  if (role === "landlord") {
    if (lease.status === "sent_to_landlord" || lease.status === "draft") {
      lease.status = "signed_by_landlord";
      lease.statusHistory.push({
        status: "signed_by_landlord",
        changedBy: userId,
        reason: "Landlord signed the lease",
        changedAt: new Date(),
      });
    }
  } else {
    // Tenant signing
    lease.status = "fully_executed";
    lease.isLocked = true;
    lease.lockedAt = new Date();
    lease.statusHistory.push({
      status: "fully_executed",
      changedBy: userId,
      reason: "Tenant signed, lease fully executed",
      changedAt: new Date(),
    });

    // Schedule move-in if date is in future
    if (lease.startDate && new Date(lease.startDate) > new Date()) {
      lease.metadata = lease.metadata || {};
      lease.metadata.moveInDate = lease.startDate;
    }
  }

  // Add message
  lease.messages.push({
    from: userId,
    message: `${role} signed the lease agreement`,
    sentAt: new Date(),
    readBy: [userId],
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease signed successfully",
    data: {
      status: lease.status,
      isFullySigned: lease.isFullySigned,
      nextStep: lease.status === "fully_executed" 
        ? "Schedule move-in inspection" 
        : "Waiting for tenant signature",
    },
  });
});

// 10. Update lease
const updateLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const updates = req.body;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or unauthorized");
  }

  const isLandlord = lease.landlord.toString() === userId;
  const isTenant = lease.tenant.toString() === userId;

  // Status transitions
  if (updates.status) {
    const allowedTransitions = {
      // Landlord transitions
      landlord: {
        pending_request: ["under_review", "rejected"],
        under_review: ["approved", "rejected"],
        approved: ["draft"],
        draft: ["sent_to_tenant"],
        changes_requested: ["draft"],
        sent_to_landlord: ["signed_by_landlord"],
        signed_by_tenant: ["fully_executed"],
        active: ["renewal_pending", "notice_given"],
      },
      // Tenant transitions
      tenant: {
        sent_to_tenant: ["changes_requested", "sent_to_landlord"],
        renewal_pending: ["accepted", "declined"],
        notice_given: ["move_out_scheduled"],
      },
    };

    const role = isLandlord ? "landlord" : "tenant";
    const allowed = allowedTransitions[role]?.[lease.status] || [];

    if (!allowed.includes(updates.status)) {
      throw new AppError(400, 
        `Cannot transition from ${lease.status} to ${updates.status} as ${role}`
      );
    }

    lease.status = updates.status;
    lease.statusHistory.push({
      status: updates.status,
      changedBy: userId,
      reason: updates.reason || `Status updated by ${role}`,
      changedAt: new Date(),
    });
  }

  // Field updates based on role and status
  if (isLandlord) {
    const landlordEditable = [
      "title", "description", "startDate", "endDate",
      "rentAmount", "rentFrequency", "securityDeposit",
      "utilities", "maintenanceTerms", "lateFee", "gracePeriod",
      "terms", "paymentSettings"
    ];

    landlordEditable.forEach(field => {
      if (updates[field] !== undefined) {
        lease[field] = updates[field];
      }
    });

    // Application screening updates
    if (updates.screeningResults && lease.status === "under_review") {
      lease.application.screeningResults = {
        ...lease.application.screeningResults,
        ...updates.screeningResults,
      };
    }

    // Inspection updates
    if (updates.inspection) {
      if (updates.inspection.moveIn) {
        Object.assign(lease.inspections.moveIn, updates.inspection.moveIn);
      }
      if (updates.inspection.moveOut) {
        Object.assign(lease.inspections.moveOut, updates.inspection.moveOut);
      }
    }
  }

  if (isTenant) {
    const tenantEditable = [
      "metadata.forwardingAddress"
    ];

    tenantEditable.forEach(field => {
      const value = getNestedValue(updates, field);
      if (value !== undefined) {
        setNestedValue(lease, field, value);
      }
    });
  }

  // Both can update
  if (updates.message) {
    lease.messages.push({
      from: userId,
      message: updates.message,
      sentAt: new Date(),
      readBy: [userId],
    });
  }

  lease._updatedBy = userId;
  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease updated successfully",
    data: lease,
  });
});

// 11. Get leases for current user
const getMyLeases = catchAsync(async (req, res) => {
  const { status, role, active, type } = req.query;
  const userId = req.user.userId;

  let query = {
    isDeleted: false,
  };

  // Role filter
  if (role === "landlord") {
    query.landlord = userId;
  } else if (role === "tenant") {
    query.tenant = userId;
  } else {
    query.$or = [{ landlord: userId }, { tenant: userId }];
  }

  // Status filter
  if (status && status !== "all") {
    if (status === "active_leases") {
      query.status = { $in: ["active", "fully_executed"] };
      query.startDate = { $lte: new Date() };
      query.endDate = { $gte: new Date() };
    } else if (status === "pending") {
      query.status = { $in: ["pending_request", "under_review", "approved", "draft"] };
    } else if (status === "expiring_soon") {
      query.status = "active";
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      query.endDate = { $lte: thirtyDaysFromNow, $gte: new Date() };
    } else {
      query.status = status;
    }
  }

  // Type filter
  if (type === "application") {
    query.status = { $in: ["pending_request", "under_review", "approved", "rejected"] };
  } else if (type === "executed") {
    query.status = { $in: ["fully_executed", "active", "renewal_pending"] };
  } else if (type === "historical") {
    query.status = { $in: ["expired", "terminated", "cancelled"] };
  }

  const leases = await Lease.find(query)
    .populate(
      "property",
      "title address city state zipCode type price bedrooms bathrooms amenities"
    )
    .populate("landlord", "name email phone profilePicture")
    .populate("tenant", "name email phone profilePicture")
    .populate("application.reviewedBy", "name")
    .sort({ createdAt: -1 });

  // Add virtual requiresAction for each lease
  leases.forEach(lease => {
    lease._user = { _id: userId };
  });

  res.status(200).json({
    success: true,
    message: "Leases retrieved successfully",
    data: leases,
    count: leases.length,
    summary: {
      applications: leases.filter(l => ["pending_request", "under_review"].includes(l.status)).length,
      active: leases.filter(l => ["active", "fully_executed"].includes(l.status)).length,
      expiringSoon: leases.filter(l => 
        l.status === "active" && 
        l.endDate && 
        new Date(l.endDate) <= new Date(new Date().setDate(new Date().getDate() + 30))
      ).length,
    },
  });
});

// 12. Get lease by ID
const getLeaseById = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const userId = req.user.userId;

  if (!mongoose.Types.ObjectId.isValid(leaseId)) {
    throw new AppError(400, "Invalid lease ID format");
  }

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    isDeleted: false,
  })
    .populate(
      "property",
      "title address city state zipCode type amenities price bedrooms bathrooms"
    )
    .populate("landlord", "name email phone profilePicture")
    .populate("tenant", "name email phone profilePicture")
    .populate("createdBy", "name email")
    .populate("statusHistory.changedBy", "name email")
    .populate("messages.from", "name email profilePicture")
    .populate("requestedChanges.requestedBy", "name email")
    .populate("application.reviewedBy", "name")
    .populate("inspections.moveIn.conductedBy", "name")
    .populate("inspections.moveOut.conductedBy", "name")
    .populate("notices.givenBy", "name");

  if (!lease) {
    throw new AppError(404, "Lease not found or unauthorized");
  }

  // Add virtual requiresAction
  lease._user = { _id: userId };

  res.status(200).json({
    success: true,
    message: "Lease retrieved successfully",
    data: lease,
  });
});

// 13. Cancel lease
const cancelLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { reason } = req.body;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    status: { 
      $in: [
        "pending_request", "under_review", "approved", 
        "draft", "sent_to_tenant", "changes_requested"
      ] 
    },
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or cannot be cancelled");
  }

  const isLandlord = lease.landlord.toString() === userId;
  const role = isLandlord ? "landlord" : "tenant";

  lease.status = "cancelled";
  lease.statusHistory.push({
    status: "cancelled",
    changedBy: userId,
    reason: `Cancelled by ${role}: ${reason || "No reason provided"}`,
    changedAt: new Date(),
  });

  lease.messages.push({
    from: userId,
    message: `Lease cancelled. Reason: ${reason || "No reason provided"}`,
    sentAt: new Date(),
    readBy: [userId],
  });

  // If security deposit was paid, initiate refund
  if (lease.depositStatus === "paid") {
    lease.depositStatus = "pending_refund";
    lease.depositTransactions.push({
      amount: lease.securityDeposit,
      type: "refund",
      date: new Date(),
      description: "Refund due to lease cancellation",
    });
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease cancelled successfully",
    data: {
      status: lease.status,
      depositStatus: lease.depositStatus,
    },
  });
});

// 14. Get lease statistics
const getLeaseStats = catchAsync(async (req, res) => {
  const userId = req.user.userId;

  const objectUserId = new mongoose.Types.ObjectId(userId);

  // Get counts by status
  const stats = await Lease.aggregate([
    {
      $match: {
        $or: [{ landlord: objectUserId }, { tenant: objectUserId }],
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalRent: { $sum: "$rentAmount" },
      },
    },
    {
      $project: {
        status: "$_id",
        count: 1,
        totalRent: 1,
        _id: 0,
      },
    },
  ]);

  // Get counts by role
  const asLandlord = await Lease.countDocuments({
    landlord: userId,
    isDeleted: false,
  });

  const asTenant = await Lease.countDocuments({
    tenant: userId,
    isDeleted: false,
  });

  // Get expiring soon count
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const expiringSoon = await Lease.countDocuments({
    $or: [{ landlord: userId }, { tenant: userId }],
    status: "fully_executed",
    endDate: {
      $gte: new Date(),
      $lte: thirtyDaysFromNow,
    },
    isDeleted: false,
  });

  // Get pending actions count
  const pendingActions = {
    applicationsToReview: await Lease.countDocuments({
      landlord: userId,
      status: "pending_request",
      isDeleted: false,
    }),
    leasesToSign: await Lease.countDocuments({
      $or: [
        { landlord: userId, status: "sent_to_landlord" },
        { tenant: userId, status: "signed_by_landlord" }
      ],
      isDeleted: false,
    }),
    changeRequests: await Lease.countDocuments({
      landlord: userId,
      status: "changes_requested",
      isDeleted: false,
    }),
  };

  res.status(200).json({
    success: true,
    message: "Statistics retrieved successfully",
    data: {
      byStatus: stats,
      counts: {
        total: asLandlord + asTenant,
        asLandlord,
        asTenant,
      },
      expiringSoon,
      pendingActions,
    },
  });
});

// 15. Delete lease (soft delete)
const deleteLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    status: { $in: ["draft", "cancelled", "expired", "rejected"] },
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or cannot be deleted");
  }

  lease.isDeleted = true;
  lease.deletedAt = new Date();
  lease.deletedBy = userId;

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease deleted successfully",
    data: { leaseId, deletedAt: new Date() },
  });
});

// 16. Restore deleted lease
const restoreLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    isDeleted: true,
  });

  if (!lease) {
    throw new AppError(404, "Deleted lease not found");
  }

  lease.isDeleted = false;
  lease.deletedAt = undefined;
  lease.deletedBy = undefined;

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease restored successfully",
    data: lease,
  });
});

// 17. Schedule move-in inspection
const scheduleMoveInInspection = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { scheduledAt, notes } = req.body;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    status: "fully_executed",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or not ready for move-in");
  }

  if (!scheduledAt) {
    throw new AppError(400, "Inspection date and time is required");
  }

  lease.inspections.moveIn.scheduledAt = new Date(scheduledAt);
  lease.inspections.moveIn.conductedBy = userId;
  
  if (notes) {
    lease.inspections.moveIn.notes = notes;
  }

  lease.messages.push({
    from: userId,
    message: `Move-in inspection scheduled for ${new Date(scheduledAt).toLocaleDateString()}`,
    sentAt: new Date(),
    readBy: [userId],
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Move-in inspection scheduled successfully",
    data: lease.inspections.moveIn,
  });
});

// 18. Conduct move-in inspection
const conductMoveInInspection = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { report, photos, condition } = req.body;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    status: "fully_executed",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found");
  }

  if (!lease.inspections.moveIn.scheduledAt) {
    throw new AppError(400, "Move-in inspection not scheduled");
  }

  lease.inspections.moveIn.conductedAt = new Date();
  lease.inspections.moveIn.report = report;
  lease.inspections.moveIn.condition = condition;
  
  if (photos && photos.length > 0) {
    lease.inspections.moveIn.photos = photos;
  }

  // Mark who conducted it
  const isLandlord = lease.landlord.toString() === userId;
  if (isLandlord) {
    lease.inspections.moveIn.conductedBy = userId;
    lease.inspections.moveIn.signedByLandlord = true;
  } else {
    lease.inspections.moveIn.signedByTenant = true;
  }

  // If both signed, update lease status to active
  if (lease.inspections.moveIn.signedByLandlord && 
      lease.inspections.moveIn.signedByTenant) {
    lease.status = "active";
    lease.statusHistory.push({
      status: "active",
      changedBy: userId,
      reason: "Move-in inspection completed, lease now active",
      changedAt: new Date(),
    });
    lease.metadata = lease.metadata || {};
    lease.metadata.moveInDate = new Date();
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Move-in inspection recorded successfully",
    data: lease.inspections.moveIn,
  });
});

// 19. Give notice (renewal or termination)
const giveNotice = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { type, effectiveDate, reason, document } = req.body;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    status: "active",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Active lease not found");
  }

  if (!["renewal", "termination"].includes(type)) {
    throw new AppError(400, "Notice type must be 'renewal' or 'termination'");
  }

  if (!effectiveDate) {
    throw new AppError(400, "Effective date is required");
  }

  // Add notice
  lease.notices.push({
    type: type,
    givenBy: userId,
    givenAt: new Date(),
    effectiveDate: new Date(effectiveDate),
    reason: reason,
    document: document,
    acknowledged: false,
  });

  // Update status
  if (type === "termination") {
    lease.status = "notice_given";
    lease.statusHistory.push({
      status: "notice_given",
      changedBy: userId,
      reason: `${userId === lease.landlord.toString() ? "Landlord" : "Tenant"} gave termination notice`,
      changedAt: new Date(),
    });
  } else {
    lease.renewal.status = "offered";
    lease.renewal.offeredAt = new Date();
    lease.renewal.responseDueBy = new Date(new Date().setDate(new Date().getDate() + 30));
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: `${type === "termination" ? "Termination" : "Renewal"} notice given successfully`,
    data: lease.notices[lease.notices.length - 1],
  });
});

// 20. Respond to renewal offer
const respondToRenewal = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { action, newRentAmount, newEndDate } = req.body;
  const tenantId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    tenant: tenantId,
    "renewal.status": "offered",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Renewal offer not found");
  }

  if (!["accept", "decline"].includes(action)) {
    throw new AppError(400, "Action must be 'accept' or 'decline'");
  }

  if (action === "accept") {
    // Accept renewal
    lease.renewal.status = "accepted";
    lease.renewal.acceptedAt = new Date();
    
    if (newRentAmount) {
      lease.renewal.newRentAmount = newRentAmount;
      lease.rentAmount = newRentAmount;
    }
    
    if (newEndDate) {
      lease.renewal.newEndDate = newEndDate;
      lease.endDate = newEndDate;
    }

    // Create addendum document
    lease.documents.push({
      type: "addendum",
      name: `Renewal Addendum - ${new Date().toLocaleDateString()}`,
      uploadedBy: tenantId,
      version: lease.documents.filter(d => d.type === "addendum").length + 1,
      uploadedAt: new Date(),
    });

    lease.statusHistory.push({
      status: "active",
      changedBy: tenantId,
      reason: "Lease renewal accepted",
      changedAt: new Date(),
      metadata: { newRentAmount, newEndDate }
    });

  } else {
    // Decline renewal
    lease.renewal.status = "declined";
    lease.renewal.declinedAt = new Date();
    
    // Schedule move-out at lease end
    lease.status = "notice_given";
    lease.statusHistory.push({
      status: "notice_given",
      changedBy: tenantId,
      reason: "Renewal declined, lease will end on original date",
      changedAt: new Date(),
    });
  }

  // Acknowledge the notice
  const notice = lease.notices.find(n => n.type === "renewal" && !n.acknowledged);
  if (notice) {
    notice.acknowledged = true;
    notice.acknowledgedAt = new Date();
  }

  await lease.save();

  res.status(200).json({
    success: true,
    message: `Renewal ${action}ed successfully`,
    data: lease.renewal,
  });
});

// 21. Schedule move-out inspection
const scheduleMoveOutInspection = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { scheduledAt } = req.body;
  const userId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    status: { $in: ["notice_given", "active"] },
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found");
  }

  if (!scheduledAt) {
    throw new AppError(400, "Scheduled date is required");
  }

  lease.inspections.moveOut.scheduledAt = new Date(scheduledAt);
  
  if (userId === lease.landlord.toString()) {
    lease.inspections.moveOut.conductedBy = userId;
  }

  lease.messages.push({
    from: userId,
    message: `Move-out inspection scheduled for ${new Date(scheduledAt).toLocaleDateString()}`,
    sentAt: new Date(),
    readBy: [userId],
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Move-out inspection scheduled",
    data: lease.inspections.moveOut,
  });
});

// 22. Process security deposit return
const processDepositReturn = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { returnedAmount, deductions, description } = req.body;
  const landlordId = req.user.userId;

  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: { $in: ["expired", "terminated"] },
    depositStatus: "held",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(404, "Lease not found or deposit not available for return");
  }

  if (!returnedAmount || returnedAmount < 0) {
    throw new AppError(400, "Valid returned amount is required");
  }

  const totalDeductions = deductions?.reduce((sum, d) => sum + d.amount, 0) || 0;
  const expectedReturn = lease.securityDeposit - totalDeductions;

  if (Math.abs(returnedAmount - expectedReturn) > 1) {
    throw new AppError(400, 
      `Returned amount (${returnedAmount}) doesn't match expected return (${expectedReturn})`
    );
  }

  // Record deduction transactions
  if (deductions && deductions.length > 0) {
    deductions.forEach(deduction => {
      lease.depositTransactions.push({
        amount: deduction.amount,
        type: "deduction",
        date: new Date(),
        description: deduction.description,
        proof: deduction.proof,
      });
    });
  }

  // Record return transaction
  lease.depositTransactions.push({
    amount: returnedAmount,
    type: "return",
    date: new Date(),
    description: description || "Security deposit return",
    proof: req.body.returnProof,
  });

  // Update deposit status
  if (returnedAmount === 0) {
    lease.depositStatus = "held";
  } else if (returnedAmount < lease.securityDeposit) {
    lease.depositStatus = "partially_returned";
  } else {
    lease.depositStatus = "returned";
  }

  lease.messages.push({
    from: landlordId,
    message: `Security deposit processed: $${returnedAmount} returned${totalDeductions > 0 ? `, $${totalDeductions} deducted` : ''}`,
    sentAt: new Date(),
    readBy: [landlordId],
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Security deposit processed successfully",
    data: {
      depositStatus: lease.depositStatus,
      returnedAmount,
      deductions: totalDeductions,
      transactions: lease.depositTransactions.slice(-(deductions ? deductions.length + 1 : 1)),
    },
  });
});

// Export all controllers
export {
  createLease,
  reviewApplication,
  approveRequest,
  createOrUpdateDraft,
  sendToTenant,
  requestChanges,
  tenantReviewLease,
  sendToLandlordForSignature,
  signLease,
  updateLease,
  getMyLeases,
  getLeaseById,
  cancelLease,
  getLeaseStats,
  deleteLease,
  restoreLease,
  scheduleMoveInInspection,
  conductMoveInInspection,
  giveNotice,
  respondToRenewal,
  scheduleMoveOutInspection,
  processDepositReturn
};